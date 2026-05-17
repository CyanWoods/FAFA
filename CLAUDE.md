# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**FAFA** — FIT file analysis and visualization toolset for cycling data.

FIT (Flexible and Interoperable Data Transfer) is a binary format used by Garmin, Magene, and other sports devices to record GPS tracks, heart rate, power, cadence, and other workout metrics.

## Architecture

### Web viewer (`app.py` + `templates/` + `static/`)

Flask API backend + Leaflet.js + Chart.js frontend. The main user-facing tool.

**Layout**: Fixed 180 px sidebar on the left (`#sidebar`, z-index 800) with nav icons for four top-level views. The rest of the viewport is view-specific content.

**Five views:**

- **Activities view** (`#activities-view`, default boot view): Activity cards grouped by month. Year / month dropdowns + distance-range preset buttons filter the list. Multi-select mode (long-press or select button) enables bulk load-to-map and bulk delete. Summary bar shows totals for the filtered set. Cache: `_actActivities` (module-level) is invalidated on upload, sync, and any delete.

- **Map view** (`#map`): Multiple FIT files loaded via drag-and-drop or from activities/files view. Leaflet renders polylines. Bottom panel (`#track-panel`) shows per-track stats and JSON/CSV export. Hovering a panel row flashes the polyline. Top-center topbar with tile selector and PNG export modal. Top-right zoom slider. Map controls (`#topbar`, `#track-panel`, `#zoom-slider-wrap`) are hidden when any other sidebar view is active.

- **Files view** (`#files-view`): File management for `input/`. Search by filename, Magene year/month filter chips, load individual file or load all to map, delete all, trigger OneLap sync. Upload via file input (导入 FIT button).

- **Detail view** (`#detail-view`, z-index 950): Full-screen overlay shown when clicking an activity card or a track name in the map panel. Chart.js line chart (metric selectable, x-axis: km / per-100 m / cumulative time) + per-km data table. Opened from either activities or map view; closing returns to the originating view.

- **Analytics view** (`#analytics-view`, z-index 960): Full-screen overlay with two tabs — **PMC** (Performance Management Chart: CTL/ATL/TSB, power curve, zone distribution, AI commentary) and **Training Calendar**. Opened via the sidebar analytics icon.

**Upload flow** (`/api/upload`):
1. Saves `.fit` to a temp file, parses via `parse_fit()`, immediately deletes temp file.
2. Extracts GPS coords (semicircles → degrees).
3. Computes `Summary`, `List[KmStats]` (per-km), `List[KmStats]` (per-100 m), `List[KmStats]` (per-1 min) via `fafa/stats.py`.
4. Returns `{ coords, filename, is_gcj02, summary, km_stats, dist_stats, time_stats, time_stats_start }`.

**Client-side coordinate handling**: On upload, all three coordinate variants are pre-computed in JS (`raw`, `decrypted`, `encrypted`) and stored on the track object. Switching modes re-renders the polyline without any server round-trip.

**Activities API** (`/api/activities`): Returns lightweight summary of every `.fit` in `input/` — filename, date, start_time, summary fields, peak_power, zone_time_s. Uses the same parse cache as `/api/load`. Used by both the activities view and the PMC computation.

**Disk cache** (`input/.cache/`): JSON cache files keyed by filename + mtime. Survives Flask restarts. `get_activities()` uses `ThreadPoolExecutor` (up to 8 workers) + the cache to parse the full library quickly on first load.

**Onelap sync** (`/api/onelap/sync`, `/api/onelap/status`): Background thread logs into 顽鹿 via a Chromium browser, fetches the activity list, downloads new FIT files to `input/`, and auto-decrypts files with software version > 18 (new Magene firmware that stores GCJ-02).

**AI features** (`ai_config.json`): Template at `ai_config.template.json`. Fields: `base_url`, `api_key`, `model`. Two AI endpoints:
- `/api/ai/evaluate` (POST `{filename}`) — streams per-activity evaluation.
- `/api/ai/pmc` (POST `{current, trend, recent_rides, settings}`) — streams PMC commentary.

**Global JSON export** (`/api/export/all`): Downloads a JSON of all parsed activities in `input/`. Accepts `no_km_stats=1` and `min_km=N` query params. Used by AI analysis workflows.

### Core library (`fafa/`)

- `parser.py` — FIT decoder; produces `FitData` / `Record` dataclasses via `garmin_fit_sdk`. `apply_scale_and_offset=True` must be set on the Decoder.
- `gcj02.py` — WGS-84 ↔ GCJ-02 conversion; `needs_wgs84_conversion(manufacturer)` identifies device CRS.
- `tiles.py` — Folium tile presets (amap/dark/light variants); used only by CLI map tools, not the web viewer.
- `stats.py` — Three segmentation functions: `compute_km_stats(fit)` → per-km, `compute_dist_stats(fit, step_m=100)` → per-100 m, `compute_time_stats(fit, step_s=60)` → per-1 min with gap-filling. `compute_summary(fit, km_stats)` → `Summary`. All are dataclasses; serialise with `dataclasses.asdict`.
- `reporter.py` — `to_json(stats, summary)` and `to_csv(stats)` for CLI output.
- `onelap.py` — 顽鹿（OneLap）API client. `browser_login()` → Chromium-based auth; `fetch_activity_list()`, `download_activity()` → download pipeline. Also contains `rename_magene()` and `latest_local_time()` helpers.

