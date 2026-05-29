# PMC 体能管理增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 PMC 视图新增骑行指标分布图（带时段筛选）、近30天每日柱状图，并将峰值功率曲线表格改为对数坐标 ECharts 折线图。

**Architecture:** 纯前端改动。所有数据来自 `_pmcAllData.activities`（已在 `_loadAndRenderPmc` 加载）。新增三个渲染函数 `_renderPmcDist`、`_renderPmcDaily`、改写 `_renderPmcCurve`；区间筛选通过模块级 `_pmcZonePeriod` 状态控制。`_loadAndRenderPmc` 在所有新函数定义完毕后（Task 7）统一更新，避免中间状态报错。ECharts 已全局可用。

**Tech Stack:** Vanilla JS, ECharts（已引入），Flask/Jinja2 HTML 模板

---

## 文件变更

| 文件 | 变更 |
|---|---|
| `templates/index.html` | 区间筛选按钮、`#pmc-dist-section`、`#pmc-daily-section`、CSS |
| `static/app.js` | 状态变量；`_pmcFilterActivities`；`_applyZonePeriod`；`_renderPmcDist`；`_renderPmcDaily`；`_renderPmcCurve`（改写）；`_loadAndRenderPmc`（Task 7 最后更新） |

**执行顺序：** Task 1（HTML）→ Task 2（CSS）→ Task 3（状态+工具函数）→ Task 4（分布图）→ Task 5（每日图）→ Task 6（功率曲线）→ Task 7（接线+回归）

---

## Task 1：HTML 骨架

**Files:**
- Modify: `templates/index.html`（行 ~424-437）

- [ ] **Step 1：在 `#pmc-zone-section` header 加时段筛选按钮**

找到（约第 424 行）：
```html
      <div class="pmc-section" id="pmc-zone-section">
        <div class="pmc-section-header">
          <span class="pmc-chart-title">训练区间分布 · 骑行时间</span>
          <span id="pmc-zone-note" class="pmc-zone-note"></span>
        </div>
        <div id="pmc-zone-bars"></div>
      </div>
```

替换为：
```html
      <div class="pmc-section" id="pmc-zone-section">
        <div class="pmc-section-header">
          <span class="pmc-chart-title">训练区间分布 · 骑行时间</span>
          <div style="display:flex;align-items:center;gap:8px">
            <span id="pmc-zone-note" class="pmc-zone-note"></span>
            <div id="pmc-zone-period-btns" class="pmc-period-group">
              <button class="pmc-period-btn active" data-zone-period="0">全部</button>
              <button class="pmc-period-btn" data-zone-period="90">近3月</button>
              <button class="pmc-period-btn" data-zone-period="30">近1月</button>
              <button class="pmc-period-btn" data-zone-period="7">近1周</button>
            </div>
          </div>
        </div>
        <div id="pmc-zone-bars"></div>
      </div>
```

- [ ] **Step 2：在 `#pmc-zone-section` 之后、`#pmc-curve-section` 之前插入两个新 section**

找到（约第 431 行）：
```html
      <div class="pmc-section" id="pmc-curve-section">
```

在其之前插入：
```html
      <div class="pmc-section" id="pmc-dist-section">
        <div class="pmc-section-header">
          <span class="pmc-chart-title">单次骑行分布</span>
        </div>
        <div class="pmc-dist-block">
          <div class="pmc-dist-label">骑行时长</div>
          <div id="pmc-dist-duration"></div>
        </div>
        <div class="pmc-dist-block">
          <div class="pmc-dist-label">骑行距离</div>
          <div id="pmc-dist-distance"></div>
        </div>
        <div class="pmc-dist-block">
          <div class="pmc-dist-label">爬升</div>
          <div id="pmc-dist-elevation"></div>
        </div>
        <div class="pmc-dist-block">
          <div class="pmc-dist-label">TSS</div>
          <div id="pmc-dist-tss"></div>
        </div>
      </div>
      <div class="pmc-section" id="pmc-daily-section">
        <div class="pmc-section-header">
          <span class="pmc-chart-title">近30天每日训练</span>
        </div>
        <div id="pmc-daily-distance"  style="height:120px"></div>
        <div id="pmc-daily-time"      style="height:120px;margin-top:8px"></div>
        <div id="pmc-daily-elevation" style="height:120px;margin-top:8px"></div>
        <div id="pmc-daily-tss"       style="height:120px;margin-top:8px"></div>
        <div id="pmc-daily-count"     style="height:120px;margin-top:8px"></div>
      </div>
```

