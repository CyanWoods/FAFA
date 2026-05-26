# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**FAFA** — FIT file analysis and visualization toolset for cycling data.

FIT (Flexible and Interoperable Data Transfer) is a binary format used by Garmin, Magene, and other sports devices to record GPS tracks, heart rate, power, cadence, and other workout metrics.

## Architecture

### Web viewer (`app.py` + `templates/` + `static/`)

Flask API backend + Leaflet.js + Chart.js frontend. The main user-facing tool.

**Layout**: Fixed 180 px sidebar on the left (`#sidebar`, z-index 800) with nav icons for six top-level views. The rest of the viewport is view-specific content.

**Six views:**

- **Activities view** (`#activities-view`, default boot view): Activity cards grouped by month. Year / month dropdowns + distance-range preset buttons filter the list. Multi-select mode (long-press or select button) enables bulk load-to-tracks, bulk upload to Strava, and bulk delete. Summary bar shows totals for the filtered set. Each card has an "AI 分析" button and a "轨迹" button — clicking "轨迹" clears all current tracks, loads only that file into the map, and switches to map view. The header has a "加载全部轨迹" button that loads all visible activities. Cache: `_actActivities` (module-level) is invalidated on upload, sync, and any delete.

- **Map view** (`#map`, `data-view="map"`): Dedicated sidebar nav entry (骑行轨迹). Multiple FIT files loaded via drag-and-drop or from activities/files view. Leaflet renders polylines. Bottom panel (`#track-panel`) shows per-track stats and JSON/CSV export; track list sorted reverse-chronologically. Hovering a panel row flashes the polyline. Header bar (`#map-header`) with tile selector and PNG export controls, consistent with other views. Right-side floating zoom slider (`#zoom-slider-wrap`). Bottom-left floating track panel (`#track-panel`). Map view is shown/hidden via `#map-view` active class toggle when switching sidebar views. Sidebar badge (`#track-badge`) shows loaded track count; panel count shown in `#panel-track-count`.

- **Files view** (`#files-view`): File management for `input/`. Search by filename, Magene year/month filter chips, load individual file or load all to map, delete all, trigger OneLap sync. Upload via file input (导入 FIT button).

- **Detail view** (`#detail-view`, z-index 950): Full-screen overlay shown when clicking an activity card or a track name in the map panel. Chart.js line chart (metric selectable, x-axis: km / per-100 m / cumulative time) + per-km data table. Opened from either activities or map view; closing returns to the originating view.

- **PMC view** (`#analytics-view`, `data-view="pmc"`, z-index 960): Full-screen overlay showing Performance Management Chart — CTL/ATL/TSB curves, power curve, zone distribution, and AI training-state commentary (`startPmcAi`). Opened via the sidebar 体能管理 icon.

- **Training Calendar view** (`#analytics-view`, `data-view="calendar"`, z-index 960): Full-screen overlay showing a monthly calendar grid of daily rides. Per-day detail modal on click. AI period buttons trigger `startCalendarAi(period)` for weekly or monthly training suggestions. Opened via the sidebar 训练日历 icon.

**Upload flow** (`/api/upload`):
1. Saves `.fit` to a temp file, parses via `parse_fit()`, immediately deletes temp file.
2. Extracts GPS coords (semicircles → degrees).
3. Computes `Summary`, `List[KmStats]` (per-km), `List[KmStats]` (per-100 m), `List[KmStats]` (per-1 min) via `fafa/stats.py`.
4. Returns `{ coords, filename, is_gcj02, summary, km_stats, dist_stats, time_stats, time_stats_start }`.

**Client-side coordinate handling**: On upload, all three coordinate variants are pre-computed in JS (`raw`, `decrypted`, `encrypted`) and stored on the track object. Switching modes re-renders the polyline without any server round-trip.

**Activities API** (`/api/activities`): Returns lightweight summary of every `.fit` in `input/` — filename, date, start_time, summary fields, peak_power, zone_time_s. Uses the same parse cache as `/api/load`. Used by both the activities view and the PMC computation.

**Disk cache** (`input/.cache/`): JSON cache files keyed by filename + mtime. Survives Flask restarts. `get_activities()` uses `ThreadPoolExecutor` (up to 8 workers) + the cache to parse the full library quickly on first load.

**Onelap sync** (`/api/onelap/sync`, `/api/onelap/status`): Background thread logs into 顽鹿 via a Chromium browser, fetches the activity list, downloads new FIT files to `input/`, and auto-decrypts files when: C506 with software version ≥ 19, or C706 with software version ≥ 20 (new Magene firmware that stores GCJ-02).

**AI features** (`config.json`): Template at `config.template.json`. Fields: `api_base`, `api_key`, `model`, `max_tokens`, `onelap_username`, `onelap_password`, and `strava_*` credentials (see Strava section). Three AI endpoints:
- `/api/ai/evaluate` (POST `{filename}`) — streams per-activity evaluation.
- `/api/ai/pmc` (POST `{current, trend, recent_rides, settings}`) — streams PMC training-state commentary.
- `/api/ai/calendar` (POST `{period, current_date, activities}`) — streams weekly or monthly training suggestions.

