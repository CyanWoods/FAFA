# iGPSPORT FIT 同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add iGPSPORT platform FIT sync alongside existing OneLap sync, with a unified "FIT 同步" modal that lets users choose platform.

**Architecture:** New `fafa/igpsport.py` module wraps IGPSportClient (pure HTTP, no browser). `app.py` gains `_run_igpsport_sync()` and two new unified routes `/api/sync/start` + `/api/sync/status` sharing the existing `_sync` state dict. Frontend renames "顽鹿同步" to "FIT 同步" and adds a platform radio in the modal idle view.

**Tech Stack:** Python stdlib (`urllib.request`), Flask, existing `_sync`/`_set_sync` pattern, HTML/JS (vanilla)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `fafa/igpsport.py` | Create | IGPSportClient: login, list, download; helpers: make_filename, ride_id_exists, _parse_start_time |
| `tests/test_igpsport.py` | Create | Unit tests for pure functions in fafa/igpsport.py |
| `app.py` | Modify | _load_igpsport_credentials, _run_igpsport_sync, /api/sync/start, /api/sync/status |
| `config.template.json` | Modify | Add igpsport_username, igpsport_password fields |
| `templates/index.html` | Modify | Button rename, modal platform selector, settings section |
| `static/app.js` | Modify | startSync platform param, _pollSync new endpoint, settings load/save |

---

## Task 1: `fafa/igpsport.py` — pure helper functions

**Files:**
- Create: `fafa/igpsport.py`
- Create: `tests/test_igpsport.py`

- [ ] **Step 1: Write failing tests for pure helpers**

Create `tests/test_igpsport.py`:

```python
import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import tempfile
from pathlib import Path
from datetime import datetime
from fafa.igpsport import make_filename, ride_id_exists, _parse_start_time


# ── make_filename ────────────────────────────────────────────────────────────

def test_make_filename_with_time():
    dt = datetime(2024, 3, 15, 10, 30, 0)
    assert make_filename("123456", dt) == "iGPSport_123456_20240315-103000.fit"

def test_make_filename_no_time():
    assert make_filename("789", None) == "iGPSport_789_00000000-000000.fit"


# ── ride_id_exists ───────────────────────────────────────────────────────────

def test_ride_id_exists_found():
    with tempfile.TemporaryDirectory() as d:
        p = Path(d)
        (p / "iGPSport_123456_20240315-103000.fit").touch()
        assert ride_id_exists("123456", p) is True

def test_ride_id_exists_not_found():
    with tempfile.TemporaryDirectory() as d:
        assert ride_id_exists("999999", Path(d)) is False

def test_ride_id_exists_ignores_other_files():
    with tempfile.TemporaryDirectory() as d:
        p = Path(d)
        (p / "Magene_C706_123456_20240315-103000.fit").touch()
        assert ride_id_exists("123456", p) is False


# ── _parse_start_time ────────────────────────────────────────────────────────

def test_parse_start_time_datetime_format():
    item = {"startTime": "2024-03-15 10:30:00"}
    dt = _parse_start_time(item)
    assert dt == datetime(2024, 3, 15, 10, 30, 0)

def test_parse_start_time_date_format():
    item = {"startTime": "2024.03.15"}
    dt = _parse_start_time(item)
    assert dt == datetime(2024, 3, 15, 0, 0, 0)

def test_parse_start_time_missing():
    assert _parse_start_time({}) is None

def test_parse_start_time_empty():
    assert _parse_start_time({"startTime": ""}) is None
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && python -m pytest tests/test_igpsport.py -v
```

Expected: `ModuleNotFoundError: No module named 'fafa.igpsport'`

- [ ] **Step 3: Create `fafa/igpsport.py` with pure helpers and IGPSportClient**

Create `fafa/igpsport.py`:

```python
import json
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


def make_filename(ride_id: str, start_time: datetime | None) -> str:
    ts = start_time.strftime("%Y%m%d-%H%M%S") if start_time else "00000000-000000"
    return f"iGPSport_{ride_id}_{ts}.fit"


def ride_id_exists(ride_id: str, input_dir: Path) -> bool:
    return bool(list(input_dir.glob(f"iGPSport_{ride_id}_*.fit")))


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

    def get_all_activities(self) -> list[dict]:
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
            if not rows:
                break
            page += 1
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
                req = urllib.request.Request(download_url)
                req.add_header("Authorization", f"Bearer {self.token}")
                with urllib.request.urlopen(req, timeout=120) as resp, \
                        open(part_path, "wb") as f:
                    while True:
                        chunk = resp.read(256 * 1024)
                        if not chunk:
                            break
                        f.write(chunk)
                if not part_path.exists() or part_path.stat().st_size == 0:
                    raise RuntimeError("下载结果为空文件")
                part_path.replace(dst_path)
                return
            except Exception as exc:
                last_exc = exc
                if part_path.exists():
                    part_path.unlink()
                if attempt < 3:
                    time.sleep(attempt)
        raise RuntimeError(f"下载失败: {last_exc}")
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && python -m pytest tests/test_igpsport.py -v
```

