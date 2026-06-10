# FAFA Frontend Style Guide

> Single source of truth for CSS tokens and reusable components.
> Before writing any new CSS, check this document first.

---

## Token Quick Reference

All tokens are defined in the `:root` block at the top of `static/style.css`.

```css
/* Brand */
--color-primary       #2e86de   /* buttons, links, active states */
--color-primary-dark  #1a6fc4   /* hover on primary */
--color-danger        #e74c3c   /* destructive actions */
--color-danger-soft   #e07070   /* danger text on dark bg */
--color-success       #2ed573   /* CTL positive, success states */
--color-warning       #f39c12   /* ATL, caution states */
--color-accent        #7ab0e8   /* TSB form, secondary accent */

/* Backgrounds */
--bg-base             #0f0f14   /* page background (dark) / #f2f2f6 (light via override) */
--surface-1           rgba(255,255,255,0.05)   /* subtle element bg */
--surface-2           rgba(255,255,255,0.06)   /* input bg */
--surface-hover       rgba(255,255,255,0.08)   /* hover state */
--surface-active      rgba(255,255,255,0.12)   /* active / border */
--surface-raised      rgba(255,255,255,0.15)   /* raised elements */

/* Borders */
--border-subtle       rgba(255,255,255,0.07)   /* dividers */
--border-default      rgba(255,255,255,0.12)   /* standard borders */
--border-strong       rgba(255,255,255,0.15)   /* emphasis borders */
--scrim               rgba(0,0,0,0.62)         /* modal overlay */

/* Text */
--text-primary        #e8e8e8   /* headings, primary content */
--text-secondary      #ccc      /* secondary content */
--text-muted          #888      /* labels, placeholders */
--text-disabled       #555      /* disabled states */

/* Radii */
--radius-pill         20px      /* buttons, chips, tags */
--radius-card         12px      /* cards, modals */
--radius-input        8px       /* inputs, dropdowns */
--radius-sm           6px       /* small elements */

/* Type scale */
--text-xs             10px
--text-sm             11px      /* labels, chips */
--text-base           12px      /* body text */
--text-md             13px      /* slightly larger body */
--text-lg             14px      /* subheadings */

/* Transitions */
--transition-base     background 0.15s, color 0.15s
--transition-full     background 0.15s, color 0.15s, border-color 0.15s
```

---

## Reusable Class Catalog

### Modal

Use for any dialog/popup.

```html
<div id="my-modal" style="display:none; position:fixed; inset:0; z-index:2100; align-items:center; justify-content:center;">
  <div class="modal-overlay" onclick="closeMyModal()"></div>
  <div class="modal-box">
    <div class="modal-title">标题</div>
    <div class="modal-section">
      <div class="modal-label">分区标签</div>
      <!-- content -->
    </div>
    <div class="modal-actions">
      <button class="modal-cancel" onclick="closeMyModal()">取消</button>
      <button class="modal-export" onclick="confirm()">确认</button>
    </div>
  </div>
</div>
```

| Class | Style |
|---|---|
| `.modal-overlay` | Fixed inset-0 scrim, click-to-close |
| `.modal-box` | Dark glass container, `--radius-card`, 360px wide |
| `.modal-title` | 15px 700-weight heading |
| `.modal-section` | Content block, 16px bottom margin |
| `.modal-label` | Uppercase micro-label, `--text-sm`, `--text-disabled` |
| `.modal-actions` | Flex-end row, 10px gap, 22px top margin |
| `.modal-cancel` | Secondary pill button, transparent bg |
| `.modal-export` | Primary pill button, `--color-primary` fill |

### Option Group

Toggle buttons for mutually exclusive options.

```html
<div class="opt-group">
  <button class="opt-btn active" onclick="select(this,'a')">选项 A</button>
  <button class="opt-btn" onclick="select(this,'b')">选项 B</button>
  <button class="opt-btn" onclick="select(this,'c')">选项 C</button>
</div>
```

| Class | Style |
|---|---|
| `.opt-group` | flex-wrap row, 6px gap |
| `.opt-btn` | Pill button, `--surface-1` bg, `--text-disabled` color |
| `.opt-btn.active` | `--color-primary` bg + border, white text |

### Chips

```html
<!-- Read-only stat -->
<span class="stat-chip">128 km</span>

<!-- Filterable tag -->
<button class="tag-filter-chip active">室外</button>

<!-- Tag picker chip (colored background set inline) -->
<span class="tag-picker-chip selected" style="background:#2e86de22; border-color:#2e86de;">训练</span>
```

| Class | Style |
|---|---|
| `.stat-chip` | Read-only pill, 11px, `--text-muted`, `--surface-1` bg |
| `.tag-filter-chip` | Clickable filter chip; `.active` = white text + bright border |
| `.tag-picker-chip` | Tag picker item; `.selected` = full opacity + bright border |

### Danger Button

```html
<button class="danger-btn">删除全部</button>
```

| Class | Style |
|---|---|
| `.danger-btn` | `--color-danger` border + `--color-danger-soft` text; hover = danger bg tint |

### PMC Status Card

```html
<div class="pmc-card pmc-card-ctl">
  <div class="pmc-card-label">体能 CTL</div>
  <div class="pmc-card-value">82.4</div>
  <div class="pmc-card-sub">42天慢性负荷</div>
</div>
```

Modifier classes: `.pmc-card-ctl` (green top border), `.pmc-card-atl` (red), `.pmc-card-tsb` (orange), `.pmc-card-form` (blue).

### Feedback

```js
toast('操作成功');          // bottom toast notification
```

```html
<!-- AI loading -->
<div class="pmc-ai-loading-row">
  <div class="ai-spinner"></div>
  <span>AI 正在分析…</span>
</div>
```

---

## Rules for New Components

1. **查表先行** — 查 Reusable Class Catalog。找到 → 直接用，不写新 CSS。

2. **Token 强制** — 新 class 的所有视觉属性必须用 token：

   ```css
   /* ✅ */
   .new-thing {
     color: var(--text-muted);
     background: var(--surface-1);
     border: 1px solid var(--border-default);
     border-radius: var(--radius-pill);
     font-size: var(--text-base);
     transition: var(--transition-base);
   }

   /* ❌ 禁止 */
   .new-thing {
     color: #888;
     border: 1px solid rgba(255,255,255,0.12);
     border-radius: 20px;
   }
   ```

3. **Light theme 免费** — 用了 token 的组件自动支持 light theme，不需要写 `.light-theme .new-thing` 覆盖。只有特殊颜色（彩色边框等）才需要单独 override。

4. **文档同步** — 新 class 加入 Catalog 表格。

5. **禁止项**:
   - `style=""` 内联颜色/字号
   - 重新实现已有 `.modal-box`、`.opt-btn`、`.stat-chip` 等视觉效果
   - 引入外部 CSS 框架
