"""Metric computation over the ingested commit history.

Definitions come straight from the test brief.  Everything is derived from the
``deltas`` table (commit x file x added/removed) so any commit-set filter
(author, time window, manual commit list, path scope) is just a different WHERE
clause over the same rows:

* file        added l+, removed l-, growth = l+ - l-, churn = l+ + l-
* directory   sums over immediate children; because sums telescope, every
              ancestor of a touched file simply receives the file's delta
* repository  the root directory ('')
* commit set  sums over H, modifications n, frequency n/|H|, churn rate churn/|H|
* author      n_{H,o,a}, churn_{H,o,a}, ownership = churn_{H,o,a} / churn_{H,o}

A built :class:`Bundle` is cached per (repo, filters) so switching dashboard
tabs does not re-aggregate the same commit set.
"""

from __future__ import annotations

import json
import threading
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone

from . import db

_CACHE_MAX = 8


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@dataclass(frozen=True)
class Filters:
    authors: tuple[str, ...] | None = None      # canonical identity keys
    path: str | None = None                     # file path or directory scope
    from_ts: int | None = None
    to_ts: int | None = None                    # exclusive, per the brief
    shas: tuple[str, ...] | None = None         # manual commit selection
    bucket: str = "auto"                        # timeseries granularity

    @staticmethod
    def make(authors=None, path=None, from_ts=None, to_ts=None, shas=None, bucket="auto") -> "Filters":
        return Filters(
            authors=tuple(sorted(set(authors))) if authors else None,
            path=((path or "").strip("/") or None),
            from_ts=int(from_ts) if from_ts not in (None, "") else None,
            to_ts=int(to_ts) if to_ts not in (None, "") else None,
            shas=tuple(shas) if shas is not None else None,
            bucket=bucket if bucket in ("auto", "day", "week", "month") else "auto",
        )

    @property
    def key(self):
        return (self.authors, self.path, self.from_ts, self.to_ts, self.shas, self.bucket)


@dataclass
class Bundle:
    repo_id: int
    filters: Filters
    h_count: int = 0
    files: dict[str, list[int]] = field(default_factory=dict)                # path -> [added, removed, mods]
    dirs: dict[str, list[int]] = field(default_factory=dict)                 # dir ('') -> [added, removed, mods]
    file_auth: dict[tuple[str, str], list[int]] = field(default_factory=dict)  # (author, path) -> [churn, mods]
    dir_auth: dict[tuple[str, str], list[int]] = field(default_factory=dict)   # (author, dir) -> [churn, mods]
    author_totals: dict[str, list[int]] = field(default_factory=dict)          # author -> [added, removed, churn, mods, commits]
    author_names: dict[str, str] = field(default_factory=dict)
    authors: dict[str, list[str]] = field(default_factory=dict)                # canonical -> member identities
    author_file_counts: dict[str, int] = field(default_factory=dict)
    timeseries: dict[str, list[int]] = field(default_factory=dict)             # bucket -> [added, removed]
    top_authors_by_path: dict[str, list[tuple[str, int]]] = field(default_factory=dict)
    top_authors_by_dir: dict[str, list[tuple[str, int]]] = field(default_factory=dict)
    bucket: str = "day"

    @property
    def root_churn(self) -> int:
        root = self.dirs.get("")
        return (root[0] + root[1]) if root else 0


_cache: dict[tuple, Bundle] = {}
_cache_lock = threading.Lock()


def invalidate_repo(repo_id: int) -> None:
    with _cache_lock:
        for key in [k for k in _cache if k[0] == repo_id]:
            del _cache[key]


def get_bundle(repo_id: int, filters: Filters) -> Bundle:
    key = (repo_id, filters.key)
    with _cache_lock:
        cached = _cache.get(key)
    if cached is not None:
        return cached
    bundle = _build(repo_id, filters)
    with _cache_lock:
        if key not in _cache:
            while len(_cache) >= _CACHE_MAX:
                _cache.pop(next(iter(_cache)))
            _cache[key] = bundle
    return bundle


# ---------------------------------------------------------------------------
# building

