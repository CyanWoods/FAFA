#!/usr/bin/env python3
"""FAFA Track Viewer — Flask 开发服务器

启动:
    .venv/bin/python app.py
然后访问 http://localhost:5173
"""

import io
import json
import logging
import os
import re
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

from flask import Flask, render_template, request, jsonify, send_file

from fafa.parser import parse_fit
from fafa.gcj02 import needs_wgs84_conversion
from fafa.stats import compute_km_stats, compute_dist_stats, compute_time_stats, compute_summary

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50 MB

PROJECT_ROOT   = Path(__file__).parent
INPUT_DIR      = PROJECT_ROOT / "input"
STATE_FILE     = PROJECT_ROOT / "download_state.json"
SEMICIRCLE_TO_DEG = 180.0 / (2 ** 31)

# ── 解析结果缓存（按文件路径+mtime） ───────────────────────────────────────────
_parse_cache: dict[str, dict] = {}  # path_str -> {'mtime': float, 'data': dict}
_cache_lock  = threading.Lock()
_CACHE_MAX   = 300


def _cache_get(path_str: str, mtime: float) -> dict | None:
    with _cache_lock:
        entry = _parse_cache.get(path_str)
        if entry and entry["mtime"] == mtime:
            return entry["data"]
    return None


def _cache_put(path_str: str, mtime: float, data: dict) -> None:
    with _cache_lock:
        if len(_parse_cache) >= _CACHE_MAX:
            # 淘汰最旧的 50 条
            old_keys = list(_parse_cache.keys())[:50]
            for k in old_keys:
                _parse_cache.pop(k, None)
        _parse_cache[path_str] = {"mtime": mtime, "data": data}


# ── 通用 FIT 解析 ──────────────────────────────────────────────────────────────
def _parse_and_build(fit_path: str, filename: str) -> dict:
    p = Path(fit_path)
    if p.exists():
        try:
            mtime = p.stat().st_mtime
            cached = _cache_get(fit_path, mtime)
            if cached is not None:
                return cached
        except OSError:
            pass

    fit      = parse_fit(fit_path)
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
        time_stats_start = (
            fit.records[0].timestamp.strftime("%Y-%m-%dT%H:%M:%S")
            if fit.records else None
        )
    except Exception as e:
        logging.warning("计算 time_stats 失败 (%s): %s", filename, e)
        time_stats_list  = []
        time_stats_start = None

    result = dict(
        coords=coords,
        filename=filename,
        is_gcj02=not needs_wgs84_conversion(fit.manufacturer),
        summary=summary_dict,
        km_stats=km_stats_list,
        dist_stats=dist_stats_list,
        time_stats=time_stats_list,
        time_stats_start=time_stats_start,
    )

    p2 = Path(fit_path)
    if p2.exists():
        try:
            _cache_put(fit_path, p2.stat().st_mtime, result)
        except OSError:
            pass

    return result


# ── 同步状态（全局，被后台线程写、前端轮询读） ─────────────────────────────────
_sync_lock = threading.Lock()
_sync: dict = {
    "state":     "idle",   # idle | login | fetching | downloading | done | error
    "message":   "",
    "total":     0,
    "done":      0,
    "new_files": [],
}


def _set_sync(**kw):
    with _sync_lock:
        _sync.update(kw)


_MAX_DL_WORKERS = 3


