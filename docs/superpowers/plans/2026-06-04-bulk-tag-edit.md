# Bulk Tag Edit in Multi-Select Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a tristate bulk tag editor to the activities multi-select bar so users can add/remove tags across multiple selected activities at once.

**Architecture:** New `POST /api/meta/batch/tags` backend endpoint applies add/remove tag deltas to a list of files. Frontend adds a "标签" button to `#act-select-bar` that opens an independent `#bulk-tag-picker` popup; tristate chip logic computes delta from current coverage, confirmed with a single button.

**Tech Stack:** Flask (Python), vanilla JS, CSS, SQLite via `fafa/db.py`

---

## File Map

| File | Change |
|---|---|
| `app.py` | Add `POST /api/meta/batch/tags` route |
| `templates/index.html` | Add "标签" button to `#act-select-bar`; add `#bulk-tag-picker` div inside `#activities-view` |
| `static/style.css` | Add `#bulk-tag-picker` container styles, `.bulk-tag-chip` tristate styles, light-theme overrides |
| `static/app.js` | Add 2 state vars; add `_openBulkTagPicker`, `_closeBulkTagPicker`, `_renderBulkTagPickerList`, `_confirmBulkTags`; patch `_exitSelectMode` |
| `tests/test_batch_tags.py` | New: pytest for the batch endpoint |

---

## Task 1: Backend — `POST /api/meta/batch/tags`

**Files:**
- Modify: `app.py` (after the `save_tags` route, around line 1328)
- Create: `tests/test_batch_tags.py`

### Step 1.1: Write the failing test

- [ ] Create `tests/test_batch_tags.py`:

```python
import json, os, sys, tempfile, pytest
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import fafa.db as db
import app as flask_app

@pytest.fixture
def client(tmp_path):
    db._DB_PATH = tmp_path / "fafa.db"
    db.init_db(tmp_path)
    flask_app.app.config["TESTING"] = True
    with flask_app.app.test_client() as c:
        yield c

def _seed_tag(name="blue", color="#0000ff"):
    return db.create_tag(name, color)

def test_batch_add_tags(client):
    tag = _seed_tag()
    payload = {"filenames": ["a.fit", "b.fit"], "add_tag_ids": [tag["id"]], "remove_tag_ids": []}
    r = client.post("/api/meta/batch/tags", json=payload)
    assert r.status_code == 200
    data = r.get_json()
    assert data["ok"] is True
    assert data["updated"] == 2
    assert any(t["id"] == tag["id"] for t in db.get_activity_meta("a.fit")["tags"])
    assert any(t["id"] == tag["id"] for t in db.get_activity_meta("b.fit")["tags"])

def test_batch_remove_tags(client):
    tag = _seed_tag("red", "#ff0000")
    db.save_tags("a.fit", [tag["id"]])
    payload = {"filenames": ["a.fit"], "add_tag_ids": [], "remove_tag_ids": [tag["id"]]}
    r = client.post("/api/meta/batch/tags", json=payload)
    assert r.status_code == 200
    assert r.get_json()["updated"] == 1
    assert db.get_activity_meta("a.fit")["tags"] == []

def test_batch_conflict_returns_400(client):
    tag = _seed_tag()
    payload = {"filenames": ["a.fit"], "add_tag_ids": [tag["id"]], "remove_tag_ids": [tag["id"]]}
    r = client.post("/api/meta/batch/tags", json=payload)
    assert r.status_code == 400

def test_batch_both_empty_noop(client):
    payload = {"filenames": ["a.fit"], "add_tag_ids": [], "remove_tag_ids": []}
    r = client.post("/api/meta/batch/tags", json=payload)
    assert r.status_code == 200
    assert r.get_json() == {"ok": True, "updated": 0}

def test_batch_skips_non_fit(client):
    tag = _seed_tag()
    payload = {"filenames": ["a.fit", "bad.csv"], "add_tag_ids": [tag["id"]], "remove_tag_ids": []}
    r = client.post("/api/meta/batch/tags", json=payload)
    assert r.status_code == 200
    assert r.get_json()["updated"] == 1
```

