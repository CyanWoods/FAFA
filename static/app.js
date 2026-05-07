/* ── Tile configs ────────────────────────────────────────────────────────── */
const _CARTO_OPTS = {
  subdomains: 'abcd', maxZoom: 19, attribution: '&copy; CARTO',
  crossOrigin: 'anonymous',
  tileSize: 512, zoomOffset: -1,
  keepBuffer: 4, updateWhenZooming: false,
};
const TILES = {
  amap: {
    url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    opts: { subdomains: '1234', maxZoom: 19, attribution: '&copy; 高德地图', keepBuffer: 4, updateWhenZooming: false },
  },
  'dark-nolabels': {
    url: 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png',
    opts: _CARTO_OPTS,
  },
  'light-nolabels': {
    url: 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}@2x.png',
    opts: _CARTO_OPTS,
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
    opts: _CARTO_OPTS,
  },
  light: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
    opts: _CARTO_OPTS,
  },
};

const PALETTE = [
  '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
  '#1abc9c', '#e67e22', '#e91e63', '#00bcd4', '#ff5722',
  '#8bc34a', '#673ab7', '#607d8b', '#ff9800', '#009688',
];

/* ── Detail view constants ───────────────────────────────────────────────── */
const METRICS = [
  { key: 'speed',    label: '速度', field: 'avg_speed_kmh',  unit: 'km/h', color: '#2e86de' },
  { key: 'hr',       label: '心率', field: 'avg_hr',         unit: 'bpm',  color: '#e74c3c' },
  { key: 'power',    label: '功率', field: 'avg_power',      unit: 'W',    color: '#f39c12' },
  { key: 'cadence',  label: '踏频', field: 'avg_cadence',    unit: 'rpm',  color: '#9b59b6' },
  { key: 'altitude', label: '海拔', field: 'end_alt_m',      unit: 'm',    color: '#2ecc71' },
  { key: 'grade',    label: '坡度', field: 'avg_grade_pct',  unit: '%',    color: '#1abc9c' },
];

const TABLE_COLS = [
  { key: 'duration_s',       label: '用时',     fmt: v => _fmtDur(v) },
  { key: 'avg_speed_kmh',    label: '均速',     fmt: v => v.toFixed(1) + ' km/h' },
  { key: 'max_speed_kmh',    label: '最高速',   fmt: v => v.toFixed(1) + ' km/h' },
  { key: 'avg_hr',           label: '均心率',   fmt: v => Math.round(v) + ' bpm' },
  { key: 'max_hr',           label: '最高心率', fmt: v => v + ' bpm' },
  { key: 'avg_power',        label: '均功率',   fmt: v => Math.round(v) + ' W' },
  { key: 'normalized_power', label: 'NP',       fmt: v => Math.round(v) + ' W' },
  { key: 'avg_cadence',      label: '均踏频',   fmt: v => Math.round(v) + ' rpm' },
  { key: 'avg_grade_pct',    label: '坡度',     fmt: v => v.toFixed(1) + '%' },
  { key: 'elevation_gain_m', label: '爬升',     fmt: v => Math.round(v) + ' m' },
  { key: 'end_alt_m',        label: '海拔',     fmt: v => Math.round(v) + ' m' },
  { key: 'avg_temp_c',       label: '气温',     fmt: v => v.toFixed(1) + ' °C' },
];

/* ── Export constants ────────────────────────────────────────────────────── */
const EXPORT_TILE_URLS = {
  dark:             'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  'dark-nolabels':  'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
  light:            'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
  'light-nolabels': 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png',
};

const EXPORT_RESOLUTIONS = {
  '4K':    { '16:9': [3840, 2160], '4:3': [2880, 2160] },
  '2K':    { '16:9': [2560, 1440], '4:3': [1920, 1440] },
  '1080P': { '16:9': [1920, 1080], '4:3': [1440, 1080] },
};

/* ── GCJ-02 conversions ──────────────────────────────────────────────────── */
const GCJ_A  = 6378245.0;
const GCJ_EE = 0.00669342162296594323;

function _outOfChina(lat, lon) {
  return !(lon >= 72.004 && lon <= 137.8347 && lat >= 0.8293 && lat <= 55.8271);
}
function _tLat(x, y) {
  let r = -100 + 2*x + 3*y + 0.2*y*y + 0.1*x*y + 0.2*Math.sqrt(Math.abs(x));
  r += (20*Math.sin(6*x*Math.PI) + 20*Math.sin(2*x*Math.PI)) * 2/3;
  r += (20*Math.sin(y*Math.PI)   + 40*Math.sin(y/3*Math.PI)) * 2/3;
  r += (160*Math.sin(y/12*Math.PI) + 320*Math.sin(y*Math.PI/30)) * 2/3;
  return r;
}
function _tLon(x, y) {
  let r = 300 + x + 2*y + 0.1*x*x + 0.1*x*y + 0.1*Math.sqrt(Math.abs(x));
  r += (20*Math.sin(6*x*Math.PI) + 20*Math.sin(2*x*Math.PI)) * 2/3;
  r += (20*Math.sin(x*Math.PI)   + 40*Math.sin(x/3*Math.PI)) * 2/3;
  r += (150*Math.sin(x/12*Math.PI) + 300*Math.sin(x/30*Math.PI)) * 2/3;
  return r;
}

/** WGS-84 → GCJ-02（火星加密） */
function wgs84ToGcj02(lat, lon) {
  if (_outOfChina(lat, lon)) return [lat, lon];
  let dLat = _tLat(lon - 105, lat - 35);
  let dLon = _tLon(lon - 105, lat - 35);
  const rad = lat / 180 * Math.PI;
  let magic = Math.sin(rad);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtM = Math.sqrt(magic);
  dLat = dLat * 180 / ((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtM) * Math.PI);
  dLon = dLon * 180 / (GCJ_A / sqrtM * Math.cos(rad) * Math.PI);
  return [lat + dLat, lon + dLon];
}

/** GCJ-02 → WGS-84（火星解密） */
function gcj02ToWgs84(lat, lon) {
  if (_outOfChina(lat, lon)) return [lat, lon];
  let dLat = _tLat(lon - 105, lat - 35);
  let dLon = _tLon(lon - 105, lat - 35);
  const rad = lat / 180 * Math.PI;
  let magic = Math.sin(rad);
  magic = 1 - GCJ_EE * magic * magic;
  const sqrtM = Math.sqrt(magic);
  dLat = dLat * 180 / ((GCJ_A * (1 - GCJ_EE)) / (magic * sqrtM) * Math.PI);
  dLon = dLon * 180 / (GCJ_A / sqrtM * Math.cos(rad) * Math.PI);
  return [lat - dLat, lon - dLon];
}

function encryptCoords(raw) { return raw.map(([a, b]) => wgs84ToGcj02(a, b)); }
function decryptCoords(raw) { return raw.map(([a, b]) => gcj02ToWgs84(a, b)); }

/* ── State ───────────────────────────────────────────────────────────────── */
let map, tileLayer;
const tracks = new Map();
let trackCounter = 0;
const exportState = { tile: 'dark', colorMode: 'heatmap', uniformColor: '#e74c3c', ratio: '16:9', resolution: '2K' };
let panelExpanded = true;
let panelExpandedHeight = 320;
let detailTrackId = null;
let detailMode = 'time';
let detailMetric = 'speed';
let detailChart = null;
let detailRouteMap = null;
let detailRouteLayers = [];
let aiTrackId = null;
let _aiModel = '';

