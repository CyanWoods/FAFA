#!/usr/bin/env python3
"""将单个 FIT 文件的 GPS 路径渲染为交互式地图。

坐标直接取自 FIT 文件，不做任何坐标系转换。

用法:
    .venv/bin/python map_track.py input/xxx.fit
    .venv/bin/python map_track.py input/xxx.fit --tiles dark-nolabels
    .venv/bin/python map_track.py input/xxx.fit --color hr --tiles light-nolabels
"""

import sys
import argparse
from pathlib import Path

import folium
import branca.colormap as cm

from fafa.parser import parse_fit, Record
from fafa.gcj02 import needs_wgs84_conversion, to_tile_coords
from fafa.tiles import make_map, tile_crs, STYLE_CHOICES

SEMICIRCLE_TO_DEG = 180.0 / (2 ** 31)

METRIC_CONFIG = {
    "speed":    {"label": "速度",   "unit": "km/h", "colors": ["#3498db", "#2ecc71", "#f1c40f", "#e74c3c"]},
    "hr":       {"label": "心率",   "unit": "bpm",  "colors": ["#3498db", "#2ecc71", "#f1c40f", "#e74c3c"]},
    "power":    {"label": "功率",   "unit": "W",    "colors": ["#3498db", "#2ecc71", "#f1c40f", "#e74c3c"]},
    "altitude": {"label": "海拔",   "unit": "m",    "colors": ["#27ae60", "#f39c12", "#8e44ad", "#2c3e50"]},
}


def _metric_value(r: Record, metric: str) -> float | None:
    if metric == "speed":
        return r.speed_ms * 3.6 if r.speed_ms is not None else None
    if metric == "hr":
        return float(r.heart_rate) if r.heart_rate is not None else None
    if metric == "power":
        return float(r.power) if r.power is not None else None
    if metric == "altitude":
        return r.altitude
    return None


def build_map(
    filepath: str,
    output_path: str | None = None,
    metric: str = "speed",
    style: str = "amap",
) -> str:
    fit = parse_fit(filepath)
    input_is_gcj02 = not needs_wgs84_conversion(fit.manufacturer)
    crs = tile_crs(style)

    gps: list[tuple[tuple[float, float], Record]] = []
    for r in fit.records:
        if r.position_lat is None or r.position_long is None:
            continue
        lat = r.position_lat * SEMICIRCLE_TO_DEG
        lon = r.position_long * SEMICIRCLE_TO_DEG
        gps.append((to_tile_coords(lat, lon, input_is_gcj02, crs), r))

    if not gps:
        raise ValueError("FIT 文件中没有 GPS 数据")

    coords = [p[0] for p in gps]
    lats = [c[0] for c in coords]
    lons = [c[1] for c in coords]

    m = make_map(
        center=(sum(lats) / len(lats), sum(lons) / len(lons)),
        style=style,
    )
    m.fit_bounds([[min(lats), min(lons)], [max(lats), max(lons)]])

    cfg = METRIC_CONFIG.get(metric)
    values = [_metric_value(p[1], metric) for p in gps] if cfg else []
    valid = [v for v in values if v is not None]

    if cfg and valid:
        vmin, vmax = min(valid), max(valid)
        colormap = cm.LinearColormap(
            colors=cfg["colors"],
            vmin=vmin, vmax=vmax,
            caption=f"{cfg['label']} ({cfg['unit']})",
        )
        colormap.add_to(m)

        segments, seg_colors = [], []
        cur_seg = [coords[0]]
        cur_color = colormap(values[0]) if values[0] is not None else "#aaaaaa"

        for i in range(1, len(coords)):
            c = colormap(values[i]) if values[i] is not None else "#aaaaaa"
            cur_seg.append(coords[i])
            if c != cur_color:
                segments.append(cur_seg)
                seg_colors.append(cur_color)
                cur_seg = [coords[i]]
                cur_color = c
        segments.append(cur_seg)
        seg_colors.append(cur_color)

        for seg, color in zip(segments, seg_colors):
            folium.PolyLine(seg, color=color, weight=4, opacity=0.85).add_to(m)
    else:
        folium.PolyLine(coords, color="#e74c3c", weight=4, opacity=0.85).add_to(m)

    start_r = gps[0][1]
    folium.Marker(
        coords[0],
        popup=folium.Popup(f"<b>起点</b><br>{start_r.timestamp}", max_width=200),
        icon=folium.Icon(color="green", icon="play", prefix="fa"),
        tooltip="起点",
    ).add_to(m)

    end_r = gps[-1][1]
    dist_km = fit.records[-1].distance_m / 1000
    elapsed = end_r.timestamp - start_r.timestamp
    folium.Marker(
        coords[-1],
        popup=folium.Popup(
            f"<b>终点</b><br>{end_r.timestamp}<br>距离: {dist_km:.2f} km<br>用时: {elapsed}",
            max_width=220,
        ),
        icon=folium.Icon(color="red", icon="flag", prefix="fa"),
        tooltip="终点",
    ).add_to(m)

    out_dir = Path(__file__).parent / "output"
    out_dir.mkdir(exist_ok=True)
    out = Path(output_path) if output_path else out_dir / f"{Path(filepath).stem}.html"
    m.save(str(out))
    return str(out)


def main() -> None:
    parser = argparse.ArgumentParser(description="将 FIT 文件 GPS 路径渲染为交互式地图")
    parser.add_argument("fit_file", help="FIT 文件路径")
    parser.add_argument("-o", "--output", help="输出 HTML 路径")
    parser.add_argument(
        "--color",
        choices=["speed", "hr", "power", "altitude", "none"],
        default="speed",
        help="轨迹颜色指标（默认: speed）",
    )
    parser.add_argument(
        "--tiles",
        choices=STYLE_CHOICES,
        default="amap",
        help="底图样式: amap / light / light-nolabels / dark / dark-nolabels（默认: amap）",
    )
    args = parser.parse_args()

    fit_path = Path(args.fit_file)
    if not fit_path.exists():
        print(f"错误: 找不到文件 {fit_path}", file=sys.stderr)
        sys.exit(1)

    print(f"正在解析: {fit_path.name}", file=sys.stderr)
    try:
        out = build_map(str(fit_path), args.output, metric=args.color, style=args.tiles)
        print(f"地图已生成: {out}")
    except ValueError as e:
        print(f"错误: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
