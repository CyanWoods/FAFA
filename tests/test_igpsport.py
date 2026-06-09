import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import tempfile
from pathlib import Path
from datetime import datetime
from fafa.igpsport import make_filename, ride_id_exists, _parse_start_time


# ── make_filename ────────────────────────────────────────────────────────────

def test_make_filename_with_time():
    dt = datetime(2024, 3, 15, 10, 30, 0)
    assert make_filename("123456", dt) == "iGPSport_123456_20240315-103000.fit"

def test_make_filename_no_time():
    assert make_filename("789", None) == "iGPSport_789_00000000-000000.fit"


# ── ride_id_exists ───────────────────────────────────────────────────────────

def test_ride_id_exists_found():
    with tempfile.TemporaryDirectory() as d:
        p = Path(d)
        (p / "iGPSport_123456_20240315-103000.fit").touch()
        assert ride_id_exists("123456", p) is True

def test_ride_id_exists_not_found():
    with tempfile.TemporaryDirectory() as d:
        assert ride_id_exists("999999", Path(d)) is False

def test_ride_id_exists_ignores_other_files():
    with tempfile.TemporaryDirectory() as d:
        p = Path(d)
        (p / "Magene_C706_123456_20240315-103000.fit").touch()
        assert ride_id_exists("123456", p) is False


# ── _parse_start_time ────────────────────────────────────────────────────────

def test_parse_start_time_datetime_format():
    item = {"startTime": "2024-03-15 10:30:00"}
    dt = _parse_start_time(item)
    assert dt == datetime(2024, 3, 15, 10, 30, 0)

def test_parse_start_time_hm_format():
    item = {"startTime": "2024-03-15 10:30"}
    dt = _parse_start_time(item)
    assert dt == datetime(2024, 3, 15, 10, 30, 0)

def test_parse_start_time_date_format():
    item = {"startTime": "2024.03.15"}
    dt = _parse_start_time(item)
    assert dt == datetime(2024, 3, 15, 0, 0, 0)

def test_parse_start_time_missing():
    assert _parse_start_time({}) is None

def test_parse_start_time_empty():
    assert _parse_start_time({"startTime": ""}) is None
