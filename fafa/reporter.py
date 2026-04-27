import csv
import io
import json
from dataclasses import asdict
from typing import List, Optional

from .stats import KmStats, Summary


def _dur(s: float) -> str:
    if s <= 0:
        return "--:--"
    h, rem = divmod(int(s), 3600)
    m, sec = divmod(rem, 60)
    if h:
        return f"{h}:{m:02d}:{sec:02d}"
    return f"{m}:{sec:02d}"


def _v(val, decimals: int = 1, suffix: str = "") -> str:
    if val is None:
        return "—"
    if decimals == 0:
        return f"{int(round(val))}{suffix}"
    return f"{val:.{decimals}f}{suffix}"


def _table(headers: List[str], rows: List[List[str]], summary_row: Optional[List[str]] = None) -> str:
    col_widths = [len(h) for h in headers]
    for row in rows:
        for i, cell in enumerate(row):
            col_widths[i] = max(col_widths[i], len(cell))
    if summary_row:
        for i, cell in enumerate(summary_row):
            col_widths[i] = max(col_widths[i], len(cell))

    fmt = "  ".join(f"{{:<{w}}}" for w in col_widths)
    sep = "  ".join("─" * w for w in col_widths)
    lines = [fmt.format(*headers), sep]
    for row in rows:
        lines.append(fmt.format(*row))
    if summary_row:
        lines.append(sep)
        lines.append(fmt.format(*summary_row))
    return "\n".join(lines)


def print_session_header(summary: Summary) -> None:
    def _s(s: float) -> str:
        h, rem = divmod(int(s), 3600)
        m, sec = divmod(rem, 60)
        return f"{h}:{m:02d}:{sec:02d}"

    print("═" * 60)
    print(f"  距离   {summary.total_dist_km:.2f} km          "
          f"运动时间  {_s(summary.moving_time_s or summary.total_duration_s)}")
    print(f"  总时间  {_s(summary.total_duration_s)}        "
          f"爬升/下降  +{summary.total_elevation_gain_m:.0f} m / -{summary.total_elevation_loss_m:.0f} m")
    print()

    parts = []
    if summary.ftp_w:
        parts.append(f"FTP {summary.ftp_w} W")
    if summary.normalized_power:
        parts.append(f"NP {summary.normalized_power:.0f} W")
    if summary.intensity_factor:
        parts.append(f"IF {summary.intensity_factor:.3f}")
    if summary.tss:
        parts.append(f"TSS {summary.tss:.0f}")
    if summary.total_work_kj:
        parts.append(f"做功 {summary.total_work_kj:.0f} kJ")
    if summary.total_calories_kcal:
        parts.append(f"卡路里 {summary.total_calories_kcal} kcal")
    if parts:
        print("  " + "    ".join(parts))

    parts2 = []
    if summary.avg_hr:
        parts2.append(f"均心率 {summary.avg_hr:.0f} bpm")
    if summary.max_hr:
        parts2.append(f"最高心率 {summary.max_hr} bpm")
    if summary.avg_power:
        parts2.append(f"均功率 {summary.avg_power:.0f} W")
    if summary.max_power:
        parts2.append(f"最高功率 {summary.max_power} W")
    if parts2:
        print("  " + "    ".join(parts2))

    parts3 = []
    if summary.avg_cadence:
        parts3.append(f"均踏频 {summary.avg_cadence:.0f} rpm")
    if summary.max_cadence:
        parts3.append(f"最高踏频 {summary.max_cadence} rpm")
    if summary.avg_temp_c:
        parts3.append(f"均温 {summary.avg_temp_c:.0f}°C")
    if summary.max_temp_c:
        parts3.append(f"最高温 {summary.max_temp_c}°C")
    if summary.left_pct:
        right_pct = 100 - summary.left_pct
        parts3.append(f"左右比 L{summary.left_pct:.0f}/R{right_pct:.0f}")
    if parts3:
        print("  " + "    ".join(parts3))

    if summary.avg_torque_eff:
        parts4 = [f"扭矩效率 {summary.avg_torque_eff:.1f}%"]
        if summary.avg_pedal_smooth:
            parts4.append(f"踏板平滑度 {summary.avg_pedal_smooth:.1f}%")
        print("  " + "    ".join(parts4))

    print("═" * 60)
    print()