def author_resolution(repo_id: int):
    """Return (ident -> canonical, canonical -> [idents]) after manual merges."""
    conn = db.connect()
    merges = {
        row["src"]: row["dst"]
        for row in conn.execute(
            "SELECT src, dst FROM author_merges WHERE repo_id = ?", (repo_id,)
        ).fetchall()
    }

    def root(ident: str) -> str:
        seen: set[str] = set()
        while ident in merges and ident not in seen:
            seen.add(ident)
            ident = merges[ident]
        return ident

    resolution: dict[str, str] = {}
    members: dict[str, list[str]] = defaultdict(list)
    for row in conn.execute(
        "SELECT DISTINCT ident FROM commits WHERE repo_id = ?", (repo_id,)
    ).fetchall():
        ident = row["ident"]
        canon = root(ident)
        resolution[ident] = canon
        members[canon].append(ident)
    for canon in members:
        members[canon].sort()
    return resolution, dict(members)


def _commit_where(repo_id: int, filters: Filters, alias: str = "c"):
    clauses = [f"{alias}.repo_id = ?"]
    params: list = [repo_id]
    if filters.from_ts is not None:
        clauses.append(f"{alias}.ts >= ?")
        params.append(filters.from_ts)
    if filters.to_ts is not None:
        clauses.append(f"{alias}.ts < ?")
        params.append(filters.to_ts)
    if filters.shas is not None:
        clauses.append(f"{alias}.sha IN (SELECT value FROM json_each(?))")
        params.append(json.dumps(list(filters.shas)))
    if filters.authors is not None:
        resolution, _ = author_resolution(repo_id)
        allowed = [i for i, c in resolution.items() if c in set(filters.authors)]
        if not allowed:
            clauses.append("0 = 1")
        else:
            clauses.append(f"{alias}.ident IN ({','.join('?' * len(allowed))})")
            params.extend(sorted(allowed))
    return " AND ".join(clauses), params


def _bucket_for(span_seconds: int, bucket: str) -> str:
    if bucket != "auto":
        return bucket
    days = span_seconds / 86400
    if days > 800:
        return "month"
    if days > 200:
        return "week"
    return "day"


def _bucket_key(ts: int, bucket: str) -> str:
    dt = datetime.fromtimestamp(ts, tz=timezone.utc)
    if bucket == "month":
        return dt.strftime("%Y-%m")
    if bucket == "week":
        iso = dt.isocalendar()
        return f"{iso.year}-W{iso.week:02d}"
    return dt.strftime("%Y-%m-%d")