### Step 1.2: Run test to verify it fails

- [ ] Run: `cd /Volumes/Code/Code/Labs/FAFA_Python && python -m pytest tests/test_batch_tags.py -v`

Expected: multiple ERRORS — `404` or `AttributeError` because the endpoint doesn't exist yet.

### Step 1.3: Implement the endpoint

- [ ] In `app.py`, insert after the `save_tags` route (after line 1328, before the blank line before `@app.route("/api/tags")`):

```python
@app.route("/api/meta/batch/tags", methods=["POST"])
def batch_save_tags():
    body = request.get_json(silent=True) or {}
    filenames    = body.get("filenames", [])
    add_ids      = body.get("add_tag_ids", [])
    remove_ids   = body.get("remove_tag_ids", [])
    if not isinstance(filenames, list) or not isinstance(add_ids, list) or not isinstance(remove_ids, list):
        return jsonify(error="filenames, add_tag_ids, remove_tag_ids must be lists"), 400
    if not all(isinstance(t, int) for t in add_ids + remove_ids):
        return jsonify(error="tag ids must be integers"), 400
    if set(add_ids) & set(remove_ids):
        return jsonify(error="add_tag_ids and remove_tag_ids must not overlap"), 400
    if not add_ids and not remove_ids:
        return jsonify(ok=True, updated=0)
    updated = 0
    for filename in filenames:
        if not isinstance(filename, str) or not filename.lower().endswith(".fit"):
            continue
        meta     = _db.get_activity_meta(filename)
        cur_ids  = {t["id"] for t in meta["tags"]}
        new_ids  = list((cur_ids | set(add_ids)) - set(remove_ids))
        _db.save_tags(filename, new_ids)
        updated += 1
    return jsonify(ok=True, updated=updated)
```

### Step 1.4: Run tests to verify they pass

- [ ] Run: `cd /Volumes/Code/Code/Labs/FAFA_Python && python -m pytest tests/test_batch_tags.py -v`

Expected: all 5 tests PASS.

### Step 1.5: Commit

- [ ] Run:
```bash
git add app.py tests/test_batch_tags.py
git commit -m "Add# app.py tests/ - POST /api/meta/batch/tags 批量标签接口"
```

---

## Task 2: HTML — Button + Popup

**Files:**
- Modify: `templates/index.html:128-129` (button insertion in `#act-select-bar`)
- Modify: `templates/index.html` (bulk-tag-picker div inside `#activities-view`)

### Step 2.1: Add "标签" button to `#act-select-bar`

- [ ] In `templates/index.html`, locate the select bar (lines 124–130). The current content:

```html
    <div id="act-select-bar" style="display:none">
      <span id="act-select-count">已选 0 项</span>
      <button id="act-select-all-btn" onclick="_actSelectAll()">全选</button>
      <button onclick="_stravaUploadSelected()">上传 Strava</button>
      <button onclick="_actBulkLoad()">加载轨迹</button>
      <button class="danger-btn" onclick="_actBulkDelete()">删除</button>
    </div>
```

Replace with (add the 标签 button before the danger button):

```html
    <div id="act-select-bar" style="display:none">
      <span id="act-select-count">已选 0 项</span>
      <button id="act-select-all-btn" onclick="_actSelectAll()">全选</button>
      <button onclick="_stravaUploadSelected()">上传 Strava</button>
      <button onclick="_actBulkLoad()">加载轨迹</button>
      <button id="act-bulk-tag-btn" onclick="_openBulkTagPicker(this)">标签</button>
      <button class="danger-btn" onclick="_actBulkDelete()">删除</button>
    </div>
```

### Step 2.2: Add `#bulk-tag-picker` popup

