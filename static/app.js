/* ── ECharts: inject locally if not already loaded from template ─────────── */
if (typeof echarts === 'undefined') {
  const _es = document.createElement('script');
  _es.src = '/static/echarts.min.js';
  document.head.appendChild(_es);
}

/* ── Tile configs ────────────────────────────────────────────────────────── */
const _CARTO_OPTS = {
  subdomains: 'bcd', maxZoom: 19, attribution: '&copy; CARTO',
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
  { key: 'speed',    label: '速度', field: 'avg_speed_kmh',  rField: 'speed_kmh', unit: 'km/h', color: '#2e86de' },
  { key: 'hr',       label: '心率', field: 'avg_hr',         rField: 'hr',        unit: 'bpm',  color: '#e74c3c' },
  { key: 'power',    label: '功率', field: 'avg_power',      rField: 'power',     unit: 'W',    color: '#f39c12' },
  { key: 'cadence',  label: '踏频', field: 'avg_cadence',    rField: 'cadence',   unit: 'rpm',  color: '#9b59b6' },
  { key: 'altitude', label: '海拔', field: 'end_alt_m',      rField: 'altitude',  unit: 'm',    color: '#2ecc71' },
  { key: 'grade',    label: '坡度', field: 'avg_grade_pct',  rField: 'grade',     unit: '%',    color: '#1abc9c' },
];

const ROUTE_COLOR_SCALE = {
  speed:   { min: 0,   max: 50  },
  cadence: { min: 0,   max: 130 },
  power:   { coggan: true },
  grade:   { min: -8,  max: 8, diverging: true },
  hr:      { zone: true },
};

// Index 0=below Z1(gray), 1=Z1(blue)…5=Z5(red)
const HR_ZONE_COLORS    = ['#888', '#3a86ff', '#27ae60', '#f1c40f', '#e67e22', '#e74c3c'];
// Coggan 7-zone: Z1-Z7 = gray/blue/green/yellow/orange/red/purple
const POWER_ZONE_COLORS = ['#888', '#3a86ff', '#27ae60', '#f1c40f', '#e67e22', '#e74c3c', '#9b59b6'];

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
let map, tileLayer, currentTile = 'dark-nolabels';
const tracks = new Map();
let trackCounter = 0;
const exportState = { tile: 'dark-nolabels', colorMode: 'heatmap', uniformColor: '#e74c3c', ratio: '16:9', resolution: '2K' };
let panelExpanded = false;
let panelExpandedHeight = 320;
let detailTrackId = null;
let detailMetric = 'speed';
let detailCharts = [];
let detailChartResizeObservers = [];
let detailRouteMap = null;
let detailRouteTileLayer = null;
let detailRouteLayers = [];
let _detailZoomDrag = null;
let _detailZoomActive = false;
let _detailZoomHandlersInited = false;
let _detailRouteCoords = null;
let _detailRouteCumDist = null;
let _detailRouteStepM = 1000;
let _detailChartIsRecords = false;
let _detailChartDataLen = 0;
let _detailRouteMarker = null;
let _detailRouteHideTimer = null;
let aiTrackId = null;
let _aiModel  = '';
let _analyticsOpen = false;
let _analyticsTab  = 'pmc'; // 'pmc' | 'calendar'
let _pmcChart = null;
let _pmcAllData = null;   // { days, tss, ctl, atl, tsb, activities }
let _pmcPeriod = 0; // 0 = 全部数据
let _pmcZonePeriod  = 0;   // 0=全部, 90/30/7=天数
const _pmcDistPeriods = { 'pmc-dist-distance': 0, 'pmc-dist-duration': 0, 'pmc-dist-elevation': 0, 'pmc-dist-tss': 0 };
let _pmcDailyCharts = [];  // ECharts 实例，渲染前 dispose
let _pmcChartResizeObserver = null;
let _pmcDailyResizeObservers = [];
let _pmcCurveChart  = null;
let _pmcCurveResizeObserver = null;
let _pmcLoadSeq = 0;
let _pmcConfig = { ftp: 200, maxHr: 190, restHr: 50, weight: 0 };
let _routeScaleCfg = { gradeMin: null, gradeMax: null, speedMax: null, cadenceMax: null };

let _calYear  = new Date().getFullYear();
let _calMonth = new Date().getMonth(); // 0-indexed
let _calActivities = null; // cached from /api/activities

let _sidebarView = 'activities'; // 'activities' | 'map' | 'pmc' | 'calendar' | 'files'

function switchSidebarView(name) {
  // Dismiss full-screen overlays first (z-index 950+) so they don't block new view
  if (aiTrackId != null) closeAiView();
  if (detailTrackId != null) closeDetailView();

  // Exit select mode when leaving activities view
  if (_actSelectMode) _exitSelectMode();

  _sidebarView = name;

  document.getElementById('activities-view').classList.remove('active');
  document.getElementById('files-view').classList.remove('active');
  closeAnalyticsView(false);

  // Update sidebar button active state
  document.querySelectorAll('.sb-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === name);
  });

  // Show/hide map view
  const mapView = document.getElementById('map-view');
  if (name === 'map') {
    mapView.classList.add('active');
    map.invalidateSize();
  } else {
    mapView.classList.remove('active');
  }

  if (name === 'activities') {
    document.getElementById('activities-view').classList.add('active');
    openActivitiesView();
  } else if (name === 'pmc') {
    openAnalyticsView('pmc');
  } else if (name === 'calendar') {
    openAnalyticsView('calendar');
  } else if (name === 'files') {
    document.getElementById('files-view').classList.add('active');
    refreshLibrary();
  }
}

let _actActivities  = null; // cached from /api/activities
let _actFilter      = { year: '', month: '', minKm: null, maxKm: null, tags: new Set() };
let _actSelectMode  = false;
let _actSelected    = new Set(); // filenames
let _allTags        = []; // all tags from /api/tags

function _actFilteredList() {
  if (!_actActivities) return [];
  return _actActivities.filter(a => {
    if (_actFilter.year  && (!a.start_time || !a.start_time.startsWith(_actFilter.year))) return false;
    if (_actFilter.month) {
      const m = String(new Date(a.start_time.replace(' ', 'T')).getMonth() + 1);
      if (m !== _actFilter.month) return false;
    }
    const km = (a.summary || {}).total_dist_km || 0;
    if (_actFilter.minKm != null && km < _actFilter.minKm) return false;
    if (_actFilter.maxKm != null && km >= _actFilter.maxKm) return false;
    if (_actFilter.tags.size > 0) {
      const actTagIds = new Set((a.tags || []).map(t => t.id));
      for (const tid of _actFilter.tags) {
        if (!actTagIds.has(tid)) return false;
      }
    }
    return true;
  });
}

function _actFilterChanged() {
  _actFilter.year  = document.getElementById('act-filter-year').value;
  _actFilter.month = document.getElementById('act-filter-month').value;
  if (_actSelectMode) _exitSelectMode();
  _renderActivityList(_actFilteredList());
}

async function _loadAllTags() {
  try {
    const res = await fetch('/api/tags');
    if (res.ok) {
      _allTags = (await res.json()).tags || [];
      _renderTagFilterChips();
    }
  } catch (_) {}
}

function _renderTagFilterChips() {
  const row = document.getElementById('act-filter-tag-row');
  const container = document.getElementById('act-filter-tags');
  if (!container) return;
  if (_allTags.length === 0) { row.style.display = 'none'; return; }
  row.style.display = '';
  container.innerHTML = '';
  for (const tag of _allTags) {
    const btn = document.createElement('button');
    btn.className = 'tag-filter-chip' + (_actFilter.tags.has(tag.id) ? ' active' : '');
    btn.textContent = tag.name;
    if (_actFilter.tags.has(tag.id)) btn.style.background = tag.color;
    btn.onclick = () => {
      if (_actFilter.tags.has(tag.id)) {
        _actFilter.tags.delete(tag.id);
        btn.classList.remove('active');
        btn.style.background = '';
      } else {
        _actFilter.tags.add(tag.id);
        btn.classList.add('active');
        btn.style.background = tag.color;
      }
      if (_actSelectMode) _exitSelectMode();
      _renderActivityList(_actFilteredList());
    };
    container.appendChild(btn);
  }
}

function _actDistPreset(btn) {
  document.querySelectorAll('.dist-preset').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const min = btn.dataset.min;
  const max = btn.dataset.max;
  _actFilter.minKm = min !== '' ? Number(min) : null;
  _actFilter.maxKm = max !== '' ? Number(max) : null;
  if (_actSelectMode) _exitSelectMode();
  _renderActivityList(_actFilteredList());
}

function _populateYearFilter() {
  const yearEl = document.getElementById('act-filter-year');
  const years = [...new Set(
    (_actActivities || [])
      .filter(a => a.start_time)
      .map(a => a.start_time.slice(0, 4))
  )].sort().reverse();
  yearEl.innerHTML = '<option value="">全部年份</option>';
  years.forEach(y => {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y + '年';
    if (y === _actFilter.year) opt.selected = true;
    yearEl.appendChild(opt);
  });
}

function _toggleSelectMode() {
  if (_actSelectMode) _exitSelectMode();
  else _enterSelectMode();
}

function _enterSelectMode() {
  _actSelectMode = true;
  _actSelected.clear();
  document.getElementById('activities-view').classList.add('select-mode');
  document.getElementById('act-select-bar').style.display = '';
  document.getElementById('act-mode-btn').textContent = '取消';
  _updateSelectBar();
}

function _exitSelectMode() {
  _actSelectMode = false;
  _actSelected.clear();
  document.getElementById('activities-view').classList.remove('select-mode');
  document.getElementById('act-select-bar').style.display = 'none';
  document.getElementById('act-mode-btn').textContent = '选择';
  document.getElementById('act-select-all-btn').textContent = '全选';
  document.querySelectorAll('.act-card.selected').forEach(c => c.classList.remove('selected'));
}

function _updateSelectBar() {
  document.getElementById('act-select-count').textContent = `已选 ${_actSelected.size} 项`;
  const allCards = document.querySelectorAll('.act-card[data-filename]');
  const btn = document.getElementById('act-select-all-btn');
  if (btn) {
    const allSelected = allCards.length > 0 && [...allCards].every(c => _actSelected.has(c.dataset.filename));
    btn.textContent = allSelected ? '取消全选' : '全选';
  }
}

function _actSelectAll() {
  const allCards = document.querySelectorAll('.act-card[data-filename]');
  const allSelected = allCards.length > 0 && [...allCards].every(c => _actSelected.has(c.dataset.filename));
  if (allSelected) {
    allCards.forEach(c => { _actSelected.delete(c.dataset.filename); c.classList.remove('selected'); });
  } else {
    allCards.forEach(c => { _actSelected.add(c.dataset.filename); c.classList.add('selected'); });
  }
  _updateSelectBar();
}

async function _actBulkLoad() {
  if (!_actSelected.size) { toast('请先选择活动'); return; }
  const filenames = [..._actSelected];
  _exitSelectMode();
  switchSidebarView('map');
  for (const filename of filenames) {
    let already = false;
    for (const [, t] of tracks) { if (t.filename === filename) { already = true; break; } }
    if (already) continue;
    try {
      const res  = await fetch('/api/load', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename }) });
      if (!res.ok) continue;
      const data = await res.json();
      addTrack(data);
    } catch {}
  }
}

async function _actBulkDelete() {
  if (!_actSelected.size) { toast('请先选择活动'); return; }
  const filenames = [..._actSelected];
  if (!confirm(`确定删除选中的 ${filenames.length} 个文件？此操作不可撤销。`)) return;
  _exitSelectMode();
  for (const filename of filenames) {
    try {
      await fetch('/api/files/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename }) });
      // Remove from in-memory track list if loaded
      for (const [id, t] of tracks) { if (t.filename === filename) { removeTrack(id); break; } }
    } catch {}
  }
  _actActivities = null;
  openActivitiesView();
}

async function _actLoadAllVisible() {
  const list = _actFilteredList();
  if (!list.length) { toast('当前列表没有活动'); return; }
  switchSidebarView('map');
  for (const act of list) {
    let already = false;
    for (const [, t] of tracks) { if (t.filename === act.filename) { already = true; break; } }
    if (already) continue;
    try {
      const res  = await fetch('/api/load', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: act.filename }) });
      if (!res.ok) continue;
      const data = await res.json();
      addTrack(data);
    } catch {}
  }
}

async function openActivitiesView() {
  const listEl    = document.getElementById('act-list');
  const emptyEl   = document.getElementById('act-empty-hint');
  const loadingEl = document.getElementById('act-loading-hint');

  if (_actActivities) {
    _populateYearFilter();
    _renderActivityList(_actFilteredList());
    return;
  }

  listEl.innerHTML = '';
  emptyEl.style.display = 'none';
  loadingEl.style.display = '';

  try {
    const res  = await fetch('/api/activities');
    const data = await res.json();
    _actActivities = (data.activities || []).sort((a, b) =>
      (b.start_time || '').localeCompare(a.start_time || ''));
    loadingEl.style.display = 'none';
    _populateYearFilter();
    _renderActivityList(_actFilteredList());
  } catch (e) {
    loadingEl.style.display = 'none';
    emptyEl.style.display = '';
    emptyEl.textContent = '加载失败，请刷新重试';
  }
}

function _renderActivityList(activities) {
  const listEl   = document.getElementById('act-list');
  const emptyEl  = document.getElementById('act-empty-hint');
  const sumBarEl = document.getElementById('act-summary-bar');

  listEl.innerHTML = '';

  if (!activities.length) {
    emptyEl.style.display = '';
    sumBarEl.style.display = 'none';
    return;
  }
  emptyEl.style.display = 'none';

  // Summary bar totals
  const totalKm = activities.reduce((s, a) => s + ((a.summary || {}).total_dist_km     || 0), 0);
  const totalS  = activities.reduce((s, a) => s + ((a.summary || {}).total_duration_s  || 0), 0);
  sumBarEl.style.display = '';
  sumBarEl.innerHTML =
    `<span class="sum-val">${activities.length}</span> 次骑行` +
    `<span class="sum-dot"> · </span>` +
    `<span class="sum-val">${totalKm.toFixed(0)}</span> km` +
    `<span class="sum-dot"> · </span>` +
    `<span class="sum-val">${_fmtDur(totalS)}</span>`;

  // Render cards grouped by year-month
  let lastMonthKey = null;
  for (const act of activities) {
    const dt = act.start_time ? new Date(act.start_time.replace(' ', 'T')) : null;
    const monthKey = dt ? `${dt.getFullYear()}年${dt.getMonth() + 1}月` : null;
    if (monthKey && monthKey !== lastMonthKey) {
      const header = document.createElement('div');
      header.className = 'act-month-header';
      header.textContent = monthKey;
      listEl.appendChild(header);
      lastMonthKey = monthKey;
    }
    listEl.appendChild(_buildActivityCard(act));
  }
}

