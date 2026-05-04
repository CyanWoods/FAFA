"""顽鹿（OneLap）下载客户端 — 可被 download_fit.py 和 app.py 共同使用。"""

import base64
import hashlib
import json
import os
import random
import re
import string
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import unquote, urlparse

import requests

ONELAP_WEB   = "https://www.onelap.cn"
ONELAP_APP   = "https://u.onelap.cn"
LIST_API     = f"{ONELAP_APP}/api/otm/ride_record/list"
DETAIL_API   = f"{ONELAP_APP}/api/otm/ride_record/analysis/{{rid}}"
DOWNLOAD_API = f"{ONELAP_APP}/api/otm/ride_record/analysis/fit_content/{{key}}"
SIGN_KEY     = os.environ.get("ONELAP_SIGN_KEY", "fe9f8382418fcdeb136461cac6acae7b")
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36"
)

CST             = timezone(timedelta(hours=8))
_MAGENE_RAW     = re.compile(r"^MAGENE_[A-Z]\d+_(\d+)_(\d+)_\d+(?:_\d+)?\.fit$", re.IGNORECASE)
# group(1): 旧格式日期字符串 YYYYMMDD-HHMMSS（Magene_Cxxx_YYYYMMDD-HHMMSS_id.fit）
# group(2): 新格式日期字符串 YYYYMMDD-HHMMSS（Magene_Cxxx_id_YYYYMMDD-HHMMSS.fit）
_MAGENE_RENAMED = re.compile(
    r"^Magene_[A-Z]\d+_(?:(\d{8}-\d{6})_\d+|\d+_(\d{8}-\d{6}))\.fit$"
)


# ── 签名 ──────────────────────────────────────────────────────────────────────
def sign(params: dict) -> dict:
    nonce = "".join(random.choices(string.ascii_letters + string.digits, k=16))
    ts = str(int(time.time()))
    merged = {k: (None if v == "" else v) for k, v in params.items()}
    merged.update(nonce=nonce, timestamp=ts)
    parts = [f"{k}={v}" for k, v in sorted(merged.items()) if v is not None]
    sig = hashlib.md5(("&".join(parts) + f"&key={SIGN_KEY}").encode()).hexdigest()
    return {"nonce": nonce, "timestamp": ts, "sign": sig}


# ── 文件名工具 ─────────────────────────────────────────────────────────────────
def _read_model(path: Path) -> str | None:
    """从 FIT 文件的 file_id 消息中读取码表型号（如 C506）。"""
    try:
        from garmin_fit_sdk import Decoder, Stream
        messages, _ = Decoder(Stream.from_file(str(path))).read(
            apply_scale_and_offset=False,
            merge_heart_rates=False,
            expand_sub_fields=False,
        )
        product_name = (messages.get("file_id_mesgs") or [{}])[0].get("product_name", "")
        model = product_name.split("_")[0] if product_name else ""
        if re.match(r"^[A-Z]\d+$", model):
            return model
    except Exception:
        pass
    return None


def rename_magene(path: Path, model: str | None = None) -> Path:
    m = _MAGENE_RAW.match(path.name)
    if not m:
        return path
    if model is None:
        model = _read_model(path) or path.name.split("_")[1].upper()
    dt = datetime.fromtimestamp(int(m.group(1)), tz=CST)
    new_name = f"Magene_{model}_{m.group(2)}_{dt.strftime('%Y%m%d-%H%M%S')}.fit"
    new_path = path.parent / new_name
    if new_path == path:
        return path
    if new_path.exists():
        return path
    path.rename(new_path)
    return new_path


def latest_local_time(input_dir: Path) -> datetime | None:
    latest = None
    for f in input_dir.glob("*.fit"):
        m = _MAGENE_RENAMED.match(f.name)
        if not m:
            continue
        try:
            dt_str = m.group(1) or m.group(2)
            dt = datetime.strptime(dt_str, "%Y%m%d-%H%M%S")
            if latest is None or dt > latest:
                latest = dt
        except ValueError:
            pass
    return latest


# ── 活动工具 ──────────────────────────────────────────────────────────────────
def activity_id(act: dict) -> str:
    return str(act.get("_id") or act.get("id") or act.get("record_id") or "").strip()


