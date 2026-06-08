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


def test_wind_dir_label_west():
    assert _wind_dir_label(270) == "西风"

def test_wind_dir_label_northwest():
    assert _wind_dir_label(315) == "西北风"

def test_wind_dir_label_southeast():
    assert _wind_dir_label(135) == "东南风"


import pytest
from unittest.mock import patch, MagicMock
import app as flask_app


@pytest.fixture(autouse=True)
def clear_weather_cache():
    """Clear the in-memory weather cache before each test to prevent cross-test pollution."""
    flask_app._weather_cache.clear()
    yield
    flask_app._weather_cache.clear()


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


def test_weather_endpoint_gcj02(client):
    with patch("app._parse_and_build", return_value=_fake_cached(is_gcj02=True)), \
         patch("app._cache_get", return_value=None), \
         patch("app._disk_cache_load", return_value=None):
        mock_resp = MagicMock()
        mock_resp.raise_for_status = lambda: None
        mock_resp.json.return_value = _fake_openmeteo()
        with patch("requests.get", return_value=mock_resp) as mock_get:
            r = client.get("/api/weather/test.fit")
    assert r.status_code == 200
    data = r.get_json()
    # GCJ-02 → WGS-84 conversion must have been applied for the API call
    call_kwargs = mock_get.call_args
    lat = call_kwargs[1]["params"]["latitude"]
    lon = call_kwargs[1]["params"]["longitude"]
    # Converted coordinates differ from raw (31.2, 121.5)
    assert abs(lat - 31.2) > 0.001 and abs(lon - 121.5) > 0.001


def test_weather_endpoint_traversal_blocked(client):
    # Flask normalizes bare "../" sequences in URLs before routing, so they never
    # reach the view.  Instead use a subdirectory path (<path:filename> allows
    # slashes): "subdir/test.fit" reaches weather_for_activity with a resolved
    # parent that differs from INPUT_DIR, exercising the 403 guard directly.
    r = client.get("/api/weather/subdir/test.fit")
    assert r.status_code == 403


# ---------------------------------------------------------------------------
# _build_eval_prompt wind section tests
# ---------------------------------------------------------------------------
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
    assert "风力影响评估" not in prompt


def test_prompt_wind_unavailable():
    prompt = _build_eval_prompt({}, [], "test.fit", "2025-08-20T10:00:00",
                                 wind_data={"available": False})
    assert "气象条件" not in prompt


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