- [ ] In `templates/index.html`, find the `<div id="tag-picker" style="display:none">` block (around line 332). Directly after its closing `</div>`, insert:

```html
    <div id="bulk-tag-picker" style="display:none">
      <div id="bulk-tag-picker-list"></div>
      <div id="bulk-tag-picker-footer">
        <button id="bulk-tag-confirm-btn" onclick="_confirmBulkTags()">确定</button>
      </div>
    </div>
```

### Step 2.3: Commit

- [ ] Run:
```bash
git add templates/index.html
git commit -m "Add# templates/index.html - 多选栏标签按钮及批量标签 picker HTML"
```

---

## Task 3: CSS — Bulk Tag Picker Styles

**Files:**
- Modify: `static/style.css` (after `#tag-picker` block, around line 1082; light-theme block near line 3472)

### Step 3.1: Add dark-theme styles

- [ ] In `static/style.css`, after the light-theme tag-picker override block (after line 1081), insert:

```css
/* ── bulk tag picker ─────────────────────────────────────────────────────── */
#bulk-tag-picker {
  position: fixed;
  z-index: 1100;
  background: #13131c;
  border: 1px solid rgba(255,255,255,0.16);
  border-radius: 10px;
  padding: 10px;
  min-width: 180px;
  max-width: 260px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.65);
}
#bulk-tag-picker-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
#bulk-tag-picker-footer {
  border-top: 1px solid rgba(255,255,255,0.1);
  padding-top: 8px;
  display: flex;
  justify-content: flex-end;
}
#bulk-tag-confirm-btn {
  padding: 3px 14px;
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 12px;
  background: rgba(255,255,255,0.08);
  color: #e0e0e8;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s;
}
#bulk-tag-confirm-btn:hover { background: rgba(255,255,255,0.15); }
.bulk-tag-chip {
  font-size: 11px;
  padding: 3px 10px;
  border-radius: 12px;
  color: #fff;
  cursor: pointer;
  font-weight: 500;
  transition: opacity 0.15s, border-color 0.15s;
  border: 2px solid transparent;
  user-select: none;
}
.bulk-tag-chip.state-all  { opacity: 1; border-color: rgba(255,255,255,0.7); }
.bulk-tag-chip.state-some { opacity: 0.6; border-style: dashed; border-color: rgba(255,255,255,0.5); }
.bulk-tag-chip.state-none { opacity: 0.3; background: transparent !important; border-color: rgba(255,255,255,0.18); }
.bulk-tag-chip:hover { opacity: 1; }
```

### Step 3.2: Add light-theme overrides

- [ ] In `static/style.css`, find the light-theme `#act-select-bar` block (around line 3465). After line 3472 (`.light-theme #lib-select-bar button:hover`), insert:

```css
.light-theme #bulk-tag-picker { background: #fff; border-color: rgba(0,0,0,0.16); box-shadow: 0 4px 20px rgba(0,0,0,0.2); }
.light-theme #bulk-tag-picker-footer { border-top-color: rgba(0,0,0,0.12); }
.light-theme #bulk-tag-confirm-btn { border-color: rgba(0,0,0,0.2); background: rgba(0,0,0,0.05); color: #333; }
.light-theme .bulk-tag-chip.state-none { border-color: rgba(0,0,0,0.25); }
.light-theme .bulk-tag-chip.state-some { border-color: rgba(0,0,0,0.4); }
```

### Step 3.3: Commit

- [ ] Run:
```bash
git add static/style.css
git commit -m "Add# static/style.css - 批量标签 picker 及三态 chip 样式"
```

---

## Task 4: JS — State Variables + Four Functions + `_exitSelectMode` Patch

**Files:**
- Modify: `static/app.js`

### Step 4.1: Add state variables

- [ ] In `static/app.js`, find lines 240–242:

```js
let _actSelectMode  = false;
let _actSelected    = new Set(); // filenames
let _allTags        = []; // all tags from /api/tags
```

