"""用户可编辑的 AI 提示词模板、变量目录与渲染器。

安全约束（不可放宽）：
    绝不使用 Jinja2 或任何会对模板求值的引擎。用户模板经白名单查表替换，
    单次正则遍历完成，块的输出不会被二次扫描，因此不存在递归展开或 SSTI。

默认模板是本模块的常量，永不落盘。用户文件中缺失的键一律回退到这里，
因此默认值不可能被任何写路径破坏，且未自定义的模板会随版本升级自动更新。
"""

import logging
import re

# ── 限额 ──────────────────────────────────────────────────────────────────────
MAX_TEMPLATE_CHARS = 8_000      # 单份模板；当前最长的默认模板约 2400 字符
MAX_HISTORY_PER_KIND = 5        # 每份模板保留的历史版本数（滚动，超出丢最旧）
MAX_RENDERED_CHARS = 200_000    # 渲染结果上限，与 app._MAX_AI_TEXT 一致

NO_DATA = "无数据"
DASH = "—"


# ── 块参数 ────────────────────────────────────────────────────────────────────
DEFAULT_BLOCKS = {
    "km_table_rows": 15,        # 逐公里表最大行数，超出取首尾各半并省略中间
    "time_table_rows": 40,      # 逐分钟表目标行数（等距抽样）
    "compare_km_rows": 0,       # 对比逐公里表行数，0 = 不截断
    "recent_rides_rows": 0,     # PMC 近期骑行表行数，0 = 不截断
}

BLOCK_PARAM_RANGES = {
    "km_table_rows": (1, 500),
    "time_table_rows": (1, 500),
    "compare_km_rows": (0, 500),
    "recent_rides_rows": (0, 500),
}


# ── 变量目录 ──────────────────────────────────────────────────────────────────
# (占位符, 中文标签, 单位, 小数位, 所属分组)。单位拼在值里：值为空时整行消失，
# 不会留下孤立的单位符号——这是旧代码 fmt(v, ' km') 的行为。
_SUMMARY_FIELDS = [
    ("total_dist_km",          "总距离",        " km",   1),
    ("avg_speed_kmh",          "平均速度",      " km/h", 1),
    ("max_speed_kmh",          "最大速度",      " km/h", 1),
    ("avg_hr",                 "平均心率",      " bpm",  0),
    ("max_hr",                 "最大心率",      " bpm",  0),
    ("avg_power",              "平均功率",      " W",    0),
    ("max_power",              "最大功率",      " W",    0),
    ("normalized_power",       "归一化功率 NP", " W",    0),
    ("intensity_factor",       "强度因子 IF",   "",      2),
    ("ftp_w",                  "FTP",           " W",    0),
    ("tss",                    "TSS",           "",      0),
    ("avg_cadence",            "平均踏频",      " rpm",  0),
    ("max_cadence",            "最大踏频",      " rpm",  0),
    ("total_elevation_gain_m", "总爬升",        " m",    0),
    ("total_elevation_loss_m", "总下降",        " m",    0),
    ("total_calories_kcal",    "卡路里消耗",    " kcal", 0),
    ("total_work_kj",          "总做功",        " kJ",   1),
    ("avg_temp_c",             "平均气温",      " °C",   1),
    ("max_temp_c",             "最高气温",      " °C",   0),
    ("avg_torque_eff",         "扭矩效率",      "%",     1),
    ("avg_pedal_smooth",       "踩踏平顺度",    "%",     1),
]

_WIND_FIELDS = [
    ("wind_speed_avg_kmh", "平均风速", " km/h", 1),
    ("gust_max_kmh",       "最大阵风", " km/h", 1),
    ("wind_dir_deg",       "风向角度", "°",     0),
    ("headwind_pct",       "逆风占比", "%",     0),
    ("tailwind_pct",       "顺风占比", "%",     0),
    ("crosswind_pct",      "侧风占比", "%",     0),
]

