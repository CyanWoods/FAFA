# 风速气象集成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 AI 活动评估中集成 Open-Meteo 历史风速数据，计算顺/逆/侧风比例，在弹窗头部显示气象小卡片，并注入 AI prompt。

**Architecture:** 新增 `GET /api/weather/<filename>` 端点从缓存读取坐标与时间，调 Open-Meteo archive API，计算风况统计后返回 JSON；前端 `openActAiModal` 并行请求天气与 km_stats，头部渲染气象 chips，wind_data 注入 evaluate 请求体与 AI prompt。

**Tech Stack:** Python `math` (stdlib), `requests` (already used in app.py), Open-Meteo free archive API (no key), Vanilla JS `Promise.all`

---

## File Map

| File | Change |
|---|---|
| `app.py` | Add `import math`; add `_wind_dir_label()`, `_wind_stats()` before line 700; add `/api/weather/<filename>` endpoint after `ai_evaluate`; modify `_build_eval_prompt` signature + body; modify `ai_evaluate` to accept `wind_data` |
| `static/app.js` | Replace `openActAiModal` (lines 4701–4714); add `_windDirArrow()` helper |
| `tests/test_wind.py` | New: unit tests for `_wind_stats`, `_wind_dir_label`, weather endpoint, prompt builder |

---

## Task 1: Pure functions `_wind_dir_label` + `_wind_stats`

**Files:**
- Modify: `app.py` (add `import math` at line 9; add two functions before line 700)
- Test: `tests/test_wind.py` (new file)

- [ ] **Step 1: Add `import math` to app.py**

In `app.py`, find the imports block (line 9 area). Add `import math` after `import bisect`:

```python
import bisect
import math          # ← add this line
import io
```

- [ ] **Step 2: Write the failing tests for `_wind_dir_label`**

Create `tests/test_wind.py`:

```python
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app import _wind_dir_label, _wind_stats


def test_wind_dir_label_north():
    assert _wind_dir_label(0) == "北风"
    assert _wind_dir_label(360) == "北风"
    assert _wind_dir_label(355) == "北风"

def test_wind_dir_label_northeast():
    assert _wind_dir_label(45) == "东北风"

def test_wind_dir_label_east():
    assert _wind_dir_label(90) == "东风"

def test_wind_dir_label_south():
    assert _wind_dir_label(180) == "南风"

def test_wind_dir_label_southwest():
    assert _wind_dir_label(225) == "西南风"
```

