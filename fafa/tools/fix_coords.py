#!/usr/bin/env python3
"""对 FIT 文件的 GPS 坐标进行火星坐标系转换。

方法：
  decrypt   火星解密：GCJ-02 → WGS-84（适用于 Magene 等存 GCJ-02 的设备）
  encrypt   火星加密：WGS-84 → GCJ-02（适用于 Garmin 等存 WGS-84 的设备）

用法：
  .venv/bin/python -m fafa.tools.fix_coords --method decrypt
  .venv/bin/python -m fafa.tools.fix_coords --method encrypt input/ -o output/fixed/
  .venv/bin/python -m fafa.tools.fix_coords --method decrypt --dry-run
"""

import argparse
import io
import math
import sys
from pathlib import Path

from garmin_fit_sdk import Decoder, Encoder, Stream

# ── 常量 ──────────────────────────────────────────────────────────────────────
SEMI_TO_DEG = 180.0 / (2 ** 31)
DEG_TO_SEMI = (2 ** 31) / 180.0

# FIT 消息名 → mesg_num（仅列出活动文件中常见的类型）
MESG_NUM: dict[str, int] = {
    "file_id_mesgs": 0,
    "file_creator_mesgs": 49,
    "capabilities_mesgs": 1,
    "device_settings_mesgs": 2,
    "user_profile_mesgs": 3,
    "bike_profile_mesgs": 6,
    "zones_target_mesgs": 7,
    "sport_mesgs": 12,
    "session_mesgs": 18,
    "lap_mesgs": 19,
    "record_mesgs": 20,
    "event_mesgs": 21,
    "device_info_mesgs": 23,
    "workout_mesgs": 26,
    "workout_step_mesgs": 27,
    "totals_mesgs": 33,
    "activity_mesgs": 34,
    "software_mesgs": 35,
    "field_capabilities_mesgs": 39,
    "length_mesgs": 101,
    "monitoring_info_mesgs": 103,
    "hr_mesgs": 132,
    "segment_lap_mesgs": 142,
    "training_file_mesgs": 72,
    "course_mesgs": 31,
    "course_point_mesgs": 32,
    "field_description_mesgs": 206,
    "developer_data_id_mesgs": 207,
    "gps_metadata_mesgs": 160,
    "climb_pro_mesgs": 317,
    "split_mesgs": 312,
    "split_summary_mesgs": 313,
    "set_mesgs": 225,
}

# ── GCJ-02 转换 ───────────────────────────────────────────────────────────────
_A  = 6378245.0
_EE = 0.00669342162296594323


def _out_of_china(lat: float, lon: float) -> bool:
    return not (72.004 <= lon <= 137.8347 and 0.8293 <= lat <= 55.8271)


def _t_lat(x: float, y: float) -> float:
    r = -100 + 2*x + 3*y + 0.2*y*y + 0.1*x*y + 0.2*math.sqrt(abs(x))
    r += (20*math.sin(6*x*math.pi) + 20*math.sin(2*x*math.pi)) * 2/3
    r += (20*math.sin(y*math.pi)   + 40*math.sin(y/3*math.pi)) * 2/3
    r += (160*math.sin(y/12*math.pi) + 320*math.sin(y*math.pi/30)) * 2/3
    return r


def _t_lon(x: float, y: float) -> float:
    r = 300 + x + 2*y + 0.1*x*x + 0.1*x*y + 0.1*math.sqrt(abs(x))
    r += (20*math.sin(6*x*math.pi) + 20*math.sin(2*x*math.pi)) * 2/3
    r += (20*math.sin(x*math.pi)   + 40*math.sin(x/3*math.pi)) * 2/3
    r += (150*math.sin(x/12*math.pi) + 300*math.sin(x/30*math.pi)) * 2/3
    return r


def _delta(lat: float, lon: float) -> tuple[float, float]:
    d_lat = _t_lat(lon - 105.0, lat - 35.0)
    d_lon = _t_lon(lon - 105.0, lat - 35.0)
    rad = lat / 180.0 * math.pi
    magic = math.sin(rad)
    magic = 1 - _EE * magic * magic
    sqrt_magic = math.sqrt(magic)
    d_lat = d_lat * 180.0 / ((_A * (1 - _EE)) / (magic * sqrt_magic) * math.pi)
    d_lon = d_lon * 180.0 / (_A / sqrt_magic * math.cos(rad) * math.pi)
    return d_lat, d_lon


def gcj02_to_wgs84(lat: float, lon: float) -> tuple[float, float]:
    """火星解密：GCJ-02 → WGS-84"""
    if _out_of_china(lat, lon):
        return lat, lon
    d_lat, d_lon = _delta(lat, lon)
    return lat - d_lat, lon - d_lon


def wgs84_to_gcj02(lat: float, lon: float) -> tuple[float, float]:
    """火星加密：WGS-84 → GCJ-02"""
    if _out_of_china(lat, lon):
        return lat, lon
    d_lat, d_lon = _delta(lat, lon)
    return lat + d_lat, lon + d_lon