# 分组供设置界面的变量选择器分栏展示
CATALOG_GROUPS = [
    ("summary",  "骑行汇总"),
    ("derived",  "派生指标"),
    ("wind",     "气象条件"),
    ("meta",     "元数据"),
    ("pmc",      "体能管理"),
    ("calendar", "训练日历"),
    ("block",    "数据块"),
]

_EXTRA_CATALOG = [
    # (占位符, 标签, 分组)
    ("total_duration_min", "总时长（分钟）",   "summary"),
    ("moving_time_min",    "移动时长（分钟）", "summary"),
    ("vi",                 "变异系数 VI = NP/AP", "derived"),
    ("ef",                 "有氧效率 EF = NP/均心率", "derived"),
    ("wkg",                "功重比 W/kg",      "derived"),
    ("left_pct",           "左侧功率占比",     "derived"),
    ("wind_dir_label",     "主导风向",         "wind"),
    ("wind_source_label",  "风向数据源",       "wind"),
    ("filename",           "文件名",           "meta"),
    ("start_time",         "骑行开始时间",     "meta"),
    ("note",               "活动备注",         "meta"),
    ("tags",               "活动标签",         "meta"),
    ("ctl",                "体能 CTL",         "pmc"),
    ("atl",                "疲劳 ATL",         "pmc"),
    ("tsb",                "状态 TSB",         "pmc"),
    ("form_label",         "形态判定",         "pmc"),
    ("ctl_7d_ago",         "7 天前 CTL",       "pmc"),
    ("ctl_7d_delta",       "CTL 7 天变化",     "pmc"),
    ("ctl_30d_ago",        "30 天前 CTL",      "pmc"),
    ("ctl_30d_delta",      "CTL 30 天变化",    "pmc"),
    ("total_activities",   "数据覆盖骑行次数", "pmc"),
    ("first_date",         "最早记录日期",     "pmc"),
    ("pmc_ftp",            "FTP 设置值",       "pmc"),
    ("pmc_weight",         "体重设置值",       "pmc"),
    ("pmc_wkg",            "功重比设置值",     "pmc"),
    ("current_date",       "当前日期",         "calendar"),
    ("period_label",       "统计范围",         "calendar"),
    ("ride_count",         "骑行次数",         "calendar"),
    ("period_dist_km",     "区间总距离",       "calendar"),
    ("period_dur_min",     "区间总时长",       "calendar"),
    ("period_elev_m",      "区间总爬升",       "calendar"),
]

BLOCK_CATALOG = [
    ("km_table",          "逐公里分段表",     "受 km_table_rows 控制"),
    ("time_table",        "逐分钟数据表",     "受 time_table_rows 控制"),
    ("wind",              "气象条件整段",     "无风况数据时整段消失"),
    ("left_right",        "左右功率平衡行",   "无数据时整行消失"),
    ("zone_distribution", "训练区间分布",     "PMC 专用"),
    ("power_curve",       "峰值功率曲线",     "PMC 专用"),
    ("recent_rides",      "近期骑行记录表",   "PMC 专用"),
    ("compare_table",     "多骑行对比汇总表", "对比专用"),
    ("compare_detail",    "各骑行详情",       "对比专用"),
    ("calendar_rides",    "日历骑行记录表",   "日历专用"),
]


def catalog() -> dict:
    """供设置界面渲染变量选择器；与渲染器共用同一份定义，不会漂移。"""
    scalars = []
    for name, label, unit, _digits in _SUMMARY_FIELDS:
        scalars.append({"name": name, "label": label, "unit": unit.strip(), "group": "summary"})
    for name, label, unit, _digits in _WIND_FIELDS:
        scalars.append({"name": name, "label": label, "unit": unit.strip(), "group": "wind"})
    for name, label, group in _EXTRA_CATALOG:
        scalars.append({"name": name, "label": label, "unit": "", "group": group})
    return {
        "groups": [{"key": k, "label": v} for k, v in CATALOG_GROUPS],
        "scalars": scalars,
        "blocks": [{"name": n, "label": lb, "note": nt} for n, lb, nt in BLOCK_CATALOG],
        "block_params": [
            {"name": k, "default": DEFAULT_BLOCKS[k], "min": lo, "max": hi}
            for k, (lo, hi) in BLOCK_PARAM_RANGES.items()
        ],
    }