/* ── Map init ────────────────────────────────────────────────────────────── */
function initMap() {
  map = L.map('map', { center: [30, 116], zoom: 8, zoomControl: false });
  setTiles('dark');
}

function setTiles(name) {
  if (tileLayer) map.removeLayer(tileLayer);
  const t = TILES[name];
  tileLayer = L.tileLayer(t.url, t.opts).addTo(map);
}

/* ── Track coords ────────────────────────────────────────────────────────── */
function getCoords(track) {
  if (track.mode === 'decrypt') return track.decrypted;
  if (track.mode === 'encrypt') return track.encrypted;
  return track.raw;
}

function renderTrack(track) {
  track.polyline.setLatLngs(getCoords(track));
}

/* ── Add / remove tracks ─────────────────────────────────────────────────── */
function addTrack(data) {
  const id = ++trackCounter;
  const color     = PALETTE[(id - 1) % PALETTE.length];
  const raw       = data.coords;
  const decrypted = decryptCoords(raw);
  const encrypted = encryptCoords(raw);
  const polyline  = L.polyline(raw, { color, weight: 3, opacity: 0.82 }).addTo(map);
  const track = { id, name: data.filename, raw, decrypted, encrypted, polyline, color, mode: 'raw',
                  source: data.source || 'upload',
                  summary: data.summary || null, kmStats: data.km_stats || [],
                  distStats: data.dist_stats || [], timeStats: data.time_stats || [],
                  timeStatsStart: data.time_stats_start || null };
  tracks.set(id, track);

  renderTrack(track);

  const allBounds = L.latLngBounds([]);
  for (const t of tracks.values()) allBounds.extend(t.polyline.getBounds());
  map.fitBounds(allBounds, { padding: [32, 32], maxZoom: 16 });

  addTrackRow(track);
  syncBadge();
  syncEmptyHint();
}

function removeTrack(id) {
  const t = tracks.get(id);
  if (!t) return;
  map.removeLayer(t.polyline);
  tracks.delete(id);
  document.getElementById(`ti-${id}`)?.remove();
  syncBadge();
  syncEmptyHint();
}

function clearAllTracks() {
  for (const id of [...tracks.keys()]) removeTrack(id);
}

/* ── Coord transform (writes back to file for library tracks) ────────────── */
async function applyCoordTransform(id, method) {
  const t = tracks.get(id);
  if (!t) return;

  const newCoords = method === 'decrypt' ? decryptCoords(t.raw) : encryptCoords(t.raw);
  t.polyline.setLatLngs(newCoords);

  if (t.source !== 'library') {
    // Uploaded tracks: don't mutate t.raw so repeated clicks are idempotent,
    // but update t.mode so getCoords() (used by export / route view) stays in sync.
    t.mode = method;
    return;
  }

  try {
    const res  = await fetch('/api/fix_coords', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ filename: t.name, method }),
    });
    const data = await res.json();
    if (!res.ok) {
      t.polyline.setLatLngs(t.raw);
      toast(`写回失败：${data.error}`);
      return;
    }
    // File on disk is now newCoords; update raw and disable button to prevent re-application
    t.raw = newCoords;
    const row = document.getElementById(`ti-${id}`);
    if (row) {
      const btn = row.querySelector(`[data-method="${method}"]`);
      if (btn) btn.disabled = true;
    }
    toast(method === 'decrypt' ? '火星解密完成，已写入文件' : '火星加密完成，已写入文件');
  } catch {
    t.polyline.setLatLngs(t.raw);
    toast('写回失败：网络错误');
  }
}

