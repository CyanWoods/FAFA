# CartoDB CDN 连通性检测设计

**日期:** 2026-06-10
**状态:** 待实现

## 目标

Flask 服务后台定时探测 CartoDB 四个子域（a/b/c/d）的可达性，客户端切换到地图相关视图时拉取结果，动态调整 Leaflet 瓦片层子域列表和 PNG 导出的子域轮询池；全部不可达时向用户展示提示。

## 服务端

### 模块级状态

```python
_carto_cdn_status: dict[str, bool] = {'a': True, 'b': True, 'c': True, 'd': True}
_carto_cdn_lock = threading.Lock()
```

### 后台检测线程

- 应用启动时创建 daemon thread，立即执行首轮检测，之后每 60 秒循环。
- 每轮用 `concurrent.futures.ThreadPoolExecutor` 并发对 4 个子域发送 HEAD 请求：
  ```
  https://{s}.basemaps.cartocdn.com/dark_nolabels/1/0/0.png
  ```
- 超时 5s；HTTP 2xx/3xx → `True`，连接错误/超时/其他 → `False`。
- 结果写入 `_carto_cdn_status` 时加 `_carto_cdn_lock`。

### API 端点

```
GET /api/tiles/cdn-status
```

- 无需鉴权（瓦片 URL 本身公开）。
- 响应：
  ```json
  { "a": true, "b": false, "c": true, "d": true, "checked_at": 1718025600 }
  ```
- `checked_at` 为最近一次检测完成的 Unix 时间戳（`int`），供客户端判断数据新鲜度（预留，当前不强制校验）。

## 客户端

### 状态

```js
let _cartoCdnAvail = ['a', 'b', 'c', 'd']; // 初始全开，首次拉取前保守可用
```

### `_refreshCdnStatus()`

1. `GET /api/tiles/cdn-status`（fetch，忽略网络错误——失败时保留当前状态）
2. 过滤值为 `true` 的子域 → 更新 `_cartoCdnAvail`
3. 若过滤后为空，fallback：`_cartoCdnAvail = ['a','b','c','d']`，同时调用 `toast('地图服务不可用，瓦片加载可能失败', 'warn')`
4. 更新所有活跃 Leaflet 瓦片层的 `options.subdomains`（无需 `redraw()`）
5. `_TILE_SUBS` 常量删除，`_drawTiles` 里直接引用 `_cartoCdnAvail`

### 调用时机（懒加载）

| 触发点 | 函数 |
|--------|------|
| 切换到骑行轨迹视图 | `switchSidebarView('map')` |
| 打开活动详情（含路线热图） | `openDetailView(...)` |

### `_drawTiles` 修改

```js
// 原
const s = _TILE_SUBS[(_tileSubIdx++) % 4];
// 改
const s = _cartoCdnAvail[(_tileSubIdx++) % _cartoCdnAvail.length];
```

## 边界情况

| 情况 | 处理 |
|------|------|
| 首次检测未完成（服务刚启动）| 默认全部 `true`，客户端使用完整子域列表，行为与改动前一致 |
| `/api/tiles/cdn-status` 请求失败 | 静默忽略，保留 `_cartoCdnAvail` 现有值 |
| 全部子域不可达 | fallback 到全部 + toast 提示 |
| 仅部分子域可达 | 只用可达子域，Leaflet 自动轮询 |

## 文件变更范围

| 文件 | 变更 |
|------|------|
| `app.py` | 新增 `_carto_cdn_status`、检测线程、`/api/tiles/cdn-status` 端点 |
| `static/app.js` | 新增 `_cartoCdnAvail`、`_refreshCdnStatus()`；修改 `_drawTiles`；在 `switchSidebarView` 和 `openDetailView` 调用 `_refreshCdnStatus()` |
