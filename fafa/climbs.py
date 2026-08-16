"""爬坡分段检测与坡度分布。

从逐点 Record 序列里识别连续爬坡段、计算加权坡度分布与平滑坡度。
坡度优先用设备记录的 grade 字段（已由码表滤波），再做一次短程中心平滑去除孤立毛刺；
若设备未记录 grade，则回退到海拔/距离差分推算。

算法参数（连续爬坡成段）：
- 平滑窗口半径 radius=4（中心均值）
- 坡度分布带：下坡(<0%) / 0–4 / 4–7 / 7–10 / 10–13 / 13–16 / >16 (%)
- 单点间距 >120m 视为记录中断，跳过（不计入分布/爬坡）
- 起段阈值 grade>=3%，容忍低于阈值的缺口累计 <=200m
- 成段条件：段长 >=200m 且 平均坡度 >=2.5% 且 爬升 >=8m
- 段内最大坡度取 95 分位，代表性坡度取全程平滑坡度 99 分位
- 结果按爬升降序取前 3 段
"""
from typing import List, Optional

from .parser import Record

# 成段与分布参数
_SMOOTH_RADIUS = 4
_MAX_POINT_GAP_M = 120.0      # 单点间距超过此值视为记录中断
_CLIMB_ENTER_PCT = 3.0        # 进入爬坡段的平滑坡度阈值
_CLIMB_GAP_TOL_M = 200.0      # 段内容忍低于阈值的累计缺口
_CLIMB_MIN_DIST_M = 200.0     # 成段最小段长
_CLIMB_MIN_AVG_PCT = 2.5      # 成段最小平均坡度
_CLIMB_MIN_GAIN_M = 8.0       # 成段最小爬升
_TOP_N = 3


def _percentile(values: List[float], ratio: float) -> Optional[float]:
    """线性插值分位数（ratio ∈ [0,1]）。"""
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    pos = max(0.0, min(len(ordered) - 1, (len(ordered) - 1) * ratio))
    lower = int(pos)
    upper = min(len(ordered) - 1, lower + 1)
    blend = pos - lower
    return ordered[lower] + (ordered[upper] - ordered[lower]) * blend


def _derive_grades(records: List[Record]) -> List[Optional[float]]:
    """得到逐点原始坡度（%）：优先用 record.grade，覆盖不足时回退海拔/距离差分。"""
    recorded = [
        float(r.grade) if r.grade is not None else None
        for r in records
    ]
    valid = [g for g in recorded if g is not None]
    coverage_ok = len(valid) >= len(records) * 0.5
    has_signal = any(abs(g) > 0.05 for g in valid)
    if coverage_ok and has_signal:
        return recorded

    # 回退：用 35m 前后窗口的海拔/距离差分推算坡度
    dists = [r.distance_m if r.distance_m is not None else None for r in records]
    alts = [r.altitude if r.altitude is not None else None for r in records]
    out: List[Optional[float]] = [None] * len(records)
    for i in range(len(records)):
        if dists[i] is None or alts[i] is None:
            continue
        left = right = i
        while left > 0 and dists[left] is not None and dists[i] - dists[left] < 35:
            left -= 1
        while (right < len(records) - 1 and dists[right] is not None
               and dists[right] - dists[i] < 35):
            right += 1
        if (dists[left] is None or dists[right] is None
                or alts[left] is None or alts[right] is None):
            continue
        run = dists[right] - dists[left]
        if run >= 20:
            out[i] = max(-45.0, min(45.0, (alts[right] - alts[left]) / run * 100.0))
    return out


def _smooth(raw: List[Optional[float]], radius: int) -> List[Optional[float]]:
    """短程中心均值平滑，忽略 None。"""
    n = len(raw)
    out: List[Optional[float]] = [None] * n
    for i in range(n):
        total = 0.0
        count = 0
        for j in range(max(0, i - radius), min(n - 1, i + radius) + 1):
            g = raw[j]
            if g is None:
                continue
            total += g
            count += 1
        out[i] = total / count if count else None
    return out