/* ── Stats helpers ───────────────────────────────────────────────────────── */
function _fmtDur(s) {
  if (s == null) return null;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

function _statChips(summary) {
  if (!summary) return [];
  const chips = [];
  if (summary.total_dist_km != null)
    chips.push(summary.total_dist_km.toFixed(1) + ' km');
  const dur = _fmtDur(summary.total_duration_s);
  if (dur) chips.push(dur);
  if (summary.avg_speed_kmh != null)
    chips.push(summary.avg_speed_kmh.toFixed(1) + ' km/h');
  if (summary.total_elevation_gain_m > 0)
    chips.push('↑' + Math.round(summary.total_elevation_gain_m) + ' m');
  if (summary.avg_hr != null)
    chips.push('♥ ' + Math.round(summary.avg_hr));
  if (summary.avg_power != null)
    chips.push('⚡ ' + Math.round(summary.avg_power) + ' W');
  return chips;
}

function _downloadText(filename, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function _toCSV(kmStats) {
  if (!kmStats || !kmStats.length) return '';
  const keys = Object.keys(kmStats[0]);
  const rows = kmStats.map(s => keys.map(k => s[k] ?? '').join(','));
  return [keys.join(','), ...rows].join('\n');
}

function exportTrackData(id, fmt) {
  const t = tracks.get(id);
  if (!t) return;
  const base = t.name.replace(/\.fit$/i, '');
  if (fmt === 'json') {
    _downloadText(base + '.json', JSON.stringify({ summary: t.summary, km_stats: t.kmStats }, null, 2));
  } else {
    _downloadText(base + '.csv', _toCSV(t.kmStats));
  }
}

/* ── Track list UI ───────────────────────────────────────────────────────── */
function _trackDateLabel(track) {
  if (track.timeStatsStart) return track.timeStatsStart.slice(0, 16).replace('T', ' ');
  const m = track.name.match(/Magene_[A-Z]\d+_(?:\d+_)?(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
  return track.name.replace(/\.fit$/i, '');
}

function addTrackRow(track) {
  const row = document.createElement('div');
  row.className = 'track-item';
  row.id = `ti-${track.id}`;

  row.addEventListener('mouseenter', () => startFlash(track.id));
  row.addEventListener('mouseleave', () => stopFlash(track.id));

  // Main row: dot · name · coord buttons · remove
  const main = document.createElement('div');
  main.className = 'track-row-main';

  const dot = document.createElement('span');
  dot.className = 'track-dot';
  dot.style.background = track.color;
  dot.style.cursor = 'pointer';
  dot.title = '定位路径';
  dot.onclick = () => map.fitBounds(track.polyline.getBounds(), { padding: [32, 32] });

  const name = document.createElement('span');
  name.className = 'track-name';
  name.textContent = _trackDateLabel(track);
  name.title = '查看详情';
  name.onclick = () => openDetailView(track.id);

  const group = document.createElement('div');
  group.className = 'coord-group';
  [
    { method: 'decrypt', label: '火星解密' },
    { method: 'encrypt', label: '火星加密' },
  ].forEach(({ method, label }) => {
    const btn = document.createElement('button');
    btn.className = 'coord-btn';
    btn.dataset.method = method;
    btn.textContent = label;
    btn.onclick = () => applyCoordTransform(track.id, method);
    group.appendChild(btn);
  });

  const rmBtn = document.createElement('button');
  rmBtn.className = 'track-remove';
  rmBtn.textContent = '×';
  rmBtn.title = '移除';
  rmBtn.onclick = () => removeTrack(track.id);

  main.append(dot, name, group, rmBtn);
  row.appendChild(main);

  // Filename subtitle
  const fnEl = document.createElement('div');
  fnEl.className = 'track-filename';
  fnEl.textContent = track.name;
  fnEl.title = track.name;
  row.appendChild(fnEl);

  // Stats row: key metrics as chips
  const chips = _statChips(track.summary);
  if (chips.length) {
    const statsEl = document.createElement('div');
    statsEl.className = 'track-stats';
    for (const chip of chips) {
      const el = document.createElement('span');
      el.className = 'stat-chip';
      el.textContent = chip;
      statsEl.appendChild(el);
    }
    row.appendChild(statsEl);
  }

  // Export row: JSON / CSV buttons
  if (track.summary || track.kmStats.length) {
    const expRow = document.createElement('div');
    expRow.className = 'track-export';
    const lbl = document.createElement('span');
    lbl.className = 'export-label';
    lbl.textContent = '导出数据';
    expRow.appendChild(lbl);
    ['json', 'csv'].forEach(fmt => {
      const btn = document.createElement('button');
      btn.className = 'export-fmt-btn';
      btn.textContent = fmt.toUpperCase();
      btn.onclick = () => exportTrackData(track.id, fmt);
      expRow.appendChild(btn);
    });
    row.appendChild(expRow);
  }

  document.getElementById('track-list').appendChild(row);
  _sortTrackList();
}

function _trackSortKey(track) {
  if (track.timeStatsStart) return track.timeStatsStart;
  const m = track.name.match(/Magene_[A-Z]\d+_(?:\d+_)?(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})?/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}`;
  return track.name;
}

function _sortTrackList() {
  const list = document.getElementById('track-list');
  const items = [...list.children];
  items.sort((a, b) => {
    const ta = tracks.get(+a.id.slice(3));
    const tb = tracks.get(+b.id.slice(3));
    if (!ta || !tb) return 0;
    return _trackSortKey(ta).localeCompare(_trackSortKey(tb));
  });
  items.forEach(el => list.appendChild(el));
}

function syncBadge() {
  document.getElementById('track-badge').textContent = tracks.size;
}

function syncEmptyHint() {
  document.getElementById('empty-hint').style.display = tracks.size === 0 ? '' : 'none';
}

/* ── Flash effect ────────────────────────────────────────────────────────── */
const _flashTimers = new Map();

function startFlash(id) {
  stopFlash(id);
  const t = tracks.get(id);
  if (!t) return;
  for (const [tid, track] of tracks) {
    if (tid !== id) track.polyline.setStyle({ opacity: 0 });
  }
  let vis = true;
  _flashTimers.set(id, setInterval(() => {
    vis = !vis;
    t.polyline.setStyle({ opacity: vis ? 0.92 : 0.12 });
  }, 380));
}

function stopFlash(id) {
  if (_flashTimers.has(id)) { clearInterval(_flashTimers.get(id)); _flashTimers.delete(id); }
  for (const track of tracks.values()) {
    track.polyline.setStyle({ opacity: 0.82 });
  }
}

/* ── File upload ─────────────────────────────────────────────────────────── */
async function uploadFile(file) {
  if (!file.name.toLowerCase().endsWith('.fit')) {
    toast(`跳过 ${file.name}：不是 .fit 文件`);
    return;
  }
  const form = new FormData();
  form.append('file', file);
  let res;
  try {
    res = await fetch('/api/upload', { method: 'POST', body: form });
  } catch {
    toast('上传失败：网络错误');
    return;
  }
  const data = await res.json();
  if (!res.ok) { toast(`${file.name}：${data.error}`); return; }
  addTrack(data);
}

/* ── Drag-and-drop ───────────────────────────────────────────────────────── */
function setupDragDrop() {
  const overlay = document.getElementById('drop-overlay');
  let depth = 0;

  document.addEventListener('dragenter', e => { e.preventDefault(); depth++; overlay.classList.add('show'); });
  document.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; overlay.classList.remove('show'); } });
  document.addEventListener('dragover',  e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    depth = 0;
    overlay.classList.remove('show');
    for (const file of e.dataTransfer.files) uploadFile(file);
  });
}

/* ── Toast ───────────────────────────────────────────────────────────────── */
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3200);
}

/* ── Panel toggle ────────────────────────────────────────────────────────── */
function togglePanel() {
  const panel = document.getElementById('track-panel');
  panelExpanded = !panelExpanded;
  document.getElementById('panel-toggle').textContent = panelExpanded ? '▼' : '▲';
  panel.style.maxHeight = panelExpanded ? panelExpandedHeight + 'px' : '44px';
}

/* ── Panel resize drag ───────────────────────────────────────────────────── */
function initPanelResize() {
  const panel  = document.getElementById('track-panel');
  const handle = document.getElementById('panel-resize-handle');
  let dragging = false, startY = 0, startH = 0;

  function startDrag(clientY) {
    dragging = true;
    startY = clientY;
    startH = panel.getBoundingClientRect().height;
    panel.classList.add('panel-drag');
  }

  function doDrag(clientY) {
    if (!dragging) return;
    const newH = Math.max(44, Math.min(window.innerHeight - 100, startH + (startY - clientY)));
    panel.style.maxHeight = newH + 'px';
    panelExpandedHeight = newH;
    const nowExpanded = newH > 44;
    if (nowExpanded !== panelExpanded) {
      panelExpanded = nowExpanded;
      document.getElementById('panel-toggle').textContent = panelExpanded ? '▼' : '▲';
    }
  }

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove('panel-drag');
  }

  handle.addEventListener('mousedown', e => { startDrag(e.clientY); e.preventDefault(); });
  document.addEventListener('mousemove', e => doDrag(e.clientY));
  document.addEventListener('mouseup', endDrag);

  handle.addEventListener('touchstart', e => { startDrag(e.touches[0].clientY); e.preventDefault(); }, { passive: false });
  document.addEventListener('touchmove', e => { doDrag(e.touches[0].clientY); }, { passive: false });
  document.addEventListener('touchend', endDrag);
}

/* ── Zoom slider ─────────────────────────────────────────────────────────── */
function initZoomSlider() {
  const thumb  = document.getElementById('zoom-thumb');
  const track  = document.getElementById('zoom-track');
  const TRACK_H = 180, THUMB_H = 16, RANGE = TRACK_H - THUMB_H;
  const MIN_Z = 1, MAX_Z = 18;

  function zoomToTop(z) {
    return RANGE * (1 - (Math.max(MIN_Z, Math.min(MAX_Z, z)) - MIN_Z) / (MAX_Z - MIN_Z));
  }
  function topToZoom(top) {
    return Math.round(MIN_Z + (1 - top / RANGE) * (MAX_Z - MIN_Z));
  }
  function syncThumb() {
    thumb.style.top = zoomToTop(map.getZoom()) + 'px';
  }

  map.on('zoom', syncThumb);
  syncThumb();

  // Mouse drag
  let dragging = false, startClientY = 0, startTop = 0;

  thumb.addEventListener('mousedown', e => {
    dragging = true;
    startClientY = e.clientY;
    startTop = parseFloat(thumb.style.top) || 0;
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const newTop = Math.max(0, Math.min(RANGE, startTop + e.clientY - startClientY));
    thumb.style.top = newTop + 'px';
    const z = topToZoom(newTop);
    if (z !== map.getZoom()) map.setZoom(z);
  });
  document.addEventListener('mouseup', () => { dragging = false; });

  // Touch drag
  thumb.addEventListener('touchstart', e => {
    dragging = true;
    startClientY = e.touches[0].clientY;
    startTop = parseFloat(thumb.style.top) || 0;
    e.preventDefault();
  }, { passive: false });
  document.addEventListener('touchmove', e => {
    if (!dragging) return;
    const newTop = Math.max(0, Math.min(RANGE, startTop + e.touches[0].clientY - startClientY));
    thumb.style.top = newTop + 'px';
    const z = topToZoom(newTop);
    if (z !== map.getZoom()) map.setZoom(z);
  }, { passive: false });
  document.addEventListener('touchend', () => { dragging = false; });

  // +/- buttons
  document.getElementById('zoom-in-btn').addEventListener('click', () => {
    map.setZoom(Math.min(MAX_Z, map.getZoom() + 1));
  });
  document.getElementById('zoom-out-btn').addEventListener('click', () => {
    map.setZoom(Math.max(MIN_Z, map.getZoom() - 1));
  });

  // Click on track (jump to position)
  track.addEventListener('click', e => {
    if (e.target === thumb) return;
    const rect = track.getBoundingClientRect();
    const newTop = Math.max(0, Math.min(RANGE, e.clientY - rect.top - THUMB_H / 2));
    thumb.style.top = newTop + 'px';
    map.setZoom(topToZoom(newTop));
  });
}

/* ── Export ──────────────────────────────────────────────────────────────── */
function _colorPickerVisible() {
  return exportState.colorMode === 'heatmap' || exportState.colorMode === 'uniform';
}

function openExportModal() {
  if (tracks.size === 0) { toast('请先加载路径'); return; }
  document.getElementById('ex-color-picker-row').style.display = _colorPickerVisible() ? 'flex' : 'none';
  document.getElementById('export-modal').style.display = 'flex';
}

function closeExportModal() {
  document.getElementById('export-modal').style.display = 'none';
}

function _setupOptGroup(groupId, key) {
  document.getElementById(groupId).querySelectorAll('.opt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById(groupId).querySelectorAll('.opt-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      exportState[key] = btn.dataset.val;
      if (key === 'colorMode') {
        document.getElementById('ex-color-picker-row').style.display =
          _colorPickerVisible() ? 'flex' : 'none';
      }
    });
  });
}

// Web Mercator: lat/lon → world pixel at given zoom
function _lngLatToWorld(lat, lon, zoom) {
  const scale = 256 * Math.pow(2, zoom);
  const x = (lon + 180) / 360 * scale;
  const sinLat = Math.sin(lat * Math.PI / 180);
  const y = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale;
  return [x, y];
}

// Find highest zoom where all tracks fit inside 80% of W×H
function _calcZoom(allCoords, W, H) {
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const [lat, lon] of allCoords) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  if (maxLat - minLat < 0.001 && maxLon - minLon < 0.001) {
    return { zoom: 14, minLat, maxLat, minLon, maxLon };
  }
  for (let z = 18; z >= 0; z--) {
    const [x0, y0] = _lngLatToWorld(maxLat, minLon, z);
    const [x1, y1] = _lngLatToWorld(minLat, maxLon, z);
    if (x1 - x0 <= W * 0.80 && y1 - y0 <= H * 0.80) {
      return { zoom: z, minLat, maxLat, minLon, maxLon };
    }
  }
  return { zoom: 0, minLat, maxLat, minLon, maxLon };
}

// Canvas origin (top-left world pixel) so all tracks are centered
function _calcOrigin(minLat, maxLat, minLon, maxLon, zoom, W, H) {
  const [x0, y0] = _lngLatToWorld(maxLat, minLon, zoom);
  const [x1, y1] = _lngLatToWorld(minLat, maxLon, zoom);
  return [(x0 + x1) / 2 - W / 2, (y0 + y1) / 2 - H / 2];
}

async function _loadTileImg(url, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 400 * attempt));
    // Add cache-bust on retry so the browser doesn't serve a cached error response.
    const src = attempt > 0 ? `${url}?_r=${attempt}` : url;
    const img = await new Promise(resolve => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload  = () => resolve(im);
      im.onerror = () => resolve(null);
      im.src = src;
    });
    if (img) return img;
  }
  return null;
}

const _TILE_SUBS = ['a', 'b', 'c', 'd'];
let _tileSubIdx = 0;

async function _drawTiles(ctx, zoom, originX, originY, W, H, urlTemplate, onProgress) {
  const TILE = 256;
  const CONCURRENCY = 10;
  const maxIdx = Math.pow(2, zoom) - 1;
  const col0 = Math.floor(originX / TILE);
  const col1 = Math.floor((originX + W - 1) / TILE);
  const row0 = Math.floor(originY / TILE);
  const row1 = Math.floor((originY + H - 1) / TILE);

  const tasks = [];
  for (let col = col0; col <= col1; col++) {
    for (let row = row0; row <= row1; row++) {
      const tx = Math.max(0, Math.min(maxIdx, col));
      const ty = Math.max(0, Math.min(maxIdx, row));
      const s = _TILE_SUBS[(_tileSubIdx++) % 4];
      const url = urlTemplate.replace('{s}', s).replace('{z}', zoom)
                             .replace('{x}', tx).replace('{y}', ty);
      tasks.push({ url, dx: col * TILE - originX, dy: row * TILE - originY });
    }
  }

  // Pool-based concurrency: always keep CONCURRENCY requests in-flight.
  // A finished slot immediately picks up the next task — no batch waiting.
  let done = 0;
  await new Promise(resolve => {
    if (tasks.length === 0) { resolve(); return; }
    let running = 0, index = 0;

    function pump() {
      while (running < CONCURRENCY && index < tasks.length) {
        const { url, dx, dy } = tasks[index++];
        running++;
        _loadTileImg(url).then(img => {
          if (img) ctx.drawImage(img, dx, dy, TILE, TILE);
          onProgress?.(++done);
          running--;
          if (index < tasks.length) pump();
          else if (running === 0) resolve();
        });
      }
    }

    pump();
  });
}

function _drawPath(ctx, coords, zoom, originX, originY) {
  if (coords.length < 2) return;
  ctx.beginPath();
  for (let i = 0; i < coords.length; i++) {
    const [wx, wy] = _lngLatToWorld(coords[i][0], coords[i][1], zoom);
    i === 0 ? ctx.moveTo(wx - originX, wy - originY)
            : ctx.lineTo(wx - originX, wy - originY);
  }
  ctx.stroke();
}

function _hexToRgb(hex) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16)];
}

function _drawTracks(ctx, zoom, originX, originY, colorMode, uniformColor) {
  const allTracks = [...tracks.values()];

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (colorMode === 'heatmap') {
    // Draw onto an off-screen canvas with source-over so repeated overlapping
    // tracks accumulate alpha (opacity), not brightness — the chosen color is
    // always the hue; high-frequency segments become more opaque/solid.
    const [r, g, b] = _hexToRgb(uniformColor);
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const octx = off.getContext('2d');
    octx.lineJoin = 'round';
    octx.lineCap = 'round';

    for (const { w, a } of [{ w: 4, a: 0.06 }, { w: 1.5, a: 0.25 }]) {
      octx.lineWidth = w;
      octx.strokeStyle = `rgba(${r},${g},${b},${a})`;
      for (const t of allTracks) _drawPath(octx, getCoords(t), zoom, originX, originY);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(off, 0, 0);
  } else if (colorMode === 'uniform') {
    // All tracks same color, opaque, thin.
    const [r, g, b] = _hexToRgb(uniformColor);
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = `rgba(${r},${g},${b},0.88)`;
    for (const t of allTracks) _drawPath(ctx, getCoords(t), zoom, originX, originY);
  } else {
    // Each track keeps its own assigned color from the palette.
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineWidth = 1.5;
    for (const t of allTracks) {
      ctx.strokeStyle = t.color;
      _drawPath(ctx, getCoords(t), zoom, originX, originY);
    }
  }

  ctx.restore();
}

async function doExport() {
  const btn = document.getElementById('ex-do-btn');
  btn.disabled = true;
  btn.textContent = '生成中…';

  const T = label => { console.timeEnd('[export] ' + label); console.time('[export] ' + label); };
  console.group('[export] PNG 导出诊断');
  console.time('[export] 总耗时');
  console.time('[export] 计算 zoom/origin');

  try {
    const [W, H] = EXPORT_RESOLUTIONS[exportState.resolution][exportState.ratio];
    const tileTemplate = EXPORT_TILE_URLS[exportState.tile];

    const allCoords = [];
    for (const t of tracks.values()) for (const pt of getCoords(t)) allCoords.push(pt);

    const { zoom, minLat, maxLat, minLon, maxLon } = _calcZoom(allCoords, W, H);
    const [_ox, _oy] = _calcOrigin(minLat, maxLat, minLon, maxLon, zoom, W, H);
    const originX = Math.round(_ox);
    const originY = Math.round(_oy);

    const TILE = 256;
    const col0 = Math.floor(originX / TILE), col1 = Math.floor((originX + W - 1) / TILE);
    const row0 = Math.floor(originY / TILE), row1 = Math.floor((originY + H - 1) / TILE);
    const tileCount = (col1 - col0 + 1) * (row1 - row0 + 1);
    T('计算 zoom/origin');
    console.log(`[export] 分辨率 ${W}×${H}，zoom=${zoom}，tiles=${tileCount}（${col1-col0+1}列×${row1-row0+1}行）`);

    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    console.time('[export] 加载 tiles');
    btn.textContent = `加载地图 0/${tileCount}…`;
    await _drawTiles(ctx, zoom, originX, originY, W, H, tileTemplate, n => {
      btn.textContent = `加载地图 ${n}/${tileCount}…`;
    });
    T('加载 tiles');

    console.time('[export] 绘制路径');
    _drawTracks(ctx, zoom, originX, originY, exportState.colorMode, exportState.uniformColor);
    T('绘制路径');

    console.time('[export] PNG 编码 (toBlob)');
    btn.textContent = 'PNG 编码中…';
    await new Promise(resolve => canvas.toBlob(blob => {
      T('PNG 编码 (toBlob)');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `fafa_${exportState.resolution}_${exportState.ratio.replace(':', '-')}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      resolve();
    }, 'image/png'));

    console.timeEnd('[export] 总耗时');
    console.groupEnd();
    closeExportModal();
  } catch (e) {
    console.timeEnd('[export] 总耗时');
    console.groupEnd();
    toast('导出失败：' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '导出';
  }
}