def _build(repo_id: int, filters: Filters) -> Bundle:
    conn = db.connect()
    resolution, canon_members = author_resolution(repo_id)
    bundle = Bundle(repo_id=repo_id, filters=filters)

    where, params = _commit_where(repo_id, filters)
    rows = conn.execute(
        f"SELECT c.sha, c.ident, c.ts, c.m_name FROM commits c WHERE {where}", params
    ).fetchall()

    shas: list[str] = []
    meta: dict[str, tuple[str, int]] = {}
    name_votes: dict[str, Counter] = defaultdict(Counter)
    min_ts: int | None = None
    max_ts: int | None = None
    for row in rows:
        canon = resolution.get(row["ident"], row["ident"])
        shas.append(row["sha"])
        meta[row["sha"]] = (canon, row["ts"])
        name_votes[canon][row["m_name"] or canon] += 1
        bundle.author_totals.setdefault(canon, [0, 0, 0, 0, 0])[4] += 1
        ts = row["ts"]
        min_ts = ts if min_ts is None else min(min_ts, ts)
        max_ts = ts if max_ts is None else max(max_ts, ts)

    bundle.h_count = len(shas)
    bundle.bucket = _bucket_for((max_ts - min_ts) if min_ts is not None else 0, filters.bucket)
    bundle.author_names = {canon: votes.most_common(1)[0][0] for canon, votes in name_votes.items()}
    bundle.authors = {c: canon_members.get(c, [c]) for c in bundle.author_totals}
    if not shas:
        return bundle

    # Defensive: clear any transaction left over by an earlier code path so a
    # stale read snapshot can never leak across requests on this connection.
    conn.commit()
    conn.execute("DROP TABLE IF EXISTS temp.h_sel")
    conn.execute("CREATE TEMP TABLE h_sel (sha TEXT PRIMARY KEY)")
    conn.executemany("INSERT INTO h_sel (sha) VALUES (?)", ((sha,) for sha in shas))

    clauses = ["d.repo_id = ?"]
    dparams: list = [repo_id]
    if filters.path:
        clauses.append("(d.path = ? OR d.path LIKE ? ESCAPE '\\')")
        dparams.extend([filters.path, _escape_like(filters.path) + "/%"])

    cursor = conn.execute(
        "SELECT d.sha, d.path, d.added, d.removed "
        "FROM deltas d JOIN h_sel s ON s.sha = d.sha "
        "WHERE " + " AND ".join(clauses) + " ORDER BY d.sha",
        dparams,
    )

    ancestors_cache: dict[str, tuple[str, ...]] = {}

    def ancestors_of(path: str) -> tuple[str, ...]:
        cached = ancestors_cache.get(path)
        if cached is None:
            acc = [""]
            current = ""
            for part in path.split("/")[:-1]:
                current = f"{current}/{part}" if current else part
                acc.append(current)
            cached = tuple(acc)
            ancestors_cache[path] = cached
        return cached

    touched: set[str] = set()
    current_sha: str | None = None

    def flush_commit(sha: str | None, touched_files: set[str]) -> None:
        if not sha or not touched_files:
            return
        canon = meta[sha][0]
        bundle.author_totals[canon][3] += 1  # n_{H,'',a}
        dirs_seen: set[str] = set()
        for path in touched_files:
            bundle.files.setdefault(path, [0, 0, 0])[2] += 1
            bundle.file_auth.setdefault((canon, path), [0, 0])[1] += 1
            dirs_seen.update(ancestors_of(path))
        for directory in dirs_seen:
            bundle.dirs.setdefault(directory, [0, 0, 0])[2] += 1
            bundle.dir_auth.setdefault((canon, directory), [0, 0])[1] += 1

    for row in cursor:
        sha = row["sha"]
        if sha != current_sha:
            flush_commit(current_sha, touched)
            touched = set()
            current_sha = sha
        path = row["path"]
        added = int(row["added"])
        removed = int(row["removed"])
        churn = added + removed
        canon, ts = meta[sha]

        entry = bundle.files.setdefault(path, [0, 0, 0])
        entry[0] += added
        entry[1] += removed
        touched.add(path)

        fa = bundle.file_auth.setdefault((canon, path), [0, 0])
        fa[0] += churn

        for directory in ancestors_of(path):
            dv = bundle.dirs.setdefault(directory, [0, 0, 0])
            dv[0] += added
            dv[1] += removed
            da = bundle.dir_auth.setdefault((canon, directory), [0, 0])
            da[0] += churn

        totals = bundle.author_totals.setdefault(canon, [0, 0, 0, 0, 0])
        totals[0] += added
        totals[1] += removed
        totals[2] += churn

        tv = bundle.timeseries.setdefault(_bucket_key(ts, bundle.bucket), [0, 0])
        tv[0] += added
        tv[1] += removed

    flush_commit(current_sha, touched)
    conn.execute("DROP TABLE IF EXISTS temp.h_sel")
    # The INSERT into the temp table opened an implicit transaction in the
    # legacy sqlite3 mode; leaving it open would pin this thread's connection
    # to a stale database snapshot for every later request.
    conn.commit()

    by_path: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for (canon, path), value in bundle.file_auth.items():
        if value[0] > 0:
            by_path[path].append((canon, value[0]))
    bundle.top_authors_by_path = dict(by_path)

    by_dir: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for (canon, directory), value in bundle.dir_auth.items():
        if value[0] > 0:
            by_dir[directory].append((canon, value[0]))
    bundle.top_authors_by_dir = dict(by_dir)

    counts: dict[str, int] = defaultdict(int)
    for canon, _path in bundle.file_auth:
        counts[canon] += 1
    bundle.author_file_counts = dict(counts)
    return bundle


