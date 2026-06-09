# 多选骑行 AI 对比分析 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在多选模式下选择 ≥2 条骑行记录，触发 AI 对比分析，后端进行简单风速归一化，结果通过现有 SSE 弹窗流式输出。

**Architecture:** 新增后端端点 `/api/ai/compare`，接受 N 条骑行的 summary/km_stats/wind_data，执行线性风速归一化，构建对比 prompt，调用已有 `_llm_stream`（扩展 `max_tokens_override` 参数）。前端在选择栏添加"AI 对比"按钮，≥2 条选中时 enabled，复用已有 `_openAndStreamModal`。

**Tech Stack:** Python/Flask SSE, Vanilla JS, pytest

---

## File Map

| File | Change |
|------|--------|
| `tests/test_compare.py` | 新建：`_wind_normalize_speed` + `_build_compare_prompt` + `/api/ai/compare` 单元测试 |
| `app.py` | 修改 `_llm_stream` 签名（+`max_tokens_override`）；新增 `_wind_normalize_speed`、`_build_compare_prompt`；新增 `/api/ai/compare` 端点 |
| `templates/index.html` | `#act-select-bar` 加"AI 对比"按钮 |
| `static/app.js` | `_updateSelectBar()` 控制按钮 disabled 状态；新增 `_actBulkAiCompare()` |

---

## Task 1: Tests for `_wind_normalize_speed` and `_build_compare_prompt`

**Files:**
- Create: `tests/test_compare.py`

- [ ] **Step 1: Write failing tests**

```python
# tests/test_compare.py
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app import _wind_normalize_speed, _build_compare_prompt


# ── _wind_normalize_speed ────────────────────────────────────────────────────

def test_normalize_no_wind_data():
    v, eff = _wind_normalize_speed(30.0, None)
    assert v == 30.0
    assert eff == 0.0

def test_normalize_unavailable():
    v, eff = _wind_normalize_speed(30.0, {"available": False})
    assert v == 30.0
    assert eff == 0.0

def test_normalize_no_speed():
    wind = {"available": True, "wind_speed_avg_kmh": 20.0, "headwind_pct": 100, "tailwind_pct": 0}
    v, eff = _wind_normalize_speed(None, wind)
    assert v is None
    assert eff == 0.0

def test_normalize_headwind():
    # eff = 20 * (100 - 0) / 100 = 20; v_norm = 30 + 20 * 0.25 = 35.0
    wind = {"available": True, "wind_speed_avg_kmh": 20.0, "headwind_pct": 100, "tailwind_pct": 0}
    v, eff = _wind_normalize_speed(30.0, wind)
    assert eff == 20.0
    assert v == 35.0

def test_normalize_tailwind():
    # eff = 20 * (0 - 100) / 100 = -20; v_norm = 30 + (-20) * 0.25 = 25.0
    wind = {"available": True, "wind_speed_avg_kmh": 20.0, "headwind_pct": 0, "tailwind_pct": 100}
    v, eff = _wind_normalize_speed(30.0, wind)
    assert eff == -20.0
    assert v == 25.0

def test_normalize_mixed():
    # eff = 10 * (60 - 20) / 100 = 4.0; v_norm = 28 + 4 * 0.25 = 29.0
    wind = {"available": True, "wind_speed_avg_kmh": 10.0, "headwind_pct": 60, "tailwind_pct": 20}
    v, eff = _wind_normalize_speed(28.0, wind)
    assert eff == 4.0
    assert v == 29.0


# ── _build_compare_prompt ────────────────────────────────────────────────────

def _sample_acts():
    return [
        {
            "filename": "ride1.fit",
            "start_time": "2026-06-01 08:00:00",
            "summary": {
                "avg_speed_kmh": 30.0, "total_dist_km": 50.0,
                "avg_hr": 150, "avg_power": 200, "normalized_power": 210,
                "total_elevation_gain_m": 300, "moving_time_s": 6000, "avg_cadence": 90,
            },
            "km_stats": [
                {"km": 1, "duration_s": 120, "avg_speed_kmh": 30.0,
                 "avg_hr": 150, "avg_power": 200, "avg_cadence": 90, "elevation_gain_m": 5},
            ],
            "wind_data": {
                "available": True, "wind_speed_avg_kmh": 10.0,
                "headwind_pct": 60, "tailwind_pct": 20, "crosswind_pct": 20,
                "gust_max_kmh": 15.0, "wind_dir_deg": 90, "wind_dir_label": "东风",
            },
        },
        {
            "filename": "ride2.fit",
            "start_time": "2026-06-08 08:00:00",
            "summary": {
                "avg_speed_kmh": 28.0, "total_dist_km": 50.0,
                "avg_hr": 148, "avg_power": 195, "normalized_power": 205,
                "total_elevation_gain_m": 290, "moving_time_s": 6400, "avg_cadence": 88,
            },
            "km_stats": [],
            "wind_data": None,
        },
    ]


def test_compare_prompt_contains_header():
    prompt = _build_compare_prompt(_sample_acts())
    assert "骑行对比汇总表" in prompt

def test_compare_prompt_both_filenames():
    prompt = _build_compare_prompt(_sample_acts())
    assert "ride1.fit" in prompt
    assert "ride2.fit" in prompt

def test_compare_prompt_normalized_speed_in_table():
    prompt = _build_compare_prompt(_sample_acts())
    # ride1: eff = 10*(60-20)/100 = 4.0; v_norm = 30 + 4*0.25 = 31.0
    assert "31.0" in prompt

def test_compare_prompt_no_wind_label():
    prompt = _build_compare_prompt(_sample_acts())
    assert "无数据（均速未作风力归一化）" in prompt

def test_compare_prompt_has_km_stats_for_ride1():
    prompt = _build_compare_prompt(_sample_acts())
    assert "逐公里分段" in prompt

def test_compare_prompt_no_km_stats_for_ride2():
    prompt = _build_compare_prompt(_sample_acts())
    assert "逐公里数据**：无" in prompt

def test_compare_prompt_analysis_sections():
    prompt = _build_compare_prompt(_sample_acts())
    assert "速度效率对比" in prompt
    assert "配速策略对比" in prompt
    assert "综合评定" in prompt
    assert "训练建议" in prompt
```

