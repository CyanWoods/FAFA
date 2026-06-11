# 风速气象集成设计

**日期：** 2026-06-08
**状态：** 待实现

## 概述

在 AI 活动评估中集成历史风速数据。通过 Open-Meteo 免费历史天气 API 获取骑行时段的风速/风向，计算全程顺/逆/侧风比例，在 AI 分析弹窗头部显示气象小卡片，并将风况注入 AI prompt 以支撑更准确的速度评估。

## 架构

### 数据流

```
openActAiModal(act)
  ├── fetch /api/load (km_stats)          ┐ 并行
  └── fetch /api/weather/<filename>        ┘
        ├── 从缓存读 coords, start_time_utc, is_gcj02, km_stats
        ├── GCJ-02 → WGS-84 转换（若 is_gcj02=True）
        ├── 调 Open-Meteo archive API
        ├── 计算顺/逆/侧风比例
        └── 返回 wind_data JSON

→ 弹窗头部渲染气象小卡片
→ fetch /api/ai/evaluate (summary, km_stats, wind_data)
      └── _build_eval_prompt(... wind_data=...) → LLM stream
```

### 组件

| 组件 | 职责 |
|---|---|
| `GET /api/weather/<filename>` | 加载缓存、调天气 API、计算风况统计 |
| `_wind_stats(coords, start_time_utc, is_gcj02, km_stats)` | 纯函数，可独立测试 |
| `_build_eval_prompt` | 新增 `wind_data` 可选参数，注入气象章节 |
| `ai_evaluate` | 接收并传递 `wind_data` |
| `openActAiModal` | 并行请求、渲染气象 chips、注入请求体 |

## 详细设计

### `/api/weather/<filename>`

**输入：** URL 路径参数 `filename`

**处理步骤：**

1. 从内存或磁盘缓存加载解析结果，取 `coords`（原始坐标数组）、`start_time_utc`、`is_gcj02`、`km_stats`
2. 若无 GPS 数据（`coords` 为空），返回 `{available: false}`
3. 取起点坐标 `coords[0]`，若 `is_gcj02=True` 用 `gcj02ToWgs84()` 转为 WGS-84
4. 计算骑行时段：`start_date` = UTC 日期，`end_date` = start + 1 天（覆盖跨午夜骑行）
5. 调 Open-Meteo：
   ```
   GET https://archive-api.open-meteo.com/v1/archive
     ?latitude={lat}&longitude={lon}
     &start_date={YYYY-MM-DD}&end_date={YYYY-MM-DD}
     &hourly=windspeed_10m,winddirection_10m,windgusts_10m
     &wind_speed_unit=kmh&timezone=UTC
   ```
6. 调用 `_wind_stats()` 计算统计
7. 网络异常或解析失败时返回 `{available: false}`

**响应（成功）：**
```json
{
  "available": true,
  "wind_speed_avg_kmh": 12.4,
  "wind_dir_deg": 45,
  "wind_dir_label": "东北风",
  "gust_max_kmh": 18.0,
  "headwind_pct": 41,
  "tailwind_pct": 28,
  "crosswind_pct": 31
}
```

### `_wind_stats(coords, start_time_utc, is_gcj02, km_stats, hourly_data)`

**顺/逆/侧风计算逻辑：**

1. 将 coords 按 km_stats 的 `duration_s` 分配时间戳（累积到 start_time_utc）
2. 对每对相邻坐标计算骑行方向 bearing（°，北为 0，顺时针）：
   ```python
   bearing = (math.degrees(math.atan2(dlon, dlat)) + 360) % 360
   ```
3. 查 hourly_data 中对应小时的 `winddirection_10m`（风来向，气象惯例）
4. 相对风角：`rel = (bearing - wind_from_dir + 360) % 360`
   - 逆风：`rel < 45 or rel > 315`
   - 顺风：`135 < rel < 225`
   - 侧风：其余
5. 按段距离加权累积，输出三个百分比（整数，三者之和 = 100）

**均值计算：**
- `wind_speed_avg_kmh`：骑行时段各小时均值
- `wind_dir_deg`：各小时风向的向量均值（用 sin/cos 分量避免 0°/360° 跳变）
- `gust_max_kmh`：骑行时段各小时 `windgusts_10m` 最大值

**风向中文标签（8 方位）：**

| 范围 | 标签 |
|---|---|
| 337.5°–22.5° | 北风 |
| 22.5°–67.5° | 东北风 |
| 67.5°–112.5° | 东风 |
| 112.5°–157.5° | 东南风 |
| 157.5°–202.5° | 南风 |
| 202.5°–247.5° | 西南风 |
| 247.5°–292.5° | 西风 |
| 292.5°–337.5° | 西北风 |

### `_build_eval_prompt` 新增章节

当 `wind_data` 不为 None 且 `available=True` 时，在骑行汇总数据后插入：

```
## 气象条件（来源：Open-Meteo 历史天气）
- 平均风速：12.4 km/h，阵风最大：18.0 km/h
- 主导风向：东北风（45°）
- 全程逆风：41%  顺风：28%  侧风：31%
（逆风比例偏高，速度表现可能受明显影响，分析时请结合考虑）
```

逆风 > 30% 时追加括号提示语；否则省略。

在评估报告章节末尾新增：

```
### 8. 风力影响评估（逆风 > 30% 时必须输出，否则跳过）
说明风力对本次骑行均速的影响程度，估算去除风力因素后的实际能力水平。
```

### 前端气象小卡片

`openActAiModal` 中并行请求，成功后将以下 HTML 追加到 stat chips 后：

```html
<span class="stat-chip">🌬️ 12 km/h</span>
<span class="stat-chip">↗ 东北风</span>
<span class="stat-chip">逆风41% / 顺风28%</span>
```

风向箭头映射（8 方位 Unicode）：↑ ↗ → ↘ ↓ ↙ ← ↖

失败（`available: false` 或网络错误）：静默跳过，不影响 AI 评估流程。

## 错误处理

| 场景 | 处理 |
|---|---|
| 文件无 GPS 数据 | 返回 `{available: false}` |
| Open-Meteo 超时 / 5xx | 返回 `{available: false}`，日志 warning |
| 缓存未命中（文件未解析过） | 触发解析后继续，或返回 `{available: false}` |
| 前端 fetch 失败 | 静默忽略，wind_data 不注入 prompt |

## 改动文件

| 文件 | 类型 |
|---|---|
| `app.py` | 新增端点、`_wind_stats()`、修改 `_build_eval_prompt`、修改 `ai_evaluate` |
| `static/app.js` | 修改 `openActAiModal`（并行请求 + chips 渲染） |
