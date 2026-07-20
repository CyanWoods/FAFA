# AGENTS.md

This file provides guidance to Codex and other coding agents when working with code in this repository. It is kept byte-identical to `CLAUDE.md` apart from this header.

## Project Overview

**FAFA** — a Flask web app for analyzing and visualizing cycling FIT files. FIT (Flexible and Interoperable Data Transfer) is the binary format used by Garmin, Magene, iGPSport and other sports devices to record GPS tracks, heart rate, power, cadence, temperature, altitude and workout metrics.

Single-page frontend (Leaflet map + ECharts charts, no build step), Flask backend, SQLite metadata, optional AI analysis via any OpenAI-compatible chat-completions API.

## Commands

Dependencies live in a local `venv/` — invoke it explicitly, there is no `python` on PATH.

```bash
python3 -m venv venv && venv/bin/pip install -r requirements.txt

# Local mode — no auth, loopback only, port 5173
venv/bin/python app.py

# Server mode — multi-user auth; FAFA_SECRET required or startup aborts
FAFA_SERVER=1 FAFA_SECRET=<secret> venv/bin/python app.py --server
./start.sh                      # gunicorn, 4 workers × 4 threads, binds 127.0.0.1:5173

# Quality gate — 23 checks (see below). This is the only test suite.
venv/bin/python scripts/quality.py check
venv/bin/python scripts/quality.py fix        # auto-fix trailing whitespace / __pycache__ / perms, then check
venv/bin/python scripts/quality.py check --ci # skip local-only checks (file-permissions, sqlite-integrity)

bash scripts/install-hooks.sh   # install pre-commit hook (once after clone)
```

There is no `Makefile` and no automated test suite — `scripts/quality.py` is the gate.

### CLI tools

```bash
# User management (server mode)
venv/bin/python -m fafa.tools.manage_users add|list|passwd|delete [<username>]

# GCJ-02 coordinate conversion (batch, directory in → directory out)
venv/bin/python -m fafa.tools.fix_coords [input_dir] --method decrypt|encrypt [-o OUT] [--dry-run]
#   decrypt = GCJ-02 → WGS-84 ；encrypt = WGS-84 → GCJ-02
#   input_dir defaults to `input`, output defaults to <input_dir>/<method>/

venv/bin/python -m fafa.tools.rename_fit [--dry-run]              # normalize Magene filenames
venv/bin/python -m fafa.tools.export_all [-i DIR] [-o FILE] [--no-km-stats] [--min-km N] [--keep-nulls]
venv/bin/python -m fafa.tools.download_fit [--all] [--dry-run] [--limit N]   # OneLap bulk download
venv/bin/python -m fafa.tools.ant_analysis <paths...> [--gap SECONDS] [--json]
```

## Architecture

### Two operating modes

`SERVER_MODE` is `True` when `--server` is in `sys.argv` or `FAFA_SERVER=1`.

| | Local mode | Server mode |
|---|---|---|
| Auth | none (`login_required` is a pass-through) | `users.db`, session cookie, login rate-limit |
| Data dir | `input/` | `input/<username>/`, chmod 700 |
| FIT parsing | in-process | `spawn`ed subprocess with `RLIMIT_CPU/AS/FSIZE`, 30 s timeout |
| Bind | `127.0.0.1` only unless `FAFA_ALLOW_INSECURE_REMOTE=1` | `0.0.0.0` |
| Secret | dev fallback | `FAFA_SECRET` mandatory — `sys.exit` without it |
| Cookies | HttpOnly + SameSite=Lax | + Secure, 12 h lifetime, HSTS header |

`_user_input_dir()` resolves the correct directory per request; **every** route that touches user data must go through it.

### Data layout

```
input/                          local mode: flat FIT library
input/<username>/               server mode: per-user isolation (0700)
  <name>.fit                    FIT library files
  .cache/<name>.fit.json        disk parse cache (keyed by file signature)
  .cache/<name>.fit.parse.lock  per-file flock, prevents duplicate parses
  fafa.db                       SQLite: activity_meta / tags / activity_tags (0600)
  config.json                   per-user AI + sync credentials (0600)
  prompts.json                  customized AI prompt templates + block params (0600)
  prompts_history.json          rolling prompt revisions, 5 per template (0600)
  download_state.json           OneLap incremental sync state
  .sync_state.json              sync progress (readable across gunicorn workers)
  .strava_upload_state.json     Strava upload progress
users.db                        global SQLite: users + login_attempts (0600)
config.template.json            committed template (root)
config.json                     root-level — only a fallback for `fafa.strava` when
                                called outside the web app; the app never reads it
.runtime_locks/                 process-wide slot locks (parse / ai / sync)
```