- [ ] **Step 2: Run tests — verify they FAIL**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && python -m pytest tests/test_compare.py -v 2>&1 | head -30
```

Expected: `ImportError: cannot import name '_wind_normalize_speed' from 'app'`

---

## Task 2: Implement `_wind_normalize_speed` and `_build_compare_prompt` in `app.py`

**Files:**
- Modify: `app.py` (insert after line 942, before `@app.route("/api/ai/config")`)

- [ ] **Step 1: Insert both functions into `app.py`**

Open `app.py`. Find the blank line just before `@app.route("/api/ai/config")` (currently around line 943). Insert the following block immediately before that decorator:

```python
def _wind_normalize_speed(v_avg: float | None, wind_data: dict | None) -> tuple:
    """Returns (v_normalized, effective_headwind_kmh). Linear approximation:
    v_norm = v_avg + eff_headwind × 0.25  (0.25 km/h per 1 km/h effective headwind)."""
    if not wind_data or not wind_data.get("available") or not v_avg:
        return v_avg, 0.0
    wind_speed   = wind_data.get("wind_speed_avg_kmh", 0) or 0
    headwind_pct = wind_data.get("headwind_pct", 0) or 0
    tailwind_pct = wind_data.get("tailwind_pct", 0) or 0
    eff_headwind = wind_speed * (headwind_pct - tailwind_pct) / 100
    return round(v_avg + eff_headwind * 0.25, 1), round(eff_headwind, 1)