/* ── Detail view (界面二) ────────────────────────────────────────────────── */
function openDetailView(id) {
  const t = tracks.get(id);
  if (!t || (!t.distStats?.length && !t.timeStats?.length)) {
    toast('该文件没有可用的分段数据');
    return;
  }
  stopFlash(id);
  detailTrackId = id;
  detailMode = 'time';

  if (detailRouteMap) { detailRouteMap.remove(); detailRouteMap = null; }
  detailRouteLayers = [];
  document.getElementById('detail-chart-section').style.display = '';
  document.getElementById('detail-table-section').style.display = '';
  document.getElementById('detail-route-section').style.display = 'none';

  document.getElementById('detail-filename-label').textContent = t.name;
  document.getElementById('detail-view').classList.add('active');

  _renderDetailSummary(t.summary);
  _buildDetailMetricTabs(t);
  _setupDetailModeButtons();
  _renderDetailChart();
  _renderDetailTable();
}

function closeDetailView() {
  document.getElementById('detail-view').classList.remove('active');
  if (detailChart) { detailChart.destroy(); detailChart = null; }
  if (detailRouteMap) { detailRouteMap.remove(); detailRouteMap = null; }
  detailRouteLayers = [];
  detailTrackId = null;
}

function _renderDetailSummary(summary) {
  const chips = _statChips(summary);
  document.getElementById('detail-summary-row').innerHTML =
    chips.map(c => `<span class="stat-chip">${c}</span>`).join('');
}

