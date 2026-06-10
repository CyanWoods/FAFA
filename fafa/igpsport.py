import ipaddress
import json
import logging
import os
import re
import socket
import time
import urllib.request
import urllib.parse
from datetime import datetime
from pathlib import Path

_BASE_URL = "https://prod.zh.igpsport.com/service"
_HEADERS = {
    "Content-Type": "application/json;charset=UTF-8",
    "Accept": "application/json, text/plain, */*",
    "Origin": "https://app.igpsport.cn",
    "Referer": "https://app.igpsport.cn/",
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/123.0.0.0 Safari/537.36"
    ),
}
MAX_FIT_DOWNLOAD_BYTES = 32 * 1024 * 1024


def _validate_public_https_url(url: str) -> str:
    """Reject credential-bearing, non-HTTPS, and non-public download targets."""
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise RuntimeError("下载地址必须是公网 HTTPS 地址")
    try:
        infos = socket.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise RuntimeError("下载地址域名解析失败") from exc
    if not infos:
        raise RuntimeError("下载地址未解析到可用地址")
    for info in infos:
        addr = ipaddress.ip_address(info[4][0])
        checked = addr.ipv4_mapped or addr if isinstance(addr, ipaddress.IPv6Address) else addr
        if not checked.is_global:
            raise RuntimeError("下载地址禁止指向非公网地址")
    return url


class _PublicHTTPSRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _validate_public_https_url(newurl)
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if redirected is not None:
            old_host = urllib.parse.urlparse(req.full_url).hostname
            new_host = urllib.parse.urlparse(newurl).hostname
            if old_host != new_host:
                redirected.remove_header("Authorization")
        return redirected


_DOWNLOAD_OPENER = urllib.request.build_opener(_PublicHTTPSRedirectHandler())


def _parse_start_time(item: dict) -> datetime | None:
    raw = str(item.get("startTime") or "").strip().replace(".", "-")
    if not raw:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    return None


def _safe_ride_id(ride_id: str) -> str:
    """Strip any characters that could cause path traversal."""
    return re.sub(r'[^A-Za-z0-9_-]', '_', str(ride_id))


def make_filename(ride_id: str, start_time: datetime | None) -> str:
    ts = start_time.strftime("%Y%m%d-%H%M%S") if start_time else "00000000-000000"
    return f"iGPSport_{_safe_ride_id(ride_id)}_{ts}.fit"


def ride_id_exists(ride_id: str, input_dir: Path) -> bool:
    return bool(list(input_dir.glob(f"iGPSport_{_safe_ride_id(ride_id)}_*.fit")))


class IGPSportClient:
    def __init__(self, username: str, password: str):
        self.username = username
        self.password = password
        self.token: str | None = None

    def login(self) -> None:
        url = f"{_BASE_URL}/auth/account/login"
        payload = json.dumps({
            "username": self.username,
            "password": self.password,
            "appId": "igpsport-web",
        }).encode("utf-8")
        last_exc: Exception | None = None
        for attempt in range(1, 4):
            req = urllib.request.Request(url, data=payload, headers=_HEADERS)
            try:
                with urllib.request.urlopen(req, timeout=30) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                if data.get("code") != 0:
                    raise RuntimeError(data.get("message") or "登录失败")
                self.token = data["data"]["access_token"]
                logging.info("[iGPSport] 登录成功")
                return
            except Exception as exc:
                last_exc = exc
                if attempt < 3:
                    time.sleep(attempt)
        raise RuntimeError(f"iGPSport 登录失败: {last_exc}")

    def _get(self, path: str, params: dict | None = None) -> dict:
        url = f"{_BASE_URL}{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(url)
        req.add_header("Authorization", f"Bearer {self.token}")
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())

    def get_all_activities(self, max_activities: int | None = None) -> list[dict]:
        all_acts: list[dict] = []
        page = 1
        total_pages = 1
        while page <= total_pages:
            data = self._get(
                "/web-gateway/web-analyze/activity/queryMyActivity",
                {"pageNo": page, "pageSize": 20, "reqType": 0, "sort": 1},
            )
            if data.get("code") != 0:
                raise RuntimeError(data.get("message") or "获取活动列表失败")
            page_data = data.get("data") or {}
            rows: list[dict] = page_data.get("rows") or []
            total_pages = page_data.get("totalPage", 1)
            all_acts.extend(rows)
            if max_activities is not None and len(all_acts) >= max_activities:
                return all_acts[:max_activities]
            logging.info("[iGPSport] 第 %d/%d 页: %d 条记录", page - 1, total_pages, len(rows))
            if not rows:
                break
            page += 1
            if page <= total_pages:
                time.sleep(0.3)
        return all_acts

    def download_file(self, ride_id: str, dst_path: Path) -> None:
        part_path = Path(str(dst_path) + ".part")
        if part_path.exists():
            part_path.unlink()
        last_exc: Exception | None = None
        for attempt in range(1, 4):
            try:
                data = self._get(
                    f"/web-gateway/web-analyze/activity/getDownloadUrl/{ride_id}"
                )
                if data.get("code") != 0:
                    raise RuntimeError(data.get("message") or "获取下载地址失败")
                download_url = data.get("data")
                if not download_url:
                    raise RuntimeError("下载地址为空")
                _validate_public_https_url(download_url)
                req = urllib.request.Request(download_url)
                download_host = urllib.parse.urlparse(download_url).hostname
                api_host = urllib.parse.urlparse(_BASE_URL).hostname
                if download_host == api_host:
                    req.add_header("Authorization", f"Bearer {self.token}")
                with _DOWNLOAD_OPENER.open(req, timeout=120) as resp, \
                        open(part_path, "wb") as f:
                    downloaded = 0
                    while True:
                        chunk = resp.read(256 * 1024)
                        if not chunk:
                            break
                        downloaded += len(chunk)
                        if downloaded > MAX_FIT_DOWNLOAD_BYTES:
                            raise RuntimeError("FIT 文件超过 32 MB 限制")
                        f.write(chunk)
                if not part_path.exists() or part_path.stat().st_size == 0:
                    raise RuntimeError("下载结果为空文件")
                part_path.replace(dst_path)
                os.chmod(dst_path, 0o600)
                return
            except Exception as exc:
                last_exc = exc
                logging.warning("[iGPSport] 下载 %s 失败 (第%d/3次): %s", ride_id, attempt, exc)
                if part_path.exists():
                    part_path.unlink()
                if attempt < 3:
                    time.sleep(attempt)
        raise RuntimeError(f"下载失败: {last_exc}")
