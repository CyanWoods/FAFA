# CSS Design Tokens & Style Guide

**Date:** 2026-06-10  
**Scope:** `static/style.css`, `templates/index.html`, `static/app.js`

## Goal

Eliminate magic values from `style.css` by extracting a `:root` token layer. New components must reuse existing tokens and classes — no new hardcoded colors, radii, font sizes, or transitions.

---

## Part 1 — Implementation: CSS Token Extraction

### 1.1 Add `:root` block at the top of `style.css` (after Reset)

```css
:root {
  /* Brand */
  --color-primary:      #2e86de;
  --color-primary-dark: #1a6fc4;
  --color-danger:       #e74c3c;
  --color-danger-soft:  #e07070;
  --color-success:      #2ed573;
  --color-warning:      #f39c12;
  --color-accent:       #7ab0e8;

  /* Base backgrounds */
  --bg-base:            #0f0f14;
  --bg-light:           #f2f2f6;

  /* Glass surface layers (dark theme) */
  --surface-1:          rgba(255,255,255,0.05);
  --surface-2:          rgba(255,255,255,0.06);
  --surface-hover:      rgba(255,255,255,0.08);
  --surface-active:     rgba(255,255,255,0.12);
  --surface-raised:     rgba(255,255,255,0.15);

  /* Borders */
  --border-subtle:      rgba(255,255,255,0.07);
  --border-default:     rgba(255,255,255,0.12);
  --border-strong:      rgba(255,255,255,0.15);

  /* Overlay scrim */
  --scrim:              rgba(0,0,0,0.62);

  /* Text (dark theme) */
  --text-primary:       #e8e8e8;
  --text-secondary:     #ccc;
  --text-muted:         #888;
  --text-disabled:      #555;

  /* Border radii */
  --radius-pill:        20px;
  --radius-card:        12px;
  --radius-input:       8px;
  --radius-sm:          6px;

  /* Type scale */
  --text-xs:            10px;
  --text-sm:            11px;
  --text-base:          12px;
  --text-md:            13px;
  --text-lg:            14px;

  /* Transitions */
  --transition-base:    background 0.15s, color 0.15s;
  --transition-full:    background 0.15s, color 0.15s, border-color 0.15s;
}
```

### 1.2 Full replacement pass in `style.css`

Replace every hardcoded magic value with its token. Key substitutions:

| Magic value | Token |
|---|---|
| `#2e86de` | `var(--color-primary)` |
| `#1a6fc4` | `var(--color-primary-dark)` |
| `#e74c3c` | `var(--color-danger)` |
| `#e07070` | `var(--color-danger-soft)` |
| `#2ed573` | `var(--color-success)` |
| `#f39c12` | `var(--color-warning)` |
| `#7ab0e8` | `var(--color-accent)` |
| `#0f0f14` | `var(--bg-base)` |
| `#f2f2f6` | `var(--bg-light)` |
| `rgba(255,255,255,0.05)` / `rgba(255, 255, 255, 0.05)` | `var(--surface-1)` |
| `rgba(255,255,255,0.06)` | `var(--surface-2)` |
| `rgba(255,255,255,0.08)` / `rgba(255, 255, 255, 0.08)` | `var(--surface-hover)` |
| `rgba(255,255,255,0.12)` / `rgba(255, 255, 255, 0.12)` | `var(--surface-active)` |
| `rgba(255,255,255,0.15)` / `rgba(255, 255, 255, 0.15)` | `var(--surface-raised)` |
| `rgba(255,255,255,0.07)` / `rgba(255, 255, 255, 0.07)` | `var(--border-subtle)` |
| `rgba(0,0,0,0.62)` | `var(--scrim)` |
| `#e8e8e8` | `var(--text-primary)` |
| `#ccc` | `var(--text-secondary)` |
| `#888` | `var(--text-muted)` |
| `#555` | `var(--text-disabled)` |
| `border-radius: 20px` | `border-radius: var(--radius-pill)` |
| `border-radius: 12px` | `border-radius: var(--radius-card)` |
| `border-radius: 8px` | `border-radius: var(--radius-input)` |
| `border-radius: 6px` | `border-radius: var(--radius-sm)` |
| `font-size: 10px` | `font-size: var(--text-xs)` |
| `font-size: 11px` | `font-size: var(--text-sm)` |
| `font-size: 12px` | `font-size: var(--text-base)` |
| `font-size: 13px` | `font-size: var(--text-md)` |
| `font-size: 14px` | `font-size: var(--text-lg)` |
| `transition: background 0.15s, color 0.15s` | `transition: var(--transition-base)` |
| `transition: background 0.15s, color 0.15s, border-color 0.15s` | `transition: var(--transition-full)` |

**Note on `#111`, `#222`, `#333`, `#444`, `#666`, `#777`, `#999`, `#aaa`, `#bbb`, `#ddd`, `#fff`:**  
These are used in both dark and light themes at different frequencies and meanings. Do NOT token-ize them — they are context-specific one-offs. Only the tokens above are global invariants.

### 1.3 Light theme override in `.light-theme`

The existing `.light-theme` section overrides specific properties directly on selectors. After the token refactor, add a `.light-theme` `:root` override block at the start of the light-theme section:

