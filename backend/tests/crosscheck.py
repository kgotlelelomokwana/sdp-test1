#!/usr/bin/env python3
"""Independent cross-check of RAT metric correctness against raw git output.

Usage:  python tests/crosscheck.py <gitdir> [repo_id] [api_base]

This deliberately does NOT reuse ``app.gitutil``: it parses the line based
``git log --numstat`` output (a different code path from the NUL separated
streaming parser used by the app) and re-derives repository / file / author
totals from it.  The derived numbers are then compared with what the API
reports for the same commit set.
"""

from __future__ import annotations

import json
import subprocess
import sys
import urllib.request

GREEN = "\033[92m"
RED = "\033[91m"
END = "\033[0m"


def git(gitdir: str, *args: str) -> str:
    proc = subprocess.run(
        ["git", "--git-dir", gitdir, "-c", "core.quotepath=false", *args],
        capture_output=True,
    )
    if proc.returncode != 0:
        raise SystemExit(proc.stderr.decode("utf-8", "replace"))
    return proc.stdout.decode("utf-8", "replace")


def api(base: str, path: str):
    with urllib.request.urlopen(f"{base}{path}", timeout=600) as response:
        return json.load(response)


def resolve_rename(path: str) -> str:
    if " => " not in path:
        return path
    if "{" in path and "}" in path:
        pre = path[: path.index("{")]
        mid = path[path.index("{") + 1 : path.index("}")]
        post = path[path.index("}") + 1 :]
        # The new name may be empty (``dir/{old => }/file``), in which case the
        # naive join creates a ``//`` that git never emits.
        return (pre + mid.split(" => ")[1] + post).replace("//", "/")
    return path.split(" => ")[1]