function _buildDetailMetricTabs(track) {
  const probe = track.distStats.length ? track.distStats : track.timeStats;
  const available = METRICS.filter(m => probe.some(s => s[m.field] != null));
  if (available.length && !available.find(m => m.key === detailMetric)) {
    detailMetric = available[0].key;
  }
  const container = document.getElementById('detail-metric-tabs');
  container.innerHTML = '';
  for (const m of available) {
    const btn = document.createElement('button');
    btn.className = 'det-metric-tab' + (m.key === detailMetric ? ' active' : '');
    btn.textContent = m.label;
    btn.dataset.key = m.key;
    btn.onclick = () => {
      detailMetric = m.key;
      container.querySelectorAll('.det-metric-tab').forEach(b =>
        b.classList.toggle('active', b.dataset.key === m.key));
      if (detailMode === 'route') {
        _renderDetailRoute();
      } else {
        _renderDetailChart();
      }
    };
    container.appendChild(btn);
  }
}

function _setupDetailModeButtons() {
  document.querySelectorAll('.det-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === detailMode);
    btn.onclick = () => {
      detailMode = btn.dataset.mode;
      document.querySelectorAll('.det-mode-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.mode === detailMode));
      if (detailMode === 'route') {
        document.getElementById('detail-chart-section').style.display = 'none';
        document.getElementById('detail-table-section').style.display = 'none';
        document.getElementById('detail-route-section').style.display = 'flex';
        _renderDetailRoute();
      } else {
        document.getElementById('detail-chart-section').style.display = '';
        document.getElementById('detail-table-section').style.display = '';
        document.getElementById('detail-route-section').style.display = 'none';
        _renderDetailChart();
        _renderDetailTable();
      }
    };
  });
}

function _getDetailStats() {
  const t = tracks.get(detailTrackId);
  return detailMode === 'dist' ? t.distStats : t.timeStats;
}

function _getDetailTableStats() {
  const t = tracks.get(detailTrackId);
  return detailMode === 'dist' ? t.kmStats : t.timeStats;
}

function _getDetailXLabels(stats) {
  if (detailMode === 'dist') {
    // chart: 100m intervals
    return stats.map((_, i) => ((i + 1) * 0.1).toFixed(1) + ' km');
  }
  // time mode: real clock time labels, one per minute
  const t = tracks.get(detailTrackId);
  const t0 = t?.timeStatsStart ? new Date(t.timeStatsStart) : null;
  return stats.map((_, i) => {
    if (!t0) return (i + 1) + ' min';
    const d = new Date(t0.getTime() + i * 60000);
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    return hh + ':' + mm;
  });
}