**Config API** (`/api/config/raw`): GET returns current `config.json` (or template defaults if file absent); POST merges editable fields into `config.json` (read-only Strava OAuth tokens are filtered out). Used by the settings modal and PMC parameter persistence (`pmc_ftp`, `pmc_max_hr`, etc.).

**Records API** (`/api/records/<filename>`): Returns per-second FIT record data (`t`, `speed_kmh`, `hr`, `power`, `cadence`, `altitude`, `grade`) with timestamps converted to local clock time via `fit.utc_offset_s`. Used by the detail view for real-time x-axis charts (falls back to `timeStats` for uploaded-only tracks).

**Strava diff** (`/api/strava/diff`): Compares all local `.fit` files against the user's Strava activity list. Match strategy: (1) `external_id == filename` (set at upload time — exact, no FIT parse needed); (2) fallback ±60 s start-time match using `start_time_utc` from cache or a direct `parse_fit()` read. Returns `{to_upload, local_count, strava_count, match_count}`. Frontend `_stravaUploadAllVisible` calls this first, shows a confirm dialog with counts, then uploads only the diff set.

**Global JSON export** (`/api/export/all`): Downloads a JSON of all parsed activities in `input/`. Accepts `no_km_stats=1` and `min_km=N` query params. Used by AI analysis workflows.

### Core library (`fafa/`)

- `parser.py` — FIT decoder; produces `FitData` / `Record` dataclasses via `garmin_fit_sdk`. `apply_scale_and_offset=True` must be set on the Decoder.
- `gcj02.py` — WGS-84 ↔ GCJ-02 conversion; `needs_wgs84_conversion(manufacturer)` identifies device CRS.
- `tiles.py` — Folium tile presets (amap/dark/light variants); used only by CLI map tools, not the web viewer.
- `stats.py` — Three segmentation functions: `compute_km_stats(fit)` → per-km, `compute_dist_stats(fit, step_m=100)` → per-100 m, `compute_time_stats(fit, step_s=60)` → per-1 min with gap-filling. `compute_summary(fit, km_stats)` → `Summary`. All are dataclasses; serialise with `dataclasses.asdict`.
- `reporter.py` — `to_json(stats, summary)` and `to_csv(stats)` for CLI output.
- `onelap.py` — 顽鹿（OneLap）API client. `browser_login()` → Chromium-based auth; `fetch_activity_list()`, `download_activity()` → download pipeline. Also contains `rename_magene()` and `latest_local_time()` helpers.
- `strava.py` — Strava upload integration. `load_config()` / `_save_tokens()` read/write `strava_*` fields in `config.json`. `get_access_token()` auto-refreshes. `build_auth_url()` / `exchange_code()` handle OAuth. `upload_files(filenames, force, progress_cb)` uploads named FIT files from `input/` with dedup state at `input/.strava_state.json`. `fetch_all_activities(access_token)` paginates `GET /api/v3/athlete/activities` and returns `[{id, external_id, start_unix}]` — used by `/api/strava/diff`.

### CLI tools (`fafa/tools/` — run as Python modules)

- `fafa.tools.fix_coords` — Batch GCJ-02 ↔ WGS-84 correction written back into FIT files. `fix_file(src, dst, method)` is also called by `app.py`.
- `fafa.tools.rename_fit` — Rename Magene raw filenames to `Magene_{model}_{id}_YYYYMMDD-HHMMSS.fit`
- `fafa.tools.export_all` — Batch-parse `input/` and write a JSON file for AI use. Supports `--no-km-stats`, `--min-km`, `--keep-nulls`.
- `fafa.tools.download_fit` — CLI wrapper for the OneLap download pipeline (same logic as the web sync, but terminal output).
- `fafa.tools.ant_analysis` — Analyze ANT+ device connection duration per FIT file. Reports per-device connected time, percentage of ride, and disconnection windows derived from `record_mesgs`. Devices without a record-level metric field (Di2/eTap, lights, radar) are listed as registered. Supports `--gap SECONDS` to merge short dropout windows and `--json` for machine-readable output.

## Key conventions

