# RAT — Repository Analysis Tool

A web dashboard that ingests git repositories (remote URL or zip archive including `.git`)
and reports the file / directory / repository / commit-set / author metrics defined in the
COMS3011A test brief.

## Features

- **Ingestion**
  - Remote URL: full mirror clone (`git clone --mirror`), so the complete history is analysed.
  - Zip upload: zip a repository folder *including its `.git` directory* and upload it.
  - Multiple repositories can be analysed side by side; ingestion progress is shown live.
- **Filters (combinable)**
  - Repository / authors (multi-select) / file or directory scope (path prefix, or drill down).
  - Commit set H: whole history, a date range (inclusive end date, committer dates), or a
    manually picked list of commits (searchable picker).
- **Author identity handling**
  - `.mailmap` is applied automatically when present.
  - Manual merging of identities (chained, per repository), per-identity unmerge and full reset.
- **Visualisation**
  - KPI header (commits, authors, l+, l−, δ, λ, n, η, ρ, objects touched).
  - Churn bars + growth line over time (auto day/week/month bucketing, zoomable).
  - Top authors chart, directory treemap (click to drill in), ownership donut per file.
  - Sortable, paginated tables for files, directories, authors and commits with drill-downs
    (file → history → commit → file, author → authorship, treemap → directory scope).

## Metric definitions (as implemented)

| Symbol | Meaning |
| --- | --- |
| `l+`, `l−` | lines added / removed (`git --numstat`) |
| `δ` | growth = l+ − l− |
| `λ` | churn = l+ + l− |
| `n` | modifications = number of commits in H that touch the object (a commit counts once per object) |
| `η` | frequency = n / \|H\| |
| `ρ` | churn rate = λ / \|H\| (0 when \|H\| = 0) |
| `n(a)`, `λ(a)` | author-restricted modification count / churn |
| `ω` | ownership = λ(a) / λ |

- **H** = non-merge commits reachable from the selected ref (default `HEAD`).
  `H_t` = committer-date ≥ t; `H_{i,j}` = committer-date in `[i, j)` (the UI's end date is
  inclusive and sent as an exclusive bound).
- Directory metrics are the sums over all descendants; the repository is the root directory.
- Rename detection at 50% similarity: a pure rename changes no metric; a rename + edit is
  attributed to the **new** path; a deletion counts its removed lines on the old path.
- Binary files, empty commits and mode-only changes contribute nothing.

## Architecture

- **Backend** — Python 3 + FastAPI + SQLite.
  - `backend/app/gitutil.py`: single-pass streaming parser over
    `git log --no-merges --numstat -z -M50%` (NUL-separated, handles rename/copy tokens,
    binary `-\t-` rows, quoted paths).
  - `backend/app/ingest.py`: clone/unzip → stream history into SQLite (`commits`, `deltas`,
    `tree_paths`) with progress reporting.
  - `backend/app/metrics.py`: in-process aggregation with a small LRU bundle cache;
    one SQL pass per (repo, filter set), then all views (repo / files / dirs / authors / file /
    commits) are derived from the same aggregate.
  - `backend/data/` holds the SQLite database and cloned repositories (git-ignored).
- **Frontend** — React 18 + TypeScript + Vite, TanStack Query, ECharts.
  - `frontend/src/components/FilterBar.tsx` owns the combinable filters (authors, path scope,
    commit-set mode, time bucket) shared by every tab.
  - The production build (`frontend/dist`) is served by FastAPI directly.

## Running

Requirements: Python ≥ 3.10, Node ≥ 18, `git` on PATH.

```bash
# backend (serves API + built frontend on http://127.0.0.1:8000)
cd backend
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
./.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000

# frontend hot-reload dev server (proxies /api to :8000)
cd frontend
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # emit dist/ for the FastAPI static mount
```

Then open <http://127.0.0.1:8000> (production build) or <http://127.0.0.1:5173> (dev).

### Verifying correctness against raw git

`backend/tests/crosscheck.py` re-derives the metrics with an *independent* line-based numstat
parser and compares them with the API response:

```bash
cd backend
./.venv/bin/python tests/crosscheck.py data/repos/<id>/repo.git <id>
```

## Notes and limitations

- Time filters and bucket labels use **committer** dates, matching the brief's commit-set
  definitions (`H_t`, `H_{i,j}`).
- Merge commits are excluded from H, but the first-parent history is still fully reachable
  through the non-merge graph.
- The clone step needs network access for URL sources; zip sources work fully offline.
- Very large repositories are streamed in batches; ingestion of a ~100k-commit repository
  takes a few minutes on first load and is instant afterwards (SQLite backed).

## AI assistance disclosure

AI assistance (Qoder, an agentic coding assistant) was used during this project: to transcribe
and structure the brief into a task list, to scaffold the boilerplate (FastAPI app skeleton,
Vite + React project files, CSS), and to help draft code that the author reviewed, tested and
corrected. Metric semantics were verified against raw `git` output with an independent
cross-check script (`backend/tests/crosscheck.py`) and synthetic repositories covering renames,
deletions, binary files, empty commits and mode-only changes.
