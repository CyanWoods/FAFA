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
venv/bin/python -m fafa.tools.manage_users add|list|passwd|delete|promote|migrate-config [<username>]
#   promote          — grant is_admin=1; the *first* admin on an instance must be set this way
#                       (the web admin UI can only promote/demote once an admin already exists)
#   migrate-config    — force the config.json→user_config lazy migration immediately instead of
#                       waiting for the user's next login (see "Accounts, roles..." below)

# Bulk legacy config migration (server mode; requires the production FAFA_SECRET)
FAFA_SECRET=<secret> venv/bin/python scripts/migrate_config_to_db.py --dry-run
FAFA_SECRET=<secret> venv/bin/python scripts/migrate_config_to_db.py
#   --username USER    limit to one or more users (repeatable)
#   --config PATH      migrate one explicit file; requires exactly one --username

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
  config.json.bak               legacy config file, renamed here after one-time migration
                                into users.db (see "Accounts, roles..." below) — not read again
  prompts.json                  customized AI prompt templates + block params (0600)
  prompts_history.json          rolling prompt revisions, 5 per template (0600)
  download_state.json           OneLap incremental sync state
  .sync_state.json              sync progress (readable across gunicorn workers)
  .strava_upload_state.json     Strava upload progress
users.db                        global SQLite: users, login_attempts, api_tokens,
                                user_config (encrypted secrets), user_files (fit index)
config.template.json            committed template (root) — seeds a brand-new user's
                                first `GET /api/config/raw`, never written to disk per-user
