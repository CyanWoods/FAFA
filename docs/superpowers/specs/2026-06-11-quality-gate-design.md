# Quality Gate 重设计规格

日期：2026-06-11

## 背景

原质量门禁（`scripts/quality.py` + `Makefile` + `.github/workflows/quality.yml`）在 Docker 化提交中整包删除。
本次重设计目标：结构清晰可判断质量、根目录保持整洁、本地+Gitea CI 双保险。

## 文件结构

```
scripts/
  quality.py           # 检查注册表 + 主逻辑 + CLI
  install-hooks.sh     # 安装 git pre-commit hook
.gitea/
  workflows/
    quality.yml        # Gitea CI 流水线（路径固定，不可移动）
```

根目录不新增任何文件。`Makefile` 不恢复，改用 `python scripts/quality.py` 直接调用。

## 核心结构：检查注册表

每个检查是独立函数，用 `@check` 装饰器注册。主循环统一遍历、收集结果、格式化输出。

```python
@dataclass
class _Check:
    name: str
    fn: Callable
    fixable: bool
    local_only: bool  # True = CI 模式下跳过

@dataclass
class CheckResult:
    name: str
    errors: list[str]
    fixed: list[str]

    @property
    def passed(self) -> bool:
        return not self.errors

_CHECKS: list[_Check] = []

def check(name: str, *, fixable: bool = False, local_only: bool = False):
    def decorator(fn):
        _CHECKS.append(_Check(name, fn, fixable, local_only))
        return fn
    return decorator
```

### 检查函数签名

不可修复检查（返回错误列表）：
```python
@check("git-sensitive-files")
def _git_sensitive() -> list[str]: ...
```

可修复检查（接受 `fix` 参数，返回 `CheckResult`）：
```python
@check("file-permissions", fixable=True, local_only=True)
def _file_permissions(*, fix: bool = False) -> CheckResult: ...
```

增删一项检查 = 增删一个函数，不改主逻辑。

## 检查项清单

按执行阶段排序：

**Phase 1：仓库与 Git 状态**

| 检查名 | fixable | local_only | 说明 |
|---|---|---|---|
| `git-sensitive-files` | 否 | 否 | config.json/users.db/.fit/input/ 不得 git 追踪 |
| `dockerignore` | 否 | 否 | .dockerignore 存在且排除全部敏感文件 |
| `staged-secrets-scan` | 否 | 否 | 扫描 `git diff --cached` 检测硬编码密钥模式 |

**Phase 2：安全不变量**

| 检查名 | fixable | local_only | 说明 |
|---|---|---|---|
| `app-security-invariants` | 否 | 否 | app.py 必须含 6 个安全符号 |
| `route-auth-decorators` | 否 | 否 | /api/ /strava/ /logout 路由必须有 login_required |
| `python-security` | 否 | 否 | `bandit -r` 扫描 Python 代码（未安装则 SKIP） |

**Phase 3：配置与依赖合法性**

| 检查名 | fixable | local_only | 说明 |
|---|---|---|---|
| `config-template-json` | 否 | 否 | config.template.json JSON 合法 |
| `docker-compose-yaml` | 否 | 否 | docker-compose.yml YAML 语法合法（`yaml.safe_load`） |
| `dependency-consistency` | 否 | 否 | `pip check` 依赖无冲突 |

**Phase 4：代码语法**

| 检查名 | fixable | local_only | 说明 |
|---|---|---|---|
| `python-compile` | 否 | 否 | 全部 .py 文件编译通过 |
| `js-syntax` | 否 | 否 | `node --check static/app.js`（未安装则 SKIP） |
| `shell-syntax` | 否 | 否 | `bash -n` 检查项目所有 `.sh` 文件 |
| `dockerfile-lint` | 否 | 否 | `hadolint Dockerfile`（未安装则 SKIP） |

**Phase 5：前端资产**

