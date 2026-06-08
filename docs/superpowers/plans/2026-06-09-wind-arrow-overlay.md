# 热图实时风向箭头叠加 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 detail view 路线热图上，图表 hover 时随跟随标记点显示实时风向箭头（方向+风速+逆/顺/侧风颜色）。

**Architecture:** 后端 `/api/weather/<filename>` 响应新增 `start_epoch` 和 `hourly` 原始字段；前端 `openDetailView` 异步预加载风数据，`_updateDetailRouteMarker` 在已有 circleMarker 逻辑后追加风向箭头 `L.marker`（divIcon 旋转 ▲），`_hideDetailRouteMarker` 同步移除。

**Tech Stack:** Python `datetime` (stdlib), Flask `jsonify`, Leaflet `L.marker` + `L.divIcon`, Vanilla JS

---

## File Map

| File | Change |
|---|---|
| `app.py` | `weather_for_activity`：result 追加 `start_epoch` + `hourly` 字段 |
| `static/app.js` | 新增 3 个状态变量、3 个辅助函数；扩展 `openDetailView`、`closeDetailView`、`_updateDetailRouteMarker`、`_hideDetailRouteMarker` |
| `tests/test_wind.py` | 追加 1 个端点测试验证新字段 |

---

## Task 1: 后端 — weather 响应新增 `start_epoch` + `hourly`

**Files:**
- Modify: `app.py` (lines 1122–1128, `weather_for_activity` 函数末尾)
- Test: `tests/test_wind.py` (追加)

- [ ] **Step 1: 写失败测试**

追加到 `tests/test_wind.py`（在文件末尾，`client` fixture 已存在，无需重写）：

```python
def test_weather_endpoint_includes_hourly_fields(client):
    with patch("app._parse_and_build", return_value=_fake_cached()), \
         patch("app._cache_get", return_value=None), \
         patch("app._disk_cache_load", return_value=None):
        mock_resp = MagicMock()
        mock_resp.raise_for_status = lambda: None
        mock_resp.json.return_value = _fake_openmeteo()
        with patch("requests.get", return_value=mock_resp):
            r = client.get("/api/weather/test.fit")
    data = r.get_json()
    assert data["available"] is True
    assert isinstance(data.get("start_epoch"), int)
    assert data["start_epoch"] > 0
    assert "hourly" in data
    assert "time" in data["hourly"]
    assert "windspeed_10m" in data["hourly"]
    assert "winddirection_10m" in data["hourly"]
    assert "windgusts_10m" not in data["hourly"]
```

- [ ] **Step 2: 运行确认失败**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && venv/bin/python -m pytest tests/test_wind.py::test_weather_endpoint_includes_hourly_fields -v
```

Expected: FAIL — `assert None is int`（字段不存在）

- [ ] **Step 3: 修改 `weather_for_activity`**

在 `app.py` 找到（约 1122–1128 行）：

```python
    try:
        result = _wind_stats(coords, start_time_utc, km_stats, data.get("hourly", {}))
    except Exception as e:
        logging.warning("weather: _wind_stats failed %s: %s", filename, e)
        return jsonify(available=False)
    _weather_cache[_wkey] = result
    return jsonify(result)
```

替换为：

```python
    try:
        result = _wind_stats(coords, start_time_utc, km_stats, data.get("hourly", {}))
    except Exception as e:
        logging.warning("weather: _wind_stats failed %s: %s", filename, e)
        return jsonify(available=False)
    if result.get("available"):
        result["start_epoch"] = int(
            datetime.fromisoformat(start_time_utc.replace("Z", "+00:00")).timestamp()
        )
        hourly_raw = data.get("hourly", {})
        result["hourly"] = {
            k: hourly_raw[k]
            for k in ("time", "windspeed_10m", "winddirection_10m")
            if k in hourly_raw
        }
    _weather_cache[_wkey] = result
    return jsonify(result)
```

- [ ] **Step 4: 运行新测试 + 全套**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && venv/bin/python -m pytest tests/ -v
```

Expected: 30 PASSED（新增 1 条）

