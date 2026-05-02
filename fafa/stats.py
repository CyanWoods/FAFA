from collections import defaultdict
from dataclasses import dataclass
from typing import Optional, List

from .parser import Record, FitData, decode_lr_balance


@dataclass
class KmStats:
    km: int
    duration_s: float
    # Speed
    avg_speed_kmh: Optional[float]
    max_speed_kmh: Optional[float]
    # Cadence
    avg_cadence: Optional[float]
    max_cadence: Optional[int]
    # Heart rate
    avg_hr: Optional[float]
    max_hr: Optional[int]
    # Power
    avg_power: Optional[float]
    max_power: Optional[int]
    normalized_power: Optional[float]
    intensity_factor: Optional[float]   # avg_power / FTP
    # Energy
    calories_kcal: Optional[int]
    work_kj: Optional[float]
    # Terrain
    avg_grade_pct: Optional[float]
    elevation_gain_m: float
    elevation_loss_m: float
    end_alt_m: Optional[float]
    # Environment
    avg_temp_c: Optional[float]
    # Pedal metrics
    left_pct: Optional[float]           # left side power %
    avg_torque_eff: Optional[float]     # avg of L+R torque effectiveness
    avg_pedal_smooth: Optional[float]   # avg of L+R pedal smoothness
    # Distance bounds
    start_dist_m: float
    end_dist_m: float


@dataclass
class Summary:
    total_dist_km: float
    total_duration_s: float
    moving_time_s: Optional[float]
    # Speed
    avg_speed_kmh: Optional[float]
    max_speed_kmh: Optional[float]
    # Cadence
    avg_cadence: Optional[float]
    max_cadence: Optional[int]
    # Heart rate
    avg_hr: Optional[float]
    max_hr: Optional[int]
    # Power
    avg_power: Optional[float]
    max_power: Optional[int]
    normalized_power: Optional[float]
    intensity_factor: Optional[float]
    ftp_w: Optional[int]
    tss: Optional[float]
    # Energy
    total_calories_kcal: Optional[int]
    total_work_kj: Optional[float]
    # Terrain
    total_elevation_gain_m: float
    total_elevation_loss_m: float
    # Environment
    avg_temp_c: Optional[float]
    max_temp_c: Optional[int]
    # Pedal
    left_pct: Optional[float]
    avg_torque_eff: Optional[float]
    avg_pedal_smooth: Optional[float]


def _normalized_power(recs: List[Record]) -> Optional[float]:
    """归一化功率：先将功率数据重采样到 1 秒分辨率，再应用 30 秒滚动均值。
    正确处理 Garmin 智能采样（记录间隔不固定）场景。"""
    pairs = [(r.timestamp, r.power) for r in recs if r.power is not None]
    if not pairs:
        return None
    total_s = int((pairs[-1][0] - pairs[0][0]).total_seconds())
    if total_s < 30:
        return None
    t0 = pairs[0][0]
    # 前向填充到 1 秒等间距网格
    power_1s: List[int] = []
    pi = 0
    for sec in range(total_s + 1):
        while pi + 1 < len(pairs) and (pairs[pi + 1][0] - t0).total_seconds() <= sec:
            pi += 1
        power_1s.append(pairs[pi][1])
    window = 30
    if len(power_1s) < window:
        return None
    rolling = [
        sum(power_1s[i : i + window]) / window
        for i in range(len(power_1s) - window + 1)
    ]
    mean_4th = sum(x**4 for x in rolling) / len(rolling)
    return round(mean_4th**0.25, 1)


def _elevation_changes(alts: List[float]):
    gain = loss = 0.0
    for i in range(1, len(alts)):
        diff = alts[i] - alts[i - 1]
        if diff > 0:
            gain += diff
        else:
            loss += abs(diff)
    return round(gain, 1), round(loss, 1)


def _avg(vals):
    return round(sum(vals) / len(vals), 1) if vals else None


def _sv(session_val, fallback):
    """Return session_val when it is not None (0 is a valid value), else fallback."""
    return session_val if session_val is not None else fallback