# ── 坐标字段（可能包含 GPS 的消息字段） ────────────────────────────────────────
GPS_FIELDS = ("position_lat", "position_long")


def _convert_mesg(mesg: dict, method: str) -> dict:
    """若消息含 GPS 坐标则转换，否则原样返回。"""
    lat_s = mesg.get("position_lat")
    lon_s = mesg.get("position_long")
    if lat_s is None or lon_s is None:
        return mesg

    lat = lat_s * SEMI_TO_DEG
    lon = lon_s * SEMI_TO_DEG

    if method == "decrypt":
        new_lat, new_lon = gcj02_to_wgs84(lat, lon)
    else:
        new_lat, new_lon = wgs84_to_gcj02(lat, lon)

    result = dict(mesg)
    result["position_lat"]  = round(new_lat * DEG_TO_SEMI)
    result["position_long"] = round(new_lon * DEG_TO_SEMI)
    return result


# ── FIT 读写 ──────────────────────────────────────────────────────────────────
def _decode(path: Path) -> dict:
    stream = Stream.from_file(str(path))
    dec = Decoder(stream)
    msgs, errors = dec.read(apply_scale_and_offset=True, expand_sub_fields=True)
    if errors:
        for e in errors:
            print(f"  [Warning] {e}", file=sys.stderr)
    return msgs


def _encode(msgs: dict) -> bytes:
    enc = Encoder()
    for key, num in MESG_NUM.items():
        for mesg in msgs.get(key, []):
            m = dict(mesg)
            m["mesg_num"] = num
            enc.write_mesg(m)
    return enc.close()


def _count_gps(msgs: dict) -> int:
    return sum(
        1 for r in msgs.get("record_mesgs", [])
        if r.get("position_lat") is not None
    )


# ── 核心处理 ──────────────────────────────────────────────────────────────────
def fix_file(src: Path, dst: Path, method: str) -> int:
    """处理单个文件，返回修改的 GPS 坐标点数。"""
    msgs = _decode(src)
    n_gps = _count_gps(msgs)
    if n_gps == 0:
        return 0

    # 转换所有含坐标的消息类型
    for key in list(msgs.keys()):
        msgs[key] = [_convert_mesg(m, method) for m in msgs[key]]

    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(_encode(msgs))
    return n_gps


def fix_dir(
    input_dir: Path,
    output_dir: Path,
    method: str,
    dry_run: bool = False,
) -> None:
    files = sorted(input_dir.glob("*.fit"))
    if not files:
        print(f"在 {input_dir} 中未找到 .fit 文件", file=sys.stderr)
        return

    label = "火星解密（GCJ-02 → WGS-84）" if method == "decrypt" else "火星加密（WGS-84 → GCJ-02）"
    print(f"方法：{label}", file=sys.stderr)
    print(f"输入：{input_dir}  输出：{output_dir}", file=sys.stderr)
    if dry_run:
        print("=== DRY RUN，不写入文件 ===", file=sys.stderr)
    print(file=sys.stderr)

    done, skipped = 0, 0
    for src in files:
        dst = output_dir / src.name
        msgs = _decode(src)
        n = _count_gps(msgs)
        if n == 0:
            print(f"  [跳过] {src.name}：无 GPS 数据", file=sys.stderr)
            skipped += 1
            continue

        print(f"  {src.name}  ({n} 个坐标点)", file=sys.stderr)
        if not dry_run:
            for key in list(msgs.keys()):
                msgs[key] = [_convert_mesg(m, method) for m in msgs[key]]
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_bytes(_encode(msgs))
        done += 1

    print(file=sys.stderr)
    print(f"完成：{done} 个文件已处理，{skipped} 个跳过", file=sys.stderr)
    if not dry_run:
        print(f"输出目录：{output_dir}", file=sys.stderr)


# ── CLI ───────────────────────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(
        description="对 FIT 文件的 GPS 坐标进行火星坐标系转换",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="示例:\n"
               "  %(prog)s --method decrypt\n"
               "  %(prog)s --method encrypt input/ -o output/fixed/\n"
               "  %(prog)s --method decrypt --dry-run",
    )
    parser.add_argument(
        "input_dir", nargs="?", default="input",
        help="FIT 文件目录（默认: input）",
    )
    parser.add_argument(
        "--method", "-m",
        choices=["decrypt", "encrypt"],
        required=True,
        help="decrypt = 火星解密 GCJ-02→WGS-84；encrypt = 火星加密 WGS-84→GCJ-02",
    )
    parser.add_argument(
        "-o", "--output",
        help="输出目录（默认: <input_dir>/<method>/）",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="只打印将要处理的文件，不写入",
    )
    args = parser.parse_args()

    input_dir  = Path(args.input_dir)
    output_dir = Path(args.output) if args.output else input_dir / args.method

    if not input_dir.is_dir():
        print(f"错误：找不到目录 {input_dir}", file=sys.stderr)
        sys.exit(1)

    fix_dir(input_dir, output_dir, args.method, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
