# 热图实时风向箭头叠加设计

**日期：** 2026-06-09
**状态：** 待实现

## 概述

在 detail view 的路线热图中，当用户悬停图表时，已有 `L.circleMarker` 跟随定位到对应 GPS 点。本功能在该标记点旁增加一个实时风向箭头 `L.marker`，显示骑手当前位置的风向（从哪里来）、风速，以及逆/顺/侧风分类颜色，使风力对骑行的影响直观可见。

## 数据流

```
openDetailView(id)
  └── 异步 fetch /api/weather/<filename>
        └── 存入 _detailWindData（含 hourly 原始数组 + start_epoch）

用户 hover ECharts 图表
  └── ZRender mousemove → _updateDetailRouteMarker(dataIdx)
        ├── 已有：circleMarker 定位到 GPS 点 coords[lo]
        └── 新增：若 _detailWindData 存在
              ├── elapsed_s = targetDist / totalDist × _detailTotalDurationS
              ├── 查 hourly → wind_dir + wind_speed（对应小时）
              ├── _bearingAtIndex(lo) → 骑行方向
              ├── _windEffect(bearing, windFromDir) → headwind|tailwind|crosswind
              └── 更新 _detailWindArrow（divIcon 旋转箭头）

mouseout → _hideDetailRouteMarker
  └── 新增：移除 _detailWindArrow（同 circleMarker 60ms debounce）

closeDetailView
  └── 新增：清空 _detailWindData, _detailWindArrow
```

## 后端变更

### `/api/weather/<filename>` 返回新增字段

```json
{
  "available": true,
  "wind_speed_avg_kmh": 12.4,
  "wind_dir_deg": 45,
  "wind_dir_label": "东北风",
  "gust_max_kmh": 18.0,
  "headwind_pct": 41,
  "tailwind_pct": 28,
  "crosswind_pct": 31,
  "start_epoch": 1724150434,
  "hourly": {
    "time": ["2025-08-20T10:00", "2025-08-20T11:00"],
    "windspeed_10m": [12.5, 11.8],
    "winddirection_10m": [45.0, 48.0]
  }
}
```

`start_epoch`：整数 Unix 时间戳（秒），来自 `start_time_utc`。用于客户端将 `elapsed_s` 换算到绝对时间再查对应 hourly slot。

`hourly`：直接透传 Open-Meteo 返回的 `hourly.time`, `hourly.windspeed_10m`, `hourly.winddirection_10m`（仅这三个字段，不含 gusts）。

## 前端变更

### 新增模块状态

```javascript
let _detailWindData = null;       // weather response（含 hourly）
let _detailWindArrow = null;      // L.marker 风向箭头
let _detailTotalDurationS = 0;    // 骑行总时长（秒），用于 elapsed_s 计算
```

### `openDetailView` 末尾添加异步 weather fetch

```javascript
// 重置风向状态（map.remove() 已销毁旧 marker，nullify 引用即可）
_detailWindData = null;
_detailWindArrow = null;
_detailTotalDurationS = t.summary?.total_duration_s || t.summary?.moving_time_s || 0;
fetch(`/api/weather/${encodeURIComponent(t.name)}`)
  .then(r => r.ok ? r.json() : null)
  .then(d => { if (d?.available && d.hourly) _detailWindData = d; })
  .catch(() => {});
```

### `closeDetailView` 清理新状态

```javascript
_detailWindData = null;
if (_detailWindArrow && detailRouteMap) {
  detailRouteMap.removeLayer(_detailWindArrow);
}
_detailWindArrow = null;
```

### `_updateDetailRouteMarker` 末尾扩展（在现有 circleMarker 逻辑后追加）

