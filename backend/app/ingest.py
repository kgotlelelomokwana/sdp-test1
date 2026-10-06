"""Repository ingestion.

Two accepted sources, per the brief:

1. ``url``: a remote repository that is deeply cloned (``--mirror`` keeps every
   ref and the full history).
2. ``zip``: an uploaded archive containing the ``.git`` file or directory
   (worktree-style ``gitdir:`` files and bare repositories are both handled).

The worker runs in a background thread, writes progress into the ``repos`` row
(so the dashboard can poll it) and finally streams the whole history through
:func:`app.gitutil.stream_commits` into the SQLite store.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import threading
import zipfile
from datetime import datetime, timezone
from pathlib import Path

from . import db
from .gitutil import GitError, git_text, run_git, stream_commits

BATCH_SIZE = 500


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def default_name(source: str, source_type: str) -> str:
    if source_type == "url":
        tail = source.rstrip("/").rsplit("/", 1)[-1].rsplit(":", 1)[-1]
        return (tail[:-4] if tail.endswith(".git") else tail) or source
    return Path(source).stem or "repository"


def create_repo(source_type: str, source: str, name: str | None, ref: str | None) -> int:
    """Insert the repo row and kick off the ingestion worker."""
    conn = db.connect()
    cur = conn.execute(
        "INSERT INTO repos (name, source_type, source, status, stage, ref, created_at) "
        "VALUES (?, ?, ?, 'pending', 'Queued', ?, ?)",
        (
            (name or "").strip() or default_name(source, source_type),
            source_type,
            source,
            (ref or "HEAD").strip() or "HEAD",
            _now(),
        ),
    )
    conn.commit()
    repo_id = int(cur.lastrowid)
    threading.Thread(
        target=_worker, args=(repo_id,), daemon=True, name=f"rat-ingest-{repo_id}"
    ).start()
    return repo_id


def _update(repo_id: int, **fields: object) -> None:
    conn = db.connect()
    assignments = ", ".join(f"{key} = ?" for key in fields)
    conn.execute(f"UPDATE repos SET {assignments} WHERE id = ?", (*fields.values(), repo_id))
    conn.commit()


def _worker(repo_id: int) -> None:
    try:
        row = db.connect().execute("SELECT * FROM repos WHERE id = ?", (repo_id,)).fetchone()
        if row is None:
            return
        repo_dir = db.REPOS_DIR / str(repo_id)
        repo_dir.mkdir(parents=True, exist_ok=True)
        if row["source_type"] == "url":
            _update(repo_id, status="cloning", stage="Cloning repository (full history)")
            gitdir = repo_dir / "repo.git"
            if gitdir.exists():
                shutil.rmtree(gitdir)
            proc = subprocess.run(
                ["git", "clone", "--mirror", str(row["source"]), str(gitdir)],
                capture_output=True,
                timeout=7200,
            )
            if proc.returncode != 0:
                raise GitError(
                    proc.stderr.decode("utf-8", "replace").strip() or "git clone failed"
                )
        else:
            _update(repo_id, status="cloning", stage="Extracting uploaded archive")
            gitdir = _extract_zip(Path(str(row["source"])), repo_dir)
        _update(repo_id, path=str(gitdir))
        _parse_history(repo_id, gitdir, str(row["ref"]))
    except Exception as exc:  # noqa: BLE001 - every failure belongs in the UI
        _update(
            repo_id,
            status="error",
            stage="Failed",
            error=(str(exc) or exc.__class__.__name__)[:600],
        )
    finally:
        from . import metrics

        metrics.invalidate_repo(repo_id)


def _extract_zip(zip_path: Path, repo_dir: Path) -> Path:
    target = repo_dir / "extract"
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(zip_path) as zf:
            base = target.resolve()
            for info in zf.infolist():
                resolved = (base / info.filename).resolve()
                if resolved != base and base not in resolved.parents:
                    raise GitError(f"Archive contains an unsafe path: {info.filename}")
            zf.extractall(target)
    except zipfile.BadZipFile as exc:
        raise GitError("Uploaded file is not a valid zip archive") from exc
    gitdir = _locate_gitdir(target)
    zip_path.unlink(missing_ok=True)
    return gitdir


def _locate_gitdir(root: Path) -> Path:
    for dirpath, dirnames, filenames in os.walk(root):
        here = Path(dirpath)
        if len(here.relative_to(root).parts) > 3:
            dirnames[:] = []
            continue
        if ".git" in dirnames:
            return (here / ".git").resolve()
        if ".git" in filenames:
            text = (here / ".git").read_text(encoding="utf-8", errors="replace").strip()
            if text.lower().startswith("gitdir:"):
                rel = text.split(":", 1)[1].strip()
                candidate = (here / rel).resolve() if not os.path.isabs(rel) else Path(rel)
                if candidate.exists():
                    return candidate
        if "HEAD" in filenames and "objects" in dirnames and "refs" in dirnames:
            return here.resolve()  # bare repository, e.g. a zipped mirror clone
    raise GitError("The uploaded archive does not contain a .git directory or file")


def _parse_history(repo_id: int, gitdir: Path, ref: str) -> None:
    head = git_text(gitdir, "rev-parse", "--verify", f"{ref}^{{commit}}", check=False).strip()
    if not head:
        raise GitError(f"Reference '{ref}' not found (or the repository has no commits)")
    count_text = git_text(gitdir, "rev-list", "--no-merges", "--count", ref, check=False).strip()
    total = int(count_text) if count_text.isdigit() else 0
    has_mailmap = run_git(gitdir, "cat-file", "-e", f"{ref}:.mailmap", check=False).returncode == 0

    _update(repo_id, status="ingesting", stage="Reading commit history", progress=0.0, head_sha=head)
    conn = db.connect()
    conn.execute("DELETE FROM commits WHERE repo_id = ?", (repo_id,))
    conn.execute("DELETE FROM deltas WHERE repo_id = ?", (repo_id,))
    conn.commit()

    pending_commits: list[tuple] = []
    pending_deltas: list[tuple] = []
    seq = 0
    last_reported = -1.0
    for header, deltas in stream_commits(gitdir, ref):
        seq += 1
        ident = (
            (header.email or header.raw_email or header.name or "unknown").strip().lower()
            or "unknown"
        )
        pending_commits.append(
            (
                repo_id, header.sha, seq, ident,
                header.name, header.email, header.raw_name, header.raw_email,
                header.subject, header.ts,
            )
        )
        pending_deltas.extend(
            (repo_id, header.sha, path, added, removed) for path, added, removed in deltas
        )
        if len(pending_commits) >= BATCH_SIZE:
            _flush(conn, pending_commits, pending_deltas)
            pending_commits.clear()
            pending_deltas.clear()
            if total:
                progress = min(seq / total, 0.99)
                if progress - last_reported >= 0.01:
                    last_reported = progress
                    _update(
                        repo_id,
                        progress=round(progress, 4),
                        stage=f"Reading commit history ({seq:,} / {total:,} commits)",
                    )
    _flush(conn, pending_commits, pending_deltas)
    _build_tree(repo_id, gitdir, ref)

    author_count = conn.execute(
        "SELECT COUNT(DISTINCT ident) FROM commits WHERE repo_id = ?", (repo_id,)
    ).fetchone()[0]
    _update(
        repo_id,
        status="ready",
        stage="Ready",
        progress=1.0,
        ingested_at=_now(),
        commit_count=seq,
        author_count=int(author_count),
        has_mailmap=1 if has_mailmap else 0,
    )


def _flush(conn, commits: list[tuple], deltas: list[tuple]) -> None:
    if commits:
        conn.executemany(
            "INSERT OR REPLACE INTO commits "
            "(repo_id, sha, seq, ident, m_name, m_email, raw_name, raw_email, subject, ts) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            commits,
        )
    if deltas:
        conn.executemany(
            "INSERT INTO deltas (repo_id, sha, path, added, removed) VALUES (?, ?, ?, ?, ?)",
            deltas,
        )
    conn.commit()


def _build_tree(repo_id: int, gitdir: Path, ref: str) -> None:
    """Record every file (and derived directory) present at the analysed ref."""
    conn = db.connect()
    conn.execute("DELETE FROM tree_paths WHERE repo_id = ?", (repo_id,))
    raw = run_git(gitdir, "ls-tree", "-r", "-z", "--name-only", ref).stdout
    rows: list[tuple[int, str, int]] = []
    seen_dirs: set[str] = set()
    for chunk in raw.split(b"\0"):
        if not chunk:
            continue
        path = chunk.decode("utf-8", "replace")
        rows.append((repo_id, path, 0))
        parts = path.split("/")
        for i in range(1, len(parts)):
            parent = "/".join(parts[:i])
            if parent not in seen_dirs:
                seen_dirs.add(parent)
                rows.append((repo_id, parent, 1))
    conn.executemany(
        "INSERT OR REPLACE INTO tree_paths (repo_id, path, is_dir) VALUES (?, ?, ?)", rows
    )
    conn.commit()
