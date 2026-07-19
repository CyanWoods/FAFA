# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

ECharts injection → tile configs → detail constants → export constants → GCJ-02 helpers → state → sidebar nav → activities view → map init → track coords → add/remove tracks → coord transform → stats helpers → track list UI → panel focus / flash → upload / drag-drop → toast → panel toggle & resize → zoom slider → PNG export → detail view (meta, tags, notes) → detail route heatmap → boot → file library → JSON export → OneLap/iGPSport sync → Strava upload → AI evaluation → PMC → settings modal → theme toggle → analytics controller → power distribution → power curve → shared AI modal → per-activity AI → calendar AI → calendar.

Six sidebar views (`switchSidebarView`): `activities` (default) · `map` · `pmc` · `calendar` · `files` · `about`. PMC and calendar share `#analytics-view` and are switched by `switchAnalyticsTab`.

Frontend notes:
- ECharts only — do not add Chart.js. Detail charts use the SVG renderer to avoid DPR blur.
- Markdown always goes through `DOMPurify.sanitize(marked.parse(...))`. Never assign raw model output to `innerHTML`.
- Uploaded-only tracks have no library filename, so `/api/records` is unavailable — fall back to the returned `timeStats` / `kmStats`.
- UI text is Chinese unless a section is already English-only.

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
| 2200 | `#act-ai-modal` |

## Configuration

`config.json` is per-user and never committed; `config.template.json` documents every field in its `_comments` block. Writes go through `/api/config/raw`, which rejects unknown keys and validates:

- **Strings** (with length caps): `api_base` (HTTPS + SSRF check), `api_key`, `model`, `onelap_username/password`, `igpsport_username/password`, `strava_client_id/secret`
- **Numbers** (with ranges): `max_tokens` 256–16000, `pmc_ftp` 50–600, `pmc_rest_hr` 30–100, `pmc_max_hr` 100–220, `pmc_weight` 30–150, `route_grade_min` −30–0, `route_grade_max` 0–30, `route_speed_max` 10–120, `route_cadence_max` 60–200, `strava_redirect_port` 1024–65535
- **Enum**: `wind_source` ∈ {auto, ecmwf, gfs, icon, era5}

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