Replace with (add two new vars after `_allTags`):

```js
let _actSelectMode  = false;
let _actSelected    = new Set(); // filenames
let _allTags        = []; // all tags from /api/tags
let _bulkTagInitial = {}; // tagId → 'all' | 'some' | 'none'  (frozen at picker open)
let _bulkTagIntent  = {}; // tagId → 'all' | 'some' | 'none'  (mutable; 'some' only before first click)
```

### Step 4.2: Patch `_exitSelectMode` to close bulk picker

- [ ] In `static/app.js`, find `_exitSelectMode` (lines 353–361):

```js
function _exitSelectMode() {
  _actSelectMode = false;
  _actSelected.clear();
  document.getElementById('activities-view').classList.remove('select-mode');
  document.getElementById('act-select-bar').style.display = 'none';
  document.getElementById('act-mode-btn').textContent = '选择';
  document.getElementById('act-select-all-btn').textContent = '全选';
  document.querySelectorAll('.act-card.selected').forEach(c => c.classList.remove('selected'));
}
```

Replace with:

```js
function _exitSelectMode() {
  _actSelectMode = false;
  _actSelected.clear();
  document.getElementById('activities-view').classList.remove('select-mode');
  document.getElementById('act-select-bar').style.display = 'none';
  document.getElementById('act-mode-btn').textContent = '选择';
  document.getElementById('act-select-all-btn').textContent = '全选';
  document.querySelectorAll('.act-card.selected').forEach(c => c.classList.remove('selected'));
  _closeBulkTagPicker();
}
```

### Step 4.3: Add four bulk tag functions

- [ ] In `static/app.js`, locate the `// ── tag picker popup ──` comment block (around line 1649). Directly **before** that comment, insert the four new functions:

```js
// ── bulk tag picker (multi-select mode) ──────────────────────────────────────

function _openBulkTagPicker(anchorEl) {
  if (!_actSelected.size) { toast('请先选择活动'); return; }
  // Compute tristate coverage for each tag across selected activities
  _bulkTagInitial = {};
  _bulkTagIntent  = {};
  const selected = [..._actSelected];
  const total = selected.length;
  _allTags.forEach(tag => {
    const count = selected.filter(fn => {
      const act = (_actActivities || []).find(a => a.filename === fn);
      return act && Array.isArray(act.tags) && act.tags.some(t => t.id === tag.id);
    }).length;
    const state = count === 0 ? 'none' : count === total ? 'all' : 'some';
    _bulkTagInitial[tag.id] = state;
    _bulkTagIntent[tag.id]  = state; // mirrors initial; 'some' is valid until first click
  });
  _renderBulkTagPickerList();
  const picker = document.getElementById('bulk-tag-picker');
  if (!picker) return;
  picker.style.display = 'block';
  const rect = anchorEl.getBoundingClientRect();
  picker.style.left = rect.left + 'px';
  picker.style.top  = (rect.bottom + 4) + 'px';
  setTimeout(() => document.addEventListener('click', _bulkPickerOutsideClick), 0);
}

function _closeBulkTagPicker() {
  const picker = document.getElementById('bulk-tag-picker');
  if (picker) picker.style.display = 'none';
  document.removeEventListener('click', _bulkPickerOutsideClick);
}

function _bulkPickerOutsideClick(e) {
  const picker = document.getElementById('bulk-tag-picker');
  if (picker && !picker.contains(e.target) && e.target.id !== 'act-bulk-tag-btn') {
    _closeBulkTagPicker();
  }
}

function _renderBulkTagPickerList() {
  const list = document.getElementById('bulk-tag-picker-list');
  if (!list) return;
  list.innerHTML = '';
  _allTags.forEach(tag => {
    const chip = document.createElement('button');
    chip.className = 'bulk-tag-chip state-' + _bulkTagIntent[tag.id];
    chip.style.background = tag.color;
    chip.dataset.tagId = tag.id;
    chip.textContent = tag.name;
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const cur = _bulkTagIntent[tag.id];
      // 'none' → 'all'; 'all' → 'none'; 'some' (initial only) → 'all'
      _bulkTagIntent[tag.id] = cur === 'none' ? 'all' : cur === 'all' ? 'none' : 'all';
      chip.className = 'bulk-tag-chip state-' + _bulkTagIntent[tag.id];
    });
    list.appendChild(chip);
  });
}

async function _confirmBulkTags() {
  const add_ids    = [];
  const remove_ids = [];
  _allTags.forEach(tag => {
    const initial = _bulkTagInitial[tag.id];
    const intent  = _bulkTagIntent[tag.id];
    if (intent === 'all'  && initial !== 'all')  add_ids.push(tag.id);
    if (intent === 'none' && initial !== 'none') remove_ids.push(tag.id);
  });
  if (!add_ids.length && !remove_ids.length) { _closeBulkTagPicker(); return; }
  const filenames = [..._actSelected];
  try {
    const res = await fetch('/api/meta/batch/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filenames, add_tag_ids: add_ids, remove_tag_ids: remove_ids }),
    });
    if (!res.ok) { toast('标签保存失败'); return; }
    // Update in-memory cache and card badges for each selected file
    filenames.forEach(fn => {
      const act = (_actActivities || []).find(a => a.filename === fn);
      if (!act) return;
      const curIds = new Set((act.tags || []).map(t => t.id));
      add_ids.forEach(id => curIds.add(id));
      remove_ids.forEach(id => curIds.delete(id));
      const newTags = _allTags.filter(t => curIds.has(t.id));
      _syncActivityTagsInCache(fn, newTags);
    });
    toast('标签已更新');
    _closeBulkTagPicker();
  } catch (_) { toast('标签保存失败'); }
}
```

