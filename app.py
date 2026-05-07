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
from datetime import datetime, timezone, timedelta
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
        if fit.records:
            ts = fit.records[0].timestamp
            if fit.utc_offset_s is not None:
                tz = timezone(timedelta(seconds=fit.utc_offset_s))
                ts = ts.astimezone(tz)
            time_stats_start = ts.strftime("%Y-%m-%dT%H:%M:%S")
        else:
            time_stats_start = None
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


_MAX_DL_WORKERS = 6


def _run_sync(full: bool, limit: int | None):
    """后台线程：登录顽鹿 → 拉取列表 → 并发下载 FIT。"""
    from fafa.onelap import (
        browser_login, build_session, fetch_activity_list,
        download_activity, rename_magene, parse_activity_time, activity_id,
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
        sess     = build_session(auth["token"], auth["cookies"])

        _set_sync(state="fetching", message="正在获取活动列表…")

        def on_page(pg, col, tot):
            _set_sync(message=f"获取列表：第 {pg} 页，已找到 {col} 条新活动")

        activities = fetch_activity_list(sess, skip_ids, limit, on_page=on_page)

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
                            ver, model, decrypted = auto_decrypt_if_gcj02(path)
                            new_path   = rename_magene(path, model=model)
                            if new_path != path:
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
        # Mtime was reset to its original value so the cache key still matches —
        # explicitly evict the stale entry so the next load reads fresh data.
        with _cache_lock:
            _parse_cache.pop(str(path), None)
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

        # 从文件名提取日期（旧格式 _YYYYMMDD-HHMMSS_ 或新格式 _id_YYYYMMDD-HHMMSS）
        m = re.search(r"Magene_[A-Z]\d+_(?:(\d{8}-\d{6})_|\d+_(\d{8}-\d{6}))", path.name)
        if m:
            date_str = datetime.strptime(m.group(1) or m.group(2), "%Y%m%d-%H%M%S").strftime("%Y-%m-%dT%H:%M:%S")
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


# ── AI 骑行评估 ───────────────────────────────────────────────────────────────
AI_CONFIG_FILE = PROJECT_ROOT / "ai_config.json"


def _load_ai_config() -> dict | None:
    if not AI_CONFIG_FILE.exists():
        return None
    try:
        with open(AI_CONFIG_FILE, encoding="utf-8") as f:
            cfg = json.load(f)
        key = (cfg.get("api_key") or "").strip()
        if not key or key.startswith("your-"):
            return None
        return cfg
    except Exception:
        return None


def _build_eval_prompt(summary: dict, km_stats: list, filename: str, start_time: str) -> str:
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


@app.route("/api/ai/config")
def ai_config_status():
    cfg = _load_ai_config()
    if cfg:
        return jsonify(configured=True, model=cfg.get("model", ""))
    return jsonify(configured=False, model="")


def _llm_stream(cfg: dict, prompt: str):
    """共享 SSE 流式响应助手，所有 AI 端点都通过此函数返回。"""
    from flask import Response as _Resp, stream_with_context
    import requests as _req

    api_base = cfg.get("api_base", "https://api.openai.com/v1").rstrip("/")
    auth     = f"Bearer {cfg['api_key']}"
    payload  = {
        "model":      cfg.get("model", "gpt-4o-mini"),
        "messages":   [{"role": "user", "content": prompt}],
        "max_tokens": cfg.get("max_tokens", 2500),
        "stream":     True,
    }

    def generate():
        try:
            with _req.post(
                f"{api_base}/chat/completions",
                headers={"Content-Type": "application/json", "Authorization": auth},
                json=payload, stream=True, timeout=120,
            ) as resp:
                if not resp.ok:
                    yield f"data: {json.dumps({'error': f'API {resp.status_code}: {resp.text[:200]}'})}\n\n"
                    return
                for raw in resp.iter_lines():
                    if not raw:
                        continue
                    line = raw.decode("utf-8") if isinstance(raw, bytes) else raw
                    if not line.startswith("data: "):
                        continue
                    ds = line[6:].strip()
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

    return _Resp(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.route("/api/ai/evaluate", methods=["POST"])
def ai_evaluate():
    cfg = _load_ai_config()
    if not cfg:
        return jsonify(error="AI 未配置，请编辑项目根目录下的 ai_config.json"), 503
    body = request.get_json(silent=True) or {}
    prompt = _build_eval_prompt(
        body.get("summary") or {}, body.get("km_stats") or [],
        body.get("filename", ""), body.get("start_time", ""),
    )
    return _llm_stream(cfg, prompt)


# ── 活动列表（PMC 数据源） ────────────────────────────────────────────────────
@app.route("/api/activities")
def get_activities():
    """返回 input/ 中所有 FIT 文件的轻量摘要，供 PMC 页面计算使用。"""
    if not INPUT_DIR.exists():
        return jsonify(activities=[])

    result = []
    for path in sorted(INPUT_DIR.glob("*.fit")):
        path_str = str(path)
        try:
            mtime  = path.stat().st_mtime
            cached = _cache_get(path_str, mtime)
            if cached:
                ts_start = cached.get("time_stats_start")
                summary  = cached.get("summary") or {}
            else:
                fit = parse_fit(path_str)
                if not fit.records:
                    continue
                km  = compute_km_stats(fit)
                s   = compute_summary(fit, km)
                summary = asdict(s)
                ts = fit.records[0].timestamp
                if fit.utc_offset_s is not None:
                    tz_local = timezone(timedelta(seconds=fit.utc_offset_s))
                    ts = ts.astimezone(tz_local)
                ts_start = ts.strftime("%Y-%m-%dT%H:%M:%S")

            if not ts_start:
                continue
            result.append({
                "filename":   path.name,
                "date":       ts_start[:10],
                "start_time": ts_start,
                "summary":    {k: v for k, v in summary.items() if v is not None},
            })
        except Exception as e:
            logging.warning("activities: %s: %s", path.name, e)

    result.sort(key=lambda a: a["date"])
    return jsonify(activities=result)


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

    ctl_7d = trend.get("ctl_7d_ago", ctl)
    ctl_30d = trend.get("ctl_30d_ago", ctl)
    lines += [
        f"- CTL 7天前：{ctl_7d:.1f}（变化 {ctl - ctl_7d:+.1f}）",
        f"- CTL 30天前：{ctl_30d:.1f}（变化 {ctl - ctl_30d:+.1f}）",
        f"- 数据覆盖：{data.get('total_activities', 0)} 次骑行，最早记录 {data.get('first_date', '—')}",
    ]

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
def ai_pmc():
    cfg = _load_ai_config()
    if not cfg:
        return jsonify(error="AI 未配置，请编辑 ai_config.json"), 503
    data   = request.get_json(silent=True) or {}
    prompt = _build_pmc_prompt(data)
    return _llm_stream(cfg, prompt)


if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    if debug:
        logging.basicConfig(level=logging.DEBUG, format="%(asctime)s %(levelname)s %(message)s")
    app.run(debug=debug, port=5173)
