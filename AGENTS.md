# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

**FAFA** — FIT file analysis and visualization toolset for cycling data.

FIT (Flexible and Interoperable Data Transfer) is a binary format used by Garmin, Magene, and other sports devices to record GPS tracks, heart rate, power, cadence, temperature, altitude, and workout metrics.

## Architecture

### Web viewer (`app.py` + `templates/` + `static/`)

Flask API backend + Leaflet.js + ECharts frontend. This is the main user-facing tool.

The app is a single-page UI with a fixed left sidebar (`#sidebar`) and five primary sidebar views:

- **Activities view** (`#activities-view`, default): Activity cards from `input/*.fit`, grouped by month. Supports year/month/distance/tag filters, multi-select, bulk load-to-map, bulk Strava upload, bulk delete, summary totals, per-activity AI analysis, and route-heatmap entry.
- **Map view** (`#map-view` / `#map`): Multiple FIT tracks loaded by drag-and-drop, upload, activities view, or file view. Leaflet renders polylines. The bottom track panel shows stats chips, coordinate transform buttons, JSON/CSV export, track flashing on hover, and reverse-chronological sorting.
- **Files view** (`#files-view`): File manager for `input/`. Supports filename search, Magene year/month filter chips, import FIT, load files to map, multi-select delete/load, delete all, OneLap sync, and library count badge.
- **PMC view** (`#analytics-view`, `pmc` tab): Performance management dashboard with CTL/ATL/TSB, training distributions, power zones, peak power curve, recent daily charts, and AI training-state analysis.
- **Training calendar view** (`#analytics-view`, `calendar` tab): Monthly calendar of rides with day detail modal and AI weekly/monthly training suggestions.

Full-screen overlays:

- **Detail view** (`#detail-view`): Opened from an activity card or map track name. Shows summary, metadata tags/notes, ECharts data charts, resizable segment table, route heatmap tab, JSON/CSV export, and AI evaluation.
- **AI view / modals** (`#ai-view`, `#act-ai-modal`): Stream markdown responses from configured OpenAI-compatible chat-completions API.
- **Settings / export / sync / Strava modals**: Used for config editing, PNG export, OneLap progress, and Strava auth/upload progress.

### Upload and Parse Flow

`/api/upload`:

1. Saves the uploaded `.fit` to a temporary file.
2. Parses it via `parse_fit()`.
3. Extracts GPS coordinates from semicircles to degrees.
4. Computes `summary`, per-km stats, per-100 m stats, per-1 min time stats, peak power, and power-zone time.
5. Deletes the temporary file.
6. Returns parsed data with `source="upload"`.

`/api/load` does the same for a safe filename under `input/`, using memory and disk cache when possible, and returns `source="library"`.

`_parse_and_build()` is the central backend parse path. Keep new parse-derived fields there if they are needed by more than one API or frontend view.

### Backend Routes

Important Flask endpoints in `app.py`:

- `/api/upload` — parse uploaded FIT file; does not persist the upload.
- `/api/files`, `/api/files/delete`, `/api/files/delete_all` — manage `input/*.fit`.
- `/api/load` — parse one library FIT file under `input/`.
- `/api/records/<filename>` — raw record stream for detail charts, local timestamp derived from `fit.utc_offset_s`.
- `/api/fix_coords` — write GCJ-02/WGS-84 conversion back into a library FIT file via `fafa.tools.fix_coords.fix_file`.
- `/api/export/all` — global JSON export of parsed activities; supports `no_km_stats=1` and `min_km=N`.
- `/api/activities` — lightweight activity list for activities, PMC, calendar, tags, and bulk actions.
- `/api/config/raw` — settings modal read/write for `config.json`; Strava OAuth token fields are read-only in this endpoint.
- `/api/ai/evaluate`, `/api/ai/pmc`, `/api/ai/calendar` — SSE streams through `_llm_stream()`.
- `/api/onelap/sync`, `/api/onelap/status` — background OneLap download sync.
- `/api/strava/status`, `/api/strava/auth_url`, `/strava/callback`, `/api/strava/diff`, `/api/strava/upload`, `/api/strava/upload/status` — Strava OAuth, diff, and upload.
- `/api/meta/<filename>`, `/api/meta/<filename>/note`, `/api/meta/<filename>/tags`, `/api/tags` — notes and tags backed by SQLite.

