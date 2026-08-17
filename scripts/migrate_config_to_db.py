#!/usr/bin/env python3
"""Migrate legacy per-user config.json files into users.db.

Usage:
    FAFA_SECRET=<secret> venv/bin/python scripts/migrate_config_to_db.py --dry-run
    FAFA_SECRET=<secret> venv/bin/python scripts/migrate_config_to_db.py
    FAFA_SECRET=<secret> venv/bin/python scripts/migrate_config_to_db.py --username alice
    FAFA_SECRET=<secret> venv/bin/python scripts/migrate_config_to_db.py \
        --username alice --config /path/to/config.json
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fafa import auth

INPUT_ROOT = ROOT / 'input'


def _read_legacy_config(path: Path) -> dict:
    if path.is_symlink():
        raise ValueError('拒绝迁移符号链接配置文件')
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError) as exc:
        raise ValueError(f'无法读取有效 JSON: {exc}') from exc
    if not isinstance(data, dict):
        raise ValueError('配置根节点必须是 JSON 对象')
    data.pop('_comment', None)
    data.pop('_comments', None)
    if not data:
        raise ValueError('配置文件没有可迁移字段')
    return data


def _selected_users(usernames: list[str] | None) -> list[dict]:
    try:
        with sqlite3.connect(f'file:{auth.USERS_DB}?mode=ro', uri=True) as conn:
            users = [
                {'id': row[0], 'username': row[1]}
                for row in conn.execute('SELECT id, username FROM users ORDER BY id')
            ]
    except sqlite3.Error as exc:
        raise ValueError(f'无法读取用户数据库: {exc}') from exc
    if not usernames:
        return users
    wanted = {name.casefold() for name in usernames}
    selected = [u for u in users if u['username'].casefold() in wanted]
    found = {u['username'].casefold() for u in selected}
    missing = sorted(wanted - found)
    if missing:
        raise ValueError(f'用户不存在: {", ".join(missing)}')
    return selected


def _existing_config_count(user_id: int) -> int:
    try:
        with sqlite3.connect(f'file:{auth.USERS_DB}?mode=ro', uri=True) as conn:
            exists = conn.execute(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'user_config'"
            ).fetchone()
            if not exists:
                return 0
            return int(conn.execute(
                'SELECT COUNT(*) FROM user_config WHERE user_id = ?', (user_id,)
            ).fetchone()[0])
    except sqlite3.Error as exc:
        raise ValueError(f'无法读取现有配置: {exc}') from exc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description='将旧版 input/<username>/config.json 批量迁移到 users.db',
    )
    parser.add_argument(
        '--username', action='append', metavar='USER',
        help='只迁移指定用户；可重复传入。默认扫描全部用户',
    )
    parser.add_argument(
        '--config', type=Path, metavar='PATH',
        help='指定一个 config.json 路径；必须同时且只指定一个 --username',
    )
    parser.add_argument('--dry-run', action='store_true', help='仅检查，不写数据库或归档文件')
    args = parser.parse_args(argv)

    if not os.environ.get('FAFA_SECRET'):
        parser.error('必须设置与服务器相同的 FAFA_SECRET，避免用错误密钥加密凭证')
    if args.config and (not args.username or len(args.username) != 1):
        parser.error('--config 必须配合且只配合一个 --username 使用')
    if not auth.USERS_DB.is_file():
        parser.error(f'用户数据库不存在: {auth.USERS_DB}')

    auth.set_server_mode(True)
    if not args.dry_run:
        auth.init_db()
    try:
        users = _selected_users(args.username)
    except ValueError as exc:
        parser.error(str(exc))

    migrated = 0
    skipped = 0
    failed = 0
    for user in users:
        path = args.config if args.config else INPUT_ROOT / user['username'] / 'config.json'
        if not path.is_file():
            print(f'[SKIP] {user["username"]}: 未找到 {path}')
            skipped += 1
            continue
        try:
            data = _read_legacy_config(path)
        except ValueError as exc:
            print(f'[FAIL] {user["username"]}: {exc}', file=sys.stderr)
            failed += 1
            continue

        try:
            existing_count = _existing_config_count(user['id'])
        except ValueError as exc:
            print(f'[FAIL] {user["username"]}: {exc}', file=sys.stderr)
            failed += 1
            continue
        if existing_count:
            print(
                f'[FAIL] {user["username"]}: 数据库已有 {existing_count} 个配置项，'
                '为避免覆盖而拒绝迁移',
                file=sys.stderr,
            )
            failed += 1
            continue
        if args.dry_run:
            print(f'[DRY-RUN] {user["username"]}: 可迁移 {len(data)} 个配置项 <- {path}')
            migrated += 1
            continue

        try:
            auth.set_user_config_values(user['id'], data)
            backup = auth.archive_config_file(path)
        except Exception as exc:
            print(f'[FAIL] {user["username"]}: {exc}', file=sys.stderr)
            failed += 1
            continue
        print(
            f'[OK] {user["username"]}: 已迁移 {len(data)} 个配置项，'
            f'原文件归档为 {backup.name}'
        )
        migrated += 1

    label = '可迁移' if args.dry_run else '已迁移'
    print(f'完成：{label} {migrated}，跳过 {skipped}，失败 {failed}')
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
