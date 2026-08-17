#!/usr/bin/env python3
"""Admin CLI for FAFA user management.

Usage:
    python -m fafa.tools.manage_users add <username>
    python -m fafa.tools.manage_users list
    python -m fafa.tools.manage_users passwd <username>
    python -m fafa.tools.manage_users delete <username>
    python -m fafa.tools.manage_users promote <username>
    python -m fafa.tools.manage_users migrate-config <username>
"""
import getpass
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))
from fafa import auth


def cmd_add(username: str) -> None:
    pw  = getpass.getpass(f'Password for {username}: ')
    pw2 = getpass.getpass('Confirm password: ')
    if pw != pw2:
        print('Passwords do not match.', file=sys.stderr)
        sys.exit(1)
    auth.init_db()
    try:
        auth.create_user(username, pw)
        print(f'User "{username}" created.')
    except Exception as e:
        print(f'Error: {e}', file=sys.stderr)
        sys.exit(1)


def cmd_list() -> None:
    auth.init_db()
    users = auth.list_users()
    if not users:
        print('No users registered.')
        return
    for u in users:
        print(f"  {u['id']:4d}  {u['username']:<24}  {u['created_at']}")


def cmd_passwd(username: str) -> None:
    pw  = getpass.getpass(f'New password for {username}: ')
    pw2 = getpass.getpass('Confirm password: ')
    if pw != pw2:
        print('Passwords do not match.', file=sys.stderr)
        sys.exit(1)
    auth.init_db()
    if not auth.change_password(username, pw):
        print(f'User "{username}" not found.', file=sys.stderr)
        sys.exit(1)
    print(f'Password updated for "{username}".')


def cmd_delete(username: str) -> None:
    confirm = input(f'Delete user "{username}"? Their data files remain on disk. [y/N] ')
    if confirm.lower() != 'y':
        print('Aborted.')
        return
    auth.init_db()
    if not auth.delete_user(username):
        print(f'User "{username}" not found.', file=sys.stderr)
        sys.exit(1)
    print(f'User "{username}" deleted.')


def _find_user_id(username: str) -> int | None:
    for u in auth.list_users():
        if u['username'].lower() == username.lower():
            return u['id']
    return None


def cmd_promote(username: str) -> None:
    """把某用户设为管理员——升级后第一个管理员必须走这里（web 端的升降级
    需要一个已存在的管理员才能操作，谁也没有时只能靠 CLI 破局）。"""
    auth.init_db()
    was_empty = auth.admin_count() == 0
    uid = _find_user_id(username)
    if uid is None:
        print(f'User "{username}" not found.', file=sys.stderr)
        sys.exit(1)
    auth.set_admin(uid, True)
    print(f'User "{username}" is now an admin.')
    if was_empty:
        print('(this was the first admin on this instance)')


def cmd_migrate_config(username: str) -> None:
    """手动触发把旧 config.json 搬进 user_config 表（加密）；平时懒迁移会在
    用户首次登录时自动做，这条命令给想主动触发的场景用（比如升级部署脚本
    里想提前把所有用户都迁完，不等各自登录）。"""
    auth.init_db()
    uid = _find_user_id(username)
    if uid is None:
        print(f'User "{username}" not found.', file=sys.stderr)
        sys.exit(1)
    if auth.get_user_config(uid):
        print(f'User "{username}" already has config in the database, nothing to migrate.')
        return
    project_root = auth.USERS_DB.parent
    cfg_path = project_root / 'input' / username / 'config.json'
    if not cfg_path.exists():
        print(f'No config.json found at {cfg_path}, nothing to migrate.')
        return
    if auth.migrate_config_from_file(uid, cfg_path):
        backup_path = auth.archive_config_file(cfg_path)
        print(f'Migrated config for "{username}" into the database; '
              f'{cfg_path.name} archived as {backup_path.name}.')
    else:
        print(f'{cfg_path.name} was empty or unreadable, nothing migrated.', file=sys.stderr)
        sys.exit(1)


_CMDS_WITH_ARG = {
    'add': cmd_add, 'passwd': cmd_passwd, 'delete': cmd_delete,
    'promote': cmd_promote, 'migrate-config': cmd_migrate_config,
}

if __name__ == '__main__':
    if len(sys.argv) < 2 or sys.argv[1] in ('-h', '--help'):
        print(__doc__)
        sys.exit(0)
    cmd = sys.argv[1]
    if cmd == 'list':
        cmd_list()
    elif cmd in _CMDS_WITH_ARG:
        if len(sys.argv) < 3:
            print(f'Usage: python -m fafa.tools.manage_users {cmd} <username>')
            sys.exit(1)
        _CMDS_WITH_ARG[cmd](sys.argv[2])
    else:
        print(f'Unknown command: {cmd}', file=sys.stderr)
        sys.exit(1)