def analyze_grade(records: List[Record]) -> dict:
    """坡度分布 + 连续爬坡段。

    返回:
        coverage: grade 有效点占比（%）
        max_grade: 有效原始坡度最大值（%）
        representative_grade: 平滑坡度 99 分位（%）
        distribution: {descent, b0, b4, b7, b10, b13, b16}
                      各占分析距离百分比，或 None
        climbs: 前 3 段 [{start_distance_m, distance_m, elevation_gain_m,
                          avg_grade_pct, max_grade_pct}]
        analyzed_distance_m: 参与坡度分析的总距离（m）
    """
    empty = {
        "coverage": 0.0,
        "max_grade": None,
        "representative_grade": None,
        "distribution": None,
        "climbs": [],
        "analyzed_distance_m": 0.0,
    }
    if not records or len(records) < 2:
        return empty

    raw = _derive_grades(records)
    valid = [g for g in raw if g is not None]
    coverage = len(valid) / len(records) * 100.0 if records else 0.0
    if len(valid) < 2 or coverage < 10:
        return {**empty, "coverage": coverage}

    smoothed = _smooth(raw, _SMOOTH_RADIUS)

    def seg_dist(i: int) -> Optional[float]:
        a, b = records[i - 1].distance_m, records[i].distance_m
        if a is None or b is None:
            return None
        return b - a

    # 坡度分布（按距离加权）——上坡侧沿用 climbfinder 坡度配色分档：
    # 下坡(<0) / 0–4 / 4–7 / 7–10 / 10–13 / 13–16 / >16 (%)
    bands = {"descent": 0.0, "b0": 0.0, "b4": 0.0, "b7": 0.0,
             "b10": 0.0, "b13": 0.0, "b16": 0.0}
    analyzed = 0.0
    for i in range(1, len(records)):
        d = seg_dist(i)
        g = smoothed[i]
        if d is None or d <= 0 or d > _MAX_POINT_GAP_M or g is None:
            continue
        analyzed += d
        if g < 0:
            bands["descent"] += d
        elif g < 4:
            bands["b0"] += d
        elif g < 7:
            bands["b4"] += d
        elif g < 10:
            bands["b7"] += d
        elif g < 13:
            bands["b10"] += d
        elif g < 16:
            bands["b13"] += d
        else:
            bands["b16"] += d
    distribution = (
        {k: v / analyzed * 100.0 for k, v in bands.items()} if analyzed > 0 else None
    )

    # 连续爬坡分段
    climbs: List[dict] = []

    def finish_climb(start_idx: Optional[int], end_idx: Optional[int]) -> None:
        if start_idx is None or end_idx is None or end_idx <= start_idx:
            return
        start_d = records[start_idx].distance_m
        end_d = records[end_idx].distance_m
        if start_d is None or end_d is None:
            return
        dist_m = end_d - start_d
        if dist_m < _CLIMB_MIN_DIST_M:
            return
        weighted = 0.0
        wdist = 0.0
        seg_grades: List[float] = []
        for i in range(start_idx + 1, end_idx + 1):
            d = seg_dist(i)
            g = smoothed[i]
            if d is None or d <= 0 or d > _MAX_POINT_GAP_M or g is None:
                continue
            weighted += g * d
            wdist += d
            seg_grades.append(g)
        avg_grade = weighted / wdist if wdist else None
        start_alt = records[start_idx].altitude
        end_alt = records[end_idx].altitude
        if start_alt is not None and end_alt is not None:
            gain = max(0.0, end_alt - start_alt)
        else:
            gain = dist_m * max(0.0, avg_grade or 0.0) / 100.0
        if avg_grade is None or avg_grade < _CLIMB_MIN_AVG_PCT or gain < _CLIMB_MIN_GAIN_M:
            return
        climbs.append({
            "start_distance_m": start_d,
            "distance_m": dist_m,
            "elevation_gain_m": gain,
            "avg_grade_pct": avg_grade,
            "max_grade_pct": _percentile(seg_grades, 0.95),
        })

    climb_start: Optional[int] = None
    last_climbing: Optional[int] = None
    sub_threshold = 0.0
    for i in range(1, len(records)):
        d = seg_dist(i)
        if d is None or d < 0 or d > _MAX_POINT_GAP_M:
            finish_climb(climb_start, last_climbing)
            climb_start = None
            last_climbing = None
            sub_threshold = 0.0
            continue
        g = smoothed[i]
        if g is not None and g >= _CLIMB_ENTER_PCT:
            if climb_start is None:
                climb_start = i - 1
            last_climbing = i
            sub_threshold = 0.0
        elif climb_start is not None:
            sub_threshold += d
            if sub_threshold > _CLIMB_GAP_TOL_M:
                finish_climb(climb_start, last_climbing)
                climb_start = None
                last_climbing = None
                sub_threshold = 0.0
    finish_climb(climb_start, last_climbing)

    climbs.sort(
        key=lambda c: (c["elevation_gain_m"], c["distance_m"]), reverse=True
    )
    smoothed_valid = [g for g in smoothed if g is not None]
    return {
        "coverage": coverage,
        "max_grade": max(valid),
        "representative_grade": _percentile(smoothed_valid, 0.99),
        "distribution": distribution,
        "climbs": climbs[:_TOP_N],
        "analyzed_distance_m": analyzed,
    }
