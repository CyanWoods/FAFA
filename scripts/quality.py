#!/usr/bin/env python3
"""Quality gate. Usage: python scripts/quality.py [check|fix] [--ci]"""

from __future__ import annotations

import argparse
import ast
import datetime
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


# ── Phase 2: Security Invariants ─────────────────────────────────────────────

_SECURITY_MARKERS = (
    "SESSION_COOKIE_HTTPONLY",
    "SESSION_COOKIE_SAMESITE",
    "_resolve_public_api_base",
    "_try_acquire_slot",
    "_validate_filename_in_input",
    "ProxyFix",
)


@check("app-security-invariants")
def _app_security_invariants() -> CheckResult:
    app_text = (ROOT / "app.py").read_text(encoding="utf-8")
    errors = [f"security invariant missing from app.py: {m}" for m in _SECURITY_MARKERS if m not in app_text]
    return CheckResult(errors=errors)


@check("route-auth-decorators")
def _route_auth_decorators() -> CheckResult:
    app_text = (ROOT / "app.py").read_text(encoding="utf-8")
    tree = ast.parse(app_text, filename="app.py")
    errors = []
    protected_prefixes = ("/api/", "/strava/", "/logout")
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        decs = [ast.unparse(d) for d in node.decorator_list]
        routes = [d for d in decs if d.startswith("app.route(")]
        if not routes:
            continue
        protected = any("login_required" in d for d in decs)
        for route in routes:
            if any(p in route for p in protected_prefixes) and not protected:
                errors.append(
                    f"route missing @login_required at app.py:{node.lineno}: {route}"
                )
    return CheckResult(errors=errors)


@check("python-security")
def _python_security() -> CheckResult:
    bandit = shutil.which("bandit")
    if not bandit:
        return _skip("bandit not installed")
    targets = [str(ROOT / "app.py")]
    fafa = ROOT / "fafa"
    if fafa.exists():
        targets.append(str(fafa))
    r = subprocess.run(
        [bandit, "-r", *targets, "-ll", "-q", "--format", "custom",
         "--msg-template", "{relpath}:{line}: {test_id} {msg}"],
        cwd=ROOT, capture_output=True, text=True,
    )
    errors = [line for line in r.stdout.splitlines() if line.strip()]
    return CheckResult(errors=errors)


# ── Phase 3: Config & Dependency Validity ────────────────────────────────────

@check("config-template-json")
def _config_template_json() -> CheckResult:
    path = ROOT / "config.template.json"
    if not path.exists():
        return CheckResult(errors=["config.template.json not found"])
    try:
        json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        return CheckResult(errors=[f"config.template.json invalid: {exc}"])
    return CheckResult()