def parse_activity_time(act: dict) -> datetime | None:
    for field in ("start_riding_time", "startTime", "created_at", "updated_at", "date"):
        v = act.get(field)
        if v is None:
            continue
        if isinstance(v, (int, float)) and v > 0:
            ts = v / 1000 if v > 10**11 else v
            try:
                dt = datetime.fromtimestamp(ts)
                if dt.year >= 2000:
                    return dt
            except Exception:
                pass
        if isinstance(v, str):
            s = v.strip()
            for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
                try:
                    dt = datetime.strptime(s, fmt)
                    if dt.year >= 2000:
                        return dt
                except ValueError:
                    pass
    return None


# ── 会话 ──────────────────────────────────────────────────────────────────────
def build_session(token: str, cookies: dict) -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "User-Agent": UA,
        "Authorization": token,
        "Origin": ONELAP_APP,
        "Referer": f"{ONELAP_APP}/analysis",
    })
    s.cookies.update(cookies)
    return s


# ── API 调用 ──────────────────────────────────────────────────────────────────
def fetch_activity_list(
    sess: requests.Session,
    skip_ids: set,
    limit: int | None,
    on_page=None,
) -> list:
    """
    拉取活动列表。
    - skip_ids: 已下载的 record_id 集合，按条过滤，不中断翻页
    - limit:    最多收集条数
    - on_page(page, collected, total_pages): 每页回调
    """
    page, page_size = 1, 20
    collected: list = []

    while True:
        payload = {"page": page, "limit": page_size}
        resp = sess.post(LIST_API, json=payload, headers=sign(payload), timeout=30)
        resp.raise_for_status()
        data = resp.json()
        page_data = data.get("data") or {}
        items = page_data.get("list") or []
        total_pages = int(page_data.get("pages") or 0)

        if not items:
            break

        for act in items:
            if activity_id(act) in skip_ids:
                continue
            collected.append(act)
            if limit and len(collected) >= limit:
                if on_page:
                    on_page(page, len(collected), total_pages)
                return collected

        if on_page:
            on_page(page, len(collected), total_pages)

        if total_pages and page >= total_pages:
            break
        page += 1
        time.sleep(0.2)

    return collected


def _extract_fit_url(detail: dict, act: dict) -> str:
    def walk(obj):
        if isinstance(obj, dict):
            for k, v in obj.items():
                if k.lower() in ("fiturl", "fit_url"):
                    if isinstance(v, str) and v.strip():
                        return v.strip()
                found = walk(v)
                if found:
                    return found
        elif isinstance(obj, list):
            for item in obj:
                found = walk(item)
                if found:
                    return found
        return ""
    return walk(detail) or walk(act)