function _buildActivityCard(act) {
  const summary = act.summary || {};

  const dt  = act.start_time ? new Date(act.start_time.replace(' ', 'T')) : null;
  const day = dt ? dt.getDate() : '—';
  const mon = dt ? dt.toLocaleDateString('zh-CN', { month: 'short' }) : '';

  const distKm = summary.total_dist_km         != null ? summary.total_dist_km.toFixed(1) + ' km' : '—';
  const durStr = summary.total_duration_s      != null ? _fmtDur(summary.total_duration_s)        : '—';
  const speed  = summary.avg_speed_kmh         != null ? summary.avg_speed_kmh.toFixed(1) + ' km/h' : '—';
  const elev   = summary.total_elevation_gain_m != null ? Math.round(summary.total_elevation_gain_m) + ' m' : '—';
  const power   = summary.avg_power    != null ? Math.round(summary.avg_power)  + ' W'   : '—';
  const hr      = summary.avg_hr       != null ? Math.round(summary.avg_hr)    + ' bpm'  : '—';
  const cadence = summary.avg_cadence  != null ? Math.round(summary.avg_cadence) + ' rpm' : '—';

  const card = document.createElement('div');
  card.className = 'act-card';
  card.title = act.filename;
  card.dataset.filename = act.filename;
  card.innerHTML = `
    <div class="act-card-check"></div>
    <div class="act-card-date">
      <div class="act-card-date-day">${day}</div>
      <div class="act-card-date-month">${mon}</div>
    </div>
    <div class="act-card-divider"></div>
    <div class="act-card-stats">
      <div class="act-stat act-stat-primary"><span class="act-stat-val">${distKm}</span><span class="act-stat-lbl">距离</span></div>
      <div class="act-stat act-stat-primary"><span class="act-stat-val">${durStr}</span><span class="act-stat-lbl">时长</span></div>
      <div class="act-stat"><span class="act-stat-val">${speed}</span><span class="act-stat-lbl">均速</span></div>
      <div class="act-stat"><span class="act-stat-val">${cadence}</span><span class="act-stat-lbl">均踏频</span></div>
      <div class="act-stat"><span class="act-stat-val">${hr}</span><span class="act-stat-lbl">均心率</span></div>
      <div class="act-stat"><span class="act-stat-val">${power}</span><span class="act-stat-lbl">均功率</span></div>
      <div class="act-stat"><span class="act-stat-val">${elev}</span><span class="act-stat-lbl">爬升</span></div>
      <div class="act-card-tags"></div>
      <div class="act-card-actions">
        <button class="act-card-ai-btn">AI 分析</button>
        <button class="act-card-ai-btn act-card-map-btn">路线热图</button>
      </div>
    </div>
  `;
  const tags = act.tags || [];
  if (tags.length > 0) {
    const tagsCol = card.querySelector('.act-card-tags');
    tags.forEach(tag => {
      const badge = document.createElement('span');
      badge.className = 'act-tag-badge';
      badge.style.background = tag.color;
      badge.textContent = tag.name;
      tagsCol.appendChild(badge);
    });
  }
  card.querySelector('.act-card-ai-btn').addEventListener('click', e => {
    e.stopPropagation();
    openActAiModal(act);
  });
  card.querySelector('.act-card-map-btn').addEventListener('click', async e => {
    e.stopPropagation();
    const mapBtn = e.currentTarget;
    if (mapBtn.disabled) return;
    mapBtn.disabled = true;
    try {
      const res = await fetch('/api/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: act.filename }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
      const data = await res.json();
      const id = addTrack(data);
      await openDetailView(id);
    } catch (err) {
      toast('加载失败：' + err.message);
    } finally {
      mapBtn.disabled = false;
    }
  });
  card.addEventListener('click', () => {
    if (_actSelectMode) {
      if (_actSelected.has(act.filename)) {
        _actSelected.delete(act.filename);
        card.classList.remove('selected');
      } else {
        _actSelected.add(act.filename);
        card.classList.add('selected');
      }
      _updateSelectBar();
    } else {
      _activityCardClick(act, card);
    }
  });
  return card;
}

async function _activityCardClick(act, cardEl) {
  // If already loaded in tracks map, open detail directly
  for (const [id, t] of tracks) {
    if (t.filename === act.filename) {
      openDetailView(id);
      return;
    }
  }

  // Load via /api/load
  cardEl.classList.add('loading');
  try {
    const res = await fetch('/api/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: act.filename }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || res.statusText);
    }
    const data = await res.json();
    const id   = addTrack(data);
    openDetailView(id);
  } catch (e) {
    toast('加载失败：' + e.message);
  } finally {
    cardEl.classList.remove('loading');
  }
}

/* ── Map init ────────────────────────────────────────────────────────────── */
function initMap() {
  map = L.map('map', { center: [30, 116], zoom: 8, zoomControl: false });
  setTiles('dark-nolabels');
  setTimeout(() => map.invalidateSize(), 200);
}

function setTiles(name) {
  currentTile = name;
  if (tileLayer) map.removeLayer(tileLayer);
  const tileCfg = TILES[name];
  tileLayer = L.tileLayer(tileCfg.url, tileCfg.opts).addTo(map);
  tileLayer.on('tileerror', function (err) {
    const tile = err.tile;
    const retries = +(tile.dataset.retries || 0);
    if (retries < 4) {
      tile.dataset.retries = retries + 1;
      const subs = Array.from(tileLayer.options.subdomains);
      const { x, y } = err.coords;
      // Leaflet assigns subdomains by |x+y| % n, so a diagonal stripe all hits the same server.
      // On each retry, rotate to the next subdomain to avoid the same failing host.
      const origIdx = Math.abs(x + y) % subs.length;
      const nextIdx = (origIdx + retries + 1) % subs.length;
      const baseUrl = tileLayer.getTileUrl(err.coords);
      const retryUrl = baseUrl.replace(`//${subs[origIdx]}.`, `//${subs[nextIdx]}.`);
      const delay = 1000 * Math.pow(2, retries); // 1s 2s 4s 8s
      setTimeout(() => {
        if (tile.parentNode) {
          tile.src = retryUrl + (retryUrl.includes('?') ? '&' : '?') + '_r=' + Date.now();
        }
      }, delay);
    }
  });
  for (const track of tracks.values()) renderTrack(track);
}

/* ── Track coords ────────────────────────────────────────────────────────── */
function getCoords(track) {
  // Amap tiles expect GCJ-02; all local files are WGS-84, encrypt for display only
  if (currentTile === 'amap') return track.encrypted;
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
  const track = { id, name: data.filename, filename: data.filename, raw, decrypted, encrypted, polyline, color, mode: 'raw',
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
  return id;
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
    return _trackSortKey(tb).localeCompare(_trackSortKey(ta));
  });
  items.forEach(el => list.appendChild(el));
}

function syncBadge() {
  const n = tracks.size;
  const sb = document.getElementById('track-badge');
  if (sb) sb.textContent = n;
  const pb = document.getElementById('panel-track-count');
  if (pb) pb.textContent = n;
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
  _actActivities = null; // invalidate cache so list refreshes
}

/* ── Drag-and-drop ───────────────────────────────────────────────────────── */
function setupDragDrop() {
  const overlay = document.getElementById('drop-overlay');
  let depth = 0;

  document.addEventListener('dragenter', e => { e.preventDefault(); depth++; overlay.classList.add('show'); });
  document.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; overlay.classList.remove('show'); } });
  document.addEventListener('dragover',  e => e.preventDefault());
  document.addEventListener('drop', async e => {
    e.preventDefault();
    depth = 0;
    overlay.classList.remove('show');
    for (const file of e.dataTransfer.files) await uploadFile(file);
    if (_sidebarView === 'activities') openActivitiesView();
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

/* ── Detail chart/map split resize ──────────────────────────────────────── */
function initDetailSplitResize() {
  const row    = document.getElementById('detail-main-row');
  const left   = document.getElementById('detail-chart-section');
  const right  = document.getElementById('detail-route-section');
  const handle = document.getElementById('detail-split-handle');
  const MIN_W  = 180;
  let dragging = false, startX = 0, startLeftW = 0;

  function startDrag(clientX) {
    dragging   = true;
    startX     = clientX;
    startLeftW = left.getBoundingClientRect().width;
    document.body.style.cursor     = 'ew-resize';
    document.body.style.userSelect = 'none';
  }

  function doDrag(clientX) {
    if (!dragging) return;
    const rowW    = row.getBoundingClientRect().width;
    const handleW = handle.getBoundingClientRect().width;
    const maxLeftW = rowW - handleW - MIN_W;
    const newLeftW = Math.max(MIN_W, Math.min(maxLeftW, startLeftW + (clientX - startX)));
    left.style.flex  = `0 0 ${newLeftW}px`;
    right.style.flex = '1 1 0';
    if (detailRouteMap) detailRouteMap.invalidateSize();
  }

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor     = '';
    document.body.style.userSelect = '';
  }

  handle.addEventListener('mousedown',  e => { startDrag(e.clientX); e.preventDefault(); });
  document.addEventListener('mousemove', e => doDrag(e.clientX));
  document.addEventListener('mouseup',   endDrag);

  handle.addEventListener('touchstart', e => { startDrag(e.touches[0].clientX); e.preventDefault(); }, { passive: false });
  document.addEventListener('touchmove', e => { if (dragging) { doDrag(e.touches[0].clientX); e.preventDefault(); } }, { passive: false });
  document.addEventListener('touchend',  endDrag);

  handle.addEventListener('dblclick', () => {
    left.style.flex  = '1 1 0';
    right.style.flex = '1 1 0';
    if (detailRouteMap) detailRouteMap.invalidateSize();
  });
}

/* ── Detail table resize ─────────────────────────────────────────────────── */
function initDetailTableResize() {
  const section = document.getElementById('detail-table-section');
  const handle  = document.getElementById('detail-table-handle');
  const DEFAULT_H = 220, MIN_H = 16;
  let dragging = false, startY = 0, startH = 0;

  function startDrag(clientY) {
    dragging = true;
    startY   = clientY;
    startH   = section.getBoundingClientRect().height;
    document.body.style.cursor     = 'ns-resize';
    document.body.style.userSelect = 'none';
  }

  function contentMaxH() {
    const wrap   = document.getElementById('detail-table-wrap');
    const handle = document.getElementById('detail-table-handle');
    return (wrap ? wrap.scrollHeight : 0) + (handle ? handle.getBoundingClientRect().height : 0);
  }

  function doDrag(clientY) {
    if (!dragging) return;
    const maxH = Math.max(DEFAULT_H, contentMaxH());
    const newH = Math.max(MIN_H, Math.min(maxH, startH + (startY - clientY)));
    section.style.height = newH + 'px';
    if (detailRouteMap) detailRouteMap.invalidateSize();
  }

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor     = '';
    document.body.style.userSelect = '';
  }

  handle.addEventListener('mousedown',  e => { startDrag(e.clientY); e.preventDefault(); });
  document.addEventListener('mousemove', e => doDrag(e.clientY));
  document.addEventListener('mouseup',   endDrag);

  handle.addEventListener('touchstart', e => { startDrag(e.touches[0].clientY); e.preventDefault(); }, { passive: false });
  document.addEventListener('touchmove', e => { if (dragging) { doDrag(e.touches[0].clientY); e.preventDefault(); } }, { passive: false });
  document.addEventListener('touchend',  endDrag);

  handle.addEventListener('dblclick', () => {
    const h = section.getBoundingClientRect().height;
    section.style.height = (h > MIN_H + 10 ? MIN_H : DEFAULT_H) + 'px';
    if (detailRouteMap) detailRouteMap.invalidateSize();
  });
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
async function openDetailView(id) {
  const t = tracks.get(id);
  if (!t) return;
  stopFlash(id);
  detailTrackId = id;

  if (detailRouteMap) { detailRouteMap.remove(); detailRouteMap = null; detailRouteTileLayer = null; }
  detailRouteLayers = [];

  document.getElementById('detail-filename-label').textContent = t.name;
  document.getElementById('detail-view').classList.add('active');

  _renderDetailSummary(t.summary);
  _loadAndRenderDetailMeta(t.name);

  document.getElementById('detail-charts-wrap').innerHTML =
    '<div class="detail-charts-loading">加载数据中…</div>';

  let records = null;
  if (t.source === 'library') {
    try {
      const resp = await fetch('/api/records/' + encodeURIComponent(t.name));
      if (resp.ok) records = (await resp.json()).records;
    } catch (_) {}
  }

  _renderDetailCharts(records, t.timeStats);
  _renderDetailTable();
  _buildRouteMetricBar();
  _renderDetailRoute();
}

function closeDetailView() {
  document.getElementById('detail-view').classList.remove('active');
  _disposeDetailCharts();
  _detailZoomDrag = null;
  _detailZoomActive = false;
  const resetBtn = document.getElementById('detail-zoom-reset-btn');
  if (resetBtn) resetBtn.style.display = 'none';
  if (detailRouteMap) { detailRouteMap.remove(); detailRouteMap = null; detailRouteTileLayer = null; }
  detailRouteLayers = [];
  if (_detailRouteHideTimer) { clearTimeout(_detailRouteHideTimer); _detailRouteHideTimer = null; }
  _detailRouteMarker = null;
  _detailRouteCoords = null;
  _detailRouteCumDist = null;
  detailTrackId = null;
  if (_sidebarView === 'activities') {
    document.getElementById('activities-view').classList.add('active');
  }
}

function _disposeDetailCharts() {
  for (const ro of detailChartResizeObservers) {
    try { ro.disconnect(); } catch {}
  }
  detailChartResizeObservers = [];
  for (const chart of detailCharts) {
    try { chart.dispose(); } catch {}
  }
  detailCharts = [];
}

// ── detail meta: notes + tags ─────────────────────────────────────────────────

let _detailMetaFilename = null;
let _detailCurrentTags  = []; // [{id,name,color}]
let _detailCurrentNote  = '';

async function _loadAndRenderDetailMeta(filename) {
  _detailMetaFilename = filename;
  _closeTagPicker();
  _renderDetailNote('', false);
  _renderDetailTagsRow([]);
  try {
    const res = await fetch('/api/meta/' + encodeURIComponent(filename));
    if (!res.ok) return;
    const data = await res.json();
    _detailCurrentNote = data.note || '';
    _detailCurrentTags = data.tags || [];
    _renderDetailNote(_detailCurrentNote, false);
    _renderDetailTagsRow(_detailCurrentTags);
  } catch (_) {}
}

function _renderDetailTagsRow(tags) {
  const list = document.getElementById('detail-tags-list');
  if (!list) return;
  list.innerHTML = '';
  tags.forEach(tag => {
    const chip = document.createElement('span');
    chip.className = 'detail-tag-chip';
    chip.style.background = tag.color;
    chip.textContent = tag.name;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'detail-tag-chip-remove';
    removeBtn.title = '移除';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => _removeTagFromActivity(tag.id));
    chip.appendChild(removeBtn);
    list.appendChild(chip);
  });
  const addBtn = document.getElementById('detail-tag-add-btn');
  if (addBtn) addBtn.onclick = (e) => { e.stopPropagation(); _openTagPicker(addBtn); };
}

async function _removeTagFromActivity(tagId) {
  _detailCurrentTags = _detailCurrentTags.filter(t => t.id !== tagId);
  _renderDetailTagsRow(_detailCurrentTags);
  await _saveDetailTags();
  _syncActivityTagsInCache(_detailMetaFilename, _detailCurrentTags);
}

async function _saveDetailTags() {
  if (!_detailMetaFilename) return;
  try {
    await fetch('/api/meta/' + encodeURIComponent(_detailMetaFilename) + '/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag_ids: _detailCurrentTags.map(t => t.id) }),
    });
  } catch (_) {}
}

function _syncActivityTagsInCache(filename, tags) {
  if (!_actActivities) return;
  const act = _actActivities.find(a => a.filename === filename);
  if (act) {
    act.tags = tags;
    // Refresh the card in-place if visible
    const card = document.querySelector(`.act-card[data-filename="${CSS.escape(filename)}"]`);
    if (card) {
      const tagsCol = card.querySelector('.act-card-tags');
      if (tagsCol) {
        tagsCol.innerHTML = '';
        tags.forEach(tag => {
          const badge = document.createElement('span');
          badge.className = 'act-tag-badge';
          badge.style.background = tag.color;
          badge.textContent = tag.name;
          tagsCol.appendChild(badge);
        });
      }
    }
  }
}

// ── tag picker popup ──────────────────────────────────────────────────────────

function _openTagPicker(anchorEl) {
  const picker = document.getElementById('tag-picker');
  if (!picker) return;
  _renderTagPickerList();
  picker.style.display = 'block';
  const rect = anchorEl.getBoundingClientRect();
  const detailRect = document.getElementById('detail-view').getBoundingClientRect();
  picker.style.left = (rect.left - detailRect.left) + 'px';
  picker.style.top  = (rect.bottom - detailRect.top + 4) + 'px';
  picker.style.position = 'absolute';
  setTimeout(() => document.addEventListener('click', _pickerOutsideClick), 0);
}

function _closeTagPicker() {
  const picker = document.getElementById('tag-picker');
  if (picker) picker.style.display = 'none';
  document.removeEventListener('click', _pickerOutsideClick);
}

function _pickerOutsideClick(e) {
  const picker = document.getElementById('tag-picker');
  if (picker && !picker.contains(e.target)) _closeTagPicker();
}

function _renderTagPickerList() {
  const list = document.getElementById('tag-picker-list');
  if (!list) return;
  list.innerHTML = '';
  const selectedIds = new Set(_detailCurrentTags.map(t => t.id));
  _allTags.forEach(tag => {
    const chip = document.createElement('button');
    chip.className = 'tag-picker-chip' + (selectedIds.has(tag.id) ? ' selected' : '');
    chip.style.background = tag.color;
    chip.textContent = tag.name;
    chip.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (selectedIds.has(tag.id)) {
        _detailCurrentTags = _detailCurrentTags.filter(t => t.id !== tag.id);
        selectedIds.delete(tag.id);
        chip.classList.remove('selected');
      } else {
        _detailCurrentTags.push(tag);
        selectedIds.add(tag.id);
        chip.classList.add('selected');
      }
      _renderDetailTagsRow(_detailCurrentTags);
      await _saveDetailTags();
      _syncActivityTagsInCache(_detailMetaFilename, _detailCurrentTags);
    });
    list.appendChild(chip);
  });

  // wire up create new tag button
  const newBtn = document.getElementById('tag-new-btn');
  if (newBtn) {
    newBtn.onclick = async (e) => {
      e.stopPropagation();
      const nameEl  = document.getElementById('tag-new-name');
      const colorEl = document.getElementById('tag-new-color');
      const name = (nameEl.value || '').trim();
      if (!name) return;
      try {
        const res = await fetch('/api/tags', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, color: colorEl.value }),
        });
        if (!res.ok) { toast('创建失败：' + ((await res.json()).error || res.statusText)); return; }
        const { tag } = await res.json();
        _allTags.push(tag);
        _renderTagFilterChips();
        nameEl.value = '';
        _detailCurrentTags.push(tag);
        _renderDetailTagsRow(_detailCurrentTags);
        await _saveDetailTags();
        _syncActivityTagsInCache(_detailMetaFilename, _detailCurrentTags);
        _renderTagPickerList();
      } catch (err) { toast('创建失败：' + err.message); }
    };
  }
}

// ── note editor ───────────────────────────────────────────────────────────────

function _renderDetailNote(note, editing) {
  const rendered = document.getElementById('detail-note-rendered');
  const editor   = document.getElementById('detail-note-editor');
  const editBtn  = document.getElementById('detail-note-edit-btn');
  const saveBtn  = document.getElementById('detail-note-save-btn');
  if (!rendered) return;
  if (editing) {
    rendered.style.display = 'none';
    editor.style.display = '';
    editor.value = note;
    editor.focus();
    editBtn.style.display = 'none';
    saveBtn.style.display = '';
  } else {
    editor.style.display = 'none';
    editBtn.style.display = '';
    saveBtn.style.display = 'none';
    rendered.style.display = '';
    if (note) {
      rendered.classList.add('has-content');
      rendered.innerHTML = DOMPurify.sanitize(marked.parse(note));
    } else {
      rendered.classList.remove('has-content');
      rendered.innerHTML = '<span style="color:#555;font-size:12px">点击「编辑」添加备注…</span>';
    }
  }
}

function _initDetailNoteButtons() {
  const editBtn = document.getElementById('detail-note-edit-btn');
  const saveBtn = document.getElementById('detail-note-save-btn');
  const editor  = document.getElementById('detail-note-editor');
  if (!editBtn || !saveBtn || !editor) return;
  editBtn.onclick = () => _renderDetailNote(_detailCurrentNote, true);
  saveBtn.onclick = async () => {
    const newNote = editor.value;
    _detailCurrentNote = newNote;
    _renderDetailNote(newNote, false);
    if (!_detailMetaFilename) return;
    try {
      await fetch('/api/meta/' + encodeURIComponent(_detailMetaFilename) + '/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: newNote }),
      });
    } catch (_) {}
  };
  // Cmd+Enter / Ctrl+Enter saves
  editor.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') saveBtn.click();
  });
}

