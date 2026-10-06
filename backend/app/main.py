"""FastAPI application exposing ingestion + metric endpoints."""

from __future__ import annotations

import shutil
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import db, ingest, metrics

DIST_DIR = Path(__file__).resolve().parents[2] / "frontend" / "dist"


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init_db()
    if DIST_DIR.exists():
        app.mount("/", StaticFiles(directory=DIST_DIR, html=True), name="static")
    yield


app = FastAPI(title="Repo Analysis Tool", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# helpers

def _repo_row(repo_id: int):
    row = db.connect().execute("SELECT * FROM repos WHERE id = ?", (repo_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Repository not found")
    return row


def _ready_row(repo_id: int):
    row = _repo_row(repo_id)
    if row["status"] == "error":
        raise HTTPException(status_code=409, detail=f"Ingestion failed: {row['error']}")
    if row["status"] != "ready":
        raise HTTPException(status_code=409, detail="Repository is still being ingested")
    return row


def _filters(
    authors: str | None = None,
    path: str | None = None,
    from_ts: int | None = None,
    to_ts: int | None = None,
    shas: str | None = None,
    bucket: str = "auto",
) -> metrics.Filters:
    return metrics.Filters.make(
        authors=[a for a in authors.split(",") if a] if authors is not None else None,
        path=path,
        from_ts=from_ts,
        to_ts=to_ts,
        shas=[s for s in shas.split(",") if s] if shas is not None else None,
        bucket=bucket,
    )


# ---------------------------------------------------------------------------
# repositories

class RepoCreate(BaseModel):
    url: str
    name: str | None = None
    ref: str | None = None


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/repos")
def list_repos() -> list[dict]:
    return [
        dict(row)
        for row in db.connect().execute("SELECT * FROM repos ORDER BY id DESC").fetchall()
    ]


@app.post("/api/repos", status_code=201)
def create_repo(payload: RepoCreate) -> dict:
    url = (payload.url or "").strip()
    if not url.startswith(("http://", "https://", "ssh://", "git@", "file://")):
        raise HTTPException(
            status_code=400,
            detail="Provide a clone URL starting with http(s)://, ssh:// or git@",
        )
    repo_id = ingest.create_repo("url", url, payload.name, payload.ref)
    return dict(_repo_row(repo_id))


@app.post("/api/repos/upload", status_code=201)
async def upload_repo(
    file: UploadFile = File(...),
    name: str | None = Form(None),
    ref: str | None = Form(None),
) -> dict:
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise HTTPException(
            status_code=400, detail="Upload a .zip archive of the repository (including .git)"
        )
    uploads = db.REPOS_DIR / "uploads"
    uploads.mkdir(parents=True, exist_ok=True)
    dest = uploads / f"{uuid.uuid4().hex}.zip"
    size = 0
    with dest.open("wb") as out:
        while chunk := await file.read(1 << 20):
            size += len(chunk)
            out.write(chunk)
    if size == 0:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    repo_id = ingest.create_repo(
        "zip", str(dest), name or Path(file.filename).stem, ref
    )
    return dict(_repo_row(repo_id))


@app.get("/api/repos/{repo_id}")
def get_repo(repo_id: int) -> dict:
    return dict(_repo_row(repo_id))


@app.delete("/api/repos/{repo_id}", status_code=204)
def delete_repo(repo_id: int) -> Response:
    _repo_row(repo_id)
    conn = db.connect()
    conn.execute("DELETE FROM repos WHERE id = ?", (repo_id,))
    conn.commit()
    metrics.invalidate_repo(repo_id)
    shutil.rmtree(db.REPOS_DIR / str(repo_id), ignore_errors=True)
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# authors + merging

@app.get("/api/repos/{repo_id}/authors")
def repo_authors(repo_id: int) -> dict:
    _require_any(repo_id)
    conn = db.connect()
    resolution, members = metrics.author_resolution(repo_id)

    stats: dict[str, dict] = {}
    for row in conn.execute(
        """
        SELECT c.ident, COUNT(*) AS commits, MIN(c.ts) AS first_ts, MAX(c.ts) AS last_ts
        FROM commits c WHERE c.repo_id = ? GROUP BY c.ident
        """,
        (repo_id,),
    ):
        stats[row["ident"]] = {
            "commits": row["commits"],
            "first_ts": row["first_ts"],
            "last_ts": row["last_ts"],
            "added": 0,
            "removed": 0,
        }
    for row in conn.execute(
        """
        SELECT c.ident, COALESCE(SUM(d.added), 0) AS added,
               COALESCE(SUM(d.removed), 0) AS removed
        FROM commits c
        LEFT JOIN deltas d ON d.repo_id = c.repo_id AND d.sha = c.sha
        WHERE c.repo_id = ? GROUP BY c.ident
        """,
        (repo_id,),
    ):
        if row["ident"] in stats:
            stats[row["ident"]]["added"] = row["added"]
            stats[row["ident"]]["removed"] = row["removed"]

    names: dict[str, list[tuple[int, str]]] = {}
    emails: dict[str, set[str]] = {}
    mailmap_used: set[str] = set()
    for row in conn.execute(
        "SELECT ident, m_name, raw_email, COUNT(*) AS n FROM commits "
        "WHERE repo_id = ? GROUP BY ident, m_name, raw_email",
        (repo_id,),
    ):
        names.setdefault(row["ident"], []).append((row["n"], row["m_name"] or row["ident"]))
        emails.setdefault(row["ident"], set()).add(row["raw_email"] or "")
        if (row["raw_email"] or "").strip().lower() != row["ident"]:
            mailmap_used.add(row["ident"])

    groups: dict[str, dict] = {}
    for ident, canon in resolution.items():
        stat = stats.get(ident, {"commits": 0, "added": 0, "removed": 0, "first_ts": None, "last_ts": None})
        best_name = max(names.get(ident, [(0, ident)]))[1]
        member = {
            "ident": ident,
            "name": best_name,
            "emails": sorted(e for e in emails.get(ident, set()) if e),
            "commits": stat["commits"],
            "added": stat["added"],
            "removed": stat["removed"],
            "churn": stat["added"] + stat["removed"],
            "first_ts": stat["first_ts"],
            "last_ts": stat["last_ts"],
            "mailmap": ident in mailmap_used,
        }
        group = groups.setdefault(
            canon,
            {"id": canon, "name": canon, "members": [], "commits": 0, "added": 0, "removed": 0, "churn": 0},
        )
        group["members"].append(member)
        group["commits"] += member["commits"]
        group["added"] += member["added"]
        group["removed"] += member["removed"]
        group["churn"] += member["churn"]

    rows = []
    for group in groups.values():
        group["members"].sort(key=lambda item: -item["commits"])
        weighted: dict[str, int] = {}
        for member in group["members"]:
            weighted[member["name"]] = weighted.get(member["name"], 0) + member["commits"]
        group["name"] = max(weighted.items(), key=lambda item: item[1])[0]
        group["merged"] = len(group["members"]) > 1
        group["mailmap"] = any(member["mailmap"] for member in group["members"])
        rows.append(group)
    rows.sort(key=lambda group: -group["commits"])
    repo = _repo_row(repo_id)
    return {
        "has_mailmap": bool(repo["has_mailmap"]),
        "total": len(rows),
        "rows": rows,
        "unassigned": sorted(set(members) - set(resolution)),
    }


class MergePayload(BaseModel):
    target: str
    members: list[str]


@app.post("/api/repos/{repo_id}/authors/merge")
def merge_authors(repo_id: int, payload: MergePayload) -> dict:
    _require_any(repo_id)
    resolution, _ = metrics.author_resolution(repo_id)
    known = set(resolution)
    if payload.target not in known:
        raise HTTPException(status_code=400, detail=f"Unknown author identity: {payload.target}")
    members = [m for m in payload.members if m and m != payload.target]
    unknown = [m for m in members if m not in known]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown author identities: {', '.join(unknown)}")
    conn = db.connect()
    existing = {row["src"] for row in conn.execute(
        "SELECT src FROM author_merges WHERE repo_id = ?", (repo_id,)
    )}
    current_canon = resolution.get(payload.target, payload.target)
    for member in {*members, payload.target} - {current_canon}:
        conn.execute(
            "INSERT OR REPLACE INTO author_merges (repo_id, src, dst) VALUES (?, ?, ?)",
            (repo_id, member, current_canon),
        )
    conn.commit()
    metrics.invalidate_repo(repo_id)
    return {"ok": True, "merged": sorted({*members, payload.target} - {current_canon}), "into": current_canon, "previous": sorted(existing)}


class UnmergePayload(BaseModel):
    ids: list[str]


@app.post("/api/repos/{repo_id}/authors/unmerge")
def unmerge_authors(repo_id: int, payload: UnmergePayload) -> dict:
    _require_any(repo_id)
    if not payload.ids:
        raise HTTPException(status_code=400, detail="Nothing to unmerge")
    conn = db.connect()
    conn.execute(
        f"DELETE FROM author_merges WHERE repo_id = ? AND src IN ({','.join('?' * len(payload.ids))})",
        (repo_id, *payload.ids),
    )
    conn.commit()
    metrics.invalidate_repo(repo_id)
    return {"ok": True, "unmerged": payload.ids}


@app.post("/api/repos/{repo_id}/authors/reset")
def reset_authors(repo_id: int) -> dict:
    _require_any(repo_id)
    conn = db.connect()
    conn.execute("DELETE FROM author_merges WHERE repo_id = ?", (repo_id,))
    conn.commit()
    metrics.invalidate_repo(repo_id)
    return {"ok": True}


def _require_any(repo_id: int):
    return _repo_row(repo_id)


# ---------------------------------------------------------------------------
# metrics

@app.get("/api/repos/{repo_id}/metrics")
def repo_metrics(
    repo_id: int,
    level: str = "repo",
    path: str | None = None,
    authors: str | None = None,
    from_ts: int | None = None,
    to_ts: int | None = None,
    shas: str | None = None,
    bucket: str = "auto",
    sort: str = "churn",
    order: str = "desc",
    limit: int = 100,
    offset: int = 0,
    include_idle: bool = True,
) -> dict:
    _ready_row(repo_id)
    filters = _filters(authors, path, from_ts, to_ts, shas, bucket)
    if level == "repo":
        return metrics.repo_view(repo_id, filters)
    if level == "authors":
        return metrics.authors_view(repo_id, filters)
    if level in ("files", "dirs"):
        return metrics.objects_view(
            repo_id, filters, level, limit, offset, sort, order, include_idle
        )
    raise HTTPException(status_code=400, detail="level must be repo | files | dirs | authors")


@app.get("/api/repos/{repo_id}/file")
def repo_file(
    repo_id: int,
    path: str,
    authors: str | None = None,
    from_ts: int | None = None,
    to_ts: int | None = None,
    shas: str | None = None,
    bucket: str = "auto",
) -> dict:
    _ready_row(repo_id)
    filters = _filters(authors, path, from_ts, to_ts, shas, bucket)
    view = metrics.file_view(repo_id, filters)
    if view is None:
        raise HTTPException(status_code=400, detail="path is required")
    return view


@app.get("/api/repos/{repo_id}/commits")
def repo_commits(
    repo_id: int,
    q: str | None = None,
    authors: str | None = None,
    from_ts: int | None = None,
    to_ts: int | None = None,
    shas: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> dict:
    _ready_row(repo_id)
    filters = _filters(authors, None, from_ts, to_ts, shas)
    return metrics.commits_view(repo_id, filters, q, limit, offset)


@app.get("/api/repos/{repo_id}/commit/{sha}")
def repo_commit_detail(repo_id: int, sha: str) -> dict:
    _ready_row(repo_id)
    detail = metrics.commit_detail(repo_id, sha)
    if detail is None:
        raise HTTPException(status_code=404, detail="Commit not found")
    return detail
