# FAFA — FIT Analysis & Visualization

解析、纠偏、可视化骑行 FIT 文件的工具集，包含双界面交互式 Web 查看器和命令行分析工具。

支持 Garmin、Magene 等设备导出的 `.fit` 格式文件。

---

## 目录结构

```
FAFA/
├── app.py              # Flask Web 服务（主入口）
├── analyze.py          # 按公里输出骑行数据（终端 / JSON / CSV）
├── map_track.py        # 单条路径 Folium HTML 地图
├── map_all.py          # 批量路径 Folium HTML 地图
├── fix_coords.py       # FIT 文件坐标系批量纠偏
├── rename_fit.py       # Magene FIT 文件批量重命名
├── fafa/
│   ├── parser.py       # FIT 文件解码（Record / FitData 数据结构）
│   ├── gcj02.py        # WGS-84 ↔ GCJ-02 坐标转换
│   ├── tiles.py        # 地图瓦片预设（folium 用）
│   ├── stats.py        # 按公里统计计算（KmStats / Summary）
│   └── reporter.py     # 表格 / JSON / CSV 输出
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

拖拽 `.fit` 文件到地图区域即可加载，支持同时叠加任意数量的路径。

| 功能 | 说明 |
|---|---|
| 拖拽上传 | 将 `.fit` 文件直接拖入地图区域 |
| 多路径叠加 | 支持同时加载任意数量的 FIT 文件 |
| 路径闪烁 | 鼠标悬停路径面板条目时，地图上对应路线闪烁高亮 |
| 底图切换 | 深色地图 / 深色路网 / 浅色地图 / 浅色路网 / 高德地图 |
| 坐标模式 | 每条路径独立提供：原始坐标 / 火星解密（GCJ-02→WGS-84）/ 火星加密（WGS-84→GCJ-02） |
| 缩放拉柄 | 右侧竖向拉柄，拖动控制地图缩放（1–18 级，平滑过渡） |
| 路径面板 | 底部居中面板，展示已加载路径列表；支持拖拽调整高度、点击标题栏折叠/展开 |
| 概览数据 | 每条路径显示里程、时长、均速、爬升、心率、功率等摘要标签 |
| 数据导出 | 每条路径可独立导出 JSON（含 summary + 逐公里数据）或 CSV |
| 定位 | 点击色块定位到该路径；点击文件名进入界面二 |
| PNG 导出 | 纯画布渲染，支持地图背景 / 颜色模式 / 比例 / 分辨率选项 |
| 一键清除 | 清除所有已加载路径 |

**PNG 导出选项：**

| 选项 | 可选值 |
|---|---|
| 地图背景 | 深色地图 / 深色路网 / 浅色地图 / 浅色路网 |
| 颜色模式 | 热力图（可选颜色，重叠路线累积透明度）/ 单一颜色 / 不同颜色 |
| 画面比例 | 16:9 / 4:3 |
| 分辨率 | 4K / 2K / 1080P |

### 界面二：骑行详情

点击路径面板中的文件名进入，按公里或时间分段展示该次骑行数据。按 `Esc` 或点击「← 返回」退出。

| 功能 | 说明 |
|---|---|
| 概览条 | 顶部展示总里程、时长、均速、爬升、心率、功率 |
| 折线图 | 按指标（速度 / 心率 / 功率 / 踏频 / 海拔 / 坡度）分别绘图；x 轴支持按公里或累计时间切换；仅展示该文件有数据的指标 |
| 数据表 | 底部按公里分行展示所有分段数据，表头吸顶，仅展示有数据的列 |
| 数据导出 | 顶部栏提供 JSON / CSV 导出按钮 |

---

## 命令行工具

### `analyze.py` — 骑行数据统计

按公里输出心率、功率、踏频、坡度、海拔等指标。

```bash
# 终端表格（人类可读）
.venv/bin/python analyze.py input/ride.fit

# JSON（推荐用于 AI 分析）
.venv/bin/python analyze.py input/ride.fit --json -o result.json

# CSV（Excel / Sheets）
.venv/bin/python analyze.py input/ride.fit --csv -o result.csv
```

输出字段：距离、用时、均速/最高速、均踏频/最高踏频、坡度、均心率/最高心率、均功率/最高功率/NP、IF、卡路里、做功、爬升/下降/海拔、气温、左右踏力比、扭矩效率、踏板平滑度。

---

### `fix_coords.py` — FIT 文件坐标纠偏

对 FIT 文件中的 GPS 坐标进行火星坐标系转换，支持批量处理。

```bash
# 火星解密：GCJ-02 → WGS-84（Magene 等国内设备）
.venv/bin/python fix_coords.py --method decrypt

# 火星加密：WGS-84 → GCJ-02（Garmin 等国际设备）
.venv/bin/python fix_coords.py --method encrypt input/ -o output/fixed/

# 预览（不写入）
.venv/bin/python fix_coords.py --method decrypt --dry-run
```

---

### `rename_fit.py` — Magene FIT 文件重命名

将 Magene 设备导出的原始文件名转换为可读格式（CST/UTC+8）。

```
MAGENE_C506_1734220883_1266269_1734224483.fit
→ Magene_C506_20241215-080123_1266269.fit
```

```bash
.venv/bin/python rename_fit.py           # 实际重命名
.venv/bin/python rename_fit.py --dry-run # 预览
```

---

### `map_track.py` — 单条路径 HTML 地图

将单个 FIT 文件的 GPS 路径渲染为 Folium 交互式 HTML 地图，支持按速度/心率/功率/海拔着色。

```bash
.venv/bin/python map_track.py input/ride.fit
.venv/bin/python map_track.py input/ride.fit --color hr --tiles dark-nolabels
```

---

### `map_all.py` — 批量路径 HTML 地图

将目录下所有 FIT 文件的路径绘制在同一张 Folium 地图上，悬停显示文件名。

```bash
.venv/bin/python map_all.py
.venv/bin/python map_all.py input/ --tiles dark-nolabels -o output/all.html
.venv/bin/python map_all.py input/ --max-points 200
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

Web 查看器在前端实时进行坐标转换，无需预处理文件；`fix_coords.py` 可将转换结果永久写入 FIT 文件。

---

## 依赖

| 包 | 用途 |
|---|---|
| `garmin-fit-sdk` | FIT 文件解码 / 编码 |
| `flask` | Web API 服务 |
| `folium` | CLI 工具 HTML 地图生成 |