def main() -> int:
    gitdir = sys.argv[1]
    repo_id = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    base = sys.argv[3] if len(sys.argv) > 3 else "http://127.0.0.1:8000"

    raw = git(gitdir, "log", "--no-merges", "--numstat", "-M50%", "--format=%x01%H%x1f%ae%x1f%ct")
    commits = 0
    commits_with_changes = 0
    total_added = 0
    total_removed = 0
    file_churn: dict[str, int] = {}
    file_added: dict[str, int] = {}
    file_mods: dict[str, int] = {}
    child_churn: dict[str, int] = {}
    child_mods: dict[str, int] = {}
    author_churn: dict[str, int] = {}
    commit_rows: list[tuple[str, str, int, int, int]] = []
    current_sha = ""
    current_author = None
    current_ts = 0
    commit_added = 0
    commit_removed = 0
    has_changes = False
    commit_files: dict[str, int] = {}

    def close_commit() -> None:
        nonlocal commits_with_changes
        if current_sha and has_changes:
            commits_with_changes += 1
        if current_sha:
            commit_rows.append((current_sha, current_author or "", current_ts, commit_added, commit_removed))
            for path, churn in commit_files.items():
                file_mods[path] = file_mods.get(path, 0) + 1
            touched_children: set[str] = set()
            for path, churn in commit_files.items():
                child = path.split("/")[0] if "/" in path else path
                child_churn[child] = child_churn.get(child, 0) + churn
                touched_children.add(child)
            for child in touched_children:
                child_mods[child] = child_mods.get(child, 0) + 1

    for line in raw.splitlines():
        if line.startswith("\x01"):
            close_commit()
            commits += 1
            sha, current_author, ts = line[1:].split("\x1f")
            current_sha = sha
            current_ts = int(ts)
            commit_added = 0
            commit_removed = 0
            commit_files = {}
            has_changes = False
            continue
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) != 3:
            continue
        added, removed, path = parts
        if added == "-" or removed == "-":
            continue
        added_i, removed_i = int(added), int(removed)
        if added_i + removed_i == 0:
            continue
        has_changes = True
        path = resolve_rename(path)
        total_added += added_i
        total_removed += removed_i
        commit_added += added_i
        commit_removed += removed_i
        commit_files[path] = commit_files.get(path, 0) + added_i + removed_i
        file_added[path] = file_added.get(path, 0) + added_i
        file_churn[path] = file_churn.get(path, 0) + added_i + removed_i
        author_churn[current_author] = author_churn.get(current_author, 0) + added_i + removed_i
    close_commit()

    repo = api(base, f"/api/repos/{repo_id}/metrics?level=repo")
    kpi = repo["kpi"]
    files = api(
        base,
        f"/api/repos/{repo_id}/metrics?level=files&sort=churn&order=desc&limit=10&include_idle=false",
    )
    authors = api(base, f"/api/repos/{repo_id}/metrics?level=authors")

    checks: list[tuple[str, object, object]] = [
        ("commits (|H|)", commits, kpi["commits"]),
        ("added", total_added, kpi["added"]),
        ("removed", total_removed, kpi["removed"]),
        ("churn", total_added + total_removed, kpi["churn"]),
        ("mods (commits with changes)", commits_with_changes, kpi["mods"]),
        ("files touched", len(file_added), kpi["files_touched"]),
        ("author churn total", sum(author_churn.values()), sum(r["churn"] for r in authors["rows"])),
    ]

    expected_top = sorted(file_churn.items(), key=lambda kv: (-kv[1], kv[0]))[:10]
    actual_top = [(row["path"], row["churn"]) for row in files["rows"]]
    checks.append(("top-10 files by churn", expected_top, actual_top))
    expected_top_mods = [
        (path, churn, file_mods.get(path, 0))
        for path, churn in sorted(file_churn.items(), key=lambda kv: (-kv[1], kv[0]))[:10]
    ]
    actual_top_mods = [(row["path"], row["churn"], row["mods"]) for row in files["rows"]]
    checks.append(("top-10 files churn+mods", expected_top_mods, actual_top_mods))

    # directory roll-up: the immediate children of the repository root must add
    # up to the repository metric itself (directories telescope by definition).
    dirs = api(base, f"/api/repos/{repo_id}/metrics?level=dirs&path=&limit=5000")
    checks.append(
        (
            "root children churn == repo churn",
            kpi["churn"],
            sum(row["churn"] for row in dirs["rows"]),
        )
    )
    # idle children (present in the analysed tree but never touched) carry zero
    # metrics, so add them to the expectation set with zeros before comparing.
    api_mods = {row["path"]: row["mods"] for row in dirs["rows"]}
    expected_mods = dict(child_mods)
    for path in api_mods:
        expected_mods.setdefault(path, 0)
    checks.append(
        (
            "root children mods == expected",
            sorted(expected_mods.items()),
            sorted(api_mods.items()),
        )
    )
    api_churn = {row["path"]: row["churn"] for row in dirs["rows"]}
    expected_churn = dict(child_churn)
    for path in api_churn:
        expected_churn.setdefault(path, 0)
    checks.append(
        (
            "root children churn per child",
            sorted(expected_churn.items()),
            sorted(api_churn.items()),
        )
    )

    # time window  [i, j) over committer dates
    rows_sorted = sorted(commit_rows, key=lambda row: row[2])
    if len(rows_sorted) > 10:
        i_ts = rows_sorted[len(rows_sorted) // 3][2]
        j_ts = rows_sorted[2 * len(rows_sorted) // 3][2]
        window = [row for row in commit_rows if i_ts <= row[2] < j_ts]
        window_metrics = api(
            base, f"/api/repos/{repo_id}/metrics?level=repo&from_ts={i_ts}&to_ts={j_ts}"
        )["kpi"]
        checks.append(("time window |H|", len(window), window_metrics["commits"]))
        checks.append(
            ("time window churn", sum(r[3] + r[4] for r in window), window_metrics["churn"])
        )

    # manual commit selection
    manual = [row[0] for row in rows_sorted[-5:]]
    manual_stats = api(
        base, f"/api/repos/{repo_id}/metrics?level=repo&shas={','.join(manual)}"
    )["kpi"]
    manual_rows = [row for row in commit_rows if row[0] in set(manual)]
    checks.append(("manual selection |H|", 5, manual_stats["commits"]))
    checks.append(
        (
            "manual selection churn",
            sum(r[3] + r[4] for r in manual_rows),
            manual_stats["churn"],
        )
    )

    # author filter (top author by churn)
    if author_churn:
        top_author = max(author_churn.items(), key=lambda kv: kv[1])[0]
        author_stats = api(
            base, f"/api/repos/{repo_id}/metrics?level=repo&authors={top_author}"
        )["kpi"]
        authored = [row for row in commit_rows if row[1] == top_author]
        checks.append(
            ("author filter churn", sum(r[3] + r[4] for r in authored), author_stats["churn"])
        )
        checks.append(("author filter |H|", len(authored), author_stats["commits"]))

    failures = 0
    for name, expected, actual in checks:
        if expected == actual:
            print(f"{GREEN}PASS{END} {name}")
        else:
            failures += 1
            print(f"{RED}FAIL{END} {name}")
            print(f"     expected: {expected}")
            print(f"     actual:   {actual}")
    print(f"\n{'All checks passed.' if not failures else f'{failures} check(s) failed.'}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