# ---------------------------------------------------------------------------
# views

def _top_author(bundle: Bundle, is_dir: bool, path: str, churn: int):
    index = bundle.top_authors_by_dir if is_dir else bundle.top_authors_by_path
    entries = index.get(path)
    if not entries:
        return None
    canon, author_churn = max(entries, key=lambda item: (item[1], item[0]))
    return {
        "id": canon,
        "name": bundle.author_names.get(canon, canon),
        "churn": author_churn,
        "ownership": round(author_churn / churn, 4) if churn else 0.0,
    }


def _object_row(bundle: Bundle, path: str, values: list[int], is_dir: bool) -> dict:
    added, removed, mods = values
    churn = added + removed
    h = bundle.h_count
    return {
        "name": path.rsplit("/", 1)[-1] if path else "",
        "path": path,
        "is_dir": is_dir,
        "added": added,
        "removed": removed,
        "growth": added - removed,
        "churn": churn,
        "mods": mods,
        "freq": round(mods / h, 4) if h else 0.0,
        "churn_rate": round(churn / h, 2) if h else 0.0,
        "top_author": _top_author(bundle, is_dir, path, churn),
    }


def _timeseries_rows(bundle: Bundle) -> list[dict]:
    rows = [
        {
            "bucket": key,
            "added": values[0],
            "removed": values[1],
            "growth": values[0] - values[1],
            "churn": values[0] + values[1],
        }
        for key, values in bundle.timeseries.items()
    ]
    rows.sort(key=lambda row: row["bucket"])
    return rows


def _breadcrumbs(path: str) -> list[dict]:
    crumbs = [{"path": "", "name": "repository root"}]
    current = ""
    for part in (path or "").split("/"):
        if not part:
            continue
        current = f"{current}/{part}" if current else part
        crumbs.append({"path": current, "name": part})
    return crumbs


def _kpi(bundle: Bundle) -> dict:
    root = bundle.dirs.get("", [0, 0, 0])
    added, removed, mods = root
    churn = added + removed
    h = bundle.h_count
    return {
        "commits": h,
        "authors": len(bundle.author_totals),
        "added": added,
        "removed": removed,
        "growth": added - removed,
        "churn": churn,
        "mods": mods,
        "freq": round(mods / h, 4) if h else 0.0,
        "churn_rate": round(churn / h, 2) if h else 0.0,
        "files_touched": len(bundle.files),
        "dirs_touched": sum(1 for d in bundle.dirs if d),
    }


def repo_view(repo_id: int, filters: Filters, top_limit: int = 8) -> dict:
    bundle = get_bundle(repo_id, filters)
    top_files = sorted(
        (_object_row(bundle, p, v, False) for p, v in bundle.files.items()),
        key=lambda row: (-row["churn"], row["path"]),
    )[:top_limit]
    top_dirs = sorted(
        (_object_row(bundle, p, v, True) for p, v in bundle.dirs.items() if p),
        key=lambda row: (-row["churn"], row["path"]),
    )[:top_limit]
    top_authors = sorted(
        authors_view(repo_id, filters)["rows"], key=lambda row: -row["churn"]
    )[:top_limit]
    return {
        "kpi": _kpi(bundle),
        "bucket": bundle.bucket,
        "timeseries": _timeseries_rows(bundle),
        "top_files": top_files,
        "top_dirs": top_dirs,
        "top_authors": top_authors,
        "h_count": bundle.h_count,
    }


def _tree_rows(repo_id: int) -> list:
    return db.connect().execute(
        "SELECT path, is_dir FROM tree_paths WHERE repo_id = ?", (repo_id,)
    ).fetchall()


def _parent(path: str) -> str:
    return path.rsplit("/", 1)[0] if "/" in path else ""


