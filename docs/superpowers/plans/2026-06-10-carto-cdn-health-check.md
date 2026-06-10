# CartoDB CDN 连通性检测 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flask 服务后台每 60 秒探测 CartoDB 四个子域可达性，客户端切换地图视图时拉取结果，动态调整 Leaflet 渲染和 PNG 导出使用的子域列表；全部不可达时展示 toast 提示。

**Architecture:** 服务端 daemon 线程并发 HEAD 探测，结果存模块级 dict；`/api/tiles/cdn-status` 无鉴权端点直接返回缓存；客户端切视图时拉取并更新 Leaflet `subdomains` 和导出轮询池。

**Tech Stack:** Python `threading` + `concurrent.futures`, `requests`（已有依赖）, Leaflet.js, Fetch API

---

## 文件变更范围

| 文件 | 变更 |
|------|------|
| `app.py` | 新增模块级状态、`_carto_cdn_checker()` 线程函数、`_start_carto_cdn_checker()` 启动函数、`/api/tiles/cdn-status` 端点、模块级启动调用 |
| `static/app.js` | 用 `_cartoCdnAvail` 替换 `_TILE_SUBS` 常量、新增 `_refreshCdnStatus()`、修改 `_drawTiles`、修改 `switchSidebarView` 和 `openDetailView` |

---

### Task 1：服务端模块级状态

**Files:**
- Modify: `app.py` — 在第 394 行 `_activity_executor` 定义之后插入

- [ ] **Step 1：插入模块级状态**

在 `app.py` 中找到：
```python
_activity_executor = ThreadPoolExecutor(max_workers=4)
```
在其后追加：
```python

# ── CartoDB CDN 可达性状态 ────────────────────────────────────────────────────
_carto_cdn_status: dict[str, bool] = {'a': True, 'b': True, 'c': True, 'd': True}
_carto_cdn_lock   = threading.Lock()
_carto_cdn_checked_at: int = 0  # Unix 时间戳，0 = 尚未完成首次检测
```

- [ ] **Step 2：验证语法**

```bash
python3 -c "import ast; ast.parse(open('app.py').read()); print('OK')"
```
预期输出：`OK`

---

### Task 2：服务端检测线程函数

**Files:**
- Modify: `app.py` — 在 `_resolve_public_api_base` 函数定义之前插入

- [ ] **Step 1：插入线程函数**

在 `app.py` 中找到：
```python
_SSRF_BLOCKED_V4 = [
```
在其前插入：
```python
def _carto_cdn_checker():
    """后台循环：每 60 秒并发 HEAD 探测 CartoDB 四个子域。"""
    import time as _time
    import requests as _req
    from concurrent.futures import ThreadPoolExecutor as _TPE, as_completed as _asc

    _TEST_TILE = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/1/0/0.png'
    _SUBDOMAINS = ['a', 'b', 'c', 'd']
    _INTERVAL   = 60
    _TIMEOUT    = 5

    def _probe(sub):
        url = _TEST_TILE.replace('{s}', sub)
        try:
            r = _req.head(url, timeout=_TIMEOUT, allow_redirects=True)
            return sub, r.status_code < 400
        except Exception:
            return sub, False

    while True:
        results = {}
        with _TPE(max_workers=4) as ex:
            futs = {ex.submit(_probe, s): s for s in _SUBDOMAINS}
            for f in _asc(futs):
                sub, ok = f.result()
                results[sub] = ok
        global _carto_cdn_checked_at
        with _carto_cdn_lock:
            _carto_cdn_status.update(results)
            _carto_cdn_checked_at = int(_time.time())
        logging.info('CartoDB CDN status: %s', results)
        _time.sleep(_INTERVAL)


def _start_carto_cdn_checker():
    t = threading.Thread(target=_carto_cdn_checker, daemon=True, name='carto-cdn-checker')
    t.start()


```

- [ ] **Step 2：验证语法**

```bash
python3 -c "import ast; ast.parse(open('app.py').read()); print('OK')"
```
预期：`OK`

---

### Task 3：服务端 API 端点 + 模块启动调用

**Files:**
- Modify: `app.py` — 端点插在最后一个路由之后；启动调用插在 `if __name__` 之前

- [ ] **Step 1：插入端点**

在 `app.py` 中找到：
```python
if __name__ == "__main__":
```
在其前插入：
```python
@app.route("/api/tiles/cdn-status")
def tiles_cdn_status():
    with _carto_cdn_lock:
        status = dict(_carto_cdn_status)
        checked_at = _carto_cdn_checked_at
    return jsonify(**status, checked_at=checked_at)


```

- [ ] **Step 2：插入模块级启动调用**