### Parse pipeline

`_parse_and_build(fit_path, filename)` is the single entry point. Lookup chain:

1. **Memory LRU** `_parse_cache` — `OrderedDict`, 256 MB cap, evicts oldest
2. **Disk cache** `input/<user>/.cache/*.json` — survives restarts
3. **Parse** via `_run_parse_worker` (subprocess in server mode) → `_parse_and_build_direct`

Cache key is the **file signature** `mtime_ns:ctime_ns:size`, not just mtime. A separate `_records_cache` (128 MB) holds the per-second record stream for `/api/records`.

`_parse_and_build_direct` produces: `coords`, `is_gcj02`, `summary`, `km_stats`, `dist_stats` (100 m), `time_stats` (60 s), `time_stats_start` (local), `start_time_utc`, `peak_power` (5/60/300/1200/3600 s), `zone_time_s` (Coggan 7 zones). Add new parse-derived fields here when more than one route needs them.

Concurrency is capped by flock-based slots in `.runtime_locks/`: `FAFA_PARSE_SLOTS` (4), `FAFA_AI_SLOTS` (8), `FAFA_SYNC_SLOTS` (2). Exhaustion returns 429/`ValueError`, never a queue.

### Backend routes (`app.py`)

| Route | Purpose |
|---|---|
| `/login`, `/logout` | session auth; rate-limited per user **and** per IP |
| `/api/upload` | parse an uploaded FIT to a temp file; never persisted |
| `/api/load` | parse one library file; returns `source="library"` |
| `/api/files`, `/api/files/delete`, `/api/files/delete_all`, `/api/files/export` | library management; export streams a ZIP |
| `/api/records/<filename>` | per-second stream for detail charts; local time from `fit.utc_offset_s` |
| `/api/fix_coords` | in-place GCJ-02 conversion; restores mtime and evicts caches |
| `/api/export/all` | streaming JSON export of every activity (`no_km_stats`, `min_km`) |
| `/api/activities` | lightweight summaries; drives activities / PMC / calendar |
| `/api/parse/status` | parse progress for the activities-view loading bar |
| `/api/weather/<filename>` | wind analysis from Open-Meteo (see below) |
| `/api/ai/config`, `/api/ai/evaluate`, `/api/ai/chat`, `/api/ai/pmc`, `/api/ai/calendar`, `/api/ai/compare` | SSE streams via `_llm_stream()` |
| `/api/config/raw` GET/POST | settings modal; secrets masked on read, Strava tokens read-only on write |
| `/api/prompts` GET/POST, `/api/prompts/reset`, `/api/prompts/history`, `/api/prompts/preview` | user-editable AI prompt templates (see below) |
| `/api/sync/start`, `/api/sync/status` | unified sync (`platform`: `onelap` \| `igpsport`) |
| `/api/onelap/sync`, `/api/onelap/status` | legacy OneLap-only aliases |
| `/api/strava/status`, `/api/strava/auth_url`, `/strava/callback`, `/api/strava/diff`, `/api/strava/upload`, `/api/strava/upload/status` | Strava OAuth + diff + upload |
| `/api/meta/<filename>`, `/api/meta/<filename>/note`, `/api/meta/<filename>/tags`, `/api/meta/batch/tags` | notes + tags |
| `/api/tags` GET/POST, `/api/tags/<id>` DELETE | tag CRUD; preset tags cannot be deleted |

### Core library (`fafa/`)