Expected: all 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add fafa/igpsport.py tests/test_igpsport.py
git commit -m "New# fafa/igpsport.py tests/test_igpsport.py - iGPSport 客户端模块与单元测试"
```

---

## Task 2: `app.py` — backend: credentials loader, sync runner, new routes

**Files:**
- Modify: `app.py` — add after line ~688 (`_load_onelap_credentials` ends), and after line ~665 (`onelap_status` ends)

- [ ] **Step 1: Add `_load_igpsport_credentials` after `_load_onelap_credentials`**

Find in `app.py` (around line 688):
```python
def _load_onelap_credentials() -> dict | None:
```

After the entire `_load_onelap_credentials` function body, add:

```python
def _load_igpsport_credentials() -> dict | None:
    if not AI_CONFIG_FILE.exists():
        return None
    try:
        with open(AI_CONFIG_FILE, encoding="utf-8") as f:
            cfg = json.load(f)
        username = (cfg.get("igpsport_username") or "").strip()
        password = (cfg.get("igpsport_password") or "").strip()
        if not username or not password:
            return None
        return {"username": username, "password": password}
    except Exception:
        return None
```

- [ ] **Step 2: Add `_run_igpsport_sync` after `_run_sync`**

Find in `app.py` — after `_run_sync` function ends (around line 385), before the routes section, add:

```python
def _run_igpsport_sync(full: bool):
    """后台线程：登录 iGPSport → 拉取列表 → 下载 FIT。"""
    from fafa.igpsport import IGPSportClient, make_filename, ride_id_exists, _parse_start_time

    try:
        creds = _load_igpsport_credentials()
        if not creds:
            _set_sync(state="error", message="iGPSport 未配置账号密码，请在设置中填写")
            return

        _set_sync(state="login", message="正在登录 iGPSport…", total=0, done=0, new_files=[])
        client = IGPSportClient(creds["username"], creds["password"])
        try:
            client.login()
        except Exception as e:
            _set_sync(state="error", message=f"iGPSport 登录失败：{e}")
            return

        _set_sync(state="fetching", message="正在获取 iGPSport 活动列表…")
        try:
            activities = client.get_all_activities()
        except Exception as e:
            _set_sync(state="error", message=f"获取活动列表失败：{e}")
            return

        if not full:
            activities = [
                act for act in activities
                if not ride_id_exists(str(act.get("rideId", "")), INPUT_DIR)
            ]

        if not activities:
            _set_sync(state="done", message="没有新活动需要下载", total=0, done=0)
            return

        total = len(activities)
        _set_sync(state="downloading", message=f"共 {total} 个活动，开始下载…", total=total, done=0)

        new_files: list[str] = []
        failed = 0

        for i, act in enumerate(activities, 1):
            ride_id = str(act.get("rideId", ""))
            start_time = _parse_start_time(act)
            filename = make_filename(ride_id, start_time)
            dst_path = INPUT_DIR / filename
            ts_str = start_time.strftime("%Y-%m-%d %H:%M") if start_time else ride_id

            try:
                client.download_file(ride_id, dst_path)
                new_files.append(filename)
            except Exception as e:
                failed += 1
                logging.warning("iGPSport 下载 %s 失败: %s", ride_id, e)

            _set_sync(message=f"[{i}/{total}] {ts_str}", done=i, new_files=list(new_files))

        msg = f"同步完成，新增 {len(new_files)} 个文件"
        if failed:
            msg += f"，{failed} 个下载失败"
        _set_sync(state="done", message=msg, done=total, new_files=new_files)

    except Exception as e:
        _set_sync(state="error", message=f"同步出错：{e}")
```

- [ ] **Step 3: Add `/api/sync/start` and `/api/sync/status` routes**

Find in `app.py` — after the `onelap_status` route (around line 667), before the AI section comment, add:

```python
@app.route("/api/sync/start", methods=["POST"])
def sync_start():
    with _sync_lock:
        if _sync["state"] in ("login", "fetching", "downloading"):
            return jsonify(error="同步正在进行中"), 409

    body     = request.get_json(silent=True) or {}
    platform = body.get("platform", "onelap")
    full     = bool(body.get("full", False))
    limit    = body.get("limit")
    if limit is not None:
        try:
            limit = int(limit)
        except (TypeError, ValueError):
            limit = None

    if platform == "igpsport":
        t = threading.Thread(target=_run_igpsport_sync, args=(full,), daemon=True)
    else:
        t = threading.Thread(target=_run_sync, args=(full, limit), daemon=True)
    t.start()
    return jsonify(ok=True)