```javascript
// Wind arrow overlay
if (_detailWindData?.hourly && _detailTotalDurationS > 0) {
  const totalDist = _detailRouteCumDist[_detailRouteCumDist.length - 1];
  const elapsedS  = (targetDist / Math.max(totalDist, 1)) * _detailTotalDurationS;
  const wind = _getHourlyWind(
    _detailWindData.hourly,
    _detailWindData.start_epoch,
    elapsedS
  );
  if (wind) {
    const bearing = _bearingAtIndex(lo);
    const effect  = _windEffect(bearing, wind.dir);
    const color   = effect === 'headwind' ? '#e74c3c'
                  : effect === 'tailwind' ? '#27ae60' : '#f39c12';
    const icon = L.divIcon({
      className: '',
      html: `<div style="transform:rotate(${wind.dir}deg);color:${color};font-size:20px;line-height:1;text-shadow:0 0 3px #000;text-align:center">▲</div>`
           + `<div style="font-size:10px;color:#fff;text-align:center;text-shadow:0 0 2px #000;white-space:nowrap">${wind.speed} km/h</div>`,
      iconSize: [40, 36],
      iconAnchor: [20, 18],
    });
    if (!_detailWindArrow) {
      _detailWindArrow = L.marker(latlng, { icon, interactive: false }).addTo(detailRouteMap);
    } else {
      _detailWindArrow.setLatLng(latlng);
      _detailWindArrow.setIcon(icon);
    }
  }
}
```

### `_hideDetailRouteMarker` 扩展（60ms debounce 内同步移除箭头）

```javascript
function _hideDetailRouteMarker() {
  _detailRouteHideTimer = setTimeout(() => {
    _detailRouteHideTimer = null;
    if (_detailRouteMarker && detailRouteMap) {
      detailRouteMap.removeLayer(_detailRouteMarker);
      _detailRouteMarker = null;
    }
    if (_detailWindArrow && detailRouteMap) {
      detailRouteMap.removeLayer(_detailWindArrow);
      _detailWindArrow = null;
    }
  }, 60);
}
```

### 新增纯辅助函数

```javascript
function _getHourlyWind(hourly, startEpoch, elapsedS) {
  const times  = hourly.time || [];
  const speeds = hourly.windspeed_10m || [];
  const dirs   = hourly.winddirection_10m || [];
  const targetHour = Math.floor((startEpoch + elapsedS) / 3600);
  for (let i = 0; i < times.length; i++) {
    const h = Math.floor(new Date(times[i] + 'Z').getTime() / 3_600_000);
    if (h === targetHour) return { speed: Math.round(speeds[i] * 10) / 10, dir: dirs[i] };
  }
  return null;
}

function _bearingAtIndex(idx) {
  const coords = _detailRouteCoords;
  const i1 = Math.min(idx + 1, coords.length - 1);
  if (i1 === idx) return 0;
  const dlat = coords[i1][0] - coords[idx][0];
  const dlon = coords[i1][1] - coords[idx][1];
  const latM = Math.PI / 180 * ((coords[idx][0] + coords[i1][0]) / 2);
  return (Math.atan2(dlon * Math.cos(latM), dlat) * 180 / Math.PI + 360) % 360;
}

function _windEffect(bearing, windFromDir) {
  const rel = (bearing - windFromDir + 360) % 360;
  if (rel < 45 || rel > 315) return 'headwind';
  if (rel > 135 && rel < 225) return 'tailwind';
  return 'crosswind';
}
```

## 箭头视觉说明

- `▲` 字符通过 `transform: rotate(wind_dir_deg)` 旋转，使其指向风来的方向（与 `_windDirArrow` 相反）
  - 0° = 北风 → 箭头朝上（从北方吹来）
  - 90° = 东风 → 箭头朝右
- 颜色编码：逆风 `#e74c3c` 红 / 顺风 `#27ae60` 绿 / 侧风 `#f39c12` 橙
- 风速数字显示在箭头正下方
- `interactive: false` 避免箭头遮挡地图交互

## 改动文件

| 文件 | 改动 |
|---|---|
| `app.py` | `weather_for_activity` 新增 `start_epoch` + `hourly` 字段到响应 |
| `static/app.js` | 新增 3 个状态变量；`openDetailView` 末尾 fetch；`closeDetailView` 清理；`_updateDetailRouteMarker` 末尾扩展；`_hideDetailRouteMarker` 扩展；新增 3 个辅助函数 |