function _renderDetailChart() {
  const t = tracks.get(detailTrackId);
  if (!t) return;
  const meta   = METRICS.find(m => m.key === detailMetric) || METRICS[0];
  const stats  = _getDetailStats();
  const labels = _getDetailXLabels(stats);
  const data   = stats.map(s => s[meta.field] ?? null);

  if (detailChart) { detailChart.destroy(); detailChart = null; }

  detailChart = new Chart(document.getElementById('detail-canvas'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: `${meta.label} (${meta.unit})`,
        data,
        borderColor: meta.color,
        backgroundColor: meta.color + '1a',
        borderWidth: 2,
        pointRadius: stats.length > 30 ? 0 : 3,
        pointHoverRadius: 5,
        tension: 0,
        fill: true,
        spanGaps: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15,15,20,0.94)',
          borderColor: 'rgba(255,255,255,0.1)',
          borderWidth: 1,
          titleColor: '#888',
          bodyColor: '#ddd',
          callbacks: {
            label: ctx => ctx.parsed.y != null
              ? `${meta.label}: ${ctx.parsed.y} ${meta.unit}`
              : '无数据',
          },
        },
      },
      scales: {
        x: {
          ticks: { color: '#555', maxTicksLimit: 14, font: { size: 11 } },
          grid: { color: 'rgba(255,255,255,0.04)' },
          border: { color: 'rgba(255,255,255,0.08)' },
        },
        y: {
          ticks: { color: '#555', font: { size: 11 } },
          grid: { color: 'rgba(255,255,255,0.04)' },
          border: { color: 'rgba(255,255,255,0.08)' },
        },
      },
    },
  });
}

function _renderDetailTable() {
  const t = tracks.get(detailTrackId);
  if (!t) return;
  const stats   = _getDetailTableStats();
  const xLabels = detailMode === 'dist'
    ? stats.map((_, i) => (i + 1) + ' km')
    : _getDetailXLabels(stats);

  const visCols = TABLE_COLS.filter(c => stats.some(s => s[c.key] != null));

  let html = '<table class="detail-table"><thead><tr>';
  html += `<th>${detailMode === 'dist' ? '距离' : '时间'}</th>`;
  for (const c of visCols) html += `<th>${c.label}</th>`;
  html += '</tr></thead><tbody>';

  stats.forEach((s, i) => {
    html += `<tr><td>${xLabels[i]}</td>`;
    for (const c of visCols) {
      const raw = s[c.key];
      html += `<td>${raw != null ? c.fmt(raw) : '—'}</td>`;
    }
    html += '</tr>';
  });

  html += '</tbody></table>';
  document.getElementById('detail-table-wrap').innerHTML = html;
}

function exportDetailData(fmt) {
  if (detailTrackId == null) return;
  exportTrackData(detailTrackId, fmt);
}

/* ── Detail route view ───────────────────────────────────────────────────── */
function _haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
}

function _metricHeatColor(t) {
  // t: 0 = blue (hue 240), 1 = red (hue 0)
  return `hsl(${Math.round(240 * (1 - t))},88%,56%)`;
}

function _renderDetailRoute() {
  const t = tracks.get(detailTrackId);
  if (!t) return;

  const meta  = METRICS.find(m => m.key === detailMetric) || METRICS[0];
  const field = meta.field;

  // Prefer 100-m segments; fall back to 1-km
  const stats = t.distStats.length ? t.distStats : t.kmStats;
  const stepM = t.distStats.length ? 100 : 1000;

  const values = stats.map(s => s[field]).filter(v => v != null);
  if (!values.length) { toast(`指标「${meta.label}」无可用数据`); return; }
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);

  const coords = getCoords(t);
  if (coords.length < 2) return;

  // Cumulative GPS distance (metres) along the track
  const cumDist = [0];
  for (let i = 1; i < coords.length; i++) {
    cumDist.push(cumDist[i - 1] + _haversineM(
      coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]
    ));
  }

  // Init Leaflet map once per detail session
  if (!detailRouteMap) {
    detailRouteMap = L.map('detail-route-map', { zoomControl: true });
    const tileKey = document.getElementById('tile-select').value || 'dark';
    const tile = TILES[tileKey];
    L.tileLayer(tile.url, tile.opts).addTo(detailRouteMap);
  }

  for (const layer of detailRouteLayers) detailRouteMap.removeLayer(layer);
  detailRouteLayers = [];

  // Assign each GPS point to a stat-bucket and draw colored runs
  const buckets = coords.map((_, i) =>
    Math.min(Math.floor(cumDist[i] / stepM), stats.length - 1)
  );

  let i = 0;
  while (i < coords.length) {
    const b = buckets[i];
    let j = i + 1;
    while (j < coords.length && buckets[j] === b) j++;

    // Include one overlap point for seamless joins between segments
    const seg = coords.slice(i, j < coords.length ? j + 1 : j);
    const val = stats[b]?.[field];
    const tNorm = (val != null && maxVal > minVal) ? (val - minVal) / (maxVal - minVal) : 0.5;
    detailRouteLayers.push(
      L.polyline(seg, { color: _metricHeatColor(tNorm), weight: 5, opacity: 0.9 }).addTo(detailRouteMap)
    );
    i = j;
  }

  // Fit bounds after layout settles (Leaflet needs stable container size)
  setTimeout(() => {
    if (!detailRouteMap) return;
    detailRouteMap.invalidateSize();
    if (detailRouteLayers.length) {
      const bounds = L.latLngBounds([]);
      for (const layer of detailRouteLayers) bounds.extend(layer.getBounds());
      detailRouteMap.fitBounds(bounds, { padding: [24, 24] });
    }
  }, 80);

  // Update legend labels
  const fmtVal = v => {
    if (meta.unit === 'km/h') return v.toFixed(1) + ' km/h';
    if (['bpm', 'rpm', 'W', 'm'].includes(meta.unit)) return Math.round(v) + ' ' + meta.unit;
    return v.toFixed(1) + ' ' + meta.unit;
  };
  document.getElementById('detail-route-legend-low').textContent  = fmtVal(minVal);
  document.getElementById('detail-route-legend-high').textContent = fmtVal(maxVal);
}

/* ── Boot ────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  setupDragDrop();
  initZoomSlider();
  initPanelResize();

  // Panel starts expanded
  const panel = document.getElementById('track-panel');
  panel.classList.add('panel-expanded');
  panel.style.maxHeight = panelExpandedHeight + 'px';

  document.getElementById('tile-select').addEventListener('change', e => {
    setTiles(e.target.value);
  });

  _setupOptGroup('ex-tile-group', 'tile');
  _setupOptGroup('ex-color-group', 'colorMode');
  _setupOptGroup('ex-ratio-group', 'ratio');
  _setupOptGroup('ex-res-group', 'resolution');
  document.getElementById('ex-color-picker').addEventListener('input', e => {
    exportState.uniformColor = e.target.value;
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (aiTrackId != null) closeAiView();
      else if (detailTrackId != null) closeDetailView();
      else if (document.getElementById('library-drawer').classList.contains('open')) closeLibrary();
    }
  });

  // 初始加载文件库计数 & AI 配置
  refreshLibraryCount();
  _initAiConfig();
});

/* ── 文件库 ──────────────────────────────────────────────────────────────── */
let _libFiles = [];       // [{filename, size_kb, mtime}]
let _libLoading = false;
let _libFilterYear  = null;
let _libFilterMonth = null;