def objects_view(
    repo_id: int,
    filters: Filters,
    level: str,
    limit: int = 100,
    offset: int = 0,
    sort: str = "churn",
    order: str = "desc",
    include_idle: bool = True,
) -> dict:
    bundle = get_bundle(repo_id, filters)
    scope = filters.path or ""
    rows: list[dict] = []

    if level == "files":
        candidates: dict[str, list[int]] = {p: list(v) for p, v in bundle.files.items()}
        if include_idle:
            prefix = scope + "/" if scope else ""
            for tree in _tree_rows(repo_id):
                if tree["is_dir"]:
                    continue
                path = tree["path"]
                if path in candidates:
                    continue
                if prefix:
                    if not path.startswith(prefix) and path != scope:
                        continue
                candidates[path] = [0, 0, 0]
        rows = [_object_row(bundle, p, v, False) for p, v in candidates.items()]
    elif level == "dirs":
        dir_candidates: dict[str, list[int]] = {}
        file_candidates: dict[str, list[int]] = {}
        for path, values in bundle.files.items():
            if _parent(path) == scope:
                file_candidates[path] = values
        for path, values in bundle.dirs.items():
            if path and _parent(path) == scope:
                dir_candidates[path] = values
        if include_idle:
            for tree in _tree_rows(repo_id):
                path = tree["path"]
                if _parent(path) != scope or path in dir_candidates or path in file_candidates:
                    continue
                if tree["is_dir"]:
                    dir_candidates[path] = [0, 0, 0]
                else:
                    file_candidates[path] = [0, 0, 0]
        rows = [_object_row(bundle, p, v, True) for p, v in dir_candidates.items()]
        rows += [_object_row(bundle, p, v, False) for p, v in file_candidates.items()]
    else:
        raise ValueError(f"Unknown level: {level}")

    key_map = {
        "name": lambda row: row["name"],
        "path": lambda row: row["path"],
        "added": lambda row: row["added"],
        "removed": lambda row: row["removed"],
        "growth": lambda row: row["growth"],
        "churn": lambda row: row["churn"],
        "mods": lambda row: row["mods"],
        "freq": lambda row: row["freq"],
        "churn_rate": lambda row: row["churn_rate"],
    }
    key = key_map.get(sort, key_map["churn"])
    rows.sort(key=lambda row: (key(row), row["path"]), reverse=(order == "desc"))
    total = len(rows)
    return {
        "level": level,
        "scope": scope,
        "breadcrumbs": _breadcrumbs(scope),
        "h_count": bundle.h_count,
        "total": total,
        "rows": rows[offset : offset + limit],
    }


def authors_view(repo_id: int, filters: Filters) -> dict:
    bundle = get_bundle(repo_id, filters)
    total_churn = sum(values[2] for values in bundle.author_totals.values())
    h = bundle.h_count
    rows = []
    for canon, values in bundle.author_totals.items():
        added, removed, churn, mods, commits = values
        rows.append(
            {
                "id": canon,
                "name": bundle.author_names.get(canon, canon),
                "members": bundle.authors.get(canon, [canon]),
                "commits": commits,
                "added": added,
                "removed": removed,
                "growth": added - removed,
                "churn": churn,
                "mods": mods,
                "freq": round(mods / h, 4) if h else 0.0,
                "churn_rate": round(churn / h, 2) if h else 0.0,
                "ownership": round(churn / total_churn, 4) if total_churn else 0.0,
                "files_touched": bundle.author_file_counts.get(canon, 0),
            }
        )
    rows.sort(key=lambda row: -row["churn"])
    return {"h_count": h, "total": len(rows), "rows": rows}


