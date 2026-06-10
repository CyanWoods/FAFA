#!/usr/bin/env python3
"""Repository quality gate with check, safe auto-fix, and watch modes."""

from __future__ import annotations

import argparse
import ast
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIRS = (ROOT / "fafa", ROOT / "tests", ROOT / "scripts")
SOURCE_FILES = (ROOT / "app.py",)
TEXT_SUFFIXES = {".py", ".js", ".css", ".html", ".md", ".sh", ".json", ".yml", ".yaml"}
WATCH_PATHS = SOURCE_DIRS + SOURCE_FILES + (
    ROOT / "static" / "app.js",
    ROOT / "static" / "style.css",
    ROOT / "templates",
    ROOT / "start.sh",
    ROOT / "Makefile",
    ROOT / "README.md",
    ROOT / "config.template.json",
    ROOT / "requirements.txt",
    ROOT / ".github",
)


def _run(label: str, command: list[str]) -> bool:
    print(f"\n== {label} ==", flush=True)
    env = os.environ.copy()
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["PIP_CACHE_DIR"] = "/tmp/fafa-pip-cache"
    result = subprocess.run(command, cwd=ROOT, check=False, env=env)
    if result.returncode:
        print(f"FAILED: {label} (exit {result.returncode})")
        return False
    return True


def _python_files() -> list[Path]:
    files = [path for path in SOURCE_FILES if path.exists()]
    for directory in SOURCE_DIRS:
        if directory.exists():
            files.extend(directory.rglob("*.py"))
    return sorted(set(files))


def _tracked_files() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files", "-z"], cwd=ROOT, check=False, capture_output=True
    )
    if result.returncode:
        return []
    return [item.decode() for item in result.stdout.split(b"\0") if item]


def _source_candidates() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=ROOT,
        check=False,
        capture_output=True,
    )
    if result.returncode:
        return []
    return [item.decode() for item in result.stdout.split(b"\0") if item]


def repository_guard() -> bool:
    print("\n== Repository security guard ==", flush=True)
    errors: list[str] = []
    forbidden_exact = {"config.json", "users.db", "download_state.json", "result.json"}
    for name in _tracked_files():
        path = Path(name)
        if name in forbidden_exact or path.suffix.lower() == ".fit" or name.startswith("input/"):
            errors.append(f"sensitive runtime file is tracked: {name}")

    app_text = (ROOT / "app.py").read_text(encoding="utf-8")
    required = (
        "SESSION_COOKIE_HTTPONLY",
        "SESSION_COOKIE_SAMESITE",
        "_resolve_public_api_base",
        "_try_acquire_slot",
        "_validate_filename_in_input",
        "ProxyFix",
    )
    for marker in required:
        if marker not in app_text:
            errors.append(f"security invariant missing from app.py: {marker}")

    tree = ast.parse(app_text, filename="app.py")
    for node in tree.body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        decorators = [ast.unparse(item) for item in node.decorator_list]
        routes = [item for item in decorators if item.startswith('app.route(')]
        protected = any('login_required' in item for item in decorators)
        for route in routes:
            if ('/api/' in route or '/strava/' in route or '/logout' in route) and not protected:
                errors.append(f"state/user route lacks login_required at app.py:{node.lineno}: {route}")

    index_text = (ROOT / "templates" / "index.html").read_text(encoding="utf-8")
    for prefix in ("https://cdn", "http://cdn", "//cdn"):
        if prefix in index_text:
            errors.append(f"remote executable dependency found in index.html: {prefix}")
    for asset in (
        "static/vendor/leaflet/leaflet.js",
        "static/vendor/leaflet/leaflet.css",
        "static/vendor/marked/marked.min.js",
        "static/vendor/dompurify/purify.min.js",
    ):
        if not (ROOT / asset).is_file():
            errors.append(f"required local vendor asset is missing: {asset}")

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return False
    print("Repository guard passed")
    return True