def _build_compare_prompt(activities: list) -> str:
    def fmt(v, unit="", digits=1):
        return "无数据" if v is None else f"{round(v, digits)}{unit}"

    def _v(seg, key, d=0):
        val = seg.get(key)
        return "—" if val is None else str(round(val, d))

    lines = [
        "你是一名专业公路自行车训练教练，请根据以下多次骑行数据进行横向对比分析，输出结构化中文对比报告。",
        "",
        "## 骑行对比汇总表",
        "| 编号 | 日期 | 距离(km) | 均速(km/h) | 归一化均速(km/h) | 有效逆风(km/h) | 均功率(W) | NP(W) | 均心率(bpm) | 爬升(m) |",
        "|------|------|---------|-----------|----------------|--------------|---------|-------|-----------|--------|",
    ]

    for i, act in enumerate(activities, 1):
        s  = act.get("summary") or {}
        wd = act.get("wind_data") or {}
        v_avg = s.get("avg_speed_kmh")
        v_norm, eff_hw = _wind_normalize_speed(v_avg, wd if wd.get("available") else None)
        date_str = (act.get("start_time") or "")[:10] or "未知"
        eff_str  = fmt(eff_hw if eff_hw != 0.0 else None, "", 1)
        lines.append(
            f"| {i} | {date_str} | {fmt(s.get('total_dist_km'), '', 1)} | "
            f"{fmt(v_avg, '', 1)} | {fmt(v_norm, '', 1)} | {eff_str} | "
            f"{fmt(s.get('avg_power'), '', 0)} | {fmt(s.get('normalized_power'), '', 0)} | "
            f"{fmt(s.get('avg_hr'), '', 0)} | {fmt(s.get('total_elevation_gain_m'), '', 0)} |"
        )

    lines.append("")

    for i, act in enumerate(activities, 1):
        s   = act.get("summary") or {}
        wd  = act.get("wind_data") or {}
        kms = act.get("km_stats") or []
        fn  = act.get("filename", f"骑行{i}")
        st  = act.get("start_time", "")
        v_avg = s.get("avg_speed_kmh")
        v_norm, eff_hw = _wind_normalize_speed(v_avg, wd if wd.get("available") else None)

        lines.append(f"## 骑行 {i} — {fn}" + (f"（{st[:16]}）" if st else ""))

        if wd.get("available"):
            lines.append(
                f"**风况**：均风速 {wd.get('wind_speed_avg_kmh')} km/h，"
                f"逆风 {wd.get('headwind_pct')}%，顺风 {wd.get('tailwind_pct')}%，"
                f"侧风 {wd.get('crosswind_pct')}%"
            )
            lines.append(
                f"**有效逆风**：{eff_hw} km/h → **归一化均速**：{v_norm} km/h"
                f"（原 {fmt(v_avg, '', 1)} km/h）"
            )
        else:
            lines.append("**风况**：无数据（均速未作风力归一化）")

        lines += [
            "",
            f"**汇总**：距离 {fmt(s.get('total_dist_km'), ' km')}，"
            f"移动时长 {fmt((s.get('moving_time_s') or 0) / 60, ' 分钟', 0)}，"
            f"爬升 {fmt(s.get('total_elevation_gain_m'), ' m', 0)}，"
            f"均踏频 {fmt(s.get('avg_cadence'), ' rpm', 0)}，"
            f"均功率 {fmt(s.get('avg_power'), ' W', 0)}，"
            f"NP {fmt(s.get('normalized_power'), ' W', 0)}，"
            f"均心率 {fmt(s.get('avg_hr'), ' bpm', 0)}",
            "",
        ]

        if kms:
            lines.append(f"**逐公里分段（共 {len(kms)} 段）**")
            lines.append("公里段 | 时长(s) | 均速(km/h) | 均心率(bpm) | 均功率(W) | 均踏频(rpm) | 爬升(m)")
            lines.append("------|--------|-----------|------------|---------|-----------|-------")
            for seg in kms:
                lines.append(
                    f"第{seg.get('km','?')}km | {_v(seg,'duration_s',0)}s | "
                    f"{_v(seg,'avg_speed_kmh',1)} | {_v(seg,'avg_hr',0)} | "
                    f"{_v(seg,'avg_power',0)} | {_v(seg,'avg_cadence',0)} | "
                    f"{_v(seg,'elevation_gain_m',0)}"
                )
        else:
            lines.append("**逐公里数据**：无")

        lines.append("")

    lines += [
        "## 对比分析要求",
        "",
        "请依次输出以下章节（无充分数据的章节可跳过）：",
        "",
        "### 1. 速度效率对比",
        "以**归一化均速**为主要指标，说明风力调整是否合理，哪次骑行速度效率最高。",
        "",
        "### 2. 配速策略对比",
        "分析各骑行逐公里速度/功率节奏的稳定性（变异幅度），谁的配速更均匀。",
        "",
        "### 3. 有氧效率对比（如有心率 + 功率数据）",
        "对比各骑行的 EF（= NP / 均心率），数值越高说明有氧效率越好。",
        "",
        "### 4. 爬坡表现对比（如爬升 > 50 m）",
        "对比各骑行在爬升段的速度/功率/心率响应及整体爬升效率。",
        "",
        "### 5. 综合评定",
        "明确指出哪次骑行综合表现最优，给出具体理由（引用关键数值）。",
        "",
        "### 6. 训练建议",
        "基于对比结果，给出 1–3 条针对性的训练建议。",
        "",
        "格式：Markdown，## 做章节标题，**加粗**关键对比数值，重要对比用表格呈现。语言简洁专业。",
    ]

    return "\n".join(lines)

