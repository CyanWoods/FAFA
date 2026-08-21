# FAFA — Fit Analysis & Functional Aggregator

解析、纠偏、可视化骑行 FIT 文件的工具集，包含七视图交互式 Web 查看器和命令行分析工具。

支持 Garmin、Magene 等设备导出的 `.fit` 格式文件。

---

## 目录结构

```
FAFA/
├── app.py              # Flask Web 服务（主入口）
├── fafa/
│   ├── parser.py       # FIT 文件解码（Record / FitData 数据结构）
│   ├── gcj02.py        # WGS-84 ↔ GCJ-02 坐标转换
│   ├── tiles.py        # 地图瓦片预设（folium 用）
│   ├── stats.py        # 分段统计（KmStats / Summary）
│   ├── reporter.py     # 表格 / JSON / CSV 输出
│   ├── onelap.py       # 顽鹿 API 客户端（登录 / 列表 / 下载）
│   ├── igpsport.py     # iGPSport API 客户端（登录 / 列表 / 下载）
│   ├── strava.py       # Strava 上传集成（OAuth / token 刷新 / 去重状态）
│   ├── auth.py         # 用户、角色、授权码及加密配置存储
│   ├── config_schema.py # 配置字段类型与敏感字段定义
│   ├── db.py           # SQLite 活动元数据（标签 / 备注，存于 input/fafa.db）
│   └── tools/
│       ├── fix_coords.py   # FIT 文件坐标系批量纠偏
│       ├── rename_fit.py   # Magene FIT 文件批量重命名
│       ├── export_all.py   # 批量导出 JSON（供 AI 使用）
│       ├── download_fit.py # 从顽鹿批量下载 FIT 文件（CLI）
│       └── ant_analysis.py # ANT+ 设备连接时长分析
├── templates/
│   └── index.html      # Web 前端页面（多视图）
└── static/
    ├── app.js          # 前端逻辑（Leaflet / ECharts / 拖拽 / 导出）
    └── style.css       # 前端样式
```

---

## 安装

**macOS / Linux：**
```bash
python3 -m venv venv
venv/bin/pip install -r requirements.txt
```

**Windows：**
```bat
python -m venv venv
venv\Scripts\pip install -r requirements.txt
```

---

## Web 可视化工具

主要功能入口，基于 Flask + Leaflet.js + ECharts 的多视图交互查看器。左侧固定侧边栏通过图标切换七个顶层视图：骑行记录、骑行轨迹、体能管理、训练日历、文件管理、设置、关于；底部提供深色 / 浅色主题切换。

**macOS / Linux：**
```bash
venv/bin/python app.py           # 本地单用户模式（默认）
venv/bin/python app.py --server  # 服务器多用户模式（启用登录验证）
```
**Windows：**
```bat
venv\Scripts\python app.py
venv\Scripts\python app.py --server
```
然后访问 http://localhost:5173

支持通过环境变量覆盖监听地址：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `FAFA_HOST` | 本地模式 `127.0.0.1`；服务模式 `0.0.0.0` | 监听 IP |
| `FAFA_PORT` | `5173` | 监听端口 |
| `FAFA_ALLOW_INSECURE_REMOTE` | `0` | 设为 `1` 时允许无鉴权的本地模式监听非回环地址；不推荐，远程访问应使用 `--server` |
| `FAFA_SERVER` | — | 设为 `1` 启用多用户服务模式 |
| `FAFA_SECRET` | — | 服务模式必填；用于 Flask session 签名，并经 HKDF 派生用户配置加密密钥。轮换后原有加密凭证需重新填写 |
| `FAFA_PROXY_HOPS` | `0` | 可信反向代理层数；仅在应用端口不对外暴露时设置，`start.sh` 默认为 `1` |

**Docker 部署：**
```bash
docker build -t fafa .
docker run -d \
  -p 5173:5173 \
  -e FAFA_SECRET=$(python3 -c "import secrets; print(secrets.token_hex(32))") \
  -v /data/fafa/input:/app/input \
  -v /data/fafa/users.db:/app/users.db \
  fafa
```