- FIT GPS values are in **semicircles**: `degrees = semicircles × 180 / 2³¹`
- Magene devices store **GCJ-02**; Garmin stores **WGS-84**
- `needs_wgs84_conversion(manufacturer)` returns `True` for Garmin — meaning the file is already WGS-84 and does **not** need GCJ-02 decryption. The name is historical; read it as "is this a WGS-84 device."
- CartoDB tiles (dark/light) support CORS (`crossOrigin='anonymous'`) — safe for `canvas.toBlob()` PNG export
- Gaode/Amap tiles do **not** support CORS — excluded from the PNG export tile options
- `garmin_fit_sdk.Encoder.write_mesg()` requires a `mesg_num` key in every message dict (needed by `fafa/tools/fix_coords.py`)
- New Magene firmware stores GCJ-02 in raw FIT files; `_run_sync` auto-decrypts after download: C506 with version ≥ 19, C706 with version ≥ 20.
- The `/api/fix_coords` endpoint and the `_run_sync` auto-decrypt both import from `fafa.tools.fix_coords`, not from any top-level script.
- Files view year/month filter (`_MAGENE_DATE_RE`) only matches Magene filename format — Garmin files get no filter chip and show raw filename as label.

## Frontend structure (`static/app.js`)

Key sections in order:

| Section | Contents |
|---|---|
| Constants | `TILES`, `PALETTE`, `METRICS`, `TABLE_COLS`, `EXPORT_TILE_URLS`, `EXPORT_RESOLUTIONS` |
| GCJ-02 | `wgs84ToGcj02`, `gcj02ToWgs84`, `encryptCoords`, `decryptCoords` |
| State | `map`, `tracks` (Map), `exportState`, sidebar/panel/detail/analytics state |
| Sidebar nav | `switchSidebarView` — switches between `activities`, `map`, `files`, `pmc`, `calendar` |
| Activities view | `_actFilter`, `_actFilteredList`, `_actFilterChanged`, `_actDistPreset`, select mode helpers (`_toggleSelectMode`, `_enterSelectMode`, `_exitSelectMode`, `_updateSelectBar`, `_actSelectAll`), `openActivitiesView`, `_renderActivityList`, `_buildActivityCard`, `_activityCardClick`, `openActAiModal`, bulk actions |
| Map init | `initMap`, `setTiles` |
| Track coords | `getCoords`, `renderTrack` |
| Track management | `addTrack`, `removeTrack`, `clearAllTracks`, `setTrackMode` |
| Coord write-back | `applyCoordTransform` (library tracks only, calls `/api/fix_coords`) |
| Stats helpers | `_fmtDur`, `_statChips`, `_downloadText`, `_toCSV`, `exportTrackData` |
| Track list UI | `addTrackRow`, `syncBadge`, `syncEmptyHint`, `_sortTrackList` (reverse-chronological), `_trackSortKey`, `_trackDateLabel` |
| Flash effect | `startFlash`, `stopFlash` (polyline opacity toggle on panel hover) |
| Upload / drag-drop | `uploadFile`, `setupDragDrop` |
| Toast | `toast` |
| Panel | `togglePanel`, `initPanelResize` |
| Zoom slider | `initZoomSlider` |
| PNG export | `openExportModal`, `doExport`, canvas tile/track drawing helpers |
| Detail view | `openDetailView`, `closeDetailView`, chart/table rendering, `exportDetailData` |
| File library | `refreshLibrary`, `_buildLibFilter`, `_renderLibrary`, `loadFromLibrary`, select mode helpers (`_enterLibSelectMode`, `_exitLibSelectMode`, `_libBulkDelete`) |
| Global export | export-all modal, calls `/api/export/all` |
| Analytics / PMC | `openAnalyticsView`, `closeAnalyticsView`, `_computePMC`, `_computeTSS`, `_renderPmcCards`, `_renderPmcChart`, `_renderPmcZones`, `_renderPmcCurve`, `pmcRecalc` |
| Training calendar | `_loadAndRenderCalendar`, `_renderCalGrid`, `_renderCalActModal` |
| AI | `_initAiConfig`, `_llmStream`, `_renderMarkdown`, `_openAndStreamModal` (shared SSE modal helper), `openActAiModal`, `startPmcAi`, `startCalendarAi` |
| Onelap sync | `openSyncModal`, `closeSyncModal`, `startSync`, `_pollSync` |
| Strava upload | `_stravaCheckStatus`, `_stravaOpenUploadModal`, `_stravaStartUpload`, `_stravaFetchDiff`, `_stravaShowDiffView`, `_stravaConfirmDiff`, `_stravaUploadAllVisible`, `_stravaUploadSelected`, `stravaStartAuth`, `openStravaModal`, `closeStravaModal`, `_pollStravaUpload`, `_setStravaUI` |
| Boot | `DOMContentLoaded` wires everything up |

## z-index layers

| Value | Element |
|---|---|
| 1 | `#map` |
| 500 | `#activities-view`, `#files-view` (sidebar content, below map controls) |
| 800 | `#sidebar` |
| 900 | `#track-panel`, `#zoom-slider-wrap` |
| 950 | `#detail-view` (covers main UI) |
| 960 | `#analytics-view`, `#ai-view` |
| 1000 | detail route legend |
| 1500 | `#cal-act-modal` (calendar activity detail) |
| 1900 | `#drop-overlay` |
| 2000 | `.toast` |
| 2100 | `#export-modal`, `#sync-modal`, `#strava-modal` |
