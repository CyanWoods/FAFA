# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**FAFA** — FIT file analysis and visualization toolset for cycling data.

FIT (Flexible and Interoperable Data Transfer) is a binary format used by Garmin, Magene, and other sports devices to record GPS tracks, heart rate, power, cadence, and other workout metrics.

## Architecture

### Web viewer (`app.py` + `templates/` + `static/`)

Flask API backend + Leaflet.js + ECharts frontend. The main user-facing tool.

**Layout**: Fixed 180 px sidebar on the left (`#sidebar`, z-index 800) with nav icons for six top-level views. The rest of the viewport is view-specific content.

**Six views:**

- **Activities view** (`#activities-view`, default boot view): Activity cards grouped by month. Year / month dropdowns + distance-range preset buttons filter the list. Multi-select mode (long-press or select button) enables bulk load-to-tracks, bulk tag editing, bulk upload to Strava, bulk delete, and bulk AI compare (`_actBulkAiCompare` — streams comparative analysis of 2+ selected rides via `/api/ai/compare`). Bulk tag picker (`#bulk-tag-picker`, appended to `<body>`) shows tri-state chips (all/some/none) for each tag; right-aligned to the anchor button, repositions on window resize. Summary bar shows totals for the filtered set. Each card has an "AI 分析" button and a "轨迹" button — clicking "轨迹" clears all current tracks, loads only that file into the map, and switches to map view. The header has a "加载全部轨迹" button that loads all visible activities. Cache: `_actActivities` (module-level) is invalidated on upload, sync, and any delete.

- **Map view** (`#map`, `data-view="map"`): Dedicated sidebar nav entry (骑行轨迹). Multiple FIT files loaded via drag-and-drop or from activities/files view. Leaflet renders polylines. Bottom panel (`#track-panel`) shows per-track stats and JSON/CSV export; track list sorted reverse-chronologically. Hovering a panel row flashes the polyline. Header bar (`#map-header`) with tile selector and PNG export controls, consistent with other views. Right-side floating zoom slider (`#zoom-slider-wrap`). Bottom-left floating track panel (`#track-panel`). Map view is shown/hidden via `#map-view` active class toggle when switching sidebar views. Sidebar badge (`#track-badge`) shows loaded track count; panel count shown in `#panel-track-count`.

- **Files view** (`#files-view`): File management for `input/`. Search by filename, Magene year/month filter chips, load individual file or load all to map, delete all, trigger FIT sync (顽鹿 / iGPSport). Upload via file input (导入 FIT button).

- **Detail view** (`#detail-view`, z-index 950): Full-screen overlay shown when clicking an activity card or a track name in the map panel. Layout: left column (`#detail-chart-section`) — scrollable ECharts SVG line charts for all available metrics, with two side-by-side distribution bar charts below (功率分布 Coggan Z1-Z7 by %FTP, 心率分布 by %max-HR — same zoning as the PMC view, computed client-side from per-second records); right column (`#detail-route-section`) — Leaflet route heatmap always visible alongside charts, color-coded by the selected metric. A vertical drag handle (`#detail-split-handle`) between columns adjusts the width ratio (dblclick resets to 50/50). Hovering any chart syncs a position marker on the heatmap via ZRender mousemove → cumDist binary search → `L.circleMarker`; mouseout hides the marker with a 60 ms debounce to prevent flicker when moving between adjacent charts. A ⊡ button inside the map resets `fitBounds`. Bottom (`#detail-table-section`): per-km data table with a draggable resize handle. Below the header bar is `#detail-meta` — a tag & note bar where users can assign colour-coded tags and write Markdown notes per activity (persisted to `input/fafa.db`). Opened from either activities or map view; closing returns to the originating view.

- **PMC view** (`#analytics-view`, `data-view="pmc"`, z-index 960): Full-screen overlay showing Performance Management Chart — CTL/ATL/TSB curves (ECharts SVG renderer, no DPR blurriness on Cmd+scroll), power curve; distribution charts (功率分布 Z1-Z7, 距离分布, 时长分布, 爬升分布, TSS分布) rendered as CSS vertical bar charts with independent time-range filter buttons (7/30/90/180/全部天) per chart; current-month daily training ECharts bar charts (距离/时间/爬升/TSS/次数, extends to 30-day window if fewer than 14 days into the month); and AI training-state commentary (`startPmcAi`). Opened via the sidebar 体能管理 icon.