- [ ] **Step 3：验证 HTML 结构（不需要 JS 生效，只看骨架）**

访问 `http://127.0.0.1:5173` → PMC 视图。
确认：区间分布标题右侧有4个按钮；下方有"单次骑行分布"和"近30天每日训练"两个空 section；无布局错位。

- [ ] **Step 4：提交**

```bash
git add templates/index.html
git commit -m "Add# templates/index.html - PMC 区间筛选按钮及新 section 骨架"
```

---

## Task 2：CSS — 新增分布图样式

**Files:**
- Modify: `templates/index.html`（`<style>` 块内）

- [ ] **Step 1：确认 `<style>` 位置**

```bash
grep -n "pmc-zone-row\|\.pmc-section" /Volumes/Code/Code/Labs/FAFA_Python/templates/index.html | head -10
```

找到包含 `.pmc-zone-row` 的 `<style>` 块行号。

- [ ] **Step 2：在 `.pmc-zone-row` 相关样式之后追加**

```css
/* 单次骑行分布 */
.pmc-dist-block { margin: 10px 0; }
.pmc-dist-label { font-size: 12px; color: #888; margin-bottom: 4px; }
.pmc-dist-bucket-row {
  display: grid;
  grid-template-columns: 90px 1fr 44px 54px;
  align-items: center;
  gap: 4px 8px;
  margin-bottom: 4px;
}
.pmc-dist-bucket-label { font-size: 12px; color: #aaa; }
.pmc-dist-bar-track { background: #2a2a3a; border-radius: 3px; height: 8px; }
.pmc-dist-bar-fill  { border-radius: 3px; height: 8px; }
.pmc-dist-pct  { font-size: 12px; color: #aaa; text-align: right; }
.pmc-dist-count { font-size: 11px; color: #666; }
```

- [ ] **Step 3：验证无样式冲突**

刷新 PMC 视图，现有区间分布、PMC 图表样式不受影响。

- [ ] **Step 4：提交**

```bash
git add templates/index.html
git commit -m "Add# templates/index.html - pmc-dist-block 样式"
```

---

## Task 3：JS — 状态变量 + 工具函数 + 按钮绑定

**Files:**
- Modify: `static/app.js`

注意：此 Task 不更新 `_loadAndRenderPmc`，避免调用尚未定义的函数。`_loadAndRenderPmc` 在 Task 7 统一更新。

- [ ] **Step 1：新增模块级状态变量**

找到（约第 171 行）：
```javascript
let _pmcAllData = null;   // { days, tss, ctl, atl, tsb, activities }
```

在其正下方插入：
```javascript
let _pmcZonePeriod  = 0;   // 0=全部, 90/30/7=天数
let _pmcDailyCharts = [];  // ECharts 实例，渲染前 dispose
let _pmcCurveChart  = null;
```

- [ ] **Step 2：新增 `_pmcFilterActivities` 工具函数**

在 `_renderPmcZones` 函数（约第 3527 行）之前插入：

```javascript
function _pmcFilterActivities(activities, periodDays) {
  if (!periodDays) return activities;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - periodDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return activities.filter(a => (a.date || '') >= cutoffStr);
}
```

- [ ] **Step 3：新增 `_applyZonePeriod` 函数**

紧接 `_pmcFilterActivities` 之后插入：

