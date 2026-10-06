"""SQLite storage for the Repo Analysis Tool.

One row in ``commits`` per non-merge commit reachable from the analysed ref, and
one row in ``deltas`` per (commit, file) pair that has a non-zero line change.
All metrics are derived from these two tables, so every filter
(author / time window / manual commit list / path scope) is just a different
query over the same data.
"""

from __future__ import annotations

import os
import sqlite3
import threading
from pathlib import Path

DATA_DIR = Path(
    os.environ.get("RAT_DATA_DIR", Path(__file__).resolve().parents[1] / "data")
).resolve()
REPOS_DIR = DATA_DIR / "repos"
DB_PATH = DATA_DIR / "rat.sqlite"

SCHEMA = """
CREATE TABLE IF NOT EXISTS repos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    source_type   TEXT NOT NULL,              -- 'url' | 'zip'
    source        TEXT,                       -- clone URL or uploaded file path
    path          TEXT,                       -- git dir on disk
    status        TEXT NOT NULL DEFAULT 'pending',
    stage         TEXT,
    progress      REAL NOT NULL DEFAULT 0,    -- 0..1
    error         TEXT,
    ref           TEXT NOT NULL DEFAULT 'HEAD',
    head_sha      TEXT,
    commit_count  INTEGER NOT NULL DEFAULT 0,
    author_count  INTEGER NOT NULL DEFAULT 0,
    has_mailmap   INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL,
    ingested_at   TEXT
);

CREATE TABLE IF NOT EXISTS commits (
    repo_id   INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    sha       TEXT NOT NULL,
    seq       INTEGER NOT NULL,               -- position in history, oldest = 1
    ident     TEXT NOT NULL,                  -- identity key: mailmap email, lowercased
    m_name    TEXT,                           -- name with .mailmap applied
    m_email   TEXT,                           -- email with .mailmap applied
    raw_name  TEXT,
    raw_email TEXT,
    subject   TEXT,
    ts        INTEGER NOT NULL,               -- committer date, unix seconds
    PRIMARY KEY (repo_id, sha)
);
CREATE INDEX IF NOT EXISTS idx_commits_ts ON commits(repo_id, ts);
CREATE INDEX IF NOT EXISTS idx_commits_ident ON commits(repo_id, ident);

CREATE TABLE IF NOT EXISTS deltas (
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    sha     TEXT NOT NULL,
    path    TEXT NOT NULL,                    -- path the change is attributed to
    added   INTEGER NOT NULL,
    removed INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deltas_sha ON deltas(repo_id, sha);
CREATE INDEX IF NOT EXISTS idx_deltas_path ON deltas(repo_id, path);

CREATE TABLE IF NOT EXISTS tree_paths (
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    path    TEXT NOT NULL,
    is_dir  INTEGER NOT NULL,
    PRIMARY KEY (repo_id, path)
);

CREATE TABLE IF NOT EXISTS author_merges (
    repo_id INTEGER NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
    src     TEXT NOT NULL,                    -- identity being merged away
    dst     TEXT NOT NULL,                    -- canonical identity it merges into
    PRIMARY KEY (repo_id, src)
);
"""

_tls = threading.local()


def connect() -> sqlite3.Connection:
    """Per-thread connection (FastAPI threadpool + ingestion worker threads)."""
    conn = getattr(_tls, "conn", None)
    if conn is None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(DB_PATH), timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA foreign_keys=ON")
        _tls.conn = conn
    return conn


def init_db() -> None:
    REPOS_DIR.mkdir(parents=True, exist_ok=True)
    conn = connect()
    conn.executescript(SCHEMA)
    conn.commit()
