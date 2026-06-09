#!/usr/bin/env python3
"""Admin CLI for FAFA user management.

Usage:
    python -m fafa.tools.manage_users add <username>
    python -m fafa.tools.manage_users list
    python -m fafa.tools.manage_users passwd <username>
    python -m fafa.tools.manage_users delete <username>
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


_CMDS_WITH_ARG = {'add': cmd_add, 'passwd': cmd_passwd, 'delete': cmd_delete}

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
