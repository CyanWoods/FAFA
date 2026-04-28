#!/usr/bin/env python3
"""Rename Magene C506 FIT files to Magene_C506_YYYYMMDD-HHMMSS_{device_id}.fit

Source pattern: [Mm]AGENE_C506_{start_unix}_{device_id}_{end_unix[_millis]}.fit
Target pattern: Magene_C506_{YYYYMMDD-HHMMSS}_{device_id}.fit
Timestamps converted to CST (UTC+8).
"""

import os
import re
import sys
from datetime import datetime, timezone, timedelta

INPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "input")
CST = timezone(timedelta(hours=8))

PATTERN = re.compile(r'^MAGENE_C506_(\d+)_(\d+)_\d+\.fit$', re.IGNORECASE)


def rename_files(dry_run: bool = False) -> None:
    entries = sorted(os.listdir(INPUT_DIR))
    renamed = 0
    skipped = 0
    conflicts = 0

    for filename in entries:
        if not filename.lower().endswith(".fit"):
            continue

        m = PATTERN.match(filename)
        if not m:
            print(f"  SKIP  {filename}")
            skipped += 1
            continue

        start_ts = int(m.group(1))
        device_id = m.group(2)

        dt = datetime.fromtimestamp(start_ts, tz=CST)
        new_name = f"Magene_C506_{dt.strftime('%Y%m%d-%H%M%S')}_{device_id}.fit"

        if filename == new_name:
            skipped += 1
            continue

        old_path = os.path.join(INPUT_DIR, filename)
        new_path = os.path.join(INPUT_DIR, new_name)

        if os.path.exists(new_path):
            print(f"  CONFLICT  {filename} -> {new_name}")
            conflicts += 1
            continue

        print(f"  {'[dry]' if dry_run else '     '}  {filename}  ->  {new_name}")
        if not dry_run:
            os.rename(old_path, new_path)
        renamed += 1

    print(f"\n{'[dry run] ' if dry_run else ''}renamed={renamed}  skipped={skipped}  conflicts={conflicts}")


if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv
    if dry_run:
        print("=== DRY RUN (no files changed) ===\n")
    rename_files(dry_run)