| Module | Contents |
|---|---|
| `parser.py` | `parse_fit()` → `FitData`/`Record`. `Decoder.read()` must keep `apply_scale_and_offset=True`, `merge_heart_rates=False`, `expand_sub_fields=True`. Also `decode_lr_balance()` (bit 7 = side flag, raw `0` = no reading). |
| `stats.py` | `compute_km_stats` / `compute_dist_stats(step_m=100)` / `compute_time_stats(step_s=60)` / `compute_summary`. `_check_fit_limits` rejects >200 000 records or >24 h span. `compute_time_stats` gap-fills paused intervals with zero segments so index *i* always maps to real clock time. |
| `gcj02.py` | WGS-84 ↔ GCJ-02 math + `needs_wgs84_conversion()`. |
| `prompts.py` | AI 提示词默认模板、变量目录、渲染器。See "Prompt templates" below. |
| `db.py` | Per-user SQLite (WAL). Tables `activity_meta`, `tags`, `activity_tags`; 5 preset tags seeded. |
| `auth.py` | `users.db`, password hashing, `login_required`, exponential login lockout. |
| `onelap.py` | OneLap: request signing, API/browser login, list, download, Magene renaming. |
| `igpsport.py` | iGPSport: token login, paged activity list, FIT download. SSRF-guarded redirect handler, 32 MB cap. |
| `strava.py` | OAuth, token refresh, activity diff, upload polling. |
| `tiles.py` | Folium presets — legacy/CLI only, unused by the Leaflet frontend. |
| `reporter.py` | CLI text/JSON/CSV formatting. |

### Security invariants (enforced by `scripts/quality.py`)

The 23 checks run in 8 phases. The load-bearing ones:

- **`git-sensitive-files`** — `config.json`, `users.db`, `download_state.json`, `result.json`, anything under `input/`, and any `.fit` must never be git-tracked.
- **`app-security-invariants`** — these symbols must remain in `app.py`: `SESSION_COOKIE_HTTPONLY`, `SESSION_COOKIE_SAMESITE`, `_resolve_public_api_base`, `_try_acquire_slot`, `_validate_filename_in_input`, `ProxyFix`.
- **`route-auth-decorators`** — AST walk: every `@app.route` matching `/api/`, `/strava/` or `/logout` must also carry `@_auth.login_required`.
- **`no-cdn-scripts` / `vendor-assets`** — no CDN URLs in `templates/index.html`; these files must exist: `static/vendor/leaflet/leaflet.{js,css}`, `static/vendor/marked/marked.min.js`, `static/vendor/dompurify/purify.min.js`.
- **`css-token-enforcement` / `js-inline-style-tokens`** — scan the **staged** diff for hardcoded colors, radii, font sizes, transition durations.
- **`version-date`** — the `version` file must be `vYYYY.MM.DD` matching the last commit date. Bump it when committing.
- **`staged-secrets-scan`**, **`dockerignore`**, **`python-security`** (bandit, `-ll`), **`file-permissions`** (0700 dirs / 0600 files), **`sqlite-integrity`**.

Several checks silently degrade to `[SKIP]` when their tool is absent, so CI installs `bandit` and `PyYAML` explicitly — otherwise `python-security` and `docker-compose-yaml` are listed as passing checks that never actually ran. Bandit's surviving findings are all false positives and carry inline `# nosec <id>` with the reason (bind-to-all in server mode, `?`-only SQL interpolation, urlopen against hardcoded HTTPS constants, MD5 mandated by the OneLap protocol). `hadolint` is still not installed, so `dockerfile-lint` skips.

### CI (`.gitea/workflows/ci.yml`)

One workflow, two jobs: `quality` runs on every push and PR; `build` declares `needs: quality` and is further gated by `if` to `main`, `v*` tags and manual dispatch. Keeping them in separate workflow files makes them run **in parallel**, which lets an image publish while the gate is red — that was the previous setup.

Other hard-coded defenses to preserve: `_validate_filename_in_input` (rejects symlinks, requires parent == resolved input dir), `_resolve_public_api_base` (SSRF: HTTPS-only, blocks RFC1918/loopback/link-local for v4 and v6), `_check_same_origin` before-request hook, CSP/HSTS in `_security_headers`, `_atomic_write_json` for every JSON write, and the 16 MB `MAX_CONTENT_LENGTH`.

### Key data conventions