### CLI tools (`fafa/tools/` — run as Python modules)

- `fafa.tools.fix_coords` — Batch GCJ-02 ↔ WGS-84 correction written back into FIT files. `fix_file(src, dst, method)` is also called by `app.py`.
- `fafa.tools.rename_fit` — Rename Magene raw filenames to `Magene_{model}_{id}_YYYYMMDD-HHMMSS.fit`
- `fafa.tools.export_all` — Batch-parse `input/` and write a JSON file for AI use. Supports `--no-km-stats`, `--min-km`, `--keep-nulls`.
- `fafa.tools.download_fit` — CLI wrapper for the OneLap download pipeline (same logic as the web sync, but terminal output).

## Key conventions

- FIT GPS values are in **semicircles**: `degrees = semicircles × 180 / 2³¹`
- Magene devices store **GCJ-02**; Garmin stores **WGS-84**
- `needs_wgs84_conversion(manufacturer)` returns `True` for Garmin — meaning the file is already WGS-84 and does **not** need GCJ-02 decryption. The name is historical; read it as "is this a WGS-84 device."
- CartoDB tiles (dark/light) support CORS (`crossOrigin='anonymous'`) — safe for `canvas.toBlob()` PNG export
- Gaode/Amap tiles do **not** support CORS — excluded from the PNG export tile options
- `garmin_fit_sdk.Encoder.write_mesg()` requires a `mesg_num` key in every message dict (needed by `fafa/tools/fix_coords.py`)
- New Magene firmware (software version > 18) stores GCJ-02 in raw FIT files; `_run_sync` in `app.py` auto-decrypts these after download.
- The `/api/fix_coords` endpoint and the `_run_sync` auto-decrypt both import from `fafa.tools.fix_coords`, not from any top-level script.
- Files view year/month filter (`_MAGENE_DATE_RE`) only matches Magene filename format — Garmin files get no filter chip and show raw filename as label.

## Frontend structure (`static/app.js`)

Key sections in order:

| Section | Contents |
|---|---|
| Constants | `TILES`, `PALETTE`, `METRICS`, `TABLE_COLS`, `EXPORT_TILE_URLS`, `EXPORT_RESOLUTIONS` |
| GCJ-02 | `wgs84ToGcj02`, `gcj02ToWgs84`, `encryptCoords`, `decryptCoords` |
| State | `map`, `tracks` (Map), `exportState`, sidebar/panel/detail/analytics state |
| Sidebar nav | `switchSidebarView` — switches between `activities`, `map`, `files`, `analytics` |
| Activities view | `_actFilter`, `_actFilteredList`, `_actFilterChanged`, `_actDistPreset`, select mode helpers, `openActivitiesView`, `_renderActivityList`, `_buildActivityCard`, `_activityCardClick`, bulk actions |
| Map init | `initMap`, `setTiles` |
| Track coords | `getCoords`, `renderTrack` |
| Track management | `addTrack`, `removeTrack`, `clearAllTracks`, `setTrackMode` |
| Coord write-back | `applyCoordTransform` (library tracks only, calls `/api/fix_coords`) |
| Stats helpers | `_fmtDur`, `_statChips`, `_downloadText`, `_toCSV`, `exportTrackData` |
| Track list UI | `addTrackRow`, `syncBadge`, `syncEmptyHint` |
| Flash effect | `startFlash`, `stopFlash` (polyline opacity toggle on panel hover) |
| Upload / drag-drop | `uploadFile`, `setupDragDrop` |
| Toast | `toast` |
| Panel | `togglePanel`, `initPanelResize` |
| Zoom slider | `initZoomSlider` |
| PNG export | `openExportModal`, `doExport`, canvas tile/track drawing helpers |
| Detail view | `openDetailView`, `closeDetailView`, chart/table rendering, `exportDetailData` |
| File library | `refreshLibrary`, `_buildLibFilter`, `_renderLibrary`, `loadFromLibrary`, `loadAllFromLibrary`, `deleteAllFromLibrary` |
| Global export | export-all modal, calls `/api/export/all` |
| Analytics / PMC | `openAnalyticsView`, `closeAnalyticsView`, `_computePMC`, `_computeTSS`, `_renderPmcCards`, `_renderPmcChart`, `_renderPmcZones`, `_renderPmcCurve`, `pmcRecalc` |
| Training calendar | `_loadAndRenderCalendar`, `_renderCalGrid`, `_renderCalActModal` |
| AI | `_initAiConfig`, `_llmStream`, AI evaluate panel in detail view, AI PMC commentary |
| Onelap sync | `openSyncModal`, `closeSyncModal`, `startSync`, `_pollSync` |
| Boot | `DOMContentLoaded` wires everything up |

## z-index layers

| Value | Element |
|---|---|
| 1 | `#map` |
| 500 | `#activities-view`, `#files-view` (sidebar content, below map controls) |
| 800 | `#sidebar` |
| 900 | `#topbar`, `#track-panel`, `#zoom-slider-wrap` |
| 950 | `#detail-view` (covers main UI) |
| 960 | `#analytics-view`, `#ai-view` |
| 1000 | detail route legend |
| 1500 | `#cal-act-modal` (calendar activity detail) |
| 1900 | `#drop-overlay` |
| 2000 | `.toast` |
| 2100 | `#export-modal`, `#sync-modal` |
