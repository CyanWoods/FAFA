#!/usr/bin/env python3
"""FAFA Track Viewer — Flask 开发服务器

启动:
    .venv/bin/python app.py
然后访问 http://localhost:5173
"""

import json
import os
import tempfile
import threading
import time
from dataclasses import asdict
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


# ── 通用 FIT 解析 ──────────────────────────────────────────────────────────────
def _parse_and_build(fit_path: str, filename: str) -> dict:
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
    except Exception:
        summary_dict  = None
        km_stats_list = []

    try:
        dist_stats_list = [asdict(s) for s in compute_dist_stats(fit)]
    except Exception:
        dist_stats_list = []

    try:
        time_stats_list = [asdict(s) for s in compute_time_stats(fit)]
        time_stats_start = (
            fit.records[0].timestamp.strftime("%Y-%m-%dT%H:%M:%S")
            if fit.records else None
        )
    except Exception:
        time_stats_list  = []
        time_stats_start = None

    return dict(
        coords=coords,
        filename=filename,
        is_gcj02=not needs_wgs84_conversion(fit.manufacturer),
        summary=summary_dict,
        km_stats=km_stats_list,
        dist_stats=dist_stats_list,
        time_stats=time_stats_list,
        time_stats_start=time_stats_start,
    )


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


def _run_sync(full: bool, limit: int | None):
    """后台线程：登录顽鹿 → 拉取列表 → 下载 FIT。"""
    from fafa.onelap import (
        browser_login, build_session, fetch_activity_list,
        download_activity, latest_local_time, parse_activity_time, activity_id,
    )

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

        _set_sync(state="downloading", message=f"共 {len(activities)} 个活动，开始下载…", total=len(activities), done=0)

        new_files = []
        for i, act in enumerate(activities, 1):
            t    = parse_activity_time(act)
            tstr = t.strftime("%Y-%m-%d %H:%M") if t else activity_id(act)
            _set_sync(message=f"[{i}/{len(activities)}] {tstr}", done=i - 1)
            try:
                path = download_activity(sess, act, state, INPUT_DIR)
                if path:
                    save_state(state)
                    new_files.append(path.name)
            except Exception:
                pass
            _set_sync(done=i, new_files=list(new_files))
            time.sleep(0.3)

        _set_sync(
            state="done",
            message=f"同步完成，新增 {len(new_files)} 个文件",
            done=len(activities),
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
        from fix_coords import fix_file
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

    fit_files = sorted(INPUT_DIR.glob("*.fit"))
    activities = []

    for path in fit_files:
        try:
            fit      = parse_fit(str(path))
            km_stats = compute_km_stats(fit)
            summary  = compute_summary(fit, km_stats)
        except Exception:
            continue

        if not fit.records:
            continue

        summary_d = asdict(summary)
        if min_km > 0 and (summary_d.get("total_dist_km") or 0) < min_km:
            continue

        # 从文件名提取日期，降级到第一条记录
        import re
        m = re.match(r"Magene_C506_(\d{8}-\d{6})_", path.name)
        if m:
            from datetime import datetime
            date_str = datetime.strptime(m.group(1), "%Y%m%d-%H%M%S").strftime("%Y-%m-%dT%H:%M:%S")
        else:
            try:
                date_str = fit.records[0].timestamp.strftime("%Y-%m-%dT%H:%M:%S")
            except Exception:
                date_str = None

        entry = {"filename": path.name, "date": date_str, "summary": summary_d}
        if not no_km:
            entry["km_stats"] = [asdict(s) for s in km_stats]

        # 去 None
        def strip_nulls(obj):
            if isinstance(obj, dict):
                return {k: strip_nulls(v) for k, v in obj.items() if v is not None}
            if isinstance(obj, list):
                return [strip_nulls(i) for i in obj]
            return obj

        entry = strip_nulls(entry)
        entry["filename"] = path.name
        if date_str:
            entry["date"] = date_str
        activities.append(entry)

    activities.sort(key=lambda a: a.get("date") or "")

    from datetime import datetime
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

    import io
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
    app.run(debug=True, port=5173)