function _renderDetailSummary(summary) {
  const chips = _statChips(summary);
  document.getElementById('detail-summary-row').innerHTML =
    chips.map(c => `<span class="stat-chip">${c}</span>`).join('');
}


function _buildRouteMetricBar() {
  const t = tracks.get(detailTrackId);
  if (!t) return;
  const bar = document.getElementById('detail-route-metric-bar');
  if (!bar) return;
  const probe = t.distStats.length ? t.distStats : t.kmStats;
  const available = METRICS.filter(m => probe.some(s => s[m.field] != null));
  if (!available.find(m => m.key === detailMetric)) detailMetric = available[0]?.key || 'speed';
  bar.innerHTML = '';
  for (const m of available) {
    const btn = document.createElement('button');
    btn.className = 'det-route-metric-btn' + (m.key === detailMetric ? ' active' : '');
    btn.textContent = m.label;
    btn.dataset.key = m.key;
    btn.onclick = () => {
      detailMetric = m.key;
      bar.querySelectorAll('.det-route-metric-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.key === m.key));
      _renderDetailRoute();
    };
    bar.appendChild(btn);
  }
}

function _resetDetailZoom() {
  for (const c of detailCharts) {
    c.setOption({ xAxis: [{ min: null, max: null }] });
  }
  _detailZoomActive = false;
  const btn = document.getElementById('detail-zoom-reset-btn');
  if (btn) btn.style.display = 'none';
}

function _applyDetailZoom(minPx, maxPx, sourceChart) {
  const opt = sourceChart.getOption();
  const labels = opt.xAxis[0].data;
  if (!labels || labels.length < 2) return;
  let minI = Math.round(sourceChart.convertFromPixel({ xAxisIndex: 0 }, minPx));
  let maxI = Math.round(sourceChart.convertFromPixel({ xAxisIndex: 0 }, maxPx));
  if (minI > maxI) [minI, maxI] = [maxI, minI];
  minI = Math.max(0, minI);
  maxI = Math.min(labels.length - 1, maxI);
  if (maxI - minI < 2) return;
  for (const c of detailCharts) {
    c.setOption({ xAxis: [{ min: minI, max: maxI }] });
  }
  _detailZoomActive = true;
  const btn = document.getElementById('detail-zoom-reset-btn');
  if (btn) btn.style.display = '';
}

function _initDetailZoomHandlers() {
  if (_detailZoomHandlersInited) return;
  _detailZoomHandlersInited = true;
  document.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    for (const c of detailCharts) {
      const container = c.getDom();
      if (!container.contains(e.target)) continue;
      const overlay = container.querySelector('.detail-zoom-sel');
      if (!overlay) continue;
      const rect = container.getBoundingClientRect();
      const startPx = e.clientX - rect.left;
      _detailZoomDrag = { chart: c, canvas: container, overlay, startPx };
      overlay.style.left = startPx + 'px';
      overlay.style.width = '0px';
      overlay.style.display = 'none';
      e.preventDefault();
      break;
    }
  });
  document.addEventListener('mousemove', e => {
    if (!_detailZoomDrag) return;
    const { canvas, overlay, startPx } = _detailZoomDrag;
    const rect = canvas.getBoundingClientRect();
    const curPx = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const left = Math.min(startPx, curPx);
    const width = Math.abs(curPx - startPx);
    overlay.style.left = left + 'px';
    overlay.style.width = width + 'px';
    overlay.style.display = '';
  });
  document.addEventListener('mouseup', e => {
    if (!_detailZoomDrag) return;
    const { chart, canvas, overlay, startPx } = _detailZoomDrag;
    _detailZoomDrag = null;
    overlay.style.display = 'none';
    const rect = canvas.getBoundingClientRect();
    const endPx = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    if (Math.abs(endPx - startPx) > 8) {
      _applyDetailZoom(Math.min(startPx, endPx), Math.max(startPx, endPx), chart);
    }
  });
}

function _setupChartZoomDrag(chart) {
  const container = chart.getDom();
  const overlay = document.createElement('div');
  overlay.className = 'detail-zoom-sel';
  overlay.style.display = 'none';
  container.appendChild(overlay);
  container.style.cursor = 'crosshair';
  container.addEventListener('dblclick', () => {
    if (_detailZoomActive) _resetDetailZoom();
  });
}

function _renderDetailCharts(records, fallbackStats) {
  _disposeDetailCharts();
  _detailZoomActive = false;
  _detailZoomDrag = null;
  const resetBtn = document.getElementById('detail-zoom-reset-btn');
  if (resetBtn) resetBtn.style.display = 'none';
  _initDetailZoomHandlers();
  const wrap = document.getElementById('detail-charts-wrap');
  wrap.innerHTML = '';

  const useRecords = records && records.length > 0;
  const track = tracks.get(detailTrackId);
  const isDark = !document.body.classList.contains('light-theme');
  const gridColor   = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)';
  const borderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)';
  const tickColor   = isDark ? '#555' : '#999';
  const tooltipBg   = isDark ? 'rgba(15,15,20,0.94)' : 'rgba(255,255,255,0.97)';
  const tooltipBorder = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)';
  const tooltipTitle = isDark ? '#888' : '#999';
  const tooltipBody  = isDark ? '#ddd' : '#333';

  for (const meta of METRICS) {
    const hasData = useRecords
      ? records.some(r => r[meta.rField] != null)
      : (fallbackStats || []).some(s => s[meta.field] != null);
    if (!hasData) continue;

    const block = document.createElement('div');
    block.className = 'detail-chart-block';

    const lbl = document.createElement('div');
    lbl.className = 'detail-chart-label';
    lbl.textContent = `${meta.label}  ${meta.unit}`;
    block.appendChild(lbl);

    const cw = document.createElement('div');
    cw.className = 'detail-chart-canvas-wrap';
    block.appendChild(cw);
    wrap.appendChild(block);

    let labels, data;
    if (useRecords) {
      labels = records.map(r => r.t);
      data   = records.map(r => r[meta.rField] ?? null);
    } else {
      const t0 = track?.timeStatsStart ? new Date(track.timeStatsStart) : null;
      labels = (fallbackStats || []).map((_, i) => {
        if (!t0) return (i + 1) + ' min';
        const d = new Date(t0.getTime() + i * 60000);
        return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
      });
      data = (fallbackStats || []).map(s => s[meta.field] ?? null);
    }

    const chart = echarts.init(cw, null, { renderer: 'svg' });
    chart.group = 'detail';
    chart.setOption({
      animation: false,
      backgroundColor: 'transparent',
      grid: { top: 6, bottom: 22, left: 44, right: 8, containLabel: false },
      xAxis: {
        type: 'category',
        data: labels,
        boundaryGap: false,
        axisLine: { lineStyle: { color: borderColor } },
        axisTick: { show: false },
        axisLabel: { color: tickColor, fontSize: 10, interval: 'auto' },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: tickColor, fontSize: 10 },
        splitLine: { lineStyle: { color: gridColor } },
      },
      series: [{
        type: 'line',
        data,
        symbol: 'none',
        lineStyle: { color: meta.color, width: 1.5 },
        areaStyle: { color: meta.color, opacity: 0.06 },
        connectNulls: false,
        emphasis: { disabled: true },
      }],
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: 'rgba(128,128,160,0.3)', width: 1 } },
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        borderWidth: 1,
        textStyle: { color: tooltipBody, fontSize: 11 },
        formatter: params => {
          const p = params[0];
          const val = p.value != null ? `${p.value} ${meta.unit}` : '无数据';
          return `<span style="color:${tooltipTitle}">${p.name}</span><br/>${meta.label}: ${val}`;
        },
      },
    });

    const ro = new ResizeObserver(() => {
      try { chart.resize(); } catch {}
    });
    ro.observe(cw);
    detailChartResizeObservers.push(ro);
    detailCharts.push(chart);
    _setupChartZoomDrag(chart);
  }

  echarts.connect('detail');

  _detailChartIsRecords = useRecords;
  _detailChartDataLen   = useRecords ? (records ? records.length : 0) : (fallbackStats ? fallbackStats.length : 0);

  for (const chart of detailCharts) {
    const c = chart;
    c.getZr().on('mousemove', evt => {
      const idx = Math.round(c.convertFromPixel({ xAxisIndex: 0 }, evt.offsetX));
      if (idx >= 0 && idx < _detailChartDataLen) _updateDetailRouteMarker(idx);
    });
    c.getZr().on('mouseout', _hideDetailRouteMarker);
  }
}

function _updateDetailRouteMarker(dataIdx) {
  if (_detailRouteHideTimer) { clearTimeout(_detailRouteHideTimer); _detailRouteHideTimer = null; }
  if (!detailRouteMap || !_detailRouteCoords || !_detailRouteCumDist) return;
  const totalDist = _detailRouteCumDist[_detailRouteCumDist.length - 1];
  const targetDist = _detailChartIsRecords
    ? (dataIdx / Math.max(1, _detailChartDataLen - 1)) * totalDist
    : (dataIdx + 0.5) * _detailRouteStepM;

  // Binary search for nearest GPS point
  let lo = 0, hi = _detailRouteCumDist.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (_detailRouteCumDist[mid] < targetDist) lo = mid + 1;
    else hi = mid;
  }
  const latlng = _detailRouteCoords[lo];
  if (!latlng) return;

  if (!_detailRouteMarker) {
    _detailRouteMarker = L.circleMarker(latlng, {
      radius: 6, color: '#fff', weight: 2, fillColor: '#2e86de', fillOpacity: 1,
    }).addTo(detailRouteMap);
  } else {
    _detailRouteMarker.setLatLng(latlng);
  }
}

function _hideDetailRouteMarker() {
  _detailRouteHideTimer = setTimeout(() => {
    _detailRouteHideTimer = null;
    if (_detailRouteMarker && detailRouteMap) {
      detailRouteMap.removeLayer(_detailRouteMarker);
      _detailRouteMarker = null;
    }
  }, 60);
}

function _detailRouteFitBounds() {
  if (!detailRouteMap || !detailRouteLayers.length) return;
  const bounds = L.latLngBounds([]);
  for (const layer of detailRouteLayers) bounds.extend(layer.getBounds());
  detailRouteMap.fitBounds(bounds, { padding: [24, 24] });
}

function _renderDetailTable() {
  const t = tracks.get(detailTrackId);
  if (!t) return;
  const useKm = t.kmStats.length > 0;
  const stats = useKm ? t.kmStats : t.timeStats;
  if (!stats.length) return;

  const xLabels = useKm
    ? stats.map((_, i) => (i + 1) + ' km')
    : (() => {
        const t0 = t.timeStatsStart ? new Date(t.timeStatsStart) : null;
        return stats.map((_, i) => {
          if (!t0) return (i + 1) + ' min';
          const d = new Date(t0.getTime() + i * 60000);
          return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
        });
      })();

  const visCols = TABLE_COLS.filter(c => stats.some(s => s[c.key] != null));
  let html = '<table class="detail-table"><thead><tr>';
  html += `<th>${useKm ? '距离' : '时间'}</th>`;
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

function _metricHeatColor(t, metricKey) {
  if (metricKey === 'speed' || metricKey === 'cadence') {
    // green(120°) → yellow(60°) → orange(30°) → red(0°)
    return `hsl(${Math.round(120 * (1 - t))},90%,42%)`;
  }
  return `hsl(${Math.round(240 * (1 - t))},88%,56%)`;
}

function _gradeHeatColor(t) {
  // t=0 → blue, t=0.5 → white, t=1 → red
  if (t <= 0.5) {
    const s = t * 2;
    return `rgb(${Math.round(255*s)},${Math.round(255*s)},255)`;
  }
  const s = (t - 0.5) * 2;
  return `rgb(255,${Math.round(255*(1-s))},${Math.round(255*(1-s))})`;
}

function _hrZoneColor(hr, maxHr) {
  const p = hr / maxHr;
  if (p < 0.50) return HR_ZONE_COLORS[0];
  if (p < 0.60) return HR_ZONE_COLORS[1];
  if (p < 0.70) return HR_ZONE_COLORS[2];
  if (p < 0.80) return HR_ZONE_COLORS[3];
  if (p < 0.90) return HR_ZONE_COLORS[4];
  return HR_ZONE_COLORS[5];
}

function _powerZoneColor(watts, ftp) {
  const p = watts / ftp;
  if (p < 0.55) return POWER_ZONE_COLORS[0];
  if (p < 0.75) return POWER_ZONE_COLORS[1];
  if (p < 0.90) return POWER_ZONE_COLORS[2];
  if (p < 1.05) return POWER_ZONE_COLORS[3];
  if (p < 1.20) return POWER_ZONE_COLORS[4];
  if (p < 1.50) return POWER_ZONE_COLORS[5];
  return POWER_ZONE_COLORS[6];
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
  const dataMin = Math.min(...values);
  const dataMax = Math.max(...values);
  const scaleDef = ROUTE_COLOR_SCALE[detailMetric];
  const scale = scaleDef ? { ...scaleDef } : null;
  if (scale && !scale.zone && !scale.coggan) {
    if (detailMetric === 'grade') {
      if (_routeScaleCfg.gradeMin != null) scale.min = _routeScaleCfg.gradeMin;
      if (_routeScaleCfg.gradeMax != null) scale.max = _routeScaleCfg.gradeMax;
    } else if (detailMetric === 'speed') {
      if (_routeScaleCfg.speedMax != null) scale.max = _routeScaleCfg.speedMax;
    } else if (detailMetric === 'cadence') {
      if (_routeScaleCfg.cadenceMax != null) scale.max = _routeScaleCfg.cadenceMax;
    }
  }
  const maxHr = scale?.zone   ? _pmcConfig.maxHr : null;
  const ftp   = scale?.coggan ? _pmcConfig.ftp   : null;
  const minVal = (scale?.zone || scale?.coggan) ? 0 : (scale ? scale.min : dataMin);
  const maxVal = scale?.zone ? maxHr : scale?.coggan ? ftp * 2 : (scale ? scale.max : dataMax);

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
    const tileKey = document.getElementById('tile-select').value || 'dark-nolabels';
    const tile = TILES[tileKey];
    detailRouteTileLayer = L.tileLayer(tile.url, tile.opts).addTo(detailRouteMap);
  }

  for (const layer of detailRouteLayers) detailRouteMap.removeLayer(layer);
  detailRouteLayers = [];
  if (_detailRouteMarker) { detailRouteMap.removeLayer(_detailRouteMarker); _detailRouteMarker = null; }

  // Store for chart→map hover sync
  _detailRouteCoords = coords;
  _detailRouteCumDist = cumDist;
  _detailRouteStepM = stepM;

  // Assign each GPS point to a stat-bucket and draw colored runs
  const buckets = coords.map((_, i) =>
    Math.min(Math.floor(cumDist[i] / stepM), stats.length - 1)
  );

  const fmtVal = v => {
    if (meta.unit === 'km/h') return v.toFixed(1) + ' km/h';
    if (['bpm', 'rpm', 'W', 'm'].includes(meta.unit)) return Math.round(v) + ' ' + meta.unit;
    return v.toFixed(1) + ' ' + meta.unit;
  };

  let i = 0;
  while (i < coords.length) {
    const b = buckets[i];
    let j = i + 1;
    while (j < coords.length && buckets[j] === b) j++;

    // Include one overlap point for seamless joins between segments
    const seg = coords.slice(i, j < coords.length ? j + 1 : j);
    const val = stats[b]?.[field];
    let color;
    if (scale?.zone) {
      color = _hrZoneColor(val ?? 0, maxHr);
    } else if (scale?.coggan) {
      color = _powerZoneColor(val ?? 0, ftp);
    } else {
      const tNorm = val != null ? Math.max(0, Math.min(1, (maxVal > minVal) ? (val - minVal) / (maxVal - minVal) : 0)) : 0.5;
      color = scale?.diverging ? _gradeHeatColor(tNorm) : _metricHeatColor(tNorm, detailMetric);
    }
    const tooltipText = val != null ? fmtVal(val) : null;
    const pl = L.polyline(seg, { color, weight: 5, opacity: 0.9 }).addTo(detailRouteMap);
    if (tooltipText) {
      const tip = document.getElementById('detail-route-tooltip');
      pl.on('mousemove', e => {
        if (!tip) return;
        tip.textContent = tooltipText;
        tip.style.display = '';
        tip.style.left = (e.originalEvent.clientX + 14) + 'px';
        tip.style.top  = (e.originalEvent.clientY - 28) + 'px';
      });
      pl.on('mouseout', () => { if (tip) tip.style.display = 'none'; });
    }
    detailRouteLayers.push(pl);
    i = j;
  }

  // Fit bounds after layout settles (Leaflet needs stable container size)
  setTimeout(() => {
    if (!detailRouteMap) return;
    detailRouteMap.invalidateSize();
    _detailRouteFitBounds();
  }, 80);

  // Update legend labels
  document.getElementById('detail-route-legend-low').textContent  = fmtVal(minVal);
  document.getElementById('detail-route-legend-high').textContent = fmtVal(maxVal);
  const legendBar = document.getElementById('detail-route-legend-bar');
  if (scale?.zone) {
    const [g, b1, g2, y, o, r] = HR_ZONE_COLORS;
    legendBar.style.background = `linear-gradient(to right,
      ${g} 0%, ${g} 50%,
      ${b1} 50%, ${b1} 60%,
      ${g2} 60%, ${g2} 70%,
      ${y} 70%, ${y} 80%,
      ${o} 80%, ${o} 90%,
      ${r} 90%, ${r} 100%)`;
  } else if (scale?.coggan) {
    const [g, b1, g2, y, o, r, w] = POWER_ZONE_COLORS;
    // Bar represents 0–200% FTP; zone boundaries at 55/75/90/105/120/150%
    legendBar.style.background = `linear-gradient(to right,
      ${g}  0%,    ${g}  27.5%,
      ${b1} 27.5%, ${b1} 37.5%,
      ${g2} 37.5%, ${g2} 45%,
      ${y}  45%,   ${y}  52.5%,
      ${o}  52.5%, ${o}  60%,
      ${r}  60%,   ${r}  75%,
      ${w}  75%,   ${w}  100%)`;
  } else if (scale?.diverging) {
    legendBar.style.background = 'linear-gradient(to right, rgb(0,0,255), white, rgb(255,0,0))';
  } else if (detailMetric === 'speed' || detailMetric === 'cadence') {
    legendBar.style.background = 'linear-gradient(to right, hsl(120,90%,42%), hsl(60,90%,42%), hsl(30,90%,42%), hsl(0,90%,42%))';
  } else {
    legendBar.style.background = '';
  }
  const marker = document.getElementById('detail-route-legend-marker');
  if (marker && scale) {
    const pos = scale.zone
      ? Math.max(0, Math.min(1, dataMax / maxHr))
      : scale.coggan
        ? Math.max(0, Math.min(1, dataMax / (ftp * 2)))
        : Math.max(0, Math.min(1, (dataMax - scale.min) / (scale.max - scale.min)));
    marker.style.display = '';
    marker.style.left = (pos * 100) + '%';
    marker.dataset.label = fmtVal(dataMax);
  } else if (marker) {
    marker.style.display = 'none';
  }
  const minMarker = document.getElementById('detail-route-legend-min-marker');
  if (minMarker) {
    if (scale && !scale.zone && !scale.coggan) {
      const posMin = Math.max(0, Math.min(1, (scale.max > scale.min) ? (dataMin - scale.min) / (scale.max - scale.min) : 0));
      minMarker.style.display = '';
      minMarker.style.left = (posMin * 100) + '%';
      minMarker.dataset.label = fmtVal(dataMin);
    } else {
      minMarker.style.display = 'none';
    }
  }
  const ftpMarker = document.getElementById('detail-route-legend-ftp-marker');
  if (ftpMarker) {
    if (scale?.coggan) {
      ftpMarker.style.display = '';
      ftpMarker.style.left = '50%';
      ftpMarker.dataset.label = `FTP ${ftp} W`;
    } else {
      ftpMarker.style.display = 'none';
    }
  }
}

