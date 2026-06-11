# Quality Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重建质量门禁：22项检查注册表 + pre-commit hook + Gitea CI，无 Makefile，根目录保持整洁。

**Architecture:** `scripts/quality.py` 用 `@check` 装饰器注册22项检查，主循环统一遍历输出 `[PASS]/[FAIL]/[SKIP]/[FIXED]`。本地通过 `scripts/install-hooks.sh` 安装 pre-commit hook，CI 用 `.gitea/workflows/quality.yml`。

**Tech Stack:** Python 3.12 stdlib（ast, sqlite3, subprocess, re, json, shutil）；可选外部工具 node / hadolint / bandit（不存在则 SKIP）。

---

## Task 1: 修复 `.dockerignore`

**Files:**
- Modify: `.dockerignore`

- [ ] **Step 1: 添加 `*.fit` 排除规则**

在 `.dockerignore` 结尾追加：

```
*.fit
```

- [ ] **Step 2: 验证**

```bash
grep "fit" .dockerignore
```

Expected: `*.fit`

- [ ] **Step 3: Commit**

```bash
git add .dockerignore
git commit -m "Fix# .dockerignore - 补充 *.fit 排除规则"
```

---

## Task 2: 创建 `scripts/quality.py` 框架

**Files:**
- Create: `scripts/quality.py`

- [ ] **Step 1: 创建脚本骨架**

```python
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


def main() -> int:
    parser = argparse.ArgumentParser(description="FAFA quality gate")
    parser.add_argument("mode", choices=("check", "fix"), nargs="?", default="check")
    parser.add_argument("--ci", action="store_true", help="skip local-only checks")
    args = parser.parse_args()
    return 0 if _run_all(fix=(args.mode == "fix"), ci=args.ci) else 1


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: 验证框架可运行（零检查时应直接 PASS）**

```bash
python scripts/quality.py check
```

Expected:
```
QUALITY GATE PASSED
```

- [ ] **Step 3: Commit**

```bash
git add scripts/quality.py
git commit -m "New# scripts/quality.py - 质量门禁注册表框架"
```

---

## Task 3: Phase 1 — 仓库与 Git 状态检查

**Files:**
- Modify: `scripts/quality.py`（在 `main()` 定义之前追加3个检查函数）

- [ ] **Step 1: 追加 Phase 1 检查函数**

在 `scripts/quality.py` 的 `def main()` 之前插入：

```python
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
```

- [ ] **Step 2: 验证**

```bash
python scripts/quality.py check
```

Expected: `[PASS]` 出现3次（git-sensitive-files / dockerignore / staged-secrets-scan），最终 `QUALITY GATE PASSED`。

- [ ] **Step 3: Commit**

```bash
git add scripts/quality.py
git commit -m "Add# scripts/quality.py - Phase 1 仓库与 Git 状态检查"
```

---

## Task 4: Phase 2 — 安全不变量检查

**Files:**
- Modify: `scripts/quality.py`

- [ ] **Step 1: 追加 Phase 2 检查函数**

```python
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
```

- [ ] **Step 2: 验证**

```bash
python scripts/quality.py check
```

Expected: Phase 1+2 全部 `[PASS]`（bandit 若未安装则 `[SKIP]`）。

- [ ] **Step 3: Commit**

```bash
git add scripts/quality.py
git commit -m "Add# scripts/quality.py - Phase 2 安全不变量检查"
```

---

## Task 5: Phase 3 — 配置与依赖合法性检查

**Files:**
- Modify: `scripts/quality.py`

- [ ] **Step 1: 追加 Phase 3 检查函数**

```python
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
```

- [ ] **Step 2: 验证**

```bash
python scripts/quality.py check
```

Expected: 前6项全 `[PASS]`（或 `[SKIP]`）。

- [ ] **Step 3: Commit**

```bash
git add scripts/quality.py
git commit -m "Add# scripts/quality.py - Phase 3 配置与依赖合法性检查"
```

---

## Task 6: Phase 4 — 代码语法检查

**Files:**
- Modify: `scripts/quality.py`

- [ ] **Step 1: 追加 Phase 4 检查函数**

```python
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
```

- [ ] **Step 2: 验证**

```bash
python scripts/quality.py check
```

Expected: 前10项全 `[PASS]`（或 `[SKIP]`）。

- [ ] **Step 3: Commit**

```bash
git add scripts/quality.py
git commit -m "Add# scripts/quality.py - Phase 4 代码语法检查"
```

---

## Task 7: Phase 5 — 前端资产检查

**Files:**
- Modify: `scripts/quality.py`

- [ ] **Step 1: 追加 Phase 5 检查函数**

```python
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
        # Skip token definitions inside :root
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
```

- [ ] **Step 2: 验证**

```bash
python scripts/quality.py check
```

Expected: 前14项全 `[PASS]`（或 `[SKIP]`）。

- [ ] **Step 3: Commit**

```bash
git add scripts/quality.py
git commit -m "Add# scripts/quality.py - Phase 5 前端资产与样式 token 检查"
```

---

## Task 8: Phase 6-8 — 格式、运行时、清理检查

**Files:**
- Modify: `scripts/quality.py`

- [ ] **Step 1: 追加 Phase 6-8 检查函数**

```python
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
```

- [ ] **Step 2: 验证完整运行**

```bash
python scripts/quality.py check
```

Expected: 所有22项全出现（`[PASS]`/`[SKIP]`），最终 `QUALITY GATE PASSED`。

```bash
python scripts/quality.py fix
```

Expected: fixable 项显示 `[FIXED]`（若有需修复内容），最终 `QUALITY GATE PASSED`。

```bash
python scripts/quality.py check --ci
```

Expected: `file-permissions` 和 `sqlite-integrity` 显示 `[SKIP] (CI mode)`。

- [ ] **Step 3: Commit**

```bash
git add scripts/quality.py
git commit -m "Add# scripts/quality.py - Phase 6-8 格式、运行时、清理检查"
```

---

## Task 9: 创建 `scripts/install-hooks.sh` 和 Gitea CI

**Files:**
- Create: `scripts/install-hooks.sh`
- Create: `.gitea/workflows/quality.yml`

- [ ] **Step 1: 创建 `scripts/install-hooks.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOK="$REPO_ROOT/.git/hooks/pre-commit"

