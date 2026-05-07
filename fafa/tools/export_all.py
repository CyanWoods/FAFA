#!/usr/bin/env python3
"""批量解析 input/ 下所有 FIT 文件，导出供 AI 使用的 JSON。

输出格式：
  {
    "meta": { exported_at, total_activities, total_km, date_range },
    "activities": [
      { "filename", "date", "summary": {...}, "km_stats": [{...}, ...] },
      ...
    ]
  }

用法：
  .venv/bin/python -m fafa.tools.export_all                          # 导出到 export.json
  .venv/bin/python -m fafa.tools.export_all -o ai_data.json          # 指定输出文件
  .venv/bin/python -m fafa.tools.export_all --no-km-stats            # 只含 summary（文件更小）
  .venv/bin/python -m fafa.tools.export_all --min-km 5               # 过滤 5 km 以下的短骑行
  .venv/bin/python -m fafa.tools.export_all --input custom/dir       # 指定 FIT 文件目录
"""

import argparse
import json
import re
import sys
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent.parent

# 支持旧格式 Magene_{model}_YYYYMMDD-HHMMSS_{id}.fit 和
# 新格式 Magene_{model}_{id}_YYYYMMDD-HHMMSS.fit，型号不限于 C506
_DATE_PATTERN = re.compile(r"Magene_[A-Z]\d+_(?:(\d{8}-\d{6})_|\d+_(\d{8}-\d{6}))")


def _date_from_filename(name: str) -> datetime | None:
    m = _DATE_PATTERN.search(name)
    if m:
        try:
            return datetime.strptime(m.group(1) or m.group(2), "%Y%m%d-%H%M%S")
        except ValueError:
            pass
    return None


def _strip_nulls(obj):
    """递归去除 None 值，减少 JSON 体积。"""
    if isinstance(obj, dict):
        return {k: _strip_nulls(v) for k, v in obj.items() if v is not None}
    if isinstance(obj, list):
        return [_strip_nulls(item) for item in obj]
    return obj


def _process_file(path: Path, include_km_stats: bool, keep_nulls: bool) -> dict | None:
    from fafa.parser import parse_fit
    from fafa.stats import compute_km_stats, compute_summary

    try:
        fit = parse_fit(str(path))
    except Exception as e:
        print(f"  [跳过] {path.name}: 解析失败 — {e}", file=sys.stderr)
        return None

    if not fit.records:
        print(f"  [跳过] {path.name}: 无数据记录", file=sys.stderr)
        return None

    try:
        km_stats = compute_km_stats(fit)
        summary = compute_summary(fit, km_stats)
    except Exception as e:
        print(f"  [跳过] {path.name}: 统计失败 — {e}", file=sys.stderr)
        return None

    # 日期优先从文件名取，降级到第一条记录的时间戳
    date_obj = _date_from_filename(path.name)
    if date_obj is None:
        try:
            date_obj = fit.records[0].timestamp
        except Exception:
            date_obj = None
    date_str = date_obj.strftime("%Y-%m-%dT%H:%M:%S") if date_obj else None

    summary_dict = asdict(summary)
    km_stats_list = [asdict(s) for s in km_stats] if include_km_stats else None

    entry: dict = {
        "filename": path.name,
        "date": date_str,
        "summary": summary_dict,
    }
    if include_km_stats:
        entry["km_stats"] = km_stats_list

    if not keep_nulls:
        entry = _strip_nulls(entry)

    return entry


def main() -> None:
    parser = argparse.ArgumentParser(
        description="批量导出 FIT 文件为 AI 可用 JSON",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "示例:\n"
            "  %(prog)s                        # 导出全部到 export.json\n"
            "  %(prog)s --no-km-stats          # 只含骑行汇总，文件更小\n"
            "  %(prog)s --min-km 5             # 过滤 5 km 以下短骑\n"
            "  %(prog)s -o ~/Desktop/data.json # 指定输出路径\n"
        ),
    )
    parser.add_argument(
        "--input", "-i",
        default=str(PROJECT_ROOT / "input"),
        metavar="DIR",
        help="FIT 文件目录（默认: input/）",
    )
    parser.add_argument(
        "--output", "-o",
        default=str(PROJECT_ROOT / "export.json"),
        metavar="FILE",
        help="输出 JSON 文件路径（默认: export.json）",
    )
    parser.add_argument(
        "--no-km-stats",
        action="store_true",
        help="不包含逐公里数据，只输出骑行汇总（文件显著更小）",
    )
    parser.add_argument(
        "--min-km",
        type=float,
        default=0.0,
        metavar="N",
        help="过滤总距离小于 N km 的骑行（默认: 0，不过滤）",
    )
    parser.add_argument(
        "--keep-nulls",
        action="store_true",
        help="保留 null 字段（默认去除，减少 JSON 体积）",
    )
    args = parser.parse_args()

    input_dir = Path(args.input)
    if not input_dir.is_dir():
        print(f"错误：找不到目录 {input_dir}", file=sys.stderr)
        sys.exit(1)

    fit_files = sorted(input_dir.glob("*.fit"))
    if not fit_files:
        print(f"在 {input_dir} 中未找到 .fit 文件", file=sys.stderr)
        sys.exit(1)

    include_km = not args.no_km_stats
    print(
        f"处理 {len(fit_files)} 个 FIT 文件"
        f"{'（含逐公里数据）' if include_km else '（仅汇总）'}",
        file=sys.stderr,
    )

    activities = []
    skipped_parse = 0
    skipped_km = 0

    for i, path in enumerate(fit_files, 1):
        print(f"  [{i:3d}/{len(fit_files)}] {path.name}", end="\r", file=sys.stderr)

        entry = _process_file(path, include_km, args.keep_nulls)
        if entry is None:
            skipped_parse += 1
            continue

        # 过滤短骑行
        total_km = entry.get("summary", {}).get("total_dist_km") or 0
        if args.min_km > 0 and total_km < args.min_km:
            skipped_km += 1
            continue

        activities.append(entry)

    print(" " * 80, end="\r", file=sys.stderr)  # 清除进度行

    # 按日期排序（升序）
    activities.sort(key=lambda a: a.get("date") or "")

    # 汇总 meta
    total_km = sum(
        (a.get("summary", {}).get("total_dist_km") or 0) for a in activities
    )
    dates = [a["date"] for a in activities if a.get("date")]
    meta = {
        "exported_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "total_activities": len(activities),
        "total_km": round(total_km, 2),
        "date_range": [dates[0][:10], dates[-1][:10]] if dates else [],
        "includes_km_stats": include_km,
    }

    output = {"meta": meta, "activities": activities}
    out_path = Path(args.output)

    out_path.write_text(
        json.dumps(output, ensure_ascii=False, indent=2, default=str),
        encoding="utf-8",
    )

    print(
        f"导出完成：{len(activities)} 条活动 / {total_km:.1f} km 总计",
        file=sys.stderr,
    )
    if skipped_parse:
        print(f"  解析失败跳过：{skipped_parse} 个", file=sys.stderr)
    if skipped_km:
        print(f"  距离过短跳过：{skipped_km} 个（< {args.min_km} km）", file=sys.stderr)
    print(f"输出文件：{out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