- [ ] **Step 5: Commit**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && git add app.py tests/test_wind.py && git commit -m "Add# app.py tests/test_wind.py - weather 响应新增 start_epoch/hourly 字段"
```

---

## Task 2: 前端 — 风向箭头状态变量 + 辅助函数

**Files:**
- Modify: `static/app.js`（状态变量块 ~172 行；`_hideDetailRouteMarker` 之后 ~2420 行）

- [ ] **Step 1: 新增 3 个状态变量**

在 `static/app.js` 找到（约 171–172 行）：

```javascript
let _detailRouteMarker = null;
let _detailRouteHideTimer = null;
```

替换为：

```javascript
let _detailRouteMarker = null;
let _detailRouteHideTimer = null;
let _detailWindData = null;
let _detailWindArrow = null;
let _detailTotalDurationS = 0;
```

- [ ] **Step 2: 新增 3 个辅助函数**

在 `static/app.js` 找到（约 2421 行）：

```javascript
function _detailRouteFitBounds() {
```

在其**前方**插入：

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

- [ ] **Step 3: 语法检查**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && node --check static/app.js && echo "JS OK"
```

Expected: `JS OK`

- [ ] **Step 4: Commit**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && git add static/app.js && git commit -m "Add# static/app.js - 风向箭头状态变量与辅助函数"
```

---

## Task 3: 前端 — 扩展 `openDetailView` + `closeDetailView`

**Files:**
- Modify: `static/app.js` (`openDetailView` ~1651 行；`closeDetailView` ~1663 行)

- [ ] **Step 1: 扩展 `openDetailView`**

在 `static/app.js` 找到（约 1651 行）：

```javascript
  _renderDetailRoute();
}
```

替换为：

```javascript
  _renderDetailRoute();
  // Wind arrow state reset (detailRouteMap.remove() already disposed old markers)
  _detailWindData = null;
  _detailWindArrow = null;
  _detailTotalDurationS = t.summary?.total_duration_s || t.summary?.moving_time_s || 0;
  fetch(`/api/weather/${encodeURIComponent(t.name)}`)
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d?.available && d.hourly) _detailWindData = d; })
    .catch(() => {});
}
```

- [ ] **Step 2: 扩展 `closeDetailView`**

在 `static/app.js` 找到（约 1663 行）：

```javascript
  if (_detailRouteHideTimer) { clearTimeout(_detailRouteHideTimer); _detailRouteHideTimer = null; }
  _detailRouteMarker = null;
  _detailRouteCoords = null;
  _detailRouteCumDist = null;
```

替换为：

```javascript
  if (_detailRouteHideTimer) { clearTimeout(_detailRouteHideTimer); _detailRouteHideTimer = null; }
  _detailRouteMarker = null;
  _detailRouteCoords = null;
  _detailRouteCumDist = null;
  if (_detailWindArrow && detailRouteMap) detailRouteMap.removeLayer(_detailWindArrow);
  _detailWindArrow = null;
  _detailWindData = null;
```

- [ ] **Step 3: 语法检查**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && node --check static/app.js && echo "JS OK"
```

Expected: `JS OK`

- [ ] **Step 4: Flask 导入检查**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && python -c "import app; print('OK')"
```

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && git add static/app.js && git commit -m "Update# static/app.js - openDetailView/closeDetailView 风向预加载与清理"
```

---

## Task 4: 前端 — 扩展 `_updateDetailRouteMarker` + `_hideDetailRouteMarker`

**Files:**
- Modify: `static/app.js` (`_updateDetailRouteMarker` ~2403–2410 行；`_hideDetailRouteMarker` ~2412–2419 行)

- [ ] **Step 1: 扩展 `_updateDetailRouteMarker`**

在 `static/app.js` 找到（约 2403–2410 行）：

```javascript
  if (!_detailRouteMarker) {
    _detailRouteMarker = L.circleMarker(latlng, {
      radius: 6, color: '#fff', weight: 2, fillColor: '#2e86de', fillOpacity: 1,
    }).addTo(detailRouteMap);
  } else {
    _detailRouteMarker.setLatLng(latlng);
  }
}
```

