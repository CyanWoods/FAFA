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


def _normalized_power(powers: List[int]) -> Optional[float]:
    if len(powers) < 30:
        return None
    window = 30
    rolling = [
        sum(powers[i - window + 1 : i + 1]) / window
        for i in range(window - 1, len(powers))
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


def compute_km_stats(fit: FitData) -> List[KmStats]:
    records = fit.records
    session = fit.session
    if not records:
        return []

    ftp = session.get("threshold_power")

    buckets: dict[int, List[Record]] = defaultdict(list)
    for r in records:
        buckets[int(r.distance_m / 1000)].append(r)

    stats = []
    for k in sorted(buckets.keys()):
        recs = buckets[k]

        try:
            duration_s = (recs[-1].timestamp - recs[0].timestamp).total_seconds()
        except Exception:
            duration_s = 0.0

        speeds = [r.speed_ms * 3.6 for r in recs if r.speed_ms is not None]
        cadences = [r.cadence for r in recs if r.cadence is not None and r.cadence > 0]
        hrs = [r.heart_rate for r in recs if r.heart_rate is not None]
        powers = [r.power for r in recs if r.power is not None]
        grades = [r.grade for r in recs if r.grade is not None]
        temps = [r.temperature for r in recs if r.temperature is not None]
        alts = [r.altitude for r in recs if r.altitude is not None]

        # Left/right balance: average the raw values then decode
        lr_raws = [r.left_right_balance for r in recs if r.left_right_balance is not None]
        left_pct = None
        if lr_raws:
            avg_raw = sum(lr_raws) / len(lr_raws)
            decoded = decode_lr_balance(int(round(avg_raw)))
            left_pct = round(decoded[0], 1) if decoded else None

        # Torque effectiveness: average of L and R, skip zeros
        te_vals = []
        for r in recs:
            vals = [v for v in [r.left_torque_effectiveness, r.right_torque_effectiveness]
                    if v is not None and v > 0]
            te_vals.extend(vals)
        avg_torque = round(sum(te_vals) / len(te_vals), 1) if te_vals else None

        # Pedal smoothness: average of L and R, skip zeros
        ps_vals = []
        for r in recs:
            vals = [v for v in [r.left_pedal_smoothness, r.right_pedal_smoothness]
                    if v is not None and v > 0]
            ps_vals.extend(vals)
        avg_smooth = round(sum(ps_vals) / len(ps_vals), 1) if ps_vals else None

        # Calories delta (field is cumulative)
        cal_vals = [r.calories for r in recs if r.calories is not None]
        calories_delta = (cal_vals[-1] - cal_vals[0]) if len(cal_vals) >= 2 else (cal_vals[0] if cal_vals else None)

        # Work in kJ: sum(power * 1s) / 1000
        work_kj = round(sum(powers) / 1000, 1) if powers else None

        avg_power = round(sum(powers) / len(powers), 1) if powers else None
        np = _normalized_power(powers) if powers else None
        if_ = round(avg_power / ftp, 3) if (avg_power is not None and ftp) else None

        gain, loss = _elevation_changes(alts)

        stats.append(KmStats(
            km=k + 1,
            duration_s=duration_s,
            avg_speed_kmh=round(sum(speeds) / len(speeds), 1) if speeds else None,
            max_speed_kmh=round(max(speeds), 1) if speeds else None,
            avg_cadence=_avg(cadences),
            max_cadence=max(cadences) if cadences else None,
            avg_hr=round(sum(hrs) / len(hrs), 1) if hrs else None,
            max_hr=max(hrs) if hrs else None,
            avg_power=avg_power,
            max_power=max(powers) if powers else None,
            normalized_power=np,
            intensity_factor=if_,
            calories_kcal=int(calories_delta) if calories_delta is not None else None,
            work_kj=work_kj,
            avg_grade_pct=_avg(grades),
            elevation_gain_m=gain,
            elevation_loss_m=loss,
            end_alt_m=round(alts[-1], 1) if alts else None,
            avg_temp_c=_avg(temps),
            left_pct=left_pct,
            avg_torque_eff=avg_torque,
            avg_pedal_smooth=avg_smooth,
            start_dist_m=recs[0].distance_m,
            end_dist_m=recs[-1].distance_m,
        ))

    return stats


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
        decoded = decode_lr_balance(int(round(sum(lr_raws) / len(lr_raws))))
        left_pct = round(decoded[0], 1) if decoded else None

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
    np_all = _normalized_power(powers) if powers else None
    if_all = round(avg_power / ftp, 3) if (avg_power and ftp) else None

    # Prefer session-level values when available (more accurate)
    return Summary(
        total_dist_km=round(records[-1].distance_m / 1000, 2),
        total_duration_s=total_s,
        moving_time_s=session.get("total_moving_time"),
        avg_speed_kmh=round(sum(speeds) / len(speeds), 1) if speeds else None,
        max_speed_kmh=round(max(speeds), 1) if speeds else None,
        avg_cadence=session.get("avg_cadence") or _avg(cadences),
        max_cadence=session.get("max_cadence") or (max(cadences) if cadences else None),
        avg_hr=session.get("avg_heart_rate") or (round(sum(hrs) / len(hrs), 1) if hrs else None),
        max_hr=session.get("max_heart_rate") or (max(hrs) if hrs else None),
        avg_power=session.get("avg_power") or avg_power,
        max_power=session.get("max_power") or (max(powers) if powers else None),
        normalized_power=session.get("normalized_power") or np_all,
        intensity_factor=session.get("intensity_factor") or if_all,
        ftp_w=ftp,
        tss=session.get("training_stress_score"),
        total_calories_kcal=session.get("total_calories"),
        total_work_kj=round(session.get("total_work", 0) / 1000, 1) if session.get("total_work") else None,
        total_elevation_gain_m=session.get("total_ascent") or sum(s.elevation_gain_m for s in km_stats),
        total_elevation_loss_m=session.get("total_descent") or sum(s.elevation_loss_m for s in km_stats),
        avg_temp_c=session.get("avg_temperature") or _avg(temps),
        max_temp_c=session.get("max_temperature") or (max(temps) if temps else None),
        left_pct=left_pct,
        avg_torque_eff=round(sum(te_vals) / len(te_vals), 1) if te_vals else None,
        avg_pedal_smooth=round(sum(ps_vals) / len(ps_vals), 1) if ps_vals else None,
    )