def _build_one_segment(recs: List[Record], seg_idx: int, ftp) -> KmStats:
    try:
        duration_s = (recs[-1].timestamp - recs[0].timestamp).total_seconds()
    except Exception:
        duration_s = 0.0

    speeds   = [r.speed_ms * 3.6 for r in recs if r.speed_ms is not None]
    cadences = [r.cadence for r in recs if r.cadence is not None and r.cadence > 0]
    hrs      = [r.heart_rate for r in recs if r.heart_rate is not None]
    powers   = [r.power for r in recs if r.power is not None]
    grades   = [r.grade for r in recs if r.grade is not None]
    temps    = [r.temperature for r in recs if r.temperature is not None]
    alts     = [r.altitude for r in recs if r.altitude is not None]

    lr_raws = [r.left_right_balance for r in recs if r.left_right_balance is not None]
    left_pct = None
    if lr_raws:
        # 先解码各条记录再对百分比求均值，避免对含标志位的原始值直接平均
        decoded_vals = [decode_lr_balance(raw) for raw in lr_raws]
        valid = [d[0] for d in decoded_vals if d is not None]
        left_pct = round(sum(valid) / len(valid), 1) if valid else None

    te_vals = []
    for r in recs:
        vals = [v for v in [r.left_torque_effectiveness, r.right_torque_effectiveness]
                if v is not None and v > 0]
        te_vals.extend(vals)

    ps_vals = []
    for r in recs:
        vals = [v for v in [r.left_pedal_smoothness, r.right_pedal_smoothness]
                if v is not None and v > 0]
        ps_vals.extend(vals)

    cal_vals = [r.calories for r in recs if r.calories is not None]
    calories_delta = max(0, cal_vals[-1] - cal_vals[0]) if len(cal_vals) >= 2 else (cal_vals[0] if cal_vals else None)

    avg_power = round(sum(powers) / len(powers), 1) if powers else None
    work_kj   = round(avg_power * duration_s / 1000, 1) if (avg_power is not None and duration_s > 0) else None
    np_val    = _normalized_power(recs)
    if_val    = round(avg_power / ftp, 3) if (avg_power is not None and ftp) else None
    gain, loss = _elevation_changes(alts)

    return KmStats(
        km=seg_idx,
        duration_s=duration_s,
        avg_speed_kmh=round(sum(speeds) / len(speeds), 1) if speeds else None,
        max_speed_kmh=round(max(speeds), 1) if speeds else None,
        avg_cadence=_avg(cadences),
        max_cadence=max(cadences) if cadences else None,
        avg_hr=round(sum(hrs) / len(hrs), 1) if hrs else None,
        max_hr=max(hrs) if hrs else None,
        avg_power=avg_power,
        max_power=max(powers) if powers else None,
        normalized_power=np_val,
        intensity_factor=if_val,
        calories_kcal=int(calories_delta) if calories_delta is not None else None,
        work_kj=work_kj,
        avg_grade_pct=_avg(grades),
        elevation_gain_m=gain,
        elevation_loss_m=loss,
        end_alt_m=round(alts[-1], 1) if alts else None,
        avg_temp_c=_avg(temps),
        left_pct=left_pct,
        avg_torque_eff=round(sum(te_vals) / len(te_vals), 1) if te_vals else None,
        avg_pedal_smooth=round(sum(ps_vals) / len(ps_vals), 1) if ps_vals else None,
        start_dist_m=recs[0].distance_m,
        end_dist_m=recs[-1].distance_m,
    )


def compute_km_stats(fit: FitData) -> List[KmStats]:
    records = fit.records
    if not records:
        return []
    ftp = fit.session.get("threshold_power")
    buckets: dict[int, List[Record]] = defaultdict(list)
    for r in records:
        buckets[int(r.distance_m / 1000)].append(r)
    return [_build_one_segment(buckets[k], k + 1, ftp) for k in sorted(buckets.keys())]


def compute_dist_stats(fit: FitData, step_m: float = 100.0) -> List[KmStats]:
    """Per-100 m (or custom step) segments, used by the detail view distance mode."""
    records = fit.records
    if not records:
        return []
    ftp = fit.session.get("threshold_power")
    buckets: dict[int, List[Record]] = defaultdict(list)
    for r in records:
        buckets[int(r.distance_m / step_m)].append(r)
    return [_build_one_segment(buckets[k], i + 1, ftp) for i, k in enumerate(sorted(buckets.keys()))]


def _zero_segment(seg_idx: int, step_s: float) -> KmStats:
    """Zero-filled segment for a pause/gap period (device stopped recording)."""
    return KmStats(
        km=seg_idx, duration_s=step_s,
        avg_speed_kmh=0.0, max_speed_kmh=0.0,
        avg_cadence=0.0, max_cadence=0,
        avg_hr=0.0, max_hr=0,
        avg_power=0.0, max_power=0,
        normalized_power=None, intensity_factor=None,
        calories_kcal=0, work_kj=0.0,
        avg_grade_pct=None, elevation_gain_m=0.0, elevation_loss_m=0.0,
        end_alt_m=None, avg_temp_c=None,
        left_pct=None, avg_torque_eff=None, avg_pedal_smooth=None,
        start_dist_m=0.0, end_dist_m=0.0,
    )