### Core Library (`fafa/`)

- `parser.py` — FIT decoder; produces `FitData` / `Record` dataclasses via `garmin_fit_sdk`. `Decoder.read()` must keep `apply_scale_and_offset=True`, `merge_heart_rates=False`, and `expand_sub_fields=True` for normal parse paths.
- `stats.py` — segment and summary computation. `compute_km_stats(fit)`, `compute_dist_stats(fit, step_m=100)`, `compute_time_stats(fit, step_s=60)`, and `compute_summary(fit, km_stats)` return dataclasses suitable for `dataclasses.asdict`.
- `gcj02.py` — WGS-84 ↔ GCJ-02 conversion and manufacturer CRS detection. `needs_wgs84_conversion(manufacturer)` returns `True` for WGS-84 devices such as Garmin and `False` for known GCJ-02 devices such as Magene.
- `tiles.py` — Folium tile presets used by legacy/CLI map code, not the current Leaflet web viewer.
- `reporter.py` — CLI JSON/CSV formatting helpers.
- `onelap.py` — OneLap client: signing, browser/API login, activity listing, FIT download, and Magene filename normalization.
- `strava.py` — Strava OAuth, token refresh, dedup state, diff helpers, and upload pipeline. Credentials and tokens live in `config.json`; upload state lives in `input/.strava_state.json`.
- `db.py` — SQLite metadata store at `input/fafa.db`. Tables: `activity_meta`, `tags`, and `activity_tags`. `init_db(INPUT_DIR)` is called during Flask app startup.

### CLI Tools (`fafa/tools/`)

Run tools as Python modules:

- `venv/bin/python -m fafa.tools.fix_coords --method decrypt`
- `venv/bin/python -m fafa.tools.fix_coords --method encrypt input/ -o output/fixed/`
- `venv/bin/python -m fafa.tools.rename_fit --dry-run`
- `venv/bin/python -m fafa.tools.export_all --no-km-stats --min-km 5`
- `venv/bin/python -m fafa.tools.download_fit --limit 20`
- `venv/bin/python -m fafa.tools.ant_analysis --json`

There are no current top-level CLI scripts for analysis/map generation; prefer the `fafa.tools.*` modules.

## Data and State

- `input/` contains the local FIT library and is created on app startup.
- `input/.cache/` stores parsed JSON cache files keyed by filename + mtime.
- `input/fafa.db` stores activity notes and tags.
- `input/.strava_state.json` stores local Strava upload dedup state.
- `download_state.json` stores OneLap sync state.
- `config.json` is user-local config and should not be treated as source. `config.template.json` is the committed template.

## Key Conventions

- FIT GPS values are in **semicircles**: `degrees = semicircles * 180 / 2^31`.
- Magene devices store **GCJ-02**; Garmin stores **WGS-84**.
- The historical name `needs_wgs84_conversion()` is easy to misread: `True` means the source is already WGS-84 and may need GCJ-02 conversion for GCJ-02 tiles, not that the FIT needs decryption.
- Client-side tracks store three coordinate variants: `raw`, `decrypted`, and `encrypted`. Switching display modes re-renders without a server round trip.
- Amap/Gaode tiles expect GCJ-02. CartoDB dark/light tiles use WGS-84/Web Mercator and support CORS for PNG export.
- Gaode/Amap tiles are excluded from PNG export options because they do not support CORS for `canvas.toBlob()`.
- `garmin_fit_sdk.Encoder.write_mesg()` requires `mesg_num` in every encoded message dict; `fafa.tools.fix_coords.MESG_NUM` supplies common message numbers.
- New Magene firmware can store GCJ-02 in raw FIT files. `_run_sync()` auto-decrypts after download for C506 version >= 19 and C706 version >= 20.
- File safety checks should resolve paths and ensure the parent is exactly `INPUT_DIR.resolve()` before reading, deleting, or mutating a library FIT.
- `/api/fix_coords` resets mtime after writing and explicitly evicts stale memory cache. Keep cache invalidation in mind when mutating library files.