function refreshLibraryCount() {
  fetch('/api/files')
    .then(r => r.json())
    .then(d => {
      _libFiles = d.files || [];
      document.getElementById('lib-count').textContent = _libFiles.length;
    })
    .catch(() => {});
}

function openLibrary() {
  document.getElementById('library-drawer').classList.add('open');
  document.getElementById('library-overlay').classList.add('show');
  refreshLibrary();
}

function closeLibrary() {
  document.getElementById('library-drawer').classList.remove('open');
  document.getElementById('library-overlay').classList.remove('show');
}

async function refreshLibrary() {
  if (_libLoading) return;
  _libLoading = true;
  const list = document.getElementById('lib-list');
  list.innerHTML = '<div class="lib-loading">加载中…</div>';
  try {
    const res  = await fetch('/api/files');
    const data = await res.json();
    _libFiles  = data.files || [];
    document.getElementById('lib-count').textContent = _libFiles.length;
    _buildLibFilter();
    _applyLibFilter();
  } catch {
    list.innerHTML = '<div class="lib-loading">加载失败</div>';
  } finally {
    _libLoading = false;
  }
}

// Match both old (Magene_{model}_YYYYMMDD-…) and new (Magene_{model}_{id}_YYYYMMDD-…) formats
const _MAGENE_DATE_RE = /Magene_[A-Z]\d+_(?:\d+_)?(\d{4})(\d{2})\d{2}-/;

function _buildLibFilter() {
  const container = document.getElementById('lib-filter');
  if (!container) return;

  const yearMonths = new Map();
  for (const f of _libFiles) {
    const m = f.filename.match(_MAGENE_DATE_RE);
    if (!m) continue;
    const [, y, mo] = m;
    if (!yearMonths.has(y)) yearMonths.set(y, new Set());
    yearMonths.get(y).add(mo);
  }

  const years = [...yearMonths.keys()].sort().reverse();
  if (!years.length) { container.innerHTML = ''; return; }

  if (_libFilterYear && !yearMonths.has(_libFilterYear)) { _libFilterYear = null; _libFilterMonth = null; }
  if (_libFilterMonth && _libFilterYear && !yearMonths.get(_libFilterYear)?.has(_libFilterMonth)) {
    _libFilterMonth = null;
  }

  container.innerHTML = '';

  const yearRow = document.createElement('div');
  yearRow.className = 'lib-filter-row';

  const makeBtn = (label, active, onclick) => {
    const btn = document.createElement('button');
    btn.className = 'lib-filter-btn' + (active ? ' active' : '');
    btn.textContent = label;
    btn.onclick = onclick;
    return btn;
  };

  yearRow.appendChild(makeBtn('全部', _libFilterYear === null, () => {
    _libFilterYear = null; _libFilterMonth = null; _buildLibFilter(); _applyLibFilter();
  }));
  for (const y of years) {
    yearRow.appendChild(makeBtn(y, _libFilterYear === y, () => {
      _libFilterYear = y; _libFilterMonth = null; _buildLibFilter(); _applyLibFilter();
    }));
  }
  container.appendChild(yearRow);

  if (_libFilterYear) {
    const months = [...(yearMonths.get(_libFilterYear) || [])].sort();
    const monthRow = document.createElement('div');
    monthRow.className = 'lib-filter-row';
    monthRow.appendChild(makeBtn('全部', _libFilterMonth === null, () => {
      _libFilterMonth = null; _buildLibFilter(); _applyLibFilter();
    }));
    for (const mo of months) {
      monthRow.appendChild(makeBtn(mo + '月', _libFilterMonth === mo, () => {
        _libFilterMonth = mo; _buildLibFilter(); _applyLibFilter();
      }));
    }
    container.appendChild(monthRow);
  }
}

function _applyLibFilter() {
  const q = document.getElementById('lib-search').value.toLowerCase();
  let files = _libFiles;
  if (_libFilterYear) {
    files = files.filter(f => {
      const m = f.filename.match(_MAGENE_DATE_RE);
      return m && m[1] === _libFilterYear && (_libFilterMonth === null || m[2] === _libFilterMonth);
    });
  }
  if (q) files = files.filter(f => f.filename.toLowerCase().includes(q));
  _renderLibrary(files);
}

function filterLibrary() {
  _applyLibFilter();
}

function _libDateLabel(filename) {
  // Matches both old (Magene_{model}_YYYYMMDD-HHMMSS_…) and
  // new (Magene_{model}_{id}_YYYYMMDD-HHMMSS) formats
  const m = filename.match(/Magene_[A-Z]\d+_(?:\d+_)?(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
  return filename.replace(/\.fit$/i, '');
}

function _renderLibrary(files) {
  const list = document.getElementById('lib-list');
  if (!files.length) {
    list.innerHTML = '<div class="lib-loading">没有 .fit 文件</div>';
    return;
  }
  const loadedNames = new Set([...tracks.values()].map(t => t.name));
  list.innerHTML = '';
  for (const f of files) {
    const loaded = loadedNames.has(f.filename);
    const row = document.createElement('div');
    row.className = 'lib-row' + (loaded ? ' lib-row-loaded' : '');
    row.dataset.filename = f.filename;

    const info = document.createElement('div');
    info.className = 'lib-row-info';

    const date = document.createElement('span');
    date.className = 'lib-date';
    date.textContent = _libDateLabel(f.filename);

    const size = document.createElement('span');
    size.className = 'lib-size';
    size.textContent = f.size_kb + ' KB';

    info.append(date, size);

    const btn = document.createElement('button');
    btn.className = 'lib-load-btn' + (loaded ? ' lib-load-btn-loaded' : '');
    btn.textContent = loaded ? '已加载' : '加载';
    btn.disabled = loaded;
    btn.onclick = () => loadFromLibrary(f.filename, btn);

    row.append(info, btn);
    list.appendChild(row);
  }
}

async function loadFromLibrary(filename, btn) {
  if (btn) { btn.disabled = true; btn.textContent = '加载中…'; }
  try {
    const res  = await fetch('/api/load', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename }) });
    const data = await res.json();
    if (!res.ok) { toast(data.error || '加载失败'); if (btn) { btn.disabled = false; btn.textContent = '加载'; } return; }
    addTrack(data);
    if (btn) { btn.disabled = true; btn.textContent = '已加载'; btn.closest('.lib-row')?.classList.add('lib-row-loaded'); }
  } catch {
    toast('加载失败：网络错误');
    if (btn) { btn.disabled = false; btn.textContent = '加载'; }
  }
}

async function loadAllFromLibrary() {
  const loadedNames = new Set([...tracks.values()].map(t => t.name));
  const toLoad = _libFiles.filter(f => !loadedNames.has(f.filename));
  if (!toLoad.length) { toast('所有文件已加载'); return; }
  toast(`正在加载 ${toLoad.length} 个文件…`);
  const CHUNK = 4;
  for (let i = 0; i < toLoad.length; i += CHUNK) {
    await Promise.all(toLoad.slice(i, i + CHUNK).map(async f => {
      try {
        const res  = await fetch('/api/load', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: f.filename }) });
        const data = await res.json();
        if (res.ok) addTrack(data);
      } catch {}
    }));
  }
  _renderLibrary(_libFiles);
  toast('加载完成');
}

