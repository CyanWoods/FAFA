/* ── Tile configs ────────────────────────────────────────────────────────── */
const TILES = {
  amap: {
    url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    opts: { subdomains: '1234', maxZoom: 19, attribution: '&copy; 高德地图' },
  },
  'dark-nolabels': {
    url: 'https://cartodb-basemaps-{s}.global.ssl.fastly.net/dark_nolabels/{z}/{x}/{y}.png',
    opts: { subdomains: 'abcd', maxZoom: 19, attribution: '&copy; CARTO' },
  },
  'light-nolabels': {
    url: 'https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_nolabels/{z}/{x}/{y}.png',
    opts: { subdomains: 'abcd', maxZoom: 19, attribution: '&copy; CARTO' },
  },
  dark: {
    url: 'https://cartodb-basemaps-{s}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png',
    opts: { subdomains: 'abcd', maxZoom: 19, attribution: '&copy; CARTO' },
  },
  light: {
    url: 'https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png',
    opts: { subdomains: 'abcd', maxZoom: 19, attribution: '&copy; CARTO' },
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
  dark:             'https://cartodb-basemaps-{s}.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png',
  'dark-nolabels':  'https://cartodb-basemaps-{s}.global.ssl.fastly.net/dark_nolabels/{z}/{x}/{y}.png',
  light:            'https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png',
  'light-nolabels': 'https://cartodb-basemaps-{s}.global.ssl.fastly.net/light_nolabels/{z}/{x}/{y}.png',
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
let detailMode = 'km';
let detailMetric = 'speed';
let detailChart = null;

/* ── Map init ────────────────────────────────────────────────────────────── */
function initMap() {
  map = L.map('map', { center: [30, 116], zoom: 8, zoomControl: true });
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
                  summary: data.summary || null, kmStats: data.km_stats || [] };
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

/* ── Per-track mode ──────────────────────────────────────────────────────── */
function setTrackMode(id, mode) {
  const t = tracks.get(id);
  if (!t) return;
  t.mode = mode;
  renderTrack(t);
  document.querySelectorAll(`#ti-${id} .coord-btn`).forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
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
  name.textContent = track.name;
  name.title = '查看详情';
  name.onclick = () => openDetailView(track.id);

  const group = document.createElement('div');
  group.className = 'coord-group';
  [
    { mode: 'decrypt', label: '火星解密' },
    { mode: 'raw',     label: '原始坐标' },
    { mode: 'encrypt', label: '火星加密' },
  ].forEach(({ mode, label }) => {
    const btn = document.createElement('button');
    btn.className = 'coord-btn' + (track.mode === mode ? ' active' : '');
    btn.dataset.mode = mode;
    btn.textContent = label;
    btn.onclick = () => setTrackMode(track.id, mode);
    group.appendChild(btn);
  });

  const rmBtn = document.createElement('button');
  rmBtn.className = 'track-remove';
  rmBtn.textContent = '×';
  rmBtn.title = '移除';
  rmBtn.onclick = () => removeTrack(track.id);

  main.append(dot, name, group, rmBtn);
  row.appendChild(main);

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
  let vis = true;
  _flashTimers.set(id, setInterval(() => {
    vis = !vis;
    t.polyline.setStyle({ opacity: vis ? 0.92 : 0.12 });
  }, 380));
}

function stopFlash(id) {
  if (_flashTimers.has(id)) { clearInterval(_flashTimers.get(id)); _flashTimers.delete(id); }
  const t = tracks.get(id);
  if (t) t.polyline.setStyle({ opacity: 0.82 });
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

function _loadTileImg(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('tile: ' + url));
    img.src = url;
  });
}

const _TILE_SUBS = ['a', 'b', 'c', 'd'];
let _tileSubIdx = 0;