## Frontend Structure (`static/app.js`)

The file is organized as large section blocks. Preserve this order when adding related code:

| Section | Contents |
|---|---|
| Constants | `TILES`, `PALETTE`, `METRICS`, route color scales, table/export options |
| GCJ-02 | Browser-side coordinate conversion helpers |
| State | Map, tracks, export, detail, analytics, PMC, calendar, activities, file library, Strava, AI state |
| Sidebar nav | `switchSidebarView()` for `activities`, `map`, `pmc`, `calendar`, `files` |
| Activities view | Filtering, tag chips, select mode, activity cards, bulk actions, AI modal |
| Map init | `initMap()`, `setTiles()` |
| Track coords | `getCoords()`, `renderTrack()` |
| Track management | `addTrack()`, `removeTrack()`, `clearAllTracks()`, `applyCoordTransform()` |
| Stats / export helpers | Duration formatting, stat chips, JSON/CSV download |
| Track list UI | Track rows, reverse-chronological sort, badges, empty hints |
| Flash effect | Polyline emphasis on panel hover |
| Upload / drag-drop | `uploadFile()`, `setupDragDrop()` |
| Panel / zoom | Bottom panel resize/collapse and custom zoom slider |
| PNG export | Modal state, tile loading, canvas tile/path drawing |
| Detail view | Detail open/close, metadata, ECharts charts, table, route heatmap, export |
| File library | Refresh, filters, render, select mode, bulk delete/load |
| OneLap sync | Sync modal and polling |
| Strava upload | Auth, diff, upload modal, status polling |
| AI / settings | Config loading, settings modal, markdown rendering, shared stream modal |
| Analytics / PMC | PMC computation, TSS, cards, charts, zones, distributions, power curve |
| Calendar | Month navigation, calendar grid, activity modal |
| Boot | `DOMContentLoaded` wiring |

### Frontend Notes

- ECharts is used for charts; do not add Chart.js.
- Detail charts prefer SVG renderer to avoid DPR blurriness during browser zoom.
- Uploaded-only tracks may not have a library filename for `/api/records`; use returned `timeStats`/`kmStats` fallback paths.
- `applyCoordTransform()` writes to disk only for `source === "library"`. Uploaded tracks update display mode only.
- Activity cache `_actActivities` must be invalidated after upload, sync, and delete operations.
- Keep UI text in Chinese unless a local section is already English-only.

## z-index Layers

| Value | Element |
|---|---|
| 1 | `#map` |
| 500 | `#map-view`, `#activities-view`, `#files-view` |
| 800 | `#sidebar` |
| 900 | `#track-panel`, `#zoom-slider-wrap`, map controls |
| 950 | `#detail-view`, `#analytics-view` |
| 960 | `#ai-view` |
| 1500 | `#cal-act-modal` |
| 1900 | `#drop-overlay` |
| 2000 | `.toast` |
| 2100 | `#export-modal`, `#sync-modal`, `#strava-modal`, `#settings-modal` |
| 2200 | tag picker / high-priority floating UI |

## Local Development

Install dependencies:

```bash
python3 -m venv venv
venv/bin/pip install -r requirements.txt
```

Run the web app:

```bash
venv/bin/python app.py
```

Then open `http://localhost:5173`.

There is no dedicated automated test suite in this repository. For changes to parsing/statistics, validate with one or more FIT files under `input/` when available. For frontend changes, run the Flask app and manually exercise the affected view.
