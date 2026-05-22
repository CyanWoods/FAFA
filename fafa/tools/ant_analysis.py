"""
Analyze ANT+ device connection duration from FIT file record frames.

Usage:
    python -m fafa.tools.ant_analysis FILE.fit [FILE2.fit ...]
    python -m fafa.tools.ant_analysis input/               # all .fit in directory
    python -m fafa.tools.ant_analysis FILE.fit --gap 10    # merge gaps < 10s
    python -m fafa.tools.ant_analysis FILE.fit --json      # JSON output
"""

from __future__ import annotations

import argparse
import datetime
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


# ANT+ device type → metric fields in record_mesgs (empty = no record-level data)
_ANTPLUS_METRIC_MAP: dict[str, list[str]] = {
    "heart_rate":            ["heart_rate"],
    "bike_power":            ["power"],
    "bike_cadence":          ["cadence"],
    "bike_speed":            ["speed", "enhanced_speed"],
    "bike_speed_cadence":    ["cadence", "speed", "enhanced_speed"],
    "fitness_equipment":     ["power"],          # smart trainer also provides power
    "stride_speed_distance": ["speed", "enhanced_speed"],
    "muscle_oxygen":         ["saturated_hemoglobin_percent"],
    "shifting":              [],                 # Di2/eTap — no record metric field
    "bike_radar":            [],
    "bike_light_main":       [],
    "bike_light_shared":     [],
    "exd":                   [],                 # external display
    "control":               [],
}

# Human-readable label per antplus_device_type
_TYPE_LABEL: dict[str, str] = {
    "heart_rate":            "心率带 (HR Monitor)",
    "bike_power":            "功率计 (Power Meter)",
    "bike_cadence":          "踏频传感器 (Cadence)",
    "bike_speed":            "速度传感器 (Speed)",
    "bike_speed_cadence":    "速踏传感器 (Speed+Cadence)",
    "fitness_equipment":     "训练台 (Smart Trainer)",
    "stride_speed_distance": "步频传感器 (Foot Pod)",
    "muscle_oxygen":         "肌氧传感器 (Muscle O₂)",
    "shifting":              "电子变速 (Di2/eTap)",
    "bike_radar":            "雷达 (Radar)",
    "bike_light_main":       "车灯主灯 (Bike Light)",
    "bike_light_shared":     "车灯从灯 (Bike Light Shared)",
    "exd":                   "外接显示 (EXD)",
    "control":               "控制器 (Control)",
}

# BLE device_type numbers → label (antplus_device_type is None for BLE)
_BLE_DEVICE_TYPE_LABEL: dict[int, str] = {
    16:  "BLE 控制设备",
    35:  "BLE 车灯 (主)",
    36:  "BLE 车灯 (从)",
    40:  "BLE 雷达",
}


@dataclass
class Window:
    start: datetime.datetime
    end: datetime.datetime

    @property
    def duration_s(self) -> float:
        return (self.end - self.start).total_seconds()


@dataclass
class GearEvent:
    timestamp: datetime.datetime
    front_gear: Optional[int]
    rear_gear: Optional[int]


@dataclass
class DeviceResult:
    antplus_type: str
    label: str
    ant_device_number: Optional[int]
    manufacturer: Optional[str]
    product_name: Optional[str]
    battery_status: Optional[str]
    metrics: list[str]          # record fields this device feeds
    windows: list[Window] = field(default_factory=list)
    gear_events: list[GearEvent] = field(default_factory=list)

    @property
    def total_connected_s(self) -> float:
        return sum(w.duration_s for w in self.windows)

    @property
    def disconnection_count(self) -> int:
        return max(0, len(self.windows) - 1)

    @property
    def shifting_span_s(self) -> Optional[float]:
        """Time from first to last gear change event."""
        if len(self.gear_events) < 1:
            return None
        return (self.gear_events[-1].timestamp - self.gear_events[0].timestamp).total_seconds()


@dataclass
class RideResult:
    filepath: str
    ride_start: datetime.datetime
    ride_end: datetime.datetime
    total_records: int
    devices: list[DeviceResult]

    @property
    def total_ride_s(self) -> float:
        return (self.ride_end - self.ride_start).total_seconds()


