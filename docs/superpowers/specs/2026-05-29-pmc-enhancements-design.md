# PMC 体能管理视图增强 · 设计规格

日期：2026-05-29

## 背景

对 PMC 视图（`#analytics-view` data-view=pmc）做三处独立增强，均在前端 `static/app.js` + `templates/index.html` 内完成，无需修改后端。

---

## 功能一：区间分布时间筛选

### 目标
"训练区间分布 · 骑行时间"区块支持按时间段筛选，默认显示全部历史。

### UI 变更
- `#pmc-zone-section` 的 `.pmc-section-header` 内，在 `#pmc-zone-note` 左侧插入一组 pill 按钮：**全部 / 近3月 / 近1月 / 近1周**
- 激活按钮样式：蓝色背景 + 白字；非激活：透明背景 + 灰字，hover 变亮

### 状态
新增模块级变量 `_pmcZonePeriod`（初始值 `0`，0 = 全部，90/30/7 = 天数）。

### 逻辑
```
onZonePeriodClick(days):
  _pmcZonePeriod = days
  更新按钮激活样式
  cutoff = today - days（days=0 时无截止）
  filtered = _pmcAllData.activities.filter(act => days === 0 || act.date >= cutoff)
  _renderPmcZones(filtered, settings)
```
`_renderPmcZones` 签名不变，直接接受过滤后的 activities 数组。

### 数据来源
`act.date`（字符串 "YYYY-MM-DD"，已存在于 `/api/activities` 返回值）。

---

## 功能二：峰值功率曲线图（ECharts 折线图，对数 X 轴）

### 目标
替换现有 HTML 表格，改为 ECharts SVG 折线图，X 轴为对数刻度（按时间秒数），展示功率随时长的衰减曲线。

### 图表规格
- **容器**：`#pmc-curve-wrap` 内新建一个固定高度（220px）的 ECharts 实例
- **X 轴**：`type: 'log'`，数据点：`[5, 60, 300, 1200, 3600]`（秒）
  - formatter：`5→"5s"`, `60→"1m"`, `300→"5m"`, `1200→"20m"`, `3600→"60m"`
- **Y 轴**：`type: 'value'`，单位 W，从 0 开始，不强制 max
- **三条系列**：
  | 系列 | 颜色 | 线型 |
  |---|---|---|
  | 历史最佳 | `#5b9bd5` | 实线 2px |
  | 近90天   | `#70ad47` | 虚线 1.5px |
  | 近30天   | `#f39c12` | 虚线 1.5px |
- **Tooltip**：每点显示 `XXX W`，若 weight>0 同时显示 `X.XX W/kg`
- **图例**：顶部 legend
- **无数据**：保持现有文字提示逻辑不变

### 实现要点
- 复用 `_pmcCurveChart` 模块级变量存 ECharts 实例，`openAnalyticsView` 时检查存在性 dispose 再重建（避免 resize 问题）
- ECharts 已在项目中引入（PMC 图、detail 图均使用），直接调用 `echarts.init`

### 保留数值表
在图表下方保留一个小 summary 行，显示历史最佳各时长数值（原表格简化版，单行 flex 排列）：`5s: 850W · 1m: 620W · 5m: 410W · 20m: 340W · 60m: 290W`。若 weight>0 追加 W/kg。

---

## 功能三：分时段骑行统计汇总表

### 目标
在 PMC 页面新增一个 section，展示四个时间维度下的汇总统计，方便用户横向对比训练量变化。

### UI
新 `.pmc-section` 插入位置：`#pmc-curve-section` 之后（PMC body 末尾）。

HTML 骨架：
```html
<div class="pmc-section" id="pmc-stats-section">
  <div class="pmc-section-header">
    <span class="pmc-chart-title">骑行统计汇总</span>
  </div>
  <div id="pmc-stats-table"></div>
</div>
```

### 表格结构
4列（全部/近3月/近1月/近1周）× 4行（里程/次数/爬升/TSS）：

| 指标 | 全部 | 近3月 | 近1月 | 近1周 |
|---|---|---|---|---|
| 里程 | — km | — km | — km | — km |
| 骑行次数 | — 次 | — 次 | — 次 | — 次 |
| 爬升 | — m | — m | — m | — m |
| TSS | — | — | — | — |

### 数据来源
`_pmcAllData.activities`，各字段：
- 里程：`act.summary.distance_km`
- 爬升：`act.summary.elevation_gain`
- TSS：`act.summary.tss`（可为 null，汇总时跳过 null）
- 次数：count

### 渲染函数
新增 `_renderPmcStats(activities)`，在 `pmcRecalc` 末尾和 `openAnalyticsView` 内与其他 render 函数并列调用。

---

## 文件变更范围

| 文件 | 变更 |
|---|---|
| `templates/index.html` | 区间筛选按钮、统计 section HTML |
| `static/app.js` | `_renderPmcZones`（接受已过滤数组）、`_renderPmcCurve`（ECharts 折线图）、`_renderPmcStats`（新函数）、调用处更新 |

无后端改动。