```

- [ ] **Step 2: Run tests — verify they PASS**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && python -m pytest tests/test_compare.py -v 2>&1 | head -40
```

Expected: all 13 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add app.py tests/test_compare.py
git commit -m "Add# app.py tests/test_compare.py - 风速归一化函数与对比 prompt 构建器"
```

---

## Task 3: Extend `_llm_stream` + Add `/api/ai/compare` Endpoint

**Files:**
- Modify: `app.py:988` (`_llm_stream` signature + `max_tokens` line)
- Modify: `app.py` (insert `/api/ai/compare` after `/api/ai/chat` endpoint, currently around line 1063)

- [ ] **Step 1: Extend `_llm_stream` signature**

In `app.py`, find line 988:
```python
def _llm_stream(cfg: dict, prompt: str | None = None, messages: list | None = None):
```
Replace with:
```python
def _llm_stream(cfg: dict, prompt: str | None = None, messages: list | None = None, max_tokens_override: int | None = None):
```

Find the line (around 998):
```python
        "max_tokens": cfg.get("max_tokens", 2500),
```
Replace with:
```python
        "max_tokens": max_tokens_override or cfg.get("max_tokens", 2500),
```

- [ ] **Step 2: Add `/api/ai/compare` endpoint**

Find the end of the `ai_chat` function (around line 1063–1064):
```python
    return _llm_stream(cfg, messages=messages)
```

Insert the new endpoint immediately after:

```python

@app.route("/api/ai/compare", methods=["POST"])
def ai_compare():
    cfg = _load_ai_config()
    if not cfg:
        return jsonify(error="AI 未配置，请编辑项目根目录下的 config.json"), 503
    body       = request.get_json(silent=True) or {}
    activities = body.get("activities") or []
    if len(activities) < 2:
        return jsonify(error="至少需要 2 条骑行记录"), 400
    prompt   = _build_compare_prompt(activities)
    override = max(cfg.get("max_tokens", 2500) * 2, 5000)
    return _llm_stream(cfg, prompt, max_tokens_override=override)
```

- [ ] **Step 3: Write endpoint tests — append to `tests/test_compare.py`**

Append to the end of `tests/test_compare.py`:

```python

# ── /api/ai/compare endpoint ────────────────────────────────────────────────

import pytest
from unittest.mock import patch, MagicMock
import app as flask_app


@pytest.fixture
def client():
    flask_app.app.config["TESTING"] = True
    with flask_app.app.test_client() as c:
        yield c


def _fake_cfg():
    return {
        "api_key":    "sk-test",
        "api_base":   "https://api.openai.com/v1",
        "model":      "gpt-4o-mini",
        "max_tokens": 2500,
    }


