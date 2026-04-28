#!/usr/bin/env python3
"""从顽鹿（OneLap）批量下载 FIT 文件到 input/ 目录。

用法：
  .venv/bin/python download_fit.py                # 增量下载
  .venv/bin/python download_fit.py --all          # 全量（忽略本地状态）
  .venv/bin/python download_fit.py --dry-run      # 预览，不下载
  .venv/bin/python download_fit.py --limit 20    # 最多下载 20 个
"""

import argparse
import json
import logging
import sys
import time
from pathlib import Path

from fafa.onelap import (
    browser_login,
    build_session,
    fetch_activity_list,
    download_activity,
    latest_local_time,
    parse_activity_time,
    activity_id,
)

PROJECT_ROOT = Path(__file__).parent
INPUT_DIR    = PROJECT_ROOT / "input"
STATE_FILE   = PROJECT_ROOT / "download_state.json"

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s", datefmt="%H:%M:%S")
log = logging.getLogger("download_fit")


def _load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="从顽鹿批量下载 FIT 文件",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "示例:\n"
            "  %(prog)s                # 增量下载新活动\n"
            "  %(prog)s --all          # 全量下载\n"
            "  %(prog)s --dry-run      # 预览，不下载\n"
            "  %(prog)s --limit 10     # 最多下载 10 个\n"
        ),
    )
    parser.add_argument("--all",      action="store_true", help="全量下载，忽略本地状态")
    parser.add_argument("--dry-run",  action="store_true", help="预览模式，只列出待下载活动")
    parser.add_argument("--limit",    type=int, default=None, metavar="N")
    args = parser.parse_args()

    state    = {} if args.all else _load_state()
    skip_ids = set(state.keys())
    cutoff   = None if args.all else latest_local_time(INPUT_DIR)

    if cutoff:
        log.info(f"本地最新文件时间: {cutoff.strftime('%Y-%m-%d %H:%M:%S')}")

    try:
        auth = browser_login()
    except Exception as e:
        print(f"登录失败: {e}")
        sys.exit(1)

    sess = build_session(auth["token"], auth["cookies"])

    log.info("正在获取活动列表...")
    activities = fetch_activity_list(
        sess, skip_ids, cutoff, args.limit,
        on_page=lambda pg, col, tot: log.info(f"  第 {pg} 页 | 已收集 {col} 条"),
    )

    if not activities:
        print("\n没有新活动需要下载。")
        return

    print(f"\n共 {len(activities)} 个活动待下载：")
    for i, act in enumerate(activities, 1):
        t = parse_activity_time(act)
        tstr = t.strftime("%Y-%m-%d %H:%M") if t else "未知时间"
        dist = float(act.get("distance") or act.get("total_distance") or 0)
        print(f"  {i:3d}.  {tstr}  {dist/1000:.1f} km")

    if args.dry_run:
        print("\n[预览模式] 未下载任何文件。")
        return

    print()
    ok = fail = 0
    for i, act in enumerate(activities, 1):
        t    = parse_activity_time(act)
        tstr = t.strftime("%Y-%m-%d %H:%M") if t else activity_id(act)
        log.info(f"[{i}/{len(activities)}] {tstr}")
        try:
            path = download_activity(sess, act, state, INPUT_DIR)
            if path:
                _save_state(state)
                log.info(f"  ✓  {path.name}")
                ok += 1
            else:
                fail += 1
        except Exception as e:
            log.error(f"  ✗  失败: {e}")
            fail += 1
        time.sleep(0.3)

    print(f"\n完成：成功 {ok} 个，失败 {fail} 个")
    if ok:
        print(f"文件已保存至: {INPUT_DIR}")


if __name__ == "__main__":
    main()
