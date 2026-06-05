# Bulk Tag Edit in Multi-Select Mode

**Date:** 2026-06-04  
**Status:** Approved

## Overview

Add a bulk tag editing button to `#act-select-bar`. Clicking it opens a tristate tag picker popup. User adjusts tag states across all selected activities and confirms once to apply.

---

## Data Model & Tristate Logic

On picker open, iterate `_actSelected` filenames, look up each in `_actActivities`, collect all tag arrays, compute per-tag coverage state:

| State | Meaning |
|---|---|
| `all` | Every selected activity has this tag |
| `some` | Some (not all) selected activities have this tag |
| `none` | No selected activity has this tag |

`_bulkTagIntent` mirrors initial states. Click cycles: `none → all → none`. `some` appears only as initial state; clicking it advances to `all`.

On confirm, compute delta:
- `add_ids` — intent is `all` AND initial was not `all`
- `remove_ids` — intent is `none` AND initial was not `none`
- Tags where intent equals initial state → no-op (not sent)

---

## Backend API

**New endpoint:**

```
POST /api/meta/batch/tags
Content-Type: application/json

{
  "filenames":    ["file1.fit", "file2.fit"],
  "add_tag_ids":  [2, 5],
  "remove_tag_ids": [3]
}
```

**Behavior:**
- For each filename: read current tag_ids from DB, union `add_tag_ids`, subtract `remove_tag_ids`, call `_db.save_tags(filename, new_ids)`.
- Both arrays empty → 200 `{ ok: true, updated: 0 }` (no-op).
- Intersection of `add_tag_ids` and `remove_tag_ids` non-empty → 400 (contradictory).
- Non-`.fit` filenames → skipped, not a hard error.
- No transaction: per-file saves are independent (consistent with existing single-file endpoint).

**Returns:** `{ ok: true, updated: N }` where N = number of files actually written.

---

## Frontend

### HTML additions (`templates/index.html`)

1. `#act-select-bar`: add button before the danger button:
   ```html
   <button id="act-bulk-tag-btn" onclick="_openBulkTagPicker(this)">标签</button>
   ```

2. Inside `#activities-view`, new popup (sibling to `#tag-picker` pattern):
   ```html
   <div id="bulk-tag-picker" style="display:none">
     <div id="bulk-tag-picker-list"></div>
     <div id="bulk-tag-picker-footer">
       <button id="bulk-tag-confirm-btn">确定</button>
     </div>
   </div>
   ```

### CSS additions (`static/style.css`)

Three chip states for `#bulk-tag-picker`:

- `.bulk-tag-chip.state-all` — solid color background (same as existing `.tag-picker-chip.selected`)
- `.bulk-tag-chip.state-some` — semi-transparent background + dashed border (indicates partial coverage)
- `.bulk-tag-chip.state-none` — no background, muted border

Picker positioned `position: fixed` (or absolute relative to `#activities-view`) anchored below the trigger button.

### JS additions (`static/app.js`)

**State variables:**
```js
let _bulkTagInitial = {}; // tagId → 'all' | 'some' | 'none'
let _bulkTagIntent  = {}; // tagId → 'all' | 'none'
```

**Functions:**

| Function | Responsibility |
|---|---|
| `_openBulkTagPicker(anchorEl)` | Compute initial tristate from `_actSelected` + `_actActivities`. Populate `_bulkTagInitial` and `_bulkTagIntent`. Render list. Position popup below button. Bind outside-click to close. |
| `_closeBulkTagPicker()` | Hide `#bulk-tag-picker`. Remove outside-click listener. |
| `_renderBulkTagPickerList()` | Render all `_allTags` as `.bulk-tag-chip` with correct state class. Click handler cycles state and updates class. Wire confirm button to `_confirmBulkTags()`. |
| `_confirmBulkTags()` | Diff intent vs initial → compute `add_ids` / `remove_ids`. If both empty, just close. POST `/api/meta/batch/tags`. On success, call `_syncActivityTagsInCache` for each selected filename with updated tag list. Show `toast`. Close picker. |

**Integration:**
- `_exitSelectMode()` calls `_closeBulkTagPicker()` to prevent orphaned popup.
- `_syncActivityTagsInCache` already handles in-place card badge updates — reuse as-is.
- No changes to detail view tag picker code.

---

## Error Handling

- Network error in `_confirmBulkTags` → `toast('标签保存失败')`, picker stays open.
- 0 files selected when button clicked → `toast('请先选择活动')` (guard same as other bulk actions).
- `add_tag_ids` and `remove_tag_ids` both empty (no intent change) → skip fetch, close picker, no toast.

---

## Out of Scope

- Creating new tags from the bulk picker (use detail view for that).
- Undo/redo.
- Bulk tag edit in files view (`#lib-select-bar`).