async function deleteAllFromLibrary() {
  if (!confirm('确定要删除文件库中所有 .fit 文件吗？此操作不可撤销。')) return;
  try {
    const res = await fetch('/api/files/delete_all', { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      toast(`已删除 ${data.deleted} 个文件`);
      refreshLibrary();
      refreshLibraryCount();
    } else {
      toast('删除失败');
    }
  } catch {
    toast('删除失败');
  }
}

/* ── 全量导出 JSON ────────────────────────────────────────────────────────── */
function exportAllJson() {
  const noKm  = false;   // 含逐公里数据
  const minKm = 0;
  const url = `/api/export/all?no_km_stats=${noKm ? 1 : 0}&min_km=${minKm}`;
  toast('正在生成导出文件，请稍候…');
  const a = document.createElement('a');
  a.href = url;
  a.download = 'fafa_export.json';
  a.click();
}

/* ── 顽鹿同步 ────────────────────────────────────────────────────────────── */
let _syncPollTimer = null;

function openSyncModal() {
  document.getElementById('sync-modal').style.display = 'flex';
  document.getElementById('sync-idle-view').style.display = '';
  document.getElementById('sync-progress-view').style.display = 'none';
}

function closeSyncModal() {
  if (_syncPollTimer) { clearInterval(_syncPollTimer); _syncPollTimer = null; }
  document.getElementById('sync-modal').style.display = 'none';
}

async function startSync() {
  const full = document.getElementById('sync-full').checked;
  document.getElementById('sync-idle-view').style.display = 'none';
  document.getElementById('sync-progress-view').style.display = '';
  document.getElementById('sync-close-btn').disabled = true;
  _setSyncUI('正在启动…', 0, 0);

  try {
    const res = await fetch('/api/onelap/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full }),
    });
    if (!res.ok) {
      const d = await res.json();
      _setSyncUI(d.error || '启动失败', 0, 0);
      document.getElementById('sync-close-btn').disabled = false;
      return;
    }
  } catch {
    _setSyncUI('网络错误', 0, 0);
    document.getElementById('sync-close-btn').disabled = false;
    return;
  }

  _syncPollTimer = setInterval(_pollSync, 1500);
}

async function _pollSync() {
  try {
    const res  = await fetch('/api/onelap/status');
    const data = await res.json();
    const pct  = data.total > 0 ? Math.round(data.done / data.total * 100) : 0;
    _setSyncUI(data.message, pct, data.total);

    if (data.state === 'done' || data.state === 'error') {
      clearInterval(_syncPollTimer);
      _syncPollTimer = null;
      document.getElementById('sync-close-btn').disabled = false;

      if (data.new_files && data.new_files.length) {
        const el = document.getElementById('sync-done-files');
        el.innerHTML = '';
        data.new_files.forEach(f => {
          const div = document.createElement('div');
          div.className = 'sync-new-file';
          div.textContent = '+ ' + f;
          el.appendChild(div);
        });
      }
      // 刷新文件库数量
      refreshLibraryCount();
      if (document.getElementById('library-drawer').classList.contains('open')) {
        refreshLibrary();
      }
    }
  } catch {}
}

function _setSyncUI(msg, pct, total) {
  document.getElementById('sync-status-msg').textContent = msg;
  const bar = document.getElementById('sync-progress-bar');
  if (total === 0) {
    bar.classList.add('indeterminate');
    bar.style.width = '';
  } else {
    bar.classList.remove('indeterminate');
    bar.style.width = pct + '%';
  }
}

/* ── AI 骑行评估（界面三） ────────────────────────────────────────────────── */
async function _initAiConfig() {
  try {
    const res = await fetch('/api/ai/config');
    const d   = await res.json();
    _aiModel  = d.configured ? (d.model || 'AI') : '';
  } catch {}
}

function openAiView() {
  const id = detailTrackId;
  const t  = tracks.get(id);
  if (!t) return;
  aiTrackId = id;

  document.getElementById('ai-filename-label').textContent = t.name;
  document.getElementById('ai-model-tag').textContent = _aiModel || '';
  document.getElementById('ai-model-tag').style.display = _aiModel ? '' : 'none';

  const sumRow = document.getElementById('ai-summary-row');
  const chips  = _statChips(t.summary);
  sumRow.innerHTML = chips.map(c => `<span class="stat-chip">${c}</span>`).join('');

  document.getElementById('ai-result').innerHTML = '';
  document.getElementById('ai-view').classList.add('active');
  startAiEval();
}

function closeAiView() {
  document.getElementById('ai-view').classList.remove('active');
  aiTrackId = null;
}

async function startAiEval() {
  if (aiTrackId == null) return;
  const t = tracks.get(aiTrackId);
  if (!t) return;

  const loading = document.getElementById('ai-loading');
  const result  = document.getElementById('ai-result');
  loading.style.display = 'flex';
  result.innerHTML = '';

  if (!_aiModel) {
    loading.style.display = 'none';
    result.innerHTML = `<div class="ai-unconfigured">
      <strong>AI 评估未配置</strong><br>
      请编辑项目根目录下的 <code>ai_config.json</code>，填入 API Key 后重启服务器。<br><br>
      配置示例：<br>
      <code>{ "api_base": "https://api.openai.com/v1", "api_key": "sk-...", "model": "gpt-4o-mini" }</code>
    </div>`;
    return;
  }

  const body = {
    summary:    t.summary    || {},
    km_stats:   t.kmStats    || [],
    filename:   t.name       || '',
    start_time: t.timeStatsStart || '',
  };

  try {
    const res = await fetch('/api/ai/evaluate', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      loading.style.display = 'none';
      result.innerHTML = `<div class="ai-error">${d.error || '请求失败，请检查 ai_config.json 配置'}</div>`;
      return;
    }

    loading.style.display = 'none';

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer   = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') { buffer = ''; break; }
        try {
          const chunk = JSON.parse(data);
          if (chunk.error) {
            result.innerHTML = `<div class="ai-error">${chunk.error}</div>`;
            return;
          }
          if (chunk.text) {
            fullText += chunk.text;
            result.innerHTML = _renderMarkdown(fullText);
          }
        } catch {}
      }
    }
  } catch (e) {
    loading.style.display = 'none';
    result.innerHTML = `<div class="ai-error">网络错误：${e.message}</div>`;
  }
}

function _renderMarkdown(text) {
  const escHtml = s => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const inline = s => escHtml(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

  const lines  = text.split('\n');
  let html     = '';
  let inList   = false;

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith('## ')) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h2>${inline(line.slice(3).trim())}</h2>`;
    } else if (line.startsWith('### ')) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h3>${inline(line.slice(4).trim())}</h3>`;
    } else if (/^[-*] /.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inline(line.slice(2).trim())}</li>`;
    } else if (line.trim() === '') {
      if (inList) { html += '</ul>'; inList = false; }
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p>${inline(line)}</p>`;
    }
  }
  if (inList) html += '</ul>';
  return html;
}