def _two_acts():
    return [
        {"filename": "a.fit", "start_time": "2026-06-01 08:00:00",
         "summary": {"avg_speed_kmh": 30.0, "total_dist_km": 40.0},
         "km_stats": [], "wind_data": None},
        {"filename": "b.fit", "start_time": "2026-06-08 08:00:00",
         "summary": {"avg_speed_kmh": 28.0, "total_dist_km": 40.0},
         "km_stats": [], "wind_data": None},
    ]


def test_compare_returns_400_if_one_activity(client):
    with patch("app._load_ai_config", return_value=_fake_cfg()):
        r = client.post("/api/ai/compare",
                        json={"activities": [_two_acts()[0]]},
                        content_type="application/json")
    assert r.status_code == 400
    assert "至少需要 2 条" in r.get_json()["error"]


def test_compare_returns_503_if_no_config(client):
    with patch("app._load_ai_config", return_value=None):
        r = client.post("/api/ai/compare",
                        json={"activities": _two_acts()},
                        content_type="application/json")
    assert r.status_code == 503


def test_compare_calls_llm_with_doubled_max_tokens(client):
    captured = {}

    def fake_stream(cfg, prompt=None, messages=None, max_tokens_override=None):
        captured["max_tokens_override"] = max_tokens_override
        from flask import Response
        return Response("data: [DONE]\n\n", mimetype="text/event-stream")

    with patch("app._load_ai_config", return_value=_fake_cfg()), \
         patch("app._llm_stream", side_effect=fake_stream):
        client.post("/api/ai/compare",
                    json={"activities": _two_acts()},
                    content_type="application/json")

    # max(2500 * 2, 5000) = 5000
    assert captured["max_tokens_override"] == 5000


def test_compare_max_tokens_floor_is_5000(client):
    cfg = _fake_cfg()
    cfg["max_tokens"] = 1000
    captured = {}

    def fake_stream(cfg, prompt=None, messages=None, max_tokens_override=None):
        captured["max_tokens_override"] = max_tokens_override
        from flask import Response
        return Response("data: [DONE]\n\n", mimetype="text/event-stream")

    with patch("app._load_ai_config", return_value=cfg), \
         patch("app._llm_stream", side_effect=fake_stream):
        client.post("/api/ai/compare",
                    json={"activities": _two_acts()},
                    content_type="application/json")

    # max(1000 * 2, 5000) = 5000
    assert captured["max_tokens_override"] == 5000


def test_compare_max_tokens_doubles_when_above_floor(client):
    cfg = _fake_cfg()
    cfg["max_tokens"] = 4000
    captured = {}

    def fake_stream(cfg, prompt=None, messages=None, max_tokens_override=None):
        captured["max_tokens_override"] = max_tokens_override
        from flask import Response
        return Response("data: [DONE]\n\n", mimetype="text/event-stream")

    with patch("app._load_ai_config", return_value=cfg), \
         patch("app._llm_stream", side_effect=fake_stream):
        client.post("/api/ai/compare",
                    json={"activities": _two_acts()},
                    content_type="application/json")

    # max(4000 * 2, 5000) = 8000
    assert captured["max_tokens_override"] == 8000
```

- [ ] **Step 4: Run all tests — verify they PASS**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && python -m pytest tests/test_compare.py -v
```

Expected: all 21 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app.py tests/test_compare.py
git commit -m "Add# app.py - /api/ai/compare 端点，扩展 _llm_stream max_tokens_override"
```

---

## Task 4: Add "AI 对比" Button to HTML

**Files:**
- Modify: `templates/index.html` (line ~126–133, `#act-select-bar`)

- [ ] **Step 1: Add the button**

In `templates/index.html`, find:
```html
      <button class="danger-btn" onclick="_actBulkDelete()">删除</button>
    </div>
```

Replace with:
```html
      <button id="act-bulk-ai-btn" onclick="_actBulkAiCompare()" disabled>AI 对比</button>
      <button class="danger-btn" onclick="_actBulkDelete()">删除</button>
    </div>
```

- [ ] **Step 2: Verify HTML structure**

```bash
grep -n "act-bulk-ai-btn\|AI 对比\|_actBulkAiCompare" /Volumes/Code/Code/Labs/FAFA_Python/templates/index.html
```