### Step 4.4: Commit

- [ ] Run:
```bash
git add static/app.js
git commit -m "Add# static/app.js - 多选批量标签编辑 picker 及三态逻辑"
```

---

## Task 5: Manual Verification

### Step 5.1: Start the app

- [ ] Run: `cd /Volumes/Code/Code/Labs/FAFA_Python && python app.py`

### Step 5.2: Verify tristate initial state

- [ ] Open the app in a browser. Go to Activities view.
- [ ] Enter select mode (click 选择 button).
- [ ] Select 2–3 activities that have different tags (some share a tag, some don't).
- [ ] Click 标签 button in the select bar. Verify:
  - Tags present on ALL selected → `state-all` (solid color, white border)
  - Tags present on SOME selected → `state-some` (semi-transparent, dashed border)
  - Tags absent on all selected → `state-none` (faint, no fill)

### Step 5.3: Verify toggle behavior

- [ ] Click a `state-none` chip → should become `state-all`.
- [ ] Click a `state-all` chip → should become `state-none`.
- [ ] Click a `state-some` chip → should become `state-all`.

### Step 5.4: Verify confirm saves correctly

- [ ] Set one tag to `state-all`, click 确定.
- [ ] Open detail view for each selected activity. Verify the tag is present on all of them.
- [ ] Re-open bulk picker, set that tag to `state-none`, confirm.
- [ ] Verify tag is removed from all selected activities.

### Step 5.5: Verify card badges update in place

- [ ] After confirming a tag change, verify the activity cards in the list show updated tag badges **without a page reload**.

### Step 5.6: Verify picker closes on exit

- [ ] Open bulk picker, then click 选择 button to exit select mode. Verify picker disappears.

### Step 5.7: Verify no-change case

- [ ] Open bulk picker, change nothing, click 确定. Verify no toast appears and picker closes silently.

### Step 5.8: Verify network error path

- [ ] Stop the Flask server. Open bulk picker, make a change, click 确定. Verify `toast('标签保存失败')` appears and picker stays open.