def file_view(repo_id: int, filters: Filters, history_limit: int = 300) -> dict | None:
    path = filters.path
    if not path:
        return None
    bundle = get_bundle(repo_id, filters)
    values = bundle.files.get(path)
    if values is None:
        values = [0, 0, 0]
    row = _object_row(bundle, path, values, False)

    total = row["churn"]
    ownership = []
    for (canon, candidate), value in bundle.file_auth.items():
        if candidate != path:
            continue
        ownership.append(
            {
                "id": canon,
                "name": bundle.author_names.get(canon, canon),
                "churn": value[0],
                "mods": value[1],
                "ownership": round(value[0] / total, 4) if total else 0.0,
            }
        )
    ownership.sort(key=lambda item: -item["churn"])

    where, params = _commit_where(repo_id, filters)
    history = db.connect().execute(
        f"""
        SELECT c.sha, c.ts, c.subject, COALESCE(c.m_name, c.ident) AS author, c.ident,
               d.added, d.removed
        FROM commits c
        JOIN deltas d ON d.repo_id = c.repo_id AND d.sha = c.sha
        WHERE {where} AND d.path = ?
        ORDER BY c.ts DESC, c.sha
        LIMIT ?
        """,
        [*params, path, history_limit],
    ).fetchall()
    resolution, _ = author_resolution(repo_id)
    history_rows = [
        {
            "sha": r["sha"],
            "ts": r["ts"],
            "subject": r["subject"],
            "author": r["author"],
            "author_id": resolution.get(r["ident"], r["ident"]),
            "added": r["added"],
            "removed": r["removed"],
            "growth": r["added"] - r["removed"],
            "churn": r["added"] + r["removed"],
        }
        for r in history
    ]

    return {
        "object": row,
        "ownership": ownership,
        "history": history_rows,
        "timeseries": _timeseries_rows(bundle),
        "bucket": bundle.bucket,
        "breadcrumbs": _breadcrumbs(path),
        "h_count": bundle.h_count,
    }


def commits_view(
    repo_id: int,
    filters: Filters,
    query: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> dict:
    clauses, params = _commit_where(repo_id, filters)
    if query:
        clauses += " AND c.subject LIKE ? ESCAPE '\\'"
        params.append(f"%{_escape_like(query)}%")

    conn = db.connect()
    total = conn.execute(
        f"SELECT COUNT(*) FROM commits c WHERE {clauses}", params
    ).fetchone()[0]
    rows = conn.execute(
        f"""
        SELECT c.sha, c.ts, c.subject, c.ident, COALESCE(c.m_name, c.ident) AS author,
               COUNT(d.path) AS files,
               COALESCE(SUM(d.added), 0) AS added,
               COALESCE(SUM(d.removed), 0) AS removed
        FROM commits c
        LEFT JOIN deltas d ON d.repo_id = c.repo_id AND d.sha = c.sha
        WHERE {clauses}
        GROUP BY c.sha
        ORDER BY c.ts DESC, c.sha
        LIMIT ? OFFSET ?
        """,
        [*params, limit, offset],
    ).fetchall()
    resolution, _ = author_resolution(repo_id)
    return {
        "total": total,
        "h_count": total,
        "rows": [
            {
                "sha": r["sha"],
                "ts": r["ts"],
                "subject": r["subject"],
                "author": r["author"],
                "author_id": resolution.get(r["ident"], r["ident"]),
                "files": r["files"],
                "added": r["added"],
                "removed": r["removed"],
                "growth": r["added"] - r["removed"],
                "churn": r["added"] + r["removed"],
            }
            for r in rows
        ],
    }


def commit_detail(repo_id: int, sha: str) -> dict | None:
    conn = db.connect()
    commit = conn.execute(
        "SELECT sha, ts, subject, ident, COALESCE(m_name, ident) AS author FROM commits "
        "WHERE repo_id = ? AND sha = ?",
        (repo_id, sha),
    ).fetchone()
    if commit is None:
        return None
    resolution, _ = author_resolution(repo_id)
    files = conn.execute(
        "SELECT path, added, removed FROM deltas WHERE repo_id = ? AND sha = ? "
        "ORDER BY (added + removed) DESC, path",
        (repo_id, sha),
    ).fetchall()
    added = sum(r["added"] for r in files)
    removed = sum(r["removed"] for r in files)
    return {
        "sha": commit["sha"],
        "ts": commit["ts"],
        "subject": commit["subject"],
        "author": commit["author"],
        "author_id": resolution.get(commit["ident"], commit["ident"]),
        "added": added,
        "removed": removed,
        "growth": added - removed,
        "churn": added + removed,
        "files": [
            {
                "path": r["path"],
                "added": r["added"],
                "removed": r["removed"],
                "growth": r["added"] - r["removed"],
                "churn": r["added"] + r["removed"],
            }
            for r in files
        ],
    }
