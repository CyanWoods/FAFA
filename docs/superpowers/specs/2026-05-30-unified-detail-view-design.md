# 统一详情页设计：曲线图 + 路线热图

**日期：** 2026-05-30
**状态：** 已批准

## 概述

将「数据详情」和「路线热图」两个 Tab 合并为单一页面。左右分栏同时显示，底部固定每公里数据表格，移除 Tab 切换按钮。

## 布局结构

```
┌─ #detail-view (flex column) ──────────────────────────────┐
│  #detail-topbar   (← 返回 | 文件名 | AI评估)              │
│  #detail-meta     (标签 + 备注栏)                          │
│  #detail-summary-row                                       │
│  ┌─ #detail-main-row (flex row, flex:1) ─────────────────┐│
│  │  ┌─ #detail-chart-section (flex:1, scroll-y) ───────┐ ││
│  │  │  曲线图（多指标纵向堆叠，可滚动）                  │ ││
│  │  └───────────────────────────────────────────────────┘ ││
│  │  ┌─ #detail-route-section (flex:1, flex col) ───────┐ ││
│  │  │  #detail-route-metric-bar (速度/功率/心率/坡度)   │ ││
│  │  │  #detail-route-map        (Leaflet, flex:1)       │ ││
│  │  │  #detail-route-legend     (悬浮图例)              │ ││
│  │  └───────────────────────────────────────────────────┘ ││
│  └────────────────────────────────────────────────────────┘│
│  #detail-table-section  (横跨全宽，可拖拽调高)             │
└───────────────────────────────────────────────────────────┘
```

左右比例：50/50（`flex:1` 各占一半）。

## HTML 变更（`templates/index.html`）

1. 移除 `#detail-mode-group`（"数据详情" / "路线热图" 按钮组）
2. 在 `#detail-summary-row` 之后新增 `<div id="detail-main-row">`，包裹现有 `#detail-chart-section` 和 `#detail-route-section`
3. `#detail-table-section` 移到 `#detail-main-row` 之后（全宽）
4. 移除 `#detail-route-section` 的 `style="display:none"` 默认属性

## CSS 变更（`static/style.css`）

- `#detail-view`：已是 `flex column`，确认 `flex:1; min-height:0` 正确
- 新增 `#detail-main-row`：`display:flex; flex:1; min-height:0; overflow:hidden`
- `#detail-chart-section`：从 `flex:1`（直属 view）改为在 row 内保持 `flex:1`，加右侧分隔线 `border-right: 1px solid rgba(255,255,255,0.06)`
- `#detail-route-section`：去掉任何 `display:none` 初始状态，保持 `flex:1; min-height:0; flex-direction:column`
- `#detail-table-section`：`flex-shrink:0`，保持现有拖拽 handle 样式不变

## JS 变更（`static/app.js`）

### 移除

- `detailRouteActive` flag 及所有读写
- `detail-route-btn` / `detail-data-btn` click handler（Tab 切换逻辑）
- `openDetailView` 中 `document.getElementById('detail-route-section').style.display = 'none'`
- `openDetailView` 中 `startTab` 参数逻辑（不再需要）

### 修改

- `openDetailView()`：直接调用 `_renderDetailRoute()`，不再条件判断
- `_renderDetailRoute()` 完成后立即调用 `detailRouteMap.invalidateSize()` + `fitBounds()`（原来靠 Tab 点击触发）
- `closeDetailView()`：移除对 `detail-route-section` display 的重置

### 保留

- `detailRouteMap`、`detailRouteTileLayer`、`detailRouteLayers` 管理逻辑
- Zoom 联动（chart 拖拽缩放时路线高亮段同步）
- Tile 切换逻辑（`setTiles` 同时更新 detail map）
- 路线 tooltip（`position:fixed`，跨分栏无问题）

## 技术要点

1. **Leaflet 初始化时机**：地图在 `openDetailView` 时立即可见，`L.map()` 初始化后不需要 `setTimeout`，直接调用 `invalidateSize()` + `fitBounds()`
2. **数据共用**：热图与曲线图共用 `t.kmStats` / `t.distStats`，无额外网络请求
3. **路线 tooltip**：`position:fixed` 定位，左右分栏布局下无需改动
4. **Light theme**：现有 `.light-theme #detail-route-section` 样式保持有效

## 不在范围内

- 响应式 / 移动端适配
- 指标选择栏的位置变更（保持在热图列顶部）
- 曲线图与热图的 hover 联动（现有功能保留但不新增）
