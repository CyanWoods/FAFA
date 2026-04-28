#!/usr/bin/env python3
"""将目录下所有 FIT 文件的 GPS 路径绘制在同一张地图上。

坐标直接取自 FIT 文件，不做任何坐标系转换。
悬停路径显示文件名，不同路径自动分配不同颜色。

用法:
    .venv/bin/python map_all.py
    .venv/bin/python map_all.py input/ --tiles dark-nolabels
    .venv/bin/python map_all.py input/ --tiles light-nolabels -o clean.html
"""

import sys
import argparse
from pathlib import Path

import folium

from fafa.parser import parse_fit
from fafa.gcj02 import needs_wgs84_conversion, to_tile_coords
from fafa.tiles import make_map, tile_crs, STYLE_CHOICES

SEMICIRCLE_TO_DEG = 180.0 / (2 ** 31)

PALETTE = [
    "#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6",
    "#1abc9c", "#e67e22", "#e91e63", "#00bcd4", "#ff5722",
    "#8bc34a", "#673ab7", "#607d8b", "#ff9800", "#009688",
]


def _extract_coords(fit_path: Path, crs: str, max_points: int) -> list[tuple[float, float]]:
    fit = parse_fit(str(fit_path))
    input_is_gcj02 = not needs_wgs84_conversion(fit.manufacturer)
    raw = [
        to_tile_coords(
            r.position_lat * SEMICIRCLE_TO_DEG,
            r.position_long * SEMICIRCLE_TO_DEG,
            input_is_gcj02, crs,
        )
        for r in fit.records
        if r.position_lat is not None and r.position_long is not None
    ]
    if not raw:
        return []
    if len(raw) > max_points:
        step = len(raw) / max_points
        raw = [raw[int(i * step)] for i in range(max_points)]
    return raw


def build_all_map(
    input_dir: str,
    output_path: str | None = None,
    max_points: int = 500,
    style: str = "amap",
) -> str:
    in_dir = Path(input_dir)
    fit_files = sorted(in_dir.glob("*.fit"))
    if not fit_files:
        raise ValueError(f"在 {in_dir} 中未找到 .fit 文件")

    crs = tile_crs(style)
    m = make_map(center=(30.0, 120.0), zoom=10, style=style)

    all_lats: list[float] = []
    all_lons: list[float] = []
    loaded = 0
    skipped = 0

    print(f"正在处理 {len(fit_files)} 个 FIT 文件（底图: {style}）...", file=sys.stderr)

    for fp in fit_files:
        try:
            coords = _extract_coords(fp, crs, max_points)
        except Exception as e:
            print(f"  [跳过] {fp.name}: {e}", file=sys.stderr)
            skipped += 1
            continue

        if not coords:
            print(f"  [跳过] {fp.name}: 无 GPS 数据", file=sys.stderr)
            skipped += 1
            continue

        color = PALETTE[loaded % len(PALETTE)]
        folium.PolyLine(
            coords,
            color=color,
            weight=3,
            opacity=0.75,
            tooltip=folium.Tooltip(fp.stem, sticky=False),
        ).add_to(m)

        all_lats.extend(c[0] for c in coords)
        all_lons.extend(c[1] for c in coords)
        loaded += 1

    if not all_lats:
        raise ValueError("所有文件均无有效 GPS 数据")

    m.fit_bounds([
        [min(all_lats), min(all_lons)],
        [max(all_lats), max(all_lons)],
    ])

    out_dir = Path(__file__).parent / "output"
    out_dir.mkdir(exist_ok=True)
    out = Path(output_path) if output_path else out_dir / "all_tracks.html"
    m.save(str(out))

    print(f"完成：{loaded} 条路径，{skipped} 个跳过，地图已保存: {out}", file=sys.stderr)
    return str(out)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="将所有 FIT 文件 GPS 路径绘制在同一张地图上"
    )
    parser.add_argument(
        "input_dir", nargs="?", default="input",
        help="FIT 文件目录（默认: input）",
    )
    parser.add_argument("-o", "--output", help="输出 HTML 路径（默认: output/all_tracks.html）")
    parser.add_argument(
        "--max-points", type=int, default=500,
        help="每条路径最多采样点数（默认: 500）",
    )
    parser.add_argument(
        "--tiles",
        choices=STYLE_CHOICES,
        default="amap",
        help="底图样式: amap / light / light-nolabels / dark / dark-nolabels（默认: amap）",
    )
    args = parser.parse_args()

    try:
        out = build_all_map(args.input_dir, args.output, args.max_points, args.tiles)
        print(f"地图已生成: {out}")
    except ValueError as e:
        print(f"错误: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