def runtime_data_guard(fix_permissions: bool = False) -> bool:
    print("\n== Runtime data guard ==", flush=True)
    errors: list[str] = []
    fixed: list[str] = []
    database_paths = [ROOT / "users.db", *ROOT.glob("input/*/fafa.db")]
    sqlite_sidecars = [
        *ROOT.glob("*.db-wal"), *ROOT.glob("*.db-shm"),
        *ROOT.glob("input/*/*.db-wal"), *ROOT.glob("input/*/*.db-shm"),
    ]
    json_paths = [
        ROOT / "config.json",
        ROOT / "download_state.json",
        *(path for path in ROOT.glob("input/*/*.json") if path.parent.name != ".cache"),
    ]
    private_dirs = [path for path in ROOT.glob("input/*") if path.name != ".cache"]

    for path in private_dirs:
        if not path.is_dir():
            continue
        mode = path.stat().st_mode & 0o777
        if mode & 0o077:
            if fix_permissions:
                path.chmod(0o700)
                fixed.append(f"chmod 700 {path.relative_to(ROOT)}")
            else:
                errors.append(f"private directory permissions are too broad: {path.relative_to(ROOT)} ({mode:o})")

    for path in database_paths:
        if not path.is_file():
            continue
        try:
            with sqlite3.connect(path) as conn:
                result = conn.execute("PRAGMA integrity_check").fetchone()[0]
            if result != "ok":
                errors.append(f"SQLite integrity failure: {path.relative_to(ROOT)}: {result}")
        except sqlite3.Error as exc:
            errors.append(f"SQLite read failure: {path.relative_to(ROOT)}: {exc}")
        mode = path.stat().st_mode & 0o777
        if mode & 0o077:
            if fix_permissions:
                path.chmod(0o600)
                fixed.append(f"chmod 600 {path.relative_to(ROOT)}")
            else:
                errors.append(f"database permissions are too broad: {path.relative_to(ROOT)} ({mode:o})")

    for path in sqlite_sidecars:
        if not path.is_file():
            continue
        mode = path.stat().st_mode & 0o777
        if mode & 0o077:
            if fix_permissions:
                path.chmod(0o600)
                fixed.append(f"chmod 600 {path.relative_to(ROOT)}")
            else:
                errors.append(f"SQLite sidecar permissions are too broad: {path.relative_to(ROOT)} ({mode:o})")

    for path in json_paths:
        if not path.is_file():
            continue
        try:
            json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            errors.append(f"invalid runtime JSON: {path.relative_to(ROOT)}: {exc}")
        mode = path.stat().st_mode & 0o777
        if mode & 0o077:
            if fix_permissions:
                path.chmod(0o600)
                fixed.append(f"chmod 600 {path.relative_to(ROOT)}")
            else:
                errors.append(f"runtime JSON permissions are too broad: {path.relative_to(ROOT)} ({mode:o})")

    for item in fixed:
        print(f"FIXED: {item}")
    for error in errors:
        print(f"ERROR: {error}")
    if not errors:
        print("Runtime data guard passed")
    return not errors


def check() -> bool:
    ok = repository_guard()
    ok = runtime_data_guard() and ok
    print("\n== Python compile ==", flush=True)
    compile_ok = True
    for path in _python_files():
        try:
            compile(path.read_text(encoding="utf-8"), str(path), "exec")
        except (SyntaxError, UnicodeError) as exc:
            print(f"ERROR: {path.relative_to(ROOT)}: {exc}")
            compile_ok = False
    ok = compile_ok and ok
    if not compile_ok:
        print("FAILED: Python compile")

    ok = _run("Dependency consistency", [sys.executable, "-m", "pip", "check"]) and ok

    node = shutil.which("node")
    if node:
        ok = _run("JavaScript syntax", [node, "--check", "static/app.js"]) and ok
    else:
        print("\nSKIP: JavaScript syntax (node not installed)")

    shell = shutil.which("bash") or shutil.which("sh")
    if shell:
        ok = _run("Shell syntax", [shell, "-n", "start.sh"]) and ok

    if (ROOT / ".git").exists():
        ok = _run("Patch whitespace", ["git", "diff", "--check"]) and ok

    print("\nQUALITY GATE PASSED" if ok else "\nQUALITY GATE FAILED")
    return ok


def _iter_text_files():
    allowed_roots = {"app.py", "fafa", "tests", "scripts", "static", "templates", ".github", "README.md", "start.sh"}
    for relative in _source_candidates():
        path = ROOT / relative
        if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        if Path(relative).parts[0] not in allowed_roots or relative.startswith("static/vendor/"):
            continue
        yield path


def fix() -> bool:
    changed = 0
    for path in _iter_text_files():
        try:
            original = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        lines = original.splitlines()
        updated = "\n".join(line.rstrip() for line in lines) + "\n"
        if updated != original:
            path.write_text(updated, encoding="utf-8")
            changed += 1

    removed = 0
    cache_roots = (ROOT / "fafa", ROOT / "tests", ROOT / "scripts", ROOT)
    cache_paths = {ROOT / "__pycache__"}
    for base in cache_roots[:-1]:
        if base.exists():
            cache_paths.update(base.rglob("__pycache__"))
    for cache in cache_paths:
        if cache.exists() and cache.is_dir():
            shutil.rmtree(cache)
            removed += 1

    print(f"Applied safe fixes to {changed} text file(s); removed {removed} cache directory(s)")
    runtime_data_guard(fix_permissions=True)
    return check()


def _snapshot() -> dict[str, tuple[int, int]]:
    state = {}
    for base in WATCH_PATHS:
        paths = base.rglob("*") if base.is_dir() else (base,)
        for path in paths:
            if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
                continue
            try:
                stat = path.stat()
            except OSError:
                continue
            state[str(path)] = (stat.st_mtime_ns, stat.st_size)
    return state


def watch(interval: float) -> int:
    print(f"Watching repository every {interval:g}s. Press Ctrl-C to stop.")
    fix()
    previous = _snapshot()
    try:
        while True:
            time.sleep(interval)
            current = _snapshot()
            if current != previous:
                time.sleep(0.25)
                print("\nChange detected; applying safe fixes and rerunning checks...")
                fix()
                current = _snapshot()
            previous = current
    except KeyboardInterrupt:
        print("\nWatcher stopped")
        return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("check", "fix", "watch"), nargs="?", default="check")
    parser.add_argument("--interval", type=float, default=2.0)
    args = parser.parse_args()
    if args.mode == "watch":
        return watch(max(0.5, args.interval))
    passed = fix() if args.mode == "fix" else check()
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
