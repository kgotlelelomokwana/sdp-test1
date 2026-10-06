"""Git plumbing helpers and a streaming parser for ``git log --numstat``.

The whole metric pipeline is driven by one streaming pass per repository:

    git log --no-merges --numstat -z -M50% --reverse --format=... <ref>

* ``--no-merges``   -> the commit set H-bar only contains non-merge commits.
* ``-M50%``         -> rename detection at 50%; a pure rename produces a 0/0
                       entry (no metric change) and is attributed to the new path.
* ``-z``            -> NUL separated, unquoted paths (safe for any filename).
* ``--numstat``     -> per-file added/removed line counts from git itself.
* binary files appear as ``-\t-`` entries and are dropped (not measured).

With ``-z`` the exact token layout (verified against git 2.43) is:

* a commit header token starting with ``\x01`` (fields joined by ``\x1f``),
* for a modified file one token ``<add>\t<del>\t<path>`` (path may be empty in
  rename entries),
* for a rename/copy a counts token ``<add>\t<del>\t`` (trailing tab, empty
  path) followed by two path tokens (old, then new);
* the first entry of a commit is prefixed with a stray ``\n`` separator.
"""

from __future__ import annotations

import re
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

LOG_FORMAT = "%x01%H%x1f%aN%x1f%aE%x1f%an%x1f%ae%x1f%ct%x1f%s"
_UNIT = b"\x1f"
_COUNTS_WITH_PATH = re.compile(rb"^(\d+|-)\t(\d+|-)\t(.+)$", re.S)
_COUNTS_RENAME = re.compile(rb"^(\d+|-)\t(\d+|-)\t$")
_COUNTS_BARE = re.compile(rb"^(\d+|-)\t(\d+|-)$")


class GitError(RuntimeError):
    """Raised when a git invocation fails or the repository is unusable."""


@dataclass
class CommitHeader:
    sha: str
    name: str        # .mailmap applied
    email: str       # .mailmap applied
    raw_name: str
    raw_email: str
    ts: int          # committer date, unix seconds
    subject: str


def run_git(
    gitdir: str | Path,
    *args: str,
    check: bool = True,
    timeout: int | None = None,
) -> subprocess.CompletedProcess:
    cmd = ["git", "--git-dir", str(gitdir), *args]
    proc = subprocess.run(cmd, capture_output=True, timeout=timeout)
    if check and proc.returncode != 0:
        msg = proc.stderr.decode("utf-8", "replace").strip() or f"git {' '.join(args)} failed"
        raise GitError(msg)
    return proc


def git_text(gitdir: str | Path, *args: str, check: bool = True, timeout: int | None = None) -> str:
    return run_git(gitdir, *args, check=check, timeout=timeout).stdout.decode("utf-8", "replace")


def stream_commits(
    gitdir: str | Path, ref: str = "HEAD"
) -> Iterator[tuple[CommitHeader, list[tuple[str, int, int]]]]:
    """Yield ``(header, [(new_path, added, removed), ...])`` oldest first.

    Only entries with a non-zero line change survive; binaries and pure
    renames are filtered out because they have no measurable line deltas.
    """
    cmd = [
        "git", "--git-dir", str(gitdir),
        "-c", "core.quotepath=false",
        "-c", "log.showSignature=false",
        "log", "--no-merges", "--numstat", "-z", "-M50%", "--reverse",
        f"--format={LOG_FORMAT}", ref,
    ]
    stderr = tempfile.TemporaryFile()
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=stderr)
    try:
        buf = bytearray()
        header: CommitHeader | None = None
        deltas: list[tuple[str, int, int]] = []
        rename: tuple[int, int] | None = None  # pending rename counts (-1 => binary)
        rename_stage = 0
        while True:
            chunk = proc.stdout.read(1 << 16)
            if not chunk:
                break
            buf += chunk
            while True:
                idx = buf.find(0)
                if idx < 0:
                    break
                token = bytes(buf[:idx])
                del buf[: idx + 1]
                if not token:
                    continue
                if token.startswith(b"\n"):
                    # git prefixes the first diff entry of a commit with a separator
                    # newline (format output is NUL terminated under -z).
                    token = token.removeprefix(b"\n")
                    if not token:
                        continue
                if token[:1] == b"\x01":
                    if header is not None:
                        yield header, deltas
                    parts = token[1:].split(_UNIT, 6)
                    if len(parts) < 7:
                        raise GitError("Unexpected git log format output")
                    header = CommitHeader(
                        sha=parts[0].decode("ascii", "replace"),
                        name=parts[1].decode("utf-8", "replace"),
                        email=parts[2].decode("utf-8", "replace"),
                        raw_name=parts[3].decode("utf-8", "replace"),
                        raw_email=parts[4].decode("utf-8", "replace"),
                        ts=int(parts[5]),
                        subject=parts[6].decode("utf-8", "replace"),
                    )
                    deltas = []
                    rename = None
                    rename_stage = 0
                    continue
                if rename is not None:
                    if rename_stage == 0:
                        rename_stage = 1  # old path (unused: metrics follow the new path)
                    else:
                        new_path = token.decode("utf-8", "replace")
                        added, removed = rename
                        if added >= 0 and added + removed > 0:
                            deltas.append((new_path, added, removed))
                        rename = None
                        rename_stage = 0
                    continue
                m = _COUNTS_WITH_PATH.match(token)
                if m:
                    a, r = m.group(1), m.group(2)
                    if a != b"-" and r != b"-":
                        added, removed = int(a), int(r)
                        if added + removed > 0:
                            deltas.append((m.group(3).decode("utf-8", "replace"), added, removed))
                    continue
                m = _COUNTS_RENAME.match(token) or _COUNTS_BARE.match(token)
                if m:
                    a, r = m.group(1), m.group(2)
                    rename = (-1, -1) if (a == b"-" or r == b"-") else (int(a), int(r))
                    rename_stage = 0
                    continue
                # Unknown token: ignore defensively rather than abort the pass.
        if header is not None:
            yield header, deltas
    finally:
        proc.stdout.close()
        rc = proc.wait()
        stderr.seek(0)
        err_text = stderr.read().decode("utf-8", "replace")
        stderr.close()
        if rc != 0:
            raise GitError(err_text.strip() or f"git log exited with status {rc}")