- **Training Calendar view** (`#analytics-view`, `data-view="calendar"`, z-index 960): Full-screen overlay showing a monthly calendar grid of daily rides. Per-day detail modal on click. AI period buttons trigger `startCalendarAi(period)` for weekly or monthly training suggestions. Opened via the sidebar 训练日历 icon.

**Upload flow** (`/api/upload`):
1. Saves `.fit` to a temp file, parses via `_run_parse_worker()` (sandboxed subprocess in server mode, direct call otherwise), immediately deletes temp file.
2. Extracts GPS coords (semicircles → degrees).
3. Computes `Summary`, `List[KmStats]` (per-km), `List[KmStats]` (per-100 m), `List[KmStats]` (per-1 min) via `fafa/stats.py`.
4. Returns `{ coords, filename, is_gcj02, summary, km_stats, dist_stats, time_stats, time_stats_start }`.

**Client-side coordinate handling**: On upload, all three coordinate variants are pre-computed in JS (`raw`, `decrypted`, `encrypted`) and stored on the track object. Switching modes re-renders the polyline without any server round-trip.

**Activities API** (`/api/activities`): Returns lightweight summary of every `.fit` in `input/` — filename, date, start_time, summary fields, peak_power, zone_time_s, and a `tags` array (from `input/fafa.db`). Uses the same parse cache as `/api/load`. Used by both the activities view and the PMC computation.

**Parse status API** (`/api/parse/status`): GET returns `{state, total, done}` for the current user's FIT parsing progress. `state` is `"parsing"` while `get_activities()` is running, `"idle"` otherwise. Polled by the activities view (400 ms interval) to render a progress bar + file count during initial load after a sync.

**Activity metadata API** (`/api/meta/<filename>`): GET returns `{note, tags}` for an activity. POST `/api/meta/<filename>/note` saves a Markdown note. POST `/api/meta/<filename>/tags` saves tag assignments (`{tag_ids: [int]}`). Tags and notes are stored in `input/fafa.db` via `fafa/db.py`.

**Batch tags API** (`/api/meta/batch/tags`): POST `{filenames: [...], add_tag_ids: [...], remove_tag_ids: [...]}` — applies tag additions and removals atomically across multiple activities. Used by the bulk tag picker in multi-select mode.

**Tags API** (`/api/tags`): GET lists all tags `[{id, name, color, is_preset}]`. POST creates a new tag `{name, color}` → 201 `{tag}`. DELETE `/api/tags/<id>` removes a user-created tag (preset tags return 403).

**Disk cache** (`input/.cache/`): JSON cache files keyed by filename + mtime. Survives Flask restarts. `get_activities()` uses a global `_activity_executor` (4 workers) + the cache to parse the full library quickly on first load.

**FIT sync** (`/api/sync/start`, `/api/sync/status`): Unified sync endpoint supporting 顽鹿（OneLap）and iGPSport platforms. POST `{platform: "onelap"|"igpsport", full: bool, limit?: int}` to start; dispatches `_run_sync(full, limit)` or `_run_igpsport_sync(full)` in a background thread. Shared `_sync` state dict + `_sync_lock`. Old `/api/onelap/sync` and `/api/onelap/status` preserved as aliases. 顽鹿: Chromium-based auth, auto-decrypts GCJ-02 files (C506 ≥ v19, C706 ≥ v20). iGPSport: REST API login (`https://prod.zh.igpsport.com/service`), Bearer token, paginated activity list, dedup by `iGPSport_{ride_id}_*.fit` glob; files are WGS-84, no decrypt needed. Credentials for both platforms loaded via `_load_onelap_credentials()` / `_load_igpsport_credentials()` from `config.json`.