# 多平台镜像构建（macOS / Linux，需要 Docker buildx）
./buildx.sh                           # linux/amd64 + linux/arm64
./buildx.sh linux/amd64 --no-cache    # 仅 amd64，禁用缓存
```

### 活动视图（默认启动视图）

按月分组展示所有骑行活动卡片，支持年份 / 月份下拉筛选和距离预设按钮。底部汇总栏显示当前筛选集的总里程、时长等统计。

| 功能 | 说明 |
|---|---|
| 月份分组 | 活动按年月分组，每组显示当月总里程 |
| 筛选 | 年份 / 月份下拉 + 距离预设按钮，实时过滤 |
| 多选模式 | 长按或点击「选择」进入多选，支持批量加载轨迹、批量修改标签、批量上传到 Strava、批量删除、汇总海报、图表对比、AI 对比分析 |
| 汇总海报 | 选择 1–50 条活动后生成路线合集海报，汇总距离、时长、均速、爬升及可用的功率 / 心率数据；支持深浅主题、3:4 / 9:16、字段开关和起终点隐私保护 |
| 图表对比 | 多选 2 条以上活动，点击「图表对比」打开三视图弹窗：**聚合指标**（关键指标表 + Δ% 对比、峰值功率曲线、功率区间分布）、**逐公里**（按真实 km 叠加，可切换速度 / 心率 / 功率 / 踏频 / 海拔）、**行程 %**（归一到 0–100% 行程，跨距离比较配速策略）。均速经风力归一化后再对比，不依赖 AI |
| AI 对比分析 | 多选模式下选中 2 条以上活动，点击「AI 对比」弹窗流式展示骑行横向对比分析 |
| 汇总栏 | 显示当前筛选集的总骑行次数、总里程、总时长 |
| 点击卡片 | 打开骑行详情视图（全屏覆盖层） |
| AI 分析 | 每条活动卡片附带 AI 按钮，点击弹窗流式显示本次骑行 AI 评估 |
| 路线热图（卡片按钮） | 每条卡片附带「路线热图」按钮，点击加载该条路径并进入骑行详情视图 |
| 加载全部轨迹 | 骑行记录标题栏按钮，将当前筛选集全部加载到骑行轨迹视图 |

### 骑行轨迹视图

拖拽 `.fit` 文件到地图区域即可加载，或从活动 / 文件视图中选取。支持同时叠加任意数量的路径。

| 功能 | 说明 |
|---|---|
| 拖拽上传 | 将 `.fit` 文件直接拖入地图区域 |
| 多路径叠加 | 支持同时加载任意数量的 FIT 文件 |
| 路径闪烁 | 鼠标悬停路径面板条目时，地图上对应路线闪烁高亮 |
| 底图切换 | CARTO 深色地图 / 深色路网 / 浅色地图 / 浅色路网，以及高德地图 |
| 默认底图 | 在「设置 → 地图」中保存；顶部下拉框仅临时切换当前会话 |
| 坐标模式 | 每条路径独立提供：原始坐标 / 火星解密（GCJ-02→WGS-84）/ 火星加密（WGS-84→GCJ-02） |
| 坐标写回 | 文件库中的路径切换坐标模式后可写回 FIT 文件（通过 `/api/fix_coords`） |
| 缩放拉柄 | 右侧竖向拉柄，拖动控制地图缩放（1–18 级，平滑过渡） |
| 路径面板 | 底部居中面板，展示已加载路径列表（按时间倒序排列）；支持拖拽调整高度、点击标题栏折叠/展开 |
| 概览数据 | 每条路径显示里程、时长、均速、爬升、心率、功率等摘要标签 |
| 数据导出 | 每条路径可独立导出 JSON（含 summary + 逐公里数据）或 CSV |
| 定位 | 点击色块定位到该路径；点击文件名进入骑行详情视图 |
| PNG 导出 | 纯画布渲染，支持地图背景 / 颜色模式 / 比例 / 分辨率 / 水印选项 |
| 一键清除 | 清除所有已加载路径 |
| 全量导出 JSON | 将 `input/` 下所有 FIT 文件解析后打包下载（可选去除逐公里数据、过滤短骑行） |

**PNG 导出选项：**

| 选项 | 可选值 |
|---|---|
| 地图背景 | 深色地图 / 深色路网 / 浅色地图 / 浅色路网 |
| 颜色模式 | 热力图（可选颜色，重叠路线累积透明度）/ 单一颜色 / 不同颜色 |
| 画面比例 | 16:9 / 4:3 |
| 分辨率 | 4K / 2K / 1080P |
| 水印 | 可选；右下角显示骑行总里程 / 平均 / 最大单程 / 次数（2×2），左下角显示用户名 |
| 分组距离阈值 | 路径中心点间距超过阈值时分组输出多张图（`_1`、`_2` 文件名后缀），默认 500 km |

### 文件视图

管理 `input/` 目录下的 FIT 文件库。

| 功能 | 说明 |
|---|---|
| 搜索 | 按文件名搜索 |
| Magene 时间筛选 | 年 / 月筛选芯片（仅对 Magene 文件名格式生效） |
| 单文件加载 | 将单个文件加载到地图视图 |
| 多选模式 | 点击「选择」进入多选，支持批量加载到地图、批量删除 |
| 导入 FIT | 点击按钮上传本地 `.fit` 文件 |
| FIT 同步 | 触发顽鹿（OneLap）或 iGPSport 增量下载 |

### 设置视图

侧边栏第六个视图，将原先左下角的设置弹窗提升为独立分页，按功能分栏卡片布局：外观与地图、PMC 参数、路线热图范围、风向数据源、AI 配置、同步账号（顽鹿 / iGPSport / Strava）。服务器模式下额外提供「账户」「授权码 (API)」栏；管理员账号还会看到「管理员」栏。

**账户** —— 仅服务器模式可用，管理自己的账号：

- 头像：上传图片经像素上限校验后等比例缩放至 512px 内并转存 PNG（剥离原图全部 EXIF/元数据），存于数据库，不落文件系统。
- 显示名：可选的展示用别名，不影响登录用户名。
- 修改密码：需先验证当前密码。

**管理员** —— 仅管理员账号可见，全站用户列表与管理操作：查看每个用户的存储占用（含配额百分比）、fit 文件数、有效授权码数、创建/最后登录时间；可重置任意用户密码、冻结/解冻账号（冻结立即踢出在线会话并禁止再登录）、提升/降级管理员身份、删除账号（**不会**删除该用户的 fit 文件，仅移除账号本身）。出于安全考虑，管理员不能对自己执行这些操作（要卸任找另一位管理员）；这些操作只能在浏览器登录会话中进行，授权码（哪怕是「读写」范围）无法调用管理员接口。

首次部署时还没有任何管理员，需要用命令行创建第一个：

```bash
venv/bin/python -m fafa.tools.manage_users promote <username>
```

之后新增管理员就可以在网页「管理员」栏里操作，不必再用命令行。

**旧配置批量迁移** —— 升级前先使用与线上服务完全相同的 `FAFA_SECRET` 预检，再执行迁移：

```bash
FAFA_SECRET=<线上密钥> venv/bin/python scripts/migrate_config_to_db.py --dry-run
FAFA_SECRET=<线上密钥> venv/bin/python scripts/migrate_config_to_db.py
```

脚本默认扫描 `users.db` 中的所有用户及其 `input/<username>/config.json`；可重复传入 `--username USER` 缩小范围，也可用 `--username USER --config PATH` 指定单个来源文件。它不会覆盖数据库中已有配置，迁移成功后会将明文原文件归档为首个未占用的 `config.json.bak[.N]`。单用户也可运行 `venv/bin/python -m fafa.tools.manage_users migrate-config <username>`。

**授权码（API）** —— 仅服务器模式可用，以编程方式访问 `/api/v1`：

- 在设置视图生成命名授权码，明文**仅生成时显示一次**，服务端只保存 sha256 哈希；可设可选有效期、随时撤销。
- 每个授权码有一个**授权范围**：默认「只读」；生成时勾选「允许写入」得到「读写」授权码，才能调用上传/删除文件、触发同步这几个写接口。已发出的旧授权码永远是只读，不会因为升级被动提权。
- 所有请求头带 `Authorization: Bearer <授权码>`；Bearer 鉴权天然不受 CSRF 影响（不会被浏览器自动附带），所以 `/api/v1` 下带 Bearer 头的请求豁免了同源校验，其余接口（含会话 Cookie 鉴权）不受影响。

```bash
# 只读：列出活动
curl -H "Authorization: Bearer fafa_xxxxxxxx_..." https://<host>/api/v1/activities

