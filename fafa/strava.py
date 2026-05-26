"""Strava upload integration.

Credentials stored in config.json under strava_* keys.
Upload dedup state at input/.strava_state.json.
"""

import hashlib
import json
import logging
import os
import re
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import quote

import requests

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).parent.parent
_AI_CONFIG_FILE = _PROJECT_ROOT / "config.json"
_INPUT_DIR = _PROJECT_ROOT / "input"
_STATE_FILE = _INPUT_DIR / ".strava_state.json"

DATA_TYPE_MAP = {".fit": "fit", ".gpx": "gpx", ".tcx": "tcx"}


# ── Config ────────────────────────────────────────────────────────────────────

def load_config() -> dict | None:
    """Return Strava config dict, or None if client_id/secret not set."""
    if not _AI_CONFIG_FILE.exists():
        return None
    try:
        with open(_AI_CONFIG_FILE, encoding="utf-8") as f:
            cfg = json.load(f)
        client_id = (cfg.get("strava_client_id") or "").strip()
        client_secret = (cfg.get("strava_client_secret") or "").strip()
        if not client_id or not client_secret:
            return None
        return {
            "client_id": client_id,
            "client_secret": client_secret,
            "access_token": (cfg.get("strava_access_token") or "").strip(),
            "refresh_token": (cfg.get("strava_refresh_token") or "").strip(),
            "expires_at": int(cfg.get("strava_expires_at") or 0),
            "athlete_id": (cfg.get("strava_athlete_id") or "").strip(),
            "athlete_name": (cfg.get("strava_athlete_name") or "").strip(),
            "redirect_port": int(cfg.get("strava_redirect_port") or 5173),
        }
    except Exception:
        return None