Expected: one line showing the new button.

- [ ] **Step 3: Commit**

```bash
git add templates/index.html
git commit -m "Add# templates/index.html - 多选栏 AI 对比按钮"
```

---

## Task 5: Add `_actBulkAiCompare()` and Update `_updateSelectBar()` in JS

**Files:**
- Modify: `static/app.js:373` (`_updateSelectBar` function)
- Modify: `static/app.js` (insert `_actBulkAiCompare` after `_actBulkDelete`)

- [ ] **Step 1: Update `_updateSelectBar` to control button state**

Find in `static/app.js` (around line 373):
```javascript
function _updateSelectBar() {
  document.getElementById('act-select-count').textContent = `已选 ${_actSelected.size} 项`;
  const allCards = document.querySelectorAll('.act-card[data-filename]');
  const btn = document.getElementById('act-select-all-btn');
  if (btn) {
    const allSelected = allCards.length > 0 && [...allCards].every(c => _actSelected.has(c.dataset.filename));
    btn.textContent = allSelected ? '取消全选' : '全选';
  }
}
```

Replace with:
```javascript
function _updateSelectBar() {
  document.getElementById('act-select-count').textContent = `已选 ${_actSelected.size} 项`;
  const allCards = document.querySelectorAll('.act-card[data-filename]');
  const btn = document.getElementById('act-select-all-btn');
  if (btn) {
    const allSelected = allCards.length > 0 && [...allCards].every(c => _actSelected.has(c.dataset.filename));
    btn.textContent = allSelected ? '取消全选' : '全选';
  }
  const aiBtn = document.getElementById('act-bulk-ai-btn');
  if (aiBtn) aiBtn.disabled = (_actSelected.size < 2 || !_aiModel);
}
```

- [ ] **Step 2: Add `_actBulkAiCompare` function**

Find the end of `_actBulkDelete` function. It ends before `async function _actLoadAllVisible` (around line ~427). Insert the new function in between:

```javascript
async function _actBulkAiCompare() {
  if (_actSelected.size < 2) { toast('请至少选择 2 条记录'); return; }
  if (!_aiModel) { toast('AI 未配置，请先编辑 config.json'); return; }

  const filenames = [..._actSelected];
  const acts = filenames
    .map(fn => (_actActivities || []).find(a => a.filename === fn))
    .filter(Boolean);
  if (acts.length < 2) { toast('获取记录信息失败'); return; }

  toast('正在加载骑行数据…');

  const results = await Promise.all(acts.map(async act => {
    let kmStats = [], windData = null;
    try {
      const [lr, wr] = await Promise.all([
        fetch('/api/load', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: act.filename }),
        }),
        fetch(`/api/weather/${encodeURIComponent(act.filename || '')}`),
      ]);
      if (lr.ok) { const ld = await lr.json(); kmStats = ld.km_stats || []; }
      if (wr.ok) { const wd = await wr.json(); if (wd.available) windData = wd; }
    } catch {}
    return {
      summary:    act.summary    || {},
      km_stats:   kmStats,
      filename:   act.filename   || '',
      start_time: act.start_time || '',
      wind_data:  windData,
    };
  }));

  const summaryHtml = acts
    .map(a => `<span class="stat-chip">${(a.filename || '').replace(/\.fit$/i, '')}</span>`)
    .join('');
  const payload = { activities: results };

  await _openAndStreamModal(
    `骑行对比 · AI 分析（${acts.length} 条）`,
    summaryHtml,
    () => fetch('/api/ai/compare', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    })
  );
}
```

- [ ] **Step 3: Verify insertion points**

```bash
grep -n "_actBulkAiCompare\|act-bulk-ai-btn" /Volumes/Code/Code/Labs/FAFA_Python/static/app.js
```

Expected: 2 matches — one inside `_updateSelectBar`, one as the function definition.

- [ ] **Step 4: Run existing tests to check for regressions**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && python -m pytest tests/ -v 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add static/app.js
git commit -m "Add# static/app.js - 多选 AI 对比按钮逻辑与 _actBulkAiCompare 函数"
```
