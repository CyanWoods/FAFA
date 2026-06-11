#!/usr/bin/env python3
"""Quality gate. Usage: python scripts/quality.py [check|fix] [--ci]"""

from __future__ import annotations

import argparse
import ast
import json
import re
import shutil
import sqlite3
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parents[1]


@dataclass
class CheckResult:
    errors: list[str] = field(default_factory=list)
    fixed: list[str] = field(default_factory=list)
    skipped: bool = False
    skip_reason: str = ""

    @property
    def passed(self) -> bool:
        return not self.errors


@dataclass
class _Check:
    name: str
    fn: Callable[..., CheckResult]
    fixable: bool = False
    local_only: bool = False


_CHECKS: list[_Check] = []


def check(name: str, *, fixable: bool = False, local_only: bool = False):
    def decorator(fn: Callable[..., CheckResult]) -> Callable[..., CheckResult]:
        _CHECKS.append(_Check(name=name, fn=fn, fixable=fixable, local_only=local_only))
        return fn
    return decorator


def _skip(reason: str) -> CheckResult:
    return CheckResult(skipped=True, skip_reason=reason)


def _git_tracked() -> list[str]:
    r = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, capture_output=True)
    return [f.decode() for f in r.stdout.split(b"\0") if f]


def _git_diff_cached(path: str = "") -> str:
    cmd = ["git", "diff", "--cached"]
    if path:
        cmd += ["--", path]
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True).stdout


def _python_files() -> list[Path]:
    files: list[Path] = [ROOT / "app.py"]
    for d in (ROOT / "fafa", ROOT / "scripts"):
        if d.exists():
            files.extend(d.rglob("*.py"))
    return sorted({f for f in files if f.exists()})


def _text_files() -> list[Path]:
    suffixes = {".py", ".js", ".css", ".html", ".md", ".sh", ".json", ".yml", ".yaml"}
    skip_parts = {"vendor", "venv", ".git"}
    r = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=ROOT, capture_output=True,
    )
    result = []
    for raw in r.stdout.split(b"\0"):
        if not raw:
            continue
        rel = raw.decode()
        path = ROOT / rel
        if any(s in Path(rel).parts for s in skip_parts):
            continue
        if path.suffix.lower() in suffixes and path.is_file():
            result.append(path)
    return result


def _run_all(*, fix: bool = False, ci: bool = False) -> bool:
    results: list[tuple[str, CheckResult]] = []
    for c in _CHECKS:
        if c.local_only and ci:
            print(f"[SKIP] {c.name}  (CI mode)")
            continue
        r = c.fn(fix=fix) if c.fixable else c.fn()
        results.append((c.name, r))
        if r.skipped:
            print(f"[SKIP] {c.name}  ({r.skip_reason})")
        elif r.passed:
            if r.fixed:
                print(f"[FIXED] {c.name}")
                for item in r.fixed:
                    print(f"        {item}")
            else:
                print(f"[PASS] {c.name}")
        else:
            print(f"[FAIL] {c.name}")
            for e in r.errors:
                print(f"       ERROR: {e}")
    print()
    failed = sum(1 for _, r in results if not r.passed and not r.skipped)
    if failed == 0:
        print("QUALITY GATE PASSED")
        return True
    print(f"QUALITY GATE FAILED — {failed} check(s) failed")
    return False


# ── Phase 1: Repository & Git State ──────────────────────────────────────────

@check("git-sensitive-files")
def _git_sensitive_files() -> CheckResult:
    forbidden = {"config.json", "users.db", "download_state.json", "result.json"}
    errors = []
    for name in _git_tracked():
        p = Path(name)
        if name in forbidden or p.suffix.lower() == ".fit" or name.startswith("input/"):
            errors.append(f"sensitive file tracked by git: {name}")
    return CheckResult(errors=errors)


@check("dockerignore")
def _dockerignore() -> CheckResult:
    di = ROOT / ".dockerignore"
    if not di.exists():
        return CheckResult(errors=[".dockerignore does not exist"])
    content = di.read_text(encoding="utf-8")
    required = ["config.json", "users.db", "input/", "*.fit", "download_state.json", "result.json"]
    errors = [f".dockerignore missing pattern: {p}" for p in required if p not in content]
    return CheckResult(errors=errors)


_SECRET_PATTERNS = [
    re.compile(r'(?i)password\s*=\s*["\'][^"\']{4,}["\']'),
    re.compile(r'(?i)(?:api_?key|secret|private_?key|access_?token)\s*=\s*["\'][^"\']{4,}["\']'),
]
_SECRET_ALLOWLIST = re.compile(r'change.me|placeholder|example|your[-_]|<[^>]+>', re.I)


@check("staged-secrets-scan")
def _staged_secrets_scan() -> CheckResult:
    diff = _git_diff_cached()
    if not diff:
        return CheckResult()
    errors = []
    for i, line in enumerate(diff.splitlines(), 1):
        if not line.startswith("+") or line.startswith("+++"):
            continue
        content = line[1:]
        for pattern in _SECRET_PATTERNS:
            m = pattern.search(content)
            if m and not _SECRET_ALLOWLIST.search(m.group()):
                errors.append(f"potential secret in staged diff (line {i}): {m.group()[:60]}")
    return CheckResult(errors=errors)


def main() -> int:
    parser = argparse.ArgumentParser(description="FAFA quality gate")
    parser.add_argument("mode", choices=("check", "fix"), nargs="?", default="check")
    parser.add_argument("--ci", action="store_true", help="skip local-only checks")
    args = parser.parse_args()
    return 0 if _run_all(fix=(args.mode == "fix"), ci=args.ci) else 1


if __name__ == "__main__":
    raise SystemExit(main())