def _run_sync(full: bool, limit: int | None):
    """后台线程：登录顽鹿 → 拉取列表 → 并发下载 FIT。"""
    from fafa.onelap import (
        browser_login, build_session, fetch_activity_list,
        download_activity, rename_magene, latest_local_time, parse_activity_time, activity_id,
    )
    from fafa.tools.fix_coords import auto_decrypt_if_gcj02

    def load_state():
        if STATE_FILE.exists():
            try:
                return json.loads(STATE_FILE.read_text(encoding="utf-8"))
            except Exception:
                pass
        return {}

    def save_state(st):
        STATE_FILE.write_text(json.dumps(st, ensure_ascii=False, indent=2), encoding="utf-8")

    try:
        _set_sync(state="login", message="请在弹出的浏览器窗口中登录顽鹿账号…", total=0, done=0, new_files=[])

        try:
            auth = browser_login()
        except Exception as e:
            _set_sync(state="error", message=f"登录失败：{e}")
            return

        state = {} if full else load_state()
        if state and not any(INPUT_DIR.glob("*.fit")):
            state = {}
        skip_ids = set(state.keys())
        cutoff   = None if full else latest_local_time(INPUT_DIR)
        sess     = build_session(auth["token"], auth["cookies"])

        _set_sync(state="fetching", message="正在获取活动列表…")

        def on_page(pg, col, tot):
            _set_sync(message=f"获取列表：第 {pg} 页，已找到 {col} 条新活动")

        activities = fetch_activity_list(sess, skip_ids, cutoff, limit, on_page=on_page)

        if not activities:
            _set_sync(state="done", message="没有新活动需要下载", total=0, done=0)
            return

        total = len(activities)
        _set_sync(state="downloading", message=f"共 {total} 个活动，开始下载…", total=total, done=0)

        new_files: list[str] = []
        done_count = 0
        dl_lock    = threading.Lock()

        def _download_one(act: dict) -> tuple[Path | None, str]:
            rid  = activity_id(act)
            t    = parse_activity_time(act)
            tstr = t.strftime("%Y-%m-%d %H:%M") if t else rid
            # 如果活动已在 state 中标记为已下载，直接走 download_activity 的早返回路径，
            # 无需再做 decrypt/rename（上次同步时已处理）。
            already_done = bool(state.get(rid, {}).get("downloaded"))
            try:
                path = download_activity(sess, act, state, INPUT_DIR,
                                         skip_rename=not already_done)
                if path and not already_done:
                    # 仅对本次实际下载的文件执行：单次 FIT 解析完成版本检查+解密+提取型号
                    is_fresh = state.get(rid, {}).get("downloaded_at") is not None
                    if is_fresh:
                        try:
                            ver, model = auto_decrypt_if_gcj02(path)
                            new_path   = rename_magene(path, model=model)
                            if new_path != path:
                                state[rid]["filename"] = new_path.name
                            path = new_path
                            if ver is not None and ver > 18:
                                tstr = f"{tstr} — 已自动火星解密（版本 {ver:.0f}）"
                        except Exception as e:
                            logging.warning("自动火星解密失败 (%s): %s", path.name, e)
                return path, tstr
            except Exception as e:
                logging.warning("下载 %s 失败: %s", tstr, e)
                return None, tstr

        with ThreadPoolExecutor(max_workers=_MAX_DL_WORKERS) as pool:
            futures = {pool.submit(_download_one, act): act for act in activities}
            for future in as_completed(futures):
                path, msg = future.result()
                with dl_lock:
                    done_count += 1
                    dc = done_count
                    if path:
                        new_files.append(path.name)
                _set_sync(message=f"[{dc}/{total}] {msg}", done=dc, new_files=list(new_files))

        save_state(state)
        _set_sync(
            state="done",
            message=f"同步完成，新增 {len(new_files)} 个文件",
            done=total,
            new_files=new_files,
        )

    except Exception as e:
        _set_sync(state="error", message=f"同步出错：{e}")


# ── 路由：原有功能 ─────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/upload", methods=["POST"])
def upload():
    f = request.files.get("file")
    if not f:
        return jsonify(error="未收到文件"), 400
    if not f.filename.lower().endswith(".fit"):
        return jsonify(error="请上传 .fit 格式文件"), 400

    with tempfile.NamedTemporaryFile(suffix=".fit", delete=False) as tmp:
        f.save(tmp.name)
        tmp_path = tmp.name

    try:
        data = _parse_and_build(tmp_path, f.filename)
    except ValueError as e:
        return jsonify(error=str(e)), 422
    except Exception as e:
        return jsonify(error=f"解析失败: {e}"), 422
    finally:
        os.unlink(tmp_path)

    return jsonify(**data, source="upload")


# ── 路由：文件库 ──────────────────────────────────────────────────────────────
@app.route("/api/files")
def list_files():
    """列出 input/ 目录下所有 .fit 文件（按修改时间倒序）。"""
    if not INPUT_DIR.exists():
        return jsonify(files=[])

    files = []
    for p in sorted(INPUT_DIR.glob("*.fit"), key=lambda x: x.stat().st_mtime, reverse=True):
        st = p.stat()
        files.append({
            "filename": p.name,
            "size_kb":  round(st.st_size / 1024, 1),
            "mtime":    st.st_mtime,
        })
    return jsonify(files=files)


@app.route("/api/files/delete_all", methods=["POST"])
def delete_all_files():
    """删除 input/ 目录下所有 .fit 文件。"""
    if not INPUT_DIR.exists():
        return jsonify(deleted=0)
    deleted = 0
    for p in INPUT_DIR.glob("*.fit"):
        try:
            p.unlink()
            deleted += 1
        except Exception:
            pass
    return jsonify(deleted=deleted)


@app.route("/api/load", methods=["POST"])
def load_file():
    """从 input/ 目录加载指定文件（安全检查：只允许加载 input/ 内的 .fit）。"""
    body = request.get_json(silent=True) or {}
    filename = body.get("filename", "")

    if not filename or not filename.lower().endswith(".fit"):
        return jsonify(error="无效的文件名"), 400

    path = (INPUT_DIR / filename).resolve()
    if path.parent != INPUT_DIR.resolve():
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


