# FAFA — Fit Analysis & Functional Aggregator

解析、纠偏、可视化骑行 FIT 文件的工具集，包含五视图交互式 Web 查看器和命令行分析工具。

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
│   ├── strava.py       # Strava 上传集成（OAuth / token 刷新 / 去重状态）
│   └── tools/
│       ├── fix_coords.py   # FIT 文件坐标系批量纠偏
│       ├── rename_fit.py   # Magene FIT 文件批量重命名
│       ├── export_all.py   # 批量导出 JSON（供 AI 使用）
│       ├── download_fit.py # 从顽鹿批量下载 FIT 文件（CLI）
│       └── ant_analysis.py # ANT+ 设备连接时长分析
├── templates/
│   └── index.html      # Web 前端页面（双界面）
└── static/
    ├── app.js          # 前端逻辑（Leaflet / Chart.js / 拖拽 / 导出）
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

主要功能入口，基于 Flask + Leaflet.js + Chart.js 的多视图交互查看器。左侧固定侧边栏通过图标切换六个顶层视图：骑行记录、骑行轨迹、体能管理、训练日历、文件管理。侧边栏底部提供深色 / 浅色主题切换和「设置」面板（FTP / 最大心率 / AI 配置 / 顽鹿账密 / Strava 凭证一体化编辑）。

**macOS / Linux：**
```bash
venv/bin/python app.py
```
**Windows：**
```bat
venv\Scripts\python app.py
```
然后访问 http://localhost:5173

### 活动视图（默认启动视图）

按月分组展示所有骑行活动卡片，支持年份 / 月份下拉筛选和距离预设按钮。底部汇总栏显示当前筛选集的总里程、时长等统计。

| 功能 | 说明 |
|---|---|
| 月份分组 | 活动按年月分组，每组显示当月总里程 |
| 筛选 | 年份 / 月份下拉 + 距离预设按钮，实时过滤 |
| 多选模式 | 长按或点击「选择」进入多选，支持批量加载轨迹、批量上传到 Strava、批量删除 |
| 汇总栏 | 显示当前筛选集的总骑行次数、总里程、总时长 |
| 点击卡片 | 打开骑行详情视图（全屏覆盖层） |
| AI 分析 | 每条活动卡片附带 AI 按钮，点击弹窗流式显示本次骑行 AI 评估 |
| 路线热图（卡片按钮） | 每条卡片附带「路线热图」按钮，点击加载该条路径并直接进入骑行详情视图的路线热图标签 |
| 加载全部轨迹 | 骑行记录标题栏按钮，将当前筛选集全部加载到骑行轨迹视图 |

### 骑行轨迹视图

拖拽 `.fit` 文件到地图区域即可加载，或从活动 / 文件视图中选取。支持同时叠加任意数量的路径。

| 功能 | 说明 |
|---|---|
| 拖拽上传 | 将 `.fit` 文件直接拖入地图区域 |
| 多路径叠加 | 支持同时加载任意数量的 FIT 文件 |
| 路径闪烁 | 鼠标悬停路径面板条目时，地图上对应路线闪烁高亮 |
| 底图切换 | 深色地图 / 深色路网 / 浅色地图 / 浅色路网 / 高德地图 |
| 坐标模式 | 每条路径独立提供：原始坐标 / 火星解密（GCJ-02→WGS-84）/ 火星加密（WGS-84→GCJ-02） |
| 坐标写回 | 文件库中的路径切换坐标模式后可写回 FIT 文件（通过 `/api/fix_coords`） |
| 缩放拉柄 | 右侧竖向拉柄，拖动控制地图缩放（1–18 级，平滑过渡） |
| 路径面板 | 底部居中面板，展示已加载路径列表（按时间倒序排列）；支持拖拽调整高度、点击标题栏折叠/展开 |
| 概览数据 | 每条路径显示里程、时长、均速、爬升、心率、功率等摘要标签 |
| 数据导出 | 每条路径可独立导出 JSON（含 summary + 逐公里数据）或 CSV |
| 定位 | 点击色块定位到该路径；点击文件名进入骑行详情视图 |
| PNG 导出 | 纯画布渲染，支持地图背景 / 颜色模式 / 比例 / 分辨率选项 |
| 一键清除 | 清除所有已加载路径 |
| 全量导出 JSON | 将 `input/` 下所有 FIT 文件解析后打包下载（可选去除逐公里数据、过滤短骑行） |

**PNG 导出选项：**

| 选项 | 可选值 |
|---|---|
| 地图背景 | 深色地图 / 深色路网 / 浅色地图 / 浅色路网 |
| 颜色模式 | 热力图（可选颜色，重叠路线累积透明度）/ 单一颜色 / 不同颜色 |
| 画面比例 | 16:9 / 4:3 |
| 分辨率 | 4K / 2K / 1080P |

### 文件视图

管理 `input/` 目录下的 FIT 文件库。