async function _drawTiles(ctx, zoom, originX, originY, W, H, urlTemplate) {
  const TILE = 256;
  const maxIdx = Math.pow(2, zoom) - 1;
  const col0 = Math.floor(originX / TILE);
  const col1 = Math.floor((originX + W - 1) / TILE);
  const row0 = Math.floor(originY / TILE);
  const row1 = Math.floor((originY + H - 1) / TILE);

  const loads = [];
  for (let col = col0; col <= col1; col++) {
    for (let row = row0; row <= row1; row++) {
      const tx = Math.max(0, Math.min(maxIdx, col));
      const ty = Math.max(0, Math.min(maxIdx, row));
      const s = _TILE_SUBS[(_tileSubIdx++) % 4];
      const url = urlTemplate.replace('{s}', s).replace('{z}', zoom)
                             .replace('{x}', tx).replace('{y}', ty);
      const dx = col * TILE - originX;
      const dy = row * TILE - originY;
      loads.push(_loadTileImg(url).then(img => ({ img, dx, dy })));
    }
  }

  const results = await Promise.allSettled(loads);
  for (const r of results) {
    if (r.status === 'fulfilled') {
      const { img, dx, dy } = r.value;
      ctx.drawImage(img, dx, dy, TILE, TILE);
    }
  }
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

  try {
    const [W, H] = EXPORT_RESOLUTIONS[exportState.resolution][exportState.ratio];
    const tileTemplate = EXPORT_TILE_URLS[exportState.tile];

    const allCoords = [];
    for (const t of tracks.values()) for (const pt of getCoords(t)) allCoords.push(pt);

    const { zoom, minLat, maxLat, minLon, maxLon } = _calcZoom(allCoords, W, H);
    const [originX, originY] = _calcOrigin(minLat, maxLat, minLon, maxLon, zoom, W, H);

    const canvas = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    await _drawTiles(ctx, zoom, originX, originY, W, H, tileTemplate);
    _drawTracks(ctx, zoom, originX, originY, exportState.colorMode, exportState.uniformColor);

    await new Promise(resolve => canvas.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `fafa_${exportState.resolution}_${exportState.ratio.replace(':', '-')}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      resolve();
    }, 'image/png'));

    closeExportModal();
  } catch (e) {
    toast('导出失败：' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '导出';
  }
}

/* ── Detail view (界面二) ────────────────────────────────────────────────── */
function openDetailView(id) {
  const t = tracks.get(id);
  if (!t || !t.kmStats || !t.kmStats.length) {
    toast('该文件没有可用的分段数据');
    return;
  }
  stopFlash(id);
  detailTrackId = id;
  detailMode = 'km';

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
  detailTrackId = null;
}

function _renderDetailSummary(summary) {
  const chips = _statChips(summary);
  document.getElementById('detail-summary-row').innerHTML =
    chips.map(c => `<span class="stat-chip">${c}</span>`).join('');
}

function _buildDetailMetricTabs(track) {
  const available = METRICS.filter(m => track.kmStats.some(s => s[m.field] != null));
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
      _renderDetailChart();
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
      _renderDetailChart();
      _renderDetailTable();
    };
  });
}

function _getDetailXLabels(kmStats) {
  if (detailMode === 'km') return kmStats.map(s => s.km + ' km');
  let cum = 0;
  return kmStats.map(s => { cum += s.duration_s / 60; return cum.toFixed(1) + ' min'; });
}

function _renderDetailChart() {
  const t = tracks.get(detailTrackId);
  if (!t) return;
  const meta   = METRICS.find(m => m.key === detailMetric) || METRICS[0];
  const labels = _getDetailXLabels(t.kmStats);
  const data   = t.kmStats.map(s => s[meta.field] ?? null);

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
        pointRadius: t.kmStats.length > 30 ? 0 : 3,
        pointHoverRadius: 5,
        tension: 0.35,
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
  const { kmStats } = t;

  const visCols = TABLE_COLS.filter(c => kmStats.some(s => s[c.key] != null));
  const xLabels = _getDetailXLabels(kmStats);

  let html = '<table class="detail-table"><thead><tr>';
  html += `<th>${detailMode === 'km' ? '公里' : '时间'}</th>`;
  for (const c of visCols) html += `<th>${c.label}</th>`;
  html += '</tr></thead><tbody>';

  kmStats.forEach((s, i) => {
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
    if (e.key === 'Escape' && detailTrackId != null) closeDetailView();
  });
});