/* ── Boot ────────────────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  setupDragDrop();
  initZoomSlider();
  initPanelResize();
  initDetailSplitResize();
  initDetailTableResize();

  // Activities view is default home
  switchSidebarView('activities');

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
      if (document.getElementById('cal-act-modal').classList.contains('active')) calCloseActivityModal();
      else if (aiTrackId != null) closeAiView();
      else if (detailTrackId != null) closeDetailView();
      // analytics and files are sidebar views; no ESC needed
    }
  });

  document.addEventListener('mousedown', e => {
    if (e.button !== 3) return;
    e.preventDefault();
    if (document.getElementById('cal-act-modal').classList.contains('active')) calCloseActivityModal();
    else if (aiTrackId != null) closeAiView();
    else if (detailTrackId != null) closeDetailView();
    else if (_analyticsOpen) closeAnalyticsView();
  });

  let _calWheelLast = 0;
  document.getElementById('cal-body').addEventListener('wheel', e => {
    e.preventDefault();
    const now = Date.now();
    if (now - _calWheelLast < 300) return;
    _calWheelLast = now;
    calNavMonth(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  // Period selector buttons (scoped to #pmc-chart-header to avoid cross-contamination with zone period buttons)
  document.querySelectorAll('#pmc-chart-header .pmc-period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#pmc-chart-header .pmc-period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _pmcPeriod = parseInt(btn.dataset.days) || 0;
      if (_pmcAllData) _renderPmcChart(_pmcAllData, _pmcPeriod);
    });
  });

  // PMC 区间筛选按钮
  document.getElementById('pmc-zone-period-btns')?.addEventListener('click', e => {
    const btn = e.target.closest('.pmc-period-btn[data-zone-period]');
    if (btn) _applyZonePeriod(Number(btn.dataset.zonePeriod));
  });

  // PMC 分布筛选按钮（各自独立，事件委托到 analytics-view）
  document.getElementById('analytics-view')?.addEventListener('click', e => {
    const btn = e.target.closest('.pmc-dist-period-group .pmc-period-btn[data-dist-period]');
    if (!btn) return;
    const group = btn.closest('.pmc-dist-period-group[data-dist-id]');
    if (group) _applyDistPeriod(group.dataset.distId, Number(btn.dataset.distPeriod));
  });

  // 初始加载文件库计数 & AI 配置 & 主题
  refreshLibraryCount();
  _initAiConfig();
  _loadPmcConfig();
  _initTheme();
  _loadAllTags();
  _initDetailNoteButtons();

  document.getElementById('act-upload-input')?.addEventListener('change', async e => {
    for (const file of e.target.files) await uploadFile(file);
    e.target.value = '';
    _actActivities = null;
    if (_sidebarView === 'activities') openActivitiesView();
    else if (_sidebarView === 'files') refreshLibrary();
    refreshLibraryCount();
  });
});

/* ── 文件库 ──────────────────────────────────────────────────────────────── */
let _libFiles = [];       // [{filename, size_kb, mtime}]
let _libLoading = false;
let _libFilterYear  = null;
let _libFilterMonth = null;
let _libSelectMode  = false;
let _libSelectedSet = new Set();

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
  switchSidebarView('files');
}

function closeLibrary() {
  // No-op: files view has no close button; switch sidebar to navigate away
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

function _libSortKey(f) {
  const m = f.filename.match(/(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})?/);
  if (m) return `${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}${m[6] || '00'}`;
  return String(Math.round(f.mtime * 1000)).padStart(20, '0');
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
  files = [...files].sort((a, b) => _libSortKey(b).localeCompare(_libSortKey(a)));
  _renderLibrary(files);
}

function filterLibrary() {
  _applyLibFilter();
}

function _toggleLibSelectMode() {
  if (_libSelectMode) _exitLibSelectMode();
  else _enterLibSelectMode();
}

function _enterLibSelectMode() {
  _libSelectMode = true;
  _libSelectedSet.clear();
  document.getElementById('lib-select-bar').style.display = 'flex';
  document.getElementById('lib-select-btn').textContent = '取消';
  _applyLibFilter();
  _updateLibSelectCount();
}

function _exitLibSelectMode() {
  _libSelectMode = false;
  _libSelectedSet.clear();
  document.getElementById('lib-select-bar').style.display = 'none';
  document.getElementById('lib-select-btn').textContent = '选择';
  _applyLibFilter();
}

function _updateLibSelectCount() {
  document.getElementById('lib-select-count').textContent = `已选 ${_libSelectedSet.size} 项`;
  const allBtn = document.getElementById('lib-select-all-btn');
  if (allBtn) allBtn.textContent = _libSelectedSet.size > 0 ? '取消全选' : '全选';
}

function _libSelectAll() {
  const rows = document.querySelectorAll('#lib-list .lib-row');
  const visibleNames = [...rows].map(r => r.dataset.filename);
  if (_libSelectedSet.size === visibleNames.length && visibleNames.length > 0) {
    _libSelectedSet.clear();
  } else {
    visibleNames.forEach(n => _libSelectedSet.add(n));
  }
  _updateLibSelectCount();
  document.querySelectorAll('#lib-list .lib-row').forEach(row => {
    const cb = row.querySelector('.lib-cb');
    const sel = _libSelectedSet.has(row.dataset.filename);
    if (cb) cb.checked = sel;
    row.classList.toggle('lib-row-selected', sel);
  });
}

