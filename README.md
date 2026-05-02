# FAFA — Fit Analysis & Functional Aggregator

解析、纠偏、可视化骑行 FIT 文件的工具集，包含双界面交互式 Web 查看器和命令行分析工具。

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
│   └── tools/
│       ├── fix_coords.py   # FIT 文件坐标系批量纠偏
│       ├── rename_fit.py   # Magene FIT 文件批量重命名
│       ├── export_all.py   # 批量导出 JSON（供 AI 使用）
│       └── download_fit.py # 从顽鹿批量下载 FIT 文件（CLI）
├── templates/
│   └── index.html      # Web 前端页面（双界面）
└── static/
    ├── app.js          # 前端逻辑（Leaflet / Chart.js / 拖拽 / 导出）
    └── style.css       # 前端样式
```

---

## 安装

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

---

## Web 可视化工具

主要功能入口，基于 Flask + Leaflet.js + Chart.js 的双界面交互查看器。

```bash
.venv/bin/python app.py
# 访问 http://localhost:5173
```

### 界面一：地图视图

拖拽 `.fit` 文件到地图区域即可加载，或从文件库中选取。支持同时叠加任意数量的路径。

| 功能 | 说明 |
|---|---|
| 拖拽上传 | 将 `.fit` 文件直接拖入地图区域 |
| 文件库 | 侧边抽屉列出 `input/` 目录下所有 FIT 文件，支持单个加载或全部加载 |
| 多路径叠加 | 支持同时加载任意数量的 FIT 文件 |
| 路径闪烁 | 鼠标悬停路径面板条目时，地图上对应路线闪烁高亮 |
| 底图切换 | 深色地图 / 深色路网 / 浅色地图 / 浅色路网 / 高德地图 |
| 坐标模式 | 每条路径独立提供：原始坐标 / 火星解密（GCJ-02→WGS-84）/ 火星加密（WGS-84→GCJ-02） |
| 坐标写回 | 文件库中的路径切换坐标模式后可写回 FIT 文件（通过 `/api/fix_coords`） |
| 缩放拉柄 | 右侧竖向拉柄，拖动控制地图缩放（1–18 级，平滑过渡） |
| 路径面板 | 底部居中面板，展示已加载路径列表；支持拖拽调整高度、点击标题栏折叠/展开 |
| 概览数据 | 每条路径显示里程、时长、均速、爬升、心率、功率等摘要标签 |
| 数据导出 | 每条路径可独立导出 JSON（含 summary + 逐公里数据）或 CSV |
| 定位 | 点击色块定位到该路径；点击文件名进入界面二 |
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

### 界面二：骑行详情

点击路径面板中的文件名进入，按多种分段方式展示该次骑行数据。按 `Esc` 或点击「← 返回」退出。

| 功能 | 说明 |
|---|---|
| 概览条 | 顶部展示总里程、时长、均速、爬升、心率、功率 |
| 折线图 | 按指标（速度 / 心率 / 功率 / 踏频 / 海拔 / 坡度）分别绘图；x 轴支持按距离（每 100 m）/ 按时间（每分钟）切换；仅展示该文件有数据的指标 |
| 路线热力图 | 将选定指标的高低值映射为蓝→红色阶叠加在地图上，直观展示路线各段表现 |
| 数据表 | 底部按分段分行展示所有数据，表头吸顶，仅展示有数据的列 |
| 数据导出 | 顶部栏提供 JSON / CSV 导出按钮 |

### 顽鹿同步

从 Web 界面一键同步顽鹿（OneLap）平台的骑行记录到 `input/` 目录。

- 支持增量下载（只拉取本地尚未存在的新活动）或全量下载
- 弹出 Chromium 浏览器窗口完成登录（90 秒超时）
- 新版 Magene 固件（software version > 18）的 FIT 文件下载后自动进行火星解密

---

## 命令行工具

所有工具均以 Python 模块方式调用：

### `fafa.tools.fix_coords` — FIT 文件坐标纠偏

对 FIT 文件中的 GPS 坐标进行火星坐标系转换，支持批量处理。

```bash
# 火星解密：GCJ-02 → WGS-84（Magene 等国内设备）
.venv/bin/python -m fafa.tools.fix_coords --method decrypt

# 火星加密：WGS-84 → GCJ-02
.venv/bin/python -m fafa.tools.fix_coords --method encrypt input/ -o output/fixed/

# 预览（不写入）
.venv/bin/python -m fafa.tools.fix_coords --method decrypt --dry-run
```

---

### `fafa.tools.rename_fit` — Magene FIT 文件重命名

将 Magene 设备导出的原始文件名转换为可读格式（CST/UTC+8）。

```
MAGENE_C506_1734220883_1266269_1734224483.fit
→ Magene_C506_1266269_20241215-080123.fit
```

```bash
.venv/bin/python -m fafa.tools.rename_fit           # 实际重命名
.venv/bin/python -m fafa.tools.rename_fit --dry-run # 预览
```

---

### `fafa.tools.export_all` — 批量导出 JSON（供 AI 使用）

解析 `input/` 下所有 FIT 文件，输出包含骑行摘要和逐公里数据的 JSON。

```bash
.venv/bin/python -m fafa.tools.export_all                        # 导出全部到 export.json
.venv/bin/python -m fafa.tools.export_all --no-km-stats          # 只含骑行汇总，文件更小
.venv/bin/python -m fafa.tools.export_all --min-km 5             # 过滤 5 km 以下短骑
.venv/bin/python -m fafa.tools.export_all -o ~/Desktop/data.json # 指定输出路径
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
.venv/bin/python -m fafa.tools.download_fit           # 增量下载新活动
.venv/bin/python -m fafa.tools.download_fit --all     # 全量下载
.venv/bin/python -m fafa.tools.download_fit --dry-run # 预览，不下载
.venv/bin/python -m fafa.tools.download_fit --limit 10 # 最多下载 10 个
```

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