def _save_tokens(access_token, refresh_token, expires_at,
                 athlete_id="", athlete_name=""):
    with open(_AI_CONFIG_FILE, encoding="utf-8") as f:
        cfg = json.load(f)
    cfg["strava_access_token"] = access_token
    cfg["strava_refresh_token"] = refresh_token
    cfg["strava_expires_at"] = expires_at
    if athlete_id:
        cfg["strava_athlete_id"] = str(athlete_id)
    if athlete_name:
        cfg["strava_athlete_name"] = athlete_name
    with open(_AI_CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


# ── Token management ──────────────────────────────────────────────────────────

def get_access_token() -> str:
    cfg = load_config()
    if not cfg:
        raise Exception("Strava 未配置 client_id / client_secret")
    if not cfg["refresh_token"]:
        raise Exception("Strava 未授权，请先完成 OAuth 授权")

    now = int(time.time())
    if cfg["access_token"] and cfg["expires_at"] and cfg["expires_at"] > now + 3600:
        return cfg["access_token"]

    logger.info("[strava] 刷新 access_token...")
    resp = requests.post(
        "https://www.strava.com/oauth/token",
        data={
            "client_id": cfg["client_id"],
            "client_secret": cfg["client_secret"],
            "refresh_token": cfg["refresh_token"],
            "grant_type": "refresh_token",
        },
        timeout=20,
    )
    resp.raise_for_status()
    data = resp.json()
    athlete = data.get("athlete") or {}
    _save_tokens(
        access_token=data.get("access_token", ""),
        refresh_token=data.get("refresh_token", cfg["refresh_token"]),
        expires_at=data.get("expires_at", 0),
        athlete_id=athlete.get("id", ""),
        athlete_name=athlete.get("username") or athlete.get("firstname") or "",
    )
    logger.info("[strava] token 刷新成功")
    return data.get("access_token", "")


# ── OAuth ─────────────────────────────────────────────────────────────────────

def build_auth_url(port: int = 5173) -> str:
    cfg = load_config()
    if not cfg:
        raise Exception("Strava 未配置 client_id")
    redirect_uri = f"http://localhost:{port}/strava/callback"
    state_tok = hashlib.md5(f"{cfg['client_id']}-{time.time()}".encode()).hexdigest()[:12]
    return (
        f"https://www.strava.com/oauth/authorize"
        f"?client_id={quote(cfg['client_id'])}"
        f"&response_type=code"
        f"&redirect_uri={quote(redirect_uri, safe='')}"
        f"&approval_prompt=force"
        f"&scope={quote('activity:write,activity:read_all')}"
        f"&state={state_tok}"
    )


def exchange_code(code: str) -> dict:
    """Exchange OAuth code for tokens. Saves to config.json."""
    cfg = load_config()
    if not cfg:
        raise Exception("Strava 未配置")
    resp = requests.post(
        "https://www.strava.com/oauth/token",
        data={
            "client_id": cfg["client_id"],
            "client_secret": cfg["client_secret"],
            "code": code,
            "grant_type": "authorization_code",
        },
        timeout=20,
    )
    resp.raise_for_status()
    data = resp.json()
    athlete = data.get("athlete") or {}
    name = (
        athlete.get("username")
        or athlete.get("firstname")
        or str(athlete.get("id", ""))
    )
    _save_tokens(
        access_token=data.get("access_token", ""),
        refresh_token=data.get("refresh_token", ""),
        expires_at=data.get("expires_at", 0),
        athlete_id=athlete.get("id", ""),
        athlete_name=name,
    )
    return {"athlete_id": str(athlete.get("id", "")), "athlete_name": name}


# ── Dedup state ───────────────────────────────────────────────────────────────

def _load_state() -> dict:
    try:
        if _STATE_FILE.exists():
            with open(_STATE_FILE, encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return {}


def _save_state(state: dict):
    try:
        with open(_STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.warning(f"[strava] 保存状态失败: {e}")


def _file_sig(file_path: str) -> str:
    st = os.stat(file_path)
    return f"{os.path.basename(file_path)}|{st.st_size}|{int(st.st_mtime)}"


def is_uploaded(filename: str) -> bool:
    path = str(_INPUT_DIR / filename)
    if not os.path.isfile(path):
        return False
    sig = _file_sig(path)
    return bool(_load_state().get(sig, {}).get("uploaded"))


# ── Activity list ─────────────────────────────────────────────────────────────

def fetch_all_activities(access_token: str, per_page: int = 200) -> list[dict]:
    """Fetch all Strava activities. Returns [{id, external_id, start_unix}]."""
    headers = {"Authorization": f"Bearer {access_token}"}
    all_acts: list[dict] = []
    page = 1
    while True:
        resp = requests.get(
            "https://www.strava.com/api/v3/athlete/activities",
            headers=headers,
            params={"per_page": per_page, "page": page},
            timeout=30,
        )
        resp.raise_for_status()
        batch = resp.json()
        if not batch:
            break
        for act in batch:
            try:
                dt = datetime.strptime(act["start_date"], "%Y-%m-%dT%H:%M:%SZ")
                all_acts.append({
                    "id": act["id"],
                    "external_id": (act.get("external_id") or "").strip(),
                    "start_unix": int(dt.timestamp()),
                })
            except Exception:
                pass
        if len(batch) < per_page:
            break
        page += 1
    return all_acts


# ── Upload core ───────────────────────────────────────────────────────────────

def _classify_error(err_text: str) -> tuple[str, str]:
    text = (err_text or "").lower()
    if "duplicate of" in text:
        m = re.search(r"/activities/(\d+)", err_text)
        return "duplicate", m.group(1) if m else ""
    if "401" in text or "unauthorized" in text or "access token" in text:
        return "auth", ""
    if "403" in text or "scope" in text or "permission" in text:
        return "permission", ""
    if "rate limit" in text or "429" in text:
        return "rate_limit", ""
    return "unknown", ""


def _upload_one(file_path: str, access_token: str) -> dict:
    ext = os.path.splitext(file_path)[1].lower()
    data_type = DATA_TYPE_MAP.get(ext, "fit")
    headers = {"Authorization": f"Bearer {access_token}"}
    with open(file_path, "rb") as f:
        resp = requests.post(
            "https://www.strava.com/api/v3/uploads",
            headers=headers,
            data={
                "data_type": data_type,
                "sport_type": "Ride",
                "external_id": os.path.basename(file_path),
            },
            files={"file": (os.path.basename(file_path), f, "application/octet-stream")},
            timeout=60,
        )
    resp.raise_for_status()
    data = resp.json()
    if data.get("error"):
        raise Exception(f"上传接口错误: {data['error']}")
    return data


def _poll_status(upload_id, access_token: str, timeout: int = 90) -> dict:
    headers = {"Authorization": f"Bearer {access_token}"}
    end_at = time.time() + timeout
    last: dict = {}
    while time.time() < end_at:
        resp = requests.get(
            f"https://www.strava.com/api/v3/uploads/{upload_id}",
            headers=headers,
            timeout=20,
        )
        resp.raise_for_status()
        data = resp.json()
        last = data
        err = str(data.get("error") or "").lower()
        if err and err not in ("none", "null", ""):
            raise Exception(f"Strava 处理失败: {data['error']}")
        if data.get("activity_id"):
            return data
        if "ready" in str(data.get("status") or "").lower():
            return data
        time.sleep(3)
    return last


def upload_files(filenames: list[str], force: bool = False,
                 progress_cb=None) -> dict:
    """Upload named FIT files from input/ to Strava.

    progress_cb(filename, done, total) called before each file.
    Returns {results, success, skipped, failed}.
    """
    access_token = get_access_token()
    state = _load_state()
    results = []
    total = len(filenames)

    for i, filename in enumerate(filenames):
        if "/" in filename or "\\" in filename or filename.startswith(".."):
            results.append({"filename": filename, "status": "error", "msg": "非法文件名"})
            continue
        if progress_cb:
            progress_cb(filename, i, total)

        path = str(_INPUT_DIR / filename)
        if not os.path.isfile(path):
            results.append({"filename": filename, "status": "error", "msg": "文件不存在"})
            continue

        ext = os.path.splitext(filename)[1].lower()
        if ext not in DATA_TYPE_MAP:
            results.append({"filename": filename, "status": "error", "msg": f"不支持格式 {ext}"})
            continue

        sig = _file_sig(path)
        if not force and state.get(sig, {}).get("uploaded"):
            results.append({"filename": filename, "status": "skipped", "msg": "已上传过"})
            continue

        try:
            upload_data = _upload_one(path, access_token)
            upload_id = upload_data.get("id") or upload_data.get("id_str")
            result = _poll_status(upload_id, access_token) if upload_id else upload_data
            activity_id = str((result or {}).get("activity_id", "") or "")
            state[sig] = {
                "uploaded": True,
                "file": filename,
                "upload_id": str(upload_id or ""),
                "activity_id": activity_id,
                "uploaded_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            }
            _save_state(state)
            results.append({"filename": filename, "status": "ok", "activity_id": activity_id})

        except Exception as e:
            err_text = str(e)
            kind, extra = _classify_error(err_text)
            if kind == "duplicate":
                state[sig] = {
                    "uploaded": True,
                    "file": filename,
                    "upload_id": "",
                    "activity_id": extra,
                    "uploaded_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "note": "duplicate",
                }
                _save_state(state)
                results.append({
                    "filename": filename,
                    "status": "skipped",
                    "msg": f"Strava 已有重复活动 (id={extra})",
                })
            else:
                results.append({"filename": filename, "status": "error", "msg": err_text[:200]})

    return {
        "results": results,
        "success": sum(1 for r in results if r["status"] == "ok"),
        "skipped": sum(1 for r in results if r["status"] == "skipped"),
        "failed": sum(1 for r in results if r["status"] == "error"),
    }