# ── 渲染 ──────────────────────────────────────────────────────────────────────
_TOKEN_RE = re.compile(r"\{\{\s*(#?)([a-z0-9_]{1,40})\s*\}\}")
_BLANK_RUN_RE = re.compile(r"\n{3,}")


def fmt_value(value, unit: str = "", digits: int = 1, *, none_text: str = NO_DATA) -> str:
    """标量格式化。None → none_text（不拼单位），与旧 _build_* 的 fmt() 一致。"""
    if value is None:
        return none_text
    try:
        return f"{round(value, digits)}{unit}"
    except TypeError:
        return f"{value}{unit}"


def render(template: str, *, scalars: dict, blocks: dict) -> tuple[str, list[str]]:
    """把模板渲染为提示词正文。

    返回 (文本, 警告列表)。规则：

    * 单次 re.sub 遍历——块的输出绝不会被再次扫描，故无递归展开。
    * 未知占位符渲染为空并记一条警告（不保留字面量，避免把模板语法喂给模型）。
    * **含占位符且所有占位符均渲染为空的行整行删除**。这条规则精确复现旧代码
      里 `if filename: lines.append(...)` 一类的条件行为。
    * 连续空行折叠为一个，使消失的块不留空洞。
    """
    warnings: list[str] = []
    seen_unknown: set[str] = set()
    out_lines: list[str] = []

    for line in template.split("\n"):
        had_token = False
        produced = False

        def _sub(match: re.Match) -> str:
            nonlocal had_token, produced
            had_token = True
            is_block, name = match.group(1) == "#", match.group(2)
            table = blocks if is_block else scalars
            if name not in table:
                key = ("#" if is_block else "") + name
                if key not in seen_unknown:
                    seen_unknown.add(key)
                    warnings.append(f"未知占位符 {{{{{key}}}}}，已渲染为空")
                return ""
            value = table[name]
            text = "" if value is None else str(value)
            if text:
                produced = True
            return text

        rendered = _TOKEN_RE.sub(_sub, line)
        if had_token and not produced:
            continue          # 占位符全空 → 整行消失
        out_lines.append(rendered)

    text = _BLANK_RUN_RE.sub("\n\n", "\n".join(out_lines)).strip("\n")
    if len(text) > MAX_RENDERED_CHARS:
        warnings.append(
            f"渲染结果 {len(text)} 字符，超过上限 {MAX_RENDERED_CHARS}，已截断"
        )
        text = text[:MAX_RENDERED_CHARS] + "\n…（内容过长已截断）"
    return text, warnings


# ── 数据块构建 ────────────────────────────────────────────────────────────────
def _cell(seg: dict, key: str, digits: int = 0) -> str:
    value = seg.get(key)
    return DASH if value is None else str(round(value, digits))