```javascript
function _applyZonePeriod(days) {
  _pmcZonePeriod = days;
  document.querySelectorAll('#pmc-zone-period-btns .pmc-period-btn').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.zonePeriod) === days);
  });
  if (!_pmcAllData) return;
  const settings  = _pmcSettings();
  const filtered  = _pmcFilterActivities(_pmcAllData.activities, days);
  _renderPmcZones(filtered, settings);
  _renderPmcDist(filtered, settings);
}
```

- [ ] **Step 4：在 DOMContentLoaded 中绑定按钮事件**

找到文件末尾的 `DOMContentLoaded` 回调，在其内部（任意初始化代码旁）追加：

```javascript
  document.getElementById('pmc-zone-period-btns')?.addEventListener('click', e => {
    const btn = e.target.closest('.pmc-period-btn[data-zone-period]');
    if (btn) _applyZonePeriod(Number(btn.dataset.zonePeriod));
  });
```

- [ ] **Step 5：验证（控制台层面）**

打开 PMC 视图，打开浏览器 DevTools Console，执行：
```javascript
_applyZonePeriod(30)
```
预期：控制台无报错（`_renderPmcDist` 还未定义时会报 ReferenceError，暂时正常；下一步 Task 4 解决）。
实际可以检查按钮激活状态切换是否正常（CSS `active` 类）。

- [ ] **Step 6：提交**

```bash
git add static/app.js
git commit -m "Add# static/app.js - PMC 区间筛选状态变量及工具函数"
```

---

## Task 4：JS — `_renderPmcDist` 四张固定桶分布图

**Files:**
- Modify: `static/app.js`（在 `_applyZonePeriod` 之后，`_renderPmcZones` 之前）

- [ ] **Step 1：插入桶配置常量 `_DIST_CONFIGS`**

在 `_applyZonePeriod` 结束 `}` 之后插入：

```javascript
const _DIST_CONFIGS = [
  {
    id: 'pmc-dist-duration',
    getValue: act => {
      const s = act.summary;
      if (!s) return null;
      const raw = (s.moving_time_s || s.total_duration_s || 0) / 3600;
      return raw > 0 ? raw : null;
    },
    buckets: [
      { label: '< 1h',    test: v => v < 1 },
      { label: '1 – 2h',  test: v => v >= 1  && v < 2 },
      { label: '2 – 3h',  test: v => v >= 2  && v < 3 },
      { label: '> 3h',    test: v => v >= 3 },
    ],
    color: '#70ad47',
  },
  {
    id: 'pmc-dist-distance',
    getValue: act => {
      const v = act.summary?.total_dist_km;
      return (v != null && v > 0) ? v : null;
    },
    buckets: [
      { label: '< 50km',     test: v => v < 50 },
      { label: '50 – 100km', test: v => v >= 50  && v < 100 },
      { label: '100 – 150km',test: v => v >= 100 && v < 150 },
      { label: '> 150km',    test: v => v >= 150 },
    ],
    color: '#5b9bd5',
  },
  {
    id: 'pmc-dist-elevation',
    getValue: act => {
      const v = act.summary?.total_elevation_gain_m;
      return (v != null && v >= 0) ? v : null;
    },
    buckets: [
      { label: '< 500m',     test: v => v < 500 },
      { label: '500 – 1000m',test: v => v >= 500  && v < 1000 },
      { label: '1000 – 2000m',test:v => v >= 1000 && v < 2000 },
      { label: '> 2000m',    test: v => v >= 2000 },
    ],
    color: '#f39c12',
  },
  {
    id: 'pmc-dist-tss',
    getValue: (act, settings) => {
      const t = _computeTSS(act.summary, settings);
      return t > 0 ? t : null;
    },
    buckets: [
      { label: '< 50',    test: v => v < 50 },
      { label: '50 – 100',test: v => v >= 50  && v < 100 },
      { label: '100 – 150',test:v => v >= 100 && v < 150 },
      { label: '> 150',   test: v => v >= 150 },
    ],
    color: '#9b59b6',
  },
];
```

- [ ] **Step 2：实现 `_renderPmcDist`**

紧接 `_DIST_CONFIGS` 之后插入：

