#!/usr/bin/env python3
"""FAFA — 按公里统计骑行FIT文件数据"""

import argparse
import contextlib
import io
import sys

from fafa.parser import parse_fit
from fafa.stats import compute_km_stats, compute_summary
from fafa.reporter import print_table, to_json, to_csv


def main():
    parser = argparse.ArgumentParser(
        description="解析骑行FIT文件，按公里输出心率、功率、踏频、海拔、速度等统计"
    )
    parser.add_argument("fit_file", help="FIT文件路径")
    parser.add_argument("--json", action="store_true", help="输出JSON格式")
    parser.add_argument("--csv", action="store_true", help="输出CSV格式（不含汇总）")
    parser.add_argument("-o", "--output", help="输出到文件（默认打印到终端）")
    args = parser.parse_args()

    print(f"正在解析: {args.fit_file}", file=sys.stderr)

    try:
        fit = parse_fit(args.fit_file)
    except FileNotFoundError:
        print(f"错误: 找不到文件 {args.fit_file}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"错误: 解析失败 — {e}", file=sys.stderr)
        sys.exit(1)

    if not fit.records:
        print("错误: 未找到有效的骑行数据记录（record messages）", file=sys.stderr)
        sys.exit(1)

    total_km = fit.records[-1].distance_m / 1000
    print(f"总距离: {total_km:.2f} km，共 {len(fit.records)} 条数据记录", file=sys.stderr)

    km_stats = compute_km_stats(fit)
    summary = compute_summary(fit, km_stats)

    if args.json:
        output = to_json(km_stats, summary)
    elif args.csv:
        output = to_csv(km_stats)
    else:
        output = None

    if output is not None:
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(output)
            print(f"已输出到: {args.output}", file=sys.stderr)
        else:
            print(output)
    else:
        if args.output:
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                print_table(km_stats, summary)
            with open(args.output, "w", encoding="utf-8") as f:
                f.write(buf.getvalue())
            print(f"已输出到: {args.output}", file=sys.stderr)
        else:
            print_table(km_stats, summary)


if __name__ == "__main__":
    main()