.runtime_locks/                 process-wide slot locks (parse / ai / sync)
```

### Parse pipeline

`_parse_and_build(fit_path, filename)` is the single entry point. Lookup chain:

1. **Memory LRU** `_parse_cache` — `OrderedDict`, 256 MB cap, evicts oldest
2. **Disk cache** `input/<user>/.cache/*.json` — survives restarts
3. **Parse** via `_run_parse_worker` (subprocess in server mode) → `_parse_and_build_direct`

Cache key is the **file signature** `mtime_ns:ctime_ns:size`, not just mtime. A separate `_records_cache` (128 MB) holds the per-second record stream for `/api/records`.

`_parse_and_build_direct` produces: `coords`, `is_gcj02`, `summary`, `km_stats`, `dist_stats` (100 m), `time_stats` (60 s), `time_stats_start` (local), `start_time_utc`, `peak_power` (5/60/300/1200/3600 s), `zone_time_s` (Coggan 7 zones). Add new parse-derived fields here when more than one route needs them.

Concurrency is capped by flock-based slots in `.runtime_locks/`: `FAFA_PARSE_SLOTS` (4), `FAFA_AI_SLOTS` (8), `FAFA_SYNC_SLOTS` (2). AI additionally has a per-user in-memory cap `FAFA_AI_USER_SLOTS` (3) layered on top of the process-wide AI slots, so one user cannot starve the others. Exhaustion returns 429/`ValueError`, never a queue.

### Backend routes (`app.py`)

| Route | Purpose |
|---|---|
| `/login`, `/logout` | session auth; rate-limited per user **and** per IP. `POST /login` is AJAX: JSON body → **200** `{ok}` on success / **403** bad creds / **429** rate-limited; form body (no-JS fallback) → 302 redirect. Already-authenticated `GET /login` → **302**. |
| `/api/upload` | parse an uploaded FIT and persist it into the user's `input/` library (same dedupe/quota checks as `/api/v1/files`); failed parse deletes the saved file |
| `/api/load` | parse one library file; returns `source="library"` |
| `/api/files`, `/api/files/delete`, `/api/files/delete_all`, `/api/files/export` | library management; export streams a ZIP |
| `/api/records/<filename>` | per-second stream for detail charts; local time from `fit.utc_offset_s`; includes cumulative `dist_m` for the segment-compare distance alignment |
| `/api/fix_coords` | in-place GCJ-02 conversion; restores mtime and evicts caches |
| `/api/export/all` | streaming JSON export of every activity (`no_km_stats`, `min_km`) |
| `/api/activities` | lightweight summaries; drives activities / PMC / calendar |
| `/api/parse/status` | parse progress for the activities-view loading bar |
| `/api/weather/<filename>` | wind analysis from Open-Meteo (see below) |
| `/api/ai/config`, `/api/ai/evaluate`, `/api/ai/chat`, `/api/ai/pmc`, `/api/ai/calendar`, `/api/ai/compare` | SSE streams via `_llm_stream()` |
| `/api/config/raw` GET/POST | settings view; secrets masked on read, Strava tokens read-only on write |
| `/api/prompts` GET/POST, `/api/prompts/reset`, `/api/prompts/history`, `/api/prompts/preview` | user-editable AI prompt templates (see below) |
| `/api/tokens` GET/POST, `/api/tokens/<id>/revoke` POST | personal API 授权码 CRUD (session-only); plaintext returned **once** on create, only sha256 stored. POST body `read_write: true` issues a `read_write`-scope token instead of the default `read`. |
| `/api/account/password`, `/api/account/profile` POST | self-service password change (verifies current password via `_auth.verify_user` first) and display-name update; session-only |
| `/api/account/avatar` POST, `/api/account/avatar/<user_id>` GET | avatar upload (5 MB compressed / 16 MP decoded limits, Pillow `verify()` + re-encode to PNG ≤512px, strips all metadata/EXIF) and fetch (any logged-in user may view any user's avatar — not sensitive, needed for the admin table; content-hash `ETag`) |
| `/api/admin/users` GET, `/api/admin/users/<uid>/{reset_password,freeze,unfreeze,promote,demote}` POST, `/api/admin/users/<uid>` DELETE | admin-only (`@_auth.admin_required`, session-only — **never** reachable via Bearer token even with `read_write` scope, see below); every self-targeting destructive action (freeze/demote/delete/reset-own-password) is rejected with 400 |
| `/api/v1/activities`, `/api/v1/activities/<filename>`, `/api/v1/records/<filename>` | read-only; authenticates via session **or** `Authorization: Bearer <token>` (Bearer accepted only under `/api/v1/`) |
| `/api/v1/files` POST, `/api/v1/files/<filename>` DELETE, `/api/v1/sync` POST | write endpoints — `_require_api_write()` rejects a Bearer token whose scope isn't `read_write` (session auth is never scope-limited: `g.api_scopes` is only ever set on the Bearer branch of `_load_user`). Upload persists straight into the library (16 MB global request cap, `_USER_STORAGE_MAX_BYTES` quota, exclusive-create so concurrent same-name uploads cannot overwrite); delete reuses `_delete_library_file`; sync reuses `_sync_start_handler` (`platform`: `onelap` \| `igpsport`). |
| `/api/v1/sync/status` GET | read-only sync-state lookup, mirrors `/api/sync/status` |
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
| `auth.py` | `users.db`, password hashing, `login_required`, `admin_required`, exponential login lockout, `last_login_at`. Personal API 授权码 (`api_tokens` table, sha256-hashed, `hmac.compare_digest`): `create/verify/list/revoke_api_token`. Each token carries a `scopes` column (`read` default \| `read_write`, set via `create_api_token(..., scope=)`); existing tokens keep `read` after upgrades — scope is never retroactively widened. `login_required` authorizes a valid `g.user_id` set from **either** session or Bearer token; write routes additionally call `_require_api_write()` in app.py. Also owns: roles/status (`is_admin`, `is_frozen`, `set_admin`/`set_frozen`/`admin_count`), avatar BLOB storage (`get_avatar`/`set_avatar`), and the `user_config`/`user_files` tables — see "Accounts, roles and per-user config storage" below. |
| `onelap.py` | OneLap: request signing, API/browser login, list, download, Magene renaming. |
| `igpsport.py` | iGPSport: token login, paged activity list, FIT download. SSRF-guarded redirect handler, 32 MB cap. |
| `strava.py` | OAuth, token refresh, activity diff, upload polling. Its public functions take `user_id: int`, not a config file path — they read/write credentials through `fafa.auth.get_user_config`/`set_user_config_values` directly (no `config_file` parameter anywhere in this module). Refresh rotation is serialized per user with a flock under `.runtime_locks/`; SQLite's write lock alone is too narrow because Strava rotates refresh tokens during the network request. |
| `tiles.py` | Folium presets — legacy/CLI only, unused by the Leaflet frontend. |
| `reporter.py` | CLI text/JSON/CSV formatting. |

### Accounts, roles and per-user config storage

`users` table columns beyond the original `id/username/password_hash/created_at/last_login_at`: `is_admin`, `is_frozen`, `display_name`, `avatar_blob`/`avatar_mime`/`avatar_updated_at`. Two new tables, both in `users.db` (not a second database file, and not split per-user — a deliberate choice to keep one file to back up/inspect):

- **`user_config(user_id, key, value, is_secret, updated_at)`** — replaced the old per-user `config.json`. Key-value rather than fixed columns because settings keys have kept growing (`wind_source`, `map_tile` were added well after the table would have shipped) — a fixed schema would need an `ALTER TABLE` every time. `fafa.auth.get_user_config(user_id)`/`set_user_config_values(user_id, updates)` are the only read/write path; `app.py`'s `/api/config/raw` GET/POST keep the **exact same external JSON shape** as the old file-based version, so the frontend (`loadSettingsView`/`saveSettings` in `static/app.js`) needed zero changes — only the storage backend moved. Type casting (which keys round-trip as `int`/`float` vs stay `str`) is centralized in `fafa/config_schema.py`, imported by both `auth.py` (storage) and `app.py` (validation) so the two layers can't drift apart on what a given key means.
- **`user_files(user_id, filename, size_bytes, mtime_ns, indexed_at)`** — a fit-file index. **The filesystem directory listing is still the source of truth for existence** — this table is a read-time-reconciled cache, not authoritative. `/api/files` (`list_files`) scans disk as before and, after building the response, upserts a matching batch of rows (`bulk_reindex_user_files`) — this is the primary way the index stays correct, self-healing on every visit regardless of what wrote the file. The three real file-creation points (`/api/v1/files` POST, OneLap download, iGPSport download) and the single deletion chokepoint (`_delete_library_file`, which all three delete routes funnel through) additionally do a best-effort single-row upsert/delete right after the disk operation, wrapped in `try/except` — a failed index write must never block or fail the real file operation. The payoff: `admin_storage_summary()` answers "how much does each user store" with one `GROUP BY` query instead of walking every user's directory tree, which is what makes the admin dashboard's storage column cheap.

**Secret fields are encrypted at rest**, not just file-permission-protected like the old `config.json` was. `config_schema.SECRET_KEYS` (`api_key`, `onelap_password`, `igpsport_password`, `strava_client_secret`, `strava_access_token`, `strava_refresh_token`) get Fernet-encrypted before the `INSERT`; `app.py`'s `_SECRET_FIELDS` constant is now just an alias for the same frozenset (`_SECRET_FIELDS = _config_schema.SECRET_KEYS`) so the two layers can't independently drift on which fields count as secret. **The Fernet key is derived from `FAFA_SECRET` via HKDF-SHA256**, not a second standalone secret — server mode already requires `FAFA_SECRET` (refuses to start without it), so this piggybacks on an already-mandatory value rather than adding a second one to provision and back up. **Consequence: rotating `FAFA_SECRET` makes every previously-encrypted secret field undecryptable.** `_decrypt()` catches `InvalidToken` and returns `''` per-field rather than raising — a rotated secret degrades to "that field reads as empty, user re-enters it," not a 500 on every settings load. Local mode has no `FAFA_SECRET` requirement; it derives from a fixed constant (`_LOCAL_MODE_KEY_MATERIAL`) instead — local mode is single-user, same-machine, same-permissions as `users.db` itself, so this layer isn't defending against a local attacker, it just keeps the same code path working in both modes without an `if server_mode` branch.

**Migration from the old `config.json` supports both lazy and explicit paths.** `_activate_user()` (session/Bearer paths) and the local-mode branch of `_load_user()` call `_maybe_migrate_config(user_id, input_dir)` on every request: if `user_config` has zero rows for that user and a `config.json` still exists, it imports every key (encrypting secrets) and archives the source as the first unused `config.json.bak[.N]`; backups are created without overwriting an existing one. A user who never logs in keeps the old file until an operator runs `scripts/migrate_config_to_db.py`. The script requires the production `FAFA_SECRET`, scans all users by default, supports `--dry-run`, repeatable `--username`, and an explicit `--config` path, and refuses to overwrite users who already have database config. `manage_users.py migrate-config <username>` remains the lightweight single-user command.

**`admin_required` (in `auth.py`, paired with `login_required` on every `/api/admin/*` route) rejects Bearer-token auth outright**, even a `read_write`-scoped token belonging to an actual admin: `getattr(g, 'api_scopes', None) is not None` → 403, checked before the `is_admin` check. An API token represents "act on my own account's data"; it is not a delegation of admin authority over the whole instance, and conflating the two would be a privilege-escalation path. In practice this is doubly enforced — `/api/admin/*` isn't under `/api/v1/`, and `_load_user`'s Bearer branch only ever activates for paths starting `/api/v1/`, so a Bearer-authenticated request to `/api/admin/*` never even reaches `admin_required`; it 401s at `login_required` first because `g.user_id` was never set. Admin actions are session-only, full stop.

Self-targeting destructive admin actions are rejected unconditionally, not by a dynamic "unless you're the last admin" check: freeze/demote/delete/reset-own-password-via-the-admin-route on `uid == g.user_id` all 400 immediately. The simpler rule is harder to get wrong. **The first admin on a fresh instance must be set via CLI** (`manage_users.py promote <username>`) — the web UI's promote/demote requires an existing admin session to call it, so there is no self-service bootstrap path, by design (anyone able to reach the API before any admin exists would otherwise be able to grant themselves admin).

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

Other hard-coded defenses to preserve: `_validate_filename_in_input` (rejects symlinks, requires parent == resolved input dir), `_resolve_public_api_base` (SSRF: HTTPS-only, blocks RFC1918/loopback/link-local for v4 and v6), `_check_same_origin` before-request hook (exempts `/api/v1/*` requests that carry an `Authorization: Bearer` header — Bearer credentials aren't ambient like cookies, so CSRF doesn't apply; every other path, including session-cookie `/api/*` calls, still enforces same-origin), CSP/HSTS in `_security_headers`, `_atomic_write_json` for every JSON write, and the 16 MB `MAX_CONTENT_LENGTH`.

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

**Editor UI.** 设置 view → AI 配置 → 编辑提示词模板… opens `#prompts-modal` (`openPromptsModal`), which sits at z-index **2300** (above the settings view at 500). Five tabs, a variable palette that inserts at the cursor, per-template block params, a preview pane, and a history dropdown.

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

### Sharing — 3D preview + posters

Single-ride detail → **分享** (`openDetailShare`) opens `#poster-modal` as a two-tab share surface: **3D 预览** and **海报**. Activity multi-select → **汇总海报** (`_actBulkPoster`) opens the same modal on the 海报 tab (summary rides have no 3D preview). Tab switching (`_shareSwitchTab`) mounts/unmounts the 3D scene and toggles the download button.

**3D 预览** — an interactive Three.js route (`static/route-scene.js`, `RouteScene`) bridged through `static/route3d.js` (`window.Route3D`). It projects `/api/records` lat/lon/altitude/grade into a slope-colored tube with an elevation curtain, and offers spin on/off + speed (`旋转` + slider), six background palettes (夜/纸/冰/日/极/岩), a ground compass (`指北`, N red, aligned to geographic north via the `-z=north / +x=east` projection), and EXIF photo pins (`exifr`, GPS → capture-time → even-distribution matching). `RouteScene` is a FAFA-original three.js implementation; `three` and `exifr` are vendored under `static/vendor/` (both MIT). Imports use absolute `/static/vendor/...` specifiers (no importmap) so the strict CSP `script-src 'self'` allows them.

**海报** — entirely client-side: loads library coordinates through `/api/load`, renders CARTO tiles and routes to `#poster-canvas`, downloads a PNG without uploading or persisting.

- Formats: 3:4 at 1440×1920 and 9:16 at 1080×1920; dark and light poster themes are independent of the application theme.
- Single posters show one route and its metrics. Summary posters accept 1–50 selected rides, load in batches of four, draw each route in a palette color, and aggregate distance, total duration, moving-speed average, elevation, power, heart rate and cadence.
- Privacy is enabled by default. `_posterVisibleSegments()` removes every contiguous run within 800 m of either endpoint, so the canvas must draw a list of segments rather than reconnecting hidden points.
- `_posterDownsampleSegments()` runs after privacy splitting and preserves each segment's endpoints. Single posters cap at 20 000 points; summaries divide an approximately 100 000-point budget across rides (minimum 1 500 each) to prevent large selections from freezing Canvas rendering.
- `_posterState.renderToken` invalidates closed or superseded async tile renders. The map canvas is cached separately from text / metric overlays so title and field edits do not reload tiles.
- Poster maps must use `EXPORT_TILE_URLS` CARTO layers. Amap tiles are not canvas-safe; if CARTO is unavailable the route is drawn over a plain fallback background.

### Grade distribution & detail layout

- **坡度分布 / 连续爬坡段** (`fafa/climbs.py`, `analyze_grade`): per-record grade (recorded FIT grade, else altitude/distance差分), ±4-point smoothed, distance-weighted into climbfinder-style bands — 下坡(<0) / 0–4 / 4–7 / 7–10 / 10–13 / 13–16 / >16 %. Rendered as a vertical bar block beside 功率/心率分布 (`_renderDetailDistributions`); continuous climbs (≥200 m, avg ≥2.5%) show as cards (`_renderDetailClimbs`). Result is cached in the parse output — bump `_PARSE_SCHEMA` in `app.py` whenever the climbs shape changes, to invalidate old caches.
- `/api/records` also returns raw WGS-84 `lat`/`lon` (for the 3D route). Map display still uses the GCJ-02-corrected `coords` chain — do not confuse the two.
- Detail map has a **浮窗** mode: drag by its title bar, resize from any edge/corner via `.map-float-rz` handles (z-index 1100+, above Leaflet panes), and it clamps back into view on window resize. Lets charts render full-width.
- The per-km data table (`#detail-table-section`) is **collapsed by default**; its handle toggles expand/collapse.
- `_loadDefaultTile()` selects the light/dark CARTO tile by current theme on first load (previously only `toggleTheme` coupled tile ↔ theme, so a saved light theme still loaded dark tiles).

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

`static/app.js` (~7200 lines, no bundler) is organized as ordered section blocks — keep related code inside its block:

ECharts injection → tile configs → detail constants → export constants → GCJ-02 helpers → state → sidebar nav → activities view → **ride comparison** → **ride posters** → map init → track coords → add/remove tracks → coord transform → stats helpers → track list UI → panel focus / flash → upload / drag-drop → toast → panel toggle & resize → zoom slider → PNG export → detail view (meta, tags, notes) → detail route heatmap → boot → file library → JSON export → OneLap/iGPSport sync → Strava upload → AI evaluation → PMC → settings view + 授权码 → **prompt editor** → theme toggle → analytics controller → power distribution → power curve → shared AI modal → per-activity AI → calendar AI → calendar.

Seven sidebar views (`switchSidebarView`): `activities` (default) · `map` · `pmc` · `calendar` · `files` · `settings` · `about`. Settings is a full sidebar view (`#settings-view`, `loadSettingsView`) — a function-grouped card grid, not a modal — replacing the old bottom-left `#settings-modal`. PMC and calendar share `#analytics-view` and are switched by `switchAnalyticsTab`.

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
| 500 | `#map-view`, `#activities-view`, `#files-view`, `#settings-view`, `#about-view` |
| 800 | `#sidebar` |
| 900 | `#track-panel`, `#zoom-slider-wrap`, `#map-fit-btn` |
| 950 | `#detail-view`, `#analytics-view` |
| 960 | `#ai-view` |
| 1000 | `#detail-route-map-controls`, `#detail-route-legend` |
| 1100 | `#tag-picker`, `#bulk-tag-picker`, `#detail-route-tooltip`, `.map-float-rz` resize handles (edges 1100 / corners 1101, above Leaflet panes) |
| 1500 | `#cal-act-modal` |
| 1900 | `#drop-overlay` |
| 2000 | `.toast` |
| 2100 | `#export-modal`, `#sync-modal`, `#strava-modal`, `#token-reveal-modal` |
| 2200 | `#act-ai-modal`, `#compare-modal`, `#poster-modal` (not opened together through normal UI flows) |
| 2300 | `#prompts-modal` (opens from the `#settings-view` AI card) |

## Configuration

Per-user config lives in `users.db` (`user_config` table, secrets encrypted — see "Accounts, roles and per-user config storage" above), not a per-user file anymore; `config.template.json` still documents every field in its `_comments` block and seeds the response for a user with no config yet. Writes go through `/api/config/raw`, which rejects unknown keys and validates:

- **Strings** (with length caps): `api_base` (HTTPS + SSRF check), `api_key`, `model`, `onelap_username/password`, `igpsport_username/password`, `strava_client_id/secret`
- **Numbers** (with ranges): `max_tokens` 256–16000, `pmc_ftp` 50–600, `pmc_rest_hr` 30–100, `pmc_max_hr` 100–220, `pmc_weight` 30–150, `route_grade_min` −30–0, `route_grade_max` 0–30, `route_speed_max` 10–120, `route_cadence_max` 60–200, `strava_redirect_port` 1024–65535
- **Enums**: `wind_source` ∈ {auto, ecmwf, gfs, icon, era5}; `map_tile` ∈ {dark, dark-nolabels, light, light-nolabels, amap}

Secret fields are returned masked as `••••••••`; posting the mask back leaves the stored value untouched. Strava tokens are read-only through this endpoint.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `FAFA_SERVER` | `0` | `1` enables server mode |
| `FAFA_SECRET` | — | Flask secret key; **required** in server mode. Also the source material for the `user_config` secret-field encryption key (HKDF-derived) — rotating it makes previously-encrypted config fields undecryptable (they read back as empty, not an error; see "Accounts, roles..." above) |
| `FAFA_HOST` | `127.0.0.1` / `0.0.0.0` | bind address |
| `FAFA_PORT` | `5173` | listen port |
| `FAFA_PROXY_HOPS` | `0` | `ProxyFix` hop count behind a reverse proxy |
| `FAFA_ALLOW_INSECURE_REMOTE` | `0` | allow non-loopback bind in local mode |
| `FAFA_USER_STORAGE_MB` | `10240` | per-user FIT storage cap (floor 32 MB) |
| `FAFA_PARSE_SLOTS` | `4` | concurrent FIT parse workers |
| `FAFA_AI_SLOTS` | `8` | concurrent AI streams (process-wide) |
| `FAFA_AI_USER_SLOTS` | `3` | concurrent AI streams **per user** |
| `FAFA_SYNC_SLOTS` | `2` | concurrent sync / Strava upload jobs |
| `FLASK_DEBUG` | `0` | debug mode + verbose logging |

### Deployment

`Dockerfile` is `python:3.14-slim` plus Chromium (DrissionPage needs it for OneLap browser login) and Noto CJK fonts; it declares `VOLUME /app/input` and defaults to a no-op `CMD`, so `docker-compose.yml` supplies the real command. Mount `input/` and `users.db` as volumes and set `FAFA_SECRET` before starting.
