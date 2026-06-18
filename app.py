#!/usr/bin/env python3
"""FAFA Track Viewer — Flask 开发服务器

启动:
    .venv/bin/python app.py
然后访问 http://localhost:5173
"""

import bisect
from collections import OrderedDict
import fcntl
import ipaddress
import json
import logging
import math
import multiprocessing
import os
import re
import secrets
import sys
import tempfile
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import urlparse

from html import escape as _html_escape

from flask import Flask, render_template, request, jsonify, send_file, session, g, redirect, url_for
from werkzeug.middleware.proxy_fix import ProxyFix

from fafa.parser import parse_fit, decode_lr_balance
from fafa.gcj02 import needs_wgs84_conversion
from fafa.stats import compute_km_stats, compute_dist_stats, compute_time_stats, compute_summary
import fafa.strava as _strava
import fafa.db as _db
import fafa.auth as _auth

SERVER_MODE = "--server" in sys.argv or os.environ.get("FAFA_SERVER") == "1"
_auth.set_server_mode(SERVER_MODE)

app = Flask(__name__)
_PROXY_HOPS = max(0, int(os.environ.get('FAFA_PROXY_HOPS', '0')))
if _PROXY_HOPS:
    app.wsgi_app = ProxyFix(
        app.wsgi_app,
        x_for=_PROXY_HOPS,
        x_proto=_PROXY_HOPS,
        x_host=_PROXY_HOPS,
    )
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # FIT/JSON request hard limit
app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0
_fafa_secret = os.environ.get('FAFA_SECRET')
if SERVER_MODE and not _fafa_secret:
    sys.exit('FATAL: FAFA_SECRET 环境变量未设置。服务模式必须配置强随机密钥，拒绝启动。')
app.secret_key = _fafa_secret or 'dev-secret-local-only'

app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
if SERVER_MODE:
    app.config['SESSION_COOKIE_SECURE'] = True
    app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=12)


def _bind_host() -> str:
    """Keep unauthenticated local mode on loopback unless explicitly overridden."""
    host = os.environ.get('FAFA_HOST') or ('0.0.0.0' if SERVER_MODE else '127.0.0.1')
    if SERVER_MODE or os.environ.get('FAFA_ALLOW_INSECURE_REMOTE') == '1':
        return host
    try:
        is_loopback = host.lower() == 'localhost' or ipaddress.ip_address(host).is_loopback
    except ValueError:
        is_loopback = False
    if not is_loopback:
        raise RuntimeError(
            '本地模式未启用登录验证，只允许监听回环地址。'
            '如确需暴露到局域网，请使用 --server；'
            '或显式设置 FAFA_ALLOW_INSECURE_REMOTE=1 承担风险。'
        )
    return host


@app.after_request
def _security_headers(resp):
    resp.headers['X-Content-Type-Options'] = 'nosniff'
    resp.headers['X-Frame-Options'] = 'SAMEORIGIN'
    resp.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    resp.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
    script_policy = "script-src 'self' 'unsafe-inline'" if request.path == '/strava/callback' else "script-src 'self'; script-src-attr 'unsafe-inline'"
    resp.headers['Content-Security-Policy'] = (
        f"default-src 'self'; {script_policy}; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob: https:; connect-src 'self' https:; "
        "font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
    )
    if SERVER_MODE:
        resp.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    if request.path.startswith('/api/') or request.path in ('/login', '/strava/callback'):
        resp.headers['Cache-Control'] = 'no-store'
    return resp


@app.before_request
def _check_same_origin():
    if not SERVER_MODE or request.method in ('GET', 'HEAD', 'OPTIONS'):
        return None
    origin = request.headers.get('Origin')
    referer = request.headers.get('Referer')
    source = origin or referer
    if source:
        parsed = urlparse(source)
        if parsed.netloc != request.host:
            return jsonify(error='cross-origin request rejected'), 403
    elif request.headers.get('Sec-Fetch-Site') != 'same-origin':
        return jsonify(error='cross-origin request rejected'), 403
    return None

PROJECT_ROOT      = Path(__file__).parent
_version_file     = PROJECT_ROOT / "version"
FAFA_VERSION      = _version_file.read_text().strip() if _version_file.exists() else "unknown"
SEMICIRCLE_TO_DEG = 180.0 / (2 ** 31)
_SECRET_MASK      = '••••••••'
_MAX_NOTE_CHARS   = 20_000
_MAX_TAG_NAME     = 64
_MAX_BATCH_FILES  = 1_000
_MAX_EXPORT_FILES = 10_000
_MAX_TAG_IDS      = 100
_MAX_AI_MESSAGES  = 100
_MAX_AI_TEXT      = 200_000
_MAX_LOGIN_PASSWORD_CHARS = 1024
_MAX_AI_RESPONSE_BYTES = 4 * 1024 * 1024
_MAX_AI_STREAM_SECONDS = 5 * 60
_MAX_AI_SSE_LINE_BYTES = 256 * 1024
_MAX_SYNC_ACTIVITIES = 2_000
_MAX_SYNC_FILE_BYTES = 32 * 1024 * 1024
_USER_STORAGE_MAX_BYTES = max(32 * 1024 * 1024, int(os.environ.get('FAFA_USER_STORAGE_MB', '10240')) * 1024 * 1024)
_TASK_STALE_S     = 15 * 60
_PARSE_TIMEOUT_S  = 30
_PARSE_SLOTS      = max(1, int(os.environ.get('FAFA_PARSE_SLOTS', '4')))
_AI_SLOTS         = max(1, int(os.environ.get('FAFA_AI_SLOTS', '8')))
_SYNC_SLOTS       = max(1, int(os.environ.get('FAFA_SYNC_SLOTS', '2')))
_RUNTIME_LOCK_DIR = PROJECT_ROOT / '.runtime_locks'