```javascript
function _renderPmcDist(activities, settings) {
  for (const cfg of _DIST_CONFIGS) {
    const wrap = document.getElementById(cfg.id);
    if (!wrap) continue;

    const counts = new Array(cfg.buckets.length).fill(0);
    let total = 0;
    for (const act of activities) {
      const v = cfg.getValue(act, settings);
      if (v == null || isNaN(v)) continue;
      for (let i = 0; i < cfg.buckets.length; i++) {
        if (cfg.buckets[i].test(v)) { counts[i]++; break; }
      }
      total++;
    }

    if (total === 0) {
      wrap.innerHTML = '<div style="color:#555;font-size:12px;padding:4px 0">暂无数据</div>';
      continue;
    }

    wrap.innerHTML = cfg.buckets.map((b, i) => {
      const pct = (counts[i] / total * 100).toFixed(1);
      return `
        <div class="pmc-dist-bucket-row">
          <span class="pmc-dist-bucket-label">${b.label}</span>
          <div class="pmc-dist-bar-track">
            <div class="pmc-dist-bar-fill" style="width:${pct}%;background:${cfg.color}"></div>
          </div>
          <span class="pmc-dist-pct">${pct}%</span>
          <span class="pmc-dist-count">${counts[i]} 次</span>
        </div>`;
    }).join('');
  }
}
```

- [ ] **Step 3：验证分布图（临时测试）**

打开 PMC 视图，DevTools Console 执行：
```javascript
_renderPmcDist(_pmcAllData.activities, _pmcSettings())
```
预期："单次骑行分布" section 出现4块进度条；每块有4行；百分比合计接近100%（小数点误差正常）。

- [ ] **Step 4：提交**

```bash
git add static/app.js
git commit -m "Add# static/app.js - _renderPmcDist 单次骑行分布图"
```

---

## Task 5：JS — `_renderPmcDaily` 近30天每日柱状图

**Files:**
- Modify: `static/app.js`（在 `_renderPmcDist` 之后插入）

- [ ] **Step 1：实现 `_renderPmcDaily`**

```javascript
function _renderPmcDaily(activities, settings) {
  for (const c of _pmcDailyCharts) { try { c.dispose(); } catch {} }
  _pmcDailyCharts = [];

  // 近30天日期数组
  const days = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  const todayStr = today.toISOString().slice(0, 10);
  const xLabels  = days.map(d => d.slice(5).replace('-', '/'));

  // 按天聚合
  const byDay = {};
  for (const d of days) byDay[d] = { distance: 0, time: 0, elevation: 0, tss: 0, count: 0 };
  for (const act of activities) {
    const d = (act.date || '').slice(0, 10);
    if (!byDay[d]) continue;
    const s = act.summary || {};
    byDay[d].distance  += s.total_dist_km || 0;
    byDay[d].time      += ((s.moving_time_s || s.total_duration_s || 0)) / 60;
    byDay[d].elevation += s.total_elevation_gain_m || 0;
    byDay[d].tss       += _computeTSS(s, settings);
    byDay[d].count++;
  }

  const cfgs = [
    { id: 'pmc-daily-distance',  key: 'distance',  label: '距离 (km)',  color: '#5b9bd5', fmt: v => v.toFixed(1) + ' km' },
    { id: 'pmc-daily-time',      key: 'time',       label: '时间 (min)', color: '#70ad47', fmt: v => Math.round(v) + ' min' },
    { id: 'pmc-daily-elevation', key: 'elevation',  label: '爬升 (m)',   color: '#f39c12', fmt: v => Math.round(v) + ' m' },
    { id: 'pmc-daily-tss',       key: 'tss',        label: 'TSS',        color: '#9b59b6', fmt: v => Math.round(v) },
    { id: 'pmc-daily-count',     key: 'count',      label: '次数',       color: '#e74c3c', fmt: v => v + ' 次' },
  ];

  for (const cfg of cfgs) {
    const el = document.getElementById(cfg.id);
    if (!el) continue;

    const data = days.map(d => byDay[d][cfg.key]);

    const chart = echarts.init(el, 'dark', { renderer: 'svg' });
    _pmcDailyCharts.push(chart);

    chart.setOption({
      backgroundColor: 'transparent',
      grid: { top: 24, bottom: 28, left: 52, right: 12 },
      xAxis: {
        type: 'category',
        data: xLabels,
        axisLabel: {
          fontSize: 10,
          interval: 4,
          color: '#666',
          formatter: (v, i) => days[i] === todayStr
            ? `{today|${v}}`
            : v,
          rich: { today: { color: '#3a8dde', fontWeight: 'bold' } },
        },
        axisLine: { lineStyle: { color: '#333' } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLabel: { fontSize: 10, color: '#666' },
        splitLine: { lineStyle: { color: '#2a2a3a' } },
        minInterval: 1,
        min: 0,
      },
      series: [{
        type: 'bar',
        data: data.map((v, i) => ({
          value: v,
          itemStyle: {
            color:   days[i] === todayStr ? '#3a8dde' : cfg.color,
            opacity: v > 0 ? 0.85 : 0.12,
          },
        })),
        barMaxWidth: 16,
      }],
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1e1e2e',
        borderColor: '#444',
        textStyle: { color: '#ddd', fontSize: 12 },
        formatter: params => {
          const p = params[0];
          return `${days[p.dataIndex]}<br/>${cfg.label}：${cfg.fmt(p.value)}`;
        },
      },
      graphic: [{
        type: 'text',
        left: 12, top: 6,
        style: { text: cfg.label, fill: '#888', fontSize: 11 },
      }],
    });
  }
}
```

