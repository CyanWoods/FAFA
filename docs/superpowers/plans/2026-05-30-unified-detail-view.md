# 统一详情页实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将「数据详情」和「路线热图」两个 Tab 合并为单一页面——左侧曲线图、右侧路线热图、底部每公里数据表格，移除 Tab 切换按钮。

**Architecture:** 无后端变更。纯前端重布局：HTML 新增 `#detail-main-row` flex 容器包裹左右两列，CSS 调整各区块尺寸，JS 删除 Tab 切换逻辑并在打开详情时直接渲染路线热图。

**Tech Stack:** HTML/CSS (Flexbox)、vanilla JS、Leaflet.js（路线地图）

---

## 文件修改列表

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `templates/index.html` | 修改 | 结构重组：新增 wrapper、删除 Tab 按钮、移除 route 区块的 display:none |
| `static/style.css` | 修改 | 新增 `#detail-main-row` 样式，更新 chart/route section 尺寸 |
| `static/app.js` | 修改 | 删除 Tab 切换逻辑，打开详情时直接渲染路线 |

---

## Task 1: HTML 结构重组

**Files:**
- Modify: `templates/index.html:311-367`

- [ ] **Step 1: 删除 Tab 按钮组并重组 detail-main-row**

将 `templates/index.html` 中 `<!-- 界面二：骑行详情 -->` 区块替换为以下结构：

```html
  <!-- 界面二：骑行详情 -->
  <div id="detail-view">
    <div id="detail-topbar">
      <button id="detail-back-btn" onclick="closeDetailView()">← 返回</button>
      <span id="detail-filename-label"></span>
      <button class="det-export-btn det-zoom-reset-btn" id="detail-zoom-reset-btn" onclick="_resetDetailZoom()" style="display:none">重置缩放</button>
      <button class="det-export-btn det-ai-btn" id="detail-ai-btn" onclick="openAiView()">AI 评估</button>
    </div>
    <div id="detail-meta">
      <div id="detail-tags-row">
        <div id="detail-tags-list"></div>
        <button id="detail-tag-add-btn" title="添加标签">＋标签</button>
      </div>
      <div id="detail-note-wrap">
        <div id="detail-note-rendered" class="detail-note-rendered"></div>
        <textarea id="detail-note-editor" class="detail-note-editor" placeholder="添加备注（支持 Markdown）…" style="display:none"></textarea>
        <button id="detail-note-edit-btn" class="detail-note-edit-btn">编辑</button>
        <button id="detail-note-save-btn" class="detail-note-edit-btn" style="display:none">保存</button>
      </div>
    </div>
    <!-- tag picker popup -->
    <div id="tag-picker" style="display:none">
      <div id="tag-picker-list"></div>
      <div id="tag-picker-new">
        <input id="tag-new-name" placeholder="新标签名…" maxlength="10">
        <input id="tag-new-color" type="color" value="#4a9eff">
        <button id="tag-new-btn">创建</button>
      </div>
    </div>
    <div id="detail-summary-row"></div>
    <div id="detail-main-row">
      <div id="detail-chart-section">
        <div id="detail-charts-wrap"></div>
      </div>
      <div id="detail-route-section">
        <div id="detail-route-metric-bar"></div>
        <div id="detail-route-map"></div>
        <div id="detail-route-tooltip" style="display:none"></div>
        <div id="detail-route-legend">
          <span id="detail-route-legend-low"></span>
          <div id="detail-route-legend-bar-wrap">
            <div id="detail-route-legend-bar"></div>
            <div id="detail-route-legend-marker" style="display:none"></div>
            <div id="detail-route-legend-min-marker" style="display:none"></div>
            <div id="detail-route-legend-ftp-marker" style="display:none"></div>
          </div>
          <span id="detail-route-legend-high"></span>
        </div>
      </div>
    </div>
    <div id="detail-table-section">
      <div id="detail-table-handle"><div id="detail-table-handle-bar"></div></div>
      <div id="detail-table-wrap"></div>
    </div>
  </div>
```

关键变更：
- 删除 `#detail-mode-group`（含 `detail-data-btn` 和 `detail-route-btn`）
- 新增 `<div id="detail-main-row">` 包裹 `#detail-chart-section` 和 `#detail-route-section`
- `#detail-route-section` 移入 `#detail-main-row`，去掉 `style="display:none"`
- `#detail-table-section` 移到 `#detail-main-row` 之后（全宽底部）

- [ ] **Step 2: 验证 HTML 无语法错误**

```bash
python3 -c "
from html.parser import HTMLParser
class P(HTMLParser):
    def handle_error(self, msg): print('ERR:', msg)
P().feed(open('templates/index.html').read())
print('HTML parse OK')
"
```

Expected: `HTML parse OK`

---

## Task 2: CSS 布局调整

**Files:**
- Modify: `static/style.css:1116-1230` (chart/table section 区块)
- Modify: `static/style.css:1787-1795` (route section 区块)

- [ ] **Step 1: 新增 `#detail-main-row` 规则**

在 `static/style.css` 中 `#detail-chart-section` 规则之前插入：

```css
#detail-main-row {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
```

- [ ] **Step 2: 更新 `#detail-chart-section`**

将现有 `#detail-chart-section` 规则替换为：

```css
#detail-chart-section {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,0.15) transparent;
  border-right: 1px solid rgba(255,255,255,0.06);
}
```