def download_activity(
    sess: requests.Session,
    act: dict,
    state: dict,
    out_dir: Path,
    skip_rename: bool = False,
) -> Path | None:
    """
    下载单个活动 FIT 文件。
    - 已在 state 且文件存在 → 返回现有路径（不重复下载）
    - 返回 None 表示跳过或失败
    """
    rid = activity_id(act)
    if not rid:
        return None

    state_item = state.get(rid) or {}
    if state_item.get("downloaded"):
        existing = out_dir / state_item.get("filename", "")
        if existing.exists() and existing.stat().st_size > 0:
            return existing

    import logging
    t0 = time.time()

    # 优先从活动列表数据中直接提取 fit_url，省去一次 Detail API 请求
    fit_url = _extract_fit_url({}, act)
    if not fit_url:
        detail_resp = sess.get(DETAIL_API.format(rid=rid), timeout=30)
        detail_resp.raise_for_status()
        detail = detail_resp.json()
        fit_url = _extract_fit_url(detail, act)
        logging.debug("[onelap] rid=%s  detail API: %.2fs", rid, time.time() - t0)
    else:
        logging.debug("[onelap] rid=%s  fit_url found in list (skipped detail API)", rid)

    if not fit_url:
        return None

    candidates, seen = [], set()
    for c in [fit_url, unquote(fit_url)]:
        if c and c not in seen:
            seen.add(c); candidates.append(c)
    if fit_url.startswith("http"):
        p = urlparse(fit_url).path
        for c in [p, p.rsplit("/", 1)[-1]]:
            if c and c not in seen:
                seen.add(c); candidates.append(c)
    elif "/" in fit_url:
        c = fit_url.rsplit("/", 1)[-1]
        if c not in seen:
            candidates.append(c)

    t1 = time.time()
    resp = None
    for key_src in candidates:
        fit_key = base64.b64encode(key_src.encode()).decode()
        try:
            r = sess.get(DOWNLOAD_API.format(key=fit_key), timeout=60, stream=True)
            r.raise_for_status()
            resp = r
            break
        except Exception:
            pass

    if resp is None:
        return None

    cd = resp.headers.get("Content-Disposition") or ""
    filename = ""
    if cd:
        m = re.search(r"filename\*=UTF-8''([^;]+)|filename=\"?([^\";]+)\"?", cd, re.IGNORECASE)
        if m:
            filename = unquote(m.group(1) or m.group(2)).strip()
    if not filename:
        name = act.get("name") or act.get("start_riding_time") or rid
        filename = re.sub(r'[<>:"/\\|?*]+', "_", str(name)).strip(".")
    if not filename.lower().endswith(".fit"):
        filename += ".fit"

    out_dir.mkdir(parents=True, exist_ok=True)
    final = out_dir / filename
    part  = Path(f"{final}.part")

    if final.exists() and final.stat().st_size > 0:
        final = rename_magene(final)
        state[rid] = {"filename": final.name, "downloaded": True}
        resp.close()
        return final

    if part.exists():
        part.unlink()

    try:
        with part.open("wb") as f:
            for chunk in resp.iter_content(65536):
                if chunk:
                    f.write(chunk)
        part.rename(final)
    except Exception:
        if part.exists():
            part.unlink()
        raise
    finally:
        resp.close()

    size_kb = final.stat().st_size / 1024
    logging.debug(
        "[onelap] rid=%s  key_resolve: %.2fs  download: %.2fs  size: %.1f KB",
        rid, t1 - t0, time.time() - t1, size_kb,
    )

    if not skip_rename:
        final = rename_magene(final)
    state[rid] = {
        "filename": final.name,
        "downloaded": True,
        "downloaded_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    }
    return final


# ── 浏览器登录 ─────────────────────────────────────────────────────────────────
def browser_login() -> dict:
    """打开浏览器让用户登录顽鹿，返回 {token, cookies}。失败时抛出异常。"""
    try:
        from DrissionPage import ChromiumPage, ChromiumOptions
    except ImportError:
        raise RuntimeError("请先安装 DrissionPage：.venv/bin/pip install DrissionPage")

    opts = ChromiumOptions().auto_port()
    local = os.environ.get("LOCALAPPDATA", "")
    pf    = os.environ.get("ProgramFiles", r"C:\Program Files")
    pf86  = os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")
    for candidate in [
        os.path.join(pf,    "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(pf86,  "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
        os.path.join(pf,    "Microsoft", "Edge", "Application", "msedge.exe"),
        os.path.join(pf86,  "Microsoft", "Edge", "Application", "msedge.exe"),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/usr/bin/google-chrome",
        "/usr/bin/chromium",
    ]:
        if candidate and os.path.exists(candidate):
            opts.set_paths(browser_path=candidate)
            break

    tab = ChromiumPage(opts)
    try:
        tab.get(f"{ONELAP_WEB}/login.html")
        time.sleep(3)  # 等待登录页面完全加载，避免 run_js 在页面刷新中被调用

        end = time.time() + 90
        while time.time() < end:
            url = tab.url or ""
            if "u.onelap.cn" in url and "login.html" not in url:
                break
            try:
                if tab.run_js("return localStorage.getItem('userInfo');"):
                    break
            except Exception:
                pass  # 页面切换/刷新期间 run_js 会抛出异常，忽略并重试
            time.sleep(1)
        else:
            raise RuntimeError("等待登录超时（90 秒）")

        tab.get(f"{ONELAP_APP}/analysis")
        time.sleep(5)  # 等待 analysis 页面加载完成，确保 token 已写入 localStorage

        token = ""
        try:
            token = tab.run_js("return localStorage.getItem('token');") or ""
        except Exception:
            pass

        if not token:
            try:
                raw = tab.run_js("return localStorage.getItem('userInfo');") or ""
                ui = json.loads(raw)
                if isinstance(ui, list) and ui:
                    token = ui[0].get("token", "")
                elif isinstance(ui, dict):
                    token = ui.get("token", "")
            except Exception:
                pass

        if not token:
            raise RuntimeError("未能从 localStorage 获取 token")

        cookies = {c["name"]: c["value"] for c in tab.cookies()}
        return {"token": token, "cookies": cookies}
    finally:
        tab.close()