- [ ] **Step 2：验证（临时测试）**

PMC 视图，DevTools Console：
```javascript
_renderPmcDaily(_pmcAllData.activities, _pmcSettings())
```
预期："近30天每日训练" section 出现5张柱状图；有骑行日期有柱；今天蓝色高亮；tooltip 显示正确。

- [ ] **Step 3：提交**

```bash
git add static/app.js
git commit -m "Add# static/app.js - _renderPmcDaily 近30天每日训练柱状图"
```

---

## Task 6：JS — 改写 `_renderPmcCurve` 为 ECharts 对数折线图

**Files:**
- Modify: `static/app.js`（约第 3582 行，整个 `_renderPmcCurve` 函数）

- [ ] **Step 1：完整替换 `_renderPmcCurve` 函数**

找到函数（从 `function _renderPmcCurve(` 到对应的 `}`），完整替换：

```javascript
function _renderPmcCurve(activities, settings) {
  const wrap = document.getElementById('pmc-curve-wrap');
  const note = document.getElementById('pmc-curve-note');
  if (!wrap) return;

  const today = new Date();
  const d90 = new Date(today); d90.setDate(d90.getDate() - 90);
  const d30 = new Date(today); d30.setDate(d30.getDate() - 30);

  const best = {}, best90 = {}, best30 = {};
  for (const { key } of _CURVE_DURATIONS) { best[key] = 0; best90[key] = 0; best30[key] = 0; }

  for (const act of activities) {
    const pp = act.peak_power;
    if (!pp || !Object.keys(pp).length) continue;
    const actDate = new Date(act.date);
    const in90 = actDate >= d90;
    const in30 = actDate >= d30;
    for (const { key } of _CURVE_DURATIONS) {
      const w = pp[key] || 0;
      if (w > best[key])   best[key]   = w;
      if (in90 && w > best90[key]) best90[key] = w;
      if (in30 && w > best30[key]) best30[key] = w;
    }
  }

  const hasAny = Object.values(best).some(v => v > 0);
  if (!hasAny) {
    if (_pmcCurveChart) { try { _pmcCurveChart.dispose(); } catch {} _pmcCurveChart = null; }
    wrap.innerHTML = '<div style="color:#555;font-size:13px;padding:8px 0">暂无功率数据</div>';
    if (note) note.textContent = '';
    return;
  }

  const weight  = settings.weight;
  const showWkg = weight > 0;
  if (note) note.textContent = showWkg ? `体重 ${weight} kg` : '';

  const xVals   = _CURVE_DURATIONS.map(d => Number(d.key));
  const xLabels = { 5: '5s', 60: '1m', 300: '5m', 1200: '20m', 3600: '60m' };

  const makeSeries = (data, name, color, dashed) => ({
    name,
    type: 'line',
    data: xVals.map((x, i) => [x, data[_CURVE_DURATIONS[i].key] || null]),
    lineStyle: { color, width: dashed ? 1.5 : 2, type: dashed ? 'dashed' : 'solid' },
    itemStyle: { color },
    symbol: 'circle',
    symbolSize: 5,
    connectNulls: false,
  });

  wrap.innerHTML = '<div id="pmc-curve-chart" style="height:220px"></div>'
    + '<div id="pmc-curve-summary" style="margin-top:8px;font-size:12px;color:#888;display:flex;flex-wrap:wrap;gap:8px 16px"></div>';

  if (_pmcCurveChart) { try { _pmcCurveChart.dispose(); } catch {} }
  _pmcCurveChart = echarts.init(document.getElementById('pmc-curve-chart'), 'dark', { renderer: 'svg' });

  _pmcCurveChart.setOption({
    backgroundColor: 'transparent',
    legend: { top: 4, right: 8, textStyle: { color: '#aaa', fontSize: 11 } },
    grid:   { top: 36, bottom: 36, left: 52, right: 16 },
    xAxis: {
      type: 'log',
      min: 4,
      max: 4000,
      axisLabel: {
        color: '#888',
        fontSize: 11,
        formatter: v => xLabels[v] || '',
      },
      axisLine:  { lineStyle: { color: '#444' } },
      splitLine: { lineStyle: { color: '#2a2a3a' } },
    },
    yAxis: {
      type: 'value',
      name: 'W',
      nameTextStyle: { color: '#666', fontSize: 11 },
      axisLabel:  { color: '#888', fontSize: 11 },
      splitLine:  { lineStyle: { color: '#2a2a3a' } },
      min: 0,
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#1e1e2e',
      borderColor: '#444',
      textStyle: { color: '#ddd', fontSize: 12 },
      formatter: params => {
        const x     = params[0]?.axisValue;
        const label = xLabels[x] || `${x}s`;
        const lines = [`<b>${label}</b>`];
        for (const p of params) {
          if (p.value[1] == null || p.value[1] === 0) continue;
          const w      = p.value[1];
          const wkgStr = showWkg ? ` (${(w / weight).toFixed(2)} W/kg)` : '';
          lines.push(`${p.marker}${p.seriesName}：${w} W${wkgStr}`);
        }
        return lines.join('<br/>');
      },
    },
    series: [
      makeSeries(best,   '历史最佳', '#5b9bd5', false),
      makeSeries(best90, '近90天',   '#70ad47', true),
      makeSeries(best30, '近30天',   '#f39c12', true),
    ],
  });

  // 图下数值摘要行
  const summaryEl = document.getElementById('pmc-curve-summary');
  if (summaryEl) {
    summaryEl.innerHTML = _CURVE_DURATIONS
      .filter(({ key }) => best[key] > 0)
      .map(({ key, label }) => {
        const w      = best[key];
        const wkgStr = showWkg ? ` · ${(w / weight).toFixed(2)} W/kg` : '';
        return `<span>${label}：<b style="color:#eee">${w} W</b>${wkgStr}</span>`;
      }).join('<span style="color:#333;margin:0 4px">｜</span>');
  }
}
```