def compute_time_stats(fit: FitData, step_s: float = 60.0) -> List[KmStats]:
    """Per-1 min segments with gap-filling: paused intervals appear as zero segments
    so array index i always maps to the real-clock interval [t0 + i*step_s, t0 + (i+1)*step_s)."""
    records = fit.records
    if not records:
        return []
    ftp = fit.session.get("threshold_power")
    t0 = records[0].timestamp
    buckets: dict[int, List[Record]] = defaultdict(list)
    for r in records:
        dt = (r.timestamp - t0).total_seconds()
        buckets[int(dt / step_s)].append(r)
    if not buckets:
        return []
    max_bucket = max(buckets.keys())
    return [
        _build_one_segment(buckets[k], k + 1, ftp) if k in buckets
        else _zero_segment(k + 1, step_s)
        for k in range(max_bucket + 1)
    ]


def compute_summary(fit: FitData, km_stats: List[KmStats]) -> Summary:
    records = fit.records
    session = fit.session
    if not records:
        return Summary(0, 0, None, None, None, None, None, None, None,
                       None, None, None, None, None, None, None, None, 0, 0,
                       None, None, None, None, None)

    try:
        total_s = (records[-1].timestamp - records[0].timestamp).total_seconds()
    except Exception:
        total_s = 0.0

    speeds = [r.speed_ms * 3.6 for r in records if r.speed_ms is not None]
    cadences = [r.cadence for r in records if r.cadence is not None and r.cadence > 0]
    hrs = [r.heart_rate for r in records if r.heart_rate is not None]
    powers = [r.power for r in records if r.power is not None]
    temps = [r.temperature for r in records if r.temperature is not None]

    lr_raws = [r.left_right_balance for r in records if r.left_right_balance is not None]
    left_pct = None
    if lr_raws:
        decoded_vals = [decode_lr_balance(raw) for raw in lr_raws]
        valid = [d[0] for d in decoded_vals if d is not None]
        left_pct = round(sum(valid) / len(valid), 1) if valid else None

    te_vals = []
    for r in records:
        vals = [v for v in [r.left_torque_effectiveness, r.right_torque_effectiveness]
                if v is not None and v > 0]
        te_vals.extend(vals)

    ps_vals = []
    for r in records:
        vals = [v for v in [r.left_pedal_smoothness, r.right_pedal_smoothness]
                if v is not None and v > 0]
        ps_vals.extend(vals)

    ftp = session.get("threshold_power")
    avg_power = round(sum(powers) / len(powers), 1) if powers else None
    np_all = _normalized_power(records)
    if_all = round(avg_power / ftp, 3) if (avg_power is not None and ftp) else None

    # Prefer session-level values when available (more accurate)
    return Summary(
        total_dist_km=round(records[-1].distance_m / 1000, 2),
        total_duration_s=total_s,
        moving_time_s=session.get("total_moving_time"),
        avg_speed_kmh=round(sum(speeds) / len(speeds), 1) if speeds else None,
        max_speed_kmh=round(max(speeds), 1) if speeds else None,
        avg_cadence=_sv(session.get("avg_cadence"), _avg(cadences)),
        max_cadence=_sv(session.get("max_cadence"), max(cadences) if cadences else None),
        avg_hr=_sv(session.get("avg_heart_rate"), round(sum(hrs) / len(hrs), 1) if hrs else None),
        max_hr=_sv(session.get("max_heart_rate"), max(hrs) if hrs else None),
        avg_power=_sv(session.get("avg_power"), avg_power),
        max_power=_sv(session.get("max_power"), max(powers) if powers else None),
        normalized_power=_sv(session.get("normalized_power"), np_all),
        intensity_factor=_sv(session.get("intensity_factor"), if_all),
        ftp_w=ftp,
        tss=session.get("training_stress_score"),
        total_calories_kcal=session.get("total_calories"),
        total_work_kj=round(session.get("total_work") / 1000, 1) if session.get("total_work") is not None else None,
        total_elevation_gain_m=_sv(session.get("total_ascent"), sum(s.elevation_gain_m for s in km_stats)),
        total_elevation_loss_m=_sv(session.get("total_descent"), sum(s.elevation_loss_m for s in km_stats)),
        avg_temp_c=_sv(session.get("avg_temperature"), _avg(temps)),
        max_temp_c=_sv(session.get("max_temperature"), max(temps) if temps else None),
        left_pct=left_pct,
        avg_torque_eff=round(sum(te_vals) / len(te_vals), 1) if te_vals else None,
        avg_pedal_smooth=round(sum(ps_vals) / len(ps_vals), 1) if ps_vals else None,
    )