- FIT GPS is in **semicircles**: `degrees = semicircles × 180 / 2³¹` (`SEMICIRCLE_TO_DEG`).
- `needs_wgs84_conversion(manufacturer)` returns `False` **only** for `magene` — the sole known GCJ-02 manufacturer. Everything else (Garmin, iGPSport, unknown) returns `True`, meaning "already WGS-84, no decryption needed". The name is historical and reads backwards.
- New Magene firmware already stores WGS-84. `_run_sync` auto-decrypts after download for C506 ≥ v19 and C706 ≥ v20 via `auto_decrypt_if_gcj02`.
- The frontend keeps three coordinate variants per track (`raw` / `decrypted` / `encrypted`) and switches display modes with no server round trip. `applyCoordTransform()` writes to disk only when `source === "library"`.
- Amap/Gaode tiles expect GCJ-02 and do **not** send CORS headers, so they are excluded from PNG export (`EXPORT_TILE_URLS` is CartoDB-only). CartoDB tiles set `crossOrigin: 'anonymous'` and are canvas-safe.
- `garmin_fit_sdk.Encoder.write_mesg()` requires `mesg_num` in every message dict; `fafa.tools.fix_coords.MESG_NUM` supplies the common ones.
- Altitude sentinel: values >8848 m or <−500 m are discarded in `parser.py`.
- `_actActivities` (frontend activity cache) must be invalidated after upload, sync, and delete.

### AI integration

All AI endpoints stream Server-Sent Events through `_llm_stream()`, which POSTs to `{api_base}/chat/completions` with `stream: true`. `_resolve_public_api_base` validates the URL before every request; redirects are disabled. Guards: 4 MB response cap, 5 min stream cap, 256 KB per SSE line, `_AI_SLOTS` concurrency. Upstream failures are normalized by `_format_upstream_api_error` into Chinese messages.

- `/api/ai/evaluate` — single-ride coach report
- `/api/ai/compare` — 2–50 rides, wind-normalized speed comparison, doubled token budget
- `/api/ai/pmc` — CTL/ATL/TSB interpretation
- `/api/ai/calendar` — 7 d / 30 d training suggestions
- `/api/ai/chat` — multi-turn, max 100 messages / 200 000 chars

### Prompt templates (`fafa/prompts.py`)

The four `_build_*_prompt()` functions in `app.py` no longer assemble strings — they gather values and hand them to `_prompts.render()`. Five templates: `evaluate`, `compare`, `pmc`, `calendar_7d`, `calendar_30d`.

**Never render user templates with Jinja2 or any evaluating engine.** Flask already ships Jinja2, so `render_template_string` is one import away — and it is SSTI → RCE. In server mode that reads every other user's `config.json` (API keys) and `users.db`. The renderer is a whitelist lookup driven by a **single `re.sub` pass**; because block output is never re-scanned, recursive expansion is structurally impossible. Keep it that way.

Three rules the renderer implements, all load-bearing for output parity with the pre-refactor builders:

- Scalar values **carry their own unit** (`"82.4 km"`), because `None` must render `无数据`, not `无数据 km`.
- A line containing ≥1 placeholder where **all** placeholders render empty is **deleted entirely**. This reproduces every `if filename: lines.append(...)` conditional the old builders had.
- Runs of blank lines collapse to one, so a block that renders empty leaves no hole.

Defaults live in `DEFAULT_TEMPLATES` as module constants and are **never written to disk**. A user file stores only the templates that were actually customized, so a missing key transparently falls back — which also means unedited templates pick up improvements on upgrade, and a corrupt or deleted `prompts.json` degrades to defaults instead of failing. `resolve_template()` treats whitespace-only custom text as absent, and falls back for anything over `MAX_TEMPLATE_CHARS` (a hand-edited file bypasses the save-time check).

`build_*` helpers own the table formatting and take a row-cap parameter (`km_table_rows`, `time_table_rows`, …), clamped by `BLOCK_PARAM_RANGES` in `resolve_blocks()`. Note the `max(1, max_rows // 2)` in `build_km_table` — with a bare `max_rows // 2`, `max_rows=1` yields `km_stats[-0:]`, which is the *entire* list rather than nothing.

Ask `references(template, 'note', 'tags')` before doing work that only a placeholder needs — `_activity_meta_scalars()` uses it to skip SQLite entirely on the default path. It matches via `_TOKEN_RE`, not substring: `{{ note }}` with spaces is a valid reference, and a substring check silently misses it, producing empty data with no error.

**Storage and versioning.** `input/<user>/prompts.json` holds `{version, templates, blocks}` — only customized keys. History lives in a *separate* `prompts_history.json`, because `_load_user_prompts()` runs on every AI request and must not drag several hundred KB of old revisions along.