- [ ] **Step 3: Run tests — expect ImportError (functions not defined yet)**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && python -m pytest tests/test_wind.py::test_wind_dir_label_north -v
```

Expected: `ImportError: cannot import name '_wind_dir_label'`

- [ ] **Step 4: Add `_wind_dir_label` and `_wind_stats` to app.py**

Insert both functions immediately before the line `def _build_eval_prompt(` (currently line 701). The full insertion:

```python
def _wind_dir_label(deg: float) -> str:
    labels = ["北风", "东北风", "东风", "东南风", "南风", "西南风", "西风", "西北风"]
    return labels[round(deg / 45) % 8]


def _wind_stats(
    coords: list,
    start_time_utc: str,
    km_stats: list,
    hourly: dict,
) -> dict:
    """
    Compute headwind/tailwind/crosswind percentages from GPS track and hourly wind data.

    coords       : [[lat, lon], ...] — any CRS, used only for bearing (tiny offset OK)
    start_time_utc: ISO-8601 UTC string, e.g. "2025-08-20T10:40:34Z"
    km_stats     : list of dicts with 'duration_s' key
    hourly       : Open-Meteo response['hourly'] with keys time / windspeed_10m /
                   winddirection_10m / windgusts_10m
    """
    from datetime import timezone as _tz

    start_dt = datetime.fromisoformat(start_time_utc.replace("Z", "+00:00"))
    total_s = sum(s.get("duration_s", 0) for s in km_stats) if km_stats else 0

    # Build hourly lookup keyed by integer epoch-hour
    times  = hourly.get("time", [])
    speeds = hourly.get("windspeed_10m", [])
    dirs   = hourly.get("winddirection_10m", [])
    gusts  = hourly.get("windgusts_10m", [])
    hour_data: dict[int, tuple] = {}
    for i, t in enumerate(times):
        dt = datetime.fromisoformat(t).replace(tzinfo=_tz.utc)
        h  = int(dt.timestamp()) // 3600
        hour_data[h] = (
            speeds[i] if i < len(speeds) else None,
            dirs[i]   if i < len(dirs)   else None,
            gusts[i]  if i < len(gusts)  else None,
        )

    # Cumulative distance per coord index (metres, flat-earth approximation)
    n = len(coords)
    cum_dist = [0.0]
    for i in range(1, n):
        dlat = math.radians(coords[i][0] - coords[i - 1][0])
        dlon = math.radians(coords[i][1] - coords[i - 1][1])
        lat_m = math.radians((coords[i][0] + coords[i - 1][0]) / 2)
        d = math.sqrt((dlat * 6_371_000) ** 2 + (dlon * 6_371_000 * math.cos(lat_m)) ** 2)
        cum_dist.append(cum_dist[-1] + d)
    total_dist = cum_dist[-1]

    head = tail = cross = 0.0
    spd_sum = spd_n = 0
    gust_max = 0.0
    dir_sin = dir_cos = 0.0

    for i in range(1, n):
        seg = cum_dist[i] - cum_dist[i - 1]
        if seg < 1:
            continue

        # Estimate elapsed seconds at segment midpoint
        mid = (cum_dist[i - 1] + cum_dist[i]) / 2
        elapsed = (mid / total_dist * total_s) if total_dist > 0 else 0

        h_key = int((start_dt.timestamp() + elapsed) / 3600)
        wind = hour_data.get(h_key)
        if wind is None:
            continue
        w_spd, w_dir, w_gust = wind
        if w_spd is None or w_dir is None:
            continue

        # Bearing of travel: atan2(dlon, dlat) → 0=N, 90=E, 180=S, 270=W
        dlat = coords[i][0] - coords[i - 1][0]
        dlon = coords[i][1] - coords[i - 1][1]
        bearing = (math.degrees(math.atan2(dlon, dlat)) + 360) % 360

        # Relative angle between travel direction and wind-from direction
        rel = (bearing - w_dir + 360) % 360
        if rel < 45 or rel > 315:
            head += seg
        elif 135 < rel < 225:
            tail += seg
        else:
            cross += seg

        spd_sum += w_spd
        spd_n   += 1
        if w_gust is not None:
            gust_max = max(gust_max, w_gust)
        dir_sin += math.sin(math.radians(w_dir))
        dir_cos += math.cos(math.radians(w_dir))

    classified = head + tail + cross
    if classified == 0 or spd_n == 0:
        return {"available": False}

    head_pct  = round(100 * head  / classified)
    tail_pct  = round(100 * tail  / classified)
    cross_pct = 100 - head_pct - tail_pct  # ensure sum == 100

    avg_spd = round(spd_sum / spd_n, 1)
    avg_dir = (math.degrees(math.atan2(dir_sin / spd_n, dir_cos / spd_n)) + 360) % 360

    return {
        "available":         True,
        "wind_speed_avg_kmh": avg_spd,
        "wind_dir_deg":      round(avg_dir),
        "wind_dir_label":    _wind_dir_label(avg_dir),
        "gust_max_kmh":      round(gust_max, 1),
        "headwind_pct":      head_pct,
        "tailwind_pct":      tail_pct,
        "crosswind_pct":     cross_pct,
    }
```

- [ ] **Step 5: Run label tests — expect PASS**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && python -m pytest tests/test_wind.py::test_wind_dir_label_north tests/test_wind.py::test_wind_dir_label_northeast tests/test_wind.py::test_wind_dir_label_east tests/test_wind.py::test_wind_dir_label_south tests/test_wind.py::test_wind_dir_label_southwest -v
```

Expected: 5 PASSED

- [ ] **Step 6: Write `_wind_stats` tests**

Append to `tests/test_wind.py`:

```python
def _make_hourly(wind_dir, wind_spd=15.0, gust=20.0, hour="2025-08-20T10:00"):
    return {
        "time":               [hour],
        "windspeed_10m":      [wind_spd],
        "winddirection_10m":  [wind_dir],
        "windgusts_10m":      [gust],
    }


def test_wind_stats_headwind():
    # Going north (increasing lat), wind from north (0°) → headwind
    coords = [[0.0, 0.0], [0.01, 0.0], [0.02, 0.0]]
    km_stats = [{"km": 1, "duration_s": 1800}]
    result = _wind_stats(coords, "2025-08-20T10:00:00Z", km_stats, _make_hourly(0.0))
    assert result["available"] is True
    assert result["headwind_pct"] > 50


def test_wind_stats_tailwind():
    # Going north, wind from south (180°) → tailwind
    coords = [[0.0, 0.0], [0.01, 0.0], [0.02, 0.0]]
    km_stats = [{"km": 1, "duration_s": 1800}]
    result = _wind_stats(coords, "2025-08-20T10:00:00Z", km_stats, _make_hourly(180.0))
    assert result["available"] is True
    assert result["tailwind_pct"] > 50


def test_wind_stats_crosswind():
    # Going north, wind from east (90°) → crosswind
    coords = [[0.0, 0.0], [0.01, 0.0], [0.02, 0.0]]
    km_stats = [{"km": 1, "duration_s": 1800}]
    result = _wind_stats(coords, "2025-08-20T10:00:00Z", km_stats, _make_hourly(90.0))
    assert result["available"] is True
    assert result["crosswind_pct"] > 50


def test_wind_stats_pct_sum_100():
    coords = [[0.0, 0.0], [0.01, 0.0], [0.02, 0.01], [0.03, -0.01], [0.04, 0.0]]
    km_stats = [{"km": 1, "duration_s": 1800}, {"km": 2, "duration_s": 1800}]
    result = _wind_stats(coords, "2025-08-20T10:00:00Z", km_stats, _make_hourly(45.0))
    assert result["available"] is True
    assert result["headwind_pct"] + result["tailwind_pct"] + result["crosswind_pct"] == 100


def test_wind_stats_no_gps():
    result = _wind_stats([], "2025-08-20T10:00:00Z", [], _make_hourly(0.0))
    assert result["available"] is False


def test_wind_stats_no_hourly_match():
    # Hour in hourly doesn't overlap ride time
    coords = [[0.0, 0.0], [0.01, 0.0]]
    km_stats = [{"km": 1, "duration_s": 1800}]
    hourly = _make_hourly(0.0, hour="2020-01-01T00:00")  # far past
    result = _wind_stats(coords, "2025-08-20T10:00:00Z", km_stats, hourly)
    assert result["available"] is False
```

- [ ] **Step 7: Run `_wind_stats` tests — expect PASS**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && python -m pytest tests/test_wind.py -v
```

Expected: all 11 tests PASS

- [ ] **Step 8: Commit**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && git add app.py tests/test_wind.py && git commit -m "Add# app.py tests/test_wind.py - 风况计算纯函数 _wind_stats/_wind_dir_label"
```

---

## Task 2: `/api/weather/<filename>` endpoint

**Files:**
- Modify: `app.py` (add endpoint after `ai_evaluate`, around line 916)
- Test: `tests/test_wind.py` (append)

- [ ] **Step 1: Write the failing endpoint tests**

Append to `tests/test_wind.py`:

```python
import pytest
from unittest.mock import patch, MagicMock
import app as flask_app


@pytest.fixture
def client():
    flask_app.app.config["TESTING"] = True
    with flask_app.app.test_client() as c:
        yield c


def _fake_cached(is_gcj02=False):
    return {
        "coords": [[31.2, 121.5], [31.21, 121.51], [31.22, 121.52]],
        "start_time_utc": "2025-08-20T10:40:34Z",
        "is_gcj02": is_gcj02,
        "km_stats": [{"km": 1, "duration_s": 1800}],
    }


def _fake_openmeteo():
    return {
        "hourly": {
            "time":               ["2025-08-20T10:00"],
            "windspeed_10m":      [12.5],
            "winddirection_10m":  [45.0],
            "windgusts_10m":      [18.0],
        }
    }


def test_weather_endpoint_ok(client):
    with patch("app._parse_and_build", return_value=_fake_cached()), \
         patch("app._cache_get", return_value=None), \
         patch("app._disk_cache_load", return_value=None):
        import requests as _req
        mock_resp = MagicMock()
        mock_resp.ok = True
        mock_resp.raise_for_status = lambda: None
        mock_resp.json.return_value = _fake_openmeteo()
        with patch("requests.get", return_value=mock_resp):
            r = client.get("/api/weather/test.fit")
    assert r.status_code == 200
    data = r.get_json()
    assert data["available"] is True
    assert "wind_speed_avg_kmh" in data
    assert "headwind_pct" in data
    assert data["headwind_pct"] + data["tailwind_pct"] + data["crosswind_pct"] == 100


def test_weather_endpoint_no_gps(client):
    cached = _fake_cached()
    cached["coords"] = []
    with patch("app._parse_and_build", return_value=cached), \
         patch("app._cache_get", return_value=None), \
         patch("app._disk_cache_load", return_value=None):
        r = client.get("/api/weather/test.fit")
    assert r.status_code == 200
    assert r.get_json()["available"] is False


def test_weather_endpoint_openmeteo_fails(client):
    with patch("app._parse_and_build", return_value=_fake_cached()), \
         patch("app._cache_get", return_value=None), \
         patch("app._disk_cache_load", return_value=None):
        with patch("requests.get", side_effect=Exception("timeout")):
            r = client.get("/api/weather/test.fit")
    assert r.status_code == 200
    assert r.get_json()["available"] is False
```

- [ ] **Step 2: Run tests — expect 404 (route not yet defined)**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && python -m pytest tests/test_wind.py::test_weather_endpoint_ok -v
```

Expected: FAIL — `assert 404 == 200` or similar

- [ ] **Step 3: Add `/api/weather/<filename>` endpoint to app.py**

Insert after the closing of `ai_evaluate` (after line ~915), before the `# ── 活动列表` section:

```python
@app.route("/api/weather/<path:filename>")
def weather_for_activity(filename: str):
    from fafa.gcj02 import gcj02_to_wgs84
    import requests as _req

    # Security: prevent path traversal
    path = (INPUT_DIR / filename).resolve()
    if path.parent != INPUT_DIR.resolve():
        return jsonify(available=False)

    try:
        mtime  = path.stat().st_mtime if path.exists() else None
        cached = _cache_get(str(path), mtime) if mtime else None
        if cached is None:
            cached = _disk_cache_load(str(path), mtime) if mtime else None
        if cached is None:
            cached = _parse_and_build(str(path), filename)
    except Exception as e:
        logging.warning("weather: load failed %s: %s", filename, e)
        return jsonify(available=False)

    coords         = cached.get("coords") or []
    start_time_utc = cached.get("start_time_utc")
    is_gcj02       = cached.get("is_gcj02", False)
    km_stats       = cached.get("km_stats") or []

    if not coords or not start_time_utc:
        return jsonify(available=False)

    # WGS-84 start point for API request
    lat, lon = coords[0]
    if is_gcj02:
        lat, lon = gcj02_to_wgs84(lat, lon)

    start_dt   = datetime.fromisoformat(start_time_utc.replace("Z", "+00:00"))
    total_s    = sum(s.get("duration_s", 0) for s in km_stats)
    end_dt     = start_dt + timedelta(seconds=max(total_s, 3600))
    start_date = start_dt.strftime("%Y-%m-%d")
    end_date   = end_dt.strftime("%Y-%m-%d")

    try:
        resp = _req.get(
            "https://archive-api.open-meteo.com/v1/archive",
            params={
                "latitude":        round(lat, 6),
                "longitude":       round(lon, 6),
                "start_date":      start_date,
                "end_date":        end_date,
                "hourly":          "windspeed_10m,winddirection_10m,windgusts_10m",
                "wind_speed_unit": "kmh",
                "timezone":        "UTC",
            },
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        logging.warning("weather: Open-Meteo failed %s: %s", filename, e)
        return jsonify(available=False)

    result = _wind_stats(coords, start_time_utc, km_stats, data.get("hourly", {}))
    return jsonify(result)
```

- [ ] **Step 4: Run endpoint tests — expect PASS**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && python -m pytest tests/test_wind.py::test_weather_endpoint_ok tests/test_wind.py::test_weather_endpoint_no_gps tests/test_wind.py::test_weather_endpoint_openmeteo_fails -v
```

Expected: 3 PASSED

- [ ] **Step 5: Run full test suite — expect no regressions**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && python -m pytest tests/ -v
```

Expected: all PASSED

- [ ] **Step 6: Commit**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && git add app.py tests/test_wind.py && git commit -m "Add# app.py - /api/weather/<filename> 端点接入 Open-Meteo"
```

---

## Task 3: `_build_eval_prompt` 风况章节 + `ai_evaluate` 接收 `wind_data`

**Files:**
- Modify: `app.py` lines ~701 (`_build_eval_prompt`) and ~904 (`ai_evaluate`)
- Test: `tests/test_wind.py` (append)

- [ ] **Step 1: Write failing prompt tests**

Append to `tests/test_wind.py`:

```python
from app import _build_eval_prompt


def _sample_wind(headwind_pct=41):
    return {
        "available":          True,
        "wind_speed_avg_kmh": 12.4,
        "gust_max_kmh":       18.0,
        "wind_dir_deg":       45,
        "wind_dir_label":     "东北风",
        "headwind_pct":       headwind_pct,
        "tailwind_pct":       28,
        "crosswind_pct":      100 - headwind_pct - 28,
    }


def test_prompt_includes_wind_section():
    prompt = _build_eval_prompt({}, [], "test.fit", "2025-08-20T10:00:00",
                                 wind_data=_sample_wind())
    assert "气象条件" in prompt
    assert "东北风" in prompt
    assert "逆风：41%" in prompt


def test_prompt_headwind_warning_shown():
    prompt = _build_eval_prompt({}, [], "test.fit", "2025-08-20T10:00:00",
                                 wind_data=_sample_wind(headwind_pct=41))
    assert "逆风比例偏高" in prompt


def test_prompt_headwind_warning_hidden():
    prompt = _build_eval_prompt({}, [], "test.fit", "2025-08-20T10:00:00",
                                 wind_data=_sample_wind(headwind_pct=20))
    assert "逆风比例偏高" not in prompt


def test_prompt_no_wind_data():
    prompt = _build_eval_prompt({}, [], "test.fit", "2025-08-20T10:00:00",
                                 wind_data=None)
    assert "气象条件" not in prompt


def test_prompt_wind_unavailable():
    prompt = _build_eval_prompt({}, [], "test.fit", "2025-08-20T10:00:00",
                                 wind_data={"available": False})
    assert "气象条件" not in prompt
```

- [ ] **Step 2: Run tests — expect FAIL (signature mismatch)**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && python -m pytest tests/test_wind.py::test_prompt_includes_wind_section -v
```

Expected: `TypeError: _build_eval_prompt() got an unexpected keyword argument 'wind_data'`

- [ ] **Step 3: Update `_build_eval_prompt` signature**

Change line 701:
```python
def _build_eval_prompt(summary: dict, km_stats: list, filename: str, start_time: str,
                       time_stats: list | None = None) -> str:
```
to:
```python
def _build_eval_prompt(summary: dict, km_stats: list, filename: str, start_time: str,
                       time_stats: list | None = None,
                       wind_data: dict | None = None) -> str:
```

- [ ] **Step 4: Add wind section to `_build_eval_prompt` body**

Find this block inside the function (after the `avg_temp_c` line, around line 734):

```python
        f"- 平均气温：{fmt(summary.get('avg_temp_c'), ' °C')}",
    ]
    if summary.get("left_pct") is not None:
```

Replace with:

```python
        f"- 平均气温：{fmt(summary.get('avg_temp_c'), ' °C')}",
    ]
    if wind_data and wind_data.get("available"):
        w = wind_data
        lines += [
            "",
            "## 气象条件（来源：Open-Meteo 历史天气）",
            f"- 平均风速：{w['wind_speed_avg_kmh']} km/h，阵风最大：{w['gust_max_kmh']} km/h",
            f"- 主导风向：{w['wind_dir_label']}（{w['wind_dir_deg']}°）",
            f"- 全程逆风：{w['headwind_pct']}%  顺风：{w['tailwind_pct']}%  侧风：{w['crosswind_pct']}%",
        ]
        if w["headwind_pct"] > 30:
            lines.append("（逆风比例偏高，速度表现可能受明显影响，分析时请结合考虑）")
    if summary.get("left_pct") is not None:
```

- [ ] **Step 5: Add Section 8 to prompt instructions**

Find (around line 800):

```python
        "### 7. 训练建议",
        "基于本次骑行数据，给出1–3条具体可执行的下次训练建议。",
        "",
        "格式要求：Markdown，## 做章节标题，**加粗**关键数值，- 做列表。语言简洁专业。",
```

Replace with:

```python
        "### 7. 训练建议",
        "基于本次骑行数据，给出1–3条具体可执行的下次训练建议。",
        "",
        "### 8. 风力影响评估（仅当逆风 > 30% 时输出，否则跳过）",
        "说明风力对本次骑行均速的影响程度，估算去除风力因素后的实际能力水平。",
        "",
        "格式要求：Markdown，## 做章节标题，**加粗**关键数值，- 做列表。语言简洁专业。",
```

- [ ] **Step 6: Update `ai_evaluate` to accept and pass `wind_data`**

Find (around line 909):

```python
    prompt = _build_eval_prompt(
        body.get("summary") or {}, body.get("km_stats") or [],
        body.get("filename", ""), body.get("start_time", ""),
        time_stats=body.get("time_stats") or None,
    )
```

Replace with:

```python
    prompt = _build_eval_prompt(
        body.get("summary") or {}, body.get("km_stats") or [],
        body.get("filename", ""), body.get("start_time", ""),
        time_stats=body.get("time_stats") or None,
        wind_data=body.get("wind_data") or None,
    )
```

- [ ] **Step 7: Run prompt tests — expect PASS**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && python -m pytest tests/test_wind.py -v
```

Expected: all PASSED

- [ ] **Step 8: Run full suite — no regressions**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && python -m pytest tests/ -v
```

Expected: all PASSED

- [ ] **Step 9: Commit**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && git add app.py tests/test_wind.py && git commit -m "Add# app.py - _build_eval_prompt 风况章节 + ai_evaluate 接收 wind_data"
```

---

## Task 4: 前端 `openActAiModal` 并行请求 + 气象 chips

**Files:**
- Modify: `static/app.js` lines 4700–4714 (replace `openActAiModal`), add `_windDirArrow` helper

- [ ] **Step 1: Add `_windDirArrow` helper before `openActAiModal`**

In `static/app.js`, find (line ~4700):

```javascript
/* ── 活动列表单条 AI 分析 ──────────────────────────────────────────────────── */
async function openActAiModal(act) {
```

Insert before that comment block:

```javascript
function _windDirArrow(deg) {
  // Arrow points toward direction wind comes FROM (matches compass label)
  // 0=N→↑, 45=NE→↗, 90=E→→, 135=SE→↘, 180=S→↓, 225=SW→↙, 270=W→←, 315=NW→↖
  const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  return arrows[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

```

- [ ] **Step 2: Replace `openActAiModal` with parallel-fetch version**

Replace the entire function (lines 4701–4714):

```javascript
/* ── 活动列表单条 AI 分析 ──────────────────────────────────────────────────── */
async function openActAiModal(act) {
  if (!_aiModel) { toast('AI 未配置，请先编辑 config.json'); return; }
  const chips = _statChips(act.summary || {});
  let kmStats = [], windData = null;
  try {
    const [lr, wr] = await Promise.all([
      fetch('/api/load', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: act.filename }) }),
      fetch(`/api/weather/${encodeURIComponent(act.filename || '')}`)
    ]);
    if (lr.ok) { const ld = await lr.json(); kmStats = ld.km_stats || []; }
    if (wr.ok) { const wd = await wr.json(); if (wd.available) windData = wd; }
  } catch {}
  let weatherHtml = '';
  if (windData) {
    const arrow = _windDirArrow(windData.wind_dir_deg);
    weatherHtml =
      `<span class="stat-chip">🌬️ ${windData.wind_speed_avg_kmh} km/h</span>` +
      `<span class="stat-chip">${arrow} ${windData.wind_dir_label}</span>` +
      `<span class="stat-chip">逆风${windData.headwind_pct}% / 顺风${windData.tailwind_pct}%</span>`;
  }
  await _openAndStreamModal(
    (act.filename || '').replace(/\.fit$/i, ''),
    chips.map(c => `<span class="stat-chip">${c}</span>`).join('') + weatherHtml,
    () => fetch('/api/ai/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ summary: act.summary || {}, km_stats: kmStats, filename: act.filename || '', start_time: act.start_time || '', wind_data: windData }) })
  );
}
```

- [ ] **Step 3: Verify Flask server starts without errors**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && python -c "import app; print('OK')"
```

Expected: `OK` (no ImportError or SyntaxError)

- [ ] **Step 4: Manual smoke test**

1. Start Flask: `python app.py`
2. Open `http://localhost:5173`
3. Click "AI 分析" on any activity that has GPS data
4. Verify: modal opens, weather chips appear (🌬️ speed, arrow + direction, headwind%)
5. Verify AI analysis text references wind conditions when headwind > 30%
6. Click "AI 分析" on an activity without GPS (if any) — verify modal still opens normally, no weather chips

- [ ] **Step 5: Commit**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && git add static/app.js && git commit -m "Update# static/app.js - openActAiModal 并行请求风速 + 气象 chips 展示"
```

---

## Spec Coverage Check

| Spec requirement | Task |
|---|---|
| Open-Meteo, 免费, 无 key | Task 2 Step 3 |
| GCJ-02 → WGS-84 转换 | Task 2 Step 3 (`gcj02_to_wgs84`) |
| 顺/逆/侧风比例计算 | Task 1 Step 4 (`_wind_stats`) |
| 风向中文标签 8 方位 | Task 1 Step 4 (`_wind_dir_label`) |
| 失败返回 `{available: false}` | Task 2 Steps 3, 4 |
| prompt 气象章节 | Task 3 Steps 4–5 |
| 逆风 > 30% 提示 + Section 8 | Task 3 Steps 4–5 |
| 前端并行请求 | Task 4 Step 2 |
| 气象 chips (速度/方向/比例) | Task 4 Step 2 |
| 失败静默跳过 | Task 4 Step 2 (`try/catch`, `if windData`) |
| `wind_data` 注入 evaluate body | Task 4 Step 2 |