async function _libBulkDelete() {
  if (!_libSelectedSet.size) { toast('请先选择文件'); return; }
  if (!confirm(`确定要删除选中的 ${_libSelectedSet.size} 个文件吗？此操作不可撤销。`)) return;
  const filenames = [..._libSelectedSet];
  let deleted = 0;
  for (const fn of filenames) {
    try {
      const res = await fetch('/api/files/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: fn }) });
      if (res.ok) deleted++;
    } catch {}
  }
  toast(`已删除 ${deleted} 个文件`);
  _actActivities = null;
  _exitLibSelectMode();
  refreshLibrary();
  refreshLibraryCount();
}

async function _libDeleteFile(filename) {
  if (!confirm(`确定要删除此文件吗？此操作不可撤销。`)) return;
  try {
    const res = await fetch('/api/files/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename }) });
    if (res.ok) {
      toast('已删除');
      _actActivities = null;
      refreshLibrary();
      refreshLibraryCount();
    } else {
      toast('删除失败');
    }
  } catch {
    toast('删除失败');
  }
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
  list.innerHTML = '';
  for (const f of files) {
    const selected = _libSelectedSet.has(f.filename);
    const row = document.createElement('div');
    row.className = 'lib-row' + (selected ? ' lib-row-selected' : '');
    row.dataset.filename = f.filename;

    if (_libSelectMode) {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'lib-cb';
      cb.checked = selected;
      cb.onchange = () => {
        if (cb.checked) _libSelectedSet.add(f.filename);
        else _libSelectedSet.delete(f.filename);
        row.classList.toggle('lib-row-selected', cb.checked);
        _updateLibSelectCount();
      };
      row.appendChild(cb);
      row.style.cursor = 'pointer';
      row.onclick = (e) => { if (e.target === cb) return; cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); };
    }

    const info = document.createElement('div');
    info.className = 'lib-row-info';

    const date = document.createElement('span');
    date.className = 'lib-date';
    date.textContent = _libDateLabel(f.filename);

    const size = document.createElement('span');
    size.className = 'lib-size';
    size.textContent = f.size_kb + ' KB';

    info.append(date, size);
    row.appendChild(info);

    if (!_libSelectMode) {
      const delBtn = document.createElement('button');
      delBtn.className = 'lib-delete-btn';
      delBtn.textContent = '删除';
      delBtn.onclick = (e) => { e.stopPropagation(); _libDeleteFile(f.filename); };
      row.appendChild(delBtn);
    }

    list.appendChild(row);
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
      // 同步结束（含无新文件）：停止进度条滚动动画
      const bar = document.getElementById('sync-progress-bar');
      bar.classList.remove('indeterminate');
      bar.style.width = '100%';

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
      refreshLibrary();
      if (_sidebarView === 'activities') {
        _actActivities = null;
        openActivitiesView();
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

/* ── Strava 上传 ─────────────────────────────────────────────────────────── */
let _stravaPollTimer = null;

const STRAVA_AUTH_MSG_DEFAULT = '需要先完成 Strava 授权。请在 <code>config.json</code> 中填写 <code>strava_client_id</code> 和 <code>strava_client_secret</code>，然后点击授权。';

function openStravaModal() {
  document.getElementById('strava-modal').style.display = 'flex';
}

// Show the auth view with a custom message — used when sync fails because the
// stored token / refresh_token is no longer valid and re-authorization is needed.
function _stravaPromptReauth(msg) {
  if (_stravaPollTimer) { clearInterval(_stravaPollTimer); _stravaPollTimer = null; }
  openStravaModal();
  const authMsg = document.getElementById('strava-auth-msg');
  authMsg.textContent = '';
  if (msg) {
    authMsg.appendChild(document.createTextNode(msg));
    authMsg.appendChild(document.createElement('br'));
  }
  authMsg.appendChild(document.createTextNode('Strava 授权已失效，请重新授权。'));
  document.getElementById('strava-auth-view').style.display = '';
  document.getElementById('strava-diff-view').style.display = 'none';
  document.getElementById('strava-upload-view').style.display = 'none';
}

function closeStravaModal() {
  if (_stravaPollTimer) { clearInterval(_stravaPollTimer); _stravaPollTimer = null; }
  document.getElementById('strava-modal').style.display = 'none';
  document.getElementById('strava-auth-view').style.display = '';
  document.getElementById('strava-auth-msg').innerHTML = STRAVA_AUTH_MSG_DEFAULT;
  document.getElementById('strava-diff-view').style.display = 'none';
  document.getElementById('strava-upload-view').style.display = 'none';
  document.getElementById('strava-close-btn').disabled = true;
  document.getElementById('strava-done-files').innerHTML = '';
  document.getElementById('strava-progress-bar').style.width = '';
  document.getElementById('strava-progress-bar').classList.remove('indeterminate');
}

let _stravaAuthListenerAdded = false;

function _onStravaAuthMessage(ev) {
  if (ev.origin !== window.location.origin) return;
  if (ev.data !== 'fafa-strava-auth-ok') return;
  closeStravaModal();
  toast('Strava 授权成功');
}

async function stravaStartAuth() {
  try {
    const res = await fetch('/api/strava/auth_url');
    const d = await res.json();
    if (d.error) { toast('Strava 授权失败：' + d.error); return; }
    if (!_stravaAuthListenerAdded) {
      window.addEventListener('message', _onStravaAuthMessage);
      _stravaAuthListenerAdded = true;
    }
    window.open(d.url, '_blank');
    toast('请在新标签页完成 Strava 授权');
  } catch (e) {
    toast('无法获取授权链接：' + e);
  }
}

async function _stravaCheckStatus() {
  const res = await fetch('/api/strava/status');
  return res.json();
}

function _stravaOpenUploadModal(filenames) {
  openStravaModal();
  document.getElementById('strava-auth-view').style.display = 'none';
  document.getElementById('strava-diff-view').style.display = 'none';
  document.getElementById('strava-upload-view').style.display = '';
  _setStravaUI(`准备上传 ${filenames.length} 个文件...`, 0, filenames.length);
}

async function _stravaStartUpload(filenames) {
  try {
    const res = await fetch('/api/strava/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filenames }),
    });
    if (!res.ok) {
      const d = await res.json();
      toast('上传失败：' + (d.error || res.status));
      closeStravaModal();
      return;
    }
    _stravaPollTimer = setInterval(_pollStravaUpload, 1500);
  } catch (e) {
    toast('上传请求失败：' + e);
    closeStravaModal();
  }
}

async function _stravaUploadSingle(filename) {
  const status = await _stravaCheckStatus();
  if (!status.configured) {
    toast('请先在 config.json 中配置 strava_client_id 和 strava_client_secret');
    return;
  }
  if (!status.has_tokens) { openStravaModal(); return; }
  _stravaOpenUploadModal([filename]);
  await _stravaStartUpload([filename]);
}

let _stravaDiffFilenames = [];

function _stravaShowDiffView() {
  openStravaModal();
  document.getElementById('strava-auth-view').style.display = 'none';
  document.getElementById('strava-diff-view').style.display = '';
  document.getElementById('strava-upload-view').style.display = 'none';
  document.getElementById('strava-diff-msg').textContent = '正在查询 Strava 活动列表...';
  document.getElementById('strava-diff-confirm-btn').disabled = true;
  document.getElementById('strava-diff-confirm-btn').textContent = '开始上传';
}

async function _stravaFetchDiff() {
  _stravaShowDiffView();
  try {
    const res = await fetch('/api/strava/diff');
    const data = await res.json();
    if (data.error) {
      if (data.auth_error) { _stravaPromptReauth(data.error); return; }
      document.getElementById('strava-diff-msg').textContent = '错误：' + data.error;
      return;
    }
    _stravaDiffFilenames = data.to_upload || [];
    document.getElementById('strava-diff-msg').textContent =
      `本地 ${data.local_count} 个，Strava 已有 ${data.match_count} 个，待上传 ${_stravaDiffFilenames.length} 个`;
    const btn = document.getElementById('strava-diff-confirm-btn');
    if (_stravaDiffFilenames.length > 0) {
      btn.textContent = `开始上传 ${_stravaDiffFilenames.length} 个文件`;
      btn.disabled = false;
    } else {
      btn.textContent = '已全部上传';
      btn.disabled = true;
    }
  } catch (e) {
    document.getElementById('strava-diff-msg').textContent = '查询失败：' + e;
  }
}

async function _stravaConfirmDiff() {
  if (!_stravaDiffFilenames.length) return;
  _stravaOpenUploadModal(_stravaDiffFilenames);
  await _stravaStartUpload(_stravaDiffFilenames);
}

async function _stravaUploadAllVisible() {
  const status = await _stravaCheckStatus();
  if (!status.configured) {
    toast('请先在 config.json 中配置 strava_client_id 和 strava_client_secret');
    return;
  }
  if (!status.has_tokens) { openStravaModal(); return; }
  await _stravaFetchDiff();
}

async function _stravaUploadSelected() {
  if (!_actSelected.size) { toast('请先选择活动'); return; }
  const filenames = [..._actSelected];
  const status = await _stravaCheckStatus();
  if (!status.configured) {
    toast('请先在 config.json 中配置 strava_client_id 和 strava_client_secret');
    return;
  }
  if (!status.has_tokens) { openStravaModal(); return; }
  _exitSelectMode();
  _stravaOpenUploadModal(filenames);
  await _stravaStartUpload(filenames);
}

async function _pollStravaUpload() {
  try {
    const res = await fetch('/api/strava/upload/status');
    const data = await res.json();
    if (data.state === 'error' && data.auth_error) {
      clearInterval(_stravaPollTimer);
      _stravaPollTimer = null;
      _stravaPromptReauth(data.error);
      return;
    }
    const pct = data.total > 0 ? Math.round(data.done / data.total * 100) : 0;
    const msg = data.state === 'uploading'
      ? `正在上传: ${data.current || ''}  (${data.done}/${data.total})`
      : data.state === 'done'
        ? `完成: 成功 ${data.success || 0} 个，跳过 ${data.skipped || 0} 个，失败 ${data.failed || 0} 个`
        : data.state === 'error'
          ? `错误: ${data.error || ''}`
          : '';
    _setStravaUI(msg, pct, data.total);

    if (data.state === 'done' || data.state === 'error') {
      clearInterval(_stravaPollTimer);
      _stravaPollTimer = null;
      document.getElementById('strava-close-btn').disabled = false;

      if (data.results && data.results.length) {
        const el = document.getElementById('strava-done-files');
        el.innerHTML = '';
        data.results.forEach(r => {
          const div = document.createElement('div');
          div.className = 'sync-new-file';
          const icon = r.status === 'ok' ? '✓' : r.status === 'skipped' ? '→' : '✗';
          div.textContent = `${icon} ${r.filename}${r.msg ? '  ' + r.msg : ''}`;
          el.appendChild(div);
        });
      }
    }
  } catch {}
}

function _setStravaUI(msg, pct, total) {
  document.getElementById('strava-status-msg').textContent = msg;
  const bar = document.getElementById('strava-progress-bar');
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

async function _loadPmcConfig() {
  try {
    const cfg = await fetch('/api/config/raw').then(r => r.json());
    if (cfg.pmc_ftp     != null) _pmcConfig.ftp    = cfg.pmc_ftp;
    if (cfg.pmc_max_hr  != null) _pmcConfig.maxHr  = cfg.pmc_max_hr;
    if (cfg.pmc_rest_hr != null) _pmcConfig.restHr = cfg.pmc_rest_hr;
    if (cfg.pmc_weight  != null) _pmcConfig.weight = cfg.pmc_weight;
    if (cfg.route_grade_min   != null) _routeScaleCfg.gradeMin   = cfg.route_grade_min;
    if (cfg.route_grade_max   != null) _routeScaleCfg.gradeMax   = cfg.route_grade_max;
    if (cfg.route_speed_max   != null) _routeScaleCfg.speedMax   = cfg.route_speed_max;
    if (cfg.route_cadence_max != null) _routeScaleCfg.cadenceMax = cfg.route_cadence_max;
  } catch {
    _pmcConfig.ftp    = parseInt(localStorage.getItem('pmc_ftp')     || '200', 10);
    _pmcConfig.maxHr  = parseInt(localStorage.getItem('pmc_max_hr')  || '190', 10);
    _pmcConfig.restHr = parseInt(localStorage.getItem('pmc_rest_hr') || '50',  10);
    _pmcConfig.weight = parseFloat(localStorage.getItem('pmc_weight') || '0');
  }
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
      请编辑项目根目录下的 <code>config.json</code>，填入 API Key 后重启服务器。<br><br>
      配置示例：<br>
      <code>{ "api_base": "https://api.openai.com/v1", "api_key": "sk-...", "model": "gpt-4o-mini" }</code>
    </div>`;
    return;
  }

  const body = {
    summary:    t.summary         || {},
    km_stats:   t.kmStats         || [],
    dist_stats: t.distStats       || [],
    time_stats: t.timeStats       || [],
    filename:   t.name            || '',
    start_time: t.timeStatsStart  || '',
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
      _setErrorHtml(result, d.error || '请求失败，请检查 config.json 配置');
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
            _setErrorHtml(result, chunk.error);
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
    _setErrorHtml(result, `网络错误：${e.message}`);
  }
}


function _renderMarkdown(text) {
  if (typeof marked !== 'undefined') {
    return DOMPurify.sanitize(marked.parse(text, { breaks: true, gfm: true }));
  }
  // fallback: plain text with line breaks
  return '<p>' + text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>') + '</p>';
}

function _setErrorHtml(el, message) {
  el.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'ai-error';
  div.textContent = message || '请求失败，请检查 config.json 配置';
  el.appendChild(div);
}

/* ── 训练状态 PMC（界面三） ──────────────────────────────────────────────── */

function _pmcSettings() {
  return {
    ftp:    _pmcConfig.ftp    || 0,
    restHR: _pmcConfig.restHr || 50,
    maxHR:  _pmcConfig.maxHr  || 190,
    weight: _pmcConfig.weight || 0,
  };
}

function _disposePmcChart() {
  if (_pmcChartResizeObserver) {
    _pmcChartResizeObserver.disconnect();
    _pmcChartResizeObserver = null;
  }
  if (_pmcChart) {
    try { _pmcChart.dispose(); } catch {}
    _pmcChart = null;
  }
}

function _disposePmcDailyCharts() {
  for (const ro of _pmcDailyResizeObservers) {
    try { ro.disconnect(); } catch {}
  }
  _pmcDailyResizeObservers = [];
  for (const chart of _pmcDailyCharts) {
    try { chart.dispose(); } catch {}
  }
  _pmcDailyCharts = [];
}

function _disposePmcCurveChart() {
  if (_pmcCurveResizeObserver) {
    _pmcCurveResizeObserver.disconnect();
    _pmcCurveResizeObserver = null;
  }
  if (_pmcCurveChart) {
    try { _pmcCurveChart.dispose(); } catch {}
    _pmcCurveChart = null;
  }
}

function _pmcChartTheme(sourceEl = null) {
  const src = sourceEl || document.querySelector('#pmc-body .pmc-section') || document.body;
  const styles = getComputedStyle(src);
  const cssVar = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  const isDark = !document.body.classList.contains('light-theme');
  return {
    axisColor: cssVar('--pmc-chart-axis-line', isDark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.22)'),
    tickColor: cssVar('--pmc-chart-axis-label', isDark ? '#888' : '#666'),
    gridColor: cssVar('--pmc-chart-grid-line', isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)'),
    mutedColor: cssVar('--pmc-chart-muted-text', isDark ? '#666' : '#777'),
    tooltipBg: isDark ? 'rgba(15,15,20,0.94)' : 'rgba(255,255,255,0.97)',
    tooltipBorder: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)',
    tooltipText: isDark ? '#ddd' : '#333',
    legendColor: isDark ? '#aaa' : '#555',
    strongText: isDark ? '#eee' : '#222',
    dividerColor: isDark ? '#333' : '#ccc',
  };
}

/* ── Settings modal ─────────────────────────────────────────────────────── */
async function openSettingsModal() {
  document.getElementById('settings-modal').style.display = 'flex';
  try {
    const cfg = await fetch('/api/config/raw').then(r => r.json());
    document.getElementById('cfg-pmc-ftp').value           = cfg.pmc_ftp              ?? '';
    document.getElementById('cfg-pmc-rest-hr').value       = cfg.pmc_rest_hr          ?? '';
    document.getElementById('cfg-pmc-max-hr').value        = cfg.pmc_max_hr           ?? '';
    document.getElementById('cfg-pmc-weight').value        = cfg.pmc_weight           ?? '';
    document.getElementById('cfg-route-grade-min').value   = cfg.route_grade_min      ?? '';
    document.getElementById('cfg-route-grade-max').value   = cfg.route_grade_max      ?? '';
    document.getElementById('cfg-route-speed-max').value   = cfg.route_speed_max      ?? '';
    document.getElementById('cfg-route-cadence-max').value = cfg.route_cadence_max    ?? '';
    document.getElementById('cfg-api-base').value      = cfg.api_base             ?? '';
    document.getElementById('cfg-api-key').value       = cfg.api_key              ?? '';
    document.getElementById('cfg-model').value         = cfg.model                ?? '';
    document.getElementById('cfg-max-tokens').value    = cfg.max_tokens           ?? '';
    document.getElementById('cfg-onelap-user').value   = cfg.onelap_username      ?? '';
    document.getElementById('cfg-onelap-pass').value   = cfg.onelap_password      ?? '';
    document.getElementById('cfg-strava-id').value     = cfg.strava_client_id     ?? '';
    document.getElementById('cfg-strava-secret').value = cfg.strava_client_secret ?? '';
    document.getElementById('cfg-strava-port').value   = cfg.strava_redirect_port ?? '';
  } catch { toast('加载配置失败'); }
}

function closeSettingsModal() {
  document.getElementById('settings-modal').style.display = 'none';
}

async function saveSettingsModal() {
  const val = id => document.getElementById(id).value.trim();
  const num = id => { const v = parseFloat(document.getElementById(id).value); return isNaN(v) ? null : v; };
  const cfg = {
    pmc_ftp:              num('cfg-pmc-ftp'),
    pmc_rest_hr:          num('cfg-pmc-rest-hr'),
    pmc_max_hr:           num('cfg-pmc-max-hr'),
    pmc_weight:           num('cfg-pmc-weight'),
    route_grade_min:      num('cfg-route-grade-min'),
    route_grade_max:      num('cfg-route-grade-max'),
    route_speed_max:      num('cfg-route-speed-max'),
    route_cadence_max:    num('cfg-route-cadence-max'),
    api_base:             val('cfg-api-base')      || null,
    api_key:              val('cfg-api-key')       || null,
    model:                val('cfg-model')         || null,
    max_tokens:           num('cfg-max-tokens'),
    onelap_username:      val('cfg-onelap-user')   || null,
    onelap_password:      val('cfg-onelap-pass')   || null,
    strava_client_id:     val('cfg-strava-id')     || null,
    strava_client_secret: val('cfg-strava-secret') || null,
    strava_redirect_port: num('cfg-strava-port'),
  };
  Object.keys(cfg).forEach(k => { if (cfg[k] === null) delete cfg[k]; });
  try {
    const r = await fetch('/api/config/raw', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(cfg) });
    if (!r.ok) throw new Error();
    closeSettingsModal();
    toast('设置已保存');
    _initAiConfig();
    await _loadPmcConfig();
    if (_analyticsOpen && _analyticsTab === 'pmc') {
      _pmcAllData = null;
      _loadAndRenderPmc();
    }
    if (detailTrackId != null) _renderDetailRoute();
  } catch { toast('保存失败'); }
}

/* ── Theme toggle ───────────────────────────────────────────────────────── */
function toggleTheme() {
  const isLight = document.body.classList.toggle('light-theme');
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
  document.getElementById('theme-toggle-icon').textContent = '◑';
  document.getElementById('theme-toggle-label').textContent = isLight ? '浅色' : '深色';
  const tile = isLight ? 'light-nolabels' : 'dark-nolabels';
  document.getElementById('tile-select').value = tile;
  if (map) setTiles(tile);
  if (detailRouteMap && detailRouteTileLayer) {
    detailRouteMap.removeLayer(detailRouteTileLayer);
    const t = TILES[tile];
    detailRouteTileLayer = L.tileLayer(t.url, t.opts).addTo(detailRouteMap);
  }
  if (_analyticsOpen && _analyticsTab === 'pmc' && _pmcAllData) {
    _loadAndRenderPmc();
  }
}

function _initTheme() {
  if (localStorage.getItem('theme') === 'light') {
    document.body.classList.add('light-theme');
    document.getElementById('theme-toggle-icon').textContent = '◑';
    document.getElementById('theme-toggle-label').textContent = '浅色';
    document.getElementById('tile-select').value = 'light-nolabels';
    setTiles('light-nolabels');
  }
}

/* ── 训练分析视图控制器 ────────────────────────────────────────────────────── */

function openAnalyticsView(tab = 'pmc') {
  _analyticsOpen = true;
  _analyticsTab  = tab;
  // 每次打开重置缓存，保证数据新鲜
  _pmcAllData    = null;
  _pmcZonePeriod = 0;
  Object.keys(_pmcDistPeriods).forEach(k => { _pmcDistPeriods[k] = 0; });
  _calActivities = null;
  document.querySelectorAll('#pmc-zone-period-btns .pmc-period-btn').forEach(b => {
    b.classList.toggle('active', Number(b.dataset.zonePeriod) === 0);
  });
  document.querySelectorAll('.pmc-dist-period-group .pmc-period-btn').forEach(b => {
    b.classList.toggle('active', Number(b.dataset.distPeriod) === 0);
  });
  document.getElementById('analytics-view').classList.add('active');
  document.getElementById('analytics-title').textContent = tab === 'calendar' ? '训练日历' : '体能管理';
  // 重置 PMC AI 区
  _doSwitchTab(tab);
}

function closeAnalyticsView(restoreActivities = true) {
  _analyticsOpen = false;
  _pmcLoadSeq++;
  document.getElementById('analytics-view').classList.remove('active');
  _disposePmcChart();
  _disposePmcDailyCharts();
  _disposePmcCurveChart();
  if (restoreActivities && (_sidebarView === 'pmc' || _sidebarView === 'calendar')) {
    _sidebarView = 'activities';
    document.querySelectorAll('.sb-item').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === 'activities');
    });
    document.getElementById('activities-view').classList.add('active');
  }
}

function switchAnalyticsTab(tab) {
  if (tab === _analyticsTab) return;
  _analyticsTab = tab;
  _doSwitchTab(tab);
}

function _doSwitchTab(tab) {
  // Tab 按钮高亮
  document.querySelectorAll('.analytics-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  // 顶栏上下文控件切换
  const isPmc = tab === 'pmc';
  document.getElementById('analytics-cal-controls').style.display = isPmc ? 'none' : '';
  document.getElementById('analytics-cal-ai').style.display       = isPmc ? 'none' : 'flex';
  document.getElementById('analytics-pmc-right').style.display    = isPmc ? '' : 'none';
  document.getElementById('cal-stats-bar').style.display          = isPmc ? 'none' : '';
  // 内容面板切换
  document.getElementById('pmc-body').style.display = isPmc ? '' : 'none';
  document.getElementById('cal-body').style.display = isPmc ? 'none' : '';
  // 加载数据
  if (isPmc) {
    _loadAndRenderPmc();
  } else {
    _pmcLoadSeq++;
    _disposePmcChart();
    _disposePmcDailyCharts();
    _disposePmcCurveChart();
    _calYear  = new Date().getFullYear();
    _calMonth = new Date().getMonth();
    _loadAndRenderCalendar();
  }
}

/* 向后兼容包装器 */
function openPmcView()      { openAnalyticsView('pmc'); }
function closePmcView()     { closeAnalyticsView(); }
function openCalendarView() { openAnalyticsView('calendar'); }
function closeCalendarView() { closeAnalyticsView(); }

async function _loadAndRenderPmc() {
  if (!_analyticsOpen || _analyticsTab !== 'pmc') return;
  const seq = ++_pmcLoadSeq;
  if (_pmcAllData !== null) {
    if (!_analyticsOpen || _analyticsTab !== 'pmc') return;
    const settings = _pmcSettings();
    const filtered = _pmcFilterActivities(_pmcAllData.activities, _pmcZonePeriod);
    _renderPmcCards(_pmcAllData);
    _renderPmcChart(_pmcAllData, _pmcPeriod);
    _renderPmcZones(filtered, settings);
    _renderPmcDist(_pmcAllData.activities, settings);
    _renderPmcDaily(_pmcAllData.activities, settings);
    _renderPmcCurve(_pmcAllData.activities, settings);
    return;
  }
  try {
    const res  = await fetch('/api/activities');
    const data = await res.json();
    if (seq !== _pmcLoadSeq || !_analyticsOpen || _analyticsTab !== 'pmc') return;
    const acts = data.activities || [];
    const settings = _pmcSettings();
    _pmcAllData = _computePMC(acts, settings);
    _pmcAllData.activities = acts;
    const filtered = _pmcFilterActivities(acts, _pmcZonePeriod);
    _renderPmcCards(_pmcAllData);
    _renderPmcChart(_pmcAllData, _pmcPeriod);
    _renderPmcZones(filtered, settings);
    _renderPmcDist(acts, settings);
    _renderPmcDaily(acts, settings);
    _renderPmcCurve(acts, settings);
  } catch (e) {
    console.error('PMC load error:', e);
  }
}

function _computeTSS(summary, settings) {
  if (!summary) return 0;
  const { ftp, restHR, maxHR } = settings;
  const dur_s = summary.moving_time_s || summary.total_duration_s || 0;
  if (dur_s < 60) return 0;

  // 功率 TSS（最准确）
  if (summary.normalized_power && ftp > 0) {
    const np = summary.normalized_power;
    const IF = np / ftp;
    return Math.max(0, Math.round((dur_s * np * IF) / (ftp * 3600) * 100));
  }

  // hrTSS（TRIMP 归一化）
  if (summary.avg_hr && maxHR > restHR) {
    const dur_min = dur_s / 60;
    const hrr = Math.max(0, Math.min(1, (summary.avg_hr - restHR) / (maxHR - restHR)));
    const trimp = dur_min * hrr * 0.64 * Math.exp(1.92 * hrr);
    // 基准：85% HRR 持续1小时 ≈ 100 TSS
    const hrr_ref   = 0.85;
    const trimp_ref = 60 * hrr_ref * 0.64 * Math.exp(1.92 * hrr_ref);
    return Math.max(0, Math.round(trimp / trimp_ref * 100));
  }

  // 距离粗估（最后兜底）
  if (summary.total_dist_km > 0) {
    return Math.max(0, Math.round(summary.total_dist_km * 8 +
      (summary.total_elevation_gain_m || 0) * 0.04));
  }
  return 0;
}

function _computePMC(activities, settings) {
  if (!activities.length) {
    return { days: [], tss: [], ctl: [], atl: [], tsb: [], activities: [] };
  }

  // 每天 TSS 累加
  const tssMap = new Map();
  for (const act of activities) {
    const t = _computeTSS(act.summary, settings);
    tssMap.set(act.date, (tssMap.get(act.date) || 0) + t);
  }

  const kCTL = 1 - Math.exp(-1 / 42);
  const kATL = 1 - Math.exp(-1 / 7);

  const firstDateStr = activities.reduce((min, a) => a.date < min ? a.date : min, activities[0].date);
  const todayStr2    = _pmcLocalDateString(new Date());

  const days = [], tssArr = [], ctlArr = [], atlArr = [], tsbArr = [];
  let ctl = 0, atl = 0;

  let ds = firstDateStr;
  while (ds <= todayStr2) {
    const tss = tssMap.get(ds) || 0;

    // TSB 用昨日的 CTL/ATL 计算
    const tsb = ctl - atl;
    ctl = ctl + (tss - ctl) * kCTL;
    atl = atl + (tss - atl) * kATL;

    days.push(ds);
    tssArr.push(tss);
    ctlArr.push(+ctl.toFixed(1));
    atlArr.push(+atl.toFixed(1));
    tsbArr.push(+tsb.toFixed(1));
    // advance ds by one calendar day using local-date arithmetic
    const next = new Date(ds + 'T00:00:00');
    next.setDate(next.getDate() + 1);
    ds = _pmcLocalDateString(next);
  }

  return { days, tss: tssArr, ctl: ctlArr, atl: atlArr, tsb: tsbArr, activities };
}

function _renderPmcCards(pmc) {
  const container = document.getElementById('pmc-cards-row');
  if (!pmc.days.length) { container.innerHTML = ''; return; }

  const n   = pmc.days.length - 1;
  const ctl = pmc.ctl[n];
  const atl = pmc.atl[n];
  const tsb = pmc.tsb[n];

  const ctl7  = n >= 7  ? pmc.ctl[n - 7]  : 0;
  const ctlΔ  = ctl - ctl7;
  const rampPerWeek = ctlΔ;
  let rampTag = '';
  if (Math.abs(rampPerWeek) < 0.5) {
    rampTag = '';
  } else if (rampPerWeek > 8) {
    rampTag = `<span class="pmc-ramp-tag pmc-ramp-over">+${rampPerWeek.toFixed(1)}/周 ⚠</span>`;
  } else if (rampPerWeek > 4) {
    rampTag = `<span class="pmc-ramp-tag pmc-ramp-warn">+${rampPerWeek.toFixed(1)}/周</span>`;
  } else if (rampPerWeek >= 0) {
    rampTag = `<span class="pmc-ramp-tag pmc-ramp-ok">+${rampPerWeek.toFixed(1)}/周</span>`;
  } else {
    rampTag = `<span class="pmc-ramp-tag pmc-ramp-warn">${rampPerWeek.toFixed(1)}/周</span>`;
  }

  let formText, formColor;
  if      (tsb >  10) { formText = '新鲜';     formColor = '#2ed573'; }
  else if (tsb >  -5) { formText = '最佳状态';  formColor = '#a8e063'; }
  else if (tsb > -20) { formText = '疲劳';      formColor = '#f39c12'; }
  else if (tsb > -40) { formText = '较疲劳';    formColor = '#e67e22'; }
  else                { formText = '过度疲劳';  formColor = '#e74c3c'; }

  const settings = _pmcSettings();
  let wkgCard = '';
  if (settings.weight > 0 && settings.ftp > 0) {
    const wkg = (settings.ftp / settings.weight).toFixed(2);
    wkgCard = `
    <div class="pmc-card pmc-card-wkg">
      <div class="pmc-card-label">功重比</div>
      <div class="pmc-card-value">${wkg}</div>
      <div class="pmc-card-sub">W/kg（FTP ${settings.ftp}W / ${settings.weight}kg）</div>
    </div>`;
  }

  container.innerHTML = `
    <div class="pmc-card pmc-card-ctl">
      <div class="pmc-card-label">体能 · CTL</div>
      <div class="pmc-card-value">${ctl.toFixed(1)}</div>
      <div class="pmc-card-sub">慢性训练负荷（42天）<br>7天变化 ${rampTag || (ctlΔ >= 0 ? '+' : '') + ctlΔ.toFixed(1)}</div>
    </div>
    <div class="pmc-card pmc-card-atl">
      <div class="pmc-card-label">疲劳 · ATL</div>
      <div class="pmc-card-value">${atl.toFixed(1)}</div>
      <div class="pmc-card-sub">急性训练负荷（7天）</div>
    </div>
    <div class="pmc-card pmc-card-tsb">
      <div class="pmc-card-label">状态 · TSB</div>
      <div class="pmc-card-value" style="color:${tsb >= 0 ? '#2ed573' : tsb > -20 ? '#f39c12' : '#e74c3c'}">${tsb >= 0 ? '+' : ''}${tsb.toFixed(1)}</div>
      <div class="pmc-card-sub">今日形态（昨日CTL − 昨日ATL）</div>
    </div>
    <div class="pmc-card pmc-card-form">
      <div class="pmc-card-label">当前形态</div>
      <div class="pmc-card-value" style="color:${formColor}">${formText}</div>
      <div class="pmc-card-sub">共 ${pmc.activities.length} 次骑行记录</div>
    </div>
    ${wkgCard}
  `;
}

function _renderPmcChart(pmc, periodDays) {
  const wrap   = document.getElementById('pmc-chart-wrap');
  const noData = document.getElementById('pmc-no-data');

  if (!pmc.days.length) {
    wrap.style.display   = 'none';
    noData.style.display = '';
    return;
  }
  wrap.style.display   = '';
  noData.style.display = 'none';

  // 截取显示范围
  const total = pmc.days.length;
  const start = periodDays > 0 ? Math.max(0, total - periodDays) : 0;
  const days  = pmc.days.slice(start);
  const tss   = pmc.tss.slice(start);
  const ctl   = pmc.ctl.slice(start);
  const atl   = pmc.atl.slice(start);
  const tsb   = pmc.tsb.slice(start);

  // X 轴标签：根据跨度自适应密度（目标约 15-25 个刻度）
  const targetTicks = days.length > 365 ? 20 : days.length > 90 ? 15 : 12;
  const step = Math.max(1, Math.ceil(days.length / targetTicks));
  const labels = days.map((d, i) => i % step === 0 ? d.slice(5) : '');

  _disposePmcChart();

  const isDark = !document.body.classList.contains('light-theme');
  const tooltipBg     = isDark ? 'rgba(15,15,20,0.94)'      : 'rgba(255,255,255,0.97)';
  const tooltipBorder = isDark ? 'rgba(255,255,255,0.1)'     : 'rgba(0,0,0,0.12)';
  const tooltipTitle  = isDark ? '#888'                      : '#999';
  const tooltipBody   = isDark ? '#ddd'                      : '#333';
  const gridColor     = isDark ? 'rgba(255,255,255,0.04)'    : 'rgba(0,0,0,0.06)';
  const tickColor     = isDark ? '#555'                      : '#999';
  const borderColor   = isDark ? 'rgba(255,255,255,0.08)'    : 'rgba(0,0,0,0.1)';

  const container = document.getElementById('pmc-canvas');
  _pmcChart = echarts.init(container, null, { renderer: 'svg' });

  const tsbColor = v => v > 5 ? '#2ed573' : v > -20 ? '#f39c12' : '#e74c3c';

  _pmcChart.setOption({
    animation: true,
    animationDuration: 800,
    animationEasing: 'cubicOut',
    backgroundColor: 'transparent',
    grid: { top: 32, bottom: 24, left: 42, right: 54, containLabel: false },
    legend: {
      top: 4,
      textStyle: { color: '#888', fontSize: 11 },
      itemWidth: 14, itemHeight: 8,
    },
    xAxis: {
      type: 'category',
      data: days,
      boundaryGap: true,
      axisLine: { lineStyle: { color: borderColor } },
      axisTick: { show: false },
      axisLabel: {
        color: tickColor, fontSize: 10,
        interval: Math.max(0, Math.ceil(days.length / 18) - 1),
        formatter: v => v.slice(5),
      },
      splitLine: { show: false },
    },
    yAxis: [
      {
        type: 'value',
        position: 'left',
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: tickColor, fontSize: 10 },
        splitLine: { lineStyle: { color: gridColor } },
      },
      {
        type: 'value',
        position: 'right',
        min: 0,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: 'rgba(46,134,222,0.6)', fontSize: 10 },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: 'TSS',
        type: 'bar',
        data: tss,
        yAxisIndex: 1,
        barMaxWidth: 4,
        itemStyle: { color: 'rgba(46,134,222,0.3)' },
        z: 1,
      },
      {
        name: 'CTL 体能',
        type: 'line',
        data: ctl,
        yAxisIndex: 0,
        symbol: 'none',
        lineStyle: { color: '#2ed573', width: 2 },
        z: 3,
        markArea: {
          silent: true,
          data: [
            [{ yAxis: 10,  itemStyle: { color: 'rgba(46,213,115,0.04)'  } }, { yAxis: 60  }],
            [{ yAxis: -10, itemStyle: { color: 'rgba(163,224,100,0.03)' } }, { yAxis: 10  }],
            [{ yAxis: -30, itemStyle: { color: 'rgba(243,156,18,0.05)'  } }, { yAxis: -10 }],
            [{ yAxis: -80, itemStyle: { color: 'rgba(231,76,60,0.06)'   } }, { yAxis: -30 }],
          ],
        },
      },
      {
        name: 'ATL 疲劳',
        type: 'line',
        data: atl,
        yAxisIndex: 0,
        symbol: 'none',
        lineStyle: { color: '#e74c3c', width: 2 },
        z: 3,
      },
      {
        name: 'TSB 状态',
        type: 'line',
        data: tsb.map(v => ({ value: v, itemStyle: { color: tsbColor(v) } })),
        yAxisIndex: 0,
        symbol: 'none',
        lineStyle: { width: 2 },
        z: 3,
        visualMap: false,
      },
    ],
    visualMap: {
      show: false,
      type: 'piecewise',
      dimension: 1,
      seriesIndex: 3,
      pieces: [
        { gt: 5,   color: '#2ed573' },
        { gte: -20, lte: 5, color: '#f39c12' },
        { lt: -20, color: '#e74c3c' },
      ],
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line', lineStyle: { color: 'rgba(128,128,160,0.3)', width: 1 } },
      backgroundColor: tooltipBg,
      borderColor: tooltipBorder,
      borderWidth: 1,
      textStyle: { color: tooltipBody, fontSize: 11 },
      formatter: params => {
        const date = `<span style="color:${tooltipTitle}">${params[0]?.axisValue || ''}</span>`;
        const lines = params
          .filter(p => p.seriesName !== 'TSS' || p.value != null)
          .map(p => {
            const v = Number(p.value);
            if (isNaN(v)) return '';
            const sign = v >= 0 ? '+' : '';
            const dot  = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${p.color};margin-right:4px;vertical-align:middle"></span>`;
            return `${dot}${p.seriesName}: ${sign}${v.toFixed(1)}`;
          }).filter(Boolean).join('<br/>');
        return `${date}<br/>${lines}`;
      },
    },
  });

  // ECharts locks the container's inner div to the init-time dimensions.
  // Pass explicit parent dimensions to resize() so ECharts uses the correct size.
  const pmcWrap = document.getElementById('pmc-chart-wrap');
  const _pmcResize = () => {
    if (!_pmcChart) return;
    _pmcChart.resize({ width: pmcWrap.offsetWidth, height: pmcWrap.offsetHeight });
  };
  _pmcChartResizeObserver = new ResizeObserver(_pmcResize);
  _pmcChartResizeObserver.observe(pmcWrap);
  requestAnimationFrame(_pmcResize);
}