`_save_user_prompt()` normalizes before writing: text equal to the current value is a no-op (no history entry), and text equal to the default deletes the key rather than storing a duplicate — otherwise that copy would freeze while the shipped default improves. Restoring an old revision is just a normal save, so the value it replaces enters history too and a rollback can itself be rolled back.

History entries are keyed by a monotonic **`rev`**, never by `ts`. Second-resolution timestamps collide when saves land in the same second, and a `ts`-keyed lookup then returns the same entry for every colliding revision. `ts` is for display only.

Writes go **history first, then current**. If the process dies between them, history holds one redundant entry identical to the live value — harmless. The reverse order could lose the text being replaced.

`POST /api/prompts` must validate the template *and* the block params before writing anything. The editor sends both in one request, so validating as it writes means an out-of-range block param reports 400 only after the template has already been saved and pushed to history — the user sees "保存失败", retries, and adds a second spurious revision.

| Route | Purpose |
|---|---|
| `GET /api/prompts` | customized templates + blocks + defaults + catalog + limits |
| `POST /api/prompts` | save one template (`kind`/`text`) and/or `blocks` — **validates both before writing either** |
| `POST /api/prompts/reset` | `{kind}` or `all` — deletes keys |
| `GET /api/prompts/history` | metadata only (`rev`, `ts`, `chars`), no bodies |
| `GET /api/prompts/history/<kind>/<rev>` | one revision's text |
| `POST /api/prompts/preview` | render a draft against sample data |

Preview goes through `_render_kind()` with a `template_override`, i.e. the same assembly path as a live request, so what the editor shows is what the model receives. Sample data is the newest real activity for `evaluate`/`compare`; `pmc` and `calendar_*` use built-in samples because their payloads are computed in the browser and the backend cannot reconstruct them.

**Editor UI.** Settings → AI 配置 → 编辑提示词模板… opens `#prompts-modal` (`openPromptsModal`), which sits at z-index **2300** because the settings modal (2100) stays open behind it. Five tabs, a variable palette that inserts at the cursor, per-template block params, a preview pane, and a history dropdown.

The textarea is **prefilled with the default text** rather than left empty. An empty box gives the user nothing to edit and hides what the prompt actually says; prefilling is safe precisely because the server normalizes text-equal-to-default into a key deletion, so no redundant copy is stored. `_pmtSavedText()` is what drafts are diffed against — comparing against `templates[kind] ?? ''` instead would mark every untouched tab dirty.

Picking a history revision loads it into the editor as a draft; it is not committed until 保存, so the user can preview first. Unsaved drafts survive tab switches and prompt a confirm on close.

Equivalence with the pre-refactor builders was verified over 180 prompts from 60 real FIT files: `compare` is byte-identical; `evaluate` differs only by the deliberate fix below.

> Fixed while extracting: when wind data was present, the old builder appended `### 8. 风力影响评估` *inside the data section*, ahead of `### 1`, and pushed the `- 左右功率平衡` data bullet in among the instruction text. Section 8 is now a normal always-present section with conditional wording, matching how `### 3`/`### 5` already worked.

### Ride comparison (chart-based)

Select ≥2 rides in the activities view → **图表对比** (`_actBulkChartCompare`) opens `#compare-modal`. Entirely client-side — no comparison endpoint exists. Rides are sorted by `start_time` ascending so the earliest acts as the "before" baseline; same-day rides get `HH:MM` appended to disambiguate ECharts series names.

Data comes from `_actActivities` (`summary`, `peak_power`, `zone_time_s` — already cached, no fetch) plus `_fetchActivityData()` per ride for `km_stats` (`/api/load`) and wind (`/api/weather`). Three tabs:

| Tab | Content | Alignment |
|---|---|---|
| 聚合指标 | metric table with Δ% vs baseline, peak-power curve, stacked power-zone bars | none — scalars |
| 逐公里 | per-km line chart, metric switcher, `dataZoom` | absolute km, truncated to the shortest ride |
| 行程 % | per-km resampled to 50 points, y = ratio to each ride's own mean | normalized 0–100 % of ride |

`_cmpWindNormalize()` mirrors `fafa.prompts.wind_normalize_speed()` exactly (0.25 km/h per 1 km/h effective headwind) — **keep the two in sync**. Zone bars normalize each ride against its own pedaling time so ride length doesn't skew the comparison.

