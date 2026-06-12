# About 视图 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在侧边栏「文件管理」下方新增第 6 个导航项「关于」，展示版本号（来自 `version` 文件）和项目简介。

**Architecture:** `version` 文件存于项目根目录，由 `app.py` 启动时读取为 `FAFA_VERSION` 常量，经 Jinja2 注入模板。前端新增 `#about-view` 视图容器，`switchSidebarView('about')` 控制显隐，样式跟随现有视图 CSS token 规范。

**Tech Stack:** Python/Flask (Jinja2), HTML, Vanilla JS, CSS custom properties

---

## 变更文件索引

| 文件 | 操作 | 说明 |
|------|------|------|
| `version` | 新建 | 版本字符串，如 `v2026.06.12` |
| `app.py` | 修改第 122 行后、第 1049 行 | 读取版本常量；传入 render_template |
| `templates/index.html` | 修改第 49 行后、第 217 行后 | 侧边栏按钮；about-view HTML |
| `static/app.js` | 修改第 215 行、第 243 行 | switchSidebarView 添加 about 分支 |
| `static/style.css` | 在 `#files-view` 块后追加；light-theme 块追加 | about-view 样式 |

> 注：本项目无自动化测试，质量门禁为 `python3 scripts/quality.py check`（22 项检查），每个 Task 提交前必须通过。

---

### Task 1: 创建 `version` 文件并读取到后端

**Files:**
- Create: `version`
- Modify: `app.py:122` (PROJECT_ROOT 定义之后)
- Modify: `app.py:1049` (render_template 调用)

- [ ] **Step 1: 创建 `version` 文件**

在项目根目录创建文件 `version`，内容为（注意无尾部空格/换行外的字符）：

```
v2026.06.12
```

- [ ] **Step 2: 在 `app.py` 添加版本读取**

当前 `app.py` 第 121–122 行：
```python
PROJECT_ROOT      = Path(__file__).parent
SEMICIRCLE_TO_DEG = 180.0 / (2 ** 31)
```

在 `PROJECT_ROOT` 定义之后、`SEMICIRCLE_TO_DEG` 之前插入：
```python
PROJECT_ROOT      = Path(__file__).parent
_version_file     = PROJECT_ROOT / "version"
FAFA_VERSION      = _version_file.read_text().strip() if _version_file.exists() else "unknown"
SEMICIRCLE_TO_DEG = 180.0 / (2 ** 31)
```

- [ ] **Step 3: 将版本传入模板**

当前 `app.py` 第 1049 行：
```python
    return render_template("index.html", username=g.username)
```

改为：
```python
    return render_template("index.html", username=g.username, version=FAFA_VERSION)
```

- [ ] **Step 4: 验证后端启动正常**

```bash
python3 app.py &
sleep 2
curl -s http://127.0.0.1:5173/ | grep -o "v2026" || echo "版本未注入（需登录验证，正常）"
kill %1
```

预期：Flask 启动无报错（版本需浏览器登录后才可见，此步仅验证启动）。

- [ ] **Step 5: 运行质量门禁**

```bash
python3 scripts/quality.py check
```

预期：`QUALITY GATE PASSED`

- [ ] **Step 6: 提交**

```bash
git add version app.py
git commit -m "Add# version - 新增版本文件与后端读取逻辑"
```

---

### Task 2: 添加侧边栏导航按钮与 `#about-view` HTML