在刚才插入的端点之后、`if __name__ == "__main__":` 之前插入：
```python
_start_carto_cdn_checker()

```

- [ ] **Step 3：验证语法**

```bash
python3 -c "import ast; ast.parse(open('app.py').read()); print('OK')"
```
预期：`OK`

- [ ] **Step 4：启动服务，验证端点**

```bash
python3 app.py &
sleep 3
curl -s http://localhost:5173/api/tiles/cdn-status | python3 -m json.tool
kill %1
```
预期输出类似：
```json
{
  "a": true,
  "b": true,
  "c": true,
  "d": true,
  "checked_at": 1718025600
}
```
（`checked_at` 为 0 表示首次检测未完成，仍是正常响应。）

- [ ] **Step 5：Commit**

```bash
git add app.py
git commit -m "Add# app.py - CartoDB CDN 后台探测线程与状态端点"
```

---

### Task 4：客户端状态 + `_refreshCdnStatus()`

**Files:**
- Modify: `static/app.js` — 替换 `_TILE_SUBS`，新增 `_cartoCdnAvail` 和 `_refreshCdnStatus()`

- [ ] **Step 1：替换 `_TILE_SUBS` 常量**

找到并替换：
```js
const _TILE_SUBS = ['a', 'b', 'c', 'd'];
let _tileSubIdx = 0;
```
改为：
```js
let _cartoCdnAvail = ['a', 'b', 'c', 'd']; // 可用子域，由 _refreshCdnStatus 动态更新
let _tileSubIdx = 0;
```

- [ ] **Step 2：新增 `_refreshCdnStatus()` 函数**

在 `_cartoCdnAvail` 声明后紧接着插入：
```js
async function _refreshCdnStatus() {
  try {
    const res = await fetch('/api/tiles/cdn-status');
    if (!res.ok) return;
    const d = await res.json();
    const avail = ['a', 'b', 'c', 'd'].filter(s => d[s] === true);
    _cartoCdnAvail = avail.length > 0 ? avail : ['a', 'b', 'c', 'd'];
    if (avail.length === 0) {
      toast('地图服务不可用，瓦片加载可能失败');
    }
    // 更新已挂载的 Leaflet 瓦片层子域
    if (tileLayer) tileLayer.options.subdomains = _cartoCdnAvail;
    if (detailRouteTileLayer) detailRouteTileLayer.options.subdomains = _cartoCdnAvail;
  } catch (_) {
    // 网络失败静默忽略，保留当前状态
  }
}
```

- [ ] **Step 3：更新 `_drawTiles` 子域引用**

找到：
```js
      const s = _TILE_SUBS[(_tileSubIdx++) % 4];
```
改为：
```js
      const s = _cartoCdnAvail[(_tileSubIdx++) % _cartoCdnAvail.length];
```

- [ ] **Step 4：验证语法无误**

用浏览器开 DevTools Console，刷新页面，确认无 `ReferenceError: _TILE_SUBS is not defined` 等错误。

---

### Task 5：视图切换时触发 `_refreshCdnStatus()`

**Files:**
- Modify: `static/app.js` — 修改 `switchSidebarView` 和 `openDetailView`

- [ ] **Step 1：在切换到 map 视图时调用**

在 `switchSidebarView` 中找到：
```js
  if (name === 'map') {
    mapView.classList.add('active');
    map.invalidateSize();
  } else {
```
改为：
```js
  if (name === 'map') {
    mapView.classList.add('active');
    map.invalidateSize();
    _refreshCdnStatus();
  } else {
```

- [ ] **Step 2：在 `openDetailView` 中调用**

在 `openDetailView` 开头找到：
```js
async function openDetailView(id) {
  const t = tracks.get(id);
  if (!t) return;
  stopFlash(id);
  detailTrackId = id;
```
在 `detailTrackId = id;` 后插入一行：
```js
  _refreshCdnStatus();
```

结果：
```js
async function openDetailView(id) {
  const t = tracks.get(id);
  if (!t) return;
  stopFlash(id);
  detailTrackId = id;
  _refreshCdnStatus();
```

- [ ] **Step 3：端到端验证**

1. 启动服务：`python3 app.py`
2. 打开浏览器，开 DevTools Network 标签
3. 切换到骑行轨迹视图 → 应出现对 `/api/tiles/cdn-status` 的 GET 请求，响应 200
4. 点击任意活动卡片打开详情视图 → 再次出现 `/api/tiles/cdn-status` 请求
5. 查看 Flask 日志，60 秒后应出现：`CartoDB CDN status: {'a': True, 'b': True, ...}`

- [ ] **Step 4：Commit**

```bash
git add static/app.js
git commit -m "Add# app.js - CartoDB CDN 动态子域更新与全不可达提示"
```