Comparison lines are drawn unsmoothed (`smooth` omitted) — the raw per-km shape is the signal, interpolation invents data. The peak-power x-axis is a **category** axis, not log: a log axis picks 10/100/1000 as ticks and drops the 1m/5m/20m labels.

Two teardown invariants, both easy to break:
- `_disposeCompareCharts()` must run on close **and** on theme toggle — ECharts instances capture their theme at `init`, so a themed redraw requires disposing first.
- `_cmpLoadToken` guards the async load. `closeCompareModal()` and each new `_actBulkChartCompare()` bump it; the loader discards its result when the token moved. Without this, closing mid-load builds charts into a hidden modal that nothing ever disposes.

### Weather / wind

`/api/weather/<filename>` computes headwind / tailwind / crosswind percentages by comparing each GPS segment's bearing against hourly wind direction (head = ±45°, tail = 135°–225°, else cross).

Source is user-selectable via the `wind_source` config field, mapped in `_WIND_SOURCES`:

| Value | Endpoint | `models` |
|---|---|---|
| `auto` (default) | `historical-forecast-api` | `best_match` |
| `ecmwf` | `historical-forecast-api` | `ecmwf_ifs025` |
| `gfs` | `historical-forecast-api` | `gfs_seamless` |
| `icon` | `historical-forecast-api` | `icon_seamless` |
| `era5` | `archive-api` | — (reanalysis) |

High-resolution forecast models only cover ~2022–present. When the chosen source returns no wind direction, the request silently falls back to ERA5 (1940–present) and the response reports the source actually used via `source` / `source_label`. Results are cached in-process for 1 h, keyed by `(path, file_signature, wind_source)`, max 500 entries.

## Frontend

`static/app.js` (~5800 lines, no bundler) is organized as ordered section blocks — keep related code inside its block:

ECharts injection → tile configs → detail constants → export constants → GCJ-02 helpers → state → sidebar nav → activities view → **ride comparison** → map init → track coords → add/remove tracks → coord transform → stats helpers → track list UI → panel focus / flash → upload / drag-drop → toast → panel toggle & resize → zoom slider → PNG export → detail view (meta, tags, notes) → detail route heatmap → boot → file library → JSON export → OneLap/iGPSport sync → Strava upload → AI evaluation → PMC → settings modal → **prompt editor** → theme toggle → analytics controller → power distribution → power curve → shared AI modal → per-activity AI → calendar AI → calendar.

Six sidebar views (`switchSidebarView`): `activities` (default) · `map` · `pmc` · `calendar` · `files` · `about`. PMC and calendar share `#analytics-view` and are switched by `switchAnalyticsTab`.

Frontend notes:
- ECharts only — do not add Chart.js. Detail charts use the SVG renderer to avoid DPR blur.
- Markdown always goes through `DOMPurify.sanitize(marked.parse(...))`. Never assign raw model output to `innerHTML`.
- Uploaded-only tracks have no library filename, so `/api/records` is unavailable — fall back to the returned `timeStats` / `kmStats`.
- UI text is Chinese unless a section is already English-only.

### Map zoom floor

The track map's minimum zoom is computed from the container height (`_minZoomForViewport`) so the projected world is never shorter than the viewport — zoomed all the way out, the Mercator poles (±85.0511°) sit exactly on the top and bottom edges. A `ResizeObserver` on `#map` re-applies it, since the container is resized by window changes, sidebar switches and the bottom track panel.

That floor is fractional (≈1.67 at 815 px), which forces two non-obvious settings:

- **`zoomSnap: 0`** on the main map. Leaflet's `_limitZoom` snaps *before* clamping, so with the default `zoomSnap: 1` a fractional `minZoom` is unreachable — zooming out stops at the next integer and the poles never reach the edges. The cost is that most zoom levels become fractional, so tiles are scaled; the default CartoDB layers are `@2x`, which absorbs it. The zoom buttons re-quantize to integers so repeated clicks don't strand the map on 3.27.
- **`maxBounds`** with `±85.0511°` latitude and a deliberately absurd `±1e5` longitude. Constraining latitude alone is not expressible in Leaflet's API, and the huge longitude span makes `_getBoundsOffset` return zero horizontal offset, preserving infinite east-west scroll. Without this, the world exactly fills the height but can still be dragged vertically off-screen.

