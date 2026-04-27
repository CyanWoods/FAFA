# FAFA - Fit Analysis For AI

解析骑行 FIT 文件，按公里统计关键指标，输出结构化数据供 AI 分析。

## 安装

```bash
python3 -m venv .venv
.venv/bin/pip install garmin-fit-sdk
```

## 用法

```bash
# 终端表格（人类可读）
.venv/bin/python3 analyze.py your_ride.fit

# JSON（推荐，用于喂给 AI）
.venv/bin/python3 analyze.py your_ride.fit --json -o result.json

# CSV（用于 Excel / Sheets）
.venv/bin/python3 analyze.py your_ride.fit --csv -o result.csv
```

## 输出内容

### 顶部训练概览

| 字段 | 说明 |
|---|---|
| 总距离 / 运动时间 / 总时间 | 含停留时长对比 |
| FTP / NP / IF / TSS | 训练强度指标 |
| 总做功 (kJ) / 总卡路里 | 能量消耗 |
| 均/最高心率、功率、踏频 | 全程汇总 |
| 均温 / 最高温 | 环境气温 |
| 左右比 | 踏力左右平衡（需功率计） |

### 按公里明细

每公里一行，包含：

| 列 | 说明 |
|---|---|
| 时长 | 该公里用时 |
| 均速 / 最高速 | km/h |
| 均踏频 / 最高踏频 | rpm，过滤停止踩踏的 0 值 |
| 坡度 | 实时坡度均值 %，正为爬升 |
| 均心率 / 最高心率 | bpm |
| 均功率 / 最高功率 / NP | 瓦特，NP 为标准化功率 |
| IF | 强度系数 = 均功率 / FTP |
| 卡路里 | 该公里消耗 kcal |
| 做功 | 该公里做功 kJ |
| 爬升 / 下降 / 终止海拔 | 米 |
| 气温 | °C，来自码表传感器 |
| 左右比 | 如 L54/R46，需功率计 |
| 扭矩效率 / 踏板平滑度 | %，仅部分功率计支持 |

最后不足 1km 的段落标注 `*`。

## 数据来源

使用佳明官方 Python SDK [`garmin-fit-sdk`](https://github.com/garmin/fit-python-sdk) 解码 FIT 文件。支持所有兼容 FIT 协议的设备（Garmin、Magene 等）。