@check("docker-compose-yaml")
def _docker_compose_yaml() -> CheckResult:
    path = ROOT / "docker-compose.yml"
    if not path.exists():
        return CheckResult(errors=["docker-compose.yml not found"])
    try:
        import importlib.util
        if importlib.util.find_spec("yaml") is None:
            return _skip("PyYAML not installed")
        import yaml  # type: ignore[import-untyped]
        yaml.safe_load(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return CheckResult(errors=[f"docker-compose.yml invalid YAML: {exc}"])
    return CheckResult()


@check("dependency-consistency")
def _dependency_consistency() -> CheckResult:
    r = subprocess.run(
        [sys.executable, "-m", "pip", "check"],
        cwd=ROOT, capture_output=True, text=True,
    )
    if r.returncode:
        errors = [line for line in r.stdout.splitlines() if line.strip()]
        return CheckResult(errors=errors or [r.stdout.strip()])
    return CheckResult()


# ── Phase 4: Code Syntax ──────────────────────────────────────────────────────

@check("python-compile")
def _python_compile() -> CheckResult:
    errors = []
    for path in _python_files():
        try:
            compile(path.read_text(encoding="utf-8"), str(path), "exec")
        except (SyntaxError, UnicodeError) as exc:
            errors.append(f"{path.relative_to(ROOT)}: {exc}")
    return CheckResult(errors=errors)


@check("js-syntax")
def _js_syntax() -> CheckResult:
    node = shutil.which("node")
    if not node:
        return _skip("node not installed")
    target = ROOT / "static" / "app.js"
    if not target.exists():
        return CheckResult(errors=["static/app.js not found"])
    r = subprocess.run([node, "--check", str(target)], cwd=ROOT, capture_output=True, text=True)
    if r.returncode:
        return CheckResult(errors=[r.stderr.strip() or "JS syntax error"])
    return CheckResult()


@check("shell-syntax")
def _shell_syntax() -> CheckResult:
    bash = shutil.which("bash")
    if not bash:
        return _skip("bash not installed")
    errors = []
    for sh in sorted(ROOT.glob("**/*.sh")):
        parts = sh.relative_to(ROOT).parts
        if any(s in parts for s in ("vendor", "venv", ".git")):
            continue
        r = subprocess.run([bash, "-n", str(sh)], cwd=ROOT, capture_output=True, text=True)
        if r.returncode:
            errors.append(f"{sh.relative_to(ROOT)}: {r.stderr.strip()}")
    return CheckResult(errors=errors)


@check("dockerfile-lint")
def _dockerfile_lint() -> CheckResult:
    hadolint = shutil.which("hadolint")
    if not hadolint:
        return _skip("hadolint not installed")
    dockerfile = ROOT / "Dockerfile"
    if not dockerfile.exists():
        return CheckResult(errors=["Dockerfile not found"])
    r = subprocess.run([hadolint, str(dockerfile)], cwd=ROOT, capture_output=True, text=True)
    if r.returncode:
        errors = [line for line in r.stdout.splitlines() if line.strip()]
        return CheckResult(errors=errors or [r.stdout.strip()])
    return CheckResult()


# ── Phase 5: Frontend Assets ──────────────────────────────────────────────────

_VENDOR_ASSETS = (
    "static/vendor/leaflet/leaflet.js",
    "static/vendor/leaflet/leaflet.css",
    "static/vendor/marked/marked.min.js",
    "static/vendor/dompurify/purify.min.js",
)

_CDN_PREFIXES = ("https://cdn", "http://cdn", "//cdn")


@check("no-cdn-scripts")
def _no_cdn_scripts() -> CheckResult:
    index = ROOT / "templates" / "index.html"
    if not index.exists():
        return CheckResult(errors=["templates/index.html not found"])
    text = index.read_text(encoding="utf-8")
    errors = [f"CDN reference in index.html: {p}" for p in _CDN_PREFIXES if p in text]
    return CheckResult(errors=errors)


@check("vendor-assets")
def _vendor_assets() -> CheckResult:
    errors = [f"missing vendor asset: {a}" for a in _VENDOR_ASSETS if not (ROOT / a).is_file()]
    return CheckResult(errors=errors)


_CSS_COLOR_RE = re.compile(r':\s*[^;{]*#[0-9a-fA-F]{3,8}\b')
_CSS_RADIUS_RE = re.compile(r'border-radius\s*:[^;]*[\d.]+px')
_CSS_FONTSIZE_RE = re.compile(r'font-size\s*:[^;]*[\d.]+(?:px|rem|em)')
_CSS_TRANSITION_RE = re.compile(r'transition[^;]*[\d.]+(?:ms|s)')


@check("css-token-enforcement")
def _css_token_enforcement() -> CheckResult:
    diff = _git_diff_cached("static/style.css")
    if not diff:
        return CheckResult()
    errors = []
    for line in diff.splitlines():
        if not line.startswith("+") or line.startswith("+++"):
            continue
        content = line[1:].strip()
        if not content or content.startswith(("/*", "//")):
            continue
        if content.startswith("--"):
            continue
        if _CSS_COLOR_RE.search(content) and "var(--" not in content:
            errors.append(f"hardcoded color in staged CSS: {content[:80]}")
        elif _CSS_RADIUS_RE.search(content) and "var(--" not in content:
            errors.append(f"hardcoded border-radius in staged CSS: {content[:80]}")
        elif _CSS_FONTSIZE_RE.search(content) and "var(--" not in content:
            errors.append(f"hardcoded font-size in staged CSS: {content[:80]}")
        elif _CSS_TRANSITION_RE.search(content) and "var(--" not in content:
            errors.append(f"hardcoded transition duration in staged CSS: {content[:80]}")
    return CheckResult(errors=errors)


_JS_STYLE_COLOR_RE = re.compile(
    r'\.style\.(?:color|backgroundColor|borderColor)\s*=\s*["\'](?:#[0-9a-fA-F]{3,8}|rgb|hsl)'
)
_JS_SETATTR_COLOR_RE = re.compile(
    r'setAttribute\s*\(\s*["\']style["\'][^)]*#[0-9a-fA-F]{3,8}'
)
_JS_TEMPLATE_COLOR_RE = re.compile(
    r'`[^`]*style[^`]*#[0-9a-fA-F]{3,8}[^`]*`'
)


@check("js-inline-style-tokens")
def _js_inline_style_tokens() -> CheckResult:
    diff = _git_diff_cached("static/app.js")
    if not diff:
        return CheckResult()
    errors = []
    for line in diff.splitlines():
        if not line.startswith("+") or line.startswith("+++"):
            continue
        content = line[1:]
        if _JS_STYLE_COLOR_RE.search(content):
            errors.append(f"hardcoded color in JS .style assignment: {content.strip()[:80]}")
        elif _JS_SETATTR_COLOR_RE.search(content):
            errors.append(f"hardcoded color in setAttribute style: {content.strip()[:80]}")
        elif _JS_TEMPLATE_COLOR_RE.search(content):
            errors.append(f"hardcoded color in template literal style: {content.strip()[:80]}")
    return CheckResult(errors=errors)


# ── Phase 6: Formatting ───────────────────────────────────────────────────────

@check("whitespace")
def _whitespace() -> CheckResult:
    r = subprocess.run(
        ["git", "diff", "--check"],
        cwd=ROOT, capture_output=True, text=True,
    )
    if r.returncode:
        errors = [line for line in r.stdout.splitlines() if line.strip()]
        return CheckResult(errors=errors or ["whitespace errors detected"])
    return CheckResult()


@check("trailing-whitespace", fixable=True)
def _trailing_whitespace(*, fix: bool = False) -> CheckResult:
    result = CheckResult()
    for path in _text_files():
        try:
            original = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        cleaned = "\n".join(line.rstrip() for line in original.splitlines()) + "\n"
        if cleaned != original:
            if fix:
                path.write_text(cleaned, encoding="utf-8")
                result.fixed.append(str(path.relative_to(ROOT)))
            else:
                result.errors.append(f"trailing whitespace: {path.relative_to(ROOT)}")
    return result


# ── Phase 7: Local Runtime ────────────────────────────────────────────────────

@check("file-permissions", fixable=True, local_only=True)
def _file_permissions(*, fix: bool = False) -> CheckResult:
    result = CheckResult()
    for d in ROOT.glob("input/*"):
        if not d.is_dir() or d.name == ".cache":
            continue
        mode = d.stat().st_mode & 0o777
        if mode & 0o077:
            if fix:
                d.chmod(0o700)
                result.fixed.append(f"chmod 700 {d.relative_to(ROOT)}")
            else:
                result.errors.append(f"directory too permissive: {d.relative_to(ROOT)} ({mode:o})")
    db_paths = [ROOT / "users.db", *ROOT.glob("input/*/fafa.db")]
    json_paths = [
        ROOT / "config.json", ROOT / "download_state.json",
        *(p for p in ROOT.glob("input/*/*.json") if p.parent.name != ".cache"),
    ]
    sidecars = [*ROOT.glob("*.db-wal"), *ROOT.glob("*.db-shm"),
                *ROOT.glob("input/*/*.db-wal"), *ROOT.glob("input/*/*.db-shm")]
    for path in [*db_paths, *json_paths, *sidecars]:
        if not path.is_file():
            continue
        mode = path.stat().st_mode & 0o777
        if mode & 0o077:
            if fix:
                path.chmod(0o600)
                result.fixed.append(f"chmod 600 {path.relative_to(ROOT)}")
            else:
                result.errors.append(
                    f"file too permissive: {path.relative_to(ROOT)} ({mode:o})"
                )
    return result


@check("sqlite-integrity", local_only=True)
def _sqlite_integrity() -> CheckResult:
    errors = []
    for db_path in [ROOT / "users.db", *ROOT.glob("input/*/fafa.db")]:
        if not db_path.is_file():
            continue
        try:
            with sqlite3.connect(str(db_path)) as conn:
                ok = conn.execute("PRAGMA integrity_check").fetchone()[0]
            if ok != "ok":
                errors.append(f"SQLite integrity failure: {db_path.relative_to(ROOT)}: {ok}")
        except Exception as exc:
            errors.append(f"SQLite error: {db_path.relative_to(ROOT)}: {exc}")
    return CheckResult(errors=errors)


# ── Phase 8: Cleanup ──────────────────────────────────────────────────────────

@check("pycache-cleanup", fixable=True)
def _pycache_cleanup(*, fix: bool = False) -> CheckResult:
    result = CheckResult()
    skip_parts = {"vendor", "venv", ".git"}
    for cache in ROOT.rglob("__pycache__"):
        if any(s in cache.parts for s in skip_parts):
            continue
        if fix:
            shutil.rmtree(cache)
            result.fixed.append(str(cache.relative_to(ROOT)))
        else:
            result.errors.append(f"stale __pycache__: {cache.relative_to(ROOT)}")
    return result


@check("version-date")
def _version_date() -> CheckResult:
    vf = ROOT / "version"
    if not vf.exists():
        return CheckResult(errors=["version file missing"])
    content = vf.read_text().strip()
    m = re.fullmatch(r'v(\d{4})\.(\d{2})\.(\d{2})', content)
    if not m:
        return CheckResult(errors=[f"version format invalid (expected vYYYY.MM.DD): {content!r}"])
    version_date = f"{m.group(1)}.{m.group(2)}.{m.group(3)}"
    r = subprocess.run(
        ["git", "log", "-1", "--format=%cd", "--date=format:%Y.%m.%d"],
        cwd=ROOT, capture_output=True, text=True,
    )
    if r.returncode != 0 or not r.stdout.strip():
        return _skip("git log unavailable")
    commit_date = r.stdout.strip()
    if version_date != commit_date:
        return CheckResult(errors=[
            f"version date {version_date!r} != last commit date {commit_date!r}; "
            f"update version file to v{commit_date}"
        ])
    return CheckResult()


def main() -> int:
    parser = argparse.ArgumentParser(description="FAFA quality gate")
    parser.add_argument("mode", choices=("check", "fix"), nargs="?", default="check")
    parser.add_argument("--ci", action="store_true", help="skip local-only checks")
    args = parser.parse_args()
    return 0 if _run_all(fix=(args.mode == "fix"), ci=args.ci) else 1


if __name__ == "__main__":
    raise SystemExit(main())