def _atomic_write_json(path: Path, data: dict, mode: int = 0o600) -> None:
    """Write JSON atomically with private permissions."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f'.{path.name}.', suffix='.tmp', dir=path.parent)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        Path(tmp_name).replace(path)
        os.chmod(path, mode)
    except Exception:
        try:
            os.close(fd)
        except OSError:
            pass
        Path(tmp_name).unlink(missing_ok=True)
        raise


def _locked_file(path: Path):
    """Return an exclusively locked sidecar file handle. Caller closes it."""
    lock_path = path.with_name(path.name + '.lock')
    fh = open(lock_path, 'a+')
    os.chmod(lock_path, 0o600)
    fcntl.flock(fh, fcntl.LOCK_EX)
    return fh


def _try_acquire_slot(kind: str, count: int):
    """Acquire one process-wide slot using flock; caller closes the handle."""
    _RUNTIME_LOCK_DIR.mkdir(mode=0o700, exist_ok=True)
    for index in range(count):
        path = _RUNTIME_LOCK_DIR / f'{kind}.{index}.lock'
        fh = open(path, 'a+')
        os.chmod(path, 0o600)
        try:
            fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return fh
        except (IOError, OSError):
            fh.close()
    return None


def _validate_filename_in_input(filename: str, input_dir: Path) -> Path | None:
    if not isinstance(filename, str) or not filename.lower().endswith('.fit'):
        return None
    candidate = input_dir / filename
    if candidate.is_symlink():
        return None
    path = candidate.resolve()
    return path if path.parent == input_dir.resolve() else None


def _library_fit_paths(input_dir: Path) -> list[Path]:
    """Return regular FIT files physically contained in the library directory."""
    root = input_dir.resolve()
    paths = []
    for candidate in sorted(input_dir.glob('*.fit')):
        try:
            if candidate.is_symlink() or not candidate.is_file():
                continue
            path = candidate.resolve()
            if path.parent == root:
                paths.append(path)
        except OSError:
            continue
    return paths


def _validate_string_list(value, *, max_items: int, field: str):
    if not isinstance(value, list) or len(value) > max_items or not all(isinstance(x, str) for x in value):
        raise ValueError(f'{field} must be a string list with at most {max_items} items')
    return value


def _json_bool(data: dict, field: str, default: bool = False) -> bool:
    value = data.get(field, default)
    if not isinstance(value, bool):
        raise ValueError(f'{field} 必须是布尔值')
    return value


def _input_storage_bytes(input_dir: Path) -> int:
    total = 0
    for path in _library_fit_paths(input_dir):
        try:
            total += path.stat().st_size
        except OSError:
            pass
    return total


def _cache_size_estimate(data: dict) -> int:
    size = 4096
    size += len(data.get('coords') or []) * 48
    size += len(data.get('km_stats') or []) * 512
    size += len(data.get('dist_stats') or []) * 512
    size += len(data.get('time_stats') or []) * 512
    return size


def _reject_large_json(data, limit: int = _MAX_AI_TEXT):
    try:
        if len(json.dumps(data, ensure_ascii=False)) > limit:
            return jsonify(error='request payload too large'), 413
    except (TypeError, ValueError):
        return jsonify(error='invalid JSON payload'), 400
    return None

if SERVER_MODE:
    _auth.init_db()
else:
    _local_input = PROJECT_ROOT / 'input'
    _local_input.mkdir(parents=True, exist_ok=True)
    _db.init_db(_local_input)

# ── Per-request user helpers ───────────────────────────────────────────────────

def _user_input_dir() -> Path:
    d = (PROJECT_ROOT / 'input') if not SERVER_MODE else (PROJECT_ROOT / 'input' / g.username)
    d.mkdir(parents=True, exist_ok=True)
    if SERVER_MODE:
        try:
            os.chmod(d, 0o700)
        except OSError:
            pass
    return d


def _user_config_file() -> Path:
    path = _user_input_dir() / 'config.json'
    if path.exists():
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass
    return path


def _user_db_path() -> Path:
    return _user_input_dir() / 'fafa.db'


@app.before_request
def _load_user():
    if not SERVER_MODE:
        g.user_id  = 0
        g.username = "local"
        return
    user_id = session.get('user_id')
    if user_id:
        user = _auth.get_user_by_id(user_id)
        if user:
            g.user_id  = user['id']
            g.username = user['username']
            udir = PROJECT_ROOT / 'input' / g.username
            udir.mkdir(parents=True, exist_ok=True)
            udir_str = str(udir)
            with _db_init_lock:
                if udir_str not in _db_init_done:
                    _db.init_db(udir)
                    _db_init_done.add(udir_str)
        else:
            session.clear()


# ── Auth routes ────────────────────────────────────────────────────────────────

_LOGIN_MAX_FAILS = 5
_LOGIN_LOCKOUT_S = 30


def _check_login_rate(ip: str) -> bool:
    return _auth.login_allowed(ip) if SERVER_MODE else True


def _record_login_fail(rate_key: str, max_fails: int = _LOGIN_MAX_FAILS) -> None:
    if SERVER_MODE:
        _auth.record_login_failure(rate_key, max_fails, _LOGIN_LOCKOUT_S)


def _reset_login_fail(ip: str) -> None:
    if SERVER_MODE:
        _auth.clear_login_failures(ip)


@app.route('/login', methods=['GET', 'POST'])
def login_page():
    if 'user_id' in session:
        return redirect(url_for('index'))
    error = None
    if request.method == 'POST':
        username = (request.form.get('username') or '').strip()
        valid_username = bool(re.fullmatch(r'[A-Za-z0-9_-]{1,32}', username))
        user_rk = f'u:{username.lower()}' if valid_username else None
        ip_rk = f'ip:{request.remote_addr or "0.0.0.0"}'
        rate_keys = [key for key in (user_rk, ip_rk) if key]
        if not all(_check_login_rate(key) for key in rate_keys):
            error = '登录尝试过于频繁，请稍后再试'
        else:
            password = request.form.get('password') or ''
            valid_password = len(password) <= _MAX_LOGIN_PASSWORD_CHARS
            user = _auth.verify_user(username, password) if valid_username and valid_password else None
            if user:
                if user_rk:
                    _reset_login_fail(user_rk)
                session.clear()          # prevent session fixation
                session.permanent = True
                session['user_id']  = user['id']
                session['username'] = user['username']
                return redirect(url_for('index'))
            if user_rk:
                _record_login_fail(user_rk)
            _record_login_fail(ip_rk, max_fails=50)
            error = '用户名或密码错误'
    return render_template('login.html', error=error)


@app.route('/logout', methods=['POST'])
@_auth.login_required
def logout():
    session.clear()
    return redirect(url_for('login_page'))


# ── 解析结果缓存（按文件路径+完整文件签名） ────────────────────────────────────
_parse_cache: OrderedDict[str, dict] = OrderedDict()
_cache_lock  = threading.Lock()
_cache_bytes = 0
_CACHE_MAX_BYTES = 256 * 1024 * 1024
_weather_cache: dict = {}       # key → (result, expire_epoch)
_weather_lock = threading.Lock()
_WEATHER_TTL_S = 3600
_WEATHER_MAX   = 500
_db_init_done: set[str] = set()  # 已初始化的 input_dir 路径（进程级缓存）
_db_init_lock = threading.Lock()

# ── 逐秒记录缓存（details 视图用） ─────────────────────────────────────────────
_records_cache: dict[str, dict] = {}  # path_str -> {'sig': str, 'records': list}
_records_cache_lock = threading.Lock()
_records_cache_bytes = 0
_RECORDS_CACHE_MAX_BYTES = 128 * 1024 * 1024
_activity_executor = ThreadPoolExecutor(max_workers=4)

# ── 解析进度状态（按 input_dir 字符串键） ────────────────────────────────────
_parse_states: dict[str, dict] = {}   # key = str(input_dir)
_parse_state_lock = threading.Lock()


def _file_signature(path: Path) -> str:
    stat = path.stat()
    return f'{stat.st_mtime_ns}:{stat.st_ctime_ns}:{stat.st_size}'


def _cache_get(path_str: str, signature) -> dict | None:
    with _cache_lock:
        entry = _parse_cache.get(path_str)
        if entry and entry["sig"] == signature:
            _parse_cache.move_to_end(path_str)
            return entry["data"]
    return None


def _disk_cache_load(path_str: str, signature) -> dict | None:
    cache_dir = Path(path_str).parent / '.cache'
    cache_file = cache_dir / (Path(path_str).name + ".json")
    try:
        with cache_file.open(encoding="utf-8") as f:
            entry = json.load(f)
        if entry.get("sig") == signature:
            return entry["data"]
    except Exception:
        pass
    return None


def _disk_cache_save(path_str: str, signature, data: dict) -> None:
    try:
        cache_dir = Path(path_str).parent / '.cache'
        cache_dir.mkdir(mode=0o700, exist_ok=True)
        os.chmod(cache_dir, 0o700)
        cache_file = cache_dir / (Path(path_str).name + ".json")
        _atomic_write_json(cache_file, {"sig": signature, "data": data})
    except Exception as e:
        logging.warning("disk cache write failed (%s): %s", Path(path_str).name, e)


def _cache_put(path_str: str, signature, data: dict) -> None:
    global _cache_bytes
    size = _cache_size_estimate(data)
    with _cache_lock:
        previous = _parse_cache.pop(path_str, None)
        if previous:
            _cache_bytes -= previous.get('size', 0)
        while _parse_cache and _cache_bytes + size > _CACHE_MAX_BYTES:
            _, evicted = _parse_cache.popitem(last=False)
            _cache_bytes -= evicted.get('size', 0)
        if size <= _CACHE_MAX_BYTES:
            _parse_cache[path_str] = {"sig": signature, "data": data, "size": size}
            _cache_bytes += size


def _cache_remove(path_str: str) -> None:
    global _cache_bytes
    with _cache_lock:
        previous = _parse_cache.pop(path_str, None)
        if previous:
            _cache_bytes -= previous.get('size', 0)


def _records_cache_remove(path_str: str) -> None:
    global _records_cache_bytes
    with _records_cache_lock:
        previous = _records_cache.pop(path_str, None)
        if previous:
            _records_cache_bytes -= previous.get('size', 0)


def _parse_lock_file(path: Path):
    cache_dir = path.parent / '.cache'
    cache_dir.mkdir(mode=0o700, exist_ok=True)
    os.chmod(cache_dir, 0o700)
    lock_path = cache_dir / (path.name + '.parse.lock')
    fh = open(lock_path, 'a+')
    fcntl.flock(fh, fcntl.LOCK_EX)
    return fh, lock_path


def _remove_file_caches(path: Path, *, remove_lock: bool = True) -> None:
    path_str = str(path)
    _cache_remove(path_str)
    _records_cache_remove(path_str)
    cache_dir = path.parent / '.cache'
    suffixes = ('.json', '.parse.lock') if remove_lock else ('.json',)
    for suffix in suffixes:
        try:
            (cache_dir / (path.name + suffix)).unlink(missing_ok=True)
        except OSError:
            pass


def _delete_library_file(path: Path) -> None:
    lock_fh, _ = _parse_lock_file(path)
    try:
        path.unlink(missing_ok=True)
        _remove_file_caches(path, remove_lock=False)
    finally:
        lock_fh.close()


_PEAK_DURATIONS = (5, 60, 300, 1200, 3600)


_MAX_ACTIVITY_SECONDS = 24 * 3600  # 24h — 超出则为伪造数据
_MAX_RECORDS = 200_000


def _peak_powers(records) -> dict:
    """Max mean power (W) at key durations. Keys are strings like '5', '60', etc."""
    if not records or len(records) < 2:
        return {}
    if len(records) > _MAX_RECORDS:
        return {}
    total_s = int((records[-1].timestamp - records[0].timestamp).total_seconds())
    if total_s < 5 or total_s > _MAX_ACTIVITY_SECONDS:
        return {}
    t0 = records[0].timestamp
    ri = 0
    power_1s = []
    for sec in range(total_s + 1):
        while ri + 1 < len(records) and (records[ri + 1].timestamp - t0).total_seconds() <= sec:
            ri += 1
        p = records[ri].power
        power_1s.append(p if p is not None else 0)
    result = {}
    for dur in _PEAK_DURATIONS:
        if len(power_1s) < dur:
            continue
        window = sum(power_1s[:dur])
        best = window
        for i in range(dur, len(power_1s)):
            window += power_1s[i] - power_1s[i - dur]
            if window > best:
                best = window
        watts = round(best / dur)
        if watts > 0:
            result[str(dur)] = watts
    return result


def _zone_time_s(records, ftp) -> dict | None:
    """Seconds in each power zone: key 0=rest, 1-7=Z1-Z7 (Coggan 7-zone, matches heatmap thresholds)."""
    if not ftp or ftp <= 0 or not records or len(records) < 2:
        return None
    if len(records) > _MAX_RECORDS:
        return None
    total_s = int((records[-1].timestamp - records[0].timestamp).total_seconds())
    if total_s > _MAX_ACTIVITY_SECONDS:
        return None
    t0 = records[0].timestamp
    ri = 0
    zones = [0] * 8  # index 0=rest, 1-7=Z1-Z7
    for sec in range(total_s + 1):
        while ri + 1 < len(records) and (records[ri + 1].timestamp - t0).total_seconds() <= sec:
            ri += 1
        p = records[ri].power
        if not p or p <= 0:
            zones[0] += 1
            continue
        pct = p / ftp
        if pct < 0.55:   zones[1] += 1
        elif pct < 0.75: zones[2] += 1
        elif pct < 0.90: zones[3] += 1
        elif pct < 1.05: zones[4] += 1
        elif pct < 1.20: zones[5] += 1
        elif pct < 1.50: zones[6] += 1
        else:            zones[7] += 1
    if sum(zones[1:]) == 0:
        return None
    return {str(i): zones[i] for i in range(8)}


# ── 通用 FIT 解析 ──────────────────────────────────────────────────────────────
def _apply_worker_limits() -> None:
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_CPU, (20, 20))
        if sys.platform.startswith('linux'):
            resource.setrlimit(resource.RLIMIT_AS, (1024 * 1024 * 1024, 1024 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_FSIZE, (64 * 1024 * 1024, 64 * 1024 * 1024))
    except Exception:
        pass


def _parse_worker(conn, fit_path: str, filename: str, build: bool) -> None:
    _apply_worker_limits()
    try:
        value = _parse_and_build_direct(fit_path, filename) if build else parse_fit(fit_path)
        conn.send(('ok', value))
    except BaseException as e:
        conn.send(('error', f'{type(e).__name__}: {e}'))
    finally:
        conn.close()


def _run_parse_worker(fit_path: str, filename: str, *, build: bool):
    if not SERVER_MODE:
        return _parse_and_build_direct(fit_path, filename) if build else parse_fit(fit_path)
    slot_fh = _try_acquire_slot('parse', _PARSE_SLOTS)
    if slot_fh is None:
        raise ValueError('服务器解析任务繁忙，请稍后重试')
    ctx = multiprocessing.get_context('spawn')
    parent, child = ctx.Pipe(duplex=False)
    proc = ctx.Process(target=_parse_worker, args=(child, fit_path, filename, build), daemon=False)
    try:
        proc.start()
    except Exception:
        parent.close()
        child.close()
        slot_fh.close()
        raise
    child.close()
    try:
        if not parent.poll(_PARSE_TIMEOUT_S):
            proc.kill()
            proc.join(2)
            raise ValueError('FIT 解析超时')
        status, value = parent.recv()
        proc.join(2)
        if status != 'ok':
            raise ValueError(value)
        return value
    finally:
        parent.close()
        if proc.is_alive():
            proc.kill()
            proc.join(2)
        slot_fh.close()


def _parse_fit_safe(fit_path: str):
    return _run_parse_worker(fit_path, Path(fit_path).name, build=False)


def _parse_and_build(fit_path: str, filename: str) -> dict:
    p = Path(fit_path)
    if p.exists():
        try:
            signature = _file_signature(p)
            cached = _cache_get(fit_path, signature) or _disk_cache_load(fit_path, signature)
            if cached is not None:
                _cache_put(fit_path, signature, cached)
                return cached
        except OSError:
            pass
    lock_fh, _ = _parse_lock_file(p)
    with lock_fh:
        if p.exists():
            signature = _file_signature(p)
            cached = _cache_get(fit_path, signature) or _disk_cache_load(fit_path, signature)
            if cached is not None:
                _cache_put(fit_path, signature, cached)
                return cached
        result = _run_parse_worker(fit_path, filename, build=True)
        try:
            _cache_put(fit_path, _file_signature(p), result)
        except OSError:
            pass
        return result


def _parse_and_build_direct(fit_path: str, filename: str) -> dict:
    p = Path(fit_path)
    if p.exists():
        try:
            signature = _file_signature(p)
            # L1: memory cache
            cached = _cache_get(fit_path, signature)
            if cached is not None:
                return cached
            # L2: disk cache (survives restarts)
            cached = _disk_cache_load(fit_path, signature)
            if cached is not None:
                _cache_put(fit_path, signature, cached)
                return cached
        except OSError:
            pass

    fit      = parse_fit(fit_path)
    from fafa.stats import _check_fit_limits
    _check_fit_limits(fit)
    coords   = [
        [r.position_lat * SEMICIRCLE_TO_DEG, r.position_long * SEMICIRCLE_TO_DEG]
        for r in fit.records
        if r.position_lat is not None and r.position_long is not None
    ]
    if not coords:
        raise ValueError("该文件没有 GPS 数据")

    try:
        km_stats      = compute_km_stats(fit)
        summary       = compute_summary(fit, km_stats)
        summary_dict  = asdict(summary)
        km_stats_list = [asdict(s) for s in km_stats]
    except Exception as e:
        logging.warning("计算 km_stats 失败 (%s): %s", filename, e)
        summary_dict  = None
        km_stats_list = []

    try:
        dist_stats_list = [asdict(s) for s in compute_dist_stats(fit)]
    except Exception as e:
        logging.warning("计算 dist_stats 失败 (%s): %s", filename, e)
        dist_stats_list = []

    try:
        time_stats_list = [asdict(s) for s in compute_time_stats(fit)]
        if fit.records:
            ts_utc = fit.records[0].timestamp  # always UTC per FIT spec
            start_time_utc = ts_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
            if fit.utc_offset_s is not None:
                tz = timezone(timedelta(seconds=fit.utc_offset_s))
                ts_local = ts_utc.astimezone(tz)
            else:
                ts_local = ts_utc
            time_stats_start = ts_local.strftime("%Y-%m-%dT%H:%M:%S")
        else:
            time_stats_start = None
            start_time_utc   = None
    except Exception as e:
        logging.warning("计算 time_stats 失败 (%s): %s", filename, e)
        time_stats_list  = []
        time_stats_start = None
        start_time_utc   = None

    try:
        peak_power = _peak_powers(fit.records)
    except Exception:
        peak_power = {}

    try:
        zone_time = _zone_time_s(fit.records, fit.session.get("threshold_power"))
    except Exception:
        zone_time = None

    result = dict(
        coords=coords,
        filename=filename,
        is_gcj02=not needs_wgs84_conversion(fit.manufacturer),
        summary=summary_dict,
        km_stats=km_stats_list,
        dist_stats=dist_stats_list,
        time_stats=time_stats_list,
        time_stats_start=time_stats_start,
        start_time_utc=start_time_utc,
        peak_power=peak_power,
        zone_time_s=zone_time,
    )

    if p.exists():
        try:
            signature = _file_signature(p)
            _cache_put(fit_path, signature, result)
            _disk_cache_save(fit_path, signature, result)
        except OSError:
            pass

    return result


# ── 同步状态（文件化，支持多进程 Gunicorn） ────────────────────────────────────
_sync_lock = threading.Lock()  # 进程内线程锁（写文件前取锁防并发写）


def _default_sync_state() -> dict:
    return {'state': 'idle', 'message': '', 'total': 0, 'done': 0, 'new_files': []}


def _sync_state_path(input_dir: Path) -> Path:
    return input_dir / '.sync_state.json'


def _sync_lock_path(input_dir: Path) -> Path:
    return input_dir / '.sync.lock'


def _read_sync_state(input_dir: Path) -> dict:
    f = _sync_state_path(input_dir)
    try:
        if f.exists():
            return json.loads(f.read_text(encoding='utf-8'))
    except Exception:
        pass
    return _default_sync_state()


def _write_sync_state(input_dir: Path, state: dict) -> None:
    try:
        state['updated_at'] = int(time.time())
        _atomic_write_json(_sync_state_path(input_dir), state)
    except Exception as e:
        logging.warning('sync state write failed: %s', e)


def _set_sync(username: str, input_dir: Path | None = None, **kw) -> None:
    if input_dir is None:
        # 回退：仅记录日志（不应发生）
        logging.warning('_set_sync called without input_dir for %s', username)
        return
    with _sync_lock:
        state = _read_sync_state(input_dir)
        state.update(kw)
        _write_sync_state(input_dir, state)


def _try_acquire_sync_flock(input_dir: Path):
    """尝试获取进程级文件锁，成功返回文件句柄，已被占用返回 None。"""
    lock_path = _sync_lock_path(input_dir)
    try:
        fh = open(lock_path, 'w')
        fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return fh
    except (IOError, OSError):
        try:
            fh.close()
        except Exception:
            pass
        return None


_MAX_DL_WORKERS = 6


def _load_platform_credentials(prefix: str, config_file: Path) -> dict | None:
    """Load username/password for a sync platform from config.json.
    prefix is e.g. 'onelap' or 'igpsport'."""
    if not config_file.exists():
        return None
    try:
        with open(config_file, encoding="utf-8") as f:
            cfg = json.load(f)
        username = (cfg.get(f"{prefix}_username") or "").strip()
        password = (cfg.get(f"{prefix}_password") or "").strip()
        if username and password:
            return {"username": username, "password": password}
    except Exception:
        pass
    return None


def _run_sync(username: str, input_dir: Path, config_file: Path, full: bool, limit: int | None):
    """后台线程：登录顽鹿 → 拉取列表 → 并发下载 FIT。"""
    from fafa.onelap import (
        browser_login, api_login, build_session, fetch_activity_list,
        download_activity, rename_magene, parse_activity_time, activity_id,
    )
    from fafa.tools.fix_coords import auto_decrypt_if_gcj02

    state_file = input_dir / "download_state.json"

    def load_state():
        if state_file.exists():
            try:
                return json.loads(state_file.read_text(encoding="utf-8"))
            except Exception:
                pass
        return {}

    def save_state(st):
        _atomic_write_json(state_file, st)

    try:
        creds = _load_platform_credentials("onelap", config_file)
        if creds:
            _set_sync(username, input_dir=input_dir, state="login", message="正在自动登录顽鹿…", total=0, done=0, new_files=[])
            try:
                auth = api_login(creds["username"], creds["password"])
            except Exception as e:
                _set_sync(username, input_dir=input_dir, state="error", message=f"自动登录失败：{e}")
                return
        else:
            _set_sync(username, input_dir=input_dir, state="login", message="请在弹出的浏览器窗口中登录顽鹿账号…", total=0, done=0, new_files=[])
            try:
                auth = browser_login()
            except Exception as e:
                _set_sync(username, input_dir=input_dir, state="error", message=f"登录失败：{e}")
                return

        state = {} if full else load_state()
        if state and not _library_fit_paths(input_dir):
            state = {}
        skip_ids = set(state.keys())
        sess     = build_session(auth["token"], auth["cookies"])

        _set_sync(username, input_dir=input_dir, state="fetching", message="正在获取活动列表…")

        def on_page(pg, col, tot):
            _set_sync(username, input_dir=input_dir, message=f"获取列表：第 {pg} 页，已找到 {col} 条新活动")

        activities = fetch_activity_list(sess, skip_ids, limit, on_page=on_page)

        if not activities:
            _set_sync(username, input_dir=input_dir, state="done", message="没有新活动需要下载", total=0, done=0)
            return

        total = len(activities)
        _set_sync(username, input_dir=input_dir, state="downloading", message=f"共 {total} 个活动，开始下载…", total=total, done=0)

        new_files: list[str] = []
        done_count = 0
        dl_lock    = threading.Lock()
        storage_used = _input_storage_bytes(input_dir)
        storage_reserved = 0

        def _download_one(act: dict) -> tuple[Path | None, str]:
            nonlocal storage_used, storage_reserved
            download_sess = build_session(auth["token"], auth["cookies"])
            rid  = activity_id(act)
            t    = parse_activity_time(act)
            tstr = t.strftime("%Y-%m-%d %H:%M") if t else rid
            with dl_lock:
                already_done = bool(state.get(rid, {}).get("downloaded"))
                if not already_done:
                    if storage_used + storage_reserved + _MAX_SYNC_FILE_BYTES > _USER_STORAGE_MAX_BYTES:
                        return None, f"{tstr} — 用户 FIT 存储空间不足"
                    storage_reserved += _MAX_SYNC_FILE_BYTES
            try:
                path = download_activity(
                    download_sess, act, state, input_dir,
                    skip_rename=not already_done, state_lock=dl_lock,
                )
                if path and not already_done:
                    try:
                        downloaded_size = path.stat().st_size
                    except OSError:
                        downloaded_size = 0
                    with dl_lock:
                        storage_used += downloaded_size
                if path and not already_done:
                    with dl_lock:
                        is_fresh = state.get(rid, {}).get("downloaded_at") is not None
                    if is_fresh:
                        try:
                            ver, model, decrypted = auto_decrypt_if_gcj02(path)
                            new_path   = rename_magene(path, model=model)
                            if new_path != path:
                                with dl_lock:
                                    state[rid]["filename"] = new_path.name
                            path = new_path
                            if decrypted:
                                tstr = f"{tstr} — 已自动火星解密（版本 {ver:.0f}）"
                        except Exception as e:
                            logging.warning("自动火星解密失败 (%s): %s", path.name, e)
                return path, tstr
            except Exception as e:
                logging.warning("下载 %s 失败: %s", tstr, e)
                return None, tstr
            finally:
                if not already_done:
                    with dl_lock:
                        storage_reserved -= _MAX_SYNC_FILE_BYTES

        with ThreadPoolExecutor(max_workers=_MAX_DL_WORKERS) as pool:
            futures = {pool.submit(_download_one, act): act for act in activities}
            for future in as_completed(futures):
                path, msg = future.result()
                with dl_lock:
                    done_count += 1
                    dc = done_count
                    if path:
                        new_files.append(path.name)
                _set_sync(username, input_dir=input_dir, message=f"[{dc}/{total}] {msg}", done=dc, new_files=list(new_files))

        save_state(state)
        _set_sync(
            username,
            input_dir=input_dir,
            state="done",
            message=f"同步完成，新增 {len(new_files)} 个文件",
            done=total,
            new_files=new_files,
        )

    except Exception as e:
        _set_sync(username, input_dir=input_dir, state="error", message=f"同步出错：{e}")


def _run_igpsport_sync(username: str, input_dir: Path, config_file: Path, full: bool):
    """后台线程：登录 iGPSport → 拉取列表 → 下载 FIT。"""
    from fafa.igpsport import IGPSportClient, make_filename, ride_id_exists, _parse_start_time

    try:
        creds = _load_platform_credentials("igpsport", config_file)
        if not creds:
            _set_sync(username, input_dir=input_dir, state="error", message="iGPSport 未配置账号密码，请在设置中填写")
            return

        _set_sync(username, input_dir=input_dir, state="login", message="正在登录 iGPSport…", total=0, done=0, new_files=[])
        client = IGPSportClient(creds["username"], creds["password"])
        try:
            client.login()
        except Exception as e:
            _set_sync(username, input_dir=input_dir, state="error", message=f"iGPSport 登录失败：{e}")
            return

        _set_sync(username, input_dir=input_dir, state="fetching", message="正在获取 iGPSport 活动列表…")
        try:
            activities = client.get_all_activities(max_activities=_MAX_SYNC_ACTIVITIES)
        except Exception as e:
            _set_sync(username, input_dir=input_dir, state="error", message=f"获取活动列表失败：{e}")
            return

        if not full:
            activities = [
                act for act in activities
                if not ride_id_exists(str(act.get("rideId", "")), input_dir)
            ]

        if not activities:
            _set_sync(username, input_dir=input_dir, state="done", message="没有新活动需要下载", total=0, done=0)
            return

        total = len(activities)
        _set_sync(username, input_dir=input_dir, state="downloading", message=f"共 {total} 个活动，开始下载…", total=total, done=0)

        new_files: list[str] = []
        failed = 0
        storage_used = _input_storage_bytes(input_dir)

        for i, act in enumerate(activities, 1):
            ride_id = str(act.get("rideId", ""))
            start_time = _parse_start_time(act)
            filename = make_filename(ride_id, start_time)
            dst_path = input_dir / filename
            ts_str = start_time.strftime("%Y-%m-%d %H:%M") if start_time else ride_id

            try:
                if storage_used + _MAX_SYNC_FILE_BYTES > _USER_STORAGE_MAX_BYTES:
                    raise RuntimeError('用户 FIT 存储空间已达到上限')
                client.download_file(ride_id, dst_path)
                storage_used += dst_path.stat().st_size
                new_files.append(filename)
            except Exception as e:
                failed += 1
                logging.warning("iGPSport 下载 %s 失败: %s", ride_id, e)

            _set_sync(username, input_dir=input_dir, message=f"[{i}/{total}] {ts_str}", done=i, new_files=list(new_files))

        msg = f"同步完成，新增 {len(new_files)} 个文件"
        if failed:
            msg += f"，{failed} 个下载失败"
        _set_sync(username, input_dir=input_dir, state="done", message=msg, done=total, new_files=new_files)

    except Exception as e:
        _set_sync(username, input_dir=input_dir, state="error", message=f"同步出错：{e}")


# ── 路由：主页 ─────────────────────────────────────────────────────────────────
@app.route("/")
@_auth.login_required
def index():
    return render_template("index.html", username=g.username, version=FAFA_VERSION)


@app.route("/api/upload", methods=["POST"])
@_auth.login_required
def upload():
    f = request.files.get("file")
    if not f:
        return jsonify(error="未收到文件"), 400
    if not f.filename.lower().endswith(".fit"):
        return jsonify(error="请上传 .fit 格式文件"), 400

    fd, tmp_path = tempfile.mkstemp(suffix=".fit")
    os.close(fd)
    f.save(tmp_path)

    try:
        data = _parse_and_build(tmp_path, f.filename)
    except ValueError as e:
        return jsonify(error=str(e)), 422
    except Exception as e:
        return jsonify(error=f"解析失败: {e}"), 422
    finally:
        os.unlink(tmp_path)
        _remove_file_caches(Path(tmp_path))

    return jsonify(**data, source="upload")


# ── 路由：文件库 ──────────────────────────────────────────────────────────────
@app.route("/api/files")
@_auth.login_required
def list_files():
    """列出用户 input/<username>/ 目录下所有 .fit 文件（按修改时间倒序）。"""
    input_dir = _user_input_dir()
    if not input_dir.exists():
        return jsonify(files=[])

    files = []
    for p in _library_fit_paths(input_dir):
        try:
            st = p.stat()
        except OSError:
            continue
        files.append({
            "filename": p.name,
            "size_kb": round(st.st_size / 1024, 1),
            "mtime": st.st_mtime,
        })
    files.sort(key=lambda item: item["mtime"], reverse=True)
    return jsonify(files=files)


@app.route("/api/files/delete", methods=["POST"])
@_auth.login_required
def delete_file():
    """删除用户 input/<username>/ 中单个 .fit 文件，同步清理内存和磁盘缓存。"""
    input_dir = _user_input_dir()
    body     = request.get_json(silent=True) or {}
    filename = body.get("filename", "")
    if not filename or not filename.lower().endswith(".fit"):
        return jsonify(error="invalid filename"), 400
    path = (input_dir / filename).resolve()
    if path.parent != input_dir.resolve():
        return jsonify(error="invalid path"), 403
    try:
        _delete_library_file(path)
    except Exception as e:
        return jsonify(error=str(e)), 500
    return jsonify(deleted=1)


@app.route("/api/files/delete_all", methods=["POST"])
@_auth.login_required
def delete_all_files():
    """删除用户 input/<username>/ 目录下所有 .fit 文件。"""
    input_dir = _user_input_dir()
    if not input_dir.exists():
        return jsonify(deleted=0)
    deleted = 0
    for p in _library_fit_paths(input_dir):
        try:
            _delete_library_file(p)
            deleted += 1
        except Exception:
            pass
    return jsonify(deleted=deleted)


@app.route("/api/files/export", methods=["GET", "POST"])
@_auth.login_required
def export_fit_files():
    """Download all or selected library FIT files as a ZIP archive."""
    input_dir = _user_input_dir()
    filenames = request.form.getlist("filename") if request.method == "POST" else None

    if filenames is None:
        paths = _library_fit_paths(input_dir)
        archive_name = "fafa_all_fit.zip"
    else:
        try:
            _validate_string_list(filenames, max_items=_MAX_EXPORT_FILES, field="filenames")
        except ValueError as e:
            return jsonify(error=str(e)), 400
        paths = []
        seen = set()
        for filename in filenames:
            if filename in seen:
                continue
            path = _validate_filename_in_input(filename, input_dir)
            if path is None or not path.is_file():
                return jsonify(error=f"无效或不存在的文件: {filename}"), 400
            paths.append(path)
            seen.add(filename)
        archive_name = "fafa_selected_fit.zip"

    if not paths:
        return jsonify(error="没有可导出的 FIT 文件"), 400
    if len(paths) > _MAX_EXPORT_FILES:
        return jsonify(error=f"导出文件数量不能超过 {_MAX_EXPORT_FILES}"), 413

    archive = tempfile.SpooledTemporaryFile(max_size=64 * 1024 * 1024, mode="w+b")
    try:
        with zipfile.ZipFile(archive, mode="w", compression=zipfile.ZIP_STORED) as zf:
            for path in paths:
                zf.write(path, arcname=path.name)
        archive.seek(0)
        return send_file(
            archive,
            mimetype="application/zip",
            as_attachment=True,
            download_name=archive_name,
        )
    except Exception:
        archive.close()
        raise


@app.route("/api/load", methods=["POST"])
@_auth.login_required
def load_file():
    """从用户 input/<username>/ 目录加载指定文件（安全检查：只允许加载目录内的 .fit）。"""
    input_dir = _user_input_dir()
    body = request.get_json(silent=True) or {}
    filename = body.get("filename", "")

    if not filename or not filename.lower().endswith(".fit"):
        return jsonify(error="无效的文件名"), 400

    path = (input_dir / filename).resolve()
    if path.parent != input_dir.resolve():
        return jsonify(error="非法路径"), 403
    if not path.exists():
        return jsonify(error="文件不存在"), 404

    try:
        data = _parse_and_build(str(path), filename)
    except ValueError as e:
        return jsonify(error=str(e)), 422
    except Exception as e:
        return jsonify(error=f"解析失败: {e}"), 422

    return jsonify(**data, source="library")


@app.route("/api/records/<path:filename>")
@_auth.login_required
def get_records(filename):
    """Return raw FIT record data for detail-view charting (real-time x-axis)."""
    input_dir = _user_input_dir()
    if not filename.lower().endswith(".fit"):
        return jsonify(error="invalid filename"), 400
    path = (input_dir / filename).resolve()
    if path.parent != input_dir.resolve():
        return jsonify(error="forbidden"), 403
    if not path.exists():
        return jsonify(error="not found"), 404

    path_str = str(path)
    signature = _file_signature(path)
    with _records_cache_lock:
        entry = _records_cache.get(path_str)
        if entry and entry["sig"] == signature:
            return jsonify(records=entry["records"])

    try:
        fit = _parse_fit_safe(path_str)
    except Exception as e:
        return jsonify(error=f"解析失败: {e}"), 422

    utc_offset_s = fit.utc_offset_s or 0
    tz = timezone(timedelta(seconds=utc_offset_s))

    out = []
    for r in fit.records:
        ts_local = r.timestamp.astimezone(tz)
        lr = decode_lr_balance(r.left_right_balance)
        te_vals = [v for v in [r.left_torque_effectiveness, r.right_torque_effectiveness]
                   if v is not None and v > 0]
        ps_lr = [v for v in [r.left_pedal_smoothness, r.right_pedal_smoothness]
                 if v is not None and v > 0]
        ps_vals = ps_lr if ps_lr else (
            [r.combined_pedal_smoothness] if r.combined_pedal_smoothness and r.combined_pedal_smoothness > 0 else []
        )
        out.append({
            "t":            ts_local.strftime("%H:%M:%S"),
            "speed_kmh":    round(r.speed_ms * 3.6, 2) if r.speed_ms is not None else None,
            "hr":           r.heart_rate,
            "power":        r.power,
            "cadence":      r.cadence,
            "altitude":     round(r.altitude, 1) if r.altitude is not None else None,
            "grade":        round(r.grade, 2) if r.grade is not None else None,
            "temp_c":       r.temperature,
            "lr_left":      lr[0] if lr else None,
            "torque_eff":   round(sum(te_vals) / len(te_vals), 1) if te_vals else None,
            "pedal_smooth": round(sum(ps_vals) / len(ps_vals), 1) if ps_vals else None,
        })

    encoded_size = 1024 + len(out) * 256
    global _records_cache_bytes
    with _records_cache_lock:
        previous = _records_cache.pop(path_str, None)
        if previous:
            _records_cache_bytes -= previous.get('size', 0)
        while _records_cache and _records_cache_bytes + encoded_size > _RECORDS_CACHE_MAX_BYTES:
            oldest = next(iter(_records_cache))
            evicted = _records_cache.pop(oldest)
            _records_cache_bytes -= evicted.get('size', 0)
        if encoded_size <= _RECORDS_CACHE_MAX_BYTES:
            _records_cache[path_str] = {"sig": signature, "records": out, "size": encoded_size}
            _records_cache_bytes += encoded_size

    return jsonify(records=out)


# ── 路由：坐标写回 ─────────────────────────────────────────────────────────────
@app.route("/api/fix_coords", methods=["POST"])
@_auth.login_required
def fix_coords_api():
    input_dir = _user_input_dir()
    body     = request.get_json(silent=True) or {}
    filename = body.get("filename", "")
    method   = body.get("method", "")

    if not filename or not filename.lower().endswith(".fit"):
        return jsonify(error="无效的文件名"), 400
    if method not in ("decrypt", "encrypt"):
        return jsonify(error="method 必须是 decrypt 或 encrypt"), 400

    path = (input_dir / filename).resolve()
    if path.parent != input_dir.resolve():
        return jsonify(error="非法路径"), 403
    if not path.exists():
        return jsonify(error="文件不存在"), 404

    try:
        from fafa.tools.fix_coords import fix_file
        lock_fh, _ = _parse_lock_file(path)
        with lock_fh:
            original_mtime = path.stat().st_mtime
            fix_file(path, path, method)
            os.utime(path, (original_mtime, original_mtime))
            _remove_file_caches(path, remove_lock=False)
        return jsonify(ok=True)
    except Exception as e:
        return jsonify(error=f"坐标转换失败: {e}"), 500


# ── 路由：全量导出 JSON ────────────────────────────────────────────────────────
@app.route("/api/export/all")
@_auth.login_required
def export_all():
    """导出用户 input/<username>/ 下所有 FIT 文件的解析结果为 JSON 文件（供 AI 使用）。"""
    input_dir = _user_input_dir()
    no_km = request.args.get("no_km_stats", "0") == "1"
    try:
        min_km = float(request.args.get("min_km", "0") or "0")
    except ValueError:
        return jsonify(error="min_km 参数无效"), 400

    if not input_dir.exists():
        return jsonify(error="用户数据目录不存在"), 404

    def _strip_nulls(obj):
        if isinstance(obj, dict):
            return {k: _strip_nulls(v) for k, v in obj.items() if v is not None}
        if isinstance(obj, list):
            return [_strip_nulls(i) for i in obj]
        return obj

    ordered_paths = []
    for path in _library_fit_paths(input_dir):
        try:
            cached = _parse_and_build(str(path), path.name)
        except Exception as e:
            logging.warning("export_all 解析失败 (%s): %s", path.name, e)
            continue
        summary_d = cached.get("summary") or {}
        if min_km > 0 and (summary_d.get("total_dist_km") or 0) < min_km:
            continue
        date_str = cached.get("time_stats_start") or cached.get("date")
        ordered_paths.append((date_str or '', path))
    ordered_paths.sort(key=lambda item: item[0])

    def generate():
        total_km = 0.0
        dates = []
        count = 0
        first = True
        yield '{"activities":['
        for _, path in ordered_paths:
            try:
                cached = _parse_and_build(str(path), path.name)
            except Exception:
                continue
            summary_d = cached.get("summary") or {}
            date_str = cached.get("time_stats_start") or cached.get("date")
            entry = {"filename": path.name, "date": date_str, "summary": summary_d}
            if not no_km:
                entry["km_stats"] = cached.get("km_stats", [])
            if not first:
                yield ','
            yield json.dumps(_strip_nulls(entry), ensure_ascii=False, separators=(',', ':'), default=str)
            first = False
            count += 1
            total_km += summary_d.get("total_dist_km") or 0
            if date_str:
                dates.append(date_str[:10])
        meta = {
            "exported_at": datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
            "total_activities": count,
            "total_km": round(total_km, 2),
            "date_range": [dates[0], dates[-1]] if dates else [],
            "includes_km_stats": not no_km,
        }
        yield '],"meta":'
        yield json.dumps(meta, ensure_ascii=False, separators=(',', ':'))
        yield '}'

    from flask import Response, stream_with_context
    return Response(
        stream_with_context(generate()),
        mimetype='application/json',
        headers={'Content-Disposition': 'attachment; filename="fafa_export.json"'},
    )


# ── 路由：顽鹿同步（alias） ───────────────────────────────────────────────────
def _sync_start_handler(username, input_dir, config_file, platform, full, limit):
    """共享逻辑：检查文件锁 → 启动后台线程。"""
    flock_fh = _try_acquire_sync_flock(input_dir)
    if flock_fh is None:
        return jsonify(error='同步正在进行中'), 409
    global_slot_fh = _try_acquire_slot('sync', _SYNC_SLOTS)
    if global_slot_fh is None:
        flock_fh.close()
        return jsonify(error='服务器同步任务繁忙，请稍后重试'), 429

    state = _read_sync_state(input_dir)
    if state.get('state') in ('login', 'fetching', 'downloading'):
        updated_at = int(state.get('updated_at') or 0)
        if updated_at and time.time() - updated_at > _TASK_STALE_S:
            _write_sync_state(input_dir, {**state, 'state': 'error', 'message': '上次任务已中断，请重新同步'})

    def _run_and_release(target, args, fh, slot_fh):
        try:
            target(*args)
        finally:
            try:
                fh.close()
            except Exception:
                pass
            slot_fh.close()

    if platform == 'igpsport':
        target, args = _run_igpsport_sync, (username, input_dir, config_file, full)
    else:
        target, args = _run_sync, (username, input_dir, config_file, full, limit)

    t = threading.Thread(target=_run_and_release, args=(target, args, flock_fh, global_slot_fh), daemon=False)
    try:
        t.start()
    except Exception:
        flock_fh.close()
        global_slot_fh.close()
        raise
    return jsonify(ok=True)


@app.route("/api/onelap/sync", methods=["POST"])
@_auth.login_required
def onelap_sync():
    body  = request.get_json(silent=True) or {}
    try:
        full = _json_bool(body, 'full')
    except ValueError as e:
        return jsonify(error=str(e)), 400
    limit = body.get("limit")
    if limit is not None:
        try:
            limit = int(limit)
        except (TypeError, ValueError):
            return jsonify(error='limit 参数无效'), 400
        if limit < 1 or limit > _MAX_SYNC_ACTIVITIES:
            return jsonify(error=f'limit 必须在 1-{_MAX_SYNC_ACTIVITIES} 之间'), 400
    else:
        limit = _MAX_SYNC_ACTIVITIES
    return _sync_start_handler(g.username, _user_input_dir(), _user_config_file(), 'onelap', full, limit)


@app.route("/api/onelap/status")
@_auth.login_required
def onelap_status():
    return jsonify(**_read_sync_state(_user_input_dir()))


@app.route("/api/sync/start", methods=["POST"])
@_auth.login_required
def sync_start():
    body     = request.get_json(silent=True) or {}
    platform = body.get("platform", "onelap")
    if platform not in ('onelap', 'igpsport'):
        return jsonify(error='不支持的同步平台'), 400
    try:
        full = _json_bool(body, 'full')
    except ValueError as e:
        return jsonify(error=str(e)), 400
    limit    = body.get("limit")
    if limit is not None:
        try:
            limit = int(limit)
        except (TypeError, ValueError):
            return jsonify(error='limit 参数无效'), 400
        if limit < 1 or limit > _MAX_SYNC_ACTIVITIES:
            return jsonify(error=f'limit 必须在 1-{_MAX_SYNC_ACTIVITIES} 之间'), 400
    else:
        limit = _MAX_SYNC_ACTIVITIES
    return _sync_start_handler(g.username, _user_input_dir(), _user_config_file(), platform, full, limit)


@app.route("/api/sync/status")
@_auth.login_required
def sync_status():
    return jsonify(**_read_sync_state(_user_input_dir()))


# ── AI 骑行评估 ───────────────────────────────────────────────────────────────

def _get_ai_config() -> dict | None:
    config_file = _user_config_file()
    if not config_file.exists():
        return None
    try:
        with open(config_file, encoding='utf-8') as f:
            cfg = json.load(f)
        key = (cfg.get('api_key') or '').strip()
        if not key or key.startswith('your-'):
            return None
        return cfg
    except Exception:
        return None


def _config_max_tokens(cfg: dict) -> int:
    try:
        return max(256, min(16_000, int(cfg.get('max_tokens', 2500))))
    except (TypeError, ValueError):
        return 2500


def _wind_dir_label(deg: float) -> str:
    labels = ["北风", "东北风", "东风", "东南风", "南风", "西南风", "西风", "西北风"]
    return labels[round(deg / 45) % 8]


def _wind_stats(
    coords: list,
    start_time_utc: str,
    km_stats: list,
    hourly: dict,
) -> dict:
    """
    Compute headwind/tailwind/crosswind percentages from GPS track and hourly wind data.
    """
    start_dt = datetime.fromisoformat(start_time_utc.replace("Z", "+00:00"))
    total_s = sum(s.get("duration_s", 0) for s in km_stats) if km_stats else 0

    times  = hourly.get("time", [])
    speeds = hourly.get("windspeed_10m", [])
    dirs   = hourly.get("winddirection_10m", [])
    gusts  = hourly.get("windgusts_10m", [])
    hour_data: dict[int, tuple] = {}
    for i, t in enumerate(times):
        dt = datetime.fromisoformat(t).replace(tzinfo=timezone.utc)
        h  = int(dt.timestamp()) // 3600
        hour_data[h] = (
            speeds[i] if i < len(speeds) else None,
            dirs[i]   if i < len(dirs)   else None,
            gusts[i]  if i < len(gusts)  else None,
        )

    n = len(coords)
    cum_dist = [0.0]
    for i in range(1, n):
        dlat = math.radians(coords[i][0] - coords[i - 1][0])
        dlon = math.radians(coords[i][1] - coords[i - 1][1])
        lat_m = math.radians((coords[i][0] + coords[i - 1][0]) / 2)
        d = math.sqrt((dlat * 6_371_000) ** 2 + (dlon * 6_371_000 * math.cos(lat_m)) ** 2)
        cum_dist.append(cum_dist[-1] + d)
    total_dist = cum_dist[-1]

    head = tail = cross = 0.0
    spd_sum = spd_n = 0
    gust_max = 0.0
    dir_sin = dir_cos = 0.0

    for i in range(1, n):
        seg = cum_dist[i] - cum_dist[i - 1]
        if seg < 1:
            continue

        mid = (cum_dist[i - 1] + cum_dist[i]) / 2
        elapsed = (mid / total_dist * total_s) if total_dist > 0 else 0

        h_key = int((start_dt.timestamp() + elapsed) / 3600)
        wind = hour_data.get(h_key)
        if wind is None:
            continue
        w_spd, w_dir, w_gust = wind
        if w_spd is None or w_dir is None:
            continue

        dlat = coords[i][0] - coords[i - 1][0]
        dlon = coords[i][1] - coords[i - 1][1]
        lat_m = math.radians((coords[i][0] + coords[i - 1][0]) / 2)
        bearing = (math.degrees(math.atan2(dlon * math.cos(lat_m), dlat)) + 360) % 360

        rel = (bearing - w_dir + 360) % 360
        if rel < 45 or rel > 315:
            head += seg
        elif 135 < rel < 225:
            tail += seg
        else:
            cross += seg

        spd_sum += w_spd
        spd_n   += 1
        if w_gust is not None:
            gust_max = max(gust_max, w_gust)
        dir_sin += math.sin(math.radians(w_dir))
        dir_cos += math.cos(math.radians(w_dir))

    classified = head + tail + cross
    if classified == 0 or spd_n == 0:
        return {"available": False}

    head_pct  = round(100 * head  / classified)
    tail_pct  = round(100 * tail  / classified)
    cross_pct = 100 - head_pct - tail_pct

    avg_spd = round(spd_sum / spd_n, 1)
    avg_dir = (math.degrees(math.atan2(dir_sin / spd_n, dir_cos / spd_n)) + 360) % 360

    return {
        "available":         True,
        "wind_speed_avg_kmh": avg_spd,
        "wind_dir_deg":      round(avg_dir),
        "wind_dir_label":    _wind_dir_label(avg_dir),
        "gust_max_kmh":      round(gust_max, 1),
        "headwind_pct":      head_pct,
        "tailwind_pct":      tail_pct,
        "crosswind_pct":     cross_pct,
    }


def _build_eval_prompt(summary: dict, km_stats: list, filename: str, start_time: str,
                       time_stats: list | None = None,
                       wind_data: dict | None = None) -> str:
    def fmt(v, unit="", digits=1):
        return "无数据" if v is None else f"{round(v, digits)}{unit}"

    lines = [
        "你是一名专业公路自行车训练教练，请根据以下骑行数据进行全面分析，输出结构化中文评估报告。",
        "",
        "## 骑行基本信息",
    ]
    if start_time:
        lines.append(f"- 骑行开始时间：{start_time}")
    if filename:
        lines.append(f"- 文件名：{filename}")

    lines += [
        "",
        "## 骑行汇总数据",
        f"- 总距离：{fmt(summary.get('total_dist_km'), ' km')}",
        f"- 总时长：{fmt((summary.get('total_duration_s') or 0) / 60, ' 分钟', 0)}",
        f"- 移动时长：{fmt((summary.get('moving_time_s') or 0) / 60, ' 分钟', 0)}",
        f"- 平均速度：{fmt(summary.get('avg_speed_kmh'), ' km/h')}",
        f"- 最大速度：{fmt(summary.get('max_speed_kmh'), ' km/h')}",
        f"- 总爬升：{fmt(summary.get('total_elevation_gain_m'), ' m', 0)}",
        f"- 总下降：{fmt(summary.get('total_elevation_loss_m'), ' m', 0)}",
        f"- 平均心率：{fmt(summary.get('avg_hr'), ' bpm', 0)}",
        f"- 最大心率：{fmt(summary.get('max_hr'), ' bpm', 0)}",
        f"- 平均踏频：{fmt(summary.get('avg_cadence'), ' rpm', 0)}",
        f"- 平均功率：{fmt(summary.get('avg_power'), ' W', 0)}",
        f"- 最大功率：{fmt(summary.get('max_power'), ' W', 0)}",
        f"- 归一化功率 (NP)：{fmt(summary.get('normalized_power'), ' W', 0)}",
        f"- 卡路里消耗：{fmt(summary.get('total_calories_kcal'), ' kcal', 0)}",
        f"- 平均气温：{fmt(summary.get('avg_temp_c'), ' °C')}",
    ]
    if wind_data and wind_data.get("available"):
        w = wind_data
        lines += [
            "",
            "## 气象条件（来源：Open-Meteo 历史天气）",
            f"- 平均风速：{w['wind_speed_avg_kmh']} km/h，阵风最大：{w['gust_max_kmh']} km/h",
            f"- 主导风向：{w['wind_dir_label']}（{w['wind_dir_deg']}°）",
            f"- 全程逆风：{w['headwind_pct']}%  顺风：{w['tailwind_pct']}%  侧风：{w['crosswind_pct']}%",
        ]
        if w["headwind_pct"] > 30:
            lines.append("（逆风比例偏高，速度表现可能受明显影响，分析时请结合考虑）")
        lines += [
            "",
            "### 8. 风力影响评估（仅当逆风 > 30% 时输出，否则跳过）",
            "说明风力对本次骑行均速的影响程度，估算去除风力因素后的实际能力水平。",
        ]
    if summary.get("left_pct") is not None:
        r = 100 - summary["left_pct"]
        lines.append(f"- 左右功率平衡：左 {summary['left_pct']:.0f}% / 右 {r:.0f}%")

    if km_stats:
        lines.append("")
        lines.append(f"## 逐公里分段数据（共 {len(km_stats)} 段）")
        lines.append("公里段 | 时长(s) | 均速(km/h) | 均心率(bpm) | 均功率(W) | 均踏频(rpm) | 爬升(m) | 均坡度(%)")
        lines.append("------|--------|-----------|------------|---------|-----------|--------|--------")

        def _v(s, key, d=0):
            val = s.get(key)
            return "—" if val is None else str(round(val, d))

        def km_row(s):
            return (f"第{s.get('km','?')}km | {_v(s,'duration_s',0)}s | "
                    f"{_v(s,'avg_speed_kmh',1)} | {_v(s,'avg_hr',0)} | "
                    f"{_v(s,'avg_power',0)} | {_v(s,'avg_cadence',0)} | "
                    f"{_v(s,'elevation_gain_m',0)} | {_v(s,'avg_grade_pct',1)}")

        show = km_stats if len(km_stats) <= 15 else (km_stats[:7] + [None] + km_stats[-7:])
        for s in show:
            lines.append("…（中间段省略）" if s is None else km_row(s))

    if time_stats:
        lines.append("")
        lines.append(f"## 逐分钟数据（共 {len(time_stats)} 分钟，用于识别节奏/疲劳变化）")
        lines.append("分钟 | 均速(km/h) | 均心率(bpm) | 均功率(W) | 均踏频(rpm)")
        lines.append("-----|-----------|------------|---------|----------")

        def _v(s, key, d=0):
            val = s.get(key)
            return "—" if val is None else str(round(val, d))

        def t_row(s):
            return (f"{s.get('km','?')} | {_v(s,'avg_speed_kmh',1)} | "
                    f"{_v(s,'avg_hr',0)} | {_v(s,'avg_power',0)} | {_v(s,'avg_cadence',0)}")

        step = max(1, len(time_stats) // 40)
        sampled = time_stats[::step]
        for s in sampled:
            lines.append(t_row(s))

    lines += [
        "",
        "## 评估报告章节（仅输出数据充分的章节，无相关数据的章节跳过）",
        "",
        "### 1. 骑行概览",
        "一段话总结本次骑行的场景（距离/地形/强度定性）。",
        "",
        "### 2. 速度与配速分析",
        "评估均速水平、逐公里速度稳定性（变异幅度）、是否存在明显掉速。",
        "",
        "### 3. 心率分析（如有心率数据）",
        "评估有氧强度区间、心率漂移情况、有氧效率（如同时有功率：EF = NP / 均心率）。",
        "",
        "### 4. 功率分析（如有功率数据）",
        "分析 AP/NP 差距（变异系数 VI = NP/AP，越接近1越匀速）、功率输出水平定性评价。",
        "",
        "### 5. 爬升表现（如爬升 > 50 m）",
        "评估爬坡段速度/心率/功率的响应，以及整体爬升效率。",
        "",
        "### 6. 综合评分",
        "给出本次训练质量评分（1–10分），列出2–3个亮点和1–2个改进方向。",
        "",
        "### 7. 训练建议",
        "基于本次骑行数据，给出1–3条具体可执行的下次训练建议。",
        "",
        "格式要求：Markdown，## 做章节标题，**加粗**关键数值，- 做列表。语言简洁专业。",
    ]
    return "\n".join(lines)


def _wind_normalize_speed(v_avg: float | None, wind_data: dict | None) -> tuple:
    """Returns (v_normalized, effective_headwind_kmh). Linear approximation:
    v_norm = v_avg + eff_headwind × 0.25  (0.25 km/h per 1 km/h effective headwind)."""
    if not wind_data or not wind_data.get("available") or not v_avg:
        return v_avg, 0.0
    wind_speed   = wind_data.get("wind_speed_avg_kmh", 0) or 0
    headwind_pct = wind_data.get("headwind_pct", 0) or 0
    tailwind_pct = wind_data.get("tailwind_pct", 0) or 0
    eff_headwind = wind_speed * (headwind_pct - tailwind_pct) / 100
    return round(v_avg + eff_headwind * 0.25, 1), round(eff_headwind, 1)


def _build_compare_prompt(activities: list) -> str:
    def fmt(v, unit="", digits=1):
        return "无数据" if v is None else f"{round(v, digits)}{unit}"

    def _v(seg, key, d=0):
        val = seg.get(key)
        return "—" if val is None else str(round(val, d))

    lines = [
        "你是一名专业公路自行车训练教练，请根据以下多次骑行数据进行横向对比分析，输出结构化中文对比报告。",
        "",
        "## 骑行对比汇总表",
        "| 编号 | 日期 | 距离(km) | 均速(km/h) | 归一化均速(km/h) | 有效逆风(km/h) | 均功率(W) | NP(W) | 均心率(bpm) | 爬升(m) |",
        "|------|------|---------|-----------|----------------|--------------|---------|-------|-----------|--------|",
    ]

    for i, act in enumerate(activities, 1):
        s  = act.get("summary") or {}
        wd = act.get("wind_data") or {}
        v_avg = s.get("avg_speed_kmh")
        v_norm, eff_hw = _wind_normalize_speed(v_avg, wd if wd.get("available") else None)
        date_str = (act.get("start_time") or "")[:10] or "未知"
        eff_str  = fmt(eff_hw if wd.get("available") else None, "", 1)
        lines.append(
            f"| {i} | {date_str} | {fmt(s.get('total_dist_km'), '', 1)} | "
            f"{fmt(v_avg, '', 1)} | {fmt(v_norm, '', 1)} | {eff_str} | "
            f"{fmt(s.get('avg_power'), '', 0)} | {fmt(s.get('normalized_power'), '', 0)} | "
            f"{fmt(s.get('avg_hr'), '', 0)} | {fmt(s.get('total_elevation_gain_m'), '', 0)} |"
        )

    lines.append("")

    for i, act in enumerate(activities, 1):
        s   = act.get("summary") or {}
        wd  = act.get("wind_data") or {}
        kms = act.get("km_stats") or []
        fn  = act.get("filename", f"骑行{i}")
        st  = act.get("start_time", "")
        v_avg = s.get("avg_speed_kmh")
        v_norm, eff_hw = _wind_normalize_speed(v_avg, wd if wd.get("available") else None)

        lines.append(f"## 骑行 {i} — {fn}" + (f"（{st[:16]}）" if st else ""))

        if wd.get("available"):
            lines.append(
                f"**风况**：均风速 {wd.get('wind_speed_avg_kmh')} km/h，"
                f"逆风 {wd.get('headwind_pct')}%，顺风 {wd.get('tailwind_pct')}%，"
                f"侧风 {wd.get('crosswind_pct')}%"
            )
            lines.append(
                f"**有效逆风**：{eff_hw} km/h → **归一化均速**：{v_norm} km/h"
                f"（原 {fmt(v_avg, '', 1)} km/h）"
            )
        else:
            lines.append("**风况**：无数据（均速未作风力归一化）")

        lines += [
            "",
            f"**汇总**：距离 {fmt(s.get('total_dist_km'), ' km')}，"
            f"移动时长 {fmt((s.get('moving_time_s') or 0) / 60, ' 分钟', 0)}，"
            f"爬升 {fmt(s.get('total_elevation_gain_m'), ' m', 0)}，"
            f"均踏频 {fmt(s.get('avg_cadence'), ' rpm', 0)}，"
            f"均功率 {fmt(s.get('avg_power'), ' W', 0)}，"
            f"NP {fmt(s.get('normalized_power'), ' W', 0)}，"
            f"均心率 {fmt(s.get('avg_hr'), ' bpm', 0)}",
            "",
        ]

        if kms:
            lines.append(f"**逐公里分段（共 {len(kms)} 段）**")
            lines.append("公里段 | 时长(s) | 均速(km/h) | 均心率(bpm) | 均功率(W) | 均踏频(rpm) | 爬升(m)")
            lines.append("------|--------|-----------|------------|---------|-----------|-------")
            for seg in kms:
                lines.append(
                    f"第{seg.get('km','?')}km | {_v(seg,'duration_s',0)}s | "
                    f"{_v(seg,'avg_speed_kmh',1)} | {_v(seg,'avg_hr',0)} | "
                    f"{_v(seg,'avg_power',0)} | {_v(seg,'avg_cadence',0)} | "
                    f"{_v(seg,'elevation_gain_m',0)}"
                )
        else:
            lines.append("**逐公里数据**：无")

        lines.append("")

    lines += [
        "## 对比分析要求",
        "",
        "请依次输出以下章节（无充分数据的章节可跳过）：",
        "",
        "### 1. 速度效率对比",
        "以**归一化均速**为主要指标，说明风力调整是否合理，哪次骑行速度效率最高。",
        "",
        "### 2. 配速策略对比",
        "分析各骑行逐公里速度/功率节奏的稳定性（变异幅度），谁的配速更均匀。",
        "",
        "### 3. 有氧效率对比（如有心率 + 功率数据）",
        "对比各骑行的 EF（= NP / 均心率），数值越高说明有氧效率越好。",
        "",
        "### 4. 爬坡表现对比（如爬升 > 50 m）",
        "对比各骑行在爬升段的速度/功率/心率响应及整体爬升效率。",
        "",
        "### 5. 综合评定",
        "明确指出哪次骑行综合表现最优，给出具体理由（引用关键数值）。",
        "",
        "### 6. 训练建议",
        "基于对比结果，给出 1–3 条针对性的训练建议。",
        "",
        "格式：Markdown，## 做章节标题，**加粗**关键对比数值，重要对比用表格呈现。语言简洁专业。",
    ]

    return "\n".join(lines)


@app.route("/api/ai/config")
@_auth.login_required
def ai_config_status():
    cfg = _get_ai_config()
    if cfg:
        return jsonify(configured=True, model=cfg.get("model", ""))
    return jsonify(configured=False, model="")


_SECRET_FIELDS = frozenset({
    'api_key', 'onelap_password', 'igpsport_password',
    'strava_client_secret', 'strava_access_token', 'strava_refresh_token',
})
_CONFIG_STRING_LIMITS = {
    'api_base': 2048, 'api_key': 4096, 'model': 256,
    'onelap_username': 256, 'onelap_password': 4096,
    'igpsport_username': 256, 'igpsport_password': 4096,
    'strava_client_id': 256, 'strava_client_secret': 4096,
}
_CONFIG_NUMBER_RANGES = {
    'pmc_ftp': (50, 600), 'pmc_rest_hr': (30, 100), 'pmc_max_hr': (100, 220),
    'pmc_weight': (30, 150), 'route_grade_min': (-30, 0),
    'route_grade_max': (0, 30), 'route_speed_max': (10, 120),
    'route_cadence_max': (60, 200), 'max_tokens': (256, 16_000),
    'strava_redirect_port': (1024, 65_535),
}
_CONFIG_ALLOWED_KEYS = frozenset(_CONFIG_STRING_LIMITS) | frozenset(_CONFIG_NUMBER_RANGES)


def _mask_secrets(data: dict) -> dict:
    """把已配置的密钥字段替换为占位符，空值保持空。"""
    out = {}
    for k, v in data.items():
        if k in _SECRET_FIELDS:
            out[k] = _SECRET_MASK if v else ''
        else:
            out[k] = v
    return out


def _validate_config_update(data: dict) -> dict:
    unknown = set(data) - _CONFIG_ALLOWED_KEYS
    if unknown:
        raise ValueError(f'不支持的配置项: {sorted(unknown)[0]}')
    validated = {}
    for key, value in data.items():
        if key in _CONFIG_STRING_LIMITS:
            if not isinstance(value, str) or len(value) > _CONFIG_STRING_LIMITS[key]:
                raise ValueError(f'{key} 格式无效')
            value = value.strip()
            if key == 'api_base':
                _validate_api_base(value)
            validated[key] = value
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError(f'{key} 必须是数字')
        low, high = _CONFIG_NUMBER_RANGES[key]
        if not math.isfinite(value) or not low <= value <= high:
            raise ValueError(f'{key} 必须在 {low}-{high} 之间')
        if key in ('max_tokens', 'strava_redirect_port') and int(value) != value:
            raise ValueError(f'{key} 必须是整数')
        validated[key] = int(value) if key in ('max_tokens', 'strava_redirect_port') else value
    return validated


@app.route("/api/config/raw", methods=["GET"])
@_auth.login_required
def get_config_raw():
    config_file = _user_config_file()
    if not config_file.exists():
        template = PROJECT_ROOT / "config.template.json"
        if template.exists():
            with open(template, encoding="utf-8") as f:
                data = json.load(f)
            data.pop("_comment", None)
        else:
            data = {}
        return jsonify(_mask_secrets(data))
    with open(config_file, encoding="utf-8") as f:
        data = json.load(f)
    data.pop("_comment", None)
    return jsonify(_mask_secrets(data))


@app.route("/api/config/raw", methods=["POST"])
@_auth.login_required
def save_config_raw():
    config_file = _user_config_file()
    data = request.get_json(force=True, silent=True)
    if data is None:
        return jsonify(error="invalid JSON"), 400
    if not isinstance(data, dict):
        return jsonify(error="config 必须是 JSON 对象"), 400
    too_large = _reject_large_json(data, 100_000)
    if too_large:
        return too_large
    try:
        data = _validate_config_update(data)
    except ValueError as e:
        return jsonify(error=str(e)), 400
    lock_fh = _locked_file(config_file)
    try:
        existing: dict = {}
        if config_file.exists():
            try:
                with open(config_file, encoding="utf-8") as f:
                    existing = json.load(f)
            except Exception:
                pass
        readonly_keys = {"strava_access_token", "strava_refresh_token", "strava_expires_at", "strava_athlete_id", "strava_athlete_name"}
        filtered = {k: v for k, v in data.items() if k not in readonly_keys}
        for k in _SECRET_FIELDS:
            if filtered.get(k) in (_SECRET_MASK, ''):
                filtered.pop(k, None)
        existing.update(filtered)
        _atomic_write_json(config_file, existing)
    finally:
        lock_fh.close()
    return jsonify(ok=True)



_SSRF_BLOCKED_V4 = [
    ipaddress.ip_network('10.0.0.0/8'),
    ipaddress.ip_network('172.16.0.0/12'),
    ipaddress.ip_network('192.168.0.0/16'),
    ipaddress.ip_network('127.0.0.0/8'),
    ipaddress.ip_network('169.254.0.0/16'),
]
_SSRF_BLOCKED_V6 = [
    ipaddress.ip_network('::1/128'),
    ipaddress.ip_network('fc00::/7'),
    ipaddress.ip_network('fe80::/10'),
]


def _is_ssrf_blocked(addr: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    nets = _SSRF_BLOCKED_V4 if isinstance(addr, ipaddress.IPv4Address) else _SSRF_BLOCKED_V6
    return any(addr in net for net in nets)


def _resolve_public_api_base(url: str) -> None:
    """Validate url is a safe HTTPS endpoint (SSRF guard). Raises ValueError on violation."""
    import socket as _socket
    parsed = urlparse(url)
    if parsed.scheme != 'https' or parsed.username or parsed.password:
        raise ValueError('api_base 必须使用 HTTPS')
    host = parsed.hostname or ''
    if not host:
        raise ValueError('api_base 缺少主机名')
    try:
        infos = _socket.getaddrinfo(host, parsed.port or 443, type=_socket.SOCK_STREAM)
    except _socket.gaierror as e:
        raise ValueError(f'api_base 域名解析失败: {e}')
    if not infos:
        raise ValueError('api_base 未解析到可用地址')
    for info in infos:
        raw_addr = info[4][0]
        try:
            addr = ipaddress.ip_address(raw_addr)
        except ValueError:
            raise ValueError('api_base 解析到无效地址')
        checked = addr.ipv4_mapped or addr if isinstance(addr, ipaddress.IPv6Address) else addr
        if _is_ssrf_blocked(checked):
            raise ValueError('api_base 禁止指向内网地址')


def _validate_api_base(url: str) -> str:
    _resolve_public_api_base(url)
    return url



def _iter_sse_payloads(resp):
    deadline = time.monotonic() + _MAX_AI_STREAM_SECONDS
    total = 0
    pending = b''
    for chunk in resp.iter_content(chunk_size=8192):
        if time.monotonic() > deadline:
            raise RuntimeError('AI 响应超过最大持续时间')
        if not chunk:
            continue
        total += len(chunk)
        if total > _MAX_AI_RESPONSE_BYTES:
            raise RuntimeError('AI 响应超过大小限制')
        pending += chunk
        if len(pending) > _MAX_AI_SSE_LINE_BYTES and b'\n' not in pending:
            raise RuntimeError('AI 响应单行过长')
        while b'\n' in pending:
            raw, pending = pending.split(b'\n', 1)
            raw = raw.rstrip(b'\r')
            if len(raw) > _MAX_AI_SSE_LINE_BYTES:
                raise RuntimeError('AI 响应单行过长')
            if raw.startswith(b'data: '):
                yield raw[6:].strip().decode('utf-8', errors='replace')
    if pending.startswith(b'data: '):
        yield pending[6:].strip().decode('utf-8', errors='replace')


def _limited_error_text(resp, limit: int = 4096) -> str:
    data = bytearray()
    for chunk in resp.iter_content(chunk_size=min(limit, 4096)):
        if chunk:
            data.extend(chunk)
        if len(data) >= limit:
            break
    return bytes(data[:limit]).decode('utf-8', errors='replace')


def _format_upstream_api_error(status_code: int, raw_detail: str) -> str:
    """Turn OpenAI-compatible API failures into concise user-facing messages."""
    detail = (raw_detail or '').strip()
    if detail:
        try:
            parsed = json.loads(detail)
            error = parsed.get('error', parsed) if isinstance(parsed, dict) else parsed
            if isinstance(error, dict):
                detail = str(error.get('message') or error.get('detail') or error.get('code') or '').strip()
            elif isinstance(error, str):
                detail = error.strip()
        except (TypeError, ValueError):
            pass
        detail = re.sub(r'<[^>]*>', ' ', detail)
        detail = re.sub(r'\s+', ' ', detail).strip()[:300]

    defaults = {
        400: '请求参数或模型配置不受支持，请检查模型名称和 API Base',
        401: 'API Key 无效或已过期，请检查密钥配置',
        403: '当前 API Key 没有访问该模型的权限',
        418: '上游 API 拒绝请求，请检查 API Base、API Key、模型名称或服务商账户风控状态',
        429: '上游 API 请求过于频繁或额度不足，请稍后重试并检查账户余额',
    }
    fallback = defaults.get(status_code)
    if fallback is None and status_code >= 500:
        fallback = '上游 API 服务暂时不可用，请稍后重试'
    fallback = fallback or '上游 API 请求失败'
    return f'{fallback}（HTTP {status_code}）' + (f'：{detail}' if detail else '')


def _llm_stream(cfg: dict, prompt: str | None = None, messages: list | None = None, max_tokens_override: int | None = None):
    """共享 SSE 流式响应助手，所有 AI 端点都通过此函数返回。"""
    from flask import Response as _Resp, stream_with_context
    import requests as _req

    api_base = cfg.get("api_base", "https://api.openai.com/v1").rstrip("/")
    try:
        _resolve_public_api_base(api_base)
    except ValueError as e:
        _err_msg = str(e)
        def _err():
            yield f"data: {json.dumps({'error': _err_msg})}\n\n"
        from flask import Response as _Resp, stream_with_context
        return _Resp(stream_with_context(_err()), mimetype='text/event-stream')
    auth     = f"Bearer {cfg['api_key']}"
    payload  = {
        "model":      cfg.get("model", "gpt-4o-mini"),
        "messages":   messages if messages is not None else [{"role": "user", "content": prompt}],
        "max_tokens": max_tokens_override if max_tokens_override is not None else _config_max_tokens(cfg),
        "stream":     True,
    }

    slot_fh = _try_acquire_slot('ai', _AI_SLOTS)
    if slot_fh is None:
        return jsonify(error='服务器 AI 请求繁忙，请稍后重试'), 429

    def generate():
        if prompt is not None:
            yield f"data: {json.dumps({'type': 'prompt', 'content': prompt}, ensure_ascii=False)}\n\n"
        sess = None
        try:
            sess = _req.Session()
            resp = sess.post(
                f"{api_base}/chat/completions",
                headers={"Content-Type": "application/json", "Authorization": auth},
                json=payload, stream=True, timeout=(10, 120), allow_redirects=False,
            )
            with resp:
                if not resp.ok:
                    detail = _limited_error_text(resp, 4096)
                    message = _format_upstream_api_error(resp.status_code, detail)
                    logging.warning('AI API rejected request: status=%s detail=%s', resp.status_code, detail[:500])
                    yield f"data: {json.dumps({'error': message}, ensure_ascii=False)}\n\n"
                    return
                for ds in _iter_sse_payloads(resp):
                    if ds == "[DONE]":
                        break
                    try:
                        chunk = json.loads(ds)
                        delta = chunk["choices"][0]["delta"].get("content", "")
                        if delta:
                            yield f"data: {json.dumps({'text': delta})}\n\n"
                    except Exception:
                        pass
            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        finally:
            if sess is not None:
                sess.close()
            slot_fh.close()

    response = _Resp(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
    response.call_on_close(slot_fh.close)
    return response


@app.route("/api/ai/evaluate", methods=["POST"])
@_auth.login_required
def ai_evaluate():
    cfg = _get_ai_config()
    if not cfg:
        return jsonify(error="AI 未配置，请点击左下角「设置」按钮进行配置"), 503
    body = request.get_json(silent=True) or {}
    too_large = _reject_large_json(body)
    if too_large:
        return too_large
    prompt = _build_eval_prompt(
        body.get("summary") or {}, body.get("km_stats") or [],
        body.get("filename", ""), body.get("start_time", ""),
        time_stats=body.get("time_stats") or None,
        wind_data=body.get("wind_data") or None,
    )
    return _llm_stream(cfg, prompt)


@app.route("/api/ai/chat", methods=["POST"])
@_auth.login_required
def ai_chat():
    cfg = _get_ai_config()
    if not cfg:
        return jsonify(error="AI 未配置，请点击左下角「设置」按钮进行配置"), 503
    body = request.get_json(silent=True) or {}
    messages = body.get("messages") or []
    if not messages:
        return jsonify(error="消息为空"), 400
    if not isinstance(messages, list) or len(messages) > _MAX_AI_MESSAGES:
        return jsonify(error="消息数量超限"), 400
    total_chars = 0
    for msg in messages:
        if not isinstance(msg, dict) or msg.get('role') not in ('system', 'user', 'assistant'):
            return jsonify(error="消息格式无效"), 400
        content = msg.get('content')
        if not isinstance(content, str):
            return jsonify(error="消息内容必须是文本"), 400
        total_chars += len(content)
    if total_chars > _MAX_AI_TEXT:
        return jsonify(error="消息内容过长"), 413
    return _llm_stream(cfg, messages=messages)


@app.route("/api/ai/compare", methods=["POST"])
@_auth.login_required
def ai_compare():
    cfg = _get_ai_config()
    if not cfg:
        return jsonify(error="AI 未配置，请点击左下角「设置」按钮进行配置"), 503
    body       = request.get_json(silent=True) or {}
    too_large = _reject_large_json(body)
    if too_large:
        return too_large
    activities = body.get("activities") or []
    if not isinstance(activities, list) or len(activities) > 50:
        return jsonify(error="活动数量超限"), 400
    if len(activities) < 2:
        return jsonify(error="至少需要 2 条骑行记录"), 400
    prompt   = _build_compare_prompt(activities)
    override = min(16_000, max(_config_max_tokens(cfg) * 2, 5000))
    return _llm_stream(cfg, prompt, max_tokens_override=override)


@app.route("/api/weather/<path:filename>")
@_auth.login_required
def weather_for_activity(filename: str):
    from fafa.gcj02 import gcj02_to_wgs84
    import requests as _req

    input_dir = _user_input_dir()
    if not filename.lower().endswith(".fit"):
        return jsonify(available=False)

    path = (input_dir / filename).resolve()
    if path.parent != input_dir.resolve():
        return jsonify(error="非法路径"), 403

    _wkey = (str(path), _file_signature(path) if path.exists() else '')
    with _weather_lock:
        if _wkey in _weather_cache:
            entry, exp = _weather_cache[_wkey]
            if time.time() < exp:
                return jsonify(entry)
            del _weather_cache[_wkey]

    try:
        signature = _file_signature(path) if path.exists() else None
        cached = _cache_get(str(path), signature) if signature else None
        if cached is None:
            cached = _disk_cache_load(str(path), signature) if signature else None
        if cached is None:
            cached = _parse_and_build(str(path), filename)
    except Exception as e:
        logging.warning("weather: load failed %s: %s", filename, e)
        return jsonify(available=False)

    coords         = cached.get("coords") or []
    start_time_utc = cached.get("start_time_utc")
    is_gcj02       = cached.get("is_gcj02", False)
    km_stats       = cached.get("km_stats") or []

    if not coords or not start_time_utc:
        return jsonify(available=False)

    lat, lon = coords[0]
    if is_gcj02:
        lat, lon = gcj02_to_wgs84(lat, lon)

    start_dt   = datetime.fromisoformat(start_time_utc.replace("Z", "+00:00"))
    total_s    = sum(s.get("duration_s", 0) for s in km_stats)
    end_dt     = start_dt + timedelta(seconds=max(total_s, 3600))
    start_date = start_dt.strftime("%Y-%m-%d")
    end_date   = end_dt.strftime("%Y-%m-%d")

    try:
        resp = _req.get(
            "https://archive-api.open-meteo.com/v1/archive",
            params={
                "latitude":        round(lat, 6),
                "longitude":       round(lon, 6),
                "start_date":      start_date,
                "end_date":        end_date,
                "hourly":          "windspeed_10m,winddirection_10m,windgusts_10m",
                "wind_speed_unit": "kmh",
                "timezone":        "UTC",
            },
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        logging.warning("weather: Open-Meteo failed %s: %s", filename, e)
        return jsonify(available=False)

    try:
        result = _wind_stats(coords, start_time_utc, km_stats, data.get("hourly", {}))
    except Exception as e:
        logging.warning("weather: _wind_stats failed %s: %s", filename, e)
        return jsonify(available=False)
    if result.get("available"):
        result["start_epoch"] = int(
            datetime.fromisoformat(start_time_utc.replace("Z", "+00:00")).timestamp()
        )
        hourly_raw = data.get("hourly", {})
        result["hourly"] = {
            k: hourly_raw[k]
            for k in ("time", "windspeed_10m", "winddirection_10m")
            if k in hourly_raw
        }
    with _weather_lock:
        if len(_weather_cache) >= _WEATHER_MAX:
            oldest = next(iter(_weather_cache))
            del _weather_cache[oldest]
        _weather_cache[_wkey] = (result, time.time() + _WEATHER_TTL_S)
    return jsonify(result)


# ── 活动列表（PMC 数据源） ────────────────────────────────────────────────────
@app.route("/api/activities")
@_auth.login_required
def get_activities():
    """返回用户 input/<username>/ 中所有 FIT 文件的轻量摘要，供 PMC 页面计算使用。"""
    input_dir = _user_input_dir()
    db_path   = _user_db_path()
    if not input_dir.exists():
        return jsonify(activities=[])

    paths = _library_fit_paths(input_dir)
    input_dir_key = str(input_dir)
    total_count = len(paths)

    with _parse_state_lock:
        _parse_states[input_dir_key] = {"state": "parsing", "total": total_count, "done": 0}

    def _load_one(path):
        path_str = str(path)
        try:
            signature = _file_signature(path)
            cached = _cache_get(path_str, signature)
            if not cached:
                cached = _disk_cache_load(path_str, signature)
                if cached:
                    _cache_put(path_str, signature, cached)
                else:
                    cached = _parse_and_build(path_str, path.name)
            ts_start = cached.get("time_stats_start")
            if not ts_start:
                return None
            summary = cached.get("summary") or {}
            return {
                "filename":    path.name,
                "date":        ts_start[:10],
                "start_time":  ts_start,
                "summary":     {k: v for k, v in summary.items() if v is not None},
                "peak_power":  cached.get("peak_power") or {},
                "zone_time_s": cached.get("zone_time_s"),
            }
        except Exception as e:
            logging.warning("activities: %s: %s", path.name, e)
            return None
        finally:
            with _parse_state_lock:
                st = _parse_states.get(input_dir_key)
                if st and st["state"] == "parsing":
                    st["done"] += 1

    items = list(_activity_executor.map(_load_one, paths))

    with _parse_state_lock:
        _parse_states[input_dir_key] = {"state": "idle", "total": total_count, "done": total_count}

    all_tags = _db.get_all_activity_tags(db_path=db_path)
    result = sorted(
        (x for x in items if x is not None),
        key=lambda a: a["start_time"],
        reverse=True,
    )
    for a in result:
        a["tags"] = all_tags.get(a["filename"], [])
    return jsonify(activities=result)


@app.route("/api/parse/status")
@_auth.login_required
def parse_status():
    """返回当前用户 FIT 文件解析进度（供活动列表加载时前端轮询）。"""
    key = str(_user_input_dir())
    with _parse_state_lock:
        st = _parse_states.get(key, {"state": "idle", "total": 0, "done": 0})
        return jsonify(**st)


# ── AI PMC 体能分析 ───────────────────────────────────────────────────────────
def _build_pmc_prompt(data: dict) -> str:
    cur    = data.get("current", {})
    trend  = data.get("trend", {})
    rides  = data.get("recent_rides", [])
    cfg_u  = data.get("settings", {})

    ctl = cur.get("ctl", 0)
    atl = cur.get("atl", 0)
    tsb = cur.get("tsb", 0)

    if tsb > 10:
        form_str = "新鲜（Fresh）— 体力充沛，适合比赛或高强度训练"
    elif tsb > -5:
        form_str = "最佳区间（Optimal）— 训练与恢复平衡，黄金训练期"
    elif tsb > -20:
        form_str = "疲劳（Tired）— 有训练负荷积累，建议控制强度"
    elif tsb > -40:
        form_str = "较疲劳（Very Tired）— 需要主动恢复"
    else:
        form_str = "过度疲劳（Overreached）— 建议安排休息日"

    lines = [
        "你是一名专业公路自行车训练教练，请根据以下训练管理图（PMC）数据进行体能状态分析，给出恢复与训练建议，用中文输出。",
        "",
        "## 当前 PMC 状态",
        f"- 体能 CTL（42天慢性训练负荷）：**{ctl:.1f}**",
        f"- 疲劳 ATL（7天急性训练负荷）：**{atl:.1f}**",
        f"- 状态 TSB（今日形态 = 昨日CTL − 昨日ATL）：**{tsb:+.1f}**",
        f"- 形态判定：**{form_str}**",
    ]

    if cfg_u.get("ftp"):
        lines.append(f"- FTP：{cfg_u['ftp']} W")
    if cfg_u.get("weight_kg"):
        lines.append(f"- 体重：{cfg_u['weight_kg']} kg")
    if cfg_u.get("wkg"):
        lines.append(f"- 功重比：{cfg_u['wkg']} W/kg")

    ctl_7d = trend.get("ctl_7d_ago", ctl)
    ctl_30d = trend.get("ctl_30d_ago", ctl)
    lines += [
        f"- CTL 7天前：{ctl_7d:.1f}（变化 {ctl - ctl_7d:+.1f}）",
        f"- CTL 30天前：{ctl_30d:.1f}（变化 {ctl - ctl_30d:+.1f}）",
        f"- 数据覆盖：{data.get('total_activities', 0)} 次骑行，最早记录 {data.get('first_date', '—')}",
    ]
    if data.get("zone_distribution"):
        lines += ["", f"## 训练区间分布（骑行时间占比）", data["zone_distribution"]]
    if data.get("power_curve_alltime"):
        lines += ["", "## 峰值功率曲线", f"- 历史最佳：{data['power_curve_alltime']}"]
        if data.get("power_curve_90d"):
            lines.append(f"- 近90天最佳：{data['power_curve_90d']}")

    if rides:
        lines += ["", f"## 近期骑行记录（最近 {len(rides)} 次）",
                  "日期 | 距离 | 时长 | TSS | 均心率 | 均功率"]
        lines.append("-----|------|------|-----|-------|------")
        for r in rides:
            def _rv(k, fmt="{:.0f}", fb="—"):
                v = r.get(k)
                return fb if v is None else fmt.format(v)
            lines.append(
                f"{r.get('date','?')} | {_rv('dist_km','{:.1f}')} km | "
                f"{_rv('dur_min')} min | {_rv('tss')} | "
                f"{_rv('avg_hr')} bpm | {_rv('avg_power')} W"
            )

    lines += [
        "",
        "## 请输出以下分析（Markdown格式，简洁专业）：",
        "### 1. 当前状态解读",
        "解读CTL/ATL/TSB数值，说明当前体能与疲劳水平。",
        "### 2. 疲劳与恢复评估",
        "当前是否过度训练？需要休息还是可以继续？",
        "### 3. 近期训练模式分析",
        "从近期数据看训练规律、强度分布、是否有明显规律或问题。",
        "### 4. 近期建议（1-2周）",
        "具体的训练安排：强度、量、休息日。",
        "### 5. 中期目标（1-3个月）",
        "如何合理提升CTL？建议目标区间和提升节奏（每周CTL增幅不超过3-5）。",
    ]
    return "\n".join(lines)


@app.route("/api/ai/pmc", methods=["POST"])
@_auth.login_required
def ai_pmc():
    cfg = _get_ai_config()
    if not cfg:
        return jsonify(error="AI 未配置，请点击左下角「设置」按钮进行配置"), 503
    data   = request.get_json(silent=True) or {}
    too_large = _reject_large_json(data)
    if too_large:
        return too_large
    prompt = _build_pmc_prompt(data)
    return _llm_stream(cfg, prompt)


def _build_calendar_prompt(data: dict) -> str:
    period       = data.get("period", "30d")
    current_date = data.get("current_date", "")
    acts         = data.get("activities", [])
    period_label = "过去7天" if period == "7d" else "过去30天"

    def fmt(v, unit="", digits=1):
        return "无数据" if v is None else f"{round(v, digits)}{unit}"

    total_dist = sum((a.get("dist_km") or 0) for a in acts)
    total_dur  = sum((a.get("dur_min") or 0) for a in acts)
    total_elev = sum((a.get("elevation_m") or 0) for a in acts)

    lines = [
        f"你是一名专业公路自行车训练教练，请根据用户{period_label}的骑行数据，给出个性化的训练建议，用中文输出。",
        "",
        "## 训练概况",
        f"- 当前日期：{current_date}",
        f"- 统计范围：{period_label}",
        f"- 骑行次数：{len(acts)} 次",
        f"- 总距离：{total_dist:.1f} km",
        f"- 总时长：{total_dur:.0f} 分钟",
        f"- 总爬升：{total_elev:.0f} m",
    ]

    if acts:
        lines += [
            "",
            "## 骑行记录",
            "日期 | 距离 | 时长 | 均心率 | 均功率 | 爬升",
            "-----|------|------|-------|-------|------",
        ]
        def _rv(v, f="{:.0f}", fb="—"):
            return fb if v is None else f.format(v)
        for a in sorted(acts, key=lambda x: x.get("date", "")):
            lines.append(
                f"{a.get('date','?')} | {_rv(a.get('dist_km'), '{:.1f}')} km | "
                f"{_rv(a.get('dur_min'))} min | {_rv(a.get('avg_hr'))} bpm | "
                f"{_rv(a.get('avg_power'))} W | {_rv(a.get('elevation_m'))} m"
            )
    else:
        lines.append("（该时间段内无骑行记录）")

    lines += ["", "## 请输出以下分析（Markdown格式，简洁专业）："]

    if period == "7d":
        lines += [
            "### 1. 本周训练总结",
            "评估本周训练量、强度、频率是否合理。",
            "### 2. 恢复状态",
            "根据本周负荷判断疲劳程度，是否需要安排恢复日。",
            "### 3. 下周训练建议",
            "给出具体的下周训练安排（哪几天训练、休息日、重点训练类型）。",
        ]
    else:
        lines += [
            "### 1. 过去一个月训练回顾",
            "总结训练量、强度分布、训练规律性。",
            "### 2. 进步与不足",
            "从数据中找出亮点和需要改进的地方。",
            "### 3. 接下来四周训练建议",
            "给出分周的具体训练建议（量、强度、重点训练类型）。",
            "### 4. 短期目标",
            "基于当前水平，设定合理可达的月度目标。",
        ]
    return "\n".join(lines)


@app.route("/api/ai/calendar", methods=["POST"])
@_auth.login_required
def ai_calendar():
    cfg = _get_ai_config()
    if not cfg:
        return jsonify(error="AI 未配置，请点击左下角「设置」按钮进行配置"), 503
    data   = request.get_json(silent=True) or {}
    too_large = _reject_large_json(data)
    if too_large:
        return too_large
    prompt = _build_calendar_prompt(data)
    return _llm_stream(cfg, prompt)


# ── Strava ───────────────────────────────────────────────────────────────────

_strava_lock = threading.Lock()  # 进程内写锁


def _strava_state_path(input_dir: Path) -> Path:
    return input_dir / '.strava_upload_state.json'


def _strava_lock_path(input_dir: Path) -> Path:
    return input_dir / '.strava_upload.lock'


def _try_acquire_strava_flock(input_dir: Path):
    """尝试获取 Strava 上传文件锁，成功返回句柄，已被占用返回 None。"""
    lock_path = _strava_lock_path(input_dir)
    try:
        fh = open(lock_path, 'w')
        fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return fh
    except (IOError, OSError):
        try:
            fh.close()
        except Exception:
            pass
        return None


def _read_strava_state(input_dir: Path) -> dict:
    f = _strava_state_path(input_dir)
    try:
        if f.exists():
            return json.loads(f.read_text(encoding='utf-8'))
    except Exception:
        pass
    return {"state": "idle", "current": "", "done": 0, "total": 0, "results": []}


def _write_strava_state(input_dir: Path, state: dict) -> None:
    try:
        state['updated_at'] = int(time.time())
        _atomic_write_json(_strava_state_path(input_dir), state)
    except Exception as e:
        logging.warning('strava state write failed: %s', e)


def _run_strava_upload(username: str, input_dir: Path, config_file: Path,
                       filenames: list[str], force: bool):
    with _strava_lock:
        _write_strava_state(input_dir, {"state": "uploading", "current": "", "done": 0,
                                        "total": len(filenames), "results": []})

    def on_progress(filename, done, total):
        with _strava_lock:
            st = _read_strava_state(input_dir)
            st["current"] = filename
            st["done"] = done
            _write_strava_state(input_dir, st)

    try:
        summary = _strava.upload_files(filenames, force=force, progress_cb=on_progress,
                                       input_dir=input_dir, config_file=config_file)
        with _strava_lock:
            st = _read_strava_state(input_dir)
            _write_strava_state(input_dir, {**st, "state": "done", "done": len(filenames), **summary})
    except Exception as e:
        kind, _ = _strava.classify_error(str(e))
        with _strava_lock:
            st = _read_strava_state(input_dir)
            _write_strava_state(input_dir, {**st, "state": "error", "error": str(e), "auth_error": kind == "auth"})


@app.route("/strava/callback")
@_auth.login_required
def strava_callback():
    code  = request.args.get("code", "")
    state = request.args.get("state", "")
    error = request.args.get("error", "")
    if error:
        return f"<html><body><p>授权被拒绝: {_html_escape(error)}</p><script>setTimeout(()=>window.close(),3000)</script></body></html>", 400
    if not code:
        return "<html><body><p>未收到授权码</p></body></html>", 400
    expected = session.pop('strava_oauth_state', None)
    if not expected or not secrets.compare_digest(expected, state):
        return "<html><body><p>无效的 OAuth state，请重新授权</p></body></html>", 400
    try:
        info = _strava.exchange_code(code, config_file=_user_config_file())
        name = _html_escape(info.get("athlete_name") or "未知")
        return (
            f"<html><body><p>Strava 授权成功！账号: {name}</p>"
            f"<p>此页面将自动关闭...</p>"
            f"<script>try{{if(window.opener)window.opener.postMessage('fafa-strava-auth-ok',window.location.origin)}}catch(e){{}}"
            f"setTimeout(()=>window.close(),2000)</script></body></html>"
        )
    except Exception as e:
        logging.warning('Strava OAuth callback failed: %s', e)
        return "<html><body><p>授权失败，请重新授权</p></body></html>", 500


@app.route("/api/strava/status")
@_auth.login_required
def strava_status():
    cfg = _strava.load_config(config_file=_user_config_file())
    if not cfg:
        return jsonify(configured=False, has_tokens=False)
    return jsonify(
        configured=True,
        has_tokens=bool(cfg["refresh_token"]),
        athlete_name=cfg["athlete_name"],
        athlete_id=cfg["athlete_id"],
    )


@app.route("/api/strava/diff")
@_auth.login_required
def strava_diff():
    """Compare local FIT files against Strava activities by start time (±60 s).

    Returns {to_upload, local_count, strava_count, match_count}.
    """
    input_dir   = _user_input_dir()
    config_file = _user_config_file()
    try:
        token = _strava.get_access_token(config_file=config_file)
    except Exception as e:
        kind, _ = _strava.classify_error(str(e))
        return jsonify(error=str(e), auth_error=kind == "auth"), 400

    try:
        strava_acts = _strava.fetch_all_activities(token)
    except Exception as e:
        kind, _ = _strava.classify_error(str(e))
        return jsonify(error=f"获取 Strava 活动列表失败：{e}",
                       auth_error=kind == "auth"), 502

    strava_external_ids = {a["external_id"] for a in strava_acts if a["external_id"]}
    strava_times = sorted(a["start_unix"] for a in strava_acts)

    paths = _library_fit_paths(input_dir)
    to_upload: list[str] = []
    match_count = 0

    for path in paths:
        try:
            if path.name in strava_external_ids:
                match_count += 1
                continue

            signature = _file_signature(path)
            cached = _cache_get(str(path), signature) or _disk_cache_load(str(path), signature)
            ts_utc = (cached or {}).get("start_time_utc")
            if not ts_utc:
                fit = _parse_fit_safe(str(path))
                if fit.records and fit.records[0].timestamp:
                    ts_utc = fit.records[0].timestamp.strftime("%Y-%m-%dT%H:%M:%SZ")
            if not ts_utc:
                to_upload.append(path.name)
                continue
            local_unix = int(datetime.fromisoformat(ts_utc.replace("Z", "+00:00")).timestamp())
            lo = bisect.bisect_left(strava_times, local_unix - 60)
            hi = bisect.bisect_right(strava_times, local_unix + 60)
            if lo < hi:
                match_count += 1
            else:
                to_upload.append(path.name)
        except Exception as e:
            logging.warning("strava_diff: %s: %s", path.name, e)

    return jsonify(
        to_upload=sorted(to_upload),
        local_count=len(paths),
        strava_count=len(strava_acts),
        match_count=match_count,
    )


@app.route("/api/strava/auth_url", methods=["POST"])
@_auth.login_required
def strava_auth_url():
    try:
        redirect_uri = url_for("strava_callback", _external=True)
        state_val = secrets.token_urlsafe(32)
        url = _strava.build_auth_url(
            redirect_uri=redirect_uri,
            config_file=_user_config_file(),
            state_token=state_val,
        )
        session['strava_oauth_state'] = state_val
        return jsonify(url=url)
    except Exception as e:
        return jsonify(error=str(e)), 400


@app.route("/api/strava/upload", methods=["POST"])
@_auth.login_required
def strava_upload():
    input_dir = _user_input_dir()
    flock_fh = _try_acquire_strava_flock(input_dir)
    if flock_fh is None:
        return jsonify(error="上传正在进行中"), 409
    global_slot_fh = _try_acquire_slot('sync', _SYNC_SLOTS)
    if global_slot_fh is None:
        flock_fh.close()
        return jsonify(error='服务器后台任务繁忙，请稍后重试'), 429

    body = request.get_json(silent=True) or {}
    filenames = body.get("filenames", [])
    try:
        force = _json_bool(body, 'force')
    except ValueError as e:
        flock_fh.close()
        global_slot_fh.close()
        return jsonify(error=str(e)), 400
    try:
        _validate_string_list(filenames, max_items=_MAX_BATCH_FILES, field='filenames')
    except ValueError as e:
        flock_fh.close()
        global_slot_fh.close()
        return jsonify(error=str(e)), 400
    if not filenames:
        flock_fh.close()
        global_slot_fh.close()
        return jsonify(error="未指定文件"), 400
    validated_filenames = []
    seen = set()
    for filename in filenames:
        path = _validate_filename_in_input(filename, input_dir)
        if path is None or not path.is_file():
            flock_fh.close()
            global_slot_fh.close()
            return jsonify(error=f"无效或不存在的文件: {filename}"), 400
        if filename not in seen:
            validated_filenames.append(filename)
            seen.add(filename)
    filenames = validated_filenames

    config_file = _user_config_file()
    username = g.username

    def _run_and_release_strava(fh, slot_fh):
        try:
            _run_strava_upload(username, input_dir, config_file, filenames, force)
        finally:
            try:
                fh.close()
            except Exception:
                pass
            slot_fh.close()

    t = threading.Thread(target=_run_and_release_strava, args=(flock_fh, global_slot_fh), daemon=False)
    try:
        t.start()
    except Exception:
        flock_fh.close()
        global_slot_fh.close()
        raise
    return jsonify(ok=True)


@app.route("/api/strava/upload/status")
@_auth.login_required
def strava_upload_status():
    return jsonify(**_read_strava_state(_user_input_dir()))


# ── 活动元数据（备注 + 标签） ─────────────────────────────────────────────────

@app.route("/api/meta/<path:filename>")
@_auth.login_required
def get_meta(filename):
    path = _validate_filename_in_input(filename, _user_input_dir())
    if path is None or not path.is_file():
        return jsonify(error="invalid filename"), 400
    return jsonify(**_db.get_activity_meta(filename, db_path=_user_db_path()))


@app.route("/api/meta/<path:filename>/note", methods=["POST"])
@_auth.login_required
def save_note(filename):
    input_dir = _user_input_dir()
    path = _validate_filename_in_input(filename, input_dir)
    if path is None or not path.is_file():
        return jsonify(error="invalid filename"), 400
    body = request.get_json(silent=True) or {}
    note = body.get("note", "")
    if not isinstance(note, str) or len(note) > _MAX_NOTE_CHARS:
        return jsonify(error="note too long"), 413
    _db.save_note(filename, note, db_path=_user_db_path())
    return jsonify(ok=True)


@app.route("/api/meta/<path:filename>/tags", methods=["POST"])
@_auth.login_required
def save_tags(filename):
    input_dir = _user_input_dir()
    path = _validate_filename_in_input(filename, input_dir)
    if path is None or not path.is_file():
        return jsonify(error="invalid filename"), 400
    body = request.get_json(silent=True) or {}
    tag_ids = body.get("tag_ids", [])
    if not isinstance(tag_ids, list) or len(tag_ids) > _MAX_TAG_IDS:
        return jsonify(error="tag_ids must be a list"), 400
    if not all(isinstance(t, int) and not isinstance(t, bool) for t in tag_ids):
        return jsonify(error="tag_ids must be integers"), 400
    try:
        _db.save_tags(filename, tag_ids, db_path=_user_db_path())
    except ValueError as e:
        return jsonify(error=str(e)), 400
    return jsonify(ok=True)


@app.route("/api/meta/batch/tags", methods=["POST"])
@_auth.login_required
def batch_save_tags():
    db_path = _user_db_path()
    body = request.get_json(silent=True) or {}
    filenames    = body.get("filenames", [])
    add_ids      = body.get("add_tag_ids", [])
    remove_ids   = body.get("remove_tag_ids", [])
    if not isinstance(filenames, list) or not isinstance(add_ids, list) or not isinstance(remove_ids, list):
        return jsonify(error="filenames, add_tag_ids, remove_tag_ids must be lists"), 400
    if len(filenames) > _MAX_BATCH_FILES or len(add_ids) > _MAX_TAG_IDS or len(remove_ids) > _MAX_TAG_IDS:
        return jsonify(error="batch too large"), 413
    if not all(isinstance(t, int) and not isinstance(t, bool) for t in add_ids + remove_ids):
        return jsonify(error="tag ids must be integers"), 400
    if set(add_ids) & set(remove_ids):
        return jsonify(error="add_tag_ids and remove_tag_ids must not overlap"), 400
    if not add_ids and not remove_ids:
        return jsonify(ok=True, updated=0)
    try:
        _db.validate_tag_ids(set(add_ids) | set(remove_ids), db_path=db_path)
    except ValueError as e:
        return jsonify(error=str(e)), 400
    valid_filenames = []
    seen_filenames = set()
    input_dir = _user_input_dir()
    for filename in filenames:
        if not isinstance(filename, str) or filename in seen_filenames:
            continue
        path = _validate_filename_in_input(filename, input_dir)
        if path is None or not path.is_file():
            continue
        valid_filenames.append(filename)
        seen_filenames.add(filename)
    updated = _db.batch_update_tags(
        valid_filenames, set(add_ids), set(remove_ids), db_path=db_path,
    )
    return jsonify(ok=True, updated=updated)


@app.route("/api/tags")
@_auth.login_required
def list_tags():
    return jsonify(tags=_db.get_all_tags(db_path=_user_db_path()))


@app.route("/api/tags", methods=["POST"])
@_auth.login_required
def create_tag():
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    color = (body.get("color") or "#888888").strip()
    if not name:
        return jsonify(error="name required"), 400
    if len(name) > _MAX_TAG_NAME or not re.fullmatch(r'#[0-9A-Fa-f]{6}', color):
        return jsonify(error="invalid tag name or color"), 400
    try:
        tag = _db.create_tag(name, color, db_path=_user_db_path())
        return jsonify(tag=tag), 201
    except ValueError as e:
        return jsonify(error=str(e)), 409


@app.route("/api/tags/<int:tag_id>", methods=["DELETE"])
@_auth.login_required
def delete_tag(tag_id):
    ok = _db.delete_tag(tag_id, db_path=_user_db_path())
    if not ok:
        return jsonify(error="preset tags cannot be deleted"), 403
    return jsonify(ok=True)


if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    level = logging.DEBUG if debug else logging.INFO
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(message)s")
    mode_label = "server (multi-user)" if SERVER_MODE else "local (single-user)"
    logging.info("Starting FAFA in %s mode", mode_label)
    host = _bind_host()
    port = int(os.environ.get("FAFA_PORT", "5173"))
    app.run(debug=debug, host=host, port=port)
