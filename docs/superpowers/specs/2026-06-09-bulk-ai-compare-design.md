# 多选骑行记录 AI 对比分析 — 设计文档

**日期：** 2026-06-09
**状态：** 已批准，待实现

---

## 功能概述

在活动列表多选模式下，用户选择 2 条或以上骑行记录后，可触发 AI 对比分析。后端对各条记录进行简单风速归一化，构建对比 prompt，通过现有 SSE 流式弹窗返回分析结果，支持追问。

---

## 改动范围

| 文件 | 改动类型 |
|---|---|
| `templates/index.html` | 在 `#act-select-bar` 加"AI 对比"按钮 |
| `static/app.js` | `_updateSelectBar()` 控制按钮状态；新增 `_actBulkAiCompare()` |
| `app.py` | `_llm_stream` 加 `max_tokens_override`；新增 `_build_compare_prompt()`；新增 `/api/ai/compare` 端点 |

---

## 前端设计

### HTML（`#act-select-bar`）

在现有按钮组末尾（删除按钮之前）加：

```html
<button id="act-bulk-ai-btn" onclick="_actBulkAiCompare()" disabled>AI 对比</button>
```

初始 `disabled`，由 `_updateSelectBar()` 动态控制。

### `_updateSelectBar()` 修改

当 `_actSelected.size >= 2` 且 AI 已配置（`_aiModel` 非空）时 enable 按钮；否则 disabled。

### `_actBulkAiCompare()` 新函数

```
1. 校验 _actSelected.size >= 2，否则 toast 提示
2. 校验 _aiModel，否则 toast 提示配置
3. 从 _actActivities 缓存查找每条选中记录的 activity 对象
4. 并行 fetch 每条记录：
   - POST /api/load {filename} → km_stats
   - GET  /api/weather/<filename> → wind_data
5. 组装 payload：
   {
     activities: [
       { summary, km_stats, filename, start_time, wind_data },
       ...
     ]
   }
6. 构建 summaryHtml：每条记录显示一个 chip（文件名去 .fit）
7. 调用 _openAndStreamModal(
     `骑行对比 · AI 分析（${n} 条）`,
     summaryHtml,
     () => fetch('/api/ai/compare', { method: 'POST', ... body: payload })
   )
```

---

## 后端设计

### `_llm_stream` 签名扩展

```python
def _llm_stream(cfg, prompt=None, messages=None, max_tokens_override=None):
    max_tokens = max_tokens_override or cfg.get("max_tokens", 2500)
    # 其余逻辑不变
```

所有现有调用不传 `max_tokens_override`，行为不变。

### 风速归一化函数

```python
def _wind_normalize_speed(v_avg, wind_data):
    """简单线性逆风补偿：v_norm = v_avg + eff_headwind × 0.25"""
    if not wind_data or not wind_data.get("available") or not v_avg:
        return v_avg, 0.0
    wind_speed   = wind_data.get("wind_speed_avg_kmh", 0) or 0
    headwind_pct = wind_data.get("headwind_pct", 0) or 0
    tailwind_pct = wind_data.get("tailwind_pct", 0) or 0
    eff_headwind = wind_speed * (headwind_pct - tailwind_pct) / 100
    return round(v_avg + eff_headwind * 0.25, 1), round(eff_headwind, 1)
```

归一化公式含义：有效逆风每增加 1 km/h，估算速度补偿 0.25 km/h（顺风为负补偿）。

### `_build_compare_prompt(activities)` 新函数

Prompt 结构：

```
系统角色声明（专业公路自行车教练）

## 骑行对比汇总表
| 编号 | 日期 | 距离(km) | 均速(km/h) | 归一化均速(km/h) | 有效逆风(km/h) | 均功率(W) | NP(W) | 均心率(bpm) | 爬升(m) |
每条记录一行

## 各骑行详细数据
### 骑行 1 — <filename>（<start_time>）
风况：均风速 X km/h，逆风 X%，顺风 X%，侧风 X%
逐公里分段：（完整 km_stats 表格，格式同 _build_eval_prompt）

### 骑行 2 — ...
...

## 对比分析要求
1. 速度效率对比：以归一化均速为主要指标，说明风力调整的合理性
2. 配速策略：逐公里速度/功率的节奏稳定性（变异系数）
3. 有氧效率：心率/功率耦合对比（EF = NP / 均心率，如有功率数据）
4. 爬坡表现：爬升段的速度/功率响应（如爬升 > 50m）
5. 综合评定：哪次骑行综合表现最优，给出明确结论和理由
6. 训练建议：基于对比结果给出 1–3 条具体建议

格式要求：Markdown，## 做章节标题，**加粗**关键对比数值，用表格汇总关键指标。
```

### `/api/ai/compare` 端点

```python
@app.route("/api/ai/compare", methods=["POST"])
def ai_compare():
    cfg = _load_ai_config()
    if not cfg:
        return jsonify(error="AI 未配置"), 503
    body       = request.get_json(silent=True) or {}
    activities = body.get("activities") or []
    if len(activities) < 2:
        return jsonify(error="至少需要 2 条骑行记录"), 400
    prompt     = _build_compare_prompt(activities)
    override   = max(cfg.get("max_tokens", 2500) * 2, 5000)
    return _llm_stream(cfg, prompt, max_tokens_override=override)
```

---

## max_tokens 策略

| 场景 | max_tokens |
|---|---|
| 单条评估（现有） | `cfg.max_tokens`（默认 2500） |
| 多条对比（新） | `max(cfg.max_tokens × 2, 5000)` |

---

## 边界情况

| 情况 | 处理 |
|---|---|
| 选中记录无风数据 | `wind_data = null`，归一化速度 = 原始均速，prompt 中标注"无风况数据" |
| `/api/load` 失败 | `km_stats = []`，仍发送 summary，prompt 中标注"无逐公里数据" |
| 选中 1 条 | 按钮保持 disabled，不触发 |
| AI 未配置 | toast 提示，不触发 |

---

## 不在本次范围内

- 对比结果持久化（保存到 DB）
- 自定义归一化参数（如风力系数可配置）
- 对比结果导出 CSV/PDF