def _km_rows(stats: List[KmStats], has_cadence, has_grade, has_temp,
             has_lr, has_te, has_power, has_calories) -> List[List[str]]:
    rows = []
    for s in stats:
        is_partial = (s.end_dist_m - s.start_dist_m) <= 950
        km_label = f"{s.km}*" if is_partial else str(s.km)

        row = [km_label, _dur(s.duration_s),
               _v(s.avg_speed_kmh, 1, " km/h"), _v(s.max_speed_kmh, 1, " km/h")]

        if has_cadence:
            row += [_v(s.avg_cadence, 0, " rpm"), _v(s.max_cadence, 0, " rpm")]

        if has_grade:
            row.append(_v(s.avg_grade_pct, 1, "%"))

        row += [_v(s.avg_hr, 0, " bpm"), _v(s.max_hr, 0, " bpm")]

        if has_power:
            row += [
                _v(s.avg_power, 0, " W"),
                _v(s.max_power, 0, " W"),
                _v(s.normalized_power, 0, " W"),
                _v(s.intensity_factor, 3),
            ]

        if has_calories:
            row += [
                _v(s.calories_kcal, 0, " kcal"),
                _v(s.work_kj, 1, " kJ"),
            ]

        row += [
            f"+{s.elevation_gain_m:.0f}m", f"-{s.elevation_loss_m:.0f}m",
            _v(s.end_alt_m, 0, " m"),
        ]

        if has_temp:
            row.append(_v(s.avg_temp_c, 0, "°C"))

        if has_lr:
            if s.left_pct is not None:
                right_pct = 100 - s.left_pct
                row.append(f"L{s.left_pct:.0f}/R{right_pct:.0f}")
            else:
                row.append("—")

        if has_te:
            row += [_v(s.avg_torque_eff, 1, "%"), _v(s.avg_pedal_smooth, 1, "%")]

        rows.append(row)
    return rows


def print_table(stats: List[KmStats], summary: Summary) -> None:
    print_session_header(summary)

    has_cadence  = any(s.avg_cadence is not None for s in stats)
    has_grade    = any(s.avg_grade_pct is not None for s in stats)
    has_temp     = any(s.avg_temp_c is not None for s in stats)
    has_lr       = any(s.left_pct is not None for s in stats)
    has_te       = any(s.avg_torque_eff is not None for s in stats)
    has_power    = any(s.avg_power is not None for s in stats)
    has_calories = any(s.calories_kcal is not None for s in stats)

    headers = ["公里", "时长", "均速", "最高速"]
    if has_cadence:
        headers += ["均踏频", "最高踏频"]
    if has_grade:
        headers.append("坡度")
    headers += ["均心率", "最高心率"]
    if has_power:
        headers += ["均功率", "最高功率", "NP", "IF"]
    if has_calories:
        headers += ["卡路里", "做功"]
    headers += ["爬升", "下降", "终止海拔"]
    if has_temp:
        headers.append("气温")
    if has_lr:
        headers.append("左右比")
    if has_te:
        headers += ["扭矩效率", "踏板平滑"]

    rows = _km_rows(stats, has_cadence, has_grade, has_temp, has_lr, has_te, has_power, has_calories)

    # Summary row
    def _sr():
        row = ["合计/均", _dur(summary.moving_time_s or summary.total_duration_s),
               _v(summary.avg_speed_kmh, 1, " km/h"), _v(summary.max_speed_kmh, 1, " km/h")]
        if has_cadence:
            row += [_v(summary.avg_cadence, 0, " rpm"), _v(summary.max_cadence, 0, " rpm")]
        if has_grade:
            row.append("—")
        row += [_v(summary.avg_hr, 0, " bpm"), _v(summary.max_hr, 0, " bpm")]
        if has_power:
            row += [_v(summary.avg_power, 0, " W"), _v(summary.max_power, 0, " W"),
                    _v(summary.normalized_power, 0, " W"), _v(summary.intensity_factor, 3)]
        if has_calories:
            row += [_v(summary.total_calories_kcal, 0, " kcal"), _v(summary.total_work_kj, 1, " kJ")]
        row += [f"+{summary.total_elevation_gain_m:.0f}m", f"-{summary.total_elevation_loss_m:.0f}m", "—"]
        if has_temp:
            row.append(_v(summary.avg_temp_c, 0, "°C"))
        if has_lr:
            if summary.left_pct:
                row.append(f"L{summary.left_pct:.0f}/R{100-summary.left_pct:.0f}")
            else:
                row.append("—")
        if has_te:
            row += [_v(summary.avg_torque_eff, 1, "%"), _v(summary.avg_pedal_smooth, 1, "%")]
        return row

    print(_table(headers, rows, _sr()))

    last = stats[-1]
    if last.end_dist_m - last.start_dist_m <= 950:
        print(f"\n  * 最后一段为不完整公里（{last.end_dist_m - last.start_dist_m:.0f} m）")


def to_json(stats: List[KmStats], summary: Summary) -> str:
    return json.dumps(
        {"summary": asdict(summary), "km_stats": [asdict(s) for s in stats]},
        ensure_ascii=False,
        indent=2,
        default=str,
    )


def to_csv(stats: List[KmStats]) -> str:
    buf = io.StringIO()
    if not stats:
        return ""
    writer = csv.DictWriter(buf, fieldnames=asdict(stats[0]).keys())
    writer.writeheader()
    for s in stats:
        writer.writerow(asdict(s))
    return buf.getvalue()