# 只读：单条活动详情 / 逐点结构化数据（含 lat/lon/hr/power/grade 等全字段）
curl -H "Authorization: Bearer $TOKEN" https://<host>/api/v1/activities/<文件名>
curl -H "Authorization: Bearer $TOKEN" https://<host>/api/v1/records/<文件名>

# 读写：上传 .fit 文件（直接存入库，非预览）
curl -H "Authorization: Bearer $RW_TOKEN" -F "file=@ride.fit" https://<host>/api/v1/files

# 读写：删除库内文件
curl -H "Authorization: Bearer $RW_TOKEN" -X DELETE https://<host>/api/v1/files/<文件名>

# 读写：触发 OneLap / iGPSport 同步，及查询同步状态
curl -H "Authorization: Bearer $RW_TOKEN" -X POST https://<host>/api/v1/sync \
     -H "Content-Type: application/json" -d '{"platform":"onelap","full":false}'
curl -H "Authorization: Bearer $RW_TOKEN" https://<host>/api/v1/sync/status
```

| 接口 | 方法 | 所需范围 | 说明 |
|---|---|---|---|
| `/api/v1/activities` | GET | 只读 | 活动列表 |
| `/api/v1/activities/<文件名>` | GET | 只读 | 单条活动摘要 + 逐公里统计 |
| `/api/v1/records/<文件名>` | GET | 只读 | 逐点结构化数据（全字段） |
| `/api/v1/files` | POST | 读写 | 上传 `.fit` 并持久化到库（受全局请求上限约束，单文件 ≤16MB；超出用户存储配额拒绝，同名文件已存在返回 409） |
| `/api/v1/files/<文件名>` | DELETE | 读写 | 删除库内文件 |
| `/api/v1/sync` | POST | 读写 | 触发 OneLap/iGPSport 同步（复用网页端同步逻辑，同一时间每用户只能有一个同步任务） |
| `/api/v1/sync/status` | GET | 只读 | 查询同步任务状态 |

### 关于视图

侧边栏第七个视图，展示当前版本号（来自项目根目录 `version` 文件）和各功能视图的简要说明。

### 骑行详情视图（全屏覆盖）

点击活动卡片或地图面板中的路径名进入，按多种分段方式展示该次骑行数据。按 `Esc` 或点击返回按钮退出。

| 功能 | 说明 |
|---|---|
| 概览条 | 顶部展示总里程、时长、均速、爬升、心率、功率、流畅度等核心数据，L/R 平衡、风况等辅助数据弱化展示于下方；标签与备注同区编辑 |
| 总览 / 对比分析 | 图表区顶部两个独立标签切换：**总览**含折线图、区间分布、坡度分布/爬坡段；**对比分析**含体力衰竭、分段平行对比；地图区常驻两个标签共用 |
| 折线图 | 展示所有有数据的指标堆叠折线图（速度 / 心率 / 功率 / 踏频 / 海拔 / 坡度），x 轴为实时时间（秒级），鼠标拖拽选区可同步缩放所有图表，双击或点击「重置缩放」还原 |
| 路线热图 | 右侧同步展示路线热图，按选定指标（速度渐变 / 心率区间 / Coggan 功率区间 / 坡度双色）着色；悬停折线图时地图实时标记对应位置；点击地图左侧 ⊡ 按钮重置视角；「⧉ 浮窗 / ⊞ 双栏」布局切换按钮位于地图工具条内 |
| 分栏调整 | 拖拽折线图与热图之间的竖向拉柄可自由调整两者宽度比例，双击重置 50/50 |
| 区间分布 | 折线图下方并排展示功率分布（Coggan 7 区，按 FTP）与心率分布（按最大心率百分比）柱状图，分区原则与体能管理页一致 |
| 体力衰竭 | 有氧解耦（Pw:HR，无功率时退回 速度:HR）：以效率因子曲线呈现前后半程漂移，给出解耦率（前半 − 后半效率的百分比变化）及分级（<5% 良好 / 5–8% 轻度 / >8% 明显）。仅对稳态骑行有参考意义；悬停曲线同步在地图上标记对应位置 |
| 分段平行对比 | 「添加起点」在地图上点击放置分段起点，拖拽移动、滚轮调半径、双击删除，轨迹进入起点范围处即切一段边界，实时重算；各段按「第一圈/第二圈…」顺序命名与配色，起点距离归零后按距离叠加同一指标曲线（可切速度 / 心率 / 功率 / 踏频 / 海拔）；悬停曲线在地图上按各段实际里程同步打点，光标处按段顺序列出各段数值 |
| 坡度分布 / 爬坡段 | 逐点坡度平滑后按距离加权分档（下坡 / 0–4 / 4–7 / 7–10 / 10–13 / 13–16 / >16%，climbfinder 风格），以竖柱图与功率 / 心率分布并排展示；连续爬坡段（≥200m 且均坡≥2.5%）另以卡片列出距离 / 爬升 / 均坡 / 最大坡 |
| 数据表 | 底部按公里 / 分钟分段分行展示所有数据，表头吸顶，仅展示有数据的列；**默认折叠**，点击表头可展开 / 收起 |
| 浮窗地图 | 详情页地图可切为浮窗：拖动标题栏移动、任意边 / 角缩放，图表随之全宽展示 |
| 分享 | 骑行详情「分享」打开分享弹窗，含「3D 预览」（Three.js 交互式路线：旋转 / 转速 / 六种配色 / 指北罗盘 / 按 EXIF 贴照片）与「海报」（渲染为高清 PNG，可编辑标题 / 副标题、切换主题与画幅，默认隐藏起终点附近约 800 米轨迹） |
| AI 评估 | 调用配置的 AI 对本次骑行进行流式评估 |

### 骑行分享海报

海报完全在浏览器内通过 Canvas 生成，不上传也不在服务器保存。单条详情生成路线型海报；活动多选生成汇总型海报。地图使用可安全写入 Canvas 的 CARTO 深色 / 浅色无标注瓦片，服务不可用时仍可使用纯色底图绘制路线。

| 选项 | 可选值 / 行为 |
|---|---|
| 入口 | 骑行详情「分享」→「海报」标签；活动多选「汇总海报」 |
| 海报主题 | 深色 / 浅色 |
| 图片比例 | 3:4（1440×1920）/ 9:16（1080×1920） |
| 展示数据 | 距离、时长、均速、爬升、功率、心率、踏频；无数据项自动禁用 |
| 隐私保护 | 默认过滤每条路线起终点 800 米半径内的轨迹点，可手动关闭 |
| 导出 | 高清 PNG，文件名取自用户填写的海报标题 |

### 体能管理视图（全屏覆盖）

点击侧边栏「体能管理」图标进入。

| 功能 | 说明 |
|---|---|
| CTL / ATL / TSB | 体能 / 疲劳 / 状态曲线，支持日期范围选择 |
| 功率曲线 | 各时长最大平均功率曲线 |
| 区间分布 | 各功率 / 心率训练区间的时间分布 |
| AI 训练状态分析 | 点击「AI 分析」弹窗流式显示基于当前 PMC 数据的训练点评 |

### 训练日历视图（全屏覆盖）

点击侧边栏「训练日历」图标进入，按月展示每日骑行活动，点击可查看当日详情。

| 功能 | 说明 |
|---|---|
| 月历视图 | 按月展示每日骑行概览，支持月份导航 |
| 当日详情 | 点击日历格子弹出当日活动详情 |
| AI 一周建议 | 弹窗流式显示基于近一周训练的 AI 建议 |
| AI 月度建议 | 弹窗流式显示基于近一个月训练的 AI 建议 |

### FIT 同步

从 Web 界面点击「FIT 同步」按钮，选择平台后一键同步骑行记录到 `input/` 目录。支持顽鹿（OneLap）和 iGPSport 两个平台。

**顽鹿（OneLap）：**
- 支持增量下载（只拉取本地尚未存在的新活动）或全量下载
- 在「设置 → 同步账号」中配置 `onelap_username` / `onelap_password` 后自动登录，无需弹出浏览器
- 未配置账密则弹出 Chromium 浏览器窗口完成登录（90 秒超时）
- 新版 Magene 固件的 FIT 文件下载后自动进行火星解密：C506 版本 ≥ 19，C706 版本 ≥ 20

**iGPSport：**
- 支持增量下载（按 `ride_id` glob 匹配去重）或全量下载
- 在「设置 → 同步账号」中配置 `igpsport_username` / `igpsport_password` 后自动登录
- 文件命名格式：`iGPSport_{ride_id}_{YYYYMMDD-HHMMSS}.fit`
- iGPSport 文件为 WGS-84 坐标系，无需火星解密

### Strava 上传

将 `input/` 中的骑行活动上传到 Strava，支持差分上传和多选批量上传。

**配置步骤：**
1. 在 [Strava 开发者控制台](https://www.strava.com/settings/api) 创建 App，将回调域名设为部署时的域名（本地运行填 `localhost`，服务器部署填实际域名）
2. 在「设置 → 同步账号」中填写 `strava_client_id` / `strava_client_secret`
3. 在活动视图点击「全部上传 Strava」→ 首次需在弹窗中点击「授权 Strava」完成 OAuth（token 加密保存到 `users.db`）
4. 授权后点击「全部上传 Strava」会先查询 Strava 已有活动列表，弹窗显示「本地 M 个，Strava 已有 K 个，待上传 N 个」，确认后仅上传差集

**去重逻辑：**
- 优先按 `external_id`（上传时设为文件名）精确匹配
- 回退到开始时间 ±60 秒模糊匹配（覆盖从其他途径上传的历史活动）
- 多选模式下「上传 Strava」直接上传选中文件（跳过本地去重状态 `input/.strava_state.json` 中已标记的）

---

## 命令行工具

所有工具均以 Python 模块方式调用：

### `fafa.tools.fix_coords` — FIT 文件坐标纠偏

对 FIT 文件中的 GPS 坐标进行火星坐标系转换，支持批量处理。

```bash
# macOS / Linux
venv/bin/python -m fafa.tools.fix_coords --method decrypt          # 火星解密：GCJ-02 → WGS-84
venv/bin/python -m fafa.tools.fix_coords --method encrypt input/ -o output/fixed/
venv/bin/python -m fafa.tools.fix_coords --method decrypt --dry-run