@app.route("/api/sync/status")
def sync_status():
    with _sync_lock:
        return jsonify(**_sync)
```

- [ ] **Step 4: Verify app starts without errors**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && python -c "import app; print('OK')"
```

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add app.py
git commit -m "Add# app.py - _load_igpsport_credentials/_run_igpsport_sync /api/sync/start /api/sync/status"
```

---

## Task 3: `config.template.json` + `app.py` config whitelist

**Files:**
- Modify: `config.template.json`

- [ ] **Step 1: Add igpsport fields to `config.template.json`**

In `config.template.json`, after `"onelap_password": "",` add:

```json
  "igpsport_username": "",
  "igpsport_password": "",
```

The file should now contain (relevant excerpt):
```json
{
  ...
  "onelap_username": "",
  "onelap_password": "",
  "igpsport_username": "",
  "igpsport_password": "",
  "strava_client_id": "",
  ...
}
```

- [ ] **Step 2: Verify config loads cleanly**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && python -c "import json; d=json.load(open('config.template.json')); print(d.get('igpsport_username'))"
```

Expected: empty string `''`

- [ ] **Step 3: Commit**

```bash
git add config.template.json
git commit -m "Add# config.template.json - igpsport_username/igpsport_password 字段"
```

---

## Task 4: `templates/index.html` — UI changes

**Files:**
- Modify: `templates/index.html`

- [ ] **Step 1: Rename Files view sync button**

Find:
```html
        <button onclick="openSyncModal()">顽鹿同步</button>
```

Replace with:
```html
        <button onclick="openSyncModal()">FIT 同步</button>
```

- [ ] **Step 2: Update sync modal title and idle view**

Find:
```html
  <div id="sync-modal">
    <div class="modal-overlay" onclick="closeSyncModal()"></div>
    <div class="modal-box sync-box">
      <div class="modal-title">从顽鹿同步</div>

      <div id="sync-idle-view">
        <p class="sync-desc">点击开始后，程序会自动打开浏览器，请在其中完成顽鹿账号登录，登录后将自动下载新的骑行文件。</p>
        <div class="sync-opts">
          <label><input type="checkbox" id="sync-full"> 全量下载（忽略已下载记录）</label>
        </div>
        <div class="modal-actions">
          <button class="modal-cancel" onclick="closeSyncModal()">取消</button>
          <button class="modal-export" onclick="startSync()">开始同步</button>
        </div>
      </div>
```

Replace with:
```html
  <div id="sync-modal">
    <div class="modal-overlay" onclick="closeSyncModal()"></div>
    <div class="modal-box sync-box">
      <div class="modal-title">FIT 同步</div>

      <div id="sync-idle-view">
        <div class="sync-platform-row">
          <label class="sync-platform-opt">
            <input type="radio" name="sync-platform" value="onelap" checked> 顽鹿（OneLap）
          </label>
          <label class="sync-platform-opt">
            <input type="radio" name="sync-platform" value="igpsport"> iGPSport
          </label>
        </div>
        <p class="sync-desc" id="sync-platform-desc">点击开始后，程序会自动打开浏览器，请在其中完成顽鹿账号登录，登录后将自动下载新的骑行文件。</p>
        <div class="sync-opts">
          <label><input type="checkbox" id="sync-full"> 全量下载（忽略已下载记录）</label>
        </div>
        <div class="modal-actions">
          <button class="modal-cancel" onclick="closeSyncModal()">取消</button>
          <button class="modal-export" onclick="startSync()">开始同步</button>
        </div>
      </div>
```

- [ ] **Step 3: Add iGPSport section to settings modal**

Find in `templates/index.html`:
```html
      <div class="settings-section">
        <div class="settings-section-title">Strava</div>
```

Insert before that block:
```html
      <div class="settings-section">
        <div class="settings-section-title">iGPSport 同步</div>
        <div class="settings-row">
          <label class="settings-label">用户名</label>
          <input id="cfg-igp-user" type="text" placeholder="">
        </div>
        <div class="settings-row">
          <label class="settings-label">密码</label>
          <input id="cfg-igp-pass" type="password" placeholder="">
        </div>
      </div>

```

- [ ] **Step 4: Commit**

```bash
git add templates/index.html
git commit -m "Update# templates/index.html - FIT同步入口重命名，弹窗加平台选择，设置新增iGPSport区块"
```

---

## Task 5: `static/app.js` — frontend logic

**Files:**
- Modify: `static/app.js`

- [ ] **Step 1: Update `startSync` to send platform and use new endpoint**

