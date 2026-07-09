# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**FAFA** — FIT file analysis and visualization toolset for cycling data. FIT (Flexible and Interoperable Data Transfer) is a binary format used by Garmin, Magene, and other sports devices.

## Commands

```bash
# Development server (local mode — no auth, loopback only)
python app.py

# Production server (requires FAFA_SECRET env var)
FAFA_SERVER=1 FAFA_SECRET=<secret> ./start.sh

# Quality gate (23 checks: security, syntax, deps, frontend, formatting, runtime)
python scripts/quality.py check

# Auto-fix (trailing whitespace, __pycache__, file permissions) then check
python scripts/quality.py fix

# CI mode (skips local-only checks: file-permissions, sqlite-integrity)
python scripts/quality.py check --ci

# Install pre-commit hook (run once after clone)
bash scripts/install-hooks.sh

# User management (server mode only)
python -m fafa.tools.manage_users add <username>
python -m fafa.tools.manage_users list
python -m fafa.tools.manage_users passwd <username>
python -m fafa.tools.manage_users delete <username>

# CLI tools (run as Python modules)
python -m fafa.tools.fix_coords <src.fit> <dst.fit> [--method gcj2wgs|wgs2gcj]
python -m fafa.tools.rename_fit <dir>
python -m fafa.tools.export_all [--no-km-stats] [--min-km N]
python -m fafa.tools.ant_analysis <file.fit> [--gap SECONDS] [--json]
python -m fafa.tools.download_fit
```

There are no automated tests — `python scripts/quality.py check` is the quality gate.

## Architecture

### Two operating modes

`SERVER_MODE` is `True` when `--server` is passed or `FAFA_SERVER=1` is set.

- **Local mode**: No authentication. All data in `input/`. Listens on loopback only (`127.0.0.1:5173`). FIT parsing runs in-process.
- **Server mode**: Full auth via `users.db`. Per-user data isolation in `input/<username>/`. FIT parsing spawned in a sandboxed subprocess (`_run_parse_worker`). Requires `FAFA_SECRET` env var; refuses to start without it.

### Data layout

```
input/                    # local mode: flat directory of .fit files
input/<username>/         # server mode: per-user isolation (chmod 700)
input/<username>/.cache/  # disk parse cache (JSON, keyed by filename+mtime)
input/<username>/fafa.db  # per-user SQLite: tags + activity notes
users.db                  # global SQLite: user accounts + login rate-limiting
config.json               # per-user AI/sync credentials (see config.template.json)
```

### Parse cache (two levels)

1. **In-memory LRU** (`_parse_cache`, 256 MB cap, `OrderedDict`) — process lifetime
2. **Disk cache** (`input/.cache/`, JSON per file) — survives server restarts

Cache key = absolute path + mtime. Lookup chain: `_cache_get` → `_disk_cache_load` → `_parse_and_build`. All routes resolve the correct per-user directory via `_user_input_dir()`.

### Security invariants (enforced by quality gate)

`scripts/quality.py` checks every commit via the `git-sensitive-files` check:
- `config.json`, `users.db`, `download_state.json`, `result.json`, `input/`, and `.fit` files must never be git-tracked
- These symbols must remain in `app.py`: `SESSION_COOKIE_HTTPONLY`, `SESSION_COOKIE_SAMESITE`, `_resolve_public_api_base`, `_try_acquire_slot`, `_validate_filename_in_input`, `ProxyFix`
- Every `@app.route` under `/api/` must also carry `@_auth.login_required`
- No CDN script tags in `index.html` — all JS/CSS must be vendored locally

Required local vendor assets (absent = failing build):
- `static/vendor/leaflet/leaflet.js` + `leaflet.css`
- `static/vendor/marked/marked.min.js`
- `static/vendor/dompurify/purify.min.js`

### Key data conventions

- **FIT GPS**: semicircles → degrees: `degrees = semicircles × 180 / 2³¹`
- **`needs_wgs84_conversion(manufacturer)`** returns `True` for Garmin and iGPSport — meaning the file is already WGS-84 and needs **no** GCJ-02 decryption. The name is historical.
- **Magene devices**: store GCJ-02. New firmware auto-decrypts after sync (C506 ≥ v19, C706 ≥ v20).
- **CartoDB tiles** support `crossOrigin='anonymous'` — safe for canvas PNG export. Gaode/Amap tiles do **not** support CORS and are excluded from PNG export options.
- All JSON writes go through `_atomic_write_json` (write-to-temp + rename).
- `garmin_fit_sdk.Encoder.write_mesg()` requires a `mesg_num` key in every message dict.
- User storage cap controlled by `FAFA_USER_STORAGE_MB` env var (default 10 240 MB).

### AI integration

All AI endpoints (`/api/ai/evaluate`, `/api/ai/pmc`, `/api/ai/calendar`, `/api/ai/compare`) use an OpenAI-compatible chat completions API configured in `config.json`. Responses stream via SSE. `_resolve_public_api_base` validates the URL before any request. `/api/ai/chat` accepts multi-turn `messages` (max 100 messages, 200 000 chars total). Weather data for wind analysis comes from Open-Meteo (`/api/weather/<filename>`); the source is user-selectable via the `wind_source` config field (`auto`/`ecmwf`/`gfs`/`icon`/`era5`, default `auto`, mapped in `_WIND_SOURCES`). High-resolution forecast models (`historical-forecast-api`) cover ~2022–present; rides with no model data (older than ~2022) silently fall back to the ERA5 reanalysis (`archive-api`, 1940–present). The response carries `source`/`source_label` for the actually-used source. Results are cached in-process with a TTL, keyed by file signature **and** `wind_source`.

### Frontend CSS

All CSS values must use `var(--token)` from the `:root` block in `static/style.css`. No hardcoded hex colors, pixel radii, font sizes, or transition durations. Light theme support is automatic when tokens are used — no per-selector overrides. Full token catalog is in `docs/STYLE_GUIDE.md`.

### z-index layers

| Value | Element |
|---|---|
| 1 | `#map` |
| 500 | `#activities-view`, `#files-view` |
| 800 | `#sidebar` |
| 900 | `#track-panel`, `#zoom-slider-wrap` |
| 950 | `#detail-view` |
| 960 | `#analytics-view`, `#ai-view` |
| 1000 | detail route legend |
| 1500 | `#cal-act-modal` |
| 1900 | `#drop-overlay` |
| 2000 | `.toast` |
| 2100 | `#export-modal`, `#sync-modal`, `#strava-modal` |

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `FAFA_SERVER` | `0` | Enable server mode |
| `FAFA_SECRET` | — | Flask secret key (required in server mode) |
| `FAFA_PROXY_HOPS` | `0` | `ProxyFix` hop count for reverse proxy |
| `FAFA_HOST` | `127.0.0.1` / `0.0.0.0` | Bind address |
| `FAFA_PORT` | `5173` | Listen port |
| `FAFA_USER_STORAGE_MB` | `10240` | Per-user FIT storage cap |
| `FAFA_ALLOW_INSECURE_REMOTE` | `0` | Allow non-loopback bind in local mode |