**Files:**
- Modify: `templates/index.html:49` (侧边栏文件管理按钮之后)
- Modify: `templates/index.html:217` (#files-view 结束之后)

- [ ] **Step 1: 添加侧边栏「关于」按钮**

当前 `index.html` 第 46–50 行：
```html
      <button class="sb-item" data-view="files" onclick="switchSidebarView('files')">
        <span class="sb-icon sb-icon--lg">⊞</span>
        <span class="sb-label">文件管理 <span id="lib-count" class="sb-badge"></span></span>
      </button>
    </div>
```

改为：
```html
      <button class="sb-item" data-view="files" onclick="switchSidebarView('files')">
        <span class="sb-icon sb-icon--lg">⊞</span>
        <span class="sb-label">文件管理 <span id="lib-count" class="sb-badge"></span></span>
      </button>
      <button class="sb-item" data-view="about" onclick="switchSidebarView('about')">
        <span class="sb-icon sb-icon--lg">ⓘ</span>
        <span class="sb-label">关于</span>
      </button>
    </div>
```

- [ ] **Step 2: 添加 `#about-view` 视图容器**

当前 `index.html` 第 217–219 行：
```html
  </div>

  <!-- ── 顽鹿同步弹窗 ───────────────────────────────────────────────────────── -->
```

在 `</div>` 与同步弹窗注释之间插入：
```html
  </div>

  <!-- ── 关于视图 ──────────────────────────────────────────────────────────── -->
  <div id="about-view">
    <div id="about-header">
      <span class="act-list-title">关于</span>
    </div>
    <div id="about-body">
      <div class="about-logo-row">
        <img src="/static/fafa-logo.png" class="about-logo" alt="FAFA">
        <div class="about-title-block">
          <span class="about-name">FAFA</span>
          <span class="about-version">{{ version }}</span>
        </div>
      </div>
      <p class="about-desc">FIT 文件解析、纠偏、可视化工具集，支持 Garmin、Magene 等设备导出的骑行数据。</p>
      <div class="about-section-title">功能视图</div>
      <ul class="about-feature-list">
        <li><span class="about-feat-icon">◈</span> <b>骑行记录</b> — 活动卡片列表，按月分组，支持筛选、详情、AI 分析</li>
        <li><span class="about-feat-icon">⤳</span> <b>骑行轨迹</b> — 拖拽加载路径，多路径叠加，PNG 导出</li>
        <li><span class="about-feat-icon">⬡</span> <b>体能管理</b> — CTL/ATL/TSB 曲线、功率曲线、区间分布</li>
        <li><span class="about-feat-icon">⊟</span> <b>训练日历</b> — 月视图，按天展示活动</li>
        <li><span class="about-feat-icon">⊞</span> <b>文件管理</b> — FIT 文件库，支持导入、同步、导出</li>
      </ul>
    </div>
  </div>

  <!-- ── 顽鹿同步弹窗 ───────────────────────────────────────────────────────── -->
```

- [ ] **Step 3: 运行质量门禁**

```bash
python3 scripts/quality.py check
```

预期：`QUALITY GATE PASSED`

- [ ] **Step 4: 提交**

```bash
git add templates/index.html
git commit -m "Add# templates/index.html - 关于页面侧边栏按钮与视图 HTML"
```

---

### Task 3: 更新 `switchSidebarView` JS 函数

**Files:**
- Modify: `static/app.js:214-243`

- [ ] **Step 1: 在 remove-active 块加入 about-view**

当前 `app.js` 第 214–215 行：
```javascript
  document.getElementById('activities-view').classList.remove('active');
  document.getElementById('files-view').classList.remove('active');
```

改为：
```javascript
  document.getElementById('activities-view').classList.remove('active');
  document.getElementById('files-view').classList.remove('active');
  document.getElementById('about-view').classList.remove('active');
```

- [ ] **Step 2: 添加 `about` 分支**

当前 `app.js` 第 240–243 行：
```javascript
  } else if (name === 'files') {
    document.getElementById('files-view').classList.add('active');
    refreshLibrary();
  }
```

改为：
```javascript
  } else if (name === 'files') {
    document.getElementById('files-view').classList.add('active');
    refreshLibrary();
  } else if (name === 'about') {
    document.getElementById('about-view').classList.add('active');
  }
```

- [ ] **Step 3: 运行质量门禁**

```bash
python3 scripts/quality.py check
```

预期：`QUALITY GATE PASSED`

- [ ] **Step 4: 提交**

```bash
git add static/app.js
git commit -m "Add# static/app.js - switchSidebarView 添加 about 视图分支"
```

---

### Task 4: 添加 CSS 样式

**Files:**
- Modify: `static/style.css` — 在 `#files-view` 块之后追加；在 light-theme 块追加

- [ ] **Step 1: 在 `#files-view.active` 之后追加 about-view 样式**

定位：`static/style.css` 第 1903 行附近，`#files-view.active { display: flex; }` 之后。

在该行之后插入：
```css

/* ── About view ────────────────────────────────────────────────────────────── */
#about-view {
  position: fixed;
  top: 0; right: 0; bottom: 0;
  left: 180px;
  z-index: 500;
  background: var(--bg-base);
  display: none;
  flex-direction: column;
  overflow-y: auto;
}
#about-view.active { display: flex; }
#about-header {
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}
#about-body {
  padding: 32px 40px;
  max-width: 600px;
}
.about-logo-row {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}
.about-logo { width: 48px; height: 48px; }
.about-title-block { display: flex; flex-direction: column; gap: 4px; }
.about-name { font-size: var(--text-2xl); font-weight: 700; color: var(--text-primary); }
.about-version {
  font-size: var(--text-sm);
  color: var(--color-primary);
  background: rgba(46, 134, 222, 0.12);
  border-radius: var(--radius-pill);
  padding: 2px 10px;
  display: inline-block;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.about-desc {
  font-size: var(--text-md);
  color: var(--text-secondary);
  margin-bottom: 28px;
  line-height: 1.6;
}
.about-section-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-disabled);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 12px;
}
.about-feature-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.about-feature-list li {
  font-size: var(--text-md);
  color: var(--text-secondary);
  display: flex;
  align-items: baseline;
  gap: 8px;
  line-height: 1.5;
}
.about-feat-icon { color: var(--color-accent); flex-shrink: 0; }
```

- [ ] **Step 2: 在 light-theme 覆盖块追加 about-view 覆盖**

找到 `static/style.css` 中 light-theme 块末尾（当前约在 `.light-theme #files-view` 附近的这行）：
```css
.light-theme #activities-view,
.light-theme #files-view { background: var(--bg-light); }
```

改为：
```css
.light-theme #activities-view,
.light-theme #files-view,
.light-theme #about-view { background: var(--bg-light); }
.light-theme #about-header { border-bottom-color: rgba(0,0,0,0.13); }
```

- [ ] **Step 3: 运行质量门禁**

```bash
python3 scripts/quality.py check
```

预期：`QUALITY GATE PASSED`。若 `css-token-enforcement` 报错，检查 `.about-version` 的 `background: rgba(46,134,222,0.12)` — 该值为颜色叠加透明度，质量脚本是否将其视为硬编码颜色。若报错，改为：

```css
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
```

如浏览器兼容性有顾虑，可改为直接使用已有 token `--color-primary-glow` 的透明变体或直接测试后决定。

- [ ] **Step 4: 提交**

```bash
git add static/style.css
git commit -m "Add# static/style.css - 关于页面视图样式"
```

---

### Task 5: 端到端手动验证

无自动化测试，通过浏览器和质量门禁验证。

- [ ] **Step 1: 启动应用**

```bash
python3 app.py
```

访问 http://127.0.0.1:5173

- [ ] **Step 2: 验证深色主题**

点击侧边栏「ⓘ 关于」：
- 关于页面展示，背景色与其他视图一致（深色）
- 显示 FAFA logo、`v2026.06.12` 版本徽章（蓝色胶囊）
- 一句话简介可读
- 5 个功能视图列表显示正确图标与文字
- 其他 5 个导航项正常切换，关于页面正确隐藏

- [ ] **Step 3: 验证浅色主题**

点击「◑」切换浅色主题后再点击「关于」：
- 背景切换为浅色
- header 分隔线可见
- 文字颜色对比度正常，版本徽章可读

- [ ] **Step 4: 验证 `version` 文件不在 `.gitignore`**

```bash
git check-ignore -v version
```

预期：无输出（文件未被忽略）。

- [ ] **Step 5: 最终质量门禁**

```bash
python3 scripts/quality.py check
```

预期：`QUALITY GATE PASSED`