替换为：

```javascript
  if (!_detailRouteMarker) {
    _detailRouteMarker = L.circleMarker(latlng, {
      radius: 6, color: '#fff', weight: 2, fillColor: '#2e86de', fillOpacity: 1,
    }).addTo(detailRouteMap);
  } else {
    _detailRouteMarker.setLatLng(latlng);
  }

  if (_detailWindData?.hourly && _detailTotalDurationS > 0 && detailRouteMap) {
    const totalDist = _detailRouteCumDist[_detailRouteCumDist.length - 1];
    const elapsedS  = (targetDist / Math.max(totalDist, 1)) * _detailTotalDurationS;
    const wind = _getHourlyWind(_detailWindData.hourly, _detailWindData.start_epoch, elapsedS);
    if (wind) {
      const bearing = _bearingAtIndex(lo);
      const effect  = _windEffect(bearing, wind.dir);
      const color   = effect === 'headwind' ? '#e74c3c' : effect === 'tailwind' ? '#27ae60' : '#f39c12';
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
}
```

- [ ] **Step 2: 扩展 `_hideDetailRouteMarker`**

在 `static/app.js` 找到（约 2412–2420 行）：

```javascript
function _hideDetailRouteMarker() {
  _detailRouteHideTimer = setTimeout(() => {
    _detailRouteHideTimer = null;
    if (_detailRouteMarker && detailRouteMap) {
      detailRouteMap.removeLayer(_detailRouteMarker);
      _detailRouteMarker = null;
    }
  }, 60);
}
```

替换为：

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

- [ ] **Step 3: 语法检查**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && node --check static/app.js && echo "JS OK"
```

Expected: `JS OK`

- [ ] **Step 4: 全套测试**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && venv/bin/python -m pytest tests/ -v
```

Expected: 30 PASSED

- [ ] **Step 5: 手动冒烟测试**

1. 启动 Flask：`venv/bin/python app.py`
2. 打开 `http://localhost:5173`
3. 点击任意有 GPS 数据的活动卡片 → 进入详情页
4. 等待约 1–2 秒（weather 异步加载）
5. 悬停在任意 ECharts 图表上移动鼠标
6. 验证：路线热图上跟随标记点旁出现旋转 ▲ 箭头 + 风速数字
7. 验证：移开鼠标 60ms 后箭头消失
8. 验证：箭头颜色与逆/顺/侧风吻合（逆风红/顺风绿/侧风橙）
9. 对无 GPS 或 Open-Meteo 不可用的活动：悬停时只有圆点，无箭头（静默降级）

- [ ] **Step 6: Commit**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && git add static/app.js && git commit -m "Add# static/app.js - 热图悬停标记点实时风向箭头叠加"
```

---

## Spec Coverage Check

| 需求 | Task |
|---|---|
| `start_epoch` 整数字段 | Task 1 Step 3 |
| `hourly.time/windspeed_10m/winddirection_10m` | Task 1 Step 3 |
| `windgusts_10m` 不暴露到前端 | Task 1 Step 3 (dict comprehension 过滤) |
| `_detailWindData/Arrow/TotalDurationS` 状态 | Task 2 Step 1 |
| `_getHourlyWind` 函数 | Task 2 Step 2 |
| `_bearingAtIndex` 函数（含 cos(lat) 补偿） | Task 2 Step 2 |
| `_windEffect` 函数 | Task 2 Step 2 |
| `openDetailView` 异步 fetch + 状态重置 | Task 3 Step 1 |
| `closeDetailView` 清理 | Task 3 Step 2 |
| `_updateDetailRouteMarker` 风向箭头更新 | Task 4 Step 1 |
| `_hideDetailRouteMarker` 箭头移除 | Task 4 Step 2 |
| `interactive: false` 防遮挡 | Task 4 Step 1 |
| 静默降级（无数据时无箭头） | Task 3 Step 1 (`if d?.available && d.hourly`) |