# ---------------------------------------------------------------------------
# Core analysis
# ---------------------------------------------------------------------------

def _find_windows(
    timestamps: list[datetime.datetime],
    values: list,
    gap_merge_s: float = 5.0,
) -> list[Window]:
    """Return contiguous windows where values are non-None.

    Gaps shorter than gap_merge_s are stitched together as a single window.
    """
    if not timestamps:
        return []

    windows: list[Window] = []
    in_window = False
    win_start: Optional[datetime.datetime] = None
    win_last: Optional[datetime.datetime] = None

    for ts, val in zip(timestamps, values):
        if val is not None:
            if not in_window:
                win_start = ts
                in_window = True
            win_last = ts
        else:
            if in_window:
                # Check if this is just a short blip we should ignore
                in_window = False
                # Peek ahead to see if signal comes back quickly
                # (handled by post-processing merge below)
                windows.append(Window(win_start, win_last))

    if in_window and win_start and win_last:
        windows.append(Window(win_start, win_last))

    # Merge windows whose gap < gap_merge_s
    if gap_merge_s > 0 and len(windows) > 1:
        merged: list[Window] = [windows[0]]
        for w in windows[1:]:
            gap = (w.start - merged[-1].end).total_seconds()
            if gap <= gap_merge_s:
                merged[-1] = Window(merged[-1].start, w.end)
            else:
                merged.append(w)
        windows = merged

    return windows


def analyze_fit(filepath: str, gap_merge_s: float = 5.0) -> RideResult:
    from garmin_fit_sdk import Decoder, Stream

    stream = Stream.from_file(filepath)
    decoder = Decoder(stream)
    messages, errors = decoder.read(
        apply_scale_and_offset=True,
        expand_sub_fields=True,
    )
    if errors:
        for e in errors:
            print(f"[Warning] {e}", file=sys.stderr)

    # --- Records ----------------------------------------------------------
    raw_recs = messages.get("record_mesgs", [])
    raw_recs.sort(key=lambda r: r["timestamp"])

    if not raw_recs:
        raise ValueError(f"No record messages in {filepath}")

    timestamps = [r["timestamp"] for r in raw_recs]
    ride_start = timestamps[0]
    ride_end = timestamps[-1]

    # --- Device info -------------------------------------------------------
    dev_info_mesgs = messages.get("device_info_mesgs", [])

    # Deduplicate by antplus_device_type + ant_device_number
    seen: set[tuple] = set()
    devices: list[DeviceResult] = []

    for d in dev_info_mesgs:
        apt = d.get("antplus_device_type")
        src = d.get("source_type", "")
        dt_num = d.get("device_type")
        num = d.get("ant_device_number")

        if apt and apt in _ANTPLUS_METRIC_MAP:
            # Known ANT+ device type
            key = (apt, num)
            if key in seen:
                continue
            seen.add(key)
            label = _TYPE_LABEL.get(apt, apt)
            metrics = _ANTPLUS_METRIC_MAP[apt]
        elif src == "bluetooth_low_energy" and dt_num in _BLE_DEVICE_TYPE_LABEL:
            # BLE device without antplus_device_type
            key = ("ble", dt_num, num)
            if key in seen:
                continue
            seen.add(key)
            apt = f"ble_{dt_num}"
            label = _BLE_DEVICE_TYPE_LABEL[dt_num]
            metrics = []
        else:
            continue

        devices.append(DeviceResult(
            antplus_type=apt,
            label=label,
            ant_device_number=num,
            manufacturer=d.get("manufacturer"),
            product_name=d.get("product_name"),
            battery_status=d.get("battery_status"),
            metrics=metrics,
        ))

    # If no device_info at all, infer devices from which metrics appear
    if not devices:
        present: set[str] = {
            k for r in raw_recs for k in r.keys()
            if k in {"heart_rate", "power", "cadence", "speed", "enhanced_speed"}
        }
        inferred = {
            "heart_rate": "heart_rate",
            "power": "bike_power",
            "cadence": "bike_cadence",
        }
        added_speed = False
        for field_name, apt in inferred.items():
            if field_name in present:
                devices.append(DeviceResult(
                    antplus_type=apt,
                    label=_TYPE_LABEL.get(apt, apt),
                    ant_device_number=None,
                    manufacturer=None,
                    product_name=None,
                    battery_status=None,
                    metrics=_ANTPLUS_METRIC_MAP[apt],
                ))
        if "speed" in present or "enhanced_speed" in present:
            if not added_speed:
                devices.append(DeviceResult(
                    antplus_type="bike_speed",
                    label=_TYPE_LABEL["bike_speed"],
                    ant_device_number=None,
                    manufacturer=None,
                    product_name=None,
                    battery_status=None,
                    metrics=_ANTPLUS_METRIC_MAP["bike_speed"],
                ))

    # --- Gear change events → attach to shifting device --------------------
    raw_events = messages.get("event_mesgs", [])
    gear_events: list[GearEvent] = []
    for e in sorted(raw_events, key=lambda x: x["timestamp"]):
        ev = e.get("event", "")
        if ev in ("rear_gear_change", "front_gear_change"):
            gear_events.append(GearEvent(
                timestamp=e["timestamp"],
                front_gear=e.get("front_gear_num"),
                rear_gear=e.get("rear_gear_num"),
            ))

    if gear_events:
        for dev in devices:
            if dev.antplus_type == "shifting":
                dev.gear_events = gear_events
                break

    # --- Find connection windows per device --------------------------------
    for dev in devices:
        if not dev.metrics:
            # No record-level metric (e.g. Di2, radar, lights) — windows left empty
            continue

        # Pick the primary metric (first in list that appears in records)
        primary_field = None
        for mf in dev.metrics:
            if any(r.get(mf) is not None for r in raw_recs):
                primary_field = mf
                break
        if primary_field is None:
            primary_field = dev.metrics[0]

        values = [r.get(primary_field) for r in raw_recs]
        dev.windows = _find_windows(timestamps, values, gap_merge_s)

    return RideResult(
        filepath=filepath,
        ride_start=ride_start,
        ride_end=ride_end,
        total_records=len(raw_recs),
        devices=devices,
    )