| 检查名 | fixable | local_only | 说明 |
|---|---|---|---|
| `no-cdn-scripts` | 否 | 否 | index.html 不含 CDN script tag |
| `vendor-assets` | 否 | 否 | 4 个 vendor 文件必须存在 |
| `css-token-enforcement` | 否 | 否 | style.css 不含硬编码颜色/圆角/字号/动画时长，无手动亮色覆盖规则 |
| `js-inline-style-tokens` | 否 | 否 | app.js 内联样式不含硬编码颜色/圆角/字号 |

**Phase 6：格式**

| 检查名 | fixable | local_only | 说明 |
|---|---|---|---|
| `whitespace` | 否 | 否 | `git diff --check` |
| `trailing-whitespace` | 是 | 否 | 文本文件尾部空白（fix 模式自动清除） |

**Phase 7：本地运行时**

| 检查名 | fixable | local_only | 说明 |
|---|---|---|---|
| `file-permissions` | 是 | 是 | input/ chmod 700，db/json chmod 600 |
| `sqlite-integrity` | 否 | 是 | users.db + fafa.db PRAGMA integrity_check |

**Phase 8：清理**

| 检查名 | fixable | local_only | 说明 |
|---|---|---|---|
| `pycache-cleanup` | 是 | 否 | 清除 __pycache__ 目录 |

## 前端样式检查细节

### `css-token-enforcement`

仅扫描 `git diff --cached -- static/style.css`（**暂存区变动行**），不检查整个文件。
存量违规不被拦截；新写或修改的行受约束。

跳过 token 定义行（以 `--` 开头的属性）和注释行。检测：

| 违规类型 | 示例 |
|---|---|
| 硬编码颜色 | 属性值含 `#rrggbb`（非 token 定义） |
| 硬编码圆角 | `border-radius: Xpx`（不含 `var(--`） |
| 硬编码字号 | `font-size: Xpx/rem/em`（不含 `var(--`） |
| 硬编码动画时长 | `transition` 值含 `X.Xs/ms`（不含 `var(--`） |

零值（`0`、`0px`）豁免。

### `js-inline-style-tokens`

仅扫描 `git diff --cached -- static/app.js`（**暂存区变动行**），不检查整个文件。

检测新增行中以下模式含硬编码颜色（`#hex`/`rgb`/`hsl`）：

- `element.style.color = '...'` / `.backgroundColor` / `.borderColor`
- `el.setAttribute('style', '...')`
- 模板字符串内含 `style=` 的行

`style.background`（渐变图表用色）不在检测范围内。

## CLI

```
python scripts/quality.py check          # 本地：运行全部检查
python scripts/quality.py fix            # 自动修复后运行全部检查
python scripts/quality.py check --ci     # CI 模式：跳过 local_only 检查
```

## 输出格式

```
[PASS] git-sensitive-files
[PASS] app-security-invariants
[FAIL] python-compile
       ERROR: fafa/tools/export_all.py: SyntaxError at line 42
[SKIP] file-permissions  (CI mode)

QUALITY GATE FAILED — 1 check(s) failed
```

fix 模式额外输出：
```
[FIXED] file-permissions: chmod 600 users.db, chmod 700 input/alice/
```

## Pre-commit Hook

`scripts/install-hooks.sh` 写入 `.git/hooks/pre-commit`：

```bash
#!/usr/bin/env bash
set -e
HOOK=.git/hooks/pre-commit
echo '#!/usr/bin/env bash' > "$HOOK"
echo 'python scripts/quality.py check' >> "$HOOK"
chmod +x "$HOOK"
echo "Installed pre-commit hook"
```

首次 clone 后需手动运行一次 `bash scripts/install-hooks.sh`。

检查范围为完整工作区（含未暂存修改），不做 stash/pop 隔离——拦截方向宁多勿少。

## Gitea CI

`.gitea/workflows/quality.yml`（语法与 GitHub Actions 兼容）：

```yaml
name: Quality Gate
on: [push, pull_request]
jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
      - run: pip install -r requirements.txt
      - run: python scripts/quality.py check --ci
```

## CLAUDE.md 更新

`Commands` 节替换为：

```bash
# 质量门禁
python scripts/quality.py check   # 运行全部检查
python scripts/quality.py fix     # 自动修复后运行检查
bash scripts/install-hooks.sh     # 安装 pre-commit hook（首次 clone 后运行）
```
