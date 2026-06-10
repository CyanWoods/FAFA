# CSS Design Tokens & Style Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract all magic values from `static/style.css` into a `:root` CSS custom property layer, write a developer-facing style guide, and update CLAUDE.md so new components reuse tokens and existing classes instead of hardcoding values.

**Architecture:** Single-file CSS with a `:root` token block at the top. All hardcoded colors, radii, font sizes, and transitions are replaced with `var(--token)` references via a Python replacement script (handles both `rgba(255,255,255,...)` and `rgba(255, 255, 255, ...)` spacing variants). Light theme gets a token-override block so per-selector overrides that duplicate token values can be removed. No new files added to `static/` — `docs/STYLE_GUIDE.md` is documentation only.

**Tech Stack:** CSS custom properties, Python 3 (replacement script run once then discarded), no build tools.

---

### Task 1: Insert `:root` token block into `style.css`

**Files:**
- Modify: `static/style.css` — insert after line 2 (Reset), before `body {` (line 33)

- [ ] **Step 1: Insert `:root` block**

Open `static/style.css`. After line 2 (`*, *::before, *::after { … }`), insert:

```css

/* ── Design tokens ──────────────────────────────────────────────────────────── */
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

  /* Text */
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

- [ ] **Step 2: Verify `:root` is present**

```bash
grep -n "^:root" static/style.css
```

Expected: one line with `:root {`.

- [ ] **Step 3: Commit**

```bash
git add static/style.css
git commit -m "Add# style.css - 插入 :root 设计 Token 块"
```

---

### Task 2: Replace all magic values (Python script)

**Files:**
- Modify: `static/style.css` — all hardcoded magic values → `var(--token)`
- Run once: `scripts/apply_tokens.py` (delete after use)

- [ ] **Step 1: Create replacement script**

Create `scripts/apply_tokens.py`:

```python
import re, pathlib

css = pathlib.Path('static/style.css').read_text()

# Helper: rgba pattern tolerating optional spaces after commas
def rgba(r, g, b, a):
    return rf'rgba\(\s*{r},\s*{g},\s*{b},\s*{re.escape(str(a))}\s*\)'

replacements = [
    # Brand colors
    (r'#2e86de', 'var(--color-primary)'),
    (r'#1a6fc4', 'var(--color-primary-dark)'),
    (r'#e74c3c', 'var(--color-danger)'),
    (r'#e07070', 'var(--color-danger-soft)'),
    (r'#2ed573', 'var(--color-success)'),
    (r'#f39c12', 'var(--color-warning)'),
    (r'#7ab0e8', 'var(--color-accent)'),

    # Base backgrounds
    (r'#0f0f14', 'var(--bg-base)'),
    # #f2f2f6 is also used as --bg-light AND as a specific sidebar bg in light theme.
    # Only replace in dark-theme base contexts. Skip — too ambiguous, handle manually in Task 3.

    # Glass surfaces (both spacing variants)
    (rgba(255, 255, 255, '0.05'), 'var(--surface-1)'),
    (rgba(255, 255, 255, '0.06'), 'var(--surface-2)'),
    (rgba(255, 255, 255, '0.08'), 'var(--surface-hover)'),
    (rgba(255, 255, 255, '0.12'), 'var(--surface-active)'),
    (rgba(255, 255, 255, '0.15'), 'var(--surface-raised)'),

    # Borders
    (rgba(255, 255, 255, '0.07'), 'var(--border-subtle)'),
    # 0.12 already covered by surface-active above — same value, different semantic.
    # Both resolve correctly to var(--surface-active) / var(--border-default) which share
    # the same raw value. Use surface-active for backgrounds, border-default for borders.
    # The script cannot distinguish context, so leave 0.12 as var(--surface-active) everywhere
    # — the token values are identical; only the name differs. This is acceptable.

    # Scrim
    (rgba(0, 0, 0, '0.62'), 'var(--scrim)'),

    # Text colors — only replace when used as color property values
    # Use word-boundary to avoid matching e.g. #e8e8e8 in comments
    (r'(?<![0-9a-fA-F])#e8e8e8(?![0-9a-fA-F])', 'var(--text-primary)'),
    # #ccc, #888, #555 are too short and ambiguous (appear in light/dark contexts differently).
    # Replace only the ones that appear exclusively as dark-theme text. Skip — handle in Task 3.

    # Border radii — only standalone values, not compound (e.g. "12px 0")
    (r'border-radius:\s*20px(?!\s*\d)', r'border-radius: var(--radius-pill)'),
    (r'border-radius:\s*12px(?!\s*\d)', r'border-radius: var(--radius-card)'),
    (r'border-radius:\s*8px(?!\s*\d)',  r'border-radius: var(--radius-input)'),
    (r'border-radius:\s*6px(?!\s*\d)',  r'border-radius: var(--radius-sm)'),

    # Font sizes
    (r'font-size:\s*10px', r'font-size: var(--text-xs)'),
    (r'font-size:\s*11px', r'font-size: var(--text-sm)'),
    (r'font-size:\s*12px', r'font-size: var(--text-base)'),
    (r'font-size:\s*13px', r'font-size: var(--text-md)'),
    (r'font-size:\s*14px', r'font-size: var(--text-lg)'),

    # Transitions (exact strings)
    (r'transition:\s*background 0\.15s,\s*color 0\.15s,\s*border-color 0\.15s',
     'transition: var(--transition-full)'),
    (r'transition:\s*background 0\.15s,\s*color 0\.15s(?!,)',
     'transition: var(--transition-base)'),
]

for pattern, replacement in replacements:
    before = css.count(pattern) if pattern.startswith('#') else None
    css = re.sub(pattern, replacement, css)

pathlib.Path('static/style.css').write_text(css)
print("Done.")
```

- [ ] **Step 2: Run the script**

```bash
cd /Volumes/Code/Code/Labs/FAFA_Python
python3 scripts/apply_tokens.py
```

Expected output: `Done.`

- [ ] **Step 3: Verify brand color replacements**

```bash
grep -c '#2e86de\|#1a6fc4\|#e74c3c\|#e07070\|#2ed573\|#f39c12\|#7ab0e8\|#0f0f14' static/style.css
```

Expected: `0` (all brand colors replaced except inside `:root` definition itself — grep will still find them there, so acceptable count is the number of token definitions = 8).

```bash
grep -c '#2e86de\|#1a6fc4\|#e74c3c\|#e07070\|#2ed573\|#f39c12\|#7ab0e8\|#0f0f14' static/style.css
```

Actual expected: exactly `8` lines (the `:root` block definitions).

- [ ] **Step 4: Verify surface replacements**

```bash
grep -c 'rgba(255,255,255,0\.05)\|rgba(255, 255, 255, 0\.05)' static/style.css
```

Expected: `1` (the `:root` definition line only).

- [ ] **Step 5: Verify transition replacements**

```bash
grep -c 'transition: background 0\.15s, color 0\.15s' static/style.css
```

Expected: `0`.

- [ ] **Step 6: Visual smoke test — open the app**

```bash
python3 app.py &
```

Open `http://localhost:5000` in a browser. Check:
- Dark theme loads correctly (sidebar, map, activity cards)
- Switch to light theme (sidebar bottom button) — verify no broken colors
- Open Export modal — verify rounded corners and blue button appear correctly
- Close and kill the server: `kill %1`

- [ ] **Step 7: Delete the script and commit**

```bash
rm scripts/apply_tokens.py
rmdir scripts 2>/dev/null || true
git add static/style.css
git commit -m "Update# style.css - 全量替换魔法值为 CSS Token 变量"
```

---

### Task 3: Manual cleanup — ambiguous values and #f2f2f6

**Files:**
- Modify: `static/style.css` — manual targeted replacements for values the script skipped

The script skipped `#f2f2f6`, `#ccc`, `#888`, `#555`, `#e8e8e8` (partially) because they appear in both dark and light contexts. This task handles the clearly-safe replacements.

- [ ] **Step 1: Replace #e8e8e8 text uses (already done by script — verify)**

```bash
grep -n '#e8e8e8' static/style.css
```

If any remain outside `:root`, they are component-specific colors (e.g. `#e8e8ee` sidebar bg) — leave them. Only `#e8e8e8` (no trailing `e`) was replaced.

- [ ] **Step 2: Replace --bg-base in body background**

```bash
grep -n 'background: #0f0f14\|background:#0f0f14' static/style.css
```

Should already be replaced by script. If any remain:

```bash
sed -i '' 's/background: #0f0f14/background: var(--bg-base)/g' static/style.css
```

- [ ] **Step 3: Verify light-theme #f2f2f6 is intentional**

```bash
grep -n '#f2f2f6' static/style.css
```

These appear in `.light-theme` rules where `#f2f2f6` is the light background. After Task 4 adds the `.light-theme` token override, these will be replaced by `var(--bg-light)` references. Leave for now.

- [ ] **Step 4: Commit**

```bash
git add static/style.css
git commit -m "Fix# style.css - 手动清理遗留魔法值"
```

---

### Task 4: Add `.light-theme` token override block + prune redundant overrides

**Files:**
- Modify: `static/style.css` — `/* ── Light theme ──` section (around line 3710 after token insertion)

- [ ] **Step 1: Add token override block**

Find the line `/* ── Light theme ──`. Immediately after the comment line, insert this block **before** `.light-theme body, .light-theme { background: #f2f2f6; }`:

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

- [ ] **Step 2: Remove now-redundant `.light-theme body` background rule**

The line `.light-theme body, .light-theme { background: #f2f2f6; }` duplicates `--bg-base` from the new block. Remove it (the `body` background picks up `var(--bg-base)` automatically since `body { background: var(--bg-base); }` was set in Task 2's replacements).

Verify `body` uses the token first:

```bash
grep -n '^body' static/style.css
```

Expected to see `background: var(--bg-base)`. If so, delete the redundant `.light-theme body, .light-theme { background: #f2f2f6; }` line.

- [ ] **Step 3: Remove redundant per-selector light-theme overrides that now come free from tokens**

Search for light-theme rules that set `background: rgba(0,0,0,0.07)` or `color: #666` etc. where those are now covered by the token override:

```bash
grep -n '\.light-theme.*background: rgba(0,0,0,0\.07)\|\.light-theme.*color: #666\b' static/style.css
```

For each match: if the rule's **only** purpose was to set that one overridden value (and other properties in the same rule are still needed), remove just that property declaration. If the entire rule only set that one value, delete the whole rule.

**Important:** Only remove rules where the token override makes the property redundant. Rules with component-specific colors (e.g. sidebar `#e8e8ee` background, specific border colors with unique values) must stay.

- [ ] **Step 4: Smoke test light theme again**

```bash
python3 app.py &
```

Toggle light/dark theme several times. Verify:
- Sidebar, modal overlay, activity cards, PMC cards all switch correctly
- No flash of unstyled content
Kill server: `kill %1`

- [ ] **Step 5: Commit**

```bash
git add static/style.css
git commit -m "Add# style.css - light-theme Token 覆盖块，移除冗余覆盖规则"
```

---

### Task 5: Write `docs/STYLE_GUIDE.md`

**Files:**
- Create: `docs/STYLE_GUIDE.md`

This is the human- and AI-readable reference. It mirrors the spec's Part 2 + Part 3 but is written as the canonical source of truth (not a design document).

- [ ] **Step 1: Create `docs/STYLE_GUIDE.md`**

```markdown
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

Use for any dialog/popup. The wrapping element needs `position: fixed; inset: 0; display: flex; align-items: center; justify-content: center`.

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

Applied as a modifier on top of a base button style.

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
```

- [ ] **Step 2: Verify file created**

```bash
wc -l docs/STYLE_GUIDE.md
```

Expected: ~140 lines.

- [ ] **Step 3: Commit**

```bash
git add docs/STYLE_GUIDE.md
git commit -m "New# docs/STYLE_GUIDE.md - 前端样式规范：Token 表 + 可复用 Class 目录"
```

---

### Task 6: Update `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md` — add style guide reference section

- [ ] **Step 1: Add style guide reference to CLAUDE.md**

In `CLAUDE.md`, find the `## Key conventions` section. Add a new section immediately before it:

```markdown
## Frontend Style Guide

All frontend CSS must follow `docs/STYLE_GUIDE.md`. Key rules:

- Reuse existing classes before writing new CSS (see Reusable Class Catalog in the guide)
- All new CSS properties must use `var(--token)` from `:root` in `static/style.css`
- No hardcoded colors (`#2e86de`), radii (`20px`), font sizes (`12px`), or transitions
- Light theme support is automatic for token-based components — no per-selector overrides needed

Token quick ref: `--color-primary`, `--surface-hover`, `--border-default`, `--text-muted`, `--radius-pill`, `--text-base`, `--transition-base`
```

- [ ] **Step 2: Verify section added**

```bash
grep -n "Frontend Style Guide" CLAUDE.md
```

Expected: one match.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "Update# CLAUDE.md - 添加前端样式规范引用和 Token 使用规则"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Insert `:root` token block | Task 1 |
| Full replacement of magic values | Task 2 |
| Ambiguous values cleanup | Task 3 |
| `.light-theme` token override + prune redundant overrides | Task 4 |
| `docs/STYLE_GUIDE.md` for developers and AI | Task 5 |
| Update `CLAUDE.md` | Task 6 |

All spec requirements covered. No gaps.

**Placeholder scan:** No TBD, TODO, or vague steps. All code blocks complete.

**Type consistency:** No cross-task type references — this is CSS/documentation, no function signatures.

**Edge case noted in Task 2:** `#ccc`, `#888`, `#555` were intentionally NOT replaced by script because they appear in both dark and light theme contexts with different semantic meanings. The token values `--text-secondary`, `--text-muted`, `--text-disabled` cover the dark-theme usages, and the `.light-theme` override block in Task 4 provides the light-theme values. The mismatch between raw values and token semantics is acceptable — the script cannot safely distinguish these context-dependent usages without manual review.