# Windows
venv\Scripts\python -m fafa.tools.fix_coords --method decrypt
venv\Scripts\python -m fafa.tools.fix_coords --method encrypt input/ -o output/fixed/
venv\Scripts\python -m fafa.tools.fix_coords --method decrypt --dry-run
```

---

### `fafa.tools.rename_fit` — Magene FIT 文件重命名

将 Magene 设备导出的原始文件名转换为可读格式（CST/UTC+8）。

```
MAGENE_C506_1734220883_1266269_1734224483.fit
→ Magene_C506_1266269_20241215-080123.fit
```

```bash
# macOS / Linux
venv/bin/python -m fafa.tools.rename_fit
venv/bin/python -m fafa.tools.rename_fit --dry-run

# Windows
venv\Scripts\python -m fafa.tools.rename_fit
venv\Scripts\python -m fafa.tools.rename_fit --dry-run
```

---

### `fafa.tools.export_all` — 批量导出 JSON（供 AI 使用）

解析 `input/` 下所有 FIT 文件，输出包含骑行摘要和逐公里数据的 JSON。

```bash
# macOS / Linux
venv/bin/python -m fafa.tools.export_all
venv/bin/python -m fafa.tools.export_all --no-km-stats
venv/bin/python -m fafa.tools.export_all --min-km 5
venv/bin/python -m fafa.tools.export_all -o ~/Desktop/data.json