# ── 路由：坐标写回 ─────────────────────────────────────────────────────────────
@app.route("/api/fix_coords", methods=["POST"])
def fix_coords_api():
    body     = request.get_json(silent=True) or {}
    filename = body.get("filename", "")
    method   = body.get("method", "")

    if not filename or not filename.lower().endswith(".fit"):
        return jsonify(error="无效的文件名"), 400
    if method not in ("decrypt", "encrypt"):
        return jsonify(error="method 必须是 decrypt 或 encrypt"), 400

    path = (INPUT_DIR / filename).resolve()
    if path.parent != INPUT_DIR.resolve():
        return jsonify(error="非法路径"), 403
    if not path.exists():
        return jsonify(error="文件不存在"), 404

    try:
        from fafa.tools.fix_coords import fix_file
        original_mtime = path.stat().st_mtime
        fix_file(path, path, method)
        os.utime(path, (original_mtime, original_mtime))
        return jsonify(ok=True)
    except Exception as e:
        return jsonify(error=f"坐标转换失败: {e}"), 500


# ── 路由：全量导出 JSON ────────────────────────────────────────────────────────
@app.route("/api/export/all")
def export_all():
    """导出 input/ 下所有 FIT 文件的解析结果为 JSON 文件（供 AI 使用）。"""
    no_km = request.args.get("no_km_stats", "0") == "1"
    try:
        min_km = float(request.args.get("min_km", "0") or "0")
    except ValueError:
        return jsonify(error="min_km 参数无效"), 400

    if not INPUT_DIR.exists():
        return jsonify(error="input/ 目录不存在"), 404

    def _strip_nulls(obj):
        if isinstance(obj, dict):
            return {k: _strip_nulls(v) for k, v in obj.items() if v is not None}
        if isinstance(obj, list):
            return [_strip_nulls(i) for i in obj]
        return obj

    fit_files = sorted(INPUT_DIR.glob("*.fit"))
    activities = []

    for path in fit_files:
        try:
            fit      = parse_fit(str(path))
            km_stats = compute_km_stats(fit)
            summary  = compute_summary(fit, km_stats)
        except Exception as e:
            logging.warning("export_all 解析失败 (%s): %s", path.name, e)
            continue

        if not fit.records:
            continue

        summary_d = asdict(summary)
        if min_km > 0 and (summary_d.get("total_dist_km") or 0) < min_km:
            continue

        # 从文件名提取日期，降级到第一条记录
        m = re.match(r"Magene_C506_(\d{8}-\d{6})_", path.name)
        if m:
            date_str = datetime.strptime(m.group(1), "%Y%m%d-%H%M%S").strftime("%Y-%m-%dT%H:%M:%S")
        else:
            try:
                date_str = fit.records[0].timestamp.strftime("%Y-%m-%dT%H:%M:%S")
            except Exception:
                date_str = None

        entry = {"filename": path.name, "date": date_str, "summary": summary_d}
        if not no_km:
            entry["km_stats"] = [asdict(s) for s in km_stats]

        entry = _strip_nulls(entry)
        entry["filename"] = path.name
        if date_str:
            entry["date"] = date_str
        activities.append(entry)

    activities.sort(key=lambda a: a.get("date") or "")

    total_km = sum((a.get("summary", {}).get("total_dist_km") or 0) for a in activities)
    dates    = [a["date"][:10] for a in activities if a.get("date")]

    result = {
        "meta": {
            "exported_at":       datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
            "total_activities":  len(activities),
            "total_km":          round(total_km, 2),
            "date_range":        [dates[0], dates[-1]] if dates else [],
            "includes_km_stats": not no_km,
        },
        "activities": activities,
    }

    buf = io.BytesIO(json.dumps(result, ensure_ascii=False, indent=2, default=str).encode("utf-8"))
    buf.seek(0)
    return send_file(
        buf,
        mimetype="application/json",
        as_attachment=True,
        download_name="fafa_export.json",
    )


# ── 路由：顽鹿同步 ────────────────────────────────────────────────────────────
@app.route("/api/onelap/sync", methods=["POST"])
def onelap_sync():
    with _sync_lock:
        if _sync["state"] in ("login", "fetching", "downloading"):
            return jsonify(error="同步正在进行中"), 409

    body  = request.get_json(silent=True) or {}
    full  = bool(body.get("full", False))
    limit = body.get("limit")
    if limit is not None:
        try:
            limit = int(limit)
        except (TypeError, ValueError):
            limit = None

    t = threading.Thread(target=_run_sync, args=(full, limit), daemon=True)
    t.start()
    return jsonify(ok=True)


@app.route("/api/onelap/status")
def onelap_status():
    with _sync_lock:
        return jsonify(**_sync)


if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    app.run(debug=debug, port=5173)
