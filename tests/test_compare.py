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

def test_compare_prompt_crosswind_shows_zero_not_nodata():
    # Pure crosswind: headwind_pct == tailwind_pct → eff_hw = 0.0, but wind IS available
    acts = _sample_acts()
    acts[0]["wind_data"]["headwind_pct"] = 20
    acts[0]["wind_data"]["tailwind_pct"] = 20
    prompt = _build_compare_prompt(acts)
    # Summary table should show "0.0", not "无数据"
    assert "0.0" in prompt

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