# Windows
venv\Scripts\python -m fafa.tools.export_all
venv\Scripts\python -m fafa.tools.export_all --no-km-stats
venv\Scripts\python -m fafa.tools.export_all --min-km 5
venv\Scripts\python -m fafa.tools.export_all -o %USERPROFILE%\Desktop\data.json
```

输出格式：
```json
{
  "meta": { "exported_at", "total_activities", "total_km", "date_range", "includes_km_stats" },
  "activities": [
    { "filename", "date", "summary": {...}, "km_stats": [{...}, ...] }
  ]
}
```

---

### `fafa.tools.download_fit` — 从顽鹿批量下载 FIT 文件

与 Web 界面顽鹿同步功能等价，适合在终端中使用。

```bash
# macOS / Linux
venv/bin/python -m fafa.tools.download_fit
venv/bin/python -m fafa.tools.download_fit --all
venv/bin/python -m fafa.tools.download_fit --dry-run
venv/bin/python -m fafa.tools.download_fit --limit 10

# Windows
venv\Scripts\python -m fafa.tools.download_fit
venv\Scripts\python -m fafa.tools.download_fit --all
venv\Scripts\python -m fafa.tools.download_fit --dry-run
venv\Scripts\python -m fafa.tools.download_fit --limit 10
```

---

### `fafa.tools.ant_analysis` — ANT+ 设备连接时长分析

分析 FIT 文件中各 ANT+ 设备（心率带、功率计、踏频/速度传感器、Di2 变速等）的连接时长及占骑行时间的百分比。连接窗口从 `record_mesgs` 逐帧推算；Di2/eTap 显示换挡事件记录（含方向箭头），255/255 事件标记为 `[重连?]`；BLE 设备不显示；所有时间戳转换为本地时间。

```bash
# macOS / Linux
venv/bin/python -m fafa.tools.ant_analysis input/xxx.fit
venv/bin/python -m fafa.tools.ant_analysis input/          # 批量分析整个目录
venv/bin/python -m fafa.tools.ant_analysis input/xxx.fit --gap 10   # 合并 10s 内的短暂断连
venv/bin/python -m fafa.tools.ant_analysis input/xxx.fit --json     # JSON 输出

