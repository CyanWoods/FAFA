# iGPSPORT FIT 同步功能设计

## 概述

在现有顽鹿同步基础上，新增 iGPSPORT 平台 FIT 文件同步支持。前端入口从"顽鹿同步"改为"FIT 同步"，弹窗内选择平台。后端统一同步状态，共享轮询接口。

## 架构

### 新增模块：`fafa/igpsport.py`

封装 `IGPSportClient`，纯 `urllib.request` 实现，无浏览器依赖：

```
IGPSportClient(username, password)
  ├── login()                          → POST /service/auth/account/login
  │                                       body: {username, password, appId: "igpsport-web"}
  │                                       存储 self.token (Bearer)
  ├── get_all_activities()             → GET queryMyActivity?pageNo=&pageSize=20&reqType=0&sort=1
  │                                       分页直到 totalPage，返回 list[dict]
  │                                       每条含 rideId, startTime, rideDistance, totalMovingTime
  └── download_file(ride_id, dst_path) → GET getDownloadUrl/{ride_id}
                                          → 流式下载到 dst_path.part，完成后 rename
                                          三次重试，失败清理 .part 文件
```

**文件命名**：`iGPSport_{ride_id}_{YYYYMMDD-HHMMSS}.fit`
**去重策略**：glob `input/iGPSport_{ride_id}_*.fit`，命中则跳过（与顽鹿策略一致）
**全量模式**：`full=True` 时跳过去重检查，强制重新下载

### `app.py` 变更

**新增函数：**

- `_load_igpsport_credentials() → dict | None`
  读取 `config.json` 中 `igpsport_username` / `igpsport_password`

- `_run_igpsport_sync(full: bool)`
  后台线程执行流程：
  1. 读取凭据，无则报错
  2. `IGPSportClient.login()`
  3. `get_all_activities()` 获取全量列表
  4. 过滤已存在文件（非 full 模式）
  5. 逐一下载，`_set_sync()` 推进进度
  6. 下载完成后失效 `_actActivities` 缓存

**新增路由：**

- `POST /api/sync/start`
  body: `{platform: "onelap"|"igpsport", full: bool}`
  - `platform="onelap"` → 启动 `_run_sync()` 线程
  - `platform="igpsport"` → 启动 `_run_igpsport_sync()` 线程
  - 同时运行时返回 409

- `GET /api/sync/status`
  返回共享 `_sync` 状态对象（与 `/api/onelap/status` 完全相同）

**保留不变：**

- `/api/onelap/sync` POST — 原样保留（别名）
- `/api/onelap/status` GET — 原样保留（别名）

### `config.json` / `config.template.json`

新增字段：

```json
"igpsport_username": "",
"igpsport_password": ""
```

`/api/config/raw` POST 的可编辑字段白名单同步新增这两个字段。

### 前端变更

**`templates/index.html`：**

1. Files view 按钮文字：`顽鹿同步` → `FIT 同步`
2. sync-modal `modal-title`：`从顽鹿同步` → `FIT 同步`
3. sync-modal idle view 新增平台选择器（radio）：
   - 顽鹿（OneLap）：原有说明文字
   - iGPSport：显示"将自动使用设置中配置的账号密码登录"
4. 设置弹窗新增 `iGPSport` section（用户名 + 密码字段），紧跟顽鹿 section 后

**`static/app.js`：**

1. `startSync()` — 读平台 radio 值，`POST /api/sync/start` 带 `{platform, full}`
2. `_pollSync()` — 改为轮询 `GET /api/sync/status`（旧 `/api/onelap/status`）
3. 设置 load：补充读取 `cfg.igpsport_username` / `cfg.igpsport_password`
4. 设置 save：补充写入 `igpsport_username` / `igpsport_password`

## 数据流

```
用户点 "FIT 同步"
  → 弹窗显示平台选择 + 全量复选框
  → 选择平台，点开始
  → POST /api/sync/start {platform, full}
  → 后台线程执行对应 _run_*_sync()
    → _set_sync() 推进状态
  → 前端每 1.5s 轮询 GET /api/sync/status
  → 完成后刷新文件库 + 活动列表
```

## 错误处理

- iGPSPORT 未配置凭据：`_run_igpsport_sync` 立即 `_set_sync(state="error", message="iGPSport 未配置账号密码")`
- 登录失败：`state="error"` + 原始错误信息
- 单文件下载失败：记录跳过，继续其余文件，最终状态仍为 `done`（消息中注明失败数）
- 并发同步：409 返回 `{"error": "同步正在进行中"}`

## 不在范围内

- iGPSPORT GCJ-02 坐标解密（暂不处理，与顽鹿新固件行为对齐后续再加）
- iGPSPORT OAuth / token 刷新（access_token 一次登录有效，失效重新登录）