# ---------------------------------------------------------------------------
# Output formatters
# ---------------------------------------------------------------------------

def _fmt_duration(seconds: float) -> str:
    s = int(seconds)
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    if h:
        return f"{h}h{m:02d}m{sec:02d}s"
    return f"{m}m{sec:02d}s"


def _fmt_time(dt: datetime.datetime) -> str:
    return dt.strftime("%H:%M:%S")


def print_result(result: RideResult) -> None:
    total_s = result.total_ride_s
    ride_dur = _fmt_duration(total_s)

    print()
    print("=" * 68)
    print(f"  文件: {Path(result.filepath).name}")
    print(f"  骑行: {_fmt_time(result.ride_start)} → {_fmt_time(result.ride_end)}  "
          f"总时长 {ride_dur}  ({result.total_records} 帧)")
    print("=" * 68)

    if not result.devices:
        print("  (未检测到 ANT+ 设备)")
        return

    for dev in result.devices:
        connected_s = dev.total_connected_s
        pct = connected_s / total_s * 100 if total_s > 0 else 0.0

        print()
        print(f"  [{dev.label}]")
        if dev.ant_device_number:
            mfr = dev.manufacturer or "unknown"
            prd = dev.product_name or ""
            bat = dev.battery_status or "unknown"
            print(f"    ANT+ #{dev.ant_device_number}  制造商={mfr}  "
                  f"产品={prd}  电量={bat}")

        if not dev.metrics:
            if dev.gear_events:
                span = dev.shifting_span_s or 0
                span_pct = span / total_s * 100 if total_s > 0 else 0.0
                first_ts = dev.gear_events[0].timestamp
                last_ts = dev.gear_events[-1].timestamp
                first_offset = (first_ts - result.ride_start).total_seconds()
                print(f"    换挡活跃窗口: {_fmt_time(first_ts)} → {_fmt_time(last_ts)}"
                      f"  ({_fmt_duration(span)}, {span_pct:.1f}% of 骑行)")
                print(f"    首次换挡: {_fmt_time(first_ts)}  共 {len(dev.gear_events)} 次换挡"
                      f"  (注: 无换挡≠断连，仅供参考)")
                print(f"    换挡记录:")
                prev_f, prev_r = None, None
                for ge in dev.gear_events:
                    f_str = f"F{ge.front_gear}" if ge.front_gear is not None else "F?"
                    r_str = f"R{ge.rear_gear}" if ge.rear_gear is not None else "R?"
                    direction = ""
                    if prev_r is not None and ge.rear_gear is not None:
                        direction = " ↑" if ge.rear_gear > prev_r else " ↓"
                    print(f"      {_fmt_time(ge.timestamp)}  {f_str} {r_str}{direction}")
                    prev_f, prev_r = ge.front_gear, ge.rear_gear
            else:
                print(f"    连接时长: 已注册于 FIT（无帧级指标，无换挡事件）")
            continue

        if not dev.windows:
            print(f"    连接时长: 0s  (0.0%)  — 无有效数据")
            continue

        print(f"    连接时长: {_fmt_duration(connected_s)}  ({pct:.1f}% of 骑行)")
        print(f"    中断次数: {dev.disconnection_count}")
        print(f"    连接窗口 ({len(dev.windows)}):")
        for i, w in enumerate(dev.windows, 1):
            label = f"      #{i}"
            print(f"{label}  {_fmt_time(w.start)} → {_fmt_time(w.end)}  "
                  f"({_fmt_duration(w.duration_s)})")

    print()
    print("-" * 68)