/* ── 功率分布（与路线热图 POWER_ZONE_COLORS 对齐，1-indexed = Z1-Z7） ─────── */
// index 0 unused; 1-7 对应 zone_time_s key "1"-"7"（key "0" = 休息/无功率）
const _ZONE_COLORS     = ['', ...POWER_ZONE_COLORS]; // [1]=#888 … [7]=#9b59b6
const _ZONE_NAMES      = ['', 'Z1 恢复', 'Z2 耐力', 'Z3 节奏', 'Z4 阈值', 'Z5 VO₂', 'Z6 无氧', 'Z7 神经'];
// [low%, high%] thresholds — matches _powerZoneColor in route heatmap
const _ZONE_THRESHOLDS = [null, [0, 55], [55, 75], [75, 90], [90, 105], [105, 120], [120, 150], [150, null]];

function _zoneWattLabel(i, ftp) {
  if (!ftp || ftp <= 0) return null;
  const [lo, hi] = _ZONE_THRESHOLDS[i];
  const loW = Math.round(ftp * lo / 100);
  const hiW = hi != null ? Math.round(ftp * hi / 100) : null;
  if (lo === 0) return `<${hiW} W`;
  if (hiW == null) return `>${loW} W`;
  return `${loW}–${hiW} W`;
}

function _pmcLocalDateString(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function _pmcFilterActivities(activities, periodDays) {
  if (!periodDays) return activities;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - periodDays);
  const cutoffStr = _pmcLocalDateString(cutoff);
  return activities.filter(a => (a.date || '') >= cutoffStr);
}

function _applyZonePeriod(days) {
  _pmcZonePeriod = days;
  document.querySelectorAll('#pmc-zone-period-btns .pmc-period-btn').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.zonePeriod) === days);
  });
  if (!_pmcAllData) return;
  const settings = _pmcSettings();
  const filtered = _pmcFilterActivities(_pmcAllData.activities, days);
  _renderPmcZones(filtered, settings);
}

function _applyDistPeriod(distId, days) {
  const cfg = _DIST_CONFIGS.find(c => c.id === distId);
  if (!cfg) return;
  _pmcDistPeriods[cfg.id] = days;
  const group = document.querySelector(`.pmc-dist-period-group[data-dist-id="${distId}"]`);
  group?.querySelectorAll('.pmc-period-btn').forEach(btn => {
    btn.classList.toggle('active', Number(btn.dataset.distPeriod) === days);
  });
  if (!_pmcAllData) return;
  const settings = _pmcSettings();
  const filtered = _pmcFilterActivities(_pmcAllData.activities, days);
  _renderPmcDistOne(cfg, filtered, settings);
}

const _DIST_CONFIGS = [
  {
    id: 'pmc-dist-distance',
    getValue: act => {
      const v = act.summary?.total_dist_km;
      return (v != null && v > 0) ? v : null;
    },
    buckets: [
      { label: '0-5 km',     test: v => v >= 0   && v < 5 },
      { label: '5-10 km',    test: v => v >= 5   && v < 10 },
      { label: '10-20 km',   test: v => v >= 10  && v < 20 },
      { label: '20-50 km',   test: v => v >= 20  && v < 50 },
      { label: '50-100 km',  test: v => v >= 50  && v < 100 },
      { label: '100-200 km', test: v => v >= 100 && v < 200 },
      { label: '200 km+',    test: v => v >= 200 },
    ],
    color: '#5b9bd5',
  },
  {
    id: 'pmc-dist-duration',
    getValue: act => {
      const s = act.summary;
      if (!s) return null;
      const raw = (s.moving_time_s || s.total_duration_s || 0) / 3600;
      return raw > 0 ? raw : null;
    },
    buckets: [
      { label: '0-0.5 h', test: v => v >= 0   && v < 0.5 },
      { label: '0.5-1 h', test: v => v >= 0.5 && v < 1 },
      { label: '1-2 h',   test: v => v >= 1   && v < 2 },
      { label: '2-3 h',   test: v => v >= 2   && v < 3 },
      { label: '3-5 h',   test: v => v >= 3   && v < 5 },
      { label: '5-10 h',  test: v => v >= 5   && v < 10 },
      { label: '10 h+',   test: v => v >= 10 },
    ],
    color: '#70ad47',
  },
  {
    id: 'pmc-dist-elevation',
    getValue: act => {
      const v = act.summary?.total_elevation_gain_m;
      return (v != null && v >= 0) ? v : null;
    },
    buckets: [
      { label: '0-10 m',    test: v => v >= 0   && v < 10 },
      { label: '10-20 m',   test: v => v >= 10  && v < 20 },
      { label: '20-50 m',   test: v => v >= 20  && v < 50 },
      { label: '50-100 m',  test: v => v >= 50  && v < 100 },
      { label: '100-200 m', test: v => v >= 100 && v < 200 },
      { label: '200-500 m', test: v => v >= 200 && v < 500 },
      { label: '500 m+',    test: v => v >= 500 },
    ],
    color: '#f39c12',
  },
  {
    id: 'pmc-dist-tss',
    getValue: (act, settings) => {
      const t = _computeTSS(act.summary, settings);
      return t > 0 ? t : null;
    },
    buckets: [
      { label: '0-10',    test: v => v >= 0   && v < 10 },
      { label: '10-20',   test: v => v >= 10  && v < 20 },
      { label: '20-50',   test: v => v >= 20  && v < 50 },
      { label: '50-100',  test: v => v >= 50  && v < 100 },
      { label: '100-200', test: v => v >= 100 && v < 200 },
      { label: '200-500', test: v => v >= 200 && v < 500 },
      { label: '500+',    test: v => v >= 500 },
    ],
    color: '#9b59b6',
  },
];

const _PMC_PERCENT_GRID = [25, 50, 75, 100];

function _pmcPercentGridHtml() {
  return `<div class="pmc-col-grid" aria-hidden="true">${
    _PMC_PERCENT_GRID.map(p => `
      <div class="pmc-col-grid-line" style="bottom:${p}%">
        <span>${p}%</span>
      </div>`).join('')
  }</div>`;
}

function _renderPmcDistOne(cfg, activities, settings) {
  const BAR_H = 150;
  const wrap = document.getElementById(cfg.id);
  if (!wrap) return;

  const counts = new Array(cfg.buckets.length).fill(0);
  let total = 0;
  for (const act of activities) {
    const v = cfg.getValue(act, settings);
    if (v == null || isNaN(v)) continue;
    for (let i = 0; i < cfg.buckets.length; i++) {
      if (cfg.buckets[i].test(v)) { counts[i]++; break; }
    }
    total++;
  }

  if (total === 0) {
    wrap.innerHTML = '<div style="color:#555;font-size:12px;padding:4px 0">暂无数据</div>';
    return;
  }

  wrap.innerHTML = `<div class="pmc-col-chart pmc-percent-chart">
    ${_pmcPercentGridHtml()}
    ${
    cfg.buckets.map((b, i) => {
      const pctRaw = counts[i] / total * 100;
      const pct = pctRaw.toFixed(1);
      const barPx = pctRaw > 0 ? Math.max(2, Math.round(pctRaw / 100 * BAR_H)) : 0;
      return `
        <div class="pmc-col-item">
          <div class="pmc-col-bar-wrap">
            <span class="pmc-col-val">${pct}%</span>
            <div class="pmc-col-bar" style="height:${barPx}px;background:${cfg.color}"></div>
          </div>
          <span class="pmc-col-label">${b.label}</span>
          <span class="pmc-col-count">${counts[i]}次</span>
        </div>`;
    }).join('')
  }</div>`;
}

function _renderPmcDist(allActivities, settings) {
  for (const cfg of _DIST_CONFIGS) {
    const period = _pmcDistPeriods[cfg.id] || 0;
    const activities = _pmcFilterActivities(allActivities, period);
    _renderPmcDistOne(cfg, activities, settings);
  }
}

