# PMC 体能管理视图增强 · 设计规格 v2

日期：2026-05-29（更新于同日）

## 背景

对 PMC 视图（`#analytics-view` data-view=pmc）做三处独立增强，均在前端 `static/app.js` + `templates/index.html` 内完成，无需修改后端。

---

## 功能一：骑行指标分布图（扩展区间分布区）

### 目标
在现有"训练区间分布 · 骑行时间（功率区间）"后，新增四张基于**单次骑行值**的固定桶分布图，展示骑行习惯的分布规律。所有五张分布图（含现有功率区间）共享同一组时间筛选按钮。

### 时间筛选
在现有 `#pmc-zone-section` 的 `pmc-section-header` 内，标题右侧插入 pill 按钮组：**全部 / 近3月 / 近1月 / 近1周**

- 模块级状态变量：`_pmcZonePeriod`（默认 `0`，0=全部，90/30/7=天数）
- 切换后对 `_pmcAllData.activities` 按日期过滤，重渲所有分布图

### 四张新增分布图

每张图样式与现有功率区间条相同（`pmc-zone-row` 横向进度条 + 百分比 + 次数）。

| 图表 | 固定桶 | 数据字段 |
|---|---|---|
| 单次骑行时间 | `<1h / 1-2h / 2-3h / >3h` | `act.summary.moving_time_s` ÷ 3600 |
| 骑行距离 | `<50km / 50-100km / 100-150km / >150km` | `act.summary.distance_km` |
| 爬升 | `<500m / 500-1000m / 1000-2000m / >2000m` | `act.summary.elevation_gain` |
| TSS | `<50 / 50-100 / 100-150 / >150` | `act.summary.tss` |

- 每桶显示：次数（count）+ 百分比（%）
- TSS 为 null 的骑行跳过（不计入总数）
- 标题栏：`单次骑行时间分布`、`骑行距离分布`、`爬升分布`、`TSS 分布`

### HTML 骨架（新增 section，紧跟 `#pmc-zone-section`）
```html
<div class="pmc-section" id="pmc-dist-section">
  <div class="pmc-section-header">
    <span class="pmc-chart-title">单次骑行分布</span>
  </div>
  <!-- 四个子区块 -->
  <div class="pmc-dist-block" id="pmc-dist-duration"></div>
  <div class="pmc-dist-block" id="pmc-dist-distance"></div>
  <div class="pmc-dist-block" id="pmc-dist-elevation"></div>
  <div class="pmc-dist-block" id="pmc-dist-tss"></div>
</div>
```

### 渲染函数
新增 `_renderPmcDist(activities)`，计算四张图并写入对应 DOM。在区间筛选切换 + `pmcRecalc` + `openAnalyticsView` 内调用。

---

## 功能二：近30天每日训练柱状图

### 目标
新增 section，展示过去30天（含今日）每天的训练量，5 个指标各一张 ECharts 柱状图，竖向堆叠。

### 位置
新 `.pmc-section#pmc-daily-section`，插入在 `#pmc-dist-section` 之后、`#pmc-curve-section` 之前。

### 5 张图规格

| 图 | 指标 | 数据字段 | 颜色 | Y 轴单位 |
|---|---|---|---|---|
| ① | 距离 | `distance_km` | `#5b9bd5` | km |
| ② | 骑行时间 | `moving_time_s` ÷ 60 | `#70ad47` | 分钟 |
| ③ | 爬升 | `elevation_gain` | `#f39c12` | m |
| ④ | TSS | `tss` | `#9b59b6` | — |
| ⑤ | 次数 | count（每天骑行次数） | `#e74c3c` | 次 |

每张图规格：
- 高度 120px（ECharts 实例）
- X 轴：近30天日期，category，格式 `M/D`，当天用高亮色
- Y 轴：value，不含数值时柱高0（休息日自然空白）
- tooltip：显示日期 + 该日具体值
- 无 legend（标题已说明指标）
- 同一天多次骑行：值求和（次数累加）

### 数据计算
```
_renderPmcDaily(activities):
  生成近30天日期数组 [today-29, ..., today]
  对 activities 按日期分组聚合
  for each 图表指标:
    echarts.init(容器).setOption(...)
```

### HTML 骨架
```html
<div class="pmc-section" id="pmc-daily-section">
  <div class="pmc-section-header">
    <span class="pmc-chart-title">近30天每日训练</span>
  </div>
  <div id="pmc-daily-distance"></div>
  <div id="pmc-daily-time"></div>
  <div id="pmc-daily-elevation"></div>
  <div id="pmc-daily-tss"></div>
  <div id="pmc-daily-count"></div>
</div>
```

### ECharts 实例管理
5 个实例存入 `_pmcDailyCharts = []`，`openAnalyticsView` 时 dispose 旧实例再重建。

---

## 功能三：峰值功率曲线（ECharts 折线图，对数 X 轴）

### 目标
替换现有 HTML 表格，改为 ECharts SVG 折线图。

### 图表规格
- 容器：`#pmc-curve-wrap` 内 ECharts 实例，高度 220px
- X 轴：`type: 'log'`，数据点 `[5, 60, 300, 1200, 3600]`（秒），formatter：`5s / 1m / 5m / 20m / 60m`
- Y 轴：`type: 'value'`，单位 W，min 0
- 三条系列：

| 系列 | 颜色 | 线型 |
|---|---|---|
| 历史最佳 | `#5b9bd5` | 实线 2px |
| 近90天   | `#70ad47` | 虚线 1.5px |
| 近30天   | `#f39c12` | 虚线 1.5px |

- tooltip：显示时长标签 + `XXX W`，若 weight>0 同时显示 `X.XX W/kg`
- 图表下方保留一行数值摘要（flex 排列）：`5s: 850W · 1m: 620W · ...`
- ECharts 实例存 `_pmcCurveChart`，切换视图时 dispose 重建

---

## 文件变更范围

| 文件 | 变更内容 |
|---|---|
| `templates/index.html` | 区间筛选按钮；新增 `#pmc-dist-section`、`#pmc-daily-section` |
| `static/app.js` | 时间筛选逻辑 `_pmcZonePeriod`；`_renderPmcZones` 接受已过滤数组；新增 `_renderPmcDist`、`_renderPmcDaily`；`_renderPmcCurve` 改为 ECharts；调用处更新 |

无后端改动。所有数据来自 `_pmcAllData.activities`（`/api/activities` 已返回所有字段）。

---

## 字段可用性确认

需确认 `act.summary` 含 `moving_time_s`、`elevation_gain`、`tss`。如字段名不同，实现时按实际 API 返回值调整。