Do **not** clamp panning by listening for `move` and calling `panTo` — `panTo` fires `move`, which re-enters the handler until the stack overflows, and the blown stack takes map dragging and wheel zoom down with it. `maxBounds` clamps inside `_limitCenter`, before the move happens.

The detail-view route map is a separate `L.map` instance and keeps Leaflet's defaults.

### CSS

All values must use `var(--token)` from the `:root` block in `static/style.css` — no hardcoded hex colors, pixel radii, font sizes, or transition durations. The staged-diff check in `scripts/quality.py` enforces this. Light theme is **not** automatic: it is a `.light-theme` class toggled by `toggleTheme()`, with ~300 explicit override rules. Adding a themed component means adding its light-theme rule too. Full token catalog: `docs/STYLE_GUIDE.md`.

### z-index layers

| Value | Element |
|---|---|
| 1 | `#map` |
| 10 | `#map-header`, `.detail-zoom-sel` |
| 500 | `#map-view`, `#activities-view`, `#files-view`, `#about-view` |
| 800 | `#sidebar` |
| 900 | `#track-panel`, `#zoom-slider-wrap`, `#map-fit-btn` |
| 950 | `#detail-view`, `#analytics-view` |
| 960 | `#ai-view` |
| 1000 | `#detail-route-map-controls`, `#detail-route-legend` |
| 1100 | `#tag-picker`, `#bulk-tag-picker`, `#detail-route-tooltip` |
| 1500 | `#cal-act-modal` |
| 1900 | `#drop-overlay` |
| 2000 | `.toast` |
| 2100 | `#export-modal`, `#sync-modal`, `#strava-modal`, `#settings-modal` |
| 2200 | `#act-ai-modal`, `#compare-modal` (mutually exclusive — never open together) |
| 2300 | `#prompts-modal` (opens from `#settings-modal`, which stays visible behind it) |

## Configuration

`config.json` is per-user and never committed; `config.template.json` documents every field in its `_comments` block. Writes go through `/api/config/raw`, which rejects unknown keys and validates:

- **Strings** (with length caps): `api_base` (HTTPS + SSRF check), `api_key`, `model`, `onelap_username/password`, `igpsport_username/password`, `strava_client_id/secret`
- **Numbers** (with ranges): `max_tokens` 256–16000, `pmc_ftp` 50–600, `pmc_rest_hr` 30–100, `pmc_max_hr` 100–220, `pmc_weight` 30–150, `route_grade_min` −30–0, `route_grade_max` 0–30, `route_speed_max` 10–120, `route_cadence_max` 60–200, `strava_redirect_port` 1024–65535
- **Enums**: `wind_source` ∈ {auto, ecmwf, gfs, icon, era5}; `map_tile` ∈ {dark, dark-nolabels, light, light-nolabels, amap}

Secret fields are returned masked as `••••••••`; posting the mask back leaves the stored value untouched. Strava tokens are read-only through this endpoint.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `FAFA_SERVER` | `0` | `1` enables server mode |
| `FAFA_SECRET` | — | Flask secret key; **required** in server mode |
| `FAFA_HOST` | `127.0.0.1` / `0.0.0.0` | bind address |
| `FAFA_PORT` | `5173` | listen port |
| `FAFA_PROXY_HOPS` | `0` | `ProxyFix` hop count behind a reverse proxy |
| `FAFA_ALLOW_INSECURE_REMOTE` | `0` | allow non-loopback bind in local mode |
| `FAFA_USER_STORAGE_MB` | `10240` | per-user FIT storage cap (floor 32 MB) |
| `FAFA_PARSE_SLOTS` | `4` | concurrent FIT parse workers |
| `FAFA_AI_SLOTS` | `8` | concurrent AI streams |
| `FAFA_SYNC_SLOTS` | `2` | concurrent sync / Strava upload jobs |
| `FLASK_DEBUG` | `0` | debug mode + verbose logging |

### Deployment

`Dockerfile` is `python:3.14-slim` plus Chromium (DrissionPage needs it for OneLap browser login) and Noto CJK fonts; it declares `VOLUME /app/input` and defaults to a no-op `CMD`, so `docker-compose.yml` supplies the real command. Mount `input/` and `users.db` as volumes and set `FAFA_SECRET` before starting.