function _renderPmcDaily(activities, settings) {
  _disposePmcDailyCharts();

  const days = [];
  const today = new Date();
  const todayStr = _pmcLocalDateString(today);
  // Show current month; if fewer than 14 days into the month, extend window back to cover 30 days
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const dayOfMonth = today.getDate();
  const startDate = dayOfMonth < 14
    ? new Date(today.getFullYear(), today.getMonth(), today.getDate() - 29)
    : firstOfMonth;
  const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  for (let d = new Date(startDate); d <= lastDay; d.setDate(d.getDate() + 1)) {
    days.push(_pmcLocalDateString(d));
  }

  const byDay = {};
  for (const d of days) byDay[d] = { distance: 0, time: 0, elevation: 0, tss: 0, count: 0 };
  for (const act of activities) {
    const d = (act.date || '').slice(0, 10);
    if (!byDay[d]) continue;
    const s = act.summary || {};
    byDay[d].distance  += s.total_dist_km || 0;
    byDay[d].time      += (s.moving_time_s || s.total_duration_s || 0) / 60;
    byDay[d].elevation += s.total_elevation_gain_m || 0;
    byDay[d].tss       += _computeTSS(s, settings);
    byDay[d].count++;
  }

  const cfgs = [
    { id: 'pmc-daily-distance',  key: 'distance',  label: '距离', unit: 'km',  color: '#5b9bd5', fmt: v => v.toFixed(1) + ' km', axisFmt: v => v.toFixed(v >= 10 ? 0 : 1) },
    { id: 'pmc-daily-time',      key: 'time',      label: '时间', unit: 'min', color: '#70ad47', fmt: v => Math.round(v) + ' min', axisFmt: v => Math.round(v) },
    { id: 'pmc-daily-elevation', key: 'elevation', label: '爬升', unit: 'm',   color: '#f39c12', fmt: v => Math.round(v) + ' m', axisFmt: v => Math.round(v) },
    { id: 'pmc-daily-tss',       key: 'tss',       label: 'TSS',  unit: '',    color: '#9b59b6', fmt: v => Math.round(v), axisFmt: v => Math.round(v) },
    { id: 'pmc-daily-count',     key: 'count',     label: '次数', unit: '次',  color: '#e74c3c', fmt: v => v + ' 次', axisFmt: v => Math.round(v), minInterval: 1 },
  ];

  const dailyTheme = _pmcChartTheme();
  for (const cfg of cfgs) {
    const wrap = document.getElementById(cfg.id);
    if (!wrap) continue;

    const data = days.map(d => byDay[d][cfg.key]);
    wrap.innerHTML = '';
    const theme = dailyTheme;

    const chart = echarts.init(wrap, null, { renderer: 'svg' });
    _pmcDailyCharts.push(chart);
    const ro = new ResizeObserver(() => {
      try { chart.resize(); } catch {}
    });
    ro.observe(wrap);
    _pmcDailyResizeObservers.push(ro);

    chart.setOption({
      animation: true,
      animationDuration: 500,
      backgroundColor: 'transparent',
      grid: { top: 14, bottom: 30, left: 8, right: 10, containLabel: true },
      xAxis: {
        type: 'category',
        data: days,
        boundaryGap: true,
        axisLine: { show: true, lineStyle: { color: theme.axisColor } },
        axisTick: { show: true, alignWithLabel: true, lineStyle: { color: theme.axisColor } },
        axisLabel: {
          interval: 0,
          color: theme.tickColor,
          fontSize: 10,
          formatter: value => {
            const day = Number(value.slice(8, 10));
            return (day - 1) % 5 === 0 ? value.slice(5) : '';
          },
        },
        splitLine: {
          show: true,
          interval: 4,
          lineStyle: { color: theme.gridColor },
        },
      },
      yAxis: {
        type: 'value',
        min: 0,
        minInterval: cfg.minInterval || 0,
        name: cfg.unit,
        nameTextStyle: { color: theme.tickColor, fontSize: 10, padding: [0, 0, 0, 4] },
        axisLine: { show: true, lineStyle: { color: theme.axisColor } },
        axisTick: { show: true, lineStyle: { color: theme.axisColor } },
        axisLabel: { color: theme.tickColor, fontSize: 10, formatter: cfg.axisFmt },
        splitLine: { show: true, lineStyle: { color: theme.gridColor } },
      },
      series: [{
        name: cfg.label,
        type: 'bar',
        data: data.map((v, i) => ({
          value: v,
          itemStyle: {
            color: days[i] === todayStr ? '#3a8dde' : cfg.color,
            opacity: v > 0 ? 0.88 : 0.12,
          },
        })),
        barMaxWidth: 12,
      }],
      tooltip: {
        trigger: 'axis',
        backgroundColor: theme.tooltipBg,
        borderColor: theme.tooltipBorder,
        borderWidth: 1,
        textStyle: { color: theme.tooltipText, fontSize: 12 },
        formatter: params => {
          const p = params[0];
          return `${p.axisValue}<br/>${cfg.label}: ${cfg.fmt(Number(p.value || 0))}`;
        },
      },
    });
  }
}

function _renderPmcZones(activities, settings) {
  const BAR_H = 150;
  const wrap = document.getElementById('pmc-zone-bars');
  const note = document.getElementById('pmc-zone-note');
  if (!wrap) return;

  const total = new Array(8).fill(0);
  let count = 0;
  for (const act of activities) {
    const z = act.zone_time_s;
    if (!z) continue;
    for (let i = 1; i <= 7; i++) total[i] += (z[String(i)] || 0);
    count++;
  }
  const pedalS = total.slice(1).reduce((a, b) => a + b, 0);
  if (pedalS === 0) {
    wrap.innerHTML = '<div style="color:#555;font-size:13px;padding:8px 0">暂无功率数据（需要 FIT 文件含功率且设置了 FTP）</div>';
    note.textContent = '';
    return;
  }

  note.textContent = `基于 ${count} 次有功率骑行`;

  const pcts = Array.from({length: 8}, (_, i) => pedalS > 0 ? total[i] / pedalS * 100 : 0);

  wrap.innerHTML = `<div class="pmc-col-chart pmc-percent-chart">
    ${_pmcPercentGridHtml()}
    ${
    Array.from({length: 7}, (_, idx) => {
      const i = idx + 1;
      const pct = pcts[i];
      const barPx = pct > 0 ? Math.max(2, Math.round(pct / 100 * BAR_H)) : 0;
      const mins = Math.round(total[i] / 60);
      return `
        <div class="pmc-col-item">
          <div class="pmc-col-bar-wrap">
            <span class="pmc-col-val">${pct.toFixed(1)}%</span>
            <div class="pmc-col-bar" style="height:${barPx}px;background:${_ZONE_COLORS[i]}"></div>
          </div>
          <span class="pmc-col-label">Z${i}</span>
          <span class="pmc-col-count">${mins}min</span>
        </div>`;
    }).join('')
  }</div>`;
}

/* ── 峰值功率曲线 ─────────────────────────────────────────────────────────── */
const _CURVE_DURATIONS = [
  { key: '5',    label: '5 秒' },
  { key: '60',   label: '1 分钟' },
  { key: '300',  label: '5 分钟' },
  { key: '1200', label: '20 分钟' },
  { key: '3600', label: '60 分钟' },
];

function _renderPmcCurve(activities, settings) {
  const wrap = document.getElementById('pmc-curve-wrap');
  const note = document.getElementById('pmc-curve-note');
  if (!wrap) return;

  const today = new Date();
  const d90 = new Date(today); d90.setDate(d90.getDate() - 90);
  const d30 = new Date(today); d30.setDate(d30.getDate() - 30);
  const d90Str = _pmcLocalDateString(d90);
  const d30Str = _pmcLocalDateString(d30);

  const best = {}, best90 = {}, best30 = {};
  for (const { key } of _CURVE_DURATIONS) { best[key] = 0; best90[key] = 0; best30[key] = 0; }

  for (const act of activities) {
    const pp = act.peak_power;
    if (!pp || !Object.keys(pp).length) continue;
    const actDate = (act.date || '').slice(0, 10);
    const in90 = actDate >= d90Str;
    const in30 = actDate >= d30Str;
    for (const { key } of _CURVE_DURATIONS) {
      const w = pp[key] || 0;
      if (w > best[key])   best[key]   = w;
      if (in90 && w > best90[key]) best90[key] = w;
      if (in30 && w > best30[key]) best30[key] = w;
    }
  }

  const hasAny = Object.values(best).some(v => v > 0);
  if (!hasAny) {
    _disposePmcCurveChart();
    wrap.innerHTML = '<div style="color:#555;font-size:13px;padding:8px 0">暂无功率数据</div>';
    if (note) note.textContent = '';
    return;
  }

  const weight  = settings.weight;
  const showWkg = weight > 0;
  if (note) note.textContent = showWkg ? `体重 ${weight} kg` : '';

  const xVals   = _CURVE_DURATIONS.map(d => Number(d.key));
  const xLabels = { 5: '5s', 60: '1m', 300: '5m', 1200: '20m', 3600: '60m' };

  const makeSeries = (data, name, color, dashed) => ({
    name,
    type: 'line',
    data: xVals.map((x, i) => [x, data[_CURVE_DURATIONS[i].key] || null]),
    lineStyle: { color, width: dashed ? 1.5 : 2, type: dashed ? 'dashed' : 'solid' },
    itemStyle: { color },
    symbol: 'circle',
    symbolSize: 5,
    connectNulls: false,
  });

  _disposePmcCurveChart();

  wrap.innerHTML = '<div id="pmc-curve-chart" style="height:220px"></div>'
    + '<div id="pmc-curve-summary" style="margin-top:8px;font-size:12px;color:#888;display:flex;flex-wrap:wrap;gap:8px 16px"></div>';

  const curveEl = document.getElementById('pmc-curve-chart');
  const theme = _pmcChartTheme(curveEl.closest('.pmc-section'));
  _pmcCurveChart = echarts.init(curveEl, null, { renderer: 'svg' });
  _pmcCurveResizeObserver = new ResizeObserver(() => _pmcCurveChart?.resize());
  _pmcCurveResizeObserver.observe(curveEl);

  _pmcCurveChart.setOption({
    backgroundColor: 'transparent',
    legend: { top: 4, right: 8, textStyle: { color: theme.legendColor, fontSize: 11 } },
    grid:   { top: 36, bottom: 36, left: 52, right: 16 },
    xAxis: {
      type: 'log',
      min: 4,
      max: 4000,
      axisLabel: {
        color: theme.tickColor,
        fontSize: 11,
        formatter: v => xLabels[v] || '',
      },
      axisLine: { show: true, lineStyle: { color: theme.axisColor } },
      axisTick: { show: true, lineStyle: { color: theme.axisColor } },
      splitLine: { show: true, lineStyle: { color: theme.gridColor } },
    },
    yAxis: {
      type: 'value',
      name: 'W',
      nameTextStyle: { color: theme.tickColor, fontSize: 11 },
      axisLine: { show: true, lineStyle: { color: theme.axisColor } },
      axisTick: { show: true, lineStyle: { color: theme.axisColor } },
      axisLabel: { color: theme.tickColor, fontSize: 11 },
      splitLine: { show: true, lineStyle: { color: theme.gridColor } },
      min: 0,
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: theme.tooltipBg,
      borderColor: theme.tooltipBorder,
      borderWidth: 1,
      textStyle: { color: theme.tooltipText, fontSize: 12 },
      formatter: params => {
        const x     = params[0]?.axisValue;
        const label = xLabels[Math.round(Number(x))] || `${x}s`;
        const lines = [`<b>${label}</b>`];
        for (const p of params) {
          if (p.value[1] == null || p.value[1] === 0) continue;
          const w      = p.value[1];
          const wkgStr = showWkg ? ` (${(w / weight).toFixed(2)} W/kg)` : '';
          lines.push(`${p.marker}${p.seriesName}：${w} W${wkgStr}`);
        }
        return lines.join('<br/>');
      },
    },
    series: [
      makeSeries(best,   '历史最佳', '#5b9bd5', false),
      makeSeries(best90, '近90天',   '#70ad47', true),
      makeSeries(best30, '近30天',   '#f39c12', true),
    ],
  });

  const summaryEl = document.getElementById('pmc-curve-summary');
  if (summaryEl) {
    summaryEl.style.color = theme.tickColor;
    summaryEl.innerHTML = _CURVE_DURATIONS
      .filter(({ key }) => best[key] > 0)
      .map(({ key, label }) => {
        const w      = best[key];
        const wkgStr = showWkg ? ` · ${(w / weight).toFixed(2)} W/kg` : '';
        return `<span>${label}：<b style="color:${theme.strongText}">${w} W</b>${wkgStr}</span>`;
      }).join(`<span style="color:${theme.dividerColor};margin:0 4px">｜</span>`);
  }
}

/* ── 共享 AI 弹窗 helper ───────────────────────────────────────────────────── */
async function _openAndStreamModal(title, summaryHtml, fetchFn) {
  const summaryEl = document.getElementById('act-ai-modal-summary');
  document.getElementById('act-ai-modal-title').textContent = title;
  document.getElementById('act-ai-modal-result').innerHTML  = '';
  document.getElementById('act-ai-modal-loading').style.display = 'none';
  if (summaryHtml) {
    summaryEl.innerHTML    = summaryHtml;
    summaryEl.style.display = '';
  } else {
    summaryEl.innerHTML    = '';
    summaryEl.style.display = 'none';
  }
  document.getElementById('act-ai-modal').style.display = 'flex';

  const loading  = document.getElementById('act-ai-modal-loading');
  const resultEl = document.getElementById('act-ai-modal-result');
  loading.style.display = 'flex';

  try {
    const res = await fetchFn();
    loading.style.display = 'none';
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      _setErrorHtml(resultEl, d.error || '请求失败，请检查 config.json 配置');
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', fullText = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const ds = line.slice(6).trim();
        if (ds === '[DONE]') break;
        try {
          const chunk = JSON.parse(ds);
          if (chunk.error) { _setErrorHtml(resultEl, chunk.error); return; }
          if (chunk.text)  { fullText += chunk.text; resultEl.innerHTML = _renderMarkdown(fullText); }
        } catch {}
      }
    }
  } catch (e) {
    loading.style.display = 'none';
    _setErrorHtml(resultEl, `网络错误：${e.message}`);
  }
}

function closeActAiModal() {
  document.getElementById('act-ai-modal').style.display = 'none';
}

/* ── 活动列表单条 AI 分析 ──────────────────────────────────────────────────── */
async function openActAiModal(act) {
  if (!_aiModel) { toast('AI 未配置，请先编辑 config.json'); return; }
  const chips = _statChips(act.summary || {});
  let kmStats = [];
  try {
    const lr = await fetch('/api/load', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: act.filename }) });
    if (lr.ok) { const ld = await lr.json(); kmStats = ld.km_stats || []; }
  } catch {}
  await _openAndStreamModal(
    (act.filename || '').replace(/\.fit$/i, ''),
    chips.map(c => `<span class="stat-chip">${c}</span>`).join(''),
    () => fetch('/api/ai/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ summary: act.summary || {}, km_stats: kmStats, filename: act.filename || '', start_time: act.start_time || '' }) })
  );
}

/* ── 训练日历 AI 建议 ──────────────────────────────────────────────────────── */
async function startCalendarAi(period) {
  if (!_aiModel) { toast('AI 未配置，请先编辑 config.json'); return; }
  const acts    = _calActivities || [];
  const now     = new Date();
  const cutoff  = new Date(now);
  if (period === '7d') cutoff.setDate(cutoff.getDate() - 7);
  else                 cutoff.setDate(cutoff.getDate() - 30);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  const filtered  = acts.filter(a => a.date >= cutoffStr);
  const label     = period === '7d' ? 'AI 建议 · 过去一周' : 'AI 建议 · 过去一个月';
  await _openAndStreamModal(label, null, () => fetch('/api/ai/calendar', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      period,
      current_date: now.toISOString().slice(0, 10),
      activities: filtered.map(a => ({
        date: a.date,
        dist_km:     a.summary?.total_dist_km,
        dur_min:     Math.round(((a.summary?.moving_time_s || a.summary?.total_duration_s || 0) / 60)),
        avg_hr:      a.summary?.avg_hr,
        avg_power:   a.summary?.avg_power,
        elevation_m: a.summary?.total_elevation_gain_m,
      })),
    }),
  }));
}