- [ ] **Step 2：验证（临时测试）**

PMC 视图，DevTools Console：
```javascript
_renderPmcCurve(_pmcAllData.activities, _pmcSettings())
```
预期：表格消失，ECharts 折线图出现；X 轴 5s/1m/5m/20m/60m 对数分布；3条曲线（实/虚/虚）；图下摘要行；tooltip 正常。

- [ ] **Step 3：提交**

```bash
git add static/app.js
git commit -m "Update# static/app.js - _renderPmcCurve 改为 ECharts 对数坐标折线图"
```

---

## Task 7：接线 — 更新 `_loadAndRenderPmc` + 全面回归

**Files:**
- Modify: `static/app.js`

- [ ] **Step 1：更新 `_loadAndRenderPmc`（所有新函数已定义，现在安全接入）**

找到（约第 3164 行）：
```javascript
async function _loadAndRenderPmc() {
  if (_pmcAllData !== null) {
    const settings = _pmcSettings();
    _renderPmcCards(_pmcAllData);
    _renderPmcChart(_pmcAllData, _pmcPeriod);
    _renderPmcZones(_pmcAllData.activities, settings);
    _renderPmcCurve(_pmcAllData.activities, settings);
    return;
  }
  try {
    const res  = await fetch('/api/activities');
    const data = await res.json();
    const acts = data.activities || [];
    const settings = _pmcSettings();
    _pmcAllData = _computePMC(acts, settings);
    _pmcAllData.activities = acts;
    _renderPmcCards(_pmcAllData);
    _renderPmcChart(_pmcAllData, _pmcPeriod);
    _renderPmcZones(acts, settings);
    _renderPmcCurve(acts, settings);
  } catch (e) {
    console.error('PMC load error:', e);
  }
}
```