def result_to_dict(result: RideResult) -> dict:
    total_s = result.total_ride_s
    return {
        "file": result.filepath,
        "ride_start": result.ride_start.isoformat(),
        "ride_end": result.ride_end.isoformat(),
        "total_ride_s": total_s,
        "total_records": result.total_records,
        "devices": [
            {
                "antplus_type": d.antplus_type,
                "label": d.label,
                "ant_device_number": d.ant_device_number,
                "manufacturer": d.manufacturer,
                "product_name": d.product_name,
                "battery_status": d.battery_status,
                "metrics": d.metrics,
                "has_record_metric": bool(d.metrics),
                "connected_s": d.total_connected_s if d.metrics else None,
                "connected_pct": (round(d.total_connected_s / total_s * 100, 2) if total_s else 0) if d.metrics else None,
                "disconnection_count": d.disconnection_count if d.metrics else None,
                "windows": [
                    {"start": w.start.isoformat(), "end": w.end.isoformat(),
                     "duration_s": w.duration_s}
                    for w in d.windows
                ],
                "gear_events": [
                    {"timestamp": ge.timestamp.isoformat(),
                     "front_gear": ge.front_gear, "rear_gear": ge.rear_gear}
                    for ge in d.gear_events
                ] if d.gear_events else None,
                "shifting_span_s": d.shifting_span_s,
            }
            for d in result.devices
        ],
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _collect_fits(paths: list[str]) -> list[str]:
    out: list[str] = []
    for p in paths:
        pp = Path(p)
        if pp.is_dir():
            out.extend(str(f) for f in sorted(pp.glob("*.fit")))
        elif pp.suffix.lower() == ".fit":
            out.append(str(pp))
        else:
            print(f"[Skip] not a .fit file or directory: {p}", file=sys.stderr)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Analyze ANT+ device connection duration in FIT files",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("paths", nargs="+", help=".fit file(s) or directory")
    parser.add_argument(
        "--gap", type=float, default=5.0, metavar="SECONDS",
        help="merge disconnection gaps shorter than this (default: 5s)",
    )
    parser.add_argument(
        "--json", action="store_true", help="output JSON instead of text",
    )
    args = parser.parse_args()

    fit_files = _collect_fits(args.paths)
    if not fit_files:
        print("No .fit files found.", file=sys.stderr)
        sys.exit(1)

    results = []
    for fp in fit_files:
        try:
            r = analyze_fit(fp, gap_merge_s=args.gap)
            results.append(r)
            if not args.json:
                print_result(r)
        except Exception as e:
            print(f"[Error] {fp}: {e}", file=sys.stderr)

    if args.json:
        print(json.dumps([result_to_dict(r) for r in results], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