Find in `static/app.js`:
```javascript
async function startSync() {
  const full = document.getElementById('sync-full').checked;
  document.getElementById('sync-idle-view').style.display = 'none';
  document.getElementById('sync-progress-view').style.display = '';
  document.getElementById('sync-close-btn').disabled = true;
  _setSyncUI('正在启动…', 0, 0);

  try {
    const res = await fetch('/api/onelap/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full }),
    });
```

Replace with:
```javascript
async function startSync() {
  const full = document.getElementById('sync-full').checked;
  const platformEl = document.querySelector('input[name="sync-platform"]:checked');
  const platform = platformEl ? platformEl.value : 'onelap';
  document.getElementById('sync-idle-view').style.display = 'none';
  document.getElementById('sync-progress-view').style.display = '';
  document.getElementById('sync-close-btn').disabled = true;
  _setSyncUI('正在启动…', 0, 0);

  try {
    const res = await fetch('/api/sync/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, full }),
    });
```

- [ ] **Step 2: Update `_pollSync` to use new status endpoint**

Find:
```javascript
async function _pollSync() {
  try {
    const res  = await fetch('/api/onelap/status');
```

Replace with:
```javascript
async function _pollSync() {
  try {
    const res  = await fetch('/api/sync/status');
```

- [ ] **Step 3: Add platform description switcher to `openSyncModal`**

Find:
```javascript
function openSyncModal() {
  document.getElementById('sync-modal').style.display = 'flex';
  document.getElementById('sync-idle-view').style.display = '';
  document.getElementById('sync-progress-view').style.display = 'none';
```

Replace with:
```javascript
const _SYNC_PLATFORM_DESC = {
  onelap: '点击开始后，程序会自动打开浏览器，请在其中完成顽鹿账号登录，登录后将自动下载新的骑行文件。',
  igpsport: '将自动使用设置中配置的 iGPSport 账号密码登录，下载新的骑行文件。',
};

function _syncUpdatePlatformDesc() {
  const el = document.querySelector('input[name="sync-platform"]:checked');
  const platform = el ? el.value : 'onelap';
  const desc = document.getElementById('sync-platform-desc');
  if (desc) desc.textContent = _SYNC_PLATFORM_DESC[platform] || '';
}

function openSyncModal() {
  document.getElementById('sync-modal').style.display = 'flex';
  document.getElementById('sync-idle-view').style.display = '';
  document.getElementById('sync-progress-view').style.display = 'none';
  document.querySelectorAll('input[name="sync-platform"]').forEach(r => {
    r.addEventListener('change', _syncUpdatePlatformDesc);
  });
  _syncUpdatePlatformDesc();
```

- [ ] **Step 4: Add igpsport fields to settings load**

Find in `static/app.js` (around the loadSettingsModal area):
```javascript
    document.getElementById('cfg-onelap-user').value   = cfg.onelap_username      ?? '';
    document.getElementById('cfg-onelap-pass').value   = cfg.onelap_password      ?? '';
```

After those two lines, add:
```javascript
    document.getElementById('cfg-igp-user').value      = cfg.igpsport_username    ?? '';
    document.getElementById('cfg-igp-pass').value      = cfg.igpsport_password    ?? '';
```

- [ ] **Step 5: Add igpsport fields to settings save**

Find in `static/app.js` (around the saveSettingsModal area):
```javascript
    onelap_username:      val('cfg-onelap-user')   || null,
    onelap_password:      val('cfg-onelap-pass')   || null,
```

After those two lines, add:
```javascript
    igpsport_username:    val('cfg-igp-user')       || null,
    igpsport_password:    val('cfg-igp-pass')       || null,
```

- [ ] **Step 6: Commit**

```bash
git add static/app.js
git commit -m "Update# static/app.js - FIT同步平台选择逻辑，轮询改用/api/sync/status，设置加IGP字段"
```

---

## Task 6: Smoke test

- [ ] **Step 1: Run full test suite**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && python -m pytest tests/ -v
```

Expected: all tests PASS (including existing tests/test_compare.py, tests/test_wind.py, tests/test_batch_tags.py, tests/test_igpsport.py)

- [ ] **Step 2: Start app and verify UI**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python && python app.py
```

Open http://localhost:5000, go to Files view:
- Button text should be "FIT 同步"
- Click "FIT 同步" → modal opens with platform radio (顽鹿 / iGPSport)
- Switch to iGPSport → description text updates
- Open settings → "iGPSport 同步" section visible with 用户名/密码 fields

- [ ] **Step 3: Verify old onelap endpoint still works**

```bash
curl -s http://localhost:5000/api/onelap/status | python -m json.tool
```

Expected: JSON with `"state": "idle"` (old endpoint still responds)

- [ ] **Step 4: Verify new unified endpoint**

```bash
curl -s http://localhost:5000/api/sync/status | python -m json.tool
```

Expected: same JSON with `"state": "idle"`