**AI features** (`config.json`): Template at `config.template.json`. Fields: `api_base`, `api_key`, `model`, `max_tokens`, `onelap_username`, `onelap_password`, `igpsport_username`, `igpsport_password`, and `strava_*` credentials (see Strava section). Four AI endpoints:
- `/api/ai/evaluate` (POST `{filename}`) — streams per-activity evaluation.
- `/api/ai/pmc` (POST `{current, trend, recent_rides, settings}`) — streams PMC training-state commentary.
- `/api/ai/calendar` (POST `{period, current_date, activities}`) — streams weekly or monthly training suggestions.
- `/api/ai/compare` (POST `{activities, settings}`) — streams comparative analysis of 2+ selected rides. Uses `_wind_normalize_speed()` and `_build_compare_prompt()` helpers; `max_tokens` overridden to 4000 for longer output.

**Config API** (`/api/config/raw`): GET returns current `config.json` (or template defaults if file absent); POST merges editable fields into `config.json` (read-only Strava OAuth tokens are filtered out). Used by the settings modal and PMC parameter persistence (`pmc_ftp`, `pmc_max_hr`, etc.).

**Records API** (`/api/records/<filename>`): Returns per-second FIT record data (`t`, `speed_kmh`, `hr`, `power`, `cadence`, `altitude`, `grade`) with timestamps converted to local clock time via `fit.utc_offset_s`. Used by the detail view for real-time x-axis charts (falls back to `timeStats` for uploaded-only tracks).

**Strava diff** (`/api/strava/diff`): Compares all local `.fit` files against the user's Strava activity list. Match strategy: (1) `external_id == filename` (set at upload time — exact, no FIT parse needed); (2) fallback ±60 s start-time match using `start_time_utc` from cache or a direct `parse_fit()` read. Returns `{to_upload, local_count, strava_count, match_count}`. Frontend `_stravaUploadAllVisible` calls this first, shows a confirm dialog with counts, then uploads only the diff set.

**Global JSON export** (`/api/export/all`): Downloads a JSON of all parsed activities in `input/`. Accepts `no_km_stats=1` and `min_km=N` query params. Used by AI analysis workflows.

### Core library (`fafa/`)

- `parser.py` — FIT decoder; produces `FitData` / `Record` dataclasses via `garmin_fit_sdk`. `apply_scale_and_offset=True` must be set on the Decoder. Altitude values outside `[-500, 8848]` m are set to `None` (FIT uint16 invalid sentinel `0xFFFF` → `12607.0` after scale/offset).
- `gcj02.py` — WGS-84 ↔ GCJ-02 conversion; `needs_wgs84_conversion(manufacturer)` identifies device CRS.
- `tiles.py` — Folium tile presets (amap/dark/light variants); used only by CLI map tools, not the web viewer.
- `stats.py` — Three segmentation functions: `compute_km_stats(fit)` → per-km, `compute_dist_stats(fit, step_m=100)` → per-100 m, `compute_time_stats(fit, step_s=60)` → per-1 min with gap-filling. `compute_summary(fit, km_stats)` → `Summary`. All are dataclasses; serialise with `dataclasses.asdict`.
- `reporter.py` — `to_json(stats, summary)` and `to_csv(stats)` for CLI output.
- `onelap.py` — 顽鹿（OneLap）API client. `browser_login()` → Chromium-based auth; `fetch_activity_list()`, `download_activity()` → download pipeline. Also contains `rename_magene()` and `latest_local_time()` helpers.
- `igpsport.py` — iGPSport REST API client. `IGPSportClient.login()` → Bearer token (3 retries); `get_all_activities()` → paginated list; `download_file(ride_id, dst_path)` → `.part`→rename, 3 retries. Pure helpers: `_parse_start_time(item)` → `datetime|None` (handles `%Y-%m-%d %H:%M:%S`, `%H:%M`, `%Y-%m-%d` formats); `make_filename(ride_id, start_time)` → `iGPSport_{ride_id}_{YYYYMMDD-HHMMSS}.fit`; `ride_id_exists(ride_id, input_dir)` → glob dedup check.
- `strava.py` — Strava upload integration. `load_config()` / `_save_tokens()` read/write `strava_*` fields in `config.json`. `get_access_token()` auto-refreshes (raises a re-auth message if the `refresh_token` is rejected). `classify_error(text)` tags Strava errors (`auth`/`duplicate`/`permission`/`rate_limit`); `auth` errors abort `upload_files` and surface an `auth_error` flag through `/api/strava/diff` and the upload status so the frontend can re-prompt OAuth. `build_auth_url()` / `exchange_code()` handle OAuth. `upload_files(filenames, force, progress_cb)` uploads named FIT files from `input/` with dedup state at `input/.strava_state.json`. `fetch_all_activities(access_token)` paginates `GET /api/v3/athlete/activities` and returns `[{id, external_id, start_unix}]` — used by `/api/strava/diff`.
- `db.py` — SQLite persistence for activity metadata (`input/fafa.db`). Tables: `activity_meta` (note per filename), `tags` (id/name/color/is_preset), `activity_tags` (filename↔tag_id). `init_db(input_dir)` creates tables and seeds five preset tags on first run. Thread-safe via `_db_lock`.