（新增 `border-right` 作为左右分隔线）

- [ ] **Step 3: 更新 `#detail-route-section`**

将现有 `#detail-route-section` 规则替换为：

```css
#detail-route-section {
  flex: 1;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
}
```

（原有 `flex:1; min-height:0` 不变，`position:relative` 保留供图例定位。无需 `display:none` 初始值。）

- [ ] **Step 4: 补充 light theme 分隔线规则**

在 `.light-theme #detail-route-metric-bar` 附近追加：

```css
.light-theme #detail-chart-section { border-right-color: rgba(0,0,0,0.08); }
```

- [ ] **Step 5: 删除 `#detail-mode-group` 和 `.det-mode-btn` 相关样式**

删除 `static/style.css` 以下三处（Tab 按钮样式，随 HTML 删除一起废弃）：

```css
/* 删除这段（约 842-846 行） */
#detail-mode-group {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

/* 删除这段（约 848-863 行） */
.det-mode-btn { ... }
.det-mode-btn:hover { ... }
.det-mode-btn.active { ... }
.det-mode-btn.active:hover { ... }

/* 删除这段（约 3534-3537 行） */
.light-theme .det-mode-btn { ... }
.light-theme .det-mode-btn:hover { ... }
.light-theme .det-mode-btn.active { ... }
.light-theme .det-mode-btn.active:hover { ... }
```

---

## Task 3: JS 删除 Tab 切换逻辑

**Files:**
- Modify: `static/app.js:157` (变量声明)
- Modify: `static/app.js:1445-1482` (openDetailView)
- Modify: `static/app.js:1739-1770` (_setupDetailRouteButton)
- Modify: `static/app.js:3188` (settings save handler)
- Modify: `static/app.js:570` (活动卡片「路线热图」按钮调用)

- [ ] **Step 1: 删除 `detailRouteActive` 变量声明**

在 `app.js` 第 157 行，删除：
```js
let detailRouteActive = false;
```

- [ ] **Step 2: 重写 `openDetailView`**

将 `openDetailView`（1445-1482 行）替换为：

```js
async function openDetailView(id) {
  const t = tracks.get(id);
  if (!t) return;
  stopFlash(id);
  detailTrackId = id;

  if (detailRouteMap) { detailRouteMap.remove(); detailRouteMap = null; detailRouteTileLayer = null; }
  detailRouteLayers = [];

  document.getElementById('detail-filename-label').textContent = t.name;
  document.getElementById('detail-view').classList.add('active');

  _renderDetailSummary(t.summary);
  _loadAndRenderDetailMeta(t.name);

  document.getElementById('detail-charts-wrap').innerHTML =
    '<div class="detail-charts-loading">加载数据中…</div>';

  let records = null;
  if (t.source === 'library') {
    try {
      const resp = await fetch('/api/records/' + encodeURIComponent(t.name));
      if (resp.ok) records = (await resp.json()).records;
    } catch (_) {}
  }

  _renderDetailCharts(records, t.timeStats);
  _renderDetailTable();
  _buildRouteMetricBar();
  _renderDetailRoute();
}
```

关键变更：
- 移除 `startTab` 参数
- 移除 `detailRouteActive = false`
- 移除三行 `style.display` 切换
- 移除 `_setupDetailRouteButton()` 调用
- 末尾直接调用 `_buildRouteMetricBar()` 和 `_renderDetailRoute()`

- [ ] **Step 3: 删除 `_setupDetailRouteButton` 函数**

删除整个函数（1739-1770 行）：

```js
function _setupDetailRouteButton() {
  // ... 整个函数体
}
```

- [ ] **Step 4: 修复 settings save handler**

第 3188 行，将：
```js
    if (detailRouteActive) _renderDetailRoute();
```
替换为：
```js
    if (detailTrackId != null) _renderDetailRoute();
```

- [ ] **Step 5: 修复活动卡片「路线热图」按钮调用**

第 570 行，将：
```js
      await openDetailView(id, 'route');
```
替换为：
```js
      await openDetailView(id);
```

（新布局两列始终同时显示，不再需要指定 startTab）

---

## Task 4: 验证与提交

- [ ] **Step 1: 启动 Flask 并检查详情页**

```bash
python3 app.py
```

打开 http://localhost:5000，点击任意活动的「轨迹」按钮，进入详情页，确认：
1. 左侧曲线图正常显示
2. 右侧路线热图正常渲染（有颜色线段，图例显示）
3. 底部每公里数据表格正常
4. 指标切换按钮（速度/功率/心率/坡度）在热图列上方，点击后热图重绘
5. Topbar 无 Tab 按钮残留
6. 关闭详情页后重新打开，地图正常重新渲染

- [ ] **Step 2: 检查无数据（仅上传未入库）的 track**

拖拽一个 FIT 文件上传（不通过文件库），点击轨迹名称进入详情，确认：
- 右侧热图显示路线（GPS 数据）
- 曲线图正常（可能无功率/心率但不报错）

- [ ] **Step 3: 检查主题切换**

在详情页打开时切换深色/浅色主题，确认：
- 路线地图 tile 随主题切换
- 左右分隔线颜色适配

- [ ] **Step 4: 提交**

```bash
git add templates/index.html static/style.css static/app.js
git commit -m "Update# templates/index.html style.css app.js - 统一详情页：曲线图与路线热图合并为左右分栏"
```