| 功能 | 说明 |
|---|---|
| 搜索 | 按文件名搜索 |
| Magene 时间筛选 | 年 / 月筛选芯片（仅对 Magene 文件名格式生效） |
| 单文件加载 | 将单个文件加载到地图视图 |
| 多选模式 | 点击「选择」进入多选，支持批量加载到地图、批量删除 |
| 导入 FIT | 点击按钮上传本地 `.fit` 文件 |
| 顽鹿同步 | 触发顽鹿增量下载 |

### 骑行详情视图（全屏覆盖）

点击活动卡片或地图面板中的路径名进入，按多种分段方式展示该次骑行数据。按 `Esc` 或点击返回按钮退出。

| 功能 | 说明 |
|---|---|
| 概览条 | 顶部展示总里程、时长、均速、爬升、心率、功率 |
| 折线图 | 所有有数据的指标同时展示为堆叠折线图（速度 / 心率 / 功率 / 踏频 / 海拔 / 坡度），x 轴为实时时间（秒级），鼠标拖拽选区可同步缩放所有图表，双击或点击「重置缩放」还原 |
| 数据表 | 底部按公里 / 分钟分段分行展示所有数据，表头吸顶，仅展示有数据的列；可拖拽上边缘调整高度 |
| 路线热图 | 切换「路线热图」标签，在地图上按选定指标（速度渐变 / 心率区间 / Coggan 功率区间 / 坡度双色）渲染路线，悬停显示数值 |
| 数据导出 | 顶部栏提供 JSON / CSV 导出按钮 |
| AI 评估 | 调用配置的 AI 对本次骑行进行流式评估 |

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

### 顽鹿同步

从 Web 界面一键同步顽鹿（OneLap）平台的骑行记录到 `input/` 目录。

- 支持增量下载（只拉取本地尚未存在的新活动）或全量下载
- `ai_config.json` 中配置 `onelap_username` / `onelap_password` 后同步时自动登录，无需弹出浏览器
- 未配置账密则弹出 Chromium 浏览器窗口完成登录（90 秒超时）
- 新版 Magene 固件的 FIT 文件下载后自动进行火星解密：C506 版本 ≥ 19，C706 版本 ≥ 20

### Strava 上传

将 `input/` 中的骑行活动上传到 Strava，支持差分上传和多选批量上传。

**配置步骤：**
1. 在 [Strava 开发者控制台](https://www.strava.com/settings/api) 创建 App，将回调域名设为 `localhost`
2. 将 `Client ID` 和 `Client Secret` 填入 `ai_config.json` 的 `strava_client_id` / `strava_client_secret`
3. 在活动视图点击「全部上传 Strava」→ 首次需在弹窗中点击「授权 Strava」完成 OAuth（token 自动保存到 `ai_config.json`）
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

分析 FIT 文件中各 ANT+ 设备（心率带、功率计、踏频/速度传感器、Di2 变速、BLE 车灯等）的连接时长及占骑行时间的百分比。连接窗口从 `record_mesgs` 逐帧推算；Di2、雷达等无帧级指标的设备仅显示「已注册」。

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

### 1. 创建配置文件

将项目根目录下的模板文件复制一份：

```bash
cp config.template.json ai_config.json
```

### 2. 编辑配置

用文本编辑器打开 `ai_config.json`，填入你的 API 信息：

```json
{
  "api_base": "https://api.openai.com/v1",
  "api_key": "sk-...",
  "model": "gpt-4o-mini",
  "max_tokens": 2500,
  "onelap_username": "",
  "onelap_password": "",
  "strava_client_id": "",
  "strava_client_secret": "",
  "strava_access_token": "",
  "strava_refresh_token": "",
  "strava_expires_at": 0,
  "strava_redirect_port": 5173,
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
| `strava_client_id` | ❌ | Strava API App 的 Client ID，填写后可将活动上传到 Strava |
| `strava_client_secret` | ❌ | Strava API App 的 Client Secret |
| `strava_access_token` | ❌ | 由 OAuth 授权流程自动写入，无需手动填写 |
| `strava_refresh_token` | ❌ | 同上，OAuth 授权后自动写入 |
| `strava_redirect_port` | ❌ | OAuth 回调端口，默认 `5173`（与 Flask 服务端口一致） |

### 常见 API 服务示例

| 服务 | `api_base` | 模型示例 |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | `gpt-4o`、`gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat` |
| Moonshot (Kimi) | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |
| 阿里云百炼 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| Ollama（本地） | `http://localhost:11434/v1` | `qwen2.5:7b` |

> **注意：** `ai_config.json` 已被 `.gitignore` 排除，不会提交到版本库，请勿将含有真实 API Key 的文件公开。

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
| Garmin 等国际设备 | WGS-84 | CartoDB（直接可用）|

Web 查看器在前端实时进行坐标转换，无需预处理文件；`fafa.tools.fix_coords` 可将转换结果永久写入 FIT 文件。

---

## 依赖

| 包 | 用途 |
|---|---|
| `garmin-fit-sdk` | FIT 文件解码 / 编码 |
| `flask` | Web API 服务 |
| `folium` | CLI 工具 HTML 地图生成 |
| `requests` | 顽鹿 API 请求 |
| `DrissionPage` | 顽鹿浏览器登录（Chromium 自动化） |