### CLI tools (`fafa/tools/` — run as Python modules)

- `fafa.tools.fix_coords` — Batch GCJ-02 ↔ WGS-84 correction written back into FIT files. `fix_file(src, dst, method)` is also called by `app.py`.
- `fafa.tools.rename_fit` — Rename Magene raw filenames to `Magene_{model}_{id}_YYYYMMDD-HHMMSS.fit`
- `fafa.tools.export_all` — Batch-parse `input/` and write a JSON file for AI use. Supports `--no-km-stats`, `--min-km`, `--keep-nulls`.
- `fafa.tools.download_fit` — CLI wrapper for the OneLap download pipeline (same logic as the web sync, but terminal output).
- `fafa.tools.ant_analysis` — Analyze ANT+ device connection duration per FIT file. Reports per-device connected time, percentage of ride, and disconnection windows derived from `record_mesgs`. Devices without a record-level metric field (Di2/eTap, lights, radar) are listed as registered. Di2/eTap additionally shows gear change events with direction arrows; events where both gears are 255 are tagged `[重连?]` (probable reconnect signal, validated across multiple files). All timestamps are shown in local time (derived from `activity_mesgs` UTC offset). BLE devices are excluded from output. Supports `--gap SECONDS` to merge short dropout windows and `--json` for machine-readable output.

## Frontend Style Guide

All frontend CSS must follow `docs/STYLE_GUIDE.md`. Key rules:

- Reuse existing classes before writing new CSS (see Reusable Class Catalog in the guide)
- All new CSS properties must use `var(--token)` from `:root` in `static/style.css`
- No hardcoded colors (`#2e86de`), radii (`20px`), font sizes (`12px`), or transitions
- Light theme support is automatic for token-based components — no per-selector overrides needed

Token quick ref: `--color-primary`, `--surface-hover`, `--border-default`, `--text-muted`, `--radius-pill`, `--text-base`, `--transition-base`

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
- Wind arrow bearing uses `_bearingByTimeWindow(elapsedS)`: ±180 s window around current elapsed time, converted to distance range via uniform-pace assumption (`d = (t/totalDur) * totalDist`), binary search for start/end GPS indices, bearing from window-start to window-end point. Falls back to `_bearingAtIndex(lo)` (adjacent-point) when window collapses to a single GPS point.
- iGPSport files use WGS-84 (same as Garmin) — `needs_wgs84_conversion()` returns `True` for them, meaning no GCJ-02 decryption needed.
- `/api/sync/start` dispatches by `platform` field: `"onelap"` → `_run_sync`, `"igpsport"` → `_run_igpsport_sync`. Both update shared `_sync` dict; old `/api/onelap/*` routes are aliases.

## Frontend structure (`static/app.js`)

Key sections in order:

| Section | Contents |
|---|---|
| Constants | `TILES`, `PALETTE`, `METRICS`, `TABLE_COLS`, `EXPORT_TILE_URLS`, `EXPORT_RESOLUTIONS` |
| GCJ-02 | `wgs84ToGcj02`, `gcj02ToWgs84`, `encryptCoords`, `decryptCoords` |
| State | `map`, `tracks` (Map), `exportState`, sidebar/panel/detail/analytics state |
| Sidebar nav | `switchSidebarView` — switches between `activities`, `map`, `files`, `pmc`, `calendar` |
| Activities view | `_actFilter`, `_actFilteredList`, `_actFilterChanged`, `_actDistPreset`, select mode helpers (`_toggleSelectMode`, `_enterSelectMode`, `_exitSelectMode`, `_updateSelectBar`, `_actSelectAll`), `openActivitiesView`, `_renderActivityList`, `_buildActivityCard`, `_activityCardClick`, `openActAiModal`, `_actBulkAiCompare`, bulk actions |
| Bulk tag picker | `_positionBulkTagPicker`, `_openBulkTagPicker`, `_onBulkTagPickerResize`, `_closeBulkTagPicker`, `_bulkPickerOutsideClick`, `_renderBulkTagPickerList`, `_confirmBulkTags` — tri-state (all/some/none) bulk tag editor; picker appended to `<body>`, right-aligned to anchor, repositions on resize |
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
| PNG export | `openExportModal`, `doExport`, canvas tile/track drawing helpers; `_haversineKm`, `_trackBboxCenter`, `_groupTracksByDistance` (greedy centroid clustering by distance threshold); `_exportGroup` (single-group canvas render); multi-group output adds `_1`/`_2` suffixes |
| Detail view | `openDetailView`, `closeDetailView`, chart/table rendering, distribution bars (`_renderDetailDistributions`, `_detailDistBlock`), `exportDetailData` |
| Detail meta | `_loadAndRenderDetailMeta`, `_renderDetailTagsRow`, `_renderDetailNote`, `_initDetailNoteButtons`, `_openTagPicker`, `_closeTagPicker`, `_renderTagPickerList`, `_saveDetailTags`, `_syncActivityTagsInCache` |
| File library | `refreshLibrary`, `_buildLibFilter`, `_renderLibrary`, `loadFromLibrary`, select mode helpers (`_enterLibSelectMode`, `_exitLibSelectMode`, `_libBulkDelete`) |
| Global export | export-all modal, calls `/api/export/all` |
| Analytics / PMC | `openAnalyticsView`, `closeAnalyticsView`, `_computePMC`, `_computeTSS`, `_renderPmcCards`, `_renderPmcChart`, `_renderPmcZones`, `_renderPmcDistOne`, `_renderPmcDist`, `_renderPmcDaily`, `_renderPmcCurve`, `_applyZonePeriod`, `_applyDistPeriod`, `_pmcChartTheme`, `_pmcLocalDateString`, `pmcRecalc` |
| Training calendar | `_loadAndRenderCalendar`, `_renderCalGrid`, `_renderCalActModal` |
| AI | `_initAiConfig`, `_llmStream`, `_renderMarkdown`, `_openAndStreamModal` (shared SSE modal helper), `openActAiModal`, `_actBulkAiCompare`, `startPmcAi`, `startCalendarAi` |
| FIT sync | `openSyncModal`, `closeSyncModal`, `startSync` (reads `input[name="sync-platform"]:checked`, POSTs to `/api/sync/start`), `_pollSync` (polls `/api/sync/status`), `_SYNC_PLATFORM_DESC`, `_syncUpdatePlatformDesc` |
| Strava upload | `_stravaCheckStatus`, `_stravaOpenUploadModal`, `_stravaStartUpload`, `_stravaFetchDiff`, `_stravaShowDiffView`, `_stravaConfirmDiff`, `_stravaUploadAllVisible`, `_stravaUploadSelected`, `stravaStartAuth`, `_onStravaAuthMessage` (popup → opener auto-close on auth success), `_stravaPromptReauth` (re-auth prompt when an `auth_error` is returned), `openStravaModal`, `closeStravaModal`, `_pollStravaUpload`, `_setStravaUI` |
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