```css
.light-theme {
  --bg-base:          #f2f2f6;
  --surface-1:        rgba(0,0,0,0.04);
  --surface-2:        rgba(0,0,0,0.05);
  --surface-hover:    rgba(0,0,0,0.07);
  --surface-active:   rgba(0,0,0,0.12);
  --surface-raised:   rgba(0,0,0,0.15);
  --border-subtle:    rgba(0,0,0,0.07);
  --border-default:   rgba(0,0,0,0.12);
  --border-strong:    rgba(0,0,0,0.18);
  --scrim:            rgba(0,0,0,0.30);
  --text-primary:     #111;
  --text-secondary:   #444;
  --text-muted:       #666;
  --text-disabled:    #999;
}
```

Existing per-selector light-theme overrides that duplicate these token values can then be removed. Those with unique values (specific component colors) stay.

---

## Part 2 — Reusable Class Catalog

New components **must** use these classes before writing any new CSS.

### Modals

```html
<div class="modal-overlay" onclick="closeModal()"></div>
<div class="modal-box">
  <div class="modal-title">标题</div>
  <div class="modal-section">
    <div class="modal-label">选项标签</div>
    <!-- content -->
  </div>
  <div class="modal-actions">
    <button class="modal-cancel" onclick="closeModal()">取消</button>
    <button class="modal-export">确认</button>
  </div>
</div>
```

| Class | Purpose |
|---|---|
| `.modal-overlay` | 半透明遮罩，点击关闭 |
| `.modal-box` | 弹窗容器，`border-radius: var(--radius-card)`，暗色玻璃背景 |
| `.modal-title` | 弹窗标题，700 weight |
| `.modal-section` | 内容分区，`margin-bottom: 16px` |
| `.modal-label` | 小标签，uppercase，`var(--text-sm)` |
| `.modal-actions` | 底部按钮行，flex end |
| `.modal-cancel` | 次要按钮，pill，透明底 |
| `.modal-export` | 主要按钮，pill，`var(--color-primary)` 填充 |

### Option Groups

```html
<div class="opt-group">
  <button class="opt-btn active">选项 A</button>
  <button class="opt-btn">选项 B</button>
</div>
```

| Class | Purpose |
|---|---|
| `.opt-group` | flex wrap，gap 6px |
| `.opt-btn` | 圆角胶囊选项按钮，默认灰色 |
| `.opt-btn.active` | 蓝色填充激活态 |

### Chips & Tags

| Class | Purpose |
|---|---|
| `.stat-chip` | 只读统计 chip，小字灰色胶囊 |
| `.tag-filter-chip` | 可点击过滤 chip，带 `.active` 态 |
| `.tag-picker-chip` | 标签选择器 chip，带 `.selected` 态 |

### Buttons

| Class | Purpose |
|---|---|
| `.danger-btn` | 危险操作按钮，红色边框+文字。配合父容器按钮基础样式使用 |

### Status Cards (PMC)

```html
<div class="pmc-card pmc-card-ctl">
  <div class="pmc-card-label">体能 CTL</div>
  <div class="pmc-card-value">82.4</div>
  <div class="pmc-card-sub">42天慢性负荷</div>
</div>
```

| Class | Purpose |
|---|---|
| `.pmc-card` | 统计数据卡片，暗色背景 |
| `.pmc-card-label` | 卡片标签，小字 muted |
| `.pmc-card-value` | 主数值，大字 |
| `.pmc-card-sub` | 副文本，小字 muted |
| `.pmc-card-ctl/atl/tsb/form` | 顶部彩色边框修饰符 |

### Feedback

| Class | Purpose |
|---|---|
| `.toast` | 底部浮动通知，调用 `toast(msg)` 函数触发 |
| `.ai-spinner` | AI 加载动画圆圈 |

---

## Part 3 — Usage Rules

1. **查表优先** — 写新组件前先查本文档 Part 2。找到合适 class → 直接用，不写新 CSS。

2. **Token 强制** — 找不到可复用 class 需要新写时，所有视觉属性必须引用 `:root` token：
   ```css
   /* ✅ */
   .my-new-thing {
     color: var(--text-muted);
     border: 1px solid var(--border-default);
     border-radius: var(--radius-pill);
     font-size: var(--text-base);
     transition: var(--transition-base);
   }

   /* ❌ */
   .my-new-thing {
     color: #888;
     border: 1px solid rgba(255,255,255,0.12);
     border-radius: 20px;
   }
   ```

3. **文档同步** — 新 class 写完后更新本文档 Part 2 对应分类。

4. **Light theme** — 新组件不需要单独写 `.light-theme .my-class` 覆盖，只要用了 token，light theme 的 `:root` override 自动生效。对于有具体颜色需求（如彩色边框）的组件才写 light override。

5. **禁止项**：
   - 组件内 `style=""` 内联颜色/字号
   - 重新实现已有 `.modal-box`、`.opt-btn`、`.stat-chip` 等视觉效果
   - 引入外部 CSS 框架（Bootstrap、Tailwind 等）

---

## Appendix — Token Quick Reference

```
颜色:  --color-primary  --color-danger  --color-success  --color-warning  --color-accent
背景:  --bg-base  --surface-1  --surface-hover  --surface-active
边框:  --border-subtle  --border-default  --border-strong
文字:  --text-primary  --text-secondary  --text-muted  --text-disabled
圆角:  --radius-pill  --radius-card  --radius-input  --radius-sm
字号:  --text-xs  --text-sm  --text-base  --text-md  --text-lg
动效:  --transition-base  --transition-full
```
