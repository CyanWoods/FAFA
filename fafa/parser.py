import sys
import datetime
from dataclasses import dataclass, field
from typing import Optional, List

_FIT_EPOCH = datetime.datetime(1989, 12, 31, 0, 0, 0)


@dataclass
class Record:
    timestamp: object
    distance_m: float
    heart_rate: Optional[int] = None
    power: Optional[int] = None
    altitude: Optional[float] = None
    speed_ms: Optional[float] = None
    cadence: Optional[int] = None
    grade: Optional[float] = None          # %
    temperature: Optional[int] = None      # °C
    position_lat: Optional[int] = None     # semicircles
    position_long: Optional[int] = None    # semicircles
    left_right_balance: Optional[int] = None  # raw FIT value
    left_torque_effectiveness: Optional[float] = None   # %
    right_torque_effectiveness: Optional[float] = None  # %
    left_pedal_smoothness: Optional[float] = None       # %
    right_pedal_smoothness: Optional[float] = None      # %
    calories: Optional[int] = None         # cumulative kcal


@dataclass
class FitData:
    records: List[Record]
    session: dict = field(default_factory=dict)
    laps: List[dict] = field(default_factory=list)
    manufacturer: Optional[str] = None
    utc_offset_s: Optional[int] = None  # seconds east of UTC, derived from activity local_timestamp


def parse_fit(filepath: str) -> FitData:
    """Decode a FIT file and return records, session summary, and lap data."""
    from garmin_fit_sdk import Decoder, Stream

    stream = Stream.from_file(filepath)
    decoder = Decoder(stream)
    messages, errors = decoder.read(
        apply_scale_and_offset=True,
        merge_heart_rates=False,
        expand_sub_fields=True,
    )
    if errors:
        for e in errors:
            print(f"[Warning] {e}", file=sys.stderr)

    records: List[Record] = []
    for r in messages.get("record_mesgs", []):
        dist = r.get("distance")
        if dist is None:
            continue
        alt = r.get("enhanced_altitude") if r.get("enhanced_altitude") is not None else r.get("altitude")
        spd = r.get("enhanced_speed") if r.get("enhanced_speed") is not None else r.get("speed")
        records.append(Record(
            timestamp=r["timestamp"],
            distance_m=float(dist),
            heart_rate=r.get("heart_rate"),
            power=r.get("power"),
            altitude=float(alt) if alt is not None else None,
            speed_ms=float(spd) if spd is not None else None,
            cadence=r.get("cadence"),
            grade=r.get("grade"),
            temperature=r.get("temperature"),
            position_lat=r.get("position_lat"),
            position_long=r.get("position_long"),
            left_right_balance=r.get("left_right_balance"),
            left_torque_effectiveness=r.get("left_torque_effectiveness"),
            right_torque_effectiveness=r.get("right_torque_effectiveness"),
            left_pedal_smoothness=r.get("left_pedal_smoothness"),
            right_pedal_smoothness=r.get("right_pedal_smoothness"),
            calories=r.get("calories"),
        ))

    records.sort(key=lambda r: r.timestamp)

    session = messages["session_mesgs"][0] if messages.get("session_mesgs") else {}
    laps = messages.get("lap_mesgs", [])
    file_id = messages["file_id_mesgs"][0] if messages.get("file_id_mesgs") else {}
    manufacturer = file_id.get("manufacturer")

    utc_offset_s = None
    act_mesgs = messages.get("activity_mesgs", [])
    if act_mesgs and records:
        act = act_mesgs[0]
        lt_raw = act.get("local_timestamp")
        ts_utc = act.get("timestamp")
        if lt_raw is not None and ts_utc is not None and isinstance(lt_raw, (int, float)):
            local_dt = _FIT_EPOCH + datetime.timedelta(seconds=int(lt_raw))
            utc_naive = ts_utc.replace(tzinfo=None) if hasattr(ts_utc, "tzinfo") else ts_utc
            utc_offset_s = int(round((local_dt - utc_naive).total_seconds()))

    return FitData(records=records, session=session, laps=laps, manufacturer=manufacturer,
                   utc_offset_s=utc_offset_s)


def decode_lr_balance(raw: int) -> Optional[tuple]:
    """Return (left_pct, right_pct) from raw FIT left_right_balance value."""
    if raw is None:
        return None
    right_pct = raw & 0x7F
    left_pct = 100 - right_pct
    return left_pct, right_pct