async function startPmcAi() {
  if (!_pmcAllData || !_pmcAllData.days.length) {
    toast('暂无骑行数据，无法进行 AI 分析');
    return;
  }
  if (!_aiModel) {
    toast('AI 未配置，请先编辑 config.json');
    return;
  }

  const n = _pmcAllData.days.length - 1;
  const settings = _pmcSettings();

  // 构建发送给 AI 的数据
  const recentActs = _pmcAllData.activities.slice(-14).map(a => ({
    date:      a.date,
    dist_km:   a.summary?.total_dist_km,
    dur_min:   Math.round((a.summary?.moving_time_s || a.summary?.total_duration_s || 0) / 60),
    tss:       _computeTSS(a.summary || {}, settings),
    avg_hr:    a.summary?.avg_hr,
    avg_power: a.summary?.avg_power,
  }));

  // Compute zone totals for AI context
  const zoneTotals = new Array(8).fill(0);
  let zonePedalS = 0;
  for (const act of _pmcAllData.activities) {
    const z = act.zone_time_s;
    if (!z) continue;
    for (let i = 1; i <= 7; i++) zoneTotals[i] += (z[String(i)] || 0);
  }
  zonePedalS = zoneTotals.slice(1).reduce((a, b) => a + b, 0);
  const zoneDistStr = zonePedalS > 0
    ? ['Z1', 'Z2', 'Z3', 'Z4', 'Z5', 'Z6', 'Z7'].map((z, i) => {
        const pct = (zoneTotals[i + 1] / zonePedalS * 100).toFixed(1);
        return `${z}:${pct}%`;
      }).join(' ')
    : null;

  // Power curve bests
  const today = new Date();
  const d90 = new Date(today); d90.setDate(d90.getDate() - 90);
  const curveBest = {}, curveBest90 = {};
  for (const { key } of _CURVE_DURATIONS) { curveBest[key] = 0; curveBest90[key] = 0; }
  for (const act of _pmcAllData.activities) {
    const pp = act.peak_power || {};
    const in90 = new Date(act.date) >= d90;
    for (const { key } of _CURVE_DURATIONS) {
      const w = pp[key] || 0;
      if (w > curveBest[key]) curveBest[key] = w;
      if (in90 && w > curveBest90[key]) curveBest90[key] = w;
    }
  }
  const curveStr = _CURVE_DURATIONS
    .filter(({ key }) => curveBest[key] > 0)
    .map(({ key, label }) => `${label}:${curveBest[key]}W`)
    .join(' / ');
  const curve90Str = _CURVE_DURATIONS
    .filter(({ key }) => curveBest90[key] > 0)
    .map(({ key, label }) => `${label}:${curveBest90[key]}W`)
    .join(' / ');

  const body = {
    current: { ctl: _pmcAllData.ctl[n], atl: _pmcAllData.atl[n], tsb: _pmcAllData.tsb[n] },
    trend: {
      ctl_7d_ago:  n >= 7  ? _pmcAllData.ctl[n - 7]  : 0,
      ctl_30d_ago: n >= 30 ? _pmcAllData.ctl[n - 30] : 0,
    },
    recent_rides:     recentActs,
    settings: {
      ftp: settings.ftp || null,
      rest_hr: settings.restHR,
      max_hr: settings.maxHR,
      weight_kg: settings.weight || null,
      wkg: (settings.ftp && settings.weight) ? +(settings.ftp / settings.weight).toFixed(2) : null,
    },
    zone_distribution: zoneDistStr,
    power_curve_alltime: curveStr || null,
    power_curve_90d:     curve90Str || null,
    total_activities: _pmcAllData.activities.length,
    first_date:       _pmcAllData.activities[0]?.date || '',
  };

  await _openAndStreamModal('体能管理 · AI 评估', null, () => fetch('/api/ai/pmc', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
}

/* ── 训练日历 ────────────────────────────────────────────────────────────── */

function toggleCalAiMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById('cal-ai-menu');
  const open = menu.style.display === 'none';
  menu.style.display = open ? '' : 'none';
  if (open) {
    const close = () => { menu.style.display = 'none'; document.removeEventListener('click', close); };
    document.addEventListener('click', close);
  }
}

function selectCalAi(period) {
  document.getElementById('cal-ai-menu').style.display = 'none';
  startCalendarAi(period);
}

function calNavMonth(delta) {
  _calMonth += delta;
  if (_calMonth > 11) { _calMonth = 0; _calYear++; }
  if (_calMonth < 0)  { _calMonth = 11; _calYear--; }
  if (_calActivities !== null) _renderCalendarMonth(_calYear, _calMonth, _calActivities);
}

function calGoToday() {
  const now = new Date();
  _calYear  = now.getFullYear();
  _calMonth = now.getMonth();
  if (_calActivities !== null) _renderCalendarMonth(_calYear, _calMonth, _calActivities);
}

async function _loadAndRenderCalendar() {
  if (_calActivities !== null) {
    _renderCalendarMonth(_calYear, _calMonth, _calActivities);
    return;
  }
  try {
    const res = await fetch('/api/activities');
    const data = await res.json();
    _calActivities = data.activities || [];
  } catch (e) {
    console.error('Calendar load error:', e);
    _calActivities = [];
  }
  _renderCalendarMonth(_calYear, _calMonth, _calActivities);
}

function _calTssColor(tss) {
  if (tss <= 0)   return '#555';
  if (tss < 50)   return '#4a9eff';
  if (tss < 100)  return '#2ed573';
  if (tss < 150)  return '#f39c12';
  return '#e74c3c';
}

function _calFmtDur(secs) {
  if (!secs) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h ? `${h}h${m}m` : `${m}m`;
}

function _renderCalendarMonth(year, month, activities) {
  document.getElementById('cal-month-label').textContent = `${year}年${month + 1}月`;

  const monthStr  = `${year}-${String(month + 1).padStart(2, '0')}`;
  const settings  = typeof _pmcSettings === 'function' ? _pmcSettings()
                    : { ftp: 0, restHR: 50, maxHR: 190, weight: 0 };

  const actByDate = new Map();
  for (const act of activities) {
    const d = act.date;
    if (!actByDate.has(d)) actByDate.set(d, []);
    actByDate.get(d).push(act);
  }

  let mRides = 0, mKm = 0, mTSS = 0, mSecs = 0;
  for (const [date, acts] of actByDate) {
    if (!date.startsWith(monthStr)) continue;
    for (const a of acts) {
      mRides++;
      mKm   += a.summary?.total_dist_km || 0;
      mTSS  += _computeTSS(a.summary, settings);
      mSecs += a.summary?.moving_time_s || a.summary?.total_duration_s || 0;
    }
  }

  const durH = Math.floor(mSecs / 3600), durM = Math.floor((mSecs % 3600) / 60);
  const stats = [
    { val: mRides > 0 ? `${mRides}` : '—',                                     lbl: '次数' },
    { val: mKm    > 0 ? `${mKm.toFixed(0)} km` : '—',                          lbl: '里程' },
    { val: mSecs  > 0 ? (durH ? `${durH}h ${durM}m` : `${durM}m`) : '—',       lbl: '时间' },
    { val: mTSS   > 0 ? `${Math.round(mTSS)}` : '—',                           lbl: 'TSS'  },
  ];
  document.getElementById('cal-month-stats').innerHTML =
    stats.map(s => `<div class="cal-sstat"><span class="cal-sstat-val">${s.val}</span><span class="cal-sstat-lbl">${s.lbl}</span></div>`).join('');

  const firstDOW    = new Date(year, month, 1).getDay();
  const startOffset = (firstDOW + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalRows   = Math.ceil((startOffset + daysInMonth) / 7);
  const todayStr    = new Date().toISOString().slice(0, 10);
  const prevMoLen   = new Date(year, month, 0).getDate();

  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';

  for (let row = 0; row < totalRows; row++) {
    let weekKm = 0, weekTSS = 0, weekSecs = 0;

    for (let col = 0; col < 7; col++) {
      const cellIndex = row * 7 + col;
      const dayNum    = cellIndex - startOffset + 1;
      const cell      = document.createElement('div');
      cell.className  = 'cal-day';

      if (dayNum < 1 || dayNum > daysInMonth) {
        cell.classList.add('cal-day-other');
        const n = dayNum < 1 ? prevMoLen + dayNum : dayNum - daysInMonth;
        cell.innerHTML = `<div class="cal-day-head"><span class="cal-day-num">${n}</span></div>`;
      } else {
        const dateStr   = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
        const isToday   = dateStr === todayStr;
        const isWeekend = col >= 5;

        if (isToday)   cell.classList.add('cal-day-today');
        if (isWeekend) cell.classList.add('cal-day-weekend');

        const numEl = isToday
          ? `<span class="cal-day-num cal-day-num-today">${dayNum}</span>`
          : `<span class="cal-day-num cal-day-num-active">${dayNum}</span>`;
        cell.innerHTML = `<div class="cal-day-head">${numEl}</div><div class="cal-day-chips"></div>`;

        const chipsWrap = cell.querySelector('.cal-day-chips');
        for (const act of actByDate.get(dateStr) || []) {
          const tss    = _computeTSS(act.summary, settings);
          const durS   = act.summary?.moving_time_s || act.summary?.total_duration_s || 0;
          weekKm   += act.summary?.total_dist_km || 0;
          weekTSS  += tss;
          weekSecs += durS;

          const km     = act.summary?.total_dist_km != null
                         ? act.summary.total_dist_km.toFixed(1) : '—';
          const durStr = _calFmtDur(durS);
          const elev   = act.summary?.total_elevation_gain_m != null
                         ? Math.round(act.summary.total_elevation_gain_m) : null;
          const color  = _calTssColor(tss);
          const barPct = Math.min(100, tss > 0 ? (tss / 200) * 100 : 0).toFixed(0);
          const tags   = act.tags || [];
          const tagDots = tags.length > 0
            ? `<div class="cal-act-tag-dots">${tags.slice(0, 4).map(t =>
                `<span class="cal-act-tag-dot" style="background:${t.color}" title="${t.name}"></span>`
              ).join('')}</div>`
            : '';

          const chip = document.createElement('div');
          chip.className = 'cal-activity-chip';
          chip.style.borderTopColor = color;
          chip.innerHTML = `
            <div class="cal-tss-bar-track">
              <div class="cal-tss-bar-fill" style="width:${barPct}%;background:${color}"></div>
            </div>
            <div class="cal-act-main">
              <span class="cal-act-km">${km} km</span>
              ${durStr ? `<span class="cal-act-dur">${durStr}</span>` : ''}
            </div>
            ${elev != null ? `<span class="cal-act-elev">↑${elev}m</span>` : ''}
            ${tss > 0 ? `<span class="cal-act-tss" style="color:${color}">TSS ${tss}</span>` : ''}
            ${tagDots}
          `;
          chip.addEventListener('click', () => _calOpenActivityModal(act, tss));
          chipsWrap.appendChild(chip);
        }
      }
      grid.appendChild(cell);
    }

    const totalCell = document.createElement('div');
    totalCell.className = 'cal-week-total';
    if (weekKm > 0 || weekTSS > 0 || weekSecs > 0) {
      const wh = Math.floor(weekSecs / 3600), wm = Math.floor((weekSecs % 3600) / 60);
      const wDurStr = weekSecs > 0 ? (wh ? `${wh}h${wm}m` : `${wm}m`) : '';
      totalCell.innerHTML = `
        ${weekKm   > 0 ? `<span class="cal-week-km">${weekKm.toFixed(0)} km</span>` : ''}
        ${wDurStr       ? `<span class="cal-week-dur">${wDurStr}</span>` : ''}
        ${weekTSS  > 0 ? `<span class="cal-week-tss">TSS ${Math.round(weekTSS)}</span>` : ''}
      `;
    }
    grid.appendChild(totalCell);
  }

  _renderCalSidePanel(year, month, activities, settings);
}

function _renderCalSidePanel(year, month, activities, settings) {
  const panel = document.getElementById('cal-side-panel');
  if (!panel) return;

  const pad   = n => String(n).padStart(2, '0');
  const monthStr = `${year}-${pad(month + 1)}`;
  const lastDate = new Date(year, month - 1, 1);
  const lastMonthStr = `${lastDate.getFullYear()}-${pad(lastDate.getMonth() + 1)}`;
  const todayStr = new Date().toISOString().slice(0, 10);

  function monthAgg(mStr) {
    let rides = 0, km = 0, secs = 0, elev = 0, tss = 0;
    for (const a of activities) {
      if (!a.date.startsWith(mStr)) continue;
      rides++;
      km   += a.summary?.total_dist_km || 0;
      secs += a.summary?.moving_time_s || a.summary?.total_duration_s || 0;
      elev += a.summary?.total_elevation_gain_m || 0;
      tss  += _computeTSS(a.summary, settings);
    }
    return { rides, km, secs, elev, tss };
  }

  const cur  = monthAgg(monthStr);
  const prev = monthAgg(lastMonthStr);

  // streak — consecutive ride days ending at today
  const rideDays = new Set(activities.map(a => a.date));
  let streak = 0;
  const d = new Date(todayStr);
  while (rideDays.has(d.toISOString().slice(0, 10))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }

  // month bests
  let bestKm = null, bestElev = null, bestTss = null;
  for (const a of activities) {
    if (!a.date.startsWith(monthStr)) continue;
    const t   = _computeTSS(a.summary, settings);
    const km  = a.summary?.total_dist_km || 0;
    const elv = a.summary?.total_elevation_gain_m || 0;
    if (!bestKm   || km  > bestKm.val)   bestKm   = { val: km,  date: a.date, act: a };
    if (!bestElev || elv > bestElev.val) bestElev = { val: elv, date: a.date, act: a };
    if (!bestTss  || t   > bestTss.val)  bestTss  = { val: t,   date: a.date, act: a };
  }

  function delta(cur, prev) {
    if (!prev || prev === 0) return null;
    return ((cur - prev) / prev) * 100;
  }
  function deltaHtml(pct) {
    if (pct === null) return `<span class="cal-sp-cmp-delta cal-sp-delta-flat">—</span>`;
    const sign = pct >= 0 ? '+' : '';
    const cls  = pct > 2 ? 'cal-sp-delta-up' : pct < -2 ? 'cal-sp-delta-down' : 'cal-sp-delta-flat';
    return `<span class="cal-sp-cmp-delta ${cls}">${sign}${Math.round(pct)}%</span>`;
  }
  function fmtSecs(s) {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return h ? `${h}h${m}m` : `${m}m`;
  }

  const cmpRows = [
    { label: '次数', cur: cur.rides,              prev: prev.rides,              fmt: v => `${v}` },
    { label: '里程', cur: Math.round(cur.km),     prev: Math.round(prev.km),     fmt: v => `${v} km` },
    { label: '时间', cur: cur.secs,               prev: prev.secs,               fmt: v => fmtSecs(v) },
    { label: 'TSS',  cur: Math.round(cur.tss),    prev: Math.round(prev.tss),    fmt: v => `${v}` },
  ];

  const streakHtml = `
    <div class="cal-sp-section">
      <div class="cal-sp-title">连续骑行</div>
      <div class="cal-sp-streak">
        <span class="cal-sp-streak-num">${streak}</span>
        <span class="cal-sp-streak-unit">天</span>
      </div>
      <div class="cal-sp-streak-sub">${streak > 0 ? '保持节奏，继续骑' : '今天还没骑，出发吧'}</div>
    </div>
  `;

  const cmpHtml = `
    <div class="cal-sp-section">
      <div class="cal-sp-title">本月 vs 上月</div>
      ${cmpRows.map(r => `
        <div class="cal-sp-cmp-row">
          <span class="cal-sp-cmp-label">${r.label}</span>
          <span class="cal-sp-cmp-val">${r.cur > 0 ? r.fmt(r.cur) : '—'}</span>
          ${deltaHtml(delta(r.cur, r.prev))}
        </div>
      `).join('')}
    </div>
  `;

  function bestRow(icon, label, item, fmt) {
    if (!item) return '';
    return `
      <div class="cal-sp-best-item" data-filename="${item.act.filename}">
        <span class="cal-sp-best-icon">${icon}</span>
        <span class="cal-sp-best-label">${label}</span>
        <div style="text-align:right">
          <div class="cal-sp-best-val">${fmt(item.val)}</div>
          <div class="cal-sp-best-date">${item.date.slice(5)}</div>
        </div>
      </div>
    `;
  }

  const bestsHtml = `
    <div class="cal-sp-section">
      <div class="cal-sp-title">本月最佳</div>
      ${bestRow('🛣', '最长',   bestKm,   v => `${v.toFixed(1)} km`)}
      ${bestRow('⛰', '最大爬升', bestElev, v => `${Math.round(v)} m`)}
      ${bestRow('⚡', '最高TSS', bestTss,  v => `TSS ${v}`)}
    </div>
  `;

  panel.innerHTML = streakHtml + cmpHtml + bestsHtml;

  panel.querySelectorAll('.cal-sp-best-item[data-filename]').forEach(el => {
    el.addEventListener('click', () => {
      const act = activities.find(a => a.filename === el.dataset.filename);
      if (act) _calOpenActivityModal(act, _computeTSS(act.summary, settings));
    });
  });
}

function _calOpenActivityModal(act, tss) {
  const s = act.summary || {};

  document.getElementById('cal-act-modal-header').innerHTML = `
    <div class="cal-act-modal-date">${act.date}</div>
    <div class="cal-act-modal-file">${act.filename}</div>
  `;

  const durS = s.moving_time_s || s.total_duration_s || 0;
  const h = Math.floor(durS / 3600), m = Math.floor((durS % 3600) / 60);
  const durStr = durS > 0 ? (h ? `${h}h ${m}m` : `${m} min`) : null;

  const items = [
    ['距离',    s.total_dist_km != null ? `${s.total_dist_km.toFixed(2)} km` : null],
    ['时长',    durStr],
    ['爬升',    s.total_elevation_gain_m != null ? `${Math.round(s.total_elevation_gain_m)} m` : null],
    ['均速',    s.avg_speed_kmh != null ? `${s.avg_speed_kmh.toFixed(1)} km/h` : null],
    ['均心率',  s.avg_hr != null ? `${Math.round(s.avg_hr)} bpm` : null],
    ['最大心率', s.max_hr != null ? `${s.max_hr} bpm` : null],
    ['均功率',  s.avg_power != null ? `${Math.round(s.avg_power)} W` : null],
    ['NP',     s.normalized_power != null ? `${Math.round(s.normalized_power)} W` : null],
    ['TSS',    tss > 0 ? String(tss) : null],
    ['卡路里',  s.total_calories_kcal != null ? `${s.total_calories_kcal} kcal` : null],
  ].filter(([, v]) => v !== null);

  document.getElementById('cal-act-modal-stats').innerHTML = items
    .map(([k, v]) => `
      <div class="cal-act-stat-item">
        <span class="cal-act-stat-label">${k}</span>
        <span class="cal-act-stat-value">${v}</span>
      </div>
    `).join('');

  document.getElementById('cal-modal-detail-btn').onclick =
    () => _calLoadAndOpenDetail(act.filename);

  document.getElementById('cal-act-modal').classList.add('active');
}

function calCloseActivityModal() {
  document.getElementById('cal-act-modal').classList.remove('active');
}

async function _calLoadAndOpenDetail(filename) {
  calCloseActivityModal();
  try {
    const res = await fetch('/api/load', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename }),
    });
    const data = await res.json();
    if (data.error) { toast(data.error); return; }
    closeCalendarView();
    const id = addTrack({ ...data, source: 'library' });
    if (id != null) openDetailView(id);
  } catch (e) {
    toast('加载失败：' + e.message);
  }
}