cat > "$HOOK" << 'EOF'
#!/usr/bin/env bash
set -e
python scripts/quality.py check
EOF

chmod +x "$HOOK"
echo "Pre-commit hook installed at $HOOK"
```

- [ ] **Step 2: 创建 `.gitea/workflows/quality.yml`**

```yaml
name: Quality Gate

on: [push, pull_request]

permissions:
  contents: read

jobs:
  quality:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
          cache: pip

      - uses: actions/setup-node@v4
        with:
          node-version: "22"

      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          python -m pip install -r requirements.txt

      - name: Run quality gate
        run: python scripts/quality.py check --ci
```

- [ ] **Step 3: 验证 install-hooks.sh 语法**

```bash
bash -n scripts/install-hooks.sh
```

Expected: 无输出（语法正确）。

- [ ] **Step 4: 安装 pre-commit hook**

```bash
bash scripts/install-hooks.sh
```

Expected: `Pre-commit hook installed at .git/hooks/pre-commit`

- [ ] **Step 5: Commit**

```bash
git add scripts/install-hooks.sh .gitea/workflows/quality.yml
git commit -m "New# scripts/install-hooks.sh .gitea/workflows/quality.yml - pre-commit hook 安装脚本与 Gitea CI"
```

---

## Task 10: 更新 `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: 替换 Commands 节中的质量门禁部分**

将 `CLAUDE.md` 中原有的：

```markdown
# Quality gate (compile + security + dependency + JS/shell syntax checks)
make check

# Auto-fix (strip trailing whitespace, clear __pycache__, fix file permissions) then check
make fix

# Watch mode (re-runs fix+check on file changes)
make watch
```

替换为：

```markdown
# Quality gate (22 checks: security, syntax, deps, frontend, formatting, runtime)
python scripts/quality.py check

# Auto-fix (trailing whitespace, __pycache__, file permissions) then check
python scripts/quality.py fix

# CI mode (skips local-only checks: file-permissions, sqlite-integrity)
python scripts/quality.py check --ci

# Install pre-commit hook (run once after clone)
bash scripts/install-hooks.sh
```

- [ ] **Step 2: 验证 CLAUDE.md 内容正确**

```bash
grep -A6 "Quality gate" CLAUDE.md
```

Expected: 显示新命令。

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "Update# CLAUDE.md - 更新质量门禁命令（make → python scripts/quality.py）"
```

---

## Task 11: 完整验证

- [ ] **Step 1: 运行完整 check**

```bash
python scripts/quality.py check
```

Expected: 所有22项 `[PASS]` 或 `[SKIP]`，最终 `QUALITY GATE PASSED`。

- [ ] **Step 2: 运行 fix 模式**

```bash
python scripts/quality.py fix
```

Expected: fixable 项修复后 `QUALITY GATE PASSED`。

- [ ] **Step 3: 运行 CI 模式**

```bash
python scripts/quality.py check --ci
```

Expected: `file-permissions` 和 `sqlite-integrity` 显示 `[SKIP] (CI mode)`，其余全 `[PASS]`。

- [ ] **Step 4: 验证 pre-commit hook 触发**

```bash
git diff --cached --quiet || python scripts/quality.py check
```

或直接做一次空提交测试：

```bash
echo "# test" >> README.md
git add README.md
git commit -m "test hook"  # hook 应自动触发并通过
git reset HEAD~1           # 回滚测试提交
git checkout README.md
```

- [ ] **Step 5: 验证 Gitea CI YAML 合法**

```bash
python3 -c "import yaml; yaml.safe_load(open('.gitea/workflows/quality.yml').read()); print('OK')"
```

Expected: `OK`
