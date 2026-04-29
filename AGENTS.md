# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

**FAFA** — FIT file analysis and visualization toolset for cycling data.

FIT (Flexible and Interoperable Data Transfer) is a binary format used by Garmin, Magene, and other sports devices to record GPS tracks, heart rate, power, cadence, and other workout metrics.

## Architecture

### Web viewer (`app.py` + `templates/` + `static/`)

Flask API backend + Leaflet.js + Chart.js frontend. The main user-facing tool.

**Two interfaces, single page:**

- **Interface 1 (map view)**: Multiple FIT files loaded via drag-and-drop. Leaflet renders polylines. Bottom panel shows per-track stats summary chips and JSON/CSV export buttons. Hovering a panel row flashes its polyline. Top-right zoom slider. Top-center topbar with tile selector and PNG export modal.

- **Interface 2 (detail view)**: Full-screen overlay (`z-index: 950`) shown when clicking a track name. Displays a Chart.js line chart (metric selectable, x-axis km or cumulative time) and a per-km data table. Closed via back button or Esc.

**Upload flow** (`/api/upload`):
1. Saves `.fit` to a temp file, parses via `parse_fit()`, immediately deletes temp file.
2. Extracts GPS coords (semicircles → degrees).
3. Computes `Summary` and `List[KmStats]` via `fafa/stats.py`.
4. Returns `{ coords, filename, is_gcj02, summary, km_stats }`.

**Client-side coordinate handling**: On upload, all three coordinate variants are pre-computed in JS (`raw`, `decrypted`, `encrypted`) and stored on the track object. Switching modes re-renders the polyline without any server round-trip.

### Core library (`fafa/`)

- `parser.py` — FIT decoder; produces `FitData` / `Record` dataclasses via `garmin_fit_sdk`. `apply_scale_and_offset=True` must be set on the Decoder.
- `gcj02.py` — WGS-84 ↔ GCJ-02 conversion; `needs_wgs84_conversion(manufacturer)` identifies device CRS.
- `tiles.py` — Folium tile presets (amap/dark/light variants); used only by CLI map tools, not the web viewer.
- `stats.py` — `compute_km_stats(fit)` → `List[KmStats]`; `compute_summary(fit, km_stats)` → `Summary`. Both are dataclasses; serialise with `dataclasses.asdict`.
- `reporter.py` — `to_json(stats, summary)` and `to_csv(stats)` for CLI output.

### CLI tools (top-level scripts)

- `analyze.py` — Per-km stats: table / JSON / CSV
- `map_track.py` — Single-track Folium HTML map, colour-coded by metric
- `map_all.py` — All tracks from a directory on one Folium HTML map
- `fix_coords.py` — Batch GCJ-02 ↔ WGS-84 correction written back into FIT files
- `rename_fit.py` — Rename Magene raw filenames to `Magene_C506_YYYYMMDD-HHMMSS_{id}.fit`

## Key conventions

- FIT GPS values are in **semicircles**: `degrees = semicircles × 180 / 2³¹`
- Magene devices store **GCJ-02**; Garmin stores **WGS-84**
- `needs_wgs84_conversion(manufacturer)` returns `True` for Garmin — meaning the file is already WGS-84 and does **not** need GCJ-02 decryption. The name is historical; read it as "is this a WGS-84 device."
- CartoDB tiles (dark/light) support CORS (`crossOrigin='anonymous'`) — safe for `canvas.toBlob()` PNG export
- Gaode/Amap tiles do **not** support CORS — excluded from the PNG export tile options
- `garmin_fit_sdk.Encoder.write_mesg()` requires a `mesg_num` key in every message dict (needed by `fix_coords.py`)

## Frontend structure (`static/app.js`)

Key sections in order:

| Section | Contents |
|---|---|
| Constants | `TILES`, `PALETTE`, `METRICS`, `TABLE_COLS`, `EXPORT_TILE_URLS`, `EXPORT_RESOLUTIONS` |
| GCJ-02 | `wgs84ToGcj02`, `gcj02ToWgs84`, `encryptCoords`, `decryptCoords` |
| State | `map`, `tracks` (Map), `exportState`, panel state, detail view state |
| Map init | `initMap`, `setTiles` |
| Track coords | `getCoords`, `renderTrack` |
| Track management | `addTrack`, `removeTrack`, `clearAllTracks`, `setTrackMode` |
| Stats helpers | `_fmtDur`, `_statChips`, `_downloadText`, `_toCSV`, `exportTrackData` |
| Track list UI | `addTrackRow`, `syncBadge`, `syncEmptyHint` |
| Flash effect | `startFlash`, `stopFlash` (polyline opacity toggle on panel hover) |
| Upload / drag-drop | `uploadFile`, `setupDragDrop` |
| Toast | `toast` |
| Panel | `togglePanel`, `initPanelResize` |
| Zoom slider | `initZoomSlider` |
| PNG export | `openExportModal`, `doExport`, canvas tile/track drawing helpers |
| Detail view | `openDetailView`, `closeDetailView`, chart/table rendering, `exportDetailData` |
| Boot | `DOMContentLoaded` wires everything up |

## z-index layers

| Value | Element |
|---|---|
| 1 | `#map` |
| 900 | `#topbar`, `#track-panel`, `#zoom-slider-wrap` |
| 950 | `#detail-view` (covers main UI, below modals) |
| 1900 | `#drop-overlay` |
| 2000 | `.toast` |
| 2100 | `#export-modal` |