替换为：
```javascript
async function _loadAndRenderPmc() {
  if (_pmcAllData !== null) {
    const settings = _pmcSettings();
    const filtered = _pmcFilterActivities(_pmcAllData.activities, _pmcZonePeriod);
    _renderPmcCards(_pmcAllData);
    _renderPmcChart(_pmcAllData, _pmcPeriod);
    _renderPmcZones(filtered, settings);
    _renderPmcDist(filtered, settings);
    _renderPmcDaily(_pmcAllData.activities, settings);
    _renderPmcCurve(_pmcAllData.activities, settings);
    return;
  }
  try {
    const res  = await fetch('/api/activities');
    const data = await res.json();
    const acts = data.activities || [];
    const settings = _pmcSettings();
    _pmcAllData = _computePMC(acts, settings);
    _pmcAllData.activities = acts;
    const filtered = _pmcFilterActivities(acts, _pmcZonePeriod);
    _renderPmcCards(_pmcAllData);
    _renderPmcChart(_pmcAllData, _pmcPeriod);
    _renderPmcZones(filtered, settings);
    _renderPmcDist(filtered, settings);
    _renderPmcDaily(acts, settings);
    _renderPmcCurve(acts, settings);
  } catch (e) {
    console.error('PMC load error:', e);
  }
}
```

注意：`_renderPmcDaily` 和 `_renderPmcCurve` 始终使用全量 `acts`，不受时段筛选影响。

- [ ] **Step 2：全功能回归**

刷新 PMC 视图（硬刷新 Cmd+Shift+R 清缓存），逐项检查：

1. ✅ CTL/ATL/TSB 图、顶部卡片数据无变化
2. ✅ "训练区间分布 · 骑行时间"正常显示，右侧有4个筛选按钮
3. ✅ 点击"近1月"：功率区间条 + 4张分布图同步更新；点"全部"还原
4. ✅ "单次骑行分布"：骑行时长/距离/爬升/TSS 四块，每块4行进度条，有数据或"暂无数据"
5. ✅ "近30天每日训练"：5张柱状图（距离/时间/爬升/TSS/次数），今天蓝色高亮
6. ✅ "峰值功率曲线"：ECharts 折线图，对数 X 轴，3条线，图下摘要行
7. ✅ 关闭 PMC 视图再重开：dispose 生效，无重叠渲染
8. ✅ 切换 Activities/Map/Files/Calendar 视图无异常
9. ✅ DevTools Console 无 JS 报错

- [ ] **Step 3：最终提交**

```bash
git add static/app.js
git commit -m "Update# static/app.js - 接入所有 PMC 新渲染函数至 _loadAndRenderPmc"
```