# Windows
venv\Scripts\python -m fafa.tools.ant_analysis input\xxx.fit
venv\Scripts\python -m fafa.tools.ant_analysis input\
```

---

## AI 评估功能配置

Web 查看器内置三个 AI 功能：**单次骑行评估**（活动卡片或骑行详情视图点击「AI 分析」）、**PMC 训练状态分析**（体能管理视图）和**训练日历建议**（训练日历视图，支持一周 / 月度两种周期）。三者均需要配置一个 OpenAI 兼容的 API。

发给模型的提示词可以自定义：设置面板 →「AI 配置」→「编辑提示词模板…」。五份模板（单次评估 / 多骑行对比 / 体能管理 / 日历周建议 / 日历月建议）各自独立编辑，右侧变量面板可点击插入骑行数据占位符（如 `{{avg_power}}`、`{{#km_table}}`），并可调节逐公里表、逐分钟表等数据块的行数以控制 token 消耗。支持预览渲染结果、按版本回溯（每份模板滚动保留 5 个历史版本）和一键恢复默认——默认提示词内置于代码中，不会因误操作丢失。

### 1. 在设置视图填写

启动 Web 服务后进入「设置 → AI 配置」填写并保存。配置存入 `users.db` 的 `user_config` 表；API Key、同步平台密码和 Strava token 等敏感字段会用 `FAFA_SECRET` 派生的密钥加密。升级前遗留的每用户 `config.json` 会在首次访问时自动迁移并改名为 `config.json.bak`。

### 2. 字段参考

`config.template.json` 只用于提供默认值和字段说明，不应复制为运行时配置。主要字段如下：

```json
{
  "api_base": "https://api.openai.com/v1",
  "api_key": "sk-...",
  "model": "gpt-4o-mini",
  "max_tokens": 2500,
  "onelap_username": "",
  "onelap_password": "",
  "igpsport_username": "",
  "igpsport_password": "",
  "strava_client_id": "",
  "strava_client_secret": "",
  "strava_access_token": "",
  "strava_refresh_token": "",
  "strava_expires_at": 0,
  "strava_athlete_id": "",
  "strava_athlete_name": ""
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `api_key` | ✅ | 你的 API Key，留空或保留 `your-api-key-here` 时 AI 功能自动禁用 |
| `api_base` | ❌ | API 端点，默认 `https://api.openai.com/v1`，填入其他兼容服务地址即可切换 |
| `model` | ❌ | 模型名称，默认 `gpt-4o-mini` |
| `max_tokens` | ❌ | 单次回复最大 token 数，默认 `2500` |
| `onelap_username` | ❌ | 顽鹿账号，填写后顽鹿同步自动登录，无需弹出浏览器 |
| `onelap_password` | ❌ | 顽鹿密码 |
| `igpsport_username` | ❌ | iGPSport 账号，填写后 iGPSport 同步自动登录 |
| `igpsport_password` | ❌ | iGPSport 密码 |
| `strava_client_id` | ❌ | Strava API App 的 Client ID，填写后可将活动上传到 Strava |
| `strava_client_secret` | ❌ | Strava API App 的 Client Secret |
| `strava_access_token` | ❌ | 由 OAuth 授权流程自动写入，无需手动填写 |
| `strava_refresh_token` | ❌ | 同上，OAuth 授权后自动写入 |

### 常见 API 服务示例

| 服务 | `api_base` | 模型示例 |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o`、`gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat` |
| Moonshot (Kimi) | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| 阿里云百炼 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| 自建兼容服务 | `https://your-api.example/v1` | 服务支持的模型名 |

服务模式仅接受解析到公网地址的 HTTPS AI API，防止用户配置被用于访问内网服务。本地 Ollama 需要通过受信任的 HTTPS 反向代理接入。

> **注意：** `users.db` 和迁移后的 `config.json.bak` 都包含敏感数据，必须排除在版本控制之外并限制文件权限；备份时也应按凭证文件保护。

---

## 坐标系说明

FIT 文件中的 GPS 坐标以**半圆（semicircle）**存储：

```
度数 = 半圆值 × 180 / 2³¹
```

**坐标系差异：**

| 设备 | 坐标系 | 适配底图 |
|---|---|---|
| Magene 等国内设备 | GCJ-02（火星坐标） | 高德地图（直接可用）|
| Garmin 等国际设备 | WGS-84 | CARTO（直接可用）|

Web 查看器在前端实时进行坐标转换，无需预处理文件；`fafa.tools.fix_coords` 可将转换结果永久写入 FIT 文件。

底图服务不可达时，前端会提示切换地图，不会持续显示空白瓦片。

---

## 依赖

| 包 | 用途 |
|---|---|
| `garmin-fit-sdk` | FIT 文件解码 / 编码 |
| `flask` | Web API 服务 |
| `folium` | CLI 工具 HTML 地图生成 |
| `requests` | 顽鹿 API 请求 |
| `DrissionPage` | 顽鹿浏览器登录（Chromium 自动化） |

---

## 持续检查与自动修复

执行完整质量门禁（22 项检查：安全不变量、语法、依赖、前端资产、格式、运行时）：

```bash
venv/bin/python scripts/quality.py check
```

执行低风险自动修复（尾随空格、`__pycache__`、文件权限）后重新检查：

```bash
venv/bin/python scripts/quality.py fix
```

安装 Git pre-commit hook（首次 clone 后运行一次）：

```bash
bash scripts/install-hooks.sh
```

Gitea CI 会在每次 push 和 pull request 上运行同一质量门禁（CI 模式跳过本地专属检查）。

服务模式默认信任一层本机反向代理的 `X-Forwarded-For`、`X-Forwarded-Proto` 和 `X-Forwarded-Host`。代理层数不同时通过 `FAFA_PROXY_HOPS` 调整；直接暴露 Gunicorn 时应设置为 `0`。
