# About 视图设计文档

**日期:** 2026-06-12
**范围:** 新增「关于」页面，侧边栏第 6 个导航项，含版本号展示

---

## 需求

- 在侧边栏「文件管理」下方新增「关于」导航项
- 显示当前版本号（来自项目根目录 `version` 文件）
- 简洁呈现项目简介与五视图功能点
- 版本文件 git 跟踪，每次提交时手动更新

---

## 架构

### 版本文件

- 位置：项目根目录 `version`（git 跟踪，不加入 `.gitignore`）
- 格式：单行字符串，如 `v2026.06.12`
- 读取：`app.py` 启动时一次性读取，失败时 fallback `"unknown"`

### 后端（`app.py`）

在文件顶部（imports 之后）添加：

```python
_version_file = PROJECT_ROOT / "version"
FAFA_VERSION = _version_file.read_text().strip() if _version_file.exists() else "unknown"
```

`PROJECT_ROOT` 已在 `app.py` 第 121 行定义（`Path(__file__).parent`），`Path` 已导入。

`render_template` 调用追加 `version=FAFA_VERSION` 参数（当前在第 1049 行）。

### 前端模板（`templates/index.html`）

1. **侧边栏导航** — 在「文件管理」`<button>` 之后追加：

```html
<button class="sb-item" data-view="about" onclick="switchSidebarView('about')">
  <span class="sb-icon">ⓘ</span>
  <span class="sb-label">关于</span>
</button>
```

2. **视图容器** — 在 `#files-view` 之后（`#sync-modal` 之前）添加 `#about-view`：

```html
<div id="about-view">
  <div id="about-header">
    <span class="act-list-title">关于</span>
  </div>
  <div id="about-body">
    <div class="about-logo-row">
      <img src="/static/fafa-logo.png" class="about-logo" alt="FAFA">
      <div class="about-title-block">
        <span class="about-name">FAFA</span>
        <span class="about-version">{{ version }}</span>
      </div>
    </div>
    <p class="about-desc">FIT 文件解析、纠偏、可视化工具集，支持 Garmin、Magene 等设备导出的骑行数据。</p>
    <div class="about-section-title">功能视图</div>
    <ul class="about-feature-list">
      <li><span class="about-feat-icon">◈</span> <b>骑行记录</b> — 活动卡片列表，按月分组，支持筛选、详情、AI 分析</li>
      <li><span class="about-feat-icon">⤳</span> <b>骑行轨迹</b> — 拖拽加载路径，多路径叠加，PNG 导出</li>
      <li><span class="about-feat-icon">⬡</span> <b>体能管理</b> — CTL/ATL/TSB 曲线、功率曲线、区间分布</li>
      <li><span class="about-feat-icon">⊟</span> <b>训练日历</b> — 月视图，按天展示活动</li>
      <li><span class="about-feat-icon">⊞</span> <b>文件管理</b> — FIT 文件库，支持导入、同步、导出</li>
    </ul>
  </div>
</div>
```

### 前端逻辑（`static/app.js`）

`switchSidebarView` 函数中新增两处修改：

1. 在 `classList.remove('active')` 块中加入 `about-view`：
```javascript
document.getElementById('about-view').classList.remove('active');
```

2. 新增 `about` 分支：
```javascript
} else if (name === 'about') {
  document.getElementById('about-view').classList.add('active');
}
```

### 样式（`static/style.css`）

新增 `#about-view` 块，跟随 `#files-view` 的定位模式：

```css
#about-view {
  position: fixed;
  left: 180px; top: 0; right: 0; bottom: 0;
  z-index: 500;
  background: var(--bg-base);
  display: none;
  flex-direction: column;
  overflow-y: auto;
}
#about-view.active { display: flex; }
#about-header {
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}
#about-body {
  padding: 32px 40px;
  max-width: 600px;
}
.about-logo-row {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}
.about-logo { width: 48px; height: 48px; }
.about-title-block { display: flex; flex-direction: column; gap: 4px; }
.about-name { font-size: var(--text-2xl); font-weight: 700; color: var(--text-primary); }
.about-version {
  font-size: var(--text-sm);
  color: var(--color-primary);
  background: rgba(46,134,222,0.12);
  border-radius: var(--radius-pill);
  padding: 2px 10px;
  display: inline-block;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.about-desc { font-size: var(--text-md); color: var(--text-secondary); margin-bottom: 28px; line-height: 1.6; }
.about-section-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-disabled);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 12px;
}
.about-feature-list {
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.about-feature-list li {
  font-size: var(--text-md);
  color: var(--text-secondary);
  display: flex;
  align-items: baseline;
  gap: 8px;
  line-height: 1.5;
}
.about-feat-icon { color: var(--color-accent); flex-shrink: 0; }
```

光照主题覆盖（加入 `.light-theme` 块）：
```css
.light-theme #about-view { background: var(--bg-light); }
.light-theme #about-header { border-bottom-color: rgba(0,0,0,0.13); }
```

---

## 变更文件

| 文件 | 操作 |
|------|------|
| `version` | 新建，内容 `v2026.06.12` |
| `app.py` | 添加 `FAFA_VERSION` 读取；`render_template` 追加 `version=` |
| `templates/index.html` | 添加侧边栏按钮 + `#about-view` HTML |
| `static/app.js` | `switchSidebarView` 添加 `about` 分支 |
| `static/style.css` | 添加 `#about-view` 样式块 + light-theme 覆盖 |

---

## 约束

- 所有 CSS 值使用 `var(--token)`，不硬编码颜色/尺寸
- `version` 文件不加入 `.gitignore`
- 不新增 API 端点
- 质量门禁（`python3 scripts/quality.py check`）必须通过