def build_km_table(km_stats: list, max_rows: int = 15) -> str:
    """逐公里分段表。超过 max_rows 时取首尾各半，中间以省略行代替。"""
    if not km_stats:
        return ""
    lines = [
        f"## 逐公里分段数据（共 {len(km_stats)} 段）",
        "公里段 | 时长(s) | 均速(km/h) | 均心率(bpm) | 均功率(W) | 均踏频(rpm) | 爬升(m) | 均坡度(%)",
        "------|--------|-----------|------------|---------|-----------|--------|--------",
    ]
    if len(km_stats) <= max_rows:
        shown = list(km_stats)
    else:
        # max(1, …) 不可省：half 为 0 时 km_stats[-0:] 等于整个列表，
        # 于是 max_rows=1 反而输出全表。
        half = max(1, max_rows // 2)
        shown = km_stats[:half] + [None] + km_stats[-half:]
    for seg in shown:
        if seg is None:
            lines.append("…（中间段省略）")
            continue
        lines.append(
            f"第{seg.get('km','?')}km | {_cell(seg,'duration_s')}s | "
            f"{_cell(seg,'avg_speed_kmh',1)} | {_cell(seg,'avg_hr')} | "
            f"{_cell(seg,'avg_power')} | {_cell(seg,'avg_cadence')} | "
            f"{_cell(seg,'elevation_gain_m')} | {_cell(seg,'avg_grade_pct',1)}"
        )
    return "\n".join(lines)


def build_time_table(time_stats: list, max_rows: int = 40) -> str:
    """逐分钟表，等距抽样到约 max_rows 行。"""
    if not time_stats:
        return ""
    lines = [
        f"## 逐分钟数据（共 {len(time_stats)} 分钟，用于识别节奏/疲劳变化）",
        "分钟 | 均速(km/h) | 均心率(bpm) | 均功率(W) | 均踏频(rpm)",
        "-----|-----------|------------|---------|----------",
    ]
    step = max(1, len(time_stats) // max_rows)
    for seg in time_stats[::step]:
        lines.append(
            f"{seg.get('km','?')} | {_cell(seg,'avg_speed_kmh',1)} | "
            f"{_cell(seg,'avg_hr')} | {_cell(seg,'avg_power')} | {_cell(seg,'avg_cadence')}"
        )
    return "\n".join(lines)


def build_wind_block(wind_data: dict | None, source_label: str = "Open-Meteo 历史天气") -> str:
    """气象条件整段。无数据返回空串，整段在模板里消失。"""
    if not wind_data or not wind_data.get("available"):
        return ""
    lines = [
        f"## 气象条件（来源：{source_label}）",
        f"- 平均风速：{wind_data['wind_speed_avg_kmh']} km/h，"
        f"阵风最大：{wind_data['gust_max_kmh']} km/h",
        f"- 主导风向：{wind_data['wind_dir_label']}（{wind_data['wind_dir_deg']}°）",
        f"- 全程逆风：{wind_data['headwind_pct']}%  "
        f"顺风：{wind_data['tailwind_pct']}%  侧风：{wind_data['crosswind_pct']}%",
    ]
    if wind_data["headwind_pct"] > 30:
        lines.append("（逆风比例偏高，速度表现可能受明显影响，分析时请结合考虑）")
    return "\n".join(lines)


def build_left_right(left_pct) -> str:
    if left_pct is None:
        return ""
    return f"- 左右功率平衡：左 {left_pct:.0f}% / 右 {100 - left_pct:.0f}%"


def build_zone_distribution(text: str | None) -> str:
    """前端已格式化好的整段字符串，原样透传（不解析）。"""
    if not text:
        return ""
    return "## 训练区间分布（骑行时间占比）\n" + text


def build_power_curve(alltime: str | None, last_90d: str | None) -> str:
    if not alltime:
        return ""
    lines = ["## 峰值功率曲线", f"- 历史最佳：{alltime}"]
    if last_90d:
        lines.append(f"- 近90天最佳：{last_90d}")
    return "\n".join(lines)


def build_recent_rides(rides: list, max_rows: int = 0) -> str:
    if not rides:
        return ""
    shown = rides[:max_rows] if max_rows else rides
    lines = [
        f"## 近期骑行记录（最近 {len(shown)} 次）",
        "日期 | 距离 | 时长 | TSS | 均心率 | 均功率",
        "-----|------|------|-----|-------|------",
    ]

    def _rv(ride: dict, key: str, spec: str = "{:.0f}") -> str:
        value = ride.get(key)
        return DASH if value is None else spec.format(value)

    for ride in shown:
        lines.append(
            f"{ride.get('date','?')} | {_rv(ride,'dist_km','{:.1f}')} km | "
            f"{_rv(ride,'dur_min')} min | {_rv(ride,'tss')} | "
            f"{_rv(ride,'avg_hr')} bpm | {_rv(ride,'avg_power')} W"
        )
    return "\n".join(lines)


def build_calendar_rides(acts: list) -> str:
    if not acts:
        return "（该时间段内无骑行记录）"
    lines = [
        "## 骑行记录",
        "日期 | 距离 | 时长 | 均心率 | 均功率 | 爬升",
        "-----|------|------|-------|-------|------",
    ]

    def _rv(value, spec: str = "{:.0f}") -> str:
        return DASH if value is None else spec.format(value)

    for act in sorted(acts, key=lambda x: x.get("date", "")):
        lines.append(
            f"{act.get('date','?')} | {_rv(act.get('dist_km'), '{:.1f}')} km | "
            f"{_rv(act.get('dur_min'))} min | {_rv(act.get('avg_hr'))} bpm | "
            f"{_rv(act.get('avg_power'))} W | {_rv(act.get('elevation_m'))} m"
        )
    return "\n".join(lines)


def wind_normalize_speed(v_avg: float | None, wind_data: dict | None) -> tuple:
    """线性近似：v_norm = v_avg + 有效逆风 × 0.25（每 1 km/h 有效逆风折 0.25 km/h）。

    前端 static/app.js 的 _cmpWindNormalize() 复刻了同一公式，**改动需同步两处**。
    """
    if not wind_data or not wind_data.get("available") or not v_avg:
        return v_avg, 0.0
    wind_speed = wind_data.get("wind_speed_avg_kmh", 0) or 0
    headwind_pct = wind_data.get("headwind_pct", 0) or 0
    tailwind_pct = wind_data.get("tailwind_pct", 0) or 0
    eff_headwind = wind_speed * (headwind_pct - tailwind_pct) / 100
    return round(v_avg + eff_headwind * 0.25, 1), round(eff_headwind, 1)


def build_compare_table(activities: list) -> str:
    lines = [
        "## 骑行对比汇总表",
        "| 编号 | 日期 | 距离(km) | 均速(km/h) | 归一化均速(km/h) | 有效逆风(km/h) | "
        "均功率(W) | NP(W) | 均心率(bpm) | 爬升(m) |",
        "|------|------|---------|-----------|----------------|--------------|"
        "---------|-------|-----------|--------|",
    ]
    for index, act in enumerate(activities, 1):
        summary = act.get("summary") or {}
        wind = act.get("wind_data") or {}
        v_avg = summary.get("avg_speed_kmh")
        v_norm, eff_hw = wind_normalize_speed(v_avg, wind if wind.get("available") else None)
        date_str = (act.get("start_time") or "")[:10] or "未知"
        eff_str = fmt_value(eff_hw if wind.get("available") else None, "", 1)
        lines.append(
            f"| {index} | {date_str} | {fmt_value(summary.get('total_dist_km'), '', 1)} | "
            f"{fmt_value(v_avg, '', 1)} | {fmt_value(v_norm, '', 1)} | {eff_str} | "
            f"{fmt_value(summary.get('avg_power'), '', 0)} | "
            f"{fmt_value(summary.get('normalized_power'), '', 0)} | "
            f"{fmt_value(summary.get('avg_hr'), '', 0)} | "
            f"{fmt_value(summary.get('total_elevation_gain_m'), '', 0)} |"
        )
    return "\n".join(lines)


def build_compare_detail(activities: list, max_km_rows: int = 0) -> str:
    lines: list[str] = []
    for index, act in enumerate(activities, 1):
        summary = act.get("summary") or {}
        wind = act.get("wind_data") or {}
        km_stats = act.get("km_stats") or []
        name = act.get("filename", f"骑行{index}")
        start = act.get("start_time", "")
        v_avg = summary.get("avg_speed_kmh")
        v_norm, eff_hw = wind_normalize_speed(v_avg, wind if wind.get("available") else None)

        lines.append(f"## 骑行 {index} — {name}" + (f"（{start[:16]}）" if start else ""))

        if wind.get("available"):
            lines.append(
                f"**风况**：均风速 {wind.get('wind_speed_avg_kmh')} km/h，"
                f"逆风 {wind.get('headwind_pct')}%，顺风 {wind.get('tailwind_pct')}%，"
                f"侧风 {wind.get('crosswind_pct')}%"
            )
            lines.append(
                f"**有效逆风**：{eff_hw} km/h → **归一化均速**：{v_norm} km/h"
                f"（原 {fmt_value(v_avg, '', 1)} km/h）"
            )
        else:
            lines.append("**风况**：无数据（均速未作风力归一化）")

        lines += [
            "",
            f"**汇总**：距离 {fmt_value(summary.get('total_dist_km'), ' km')}，"
            f"移动时长 {fmt_value((summary.get('moving_time_s') or 0) / 60, ' 分钟', 0)}，"
            f"爬升 {fmt_value(summary.get('total_elevation_gain_m'), ' m', 0)}，"
            f"均踏频 {fmt_value(summary.get('avg_cadence'), ' rpm', 0)}，"
            f"均功率 {fmt_value(summary.get('avg_power'), ' W', 0)}，"
            f"NP {fmt_value(summary.get('normalized_power'), ' W', 0)}，"
            f"均心率 {fmt_value(summary.get('avg_hr'), ' bpm', 0)}",
            "",
        ]

        if km_stats:
            shown = km_stats[:max_km_rows] if max_km_rows else km_stats
            lines.append(f"**逐公里分段（共 {len(km_stats)} 段）**")
            lines.append("公里段 | 时长(s) | 均速(km/h) | 均心率(bpm) | 均功率(W) | 均踏频(rpm) | 爬升(m)")
            lines.append("------|--------|-----------|------------|---------|-----------|-------")
            for seg in shown:
                lines.append(
                    f"第{seg.get('km','?')}km | {_cell(seg,'duration_s')}s | "
                    f"{_cell(seg,'avg_speed_kmh',1)} | {_cell(seg,'avg_hr')} | "
                    f"{_cell(seg,'avg_power')} | {_cell(seg,'avg_cadence')} | "
                    f"{_cell(seg,'elevation_gain_m')}"
                )
        else:
            lines.append("**逐公里数据**：无")

        lines.append("")
    return "\n".join(lines)


def pmc_form_label(tsb: float) -> str:
    if tsb > 10:
        return "新鲜（Fresh）— 体力充沛，适合比赛或高强度训练"
    if tsb > -5:
        return "最佳区间（Optimal）— 训练与恢复平衡，黄金训练期"
    if tsb > -20:
        return "疲劳（Tired）— 有训练负荷积累，建议控制强度"
    if tsb > -40:
        return "较疲劳（Very Tired）— 需要主动恢复"
    return "过度疲劳（Overreached）— 建议安排休息日"


# ── 默认模板 ──────────────────────────────────────────────────────────────────
# 内容照抄改造前的 _build_* 输出，仅修正一处顺序缺陷：改造前当风况数据存在时，
# 「### 8. 风力影响评估」会被插在数据区、排到「### 1. 骑行概览」之前，且
# 「- 左右功率平衡」这条数据行被挤到两条指令文本之间。现已各归其位。

_EVALUATE = """\
你是一名专业公路自行车训练教练，请根据以下骑行数据进行全面分析，输出结构化中文评估报告。

## 骑行基本信息
- 骑行开始时间：{{start_time}}
- 文件名：{{filename}}

## 骑行汇总数据
- 总距离：{{total_dist_km}}
- 总时长：{{total_duration_min}}
- 移动时长：{{moving_time_min}}
- 平均速度：{{avg_speed_kmh}}
- 最大速度：{{max_speed_kmh}}
- 总爬升：{{total_elevation_gain_m}}
- 总下降：{{total_elevation_loss_m}}
- 平均心率：{{avg_hr}}
- 最大心率：{{max_hr}}
- 平均踏频：{{avg_cadence}}
- 平均功率：{{avg_power}}
- 最大功率：{{max_power}}
- 归一化功率 (NP)：{{normalized_power}}
- 卡路里消耗：{{total_calories_kcal}}
- 平均气温：{{avg_temp_c}}
{{#left_right}}

{{#wind}}

{{#km_table}}

{{#time_table}}

## 评估报告章节（仅输出数据充分的章节，无相关数据的章节跳过）

### 1. 骑行概览
一段话总结本次骑行的场景（距离/地形/强度定性）。

### 2. 速度与配速分析
评估均速水平、逐公里速度稳定性（变异幅度）、是否存在明显掉速。

### 3. 心率分析（如有心率数据）
评估有氧强度区间、心率漂移情况、有氧效率（如同时有功率：EF = NP / 均心率）。

### 4. 功率分析（如有功率数据）
分析 AP/NP 差距（变异系数 VI = NP/AP，越接近1越匀速）、功率输出水平定性评价。

### 5. 爬升表现（如爬升 > 50 m）
评估爬坡段速度/心率/功率的响应，以及整体爬升效率。

### 6. 综合评分
给出本次训练质量评分（1–10分），列出2–3个亮点和1–2个改进方向。

### 7. 训练建议
基于本次骑行数据，给出1–3条具体可执行的下次训练建议。

### 8. 风力影响评估（仅当上方给出气象条件且逆风 > 30% 时输出，否则跳过）
说明风力对本次骑行均速的影响程度，估算去除风力因素后的实际能力水平。

格式要求：Markdown，## 做章节标题，**加粗**关键数值，- 做列表。语言简洁专业。"""


_COMPARE = """\
你是一名专业公路自行车训练教练，请根据以下多次骑行数据进行横向对比分析，输出结构化中文对比报告。

{{#compare_table}}

{{#compare_detail}}
## 对比分析要求

请依次输出以下章节（无充分数据的章节可跳过）：

### 1. 速度效率对比
以**归一化均速**为主要指标，说明风力调整是否合理，哪次骑行速度效率最高。

### 2. 配速策略对比
分析各骑行逐公里速度/功率节奏的稳定性（变异幅度），谁的配速更均匀。

### 3. 有氧效率对比（如有心率 + 功率数据）
对比各骑行的 EF（= NP / 均心率），数值越高说明有氧效率越好。

### 4. 爬坡表现对比（如爬升 > 50 m）
对比各骑行在爬升段的速度/功率/心率响应及整体爬升效率。

### 5. 综合评定
明确指出哪次骑行综合表现最优，给出具体理由（引用关键数值）。

### 6. 训练建议
基于对比结果，给出 1–3 条针对性的训练建议。

格式：Markdown，## 做章节标题，**加粗**关键对比数值，重要对比用表格呈现。语言简洁专业。"""


_PMC = """\
你是一名专业公路自行车训练教练，请根据以下训练管理图（PMC）数据进行体能状态分析，给出恢复与训练建议，用中文输出。

## 当前 PMC 状态
- 体能 CTL（42天慢性训练负荷）：**{{ctl}}**
- 疲劳 ATL（7天急性训练负荷）：**{{atl}}**
- 状态 TSB（今日形态 = 昨日CTL − 昨日ATL）：**{{tsb}}**
- 形态判定：**{{form_label}}**
- FTP：{{pmc_ftp}}
- 体重：{{pmc_weight}}
- 功重比：{{pmc_wkg}}
- CTL 7天前：{{ctl_7d_ago}}（变化 {{ctl_7d_delta}}）
- CTL 30天前：{{ctl_30d_ago}}（变化 {{ctl_30d_delta}}）
- 数据覆盖：{{total_activities}} 次骑行，最早记录 {{first_date}}

{{#zone_distribution}}

{{#power_curve}}

{{#recent_rides}}

## 请输出以下分析（Markdown格式，简洁专业）：
### 1. 当前状态解读
解读CTL/ATL/TSB数值，说明当前体能与疲劳水平。
### 2. 疲劳与恢复评估
当前是否过度训练？需要休息还是可以继续？
### 3. 近期训练模式分析
从近期数据看训练规律、强度分布、是否有明显规律或问题。
### 4. 近期建议（1-2周）
具体的训练安排：强度、量、休息日。
### 5. 中期目标（1-3个月）
如何合理提升CTL？建议目标区间和提升节奏（每周CTL增幅不超过3-5）。"""


_CALENDAR_HEAD = """\
你是一名专业公路自行车训练教练，请根据用户{period}的骑行数据，给出个性化的训练建议，用中文输出。

## 训练概况
- 当前日期：{{{{current_date}}}}
- 统计范围：{{{{period_label}}}}
- 骑行次数：{{{{ride_count}}}} 次
- 总距离：{{{{period_dist_km}}}} km
- 总时长：{{{{period_dur_min}}}} 分钟
- 总爬升：{{{{period_elev_m}}}} m

{{{{#calendar_rides}}}}

## 请输出以下分析（Markdown格式，简洁专业）：
"""

_CALENDAR_7D = _CALENDAR_HEAD.format(period="过去7天") + """\
### 1. 本周训练总结
评估本周训练量、强度、频率是否合理。
### 2. 恢复状态
根据本周负荷判断疲劳程度，是否需要安排恢复日。
### 3. 下周训练建议
给出具体的下周训练安排（哪几天训练、休息日、重点训练类型）。"""

_CALENDAR_30D = _CALENDAR_HEAD.format(period="过去30天") + """\
### 1. 过去一个月训练回顾
总结训练量、强度分布、训练规律性。
### 2. 进步与不足
从数据中找出亮点和需要改进的地方。
### 3. 接下来四周训练建议
给出分周的具体训练建议（量、强度、重点训练类型）。
### 4. 短期目标
基于当前水平，设定合理可达的月度目标。"""


DEFAULT_TEMPLATES: dict[str, str] = {
    "evaluate": _EVALUATE,
    "compare": _COMPARE,
    "pmc": _PMC,
    "calendar_7d": _CALENDAR_7D,
    "calendar_30d": _CALENDAR_30D,
}

TEMPLATE_KINDS = tuple(DEFAULT_TEMPLATES)

TEMPLATE_LABELS = {
    "evaluate": "单次骑行评估",
    "compare": "多骑行对比",
    "pmc": "体能管理分析",
    "calendar_7d": "训练日历 · 周建议",
    "calendar_30d": "训练日历 · 月建议",
}


def references(template: str, *names: str) -> bool:
    """模板是否引用了任一给定占位符。必须走正则——`{{ note }}` 带空格也算引用，
    子串匹配会漏掉，导致数据静默缺失。"""
    wanted = set(names)
    return any(name in wanted for _hash, name in _TOKEN_RE.findall(template))


def resolve_template(kind: str, templates: dict | None) -> str:
    """取用户自定义模板；缺失、为空或超长一律回退到代码里的默认值。"""
    if kind not in DEFAULT_TEMPLATES:
        raise ValueError(f"未知的提示词类型: {kind}")
    custom = (templates or {}).get(kind)
    if isinstance(custom, str) and custom.strip():
        if len(custom) > MAX_TEMPLATE_CHARS:
            # 手工编辑的文件绕过了保存时的校验，这里兜底
            logging.warning(
                "提示词模板 %s 超过 %d 字符（实际 %d），已回退默认",
                kind, MAX_TEMPLATE_CHARS, len(custom),
            )
            return DEFAULT_TEMPLATES[kind]
        return custom
    return DEFAULT_TEMPLATES[kind]


def resolve_blocks(blocks: dict | None) -> dict:
    """块参数与默认值合并，越界值回退默认。"""
    merged = dict(DEFAULT_BLOCKS)
    for key, value in (blocks or {}).items():
        if key not in BLOCK_PARAM_RANGES or isinstance(value, bool):
            continue
        if not isinstance(value, (int, float)):
            continue
        low, high = BLOCK_PARAM_RANGES[key]
        if low <= value <= high:
            merged[key] = int(value)
    return merged
