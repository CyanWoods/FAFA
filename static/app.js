/* ── ECharts: inject locally if not already loaded from template ─────────── */
if (typeof echarts === 'undefined') {
  const _es = document.createElement('script');
  _es.src = '/static/echarts.min.js';
  document.head.appendChild(_es);
}

/* ── Tile configs ────────────────────────────────────────────────────────── */
const _CARTO_OPTS = {
  subdomains: ['a', 'b', 'c', 'd'], maxZoom: 19, attribution: '&copy; CARTO',
  crossOrigin: 'anonymous',
  tileSize: 512, zoomOffset: -1,
  keepBuffer: 4, updateWhenZooming: false,
};
const TILES = {
  amap: {
    label: '高德地图', provider: 'amap',
    url: 'https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}',
    opts: { subdomains: '1234', maxZoom: 19, attribution: '&copy; 高德地图', keepBuffer: 4, updateWhenZooming: false },
    probeUrl: 'https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x=13&y=6&z=4',
  },
  'dark-nolabels': {
    label: '深色路网', provider: 'carto',
    url: 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png',
    opts: _CARTO_OPTS,
  },
  'light-nolabels': {
    label: '浅色路网', provider: 'carto',
    url: 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}@2x.png',
    opts: _CARTO_OPTS,
  },
  dark: {
    label: '深色地图', provider: 'carto',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
    opts: _CARTO_OPTS,
  },
  light: {
    label: '浅色地图', provider: 'carto',
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
  { key: 'speed',        label: '速度',     field: 'avg_speed_kmh',   rField: 'speed_kmh',   unit: 'km/h', color: '#2e86de' },
  { key: 'hr',           label: '心率',     field: 'avg_hr',          rField: 'hr',          unit: 'bpm',  color: '#e74c3c' },
  { key: 'power',        label: '功率',     field: 'avg_power',       rField: 'power',       unit: 'W',    color: '#f39c12' },
  { key: 'cadence',      label: '踏频',     field: 'avg_cadence',     rField: 'cadence',     unit: 'rpm',  color: '#9b59b6' },
  { key: 'altitude',     label: '海拔',     field: 'end_alt_m',       rField: 'altitude',    unit: 'm',    color: '#2ecc71' },
  { key: 'grade',        label: '坡度',     field: 'avg_grade_pct',   rField: 'grade',       unit: '%',    color: '#1abc9c' },
  { key: 'temperature',  label: '气温',     field: 'avg_temp_c',      rField: 'temp_c',      unit: '°C',   color: '#e67e22' },
  { key: 'torque_eff',   label: '踏板效率', field: 'avg_torque_eff',  unit: '%',    color: '#3498db', noRoute: true,
    series: [{ label: '左', rField: 'left_torque_eff', color: '#3498db' }, { label: '右', rField: 'right_torque_eff', color: '#e74c3c' }] },
  { key: 'pedal_smooth', label: '踏板流畅', field: 'avg_pedal_smooth', unit: '%',    color: '#3498db', noRoute: true,
    series: [{ label: '左', rField: 'left_pedal_smooth', color: '#3498db' }, { label: '右', rField: 'right_pedal_smooth', color: '#e74c3c' }] },
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
  { key: 'left_pct',         label: '左右平衡', fmt: v => `L ${v.toFixed(0)}% / R ${(100 - v).toFixed(0)}%` },
  { key: 'avg_torque_eff',   label: '踏板效率', fmt: v => v.toFixed(1) + '%' },
  { key: 'avg_pedal_smooth', label: '踏板流畅', fmt: v => v.toFixed(1) + '%' },
];

/* ── Export constants ────────────────────────────────────────────────────── */
const EXPORT_TILE_URLS = {
  dark:             'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  'dark-nolabels':  'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}.png',
  light:            'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
  'light-nolabels': 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png',
};

const EXPORT_RESOLUTIONS = {
  '4K':    { '16:9': [3840, 2160], '4:3': [2880, 2160], '3:4': [2160, 2880] },
  '2K':    { '16:9': [2560, 1440], '4:3': [1920, 1440], '3:4': [1440, 1920] },
  '1080P': { '16:9': [1920, 1080], '4:3': [1440, 1080], '3:4': [1080, 1440] },
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
let _tileLayerLoadToken = 0;
let _detailTileLayerLoadToken = 0;
const tracks = new Map();
let trackCounter = 0;
const exportState = { tile: 'dark-nolabels', colorMode: 'heatmap', uniformColor: '#e74c3c', ratio: '16:9', resolution: '2K', watermark: false, username: '', groupThreshold: 500 };
let panelExpanded = false;
let panelExpandedHeight = 320;
let detailTrackId = null;
let detailMetric = 'speed';
let detailCharts = [];
let detailAuxCharts = [];   // 体力衰竭等独立图表，不参与主图 x 轴联动/框选缩放
let detailChartResizeObservers = [];
let detailRouteMap = null;
let detailRouteTileLayer = null;
let detailRouteTileKey = null;
let detailRouteLayers = [];
let _detailZoomDrag = null;
let _detailZoomActive = false;
let _detailZoomHandlersInited = false;
let _detailRouteCoords = null;
let _detailRouteCumDist = null;
let _detailRouteStepM = 1000;
let _detailChartIsRecords = false;
let _detailChartDataLen = 0;
let _detailRecordsRef = null;   // 详情页当前记录序列，供分段对比重渲染
// 分段平行对比（手动框选 · 距离归零叠加）
let _detailCompareMode = false;         // 框选模式：拖拽=添加对比段而非缩放
let _detailCompareSegs = [];            // [{i0,i1}] 记录索引区间
let _detailCompareMetric = 'speed';     // 叠加曲线当前指标 key
let _detailCumDistM = null;             // 各记录累计距离(米)，距离对齐用
let _segCmpChart = null, _segCmpChartEl = null, _segCmpChipsEl = null, _segCmpMetricBarEl = null, _segCmpToggleBtn = null;
const COMPARE_COLORS = ['#2e86de', '#e74c3c', '#27ae60', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#3498db'];
let _detailRouteMarker = null;
let _detailRouteHideTimer = null;
let _detailWindData = null;
let _detailWindArrow = null;
let _detailTotalDurationS = 0;
let _detailWindEnabled = true;
let aiTrackId = null;
let _aiModel  = '';
let _aiChatMessages  = [];
let _aiChatStreaming  = false;
const _AI_EVAL_SYS_MSG = '你是专业骑行教练 AI。以下是本次骑行的原始数据，请基于此回答后续问题。';
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
let _pmcConfig = { ftp: 200, maxHr: 190, restHr: 50, lthr: 0, weight: 0, hrZoneMode: 'maxhr' };
let _routeScaleCfg = { gradeMin: null, gradeMax: null, speedMax: null, cadenceMax: null };

let _calYear  = new Date().getFullYear();
let _calMonth = new Date().getMonth(); // 0-indexed
let _calActivities = null; // cached from /api/activities

let _sidebarView = 'activities'; // 'activities' | 'map' | 'pmc' | 'calendar' | 'files' | 'settings' | 'about'

function switchSidebarView(name) {
  // Dismiss full-screen overlays first (z-index 950+) so they don't block new view
  if (aiTrackId != null) closeAiView();
  if (detailTrackId != null) closeDetailView();

  // Exit select mode when leaving activities view
  if (_actSelectMode) _exitSelectMode();

  _sidebarView = name;

  document.getElementById('activities-view').classList.remove('active');
  document.getElementById('files-view').classList.remove('active');
  document.getElementById('about-view').classList.remove('active');
  document.getElementById('settings-view').classList.remove('active');
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
    // 启动时地图视图是隐藏的（默认停在骑行记录），#map 高度为 0，minZoom 只能算成 0。
    // ResizeObserver 虽然也会补一次，但触发时机不保证，这里显式重算才是确定的。
    _applyMinZoom();
    if (!tileLayer) void setTiles(currentTile);
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
  } else if (name === 'settings') {
    document.getElementById('settings-view').classList.add('active');
    loadSettingsView();
  } else if (name === 'about') {
    document.getElementById('about-view').classList.add('active');
  }
}

let _actActivities  = null; // cached from /api/activities
let _actFilter      = { year: '', month: '', minKm: null, maxKm: null, tags: new Set() };
let _actRenderList  = [];   // 当前过滤后的完整列表（分批渲染用）
let _actRenderOffset = 0;   // 已渲染条数
const _ACT_PAGE     = 60;   // 每批渲染数量
let _actSentinelObs = null; // IntersectionObserver
let _actSelectMode  = false;
let _actSelected    = new Set(); // filenames
let _allTags        = []; // all tags from /api/tags
let _bulkTagInitial = {}; // tagId → 'all' | 'some' | 'none'  (frozen at picker open)
let _bulkTagIntent  = {}; // tagId → 'all' | 'some' | 'none'  (mutable; 'some' only before first click)
let _bulkTagAnchor  = null; // anchor element for repositioning on resize

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
  _closeBulkTagPicker();
}

function _updateSelectBar() {
  document.getElementById('act-select-count').textContent = `已选 ${_actSelected.size} 项`;
  const allCards = document.querySelectorAll('.act-card[data-filename]');
  const btn = document.getElementById('act-select-all-btn');
  if (btn) {
    const allSelected = allCards.length > 0 && [...allCards].every(c => _actSelected.has(c.dataset.filename));
    btn.textContent = allSelected ? '取消全选' : '全选';
  }
  const aiBtn = document.getElementById('act-bulk-ai-btn');
  if (aiBtn) aiBtn.disabled = (_actSelected.size < 2 || !_aiModel);
  const chartBtn = document.getElementById('act-bulk-chart-btn');
  if (chartBtn) chartBtn.disabled = (_actSelected.size < 2);
  const posterBtn = document.getElementById('act-bulk-poster-btn');
  if (posterBtn) posterBtn.disabled = (_actSelected.size < 1);
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
  let loaded = false;
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
      addTrack(data, { fit: false });
      loaded = true;
    } catch (e) { console.warn('[loadFromLibrary] 加载失败:', e); }
  }
  if (loaded) mapFitAll();
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

async function _fetchActivityData(act) {
  let kmStats = [], windData = null;
  try {
    const [lr, wr] = await Promise.all([
      fetch('/api/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: act.filename || '' }),
      }),
      fetch(`/api/weather/${encodeURIComponent(act.filename || '')}`),
    ]);
    if (lr.ok) { const ld = await lr.json(); kmStats = ld.km_stats || []; }
    if (wr.ok) { const wd = await wr.json(); if (wd.available) windData = wd; }
  } catch (e) { console.warn('[_fetchActivityData] fetch failed:', e); }
  return { kmStats, windData };
}

async function _actBulkAiCompare() {
  if (_actSelected.size < 2) { toast('请至少选择 2 条记录'); return; }
  if (!_aiModel) { toast('AI 未配置，请点击侧栏「设置」进行配置'); return; }

  const filenames = [..._actSelected];
  const acts = filenames
    .map(fn => (_actActivities || []).find(a => a.filename === fn))
    .filter(Boolean);
  if (acts.length < 2) { toast('获取记录信息失败'); return; }

  toast('正在加载骑行数据…');

  const results = await Promise.all(acts.map(async act => {
    const { kmStats, windData } = await _fetchActivityData(act);
    return {
      summary:    act.summary    || {},
      km_stats:   kmStats,
      filename:   act.filename   || '',
      start_time: act.start_time || '',
      wind_data:  windData,
    };
  }));

  const summaryHtml = acts
    .map(a => `<span class="stat-chip">${_escapeHtml((a.filename || '').replace(/\.fit$/i, ''))}</span>`)
    .join('');
  const payload = { activities: results };

  await _openAndStreamModal(
    `骑行对比 · AI 分析（${acts.length} 条）`,
    summaryHtml,
    () => fetch('/api/ai/compare', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    }),
    '你是专业骑行教练 AI。以下是多次骑行的原始数据，请基于此回答后续问题。'
  );
}

/* ── 骑行图表对比 ─────────────────────────────────────────────────────────── */

let _cmpRides   = [];      // [{filename, label, color, summary, kmStats, windData, peakPower, zoneTime}]
let _cmpTab     = 'summary';
let _cmpCharts  = {};      // id → echarts instance
let _cmpObs     = [];      // ResizeObserver list
let _cmpDistMetric = 'avg_speed_kmh';
let _cmpPctMetric  = 'avg_speed_kmh';
let _cmpLoadToken  = 0;    // 递增令牌：关闭弹窗或重新发起时作废在途加载

const _CMP_METRICS = [
  { key: 'avg_speed_kmh', label: '速度', unit: 'km/h', digits: 1 },
  { key: 'avg_hr',        label: '心率', unit: 'bpm',  digits: 0 },
  { key: 'avg_power',     label: '功率', unit: 'W',    digits: 0 },
  { key: 'avg_cadence',   label: '踏频', unit: 'rpm',  digits: 0 },
  { key: 'end_alt_m',     label: '海拔', unit: 'm',    digits: 0 },
];

// 指标定义：higher 表示数值越大越好（用于 Δ 着色）；null 表示不着色
const _CMP_ROWS = [
  { label: '距离',       unit: 'km',   digits: 1, higher: null, get: r => r.summary.total_dist_km },
  { label: '移动时间',   unit: '',     digits: 0, higher: null, fmt: v => _fmtDur(v), get: r => r.summary.moving_time_s ?? r.summary.total_duration_s },
  { label: '均速',       unit: 'km/h', digits: 1, higher: true, get: r => r.summary.avg_speed_kmh },
  { label: '归一化均速', unit: 'km/h', digits: 1, higher: true, get: r => r.vNorm },
  { label: '有效逆风',   unit: 'km/h', digits: 1, higher: false, get: r => r.effHeadwind },
  { label: '均功率',     unit: 'W',    digits: 0, higher: true, get: r => r.summary.avg_power },
  { label: 'NP',         unit: 'W',    digits: 0, higher: true, get: r => r.summary.normalized_power },
  { label: 'VI',         unit: '',     digits: 2, higher: false, get: r => _cmpVi(r) },
  { label: '均心率',     unit: 'bpm',  digits: 0, higher: false, get: r => r.summary.avg_hr },
  { label: 'EF',         unit: '',     digits: 2, higher: true, get: r => _cmpEf(r) },
  { label: '爬升',       unit: 'm',    digits: 0, higher: null, get: r => r.summary.total_elevation_gain_m },
  { label: '均踏频',     unit: 'rpm',  digits: 0, higher: true, get: r => r.summary.avg_cadence },
];

function _cmpVi(r) {
  const np = r.summary.normalized_power, ap = r.summary.avg_power;
  return (np && ap) ? np / ap : null;
}

function _cmpEf(r) {
  const np = r.summary.normalized_power, hr = r.summary.avg_hr;
  return (np && hr) ? np / hr : null;
}

// 与后端 _wind_normalize_speed 保持一致：每 1 km/h 有效逆风折算 0.25 km/h
function _cmpWindNormalize(avgSpeed, wind) {
  if (!wind || !wind.available || !avgSpeed) return { vNorm: avgSpeed ?? null, effHeadwind: null };
  const spd  = wind.wind_speed_avg_kmh || 0;
  const head = wind.headwind_pct || 0;
  const tail = wind.tailwind_pct || 0;
  const eff  = spd * (head - tail) / 100;
  return { vNorm: Math.round((avgSpeed + eff * 0.25) * 10) / 10, effHeadwind: Math.round(eff * 10) / 10 };
}

function _disposeCompareCharts() {
  for (const ro of _cmpObs) { try { ro.disconnect(); } catch {} }
  _cmpObs = [];
  for (const key of Object.keys(_cmpCharts)) {
    try { _cmpCharts[key].dispose(); } catch {}
  }
  _cmpCharts = {};
}

function _cmpInitChart(el, key) {
  const chart = echarts.init(el, null, { renderer: 'svg' });
  _cmpCharts[key] = chart;
  const ro = new ResizeObserver(() => { try { chart.resize(); } catch {} });
  ro.observe(el);
  _cmpObs.push(ro);
  return chart;
}

function _cmpBaseOption(theme) {
  return {
    grid: { left: 52, right: 20, top: 30, bottom: 34 },
    legend: { textStyle: { color: theme.legendColor }, top: 0 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: theme.tooltipBg,
      borderColor: theme.tooltipBorder,
      textStyle: { color: theme.tooltipText },
    },
  };
}

function _cmpAxisStyle(theme) {
  return {
    axisLine:  { lineStyle: { color: theme.axisColor } },
    axisLabel: { color: theme.tickColor },
    splitLine: { lineStyle: { color: theme.gridColor } },
  };
}

async function _actBulkChartCompare() {
  if (_actSelected.size < 2) { toast('请至少选择 2 条记录'); return; }

  const acts = [..._actSelected]
    .map(fn => (_actActivities || []).find(a => a.filename === fn))
    .filter(Boolean)
    .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
  if (acts.length < 2) { toast('获取记录信息失败'); return; }

  const token = ++_cmpLoadToken;
  _disposeCompareCharts();
  _cmpTab = 'summary';
  document.querySelectorAll('#compare-tabs .cmp-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === 'summary');
  });
  document.querySelectorAll('.cmp-pane').forEach(p => { p.style.display = 'none'; });
  document.getElementById('compare-loading').style.display = '';
  document.getElementById('compare-modal-title').textContent = `骑行对比 · 图表（${acts.length} 条）`;
  document.getElementById('compare-legend').innerHTML = '';
  document.getElementById('compare-modal').style.display = 'flex';

  // 同一天可能有多次骑行：重复的日期标签会让 ECharts 系列重名，补上时间消歧
  const dayCount = {};
  for (const a of acts) {
    const d = (a.start_time || '').slice(0, 10);
    dayCount[d] = (dayCount[d] || 0) + 1;
  }

  const loaded = await Promise.all(acts.map(async (act, i) => {
    const { kmStats, windData } = await _fetchActivityData(act);
    const summary = act.summary || {};
    const { vNorm, effHeadwind } = _cmpWindNormalize(summary.avg_speed_kmh, windData);
    const day = (act.start_time || '').slice(0, 10);
    const label = day
      ? (dayCount[day] > 1 ? `${day} ${(act.start_time || '').slice(11, 16)}` : day)
      : (act.filename || '').replace(/\.fit$/i, '');
    return {
      filename:  act.filename || '',
      label,
      color:     PALETTE[i % PALETTE.length],
      summary,
      kmStats:   kmStats || [],
      windData,
      vNorm,
      effHeadwind,
      peakPower: act.peak_power  || {},
      zoneTime:  act.zone_time_s || null,
    };
  }));

  // 弹窗已关闭或又发起了一次加载 → 丢弃本次结果，避免往隐藏弹窗里建实例
  if (token !== _cmpLoadToken) return;

  _cmpRides = loaded;
  document.getElementById('compare-loading').style.display = 'none';
  document.getElementById('compare-legend').innerHTML = loaded
    .map(r => `<span class="cmp-legend-item"><i class="cmp-legend-dot" data-color="${r.color}"></i>${_escapeHtml(r.label)}</span>`)
    .join('');
  document.querySelectorAll('#compare-legend .cmp-legend-dot').forEach(el => {
    el.style.background = el.dataset.color;
  });

  _renderCmpMetricSwitch('cmp-dist-metrics', _cmpDistMetric, m => {
    _cmpDistMetric = m; _renderCmpDistance();
  });
  _renderCmpMetricSwitch('cmp-pct-metrics', _cmpPctMetric, m => {
    _cmpPctMetric = m; _renderCmpPercent();
  });

  switchCompareTab('summary');
}

function closeCompareModal() {
  _cmpLoadToken++;               // 作废在途加载
  _disposeCompareCharts();
  document.getElementById('compare-modal').style.display = 'none';
  _cmpRides = [];
}

function switchCompareTab(tab) {
  _cmpTab = tab;
  document.querySelectorAll('#compare-tabs .cmp-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.querySelectorAll('.cmp-pane').forEach(p => { p.style.display = 'none'; });
  const pane = document.getElementById(`cmp-pane-${tab}`);
  if (pane) pane.style.display = '';
  if (tab === 'summary')       _renderCmpSummary();
  else if (tab === 'distance') _renderCmpDistance();
  else if (tab === 'percent')  _renderCmpPercent();
}

function _renderCmpMetricSwitch(containerId, current, onPick) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  wrap.innerHTML = _CMP_METRICS
    .map(m => `<button class="cmp-metric-btn${m.key === current ? ' active' : ''}" data-key="${m.key}">${m.label}</button>`)
    .join('');
  wrap.querySelectorAll('.cmp-metric-btn').forEach(btn => {
    btn.onclick = () => {
      wrap.querySelectorAll('.cmp-metric-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onPick(btn.dataset.key);
    };
  });
}

/* ── Tab 1: 聚合指标 ──────────────────────────────────────────────────────── */

function _renderCmpSummary() {
  _renderCmpMetricTable();
  _renderCmpCurve();
  _renderCmpZones();
}

function _renderCmpMetricTable() {
  const wrap = document.getElementById('cmp-metric-table');
  if (!wrap) return;
  const base = _cmpRides[0];

  const head = `<tr><th>指标</th>${
    _cmpRides.map((r, i) => `<th>${_escapeHtml(r.label)}${i === 0 ? '<span class="cmp-base-tag">基准</span>' : ''}</th>`).join('')
  }</tr>`;

  const rows = _CMP_ROWS.map(row => {
    const baseVal = row.get(base);
    const cells = _cmpRides.map((r, i) => {
      const v = row.get(r);
      if (v == null) return '<td class="cmp-na">—</td>';
      const text = row.fmt ? row.fmt(v) : `${v.toFixed(row.digits)}${row.unit ? ' ' + row.unit : ''}`;
      if (i === 0 || baseVal == null || !baseVal || row.higher === null || row.fmt) {
        return `<td>${text}</td>`;
      }
      const pct = (v - baseVal) / Math.abs(baseVal) * 100;
      if (!isFinite(pct)) return `<td>${text}</td>`;
      const better = row.higher ? pct > 0 : pct < 0;
      const cls = Math.abs(pct) < 0.5 ? 'cmp-flat' : (better ? 'cmp-better' : 'cmp-worse');
      const sign = pct > 0 ? '+' : '';
      return `<td>${text}<span class="cmp-delta ${cls}">${sign}${pct.toFixed(1)}%</span></td>`;
    }).join('');
    return `<tr><td class="cmp-row-label">${row.label}</td>${cells}</tr>`;
  }).join('');

  wrap.innerHTML = `<table class="cmp-table"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
}

function _renderCmpCurve() {
  const wrap = document.getElementById('cmp-curve-wrap');
  if (!wrap) return;
  const hasAny = _cmpRides.some(r => Object.values(r.peakPower || {}).some(v => v > 0));
  if (!hasAny) {
    wrap.innerHTML = '<div class="cmp-empty">所选骑行均无功率数据</div>';
    return;
  }

  wrap.innerHTML = '<div id="cmp-curve-chart" class="cmp-chart"></div>';
  const el = document.getElementById('cmp-curve-chart');
  const theme = _pmcChartTheme(el.closest('.cmp-section'));
  const chart = _cmpInitChart(el, 'curve');

  // 5 个固定时长用等距 category 轴：log 轴会自选 10/100/1000 作刻度，导致标签丢失
  const xLabels = ['5s', '1m', '5m', '20m', '60m'];

  chart.setOption({
    ..._cmpBaseOption(theme),
    tooltip: {
      ..._cmpBaseOption(theme).tooltip,
      valueFormatter: v => v == null ? '—' : `${v} W`,
    },
    xAxis: {
      type: 'category',
      data: xLabels,
      boundaryGap: false,
      axisLabel: { color: theme.tickColor },
      axisLine: { lineStyle: { color: theme.axisColor } },
      splitLine: { show: false },
    },
    yAxis: { type: 'value', name: 'W', nameTextStyle: { color: theme.mutedColor }, ..._cmpAxisStyle(theme) },
    series: _cmpRides.map(r => ({
      name: r.label,
      type: 'line',
      data: _CURVE_DURATIONS.map(d => r.peakPower[d.key] || null),
      lineStyle: { color: r.color, width: 2 },
      itemStyle: { color: r.color },
      symbol: 'circle', symbolSize: 6,
      connectNulls: false,
    })),
  });
}

function _renderCmpZones() {
  const wrap = document.getElementById('cmp-zone-wrap');
  if (!wrap) return;
  const rides = _cmpRides.filter(r => r.zoneTime);
  if (!rides.length) {
    wrap.innerHTML = '<div class="cmp-empty">所选骑行均无功率区间数据（需含功率且已设置 FTP）</div>';
    return;
  }

  wrap.innerHTML = `<div id="cmp-zone-chart" class="cmp-chart" data-rows="${rides.length}"></div>`;
  const el = document.getElementById('cmp-zone-chart');
  el.style.height = `${Math.max(120, rides.length * 46 + 60)}px`;
  const theme = _pmcChartTheme(el.closest('.cmp-section'));
  const chart = _cmpInitChart(el, 'zone');

  // 每次骑行按自身踏踩总时长归一为百分比，消除时长差异
  const pcts = rides.map(r => {
    const z = r.zoneTime;
    const total = Array.from({ length: 7 }, (_, i) => z[String(i + 1)] || 0).reduce((a, b) => a + b, 0);
    return Array.from({ length: 7 }, (_, i) => total > 0 ? (z[String(i + 1)] || 0) / total * 100 : 0);
  });

  chart.setOption({
    grid: { left: 116, right: 24, top: 30, bottom: 24 },
    legend: { textStyle: { color: theme.legendColor }, top: 0 },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      backgroundColor: theme.tooltipBg, borderColor: theme.tooltipBorder,
      textStyle: { color: theme.tooltipText },
      valueFormatter: v => `${v.toFixed(1)}%`,
    },
    xAxis: { type: 'value', max: 100, axisLabel: { color: theme.tickColor, formatter: '{value}%' }, ..._cmpAxisStyle(theme) },
    yAxis: {
      type: 'category',
      data: rides.map(r => r.label),
      axisLabel: { color: theme.tickColor },
      axisLine: { lineStyle: { color: theme.axisColor } },
      splitLine: { show: false },
    },
    series: Array.from({ length: 7 }, (_, zi) => ({
      name: `Z${zi + 1}`,
      type: 'bar',
      stack: 'zone',
      barMaxWidth: 26,
      itemStyle: { color: POWER_ZONE_COLORS[zi] },
      data: pcts.map(p => p[zi]),
    })),
  });
}

/* ── Tab 2: 逐公里（绝对距离） ────────────────────────────────────────────── */

function _renderCmpDistance() {
  const wrap = document.getElementById('cmp-dist-wrap');
  const note = document.getElementById('cmp-dist-note');
  if (!wrap) return;

  const usable = _cmpRides.filter(r => r.kmStats.length);
  if (!usable.length) {
    wrap.innerHTML = '<div class="cmp-empty">无逐公里数据</div>';
    if (note) note.textContent = '';
    return;
  }

  const metric  = _CMP_METRICS.find(m => m.key === _cmpDistMetric) || _CMP_METRICS[0];
  const minLen  = Math.min(...usable.map(r => r.kmStats.length));
  const maxLen  = Math.max(...usable.map(r => r.kmStats.length));
  if (note) {
    note.textContent = minLen === maxLen
      ? `共 ${minLen} km，各次骑行等长`
      : `按最短的一次截断至 ${minLen} km（最长 ${maxLen} km），超出部分不绘制`;
  }

  wrap.innerHTML = '<div id="cmp-dist-chart" class="cmp-chart cmp-chart-tall"></div>';
  const el = document.getElementById('cmp-dist-chart');
  const theme = _pmcChartTheme(el.closest('.cmp-pane'));
  const chart = _cmpInitChart(el, 'dist');

  chart.setOption({
    ..._cmpBaseOption(theme),
    tooltip: {
      ..._cmpBaseOption(theme).tooltip,
      valueFormatter: v => v == null ? '—' : `${Number(v).toFixed(metric.digits)} ${metric.unit}`,
    },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 4, textStyle: { color: theme.mutedColor } }],
    grid: { left: 52, right: 20, top: 30, bottom: 52 },
    xAxis: {
      type: 'category',
      data: Array.from({ length: minLen }, (_, i) => `${i + 1}`),
      name: 'km', nameLocation: 'end', nameTextStyle: { color: theme.mutedColor },
      ..._cmpAxisStyle(theme),
      splitLine: { show: false },
    },
    yAxis: { type: 'value', scale: true, name: metric.unit, nameTextStyle: { color: theme.mutedColor }, ..._cmpAxisStyle(theme) },
    series: usable.map(r => ({
      name: r.label,
      type: 'line',
      showSymbol: false,
      data: r.kmStats.slice(0, minLen).map(s => s[metric.key] ?? null),
      lineStyle: { color: r.color, width: 2 },
      itemStyle: { color: r.color },
      connectNulls: false,
    })),
  });
}

/* ── Tab 3: 行程百分比归一 ────────────────────────────────────────────────── */

// 把不等长序列线性重采样到固定点数
function _cmpResample(values, points) {
  const clean = values.map(v => (typeof v === 'number' && isFinite(v)) ? v : null);
  if (clean.length < 2) return new Array(points).fill(clean[0] ?? null);
  const out = [];
  for (let i = 0; i < points; i++) {
    const pos = i / (points - 1) * (clean.length - 1);
    const lo  = Math.floor(pos);
    const hi  = Math.min(clean.length - 1, lo + 1);
    const a = clean[lo], b = clean[hi];
    if (a == null || b == null) { out.push(a ?? b ?? null); continue; }
    out.push(a + (b - a) * (pos - lo));
  }
  return out;
}

function _renderCmpPercent() {
  const wrap = document.getElementById('cmp-pct-wrap');
  if (!wrap) return;

  const usable = _cmpRides.filter(r => r.kmStats.length >= 2);
  if (!usable.length) {
    wrap.innerHTML = '<div class="cmp-empty">逐公里数据不足，无法归一化</div>';
    return;
  }

  const metric = _CMP_METRICS.find(m => m.key === _cmpPctMetric) || _CMP_METRICS[0];
  const POINTS = 50;

  const series = usable.map(r => {
    const raw = r.kmStats.map(s => s[metric.key] ?? null);
    const valid = raw.filter(v => typeof v === 'number' && isFinite(v));
    if (!valid.length) return null;
    const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
    if (!mean) return null;
    const resampled = _cmpResample(raw, POINTS);
    return {
      name: r.label,
      type: 'line',
      showSymbol: false,
      data: resampled.map(v => v == null ? null : Math.round(v / mean * 1000) / 1000),
      lineStyle: { color: r.color, width: 2 },
      itemStyle: { color: r.color },
      connectNulls: false,
    };
  }).filter(Boolean);

  if (!series.length) {
    wrap.innerHTML = '<div class="cmp-empty">该指标在所选骑行中均无有效数据</div>';
    return;
  }

  wrap.innerHTML = '<div id="cmp-pct-chart" class="cmp-chart cmp-chart-tall"></div>';
  const el = document.getElementById('cmp-pct-chart');
  const theme = _pmcChartTheme(el.closest('.cmp-pane'));
  const chart = _cmpInitChart(el, 'pct');

  chart.setOption({
    ..._cmpBaseOption(theme),
    tooltip: {
      ..._cmpBaseOption(theme).tooltip,
      valueFormatter: v => v == null ? '—' : `${(Number(v) * 100).toFixed(0)}% 自身均值`,
    },
    xAxis: {
      type: 'category',
      data: Array.from({ length: POINTS }, (_, i) => Math.round(i / (POINTS - 1) * 100)),
      axisLabel: { color: theme.tickColor, formatter: v => `${v}%`, interval: Math.floor(POINTS / 5) },
      axisLine: { lineStyle: { color: theme.axisColor } },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value', scale: true,
      axisLabel: { color: theme.tickColor, formatter: v => `${Math.round(v * 100)}%` },
      axisLine: { lineStyle: { color: theme.axisColor } },
      splitLine: { lineStyle: { color: theme.gridColor } },
    },
    series,
  });
}

/* ── 骑行分享海报 ─────────────────────────────────────────────────────────── */

const _POSTER_SIZE = {
  '3:4':  [1440, 1920],
  '9:16': [1080, 1920],
};
const _POSTER_THEMES = {
  dark: {
    bg: '#0b0e14', panel: '#141a24', mapFallback: '#18212d',
    text: '#f4f7fb', muted: '#98a5b7', subtle: '#5f6c7d', accent: '#55a8ff',
    routeHalo: 'rgba(5,8,13,0.72)', start: '#47d78f', end: '#ff6f78',
    tile: EXPORT_TILE_URLS['dark-nolabels'],
  },
  light: {
    bg: '#f3f5f8', panel: '#ffffff', mapFallback: '#e5ebf1',
    text: '#18212c', muted: '#657184', subtle: '#98a1ad', accent: '#2479c9',
    routeHalo: 'rgba(255,255,255,0.82)', start: '#168a55', end: '#d8434f',
    tile: EXPORT_TILE_URLS['light-nolabels'],
  },
};
const _POSTER_FONT = '"PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif';
const _POSTER_PRIVACY_KM = 0.8;

const _posterState = {
  rides: [], kind: 'single', theme: 'dark', ratio: '3:4',
  title: '', subtitle: '', hideEndpoints: true,
  fields: new Set(['distance', 'duration', 'speed', 'elevation', 'power', 'hr']),
  revision: 0, renderToken: 0, renderTimer: null, renderPromise: null,
  mapCanvas: null, mapKey: '',
};

function _posterDateLabel(value) {
  if (!value) return '';
  const dt = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(dt.getTime())) return value.slice(0, 10);
  return dt.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

function _posterDefaultSubtitle(rides, kind) {
  const dates = rides.map(r => r.startTime || '').filter(Boolean).sort();
  if (kind === 'single') return _posterDateLabel(dates[0]);
  if (!dates.length) return `${rides.length} 次骑行`;
  const first = dates[0].slice(0, 10).replaceAll('-', '.');
  const last = dates[dates.length - 1].slice(0, 10).replaceAll('-', '.');
  return `${first}${first === last ? '' : ` — ${last}`} · ${rides.length} 次骑行`;
}

function _posterRideFromTrack(track) {
  const act = (_actActivities || []).find(a => a.filename === track.filename);
  return {
    filename: track.filename || track.name || '',
    startTime: act?.start_time || track.timeStatsStart || '',
    summary: track.summary || act?.summary || {},
    coords: track.raw || [],
  };
}

function _posterOpen(rides, kind) {
  if (!rides.length) { toast('没有可生成海报的骑行记录'); return; }
  _posterState.rides = rides;
  _posterState.kind = kind;
  _posterState.theme = 'dark';
  _posterState.ratio = '3:4';
  _posterState.title = kind === 'single' ? '骑行记录' : '骑行合集';
  _posterState.subtitle = _posterDefaultSubtitle(rides, kind);
  _posterState.hideEndpoints = true;
  _posterState.fields = new Set(['distance', 'duration', 'speed', 'elevation']);
  if (rides.some(r => r.summary?.avg_power != null)) _posterState.fields.add('power');
  if (rides.some(r => r.summary?.avg_hr != null)) _posterState.fields.add('hr');
  _posterState.revision++;
  _posterState.mapCanvas = null;
  _posterState.mapKey = '';

  document.getElementById('poster-title-input').value = _posterState.title;
  document.getElementById('poster-subtitle-input').value = _posterState.subtitle;
  document.getElementById('poster-privacy-check').checked = true;
  document.getElementById('poster-modal-kind').textContent =
    kind === 'single' ? '单条路线海报' : `${rides.length} 条骑行 · 汇总海报`;
  document.querySelectorAll('#poster-theme-options button').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.val === _posterState.theme));
  document.querySelectorAll('#poster-ratio-options button').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.val === _posterState.ratio));
  document.querySelectorAll('#poster-field-options input').forEach(input => {
    const available = _posterFieldAvailable(input.value, rides);
    input.disabled = !available;
    input.checked = available && _posterState.fields.has(input.value);
  });
  document.getElementById('poster-modal').style.display = 'flex';
  _posterUpdateSizeHint();
  _posterScheduleRender(true);

  // 标签初始化：单条骑行可用 3D 预览（默认）；汇总仅海报
  const tab3dBtn = document.querySelector('#share-tabs [data-tab="3d"]');
  if (tab3dBtn) tab3dBtn.style.display = kind === 'single' ? '' : 'none';
  _shareSwitchTab(kind === 'single' ? '3d' : 'poster');
}

function openDetailShare() {
  const track = tracks.get(detailTrackId);
  if (!track) { toast('当前骑行尚未加载'); return; }
  _posterOpen([_posterRideFromTrack(track)], 'single');
}

// ── 分享弹窗标签：3D 预览（交互式）/ 海报 ──────────────────────────────────
let _shareTab = '3d';

function _shareSwitchTab(tab) {
  _shareTab = tab;
  document.querySelectorAll('#share-tabs .share-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
  const panel3d = document.getElementById('share-3d-panel');
  const posterBody = document.getElementById('poster-modal-body');
  const dlBtn = document.getElementById('poster-download-btn');
  const exportHint = document.getElementById('poster-export-hint');
  const is3d = tab === '3d';
  if (panel3d) panel3d.style.display = is3d ? '' : 'none';
  if (posterBody) posterBody.style.display = is3d ? 'none' : '';
  if (dlBtn) dlBtn.style.display = is3d ? 'none' : '';
  if (exportHint) exportHint.style.display = is3d ? 'none' : '';
  if (is3d) _share3DMount();
  else { _share3DUnmount(); _posterScheduleRender(true); }
}

function _share3DMount() {
  if (!window.Route3D) { toast('3D 模块未加载'); return; }
  if (_route3DActive) return;
  const records = _detailRoute3DRecords();
  const hint = document.getElementById('detail-route-3d-hint');
  if (records.length < 2) { if (hint) hint.textContent = '本次骑行无坐标数据'; return; }
  const canvas = document.getElementById('detail-route-3d-canvas');
  const inst = window.Route3D.mount(canvas, records, { transparent: false, showGround: true });
  if (!inst) { toast('3D 场景初始化失败'); return; }
  _route3DActive = true;
  _detailRoute3DSyncSpinUI();
}

function _share3DUnmount() {
  if (!_route3DActive) return;
  try { window.Route3D?.unmount(); } catch {}
  _route3DActive = false;
}

async function _actBulkPoster() {
  if (!_actSelected.size) { toast('请先选择活动'); return; }
  if (_actSelected.size > 50) { toast('一次最多生成 50 条骑行的汇总海报'); return; }
  const acts = [..._actSelected]
    .map(fn => (_actActivities || []).find(a => a.filename === fn))
    .filter(Boolean)
    .sort((a, b) => (a.start_time || '').localeCompare(b.start_time || ''));
  if (!acts.length) { toast('获取记录信息失败'); return; }

  const modal = document.getElementById('poster-modal');
  const status = document.getElementById('poster-preview-status');
  const loadToken = ++_posterState.renderToken;
  _posterState.rides = [];
  document.getElementById('poster-modal-kind').textContent = `${acts.length} 条骑行 · 正在加载轨迹`;
  status.textContent = `正在加载轨迹 0 / ${acts.length}…`;
  modal.style.display = 'flex';

  const rides = [];
  for (let offset = 0; offset < acts.length; offset += 4) {
    const batch = acts.slice(offset, offset + 4);
    const results = await Promise.all(batch.map(async act => {
      try {
        const res = await fetch('/api/load', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: act.filename }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return {
          filename: act.filename || '', startTime: act.start_time || data.time_stats_start || '',
          summary: act.summary || data.summary || {}, coords: data.coords || [],
        };
      } catch (_) { return null; }
    }));
    if (loadToken !== _posterState.renderToken || modal.style.display !== 'flex') return;
    rides.push(...results.filter(Boolean));
    status.textContent = `正在加载轨迹 ${Math.min(offset + batch.length, acts.length)} / ${acts.length}…`;
  }
  if (!rides.length) { closePosterModal(); toast('轨迹加载失败，无法生成海报'); return; }
  if (rides.length < acts.length) toast(`${acts.length - rides.length} 条轨迹加载失败，已跳过`);
  _posterOpen(rides, rides.length === 1 ? 'single' : 'summary');
}

function closePosterModal() {
  _posterState.renderToken++;
  if (_posterState.renderTimer) clearTimeout(_posterState.renderTimer);
  _posterState.renderTimer = null;
  _posterState.renderPromise = null;
  _share3DUnmount();
  document.getElementById('poster-modal').style.display = 'none';
}

function _posterSetOption(key, value) {
  _posterState[key] = value;
  const group = document.getElementById(`poster-${key}-options`);
  group?.querySelectorAll('button').forEach(btn => btn.classList.toggle('active', btn.dataset.val === value));
  _posterState.mapCanvas = null;
  _posterUpdateSizeHint();
  _posterScheduleRender(true);
}

function _posterTextChanged() {
  _posterState.title = document.getElementById('poster-title-input').value.trim();
  _posterState.subtitle = document.getElementById('poster-subtitle-input').value.trim();
  _posterScheduleRender(false);
}

function _posterFieldsChanged() {
  _posterState.fields = new Set(
    [...document.querySelectorAll('#poster-field-options input:checked')].map(input => input.value)
  );
  _posterScheduleRender(false);
}

function _posterPrivacyChanged() {
  _posterState.hideEndpoints = document.getElementById('poster-privacy-check').checked;
  _posterState.mapCanvas = null;
  _posterScheduleRender(true);
}

function _posterUpdateSizeHint() {
  const [w, h] = _POSTER_SIZE[_posterState.ratio];
  document.getElementById('poster-export-hint').textContent = `高清 PNG · ${w} × ${h}`;
  document.getElementById('poster-canvas').classList.toggle('poster-canvas-story', _posterState.ratio === '9:16');
}

function _posterScheduleRender(mapChanged) {
  if (mapChanged) _posterState.mapCanvas = null;
  if (_posterState.renderTimer) clearTimeout(_posterState.renderTimer);
  _posterState.renderTimer = setTimeout(() => {
    _posterState.renderTimer = null;
    _posterState.renderPromise = _posterRender();
  }, 120);
}

function _posterFieldAvailable(key, rides) {
  const summaries = rides.map(r => r.summary || {});
  if (key === 'distance') return summaries.some(s => s.total_dist_km != null);
  if (key === 'duration') return summaries.some(s => s.total_duration_s != null || s.moving_time_s != null);
  if (key === 'speed') return summaries.some(s => s.avg_speed_kmh != null);
  if (key === 'elevation') return summaries.some(s => s.total_elevation_gain_m != null);
  if (key === 'power') return summaries.some(s => s.avg_power != null);
  if (key === 'hr') return summaries.some(s => s.avg_hr != null);
  if (key === 'cadence') return summaries.some(s => s.avg_cadence != null);
  return false;
}

function _posterWeightedAverage(rides, field) {
  let weighted = 0, weights = 0;
  for (const ride of rides) {
    const value = ride.summary?.[field];
    if (value == null) continue;
    const weight = ride.summary?.moving_time_s || ride.summary?.total_duration_s || 1;
    weighted += value * weight;
    weights += weight;
  }
  return weights ? weighted / weights : null;
}

function _posterMetrics() {
  const rides = _posterState.rides;
  const sum = field => rides.reduce((total, ride) => total + (ride.summary?.[field] || 0), 0);
  const totalDistance = sum('total_dist_km');
  const totalDuration = rides.reduce((total, ride) => total +
    (ride.summary?.total_duration_s ?? ride.summary?.moving_time_s ?? 0), 0);
  const movingDuration = rides.reduce((total, ride) => total +
    (ride.summary?.moving_time_s ?? ride.summary?.total_duration_s ?? 0), 0);
  const aggregateSpeed = movingDuration > 0 ? totalDistance / movingDuration * 3600 : null;
  const defs = {
    distance:  { label: rides.length > 1 ? '总距离' : '距离', value: totalDistance, digits: 1, unit: 'km' },
    duration:  { label: rides.length > 1 ? '总时长' : '时长', text: _fmtDur(totalDuration) || '—', unit: '' },
    speed:     { label: '均速', value: rides.length > 1 ? aggregateSpeed : rides[0]?.summary?.avg_speed_kmh, digits: 1, unit: 'km/h' },
    elevation: { label: rides.length > 1 ? '累计爬升' : '爬升', value: sum('total_elevation_gain_m'), digits: 0, unit: 'm' },
    power:     { label: '均功率', value: _posterWeightedAverage(rides, 'avg_power'), digits: 0, unit: 'W' },
    hr:        { label: '均心率', value: _posterWeightedAverage(rides, 'avg_hr'), digits: 0, unit: 'bpm' },
    cadence:   { label: '均踏频', value: _posterWeightedAverage(rides, 'avg_cadence'), digits: 0, unit: 'rpm' },
  };
  return [..._posterState.fields]
    .map(key => defs[key])
    .filter(metric => metric && (metric.text || metric.value != null));
}

function _posterVisibleSegments(coords) {
  if (!coords || coords.length < 2) return [];
  if (!_posterState.hideEndpoints) return [coords];
  const start = coords[0], end = coords[coords.length - 1];
  const segments = [];
  let current = [];
  for (const point of coords) {
    const hidden = _haversineKm(point[0], point[1], start[0], start[1]) < _POSTER_PRIVACY_KM ||
      _haversineKm(point[0], point[1], end[0], end[1]) < _POSTER_PRIVACY_KM;
    if (hidden) {
      if (current.length > 1) segments.push(current);
      current = [];
    } else {
      current.push(point);
    }
  }
  if (current.length > 1) segments.push(current);
  return segments;
}

function _posterDownsampleSegments(segments, maxPoints) {
  const totalPoints = segments.reduce((total, segment) => total + segment.length, 0);
  if (totalPoints <= maxPoints) return segments;
  const ratio = maxPoints / totalPoints;
  return segments.map(segment => {
    const target = Math.max(2, Math.round(segment.length * ratio));
    if (segment.length <= target) return segment;
    const last = segment.length - 1;
    return Array.from({ length: target }, (_, index) =>
      segment[Math.round(index / (target - 1) * last)]
    );
  });
}

async function _posterBuildMap(width, height, theme, token) {
  const mapCanvas = document.createElement('canvas');
  mapCanvas.width = width;
  mapCanvas.height = height;
  const ctx = mapCanvas.getContext('2d');
  ctx.fillStyle = theme.mapFallback;
  ctx.fillRect(0, 0, width, height);

  const pointsPerRide = _posterState.rides.length === 1
    ? 20000
    : Math.max(1500, Math.floor(100000 / _posterState.rides.length));
  const rideSegments = _posterState.rides.map(ride =>
    _posterDownsampleSegments(_posterVisibleSegments(ride.coords), pointsPerRide)
  );
  const allCoords = rideSegments.flat(2);
  if (allCoords.length < 2) {
    ctx.fillStyle = theme.muted;
    ctx.font = `28px ${_POSTER_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('隐私保护后无可展示路线', width / 2, height / 2);
    return mapCanvas;
  }

  const inset = Math.round(Math.min(width, height) * 0.09);
  const fit = _calcZoom(allCoords, width - inset * 2, height - inset * 2);
  const zoomExact = fit.zoom;
  const zoomInt = Math.floor(zoomExact);
  const scaleFactor = Math.pow(2, zoomExact - zoomInt);
  const origin = _calcOrigin(fit.minLat, fit.maxLat, fit.minLon, fit.maxLon, zoomExact, width, height);
  const originX = Math.round(origin[0]), originY = Math.round(origin[1]);

  const avail = await _refreshCdnStatus({ retryUnavailable: true });
  if (token !== _posterState.renderToken) return null;
  if (avail.length) {
    await _drawTiles(ctx, zoomInt, scaleFactor, originX, originY, width, height, theme.tile);
    if (token !== _posterState.renderToken) return null;
  }

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  rideSegments.forEach((segments, rideIndex) => {
    const color = _posterState.rides.length === 1 ? theme.accent : PALETTE[rideIndex % PALETTE.length];
    ctx.strokeStyle = theme.routeHalo;
    ctx.lineWidth = Math.max(12, width * 0.011);
    segments.forEach(segment => _drawPath(ctx, segment, zoomExact, originX, originY));
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(6, width * 0.0055);
    segments.forEach(segment => _drawPath(ctx, segment, zoomExact, originX, originY));
  });

  if (!_posterState.hideEndpoints && _posterState.rides.length === 1) {
    const coords = _posterState.rides[0].coords || [];
    for (const [point, color] of [[coords[0], theme.start], [coords[coords.length - 1], theme.end]]) {
      if (!point) continue;
      const [x, y] = _lngLatToWorld(point[0], point[1], zoomExact);
      ctx.beginPath();
      ctx.arc(x - originX, y - originY, Math.max(10, width * 0.009), 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = Math.max(4, width * 0.003);
      ctx.strokeStyle = theme.routeHalo;
      ctx.stroke();
    }
  }
  ctx.restore();

  if (avail.length) {
    ctx.fillStyle = theme.routeHalo;
    ctx.fillRect(width - 132, height - 42, 132, 42);
    ctx.font = `18px ${_POSTER_FONT}`;
    ctx.fillStyle = theme.text;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('© CARTO', width - 14, height - 20);
  }
  return mapCanvas;
}

function _posterDrawMetric(ctx, metric, x, y, width, height, theme, scale) {
  ctx.fillStyle = theme.panel;
  _roundRect(ctx, x, y, width, height, Math.round(22 * scale));
  ctx.fill();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = theme.muted;
  ctx.font = `${Math.round(21 * scale)}px ${_POSTER_FONT}`;
  ctx.fillText(metric.label, x + 28 * scale, y + 24 * scale);

  const text = metric.text || Number(metric.value).toFixed(metric.digits);
  const valueSize = Math.round((text.length > 7 ? 40 : 48) * scale);
  ctx.font = `700 ${valueSize}px ${_POSTER_FONT}`;
  ctx.fillStyle = theme.text;
  const valueX = x + 28 * scale;
  const valueY = y + 61 * scale;
  ctx.fillText(text, valueX, valueY);
  if (metric.unit) {
    const valueWidth = ctx.measureText(text).width;
    ctx.fillStyle = theme.muted;
    ctx.font = `600 ${Math.round(19 * scale)}px ${_POSTER_FONT}`;
    ctx.fillText(metric.unit, valueX + valueWidth + 10 * scale, valueY + 25 * scale);
  }
}

async function _posterRender() {
  if (!_posterState.rides.length || document.getElementById('poster-modal').style.display !== 'flex') return;
  const token = ++_posterState.renderToken;
  const status = document.getElementById('poster-preview-status');
  const canvas = document.getElementById('poster-canvas');
  const [width, height] = _POSTER_SIZE[_posterState.ratio];
  const theme = _POSTER_THEMES[_posterState.theme];
  const scale = width / 1440;
  const pad = Math.round(width * 0.065);
  const mapY = Math.round(292 * scale);
  const mapHeight = _posterState.ratio === '9:16' ? 960 : 1030;
  const mapWidth = width - pad * 2;
  const mapKey = `${_posterState.revision}:${_posterState.theme}:${_posterState.ratio}:${_posterState.hideEndpoints}`;

  canvas.width = width;
  canvas.height = height;
  status.style.display = '';
  status.textContent = '正在绘制地图与路线…';

  if (!_posterState.mapCanvas || _posterState.mapKey !== mapKey) {
    status.textContent = '正在绘制地图与路线…';
    const built = await _posterBuildMap(mapWidth, mapHeight, theme, token);
    if (!built || token !== _posterState.renderToken) return;
    _posterState.mapCanvas = built;
    _posterState.mapKey = mapKey;
  }

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = theme.accent;
  ctx.font = `700 ${Math.round(20 * scale)}px ${_POSTER_FONT}`;
  ctx.fillText(_posterState.kind === 'single' ? 'SINGLE RIDE' : 'RIDE COLLECTION', pad, 66 * scale);
  ctx.fillStyle = theme.text;
  ctx.font = `700 ${Math.round(64 * scale)}px ${_POSTER_FONT}`;
  ctx.fillText(_posterState.title || '骑行记录', pad, 105 * scale, mapWidth);
  ctx.fillStyle = theme.muted;
  ctx.font = `${Math.round(27 * scale)}px ${_POSTER_FONT}`;
  ctx.fillText(_posterState.subtitle, pad, 202 * scale, mapWidth);

  ctx.save();
  _roundRect(ctx, pad, mapY, mapWidth, mapHeight, Math.round(28 * scale));
  ctx.clip();
  ctx.drawImage(_posterState.mapCanvas, pad, mapY);
  ctx.restore();

  const metrics = _posterMetrics();
  const columns = _posterState.ratio === '9:16' ? 2 : 4;
  const gap = Math.round(18 * scale);
  const cardWidth = (mapWidth - gap * (columns - 1)) / columns;
  const cardHeight = Math.round(144 * scale);
  const statsY = mapY + mapHeight + Math.round(54 * scale);
  metrics.forEach((metric, index) => {
    const col = index % columns, row = Math.floor(index / columns);
    _posterDrawMetric(ctx, metric, pad + col * (cardWidth + gap), statsY + row * (cardHeight + gap),
      cardWidth, cardHeight, theme, scale);
  });

  const footerY = height - Math.round(78 * scale);
  ctx.fillStyle = theme.text;
  ctx.font = `800 ${Math.round(29 * scale)}px ${_POSTER_FONT}`;
  ctx.fillText('FAFA', pad, footerY);
  ctx.fillStyle = theme.subtle;
  ctx.font = `${Math.round(18 * scale)}px ${_POSTER_FONT}`;
  ctx.fillText('骑行数据海报', pad + Math.round(92 * scale), footerY + Math.round(8 * scale));
  ctx.textAlign = 'right';
  ctx.fillText(_posterState.rides.length === 1 ? '1 RIDE' : `${_posterState.rides.length} RIDES`, width - pad, footerY + Math.round(8 * scale));

  status.style.display = 'none';
}

async function downloadPoster() {
  const btn = document.getElementById('poster-download-btn');
  btn.disabled = true;
  btn.textContent = '生成中…';
  try {
    if (_posterState.renderTimer) {
      clearTimeout(_posterState.renderTimer);
      _posterState.renderTimer = null;
      _posterState.renderPromise = _posterRender();
    }
    if (_posterState.renderPromise) await _posterState.renderPromise;
    const canvas = document.getElementById('poster-canvas');
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG 编码失败');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const safeTitle = (_posterState.title || '骑行海报').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 40);
    link.download = `${safeTitle}_${_posterState.ratio.replace(':', '-')}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    toast('海报已生成');
  } catch (error) {
    toast('海报生成失败：' + error.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '下载 PNG';
  }
}

async function _actLoadAllVisible() {
  const list = _actFilteredList();
  if (!list.length) { toast('当前列表没有活动'); return; }
  let loaded = false;
  switchSidebarView('map');
  for (const act of list) {
    let already = false;
    for (const [, t] of tracks) { if (t.filename === act.filename) { already = true; break; } }
    if (already) continue;
    try {
      const res  = await fetch('/api/load', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: act.filename }) });
      if (!res.ok) continue;
      const data = await res.json();
      addTrack(data, { fit: false });
      loaded = true;
    } catch (e) { console.warn('[loadAllTracks] 加载失败:', e); }
  }
  if (loaded) mapFitAll();
}

async function openActivitiesView() {
  const listEl    = document.getElementById('act-list');
  const emptyEl   = document.getElementById('act-empty-hint');
  const loadingEl = document.getElementById('act-loading-hint');
  const labelEl   = document.getElementById('act-parse-label');
  const progressWrap = document.getElementById('act-parse-progress-wrap');
  const bar       = document.getElementById('act-parse-bar');
  const countEl   = document.getElementById('act-parse-count');

  if (_actActivities) {
    _populateYearFilter();
    _renderActivityList(_actFilteredList());
    return;
  }

  listEl.innerHTML = '';
  emptyEl.style.display = 'none';
  labelEl.textContent = '正在加载…';
  progressWrap.style.display = 'none';
  bar.className = 'sync-progress-bar indeterminate';
  bar.style.width = '';
  countEl.textContent = '';
  loadingEl.style.display = '';

  // 轮询解析进度
  let parseTimer = setInterval(async () => {
    try {
      const st = await fetch('/api/parse/status').then(r => r.json());
      if (st.state === 'parsing' && st.total > 0) {
        progressWrap.style.display = '';
        labelEl.textContent = '正在解析 FIT 文件…';
        const pct = Math.round(st.done / st.total * 100);
        bar.classList.remove('indeterminate');
        bar.style.width = pct + '%';
        countEl.textContent = `${st.done} / ${st.total}`;
      }
    } catch (_) {}
  }, 400);

  try {
    const res  = await fetch('/api/activities');
    const data = await res.json();
    clearInterval(parseTimer);
    _actActivities = (data.activities || []).sort((a, b) =>
      (b.start_time || '').localeCompare(a.start_time || ''));
    loadingEl.style.display = 'none';
    progressWrap.style.display = 'none';
    _populateYearFilter();
    _renderActivityList(_actFilteredList());
  } catch (e) {
    clearInterval(parseTimer);
    loadingEl.style.display = 'none';
    progressWrap.style.display = 'none';
    emptyEl.style.display = '';
    emptyEl.textContent = '加载失败，请刷新重试';
  }
}

function _actAppendBatch(listEl) {
  const batch = _actRenderList.slice(_actRenderOffset, _actRenderOffset + _ACT_PAGE);
  if (!batch.length) return;
  // 找出已渲染的最后一个月份头，避免重复插入
  let lastMonthKey = listEl.querySelector('.act-month-header:last-of-type')?.textContent || null;
  // 重新算 lastMonthKey：取已渲染最后一个条目的月份
  if (_actRenderOffset > 0) {
    const prev = _actRenderList[_actRenderOffset - 1];
    const dt = prev.start_time ? new Date(prev.start_time.replace(' ', 'T')) : null;
    lastMonthKey = dt ? `${dt.getFullYear()}年${dt.getMonth() + 1}月` : null;
  } else {
    lastMonthKey = null;
  }
  const frag = document.createDocumentFragment();
  for (const act of batch) {
    const dt = act.start_time ? new Date(act.start_time.replace(' ', 'T')) : null;
    const monthKey = dt ? `${dt.getFullYear()}年${dt.getMonth() + 1}月` : null;
    if (monthKey && monthKey !== lastMonthKey) {
      const header = document.createElement('div');
      header.className = 'act-month-header';
      header.textContent = monthKey;
      frag.appendChild(header);
      lastMonthKey = monthKey;
    }
    frag.appendChild(_buildActivityCard(act));
  }
  listEl.appendChild(frag);
  _actRenderOffset += batch.length;
}

function _renderActivityList(activities) {
  const listEl   = document.getElementById('act-list');
  const emptyEl  = document.getElementById('act-empty-hint');
  const sumBarEl = document.getElementById('act-summary-bar');

  // 断开旧 observer
  if (_actSentinelObs) { _actSentinelObs.disconnect(); _actSentinelObs = null; }
  listEl.innerHTML = '';

  if (!activities.length) {
    emptyEl.style.display = '';
    sumBarEl.style.display = 'none';
    _actRenderList = []; _actRenderOffset = 0;
    return;
  }
  emptyEl.style.display = 'none';

  // Summary bar
  const totalKm = activities.reduce((s, a) => s + ((a.summary || {}).total_dist_km    || 0), 0);
  const totalS  = activities.reduce((s, a) => s + ((a.summary || {}).total_duration_s || 0), 0);
  sumBarEl.style.display = '';
  sumBarEl.innerHTML =
    `<span class="sum-val">${activities.length}</span> 次骑行` +
    `<span class="sum-dot"> · </span>` +
    `<span class="sum-val">${totalKm.toFixed(0)}</span> km` +
    `<span class="sum-dot"> · </span>` +
    `<span class="sum-val">${_fmtDur(totalS)}</span>`;

  _actRenderList   = activities;
  _actRenderOffset = 0;
  _actAppendBatch(listEl);

  if (_actRenderOffset < _actRenderList.length) {
    const sentinel = document.createElement('div');
    sentinel.id = 'act-list-sentinel';
    listEl.appendChild(sentinel);
    _actSentinelObs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        sentinel.remove();
        _actAppendBatch(listEl);
        if (_actRenderOffset < _actRenderList.length) listEl.appendChild(sentinel);
        else { _actSentinelObs.disconnect(); _actSentinelObs = null; }
      }
    }, { rootMargin: '200px' });
    _actSentinelObs.observe(sentinel);
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
// 使整个投影世界的高度刚好等于容器高度的缩放级别。低于它地图上下就会露白、
// 南北极缩进页面内部，所以把它当作最小缩放。
// 返回值通常是小数，需配合建图时的 zoomSnap: 0 才真正可达（见 initMap）。
function _minZoomForViewport() {
  const el = document.getElementById('map');
  const h = el ? el.clientHeight : 0;
  if (!h) return 0;
  const world = map.getPixelWorldBounds(0);
  const worldH = world ? world.getSize().y : 256;   // EPSG3857 下为 256
  return Math.max(0, Math.log2(h / worldH));
}

function _applyMinZoom() {
  if (!map) return;
  const z = _minZoomForViewport();
  // setMinZoom 会在当前缩放低于新下限时自动拉回
  if (Math.abs(z - map.getMinZoom()) > 1e-6) map.setMinZoom(z);
}

// Web Mercator 的纬度截断值，即投影世界的上下边界
const MERCATOR_MAX_LAT = 85.0511287798066;
// 经度给一个远超可达范围的值：maxBounds 会同时约束横纵两个方向，而东西向需要
// 保持无限滚动，用超大经度等价于横向不设限。
const _PAN_LNG_SPAN = 1e5;

// 仅靠 minZoom 还不够：世界高度等于视口高度时，上下拖拽仍会在一端露白。
// 必须走 maxBounds 而不是监听 move 后自行 panTo —— 后者会被自己触发的 move
// 再次调用，递归直到爆栈，届时拖动与滚轮缩放会一起失效。
function _applyPanBounds() {
  if (!map) return;
  map.setMaxBounds(L.latLngBounds(
    [-MERCATOR_MAX_LAT, -_PAN_LNG_SPAN],
    [MERCATOR_MAX_LAT, _PAN_LNG_SPAN],
  ));
}

function initMap() {
  map = L.map('map', {
    center: [30, 116], zoom: 8, zoomControl: false,
    // 必须允许小数缩放：默认 zoomSnap=1 会先把缩放取整再夹到 minZoom，
    // 于是「世界高度正好等于视口」这个小数下限永远到不了，滚轮只能停在上一个整数级。
    zoomSnap: 0,
    maxBoundsViscosity: 1.0,     // 硬边界，不做橡皮筋回弹
  });
  _applyMinZoom();
  _applyPanBounds();
  // 容器尺寸受窗口、侧栏切换、底部轨迹面板拖拽影响，统一用 ResizeObserver 兜住
  const mapEl = document.getElementById('map');
  if (mapEl && window.ResizeObserver) {
    new ResizeObserver(() => _applyMinZoom()).observe(mapEl);
  }
  setTimeout(() => { map.invalidateSize(); _applyMinZoom(); }, 200);
}

function _isCartoTile(name) {
  return TILES[name]?.provider === 'carto';
}

function _tileLayerOptions(name) {
  const tileCfg = TILES[name];
  const opts = { ...tileCfg.opts };
  if (_isCartoTile(name)) opts.subdomains = [..._cartoCdnAvail];
  else if (Array.isArray(tileCfg.opts.subdomains)) opts.subdomains = [...tileCfg.opts.subdomains];
  return opts;
}

function _attachTileRetry(layer) {
  layer.on('tileerror', function (err) {
    const tile = err.tile;
    const retries = +(tile.dataset.retries || 0);
    const subs = Array.from(layer.options.subdomains || []);
    if (retries >= 4 || subs.length < 2) return;

    tile.dataset.retries = retries + 1;
    const { x, y } = err.coords;
    // Leaflet assigns subdomains by |x+y| % n, so a diagonal stripe all hits the same server.
    // On each retry, rotate to the next subdomain to avoid the same failing host.
    const origIdx = Math.abs(x + y) % subs.length;
    const nextIdx = (origIdx + retries + 1) % subs.length;
    const baseUrl = layer.getTileUrl(err.coords);
    const retryUrl = baseUrl.replace(`//${subs[origIdx]}.`, `//${subs[nextIdx]}.`);
    const delay = 1000 * Math.pow(2, retries); // 1s 2s 4s 8s
    setTimeout(() => {
      if (tile.parentNode) {
        tile.src = retryUrl;
      }
    }, delay);
  });
}

async function setTiles(name) {
  const loadToken = ++_tileLayerLoadToken;
  const tileCfg = TILES[name];
  if (!tileCfg) return;

  const available = await _checkTileAvailability(name, { retryUnavailable: true });
  if (loadToken !== _tileLayerLoadToken) return;
  if (!available) {
    toast(`${tileCfg.label} 服务不可用，请切换其他底图`);
    const fallback = 'dark-nolabels';
    if (!tileLayer && !_isCartoTile(name)) {
      document.getElementById('tile-select').value = fallback;
      return setTiles(fallback);
    }
    document.getElementById('tile-select').value = currentTile;
    return;
  }

  if (loadToken !== _tileLayerLoadToken) return;
  currentTile = name;
  for (const track of tracks.values()) renderTrack(track);

  if (tileLayer) map.removeLayer(tileLayer);
  const layer = L.tileLayer(tileCfg.url, _tileLayerOptions(name)).addTo(map);
  _attachTileRetry(layer);
  tileLayer = layer;
}

async function _setDetailTiles(name) {
  const loadToken = ++_detailTileLayerLoadToken;
  if (!detailRouteMap) return;

  const tileCfg = TILES[name];
  if (!tileCfg) return;
  const available = await _checkTileAvailability(name, { retryUnavailable: true });
  if (loadToken !== _detailTileLayerLoadToken || !detailRouteMap) return;
  if (!available) {
    toast(`${tileCfg.label} 服务不可用，请切换其他底图`);
    return;
  }

  if (loadToken !== _detailTileLayerLoadToken || !detailRouteMap) return;
  if (detailRouteTileLayer) detailRouteMap.removeLayer(detailRouteTileLayer);
  detailRouteTileKey = name;
  const layer = L.tileLayer(tileCfg.url, _tileLayerOptions(name)).addTo(detailRouteMap);
  _attachTileRetry(layer);
  detailRouteTileLayer = layer;
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
function addTrack(data, { fit = true } = {}) {
  const id = ++trackCounter;
  const color     = PALETTE[(id - 1) % PALETTE.length];
  const raw       = data.coords;
  const decrypted = decryptCoords(raw);
  const encrypted = encryptCoords(raw);
  const polyline  = L.polyline(raw, { color, weight: 3, opacity: 0.82 }).addTo(map);
  polyline.on('click', () => _focusTrackRow(id));
  const track = { id, name: data.filename, filename: data.filename, raw, decrypted, encrypted, polyline, color, mode: 'raw',
                  source: data.source || 'upload',
                  summary: data.summary || null, kmStats: data.km_stats || [],
                  distStats: data.dist_stats || [], timeStats: data.time_stats || [],
                  timeStatsStart: data.time_stats_start || null,
                  climbs: data.climbs || null };
  tracks.set(id, track);

  renderTrack(track);

  if (fit) mapFitAll();

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

function mapFitAll() {
  if (!tracks.size) return;
  const allBounds = L.latLngBounds([]);
  for (const t of tracks.values()) allBounds.extend(t.polyline.getBounds());
  map.fitBounds(allBounds, { padding: [32, 32], maxZoom: 16 });
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
  if (summary.left_pct != null) {
    const r = (100 - summary.left_pct).toFixed(0);
    chips.push('L ' + summary.left_pct.toFixed(0) + '% / R ' + r + '%');
  }
  if (summary.avg_torque_eff != null)
    chips.push('效率 ' + summary.avg_torque_eff.toFixed(1) + '%');
  if (summary.avg_pedal_smooth != null)
    chips.push('流畅 ' + summary.avg_pedal_smooth.toFixed(1) + '%');
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

/* ── Track panel focus (polyline click → scroll + highlight row) ─────────── */
function _focusTrackRow(id) {
  // Expand panel if collapsed
  if (!panelExpanded) togglePanel();

  const row = document.getElementById(`ti-${id}`);
  if (!row) return;

  // Scroll row into view within the panel list
  row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

  // Highlight animation (restart if already running)
  row.classList.remove('track-item--highlight');
  void row.offsetWidth; // force reflow to restart animation
  row.classList.add('track-item--highlight');
  row.addEventListener('animationend', () => row.classList.remove('track-item--highlight'), { once: true });
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
async function uploadFile(file, { fit = true } = {}) {
  if (!file.name.toLowerCase().endsWith('.fit')) {
    toast(`跳过 ${file.name}：不是 .fit 文件`);
    return null;
  }
  const form = new FormData();
  form.append('file', file);
  let res;
  try {
    res = await fetch('/api/upload', { method: 'POST', body: form });
  } catch {
    toast('上传失败：网络错误');
    return null;
  }
  const data = await res.json();
  if (!res.ok) { toast(`${file.name}：${data.error}`); return null; }
  const id = addTrack(data, { fit });
  _actActivities = null; // invalidate cache so list refreshes
  return id;
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
    let loaded = false;
    for (const file of e.dataTransfer.files) {
      if (await uploadFile(file, { fit: false }) != null) loaded = true;
    }
    if (loaded) mapFitAll();
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
/* ── 详情布局：双栏 / 图表全宽+地图浮窗（偏好存 localStorage）─────────────── */
let _detailMapFloat = localStorage.getItem('detailMapFloat') === '1';
let _mapFloatCollapsed = false;

function _applyDetailMapLayout() {
  const row = document.getElementById('detail-main-row');
  const btn = document.getElementById('detail-layout-btn');
  const section = document.getElementById('detail-route-section');
  if (!row || !section) return;
  row.classList.toggle('map-float', _detailMapFloat);
  if (btn) btn.textContent = _detailMapFloat ? '⊞ 双栏' : '⧉ 浮窗';
  if (_detailMapFloat) {
    if (!section.style.left) { section.style.right = '16px'; section.style.top = '8px'; section.style.left = 'auto'; }
    section.classList.toggle('collapsed', _mapFloatCollapsed);
  } else {
    section.style.left = section.style.top = section.style.right = '';
    section.style.width = section.style.height = '';
    section.classList.remove('collapsed');
  }
  if (detailRouteMap) setTimeout(() => detailRouteMap.invalidateSize(), 60);
}

function _toggleDetailMapFloat() {
  _detailMapFloat = !_detailMapFloat;
  localStorage.setItem('detailMapFloat', _detailMapFloat ? '1' : '0');
  _applyDetailMapLayout();
}

function _toggleMapFloatCollapse() {
  _mapFloatCollapsed = !_mapFloatCollapsed;
  const section = document.getElementById('detail-route-section');
  section.classList.toggle('collapsed', _mapFloatCollapsed);
  document.getElementById('detail-map-float-collapse').textContent = _mapFloatCollapsed ? '▢' : '–';
  if (detailRouteMap && !_mapFloatCollapsed) setTimeout(() => detailRouteMap.invalidateSize(), 60);
}

function _initMapFloatDrag() {
  const bar = document.getElementById('detail-map-float-bar');
  const section = document.getElementById('detail-route-section');
  if (!bar || !section) return;
  let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
  bar.addEventListener('mousedown', e => {
    if (!_detailMapFloat || e.target.id === 'detail-map-float-collapse') return;
    dragging = true;
    const parent = section.offsetParent || section.parentElement;
    const r = section.getBoundingClientRect(), pr = parent.getBoundingClientRect();
    ox = r.left - pr.left; oy = r.top - pr.top;
    section.style.left = ox + 'px'; section.style.top = oy + 'px'; section.style.right = 'auto';
    sx = e.clientX; sy = e.clientY;
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    section.style.left = (ox + e.clientX - sx) + 'px';
    section.style.top = Math.max(0, oy + e.clientY - sy) + 'px';
  });
  document.addEventListener('mouseup', () => { dragging = false; document.body.style.userSelect = ''; });
}

// 浮窗八向缩放：四边 + 四角把手，按方向调整 left/top/width/height
function _initMapFloatResize() {
  const section = document.getElementById('detail-route-section');
  if (!section) return;
  const MINW = 240, MINH = 120;
  let dir = null, sx = 0, sy = 0, sl = 0, st = 0, sw = 0, sh = 0;
  section.querySelectorAll('.map-float-rz').forEach(h => {
    h.addEventListener('mousedown', e => {
      if (!_detailMapFloat) return;
      dir = h.dataset.dir;
      const parent = section.offsetParent || section.parentElement;
      const r = section.getBoundingClientRect(), pr = parent.getBoundingClientRect();
      sl = r.left - pr.left; st = r.top - pr.top; sw = r.width; sh = r.height;
      section.style.left = sl + 'px'; section.style.top = st + 'px';
      section.style.right = 'auto'; section.style.width = sw + 'px'; section.style.height = sh + 'px';
      sx = e.clientX; sy = e.clientY;
      document.body.style.userSelect = 'none';
      e.preventDefault(); e.stopPropagation();
    });
  });
  document.addEventListener('mousemove', e => {
    if (!dir) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    let nl = sl, nt = st, nw = sw, nh = sh;
    if (dir.includes('e')) nw = Math.max(MINW, sw + dx);
    if (dir.includes('s')) nh = Math.max(MINH, sh + dy);
    if (dir.includes('w')) { nw = Math.max(MINW, sw - dx); nl = sl + (sw - nw); }
    if (dir.includes('n')) { nh = Math.max(MINH, sh - dy); nt = st + (sh - nh); }
    section.style.width = nw + 'px'; section.style.height = nh + 'px';
    section.style.left = nl + 'px'; section.style.top = Math.max(0, nt) + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (!dir) return;
    dir = null; document.body.style.userSelect = '';
    if (detailRouteMap) detailRouteMap.invalidateSize();
  });

  // 浏览器缩放时：右上停靠(right 锚点)自动跟随；已拖动过(left/top px)的则夹回可视区
  window.addEventListener('resize', () => {
    if (!_detailMapFloat) return;
    const parent = section.offsetParent || section.parentElement;
    if (!parent) return;
    if (section.style.left && section.style.left !== 'auto') {
      const pr = parent.getBoundingClientRect();
      const maxLeft = Math.max(0, pr.width - section.offsetWidth);
      const maxTop = Math.max(0, pr.height - section.offsetHeight);
      const left = parseFloat(section.style.left) || 0;
      const top = parseFloat(section.style.top) || 0;
      section.style.left = Math.min(maxLeft, Math.max(0, left)) + 'px';
      section.style.top = Math.min(maxTop, Math.max(0, top)) + 'px';
    }
    if (detailRouteMap) detailRouteMap.invalidateSize();
  });
}

const DETAIL_TABLE_COLLAPSED_H = 30;   // 仅表头把手
let _detailTableExpanded = false;

// 展开/收起逐公里数据表；默认收起（可视化较弱，不占版面）
function _setDetailTableExpanded(expanded, height) {
  const section = document.getElementById('detail-table-section');
  const chevron = document.getElementById('detail-table-chevron');
  if (!section) return;
  _detailTableExpanded = expanded;
  section.style.height = (expanded ? (height || 220) : DETAIL_TABLE_COLLAPSED_H) + 'px';
  section.classList.toggle('collapsed', !expanded);
  if (chevron) chevron.textContent = expanded ? '▾' : '▸';
  if (detailRouteMap) detailRouteMap.invalidateSize();
}

function initDetailTableResize() {
  const section = document.getElementById('detail-table-section');
  const handle  = document.getElementById('detail-table-handle');
  const DEFAULT_H = 220;
  let dragging = false, moved = false, startY = 0, startH = 0;

  function contentMaxH() {
    const wrap = document.getElementById('detail-table-wrap');
    return (wrap ? wrap.scrollHeight : 0) + DETAIL_TABLE_COLLAPSED_H;
  }

  function startDrag(clientY) {
    dragging = true; moved = false;
    startY = clientY;
    startH = section.getBoundingClientRect().height;
    document.body.style.userSelect = 'none';
  }
  function doDrag(clientY) {
    if (!dragging) return;
    if (Math.abs(clientY - startY) > 3) { moved = true; document.body.style.cursor = 'ns-resize'; }
    if (!moved) return;
    const maxH = Math.max(DEFAULT_H, contentMaxH());
    const newH = Math.max(DETAIL_TABLE_COLLAPSED_H, Math.min(maxH, startH + (startY - clientY)));
    _setDetailTableExpanded(newH > DETAIL_TABLE_COLLAPSED_H + 8, newH);
  }
  function endDrag() {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    if (!moved) _setDetailTableExpanded(!_detailTableExpanded, DEFAULT_H);  // 未拖动=点击切换
  }

  handle.addEventListener('mousedown',  e => { startDrag(e.clientY); e.preventDefault(); });
  document.addEventListener('mousemove', e => doDrag(e.clientY));
  document.addEventListener('mouseup',   endDrag);
  handle.addEventListener('touchstart', e => { startDrag(e.touches[0].clientY); e.preventDefault(); }, { passive: false });
  document.addEventListener('touchmove', e => { if (dragging) { doDrag(e.touches[0].clientY); e.preventDefault(); } }, { passive: false });
  document.addEventListener('touchend',  endDrag);
}

/* ── Zoom slider ─────────────────────────────────────────────────────────── */
function initZoomSlider() {
  const thumb  = document.getElementById('zoom-thumb');
  const track  = document.getElementById('zoom-track');
  const TRACK_H = 180, THUMB_H = 16, RANGE = TRACK_H - THUMB_H;
  const MAX_Z = 18;

  // 下限随容器高度变化，不能写死：写死后滑块底端与地图实际能到的最小缩放会脱节
  const minZ = () => map.getMinZoom();

  function zoomToTop(z) {
    const lo = minZ();
    if (MAX_Z <= lo) return 0;
    return RANGE * (1 - (Math.max(lo, Math.min(MAX_Z, z)) - lo) / (MAX_Z - lo));
  }
  function topToZoom(top) {
    const lo = minZ();
    const z = lo + (1 - top / RANGE) * (MAX_Z - lo);
    // 拖到最底就给出精确下限，避免取整后又被夹回、缩略图与地图对不上
    return top >= RANGE - 0.5 ? lo : Math.round(z);
  }
  function syncThumb() {
    thumb.style.top = zoomToTop(map.getZoom()) + 'px';
  }

  map.on('zoom zoomend', syncThumb);
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
  // zoomSnap=0 允许小数缩放，按钮仍按整数级走，否则连点会停在 3.27 这类级别上
  document.getElementById('zoom-in-btn').addEventListener('click', () => {
    const z = map.getZoom();
    map.setZoom(Math.min(MAX_Z, Math.floor(z + 1e-6) + 1));
  });
  document.getElementById('zoom-out-btn').addEventListener('click', () => {
    const z = map.getZoom();
    map.setZoom(Math.max(minZ(), Math.ceil(z - 1e-6) - 1));
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

// Compute exact (decimal) zoom so tracks fill image edge-to-edge without clipping
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
  const [x0, y0] = _lngLatToWorld(maxLat, minLon, 0);
  const [x1, y1] = _lngLatToWorld(minLat, maxLon, 0);
  const dx = x1 - x0, dy = y1 - y0;
  // 0.94 = tracks fill central 94% of image, 3% dead zone on each side
  const zoom = Math.min(18, Math.max(0, Math.min(
    Math.log2(W * 0.94 / dx),
    Math.log2(H * 0.94 / dy)
  )));
  return { zoom, minLat, maxLat, minLon, maxLon };
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

const _CARTO_SUBDOMAINS = ['a', 'b', 'c', 'd'];
const _CARTO_PROBE_TIMEOUT_MS = 3000;
let _cartoCdnAvail = [];
let _cartoCdnChecked = false;
let _cartoCdnProbePromise = null;
const _tileProbeResults = new Map();
const _tileProbePromises = new Map();
let _tileSubIdx = 0;

function _probeTileImage(url) {
  return new Promise(resolve => {
    const image = new Image();
    const timer = setTimeout(() => {
      image.onload = null;
      image.onerror = null;
      image.src = '';
      resolve(false);
    }, _CARTO_PROBE_TIMEOUT_MS);
    const finish = available => {
      clearTimeout(timer);
      image.onload = null;
      image.onerror = null;
      resolve(available);
    };
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = url;
  });
}

async function _checkTileAvailability(name, { retryUnavailable = false } = {}) {
  const tileCfg = TILES[name];
  if (!tileCfg) return false;
  if (_isCartoTile(name)) {
    return (await _refreshCdnStatus({ retryUnavailable })).length > 0;
  }

  const provider = tileCfg.provider;
  if (_tileProbeResults.get(provider) === true) return true;
  if (_tileProbeResults.get(provider) === false && !retryUnavailable) return false;
  if (_tileProbePromises.has(provider)) return _tileProbePromises.get(provider);

  const promise = _probeTileImage(tileCfg.probeUrl)
    .then(available => {
      _tileProbeResults.set(provider, available);
      return available;
    })
    .finally(() => { _tileProbePromises.delete(provider); });
  _tileProbePromises.set(provider, promise);
  return promise;
}

async function _refreshCdnStatus({ retryUnavailable = false } = {}) {
  if (_cartoCdnChecked && (_cartoCdnAvail.length || !retryUnavailable)) return _cartoCdnAvail;
  if (_cartoCdnProbePromise) return _cartoCdnProbePromise;

  const probe = async s => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), _CARTO_PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(
        `https://${s}.basemaps.cartocdn.com/dark_nolabels/1/0/0.png`,
        { method: 'HEAD', cache: 'no-store', signal: controller.signal }
      );
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  };

  _cartoCdnProbePromise = Promise.all(_CARTO_SUBDOMAINS.map(probe))
    .then(results => {
      _cartoCdnAvail = _CARTO_SUBDOMAINS.filter((_, i) => results[i]);
      _cartoCdnChecked = true;
      if (_cartoCdnAvail.length) {
        _CARTO_OPTS.subdomains = [..._cartoCdnAvail];
        if (_isCartoTile(currentTile) && tileLayer) {
          tileLayer.options.subdomains = [..._cartoCdnAvail];
        }
        if (_isCartoTile(detailRouteTileKey) && detailRouteTileLayer) {
          detailRouteTileLayer.options.subdomains = [..._cartoCdnAvail];
        }
      }
      return _cartoCdnAvail;
    })
    .finally(() => { _cartoCdnProbePromise = null; });

  return _cartoCdnProbePromise;
}

// zoom: integer tile zoom; scaleFactor: 2^(zoomExact-zoom) scales tiles to match decimal zoom
async function _drawTiles(ctx, zoom, scaleFactor, originX, originY, W, H, urlTemplate, onProgress) {
  const TILE = 256;
  const SCALED = TILE * scaleFactor;
  const CONCURRENCY = 10;
  const maxIdx = Math.pow(2, zoom) - 1;
  const col0 = Math.floor(originX / SCALED);
  const col1 = Math.floor((originX + W - 1) / SCALED);
  const row0 = Math.floor(originY / SCALED);
  const row1 = Math.floor((originY + H - 1) / SCALED);

  // Pre-compute integer pixel boundaries per column/row to eliminate seams.
  // Math.round per-tile causes adjacent tiles to misalign by 1px;
  // computing boundaries from cumulative positions ensures shared edges.
  const colX = [];
  for (let col = col0; col <= col1 + 1; col++)
    colX.push(Math.round(col * SCALED - originX));
  const rowY = [];
  for (let row = row0; row <= row1 + 1; row++)
    rowY.push(Math.round(row * SCALED - originY));

  const tasks = [];
  for (let col = col0; col <= col1; col++) {
    for (let row = row0; row <= row1; row++) {
      const tx = Math.max(0, Math.min(maxIdx, col));
      const ty = Math.max(0, Math.min(maxIdx, row));
      const s = _cartoCdnAvail[(_tileSubIdx++) % _cartoCdnAvail.length];
      const url = urlTemplate.replace('{s}', s).replace('{z}', zoom)
                             .replace('{x}', tx).replace('{y}', ty);
      const px = colX[col - col0], py = rowY[row - row0];
      const pw = colX[col - col0 + 1] - px, ph = rowY[row - row0 + 1] - py;
      tasks.push({ url, px, py, pw, ph });
    }
  }

  let done = 0;
  await new Promise(resolve => {
    if (tasks.length === 0) { resolve(); return; }
    let running = 0, index = 0;

    function pump() {
      while (running < CONCURRENCY && index < tasks.length) {
        const { url, px, py, pw, ph } = tasks[index++];
        running++;
        _loadTileImg(url).then(img => {
          if (img) ctx.drawImage(img, px, py, pw, ph);
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

function _haversineKm(lat1, lon1, lat2, lon2) {
  return _haversineM(lat1, lon1, lat2, lon2) / 1000;
}

function _trackBboxCenter(t) {
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const [lat, lon] of getCoords(t)) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  return [(minLat + maxLat) / 2, (minLon + maxLon) / 2];
}

// Groups trackList into sub-arrays where all tracks within a group have
// centers within thresholdKm of each other (greedy single-pass).
function _groupTracksByDistance(trackList, thresholdKm) {
  const groups = []; // [{tracks, cLat, cLon, sumLat, sumLon}]
  for (const t of trackList) {
    const [lat, lon] = _trackBboxCenter(t);
    let matched = null;
    for (const g of groups) {
      if (_haversineKm(lat, lon, g.cLat, g.cLon) <= thresholdKm) { matched = g; break; }
    }
    if (matched) {
      matched.tracks.push(t);
      matched.sumLat += lat; matched.sumLon += lon;
      const n = matched.tracks.length;
      matched.cLat = matched.sumLat / n;
      matched.cLon = matched.sumLon / n;
    } else {
      groups.push({ tracks: [t], cLat: lat, cLon: lon, sumLat: lat, sumLon: lon });
    }
  }
  return groups.map(g => g.tracks);
}

function _drawTracks(ctx, zoom, originX, originY, colorMode, uniformColor, trackList = null) {
  const allTracks = trackList ?? [...tracks.values()];

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

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function _drawWatermark(ctx, W, H) {
  if (!exportState.watermark) return;

  const sc = H / 1080;
  const pad = Math.round(40 * sc);
  const font = '"PingFang SC","Microsoft YaHei","Helvetica Neue",sans-serif';
  const lSz = Math.round(13 * sc);
  const vSz = Math.round(22 * sc);
  const lGap = Math.round(8 * sc);   // gap between label and value
  const cGap = Math.round(36 * sc);  // gap between two columns
  const rowH = Math.round(30 * sc);  // vertical distance between row baselines

  const allTracks = [...tracks.values()];
  const count = allTracks.length;
  const dists = allTracks.map(t => (t.summary || {}).total_dist_km || 0).filter(d => d > 0);
  const totalKm = dists.reduce((s, d) => s + d, 0);
  const maxDist = dists.length > 0 ? Math.max(...dists) : 0;
  const avgDist = dists.length > 0 ? totalKm / dists.length : 0;

  // 2×2: [col0, col1] per row
  const rows = [
    [{ l: 'Total',   v: totalKm.toFixed(1) + ' km' }, { l: 'Average', v: avgDist.toFixed(1) + ' km' }],
    [{ l: 'Count',   v: String(count) },               { l: 'Max',     v: maxDist.toFixed(1) + ' km' }],
  ];

  ctx.save();
  ctx.shadowBlur = 0;

  // Pre-measure widths for column layout
  const meas = rows.map(row => row.map(({ l, v }) => {
    ctx.font = `${lSz}px ${font}`;
    const lw = ctx.measureText(l).width;
    ctx.font = `bold ${vSz}px ${font}`;
    const vw = ctx.measureText(v).width;
    return { lw, vw };
  }));

  const colW = [0, 1].map(ci =>
    Math.max(...rows.map((_, ri) => meas[ri][ci].lw + lGap + meas[ri][ci].vw))
  );

  // col right edges, both anchored from W - pad
  const colRX = [
    W - pad - colW[1] - cGap,  // col 0 right edge
    W - pad,                    // col 1 right edge
  ];
  const by = H - pad - rowH * 2;

  rows.forEach((row, ri) => {
    const baseline = by + (ri + 1) * rowH;

    row.forEach(({ l, v }, ci) => {
      const { vw } = meas[ri][ci];
      const rx = colRX[ci];

      ctx.font = `bold ${vSz}px ${font}`;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(v, rx, baseline);

      ctx.font = `${lSz}px ${font}`;
      ctx.fillStyle = 'rgba(255,255,255,0.38)';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(l, rx - vw - lGap, baseline);
    });
  });

  // Bottom-left username
  const uname = (exportState.username || '').trim();
  if (uname) {
    const uSz = Math.round(18 * sc);
    ctx.font = `bold ${uSz}px ${font}`;
    ctx.fillStyle = 'rgba(255,255,255,0.80)';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(uname, pad, H - pad);
  }

  ctx.restore();
}

async function _exportGroup(groupTracks, W, H, tileTemplate, suffix, btn) {
  const allCoords = [];
  for (const t of groupTracks) for (const pt of getCoords(t)) allCoords.push(pt);

  const { zoom: zoomExact, minLat, maxLat, minLon, maxLon } = _calcZoom(allCoords, W, H);
  const zoomInt = Math.floor(zoomExact);
  const scaleFactor = Math.pow(2, zoomExact - zoomInt);
  const [_ox, _oy] = _calcOrigin(minLat, maxLat, minLon, maxLon, zoomExact, W, H);
  const originX = Math.round(_ox);
  const originY = Math.round(_oy);

  const TILE = 256;
  const SCALED = TILE * scaleFactor;
  const col0 = Math.floor(originX / SCALED), col1 = Math.floor((originX + W - 1) / SCALED);
  const row0 = Math.floor(originY / SCALED), row1 = Math.floor((originY + H - 1) / SCALED);
  const tileCount = (col1 - col0 + 1) * (row1 - row0 + 1);
  console.log(`[export${suffix}] zoom=${zoomExact.toFixed(3)}, tiles=${tileCount}`);

  const canvas = document.createElement('canvas');
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const _sfx = suffix ? suffix + ' ' : '';
  btn.textContent = `${_sfx}加载地图 0/${tileCount}…`;
  await _drawTiles(ctx, zoomInt, scaleFactor, originX, originY, W, H, tileTemplate, n => {
    btn.textContent = `${_sfx}加载地图 ${n}/${tileCount}…`;
  });

  _drawTracks(ctx, zoomExact, originX, originY, exportState.colorMode, exportState.uniformColor, groupTracks);
  _drawWatermark(ctx, W, H);

  btn.textContent = `${_sfx}PNG 编码中…`;
  const baseName = `fafa_${exportState.resolution}_${exportState.ratio.replace(':', '-')}`;
  await new Promise(resolve => canvas.toBlob(blob => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = suffix ? `${baseName}_${suffix}.png` : `${baseName}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    resolve();
  }, 'image/png'));
}

async function doExport() {
  const btn = document.getElementById('ex-do-btn');
  btn.disabled = true;
  btn.textContent = '生成中…';

  console.group('[export] PNG 导出诊断');
  console.time('[export] 总耗时');

  try {
    const avail = await _refreshCdnStatus();
    if (!avail.length) throw new Error('Carto 地图服务不可用');
    const [W, H] = EXPORT_RESOLUTIONS[exportState.resolution][exportState.ratio];
    const tileTemplate = EXPORT_TILE_URLS[exportState.tile];
    const allTracks = [...tracks.values()];

    const thresholdKm = Math.max(1, exportState.groupThreshold || 500);
    const groups = _groupTracksByDistance(allTracks, thresholdKm);
    console.log(`[export] ${allTracks.length} 条路径分为 ${groups.length} 组（阈值 ${thresholdKm} km）`);

    if (groups.length === 1) {
      await _exportGroup(groups[0], W, H, tileTemplate, '', btn);
    } else {
      for (let i = 0; i < groups.length; i++) {
        await _exportGroup(groups[i], W, H, tileTemplate, String(i + 1), btn);
      }
    }

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

  _detailTileLayerLoadToken++;
  if (detailRouteMap) { detailRouteMap.remove(); detailRouteMap = null; detailRouteTileLayer = null; }
  detailRouteTileKey = null;
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
  if (detailTrackId !== id) return; // 详情视图已切到别的轨迹，丢弃这次过期响应

  _renderDetailCharts(records, t.timeStats);
  _renderDetailTable();
  _setDetailTableExpanded(false);   // 逐公里表默认收起
  _applyDetailMapLayout();          // 应用保存的布局偏好（双栏/浮窗）
  _buildRouteMetricBar();
  _renderDetailRoute();
  _detailWindData = null;
  _detailWindArrow = null;
  _detailWindEnabled = true;
  _detailTotalDurationS = t.summary?.total_duration_s || t.summary?.moving_time_s || 0;
  const _windBtn = document.getElementById('detail-route-wind-btn');
  if (_windBtn) _windBtn.classList.add('active');
  fetch(`/api/weather/${encodeURIComponent(t.name)}`)
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (detailTrackId !== id) return; // 详情视图已切到别的轨迹，丢弃这次过期响应
      if (d?.available && d.hourly) _detailWindData = d;
      if (d?.available) {
        const summaryRow = document.getElementById('detail-summary-row');
        if (summaryRow) {
          const arrow = _windDirArrow(d.wind_dir_deg);
          summaryRow.insertAdjacentHTML('beforeend',
            `<span class="stat-chip">🌬 ${d.wind_speed_avg_kmh} km/h</span>` +
            `<span class="stat-chip">${arrow} ${d.wind_dir_label}</span>` +
            `<span class="stat-chip">逆风 ${d.headwind_pct}% / 顺风 ${d.tailwind_pct}%</span>` +
            (d.gust_max_kmh ? `<span class="stat-chip">阵风 ${d.gust_max_kmh} km/h</span>` : '') +
            (d.source_label ? `<span class="stat-chip" title="风向数据源">📡 ${d.source_label}</span>` : '')
          );
        }
      }
    })
    .catch(() => {});
}

function closeDetailView() {
  document.getElementById('detail-view').classList.remove('active');
  if (_route3DActive) _detailRoute3DTeardown();
  _disposeDetailCharts();
  _detailZoomDrag = null;
  _detailZoomActive = false;
  const resetBtn = document.getElementById('detail-zoom-reset-btn');
  if (resetBtn) resetBtn.style.display = 'none';
  _detailTileLayerLoadToken++;
  if (detailRouteMap) { detailRouteMap.remove(); detailRouteMap = null; detailRouteTileLayer = null; }
  detailRouteTileKey = null;
  detailRouteLayers = [];
  if (_detailRouteHideTimer) { clearTimeout(_detailRouteHideTimer); _detailRouteHideTimer = null; }
  _detailRouteMarker = null;
  _detailRouteCoords = null;
  _detailRouteCumDist = null;
  if (_detailWindArrow && detailRouteMap) detailRouteMap.removeLayer(_detailWindArrow);
  _detailWindArrow = null;
  _detailWindData = null;
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
  for (const chart of detailAuxCharts) {
    try { chart.dispose(); } catch {}
  }
  detailAuxCharts = [];
  // 清除分段对比模块引用，避免关闭后指向已 dispose 的实例
  _segCmpChart = null; _segCmpChartEl = null; _segCmpChipsEl = null; _segCmpMetricBarEl = null; _segCmpToggleBtn = null;
  _detailCompareMode = false; _detailCompareSegs = [];
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
    if (_detailMetaFilename !== filename) return; // 详情视图已切到别的轨迹，丢弃这次过期响应
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

// ── bulk tag picker (multi-select mode) ──────────────────────────────────────

function _positionBulkTagPicker(anchorEl) {
  const picker = document.getElementById('bulk-tag-picker');
  if (!picker || picker.style.display === 'none') return;
  const rect = anchorEl.getBoundingClientRect();
  picker.style.top  = (rect.bottom + 4) + 'px';
  picker.style.left = rect.left + 'px';
  const pr = picker.getBoundingClientRect();
  picker.style.left = Math.max(8, rect.right - pr.width) + 'px';
}

function _openBulkTagPicker(anchorEl) {
  if (!_actSelected.size) { toast('请先选择活动'); return; }
  _bulkTagAnchor  = anchorEl;
  _bulkTagInitial = {};
  _bulkTagIntent  = {};
  const selected = [..._actSelected];
  const total = selected.length;
  _allTags.forEach(tag => {
    const count = selected.filter(fn => {
      const act = (_actActivities || []).find(a => a.filename === fn);
      return act && Array.isArray(act.tags) && act.tags.some(t => t.id === tag.id);
    }).length;
    const state = count === 0 ? 'none' : count === total ? 'all' : 'some';
    _bulkTagInitial[tag.id] = state;
    _bulkTagIntent[tag.id]  = state;
  });
  _renderBulkTagPickerList();
  const picker = document.getElementById('bulk-tag-picker');
  if (!picker) return;
  picker.style.display = 'block';
  _positionBulkTagPicker(anchorEl);
  setTimeout(() => document.addEventListener('click', _bulkPickerOutsideClick), 0);
  window.addEventListener('resize', _onBulkTagPickerResize);
}

function _onBulkTagPickerResize() {
  if (_bulkTagAnchor) _positionBulkTagPicker(_bulkTagAnchor);
}

function _closeBulkTagPicker() {
  const picker = document.getElementById('bulk-tag-picker');
  if (picker) picker.style.display = 'none';
  _bulkTagAnchor = null;
  document.removeEventListener('click', _bulkPickerOutsideClick);
  window.removeEventListener('resize', _onBulkTagPickerResize);
}

function _bulkPickerOutsideClick(e) {
  const picker = document.getElementById('bulk-tag-picker');
  if (picker && !picker.contains(e.target) && e.target.id !== 'act-bulk-tag-btn') {
    _closeBulkTagPicker();
  }
}

function _renderBulkTagPickerList() {
  const list = document.getElementById('bulk-tag-picker-list');
  if (!list) return;
  list.innerHTML = '';
  _allTags.forEach(tag => {
    const chip = document.createElement('button');
    chip.className = 'bulk-tag-chip state-' + _bulkTagIntent[tag.id];
    chip.style.background = tag.color;
    chip.dataset.tagId = tag.id;
    chip.textContent = tag.name;
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const cur = _bulkTagIntent[tag.id];
      _bulkTagIntent[tag.id] = cur === 'none' ? 'all' : cur === 'all' ? 'none' : 'all';
      chip.className = 'bulk-tag-chip state-' + _bulkTagIntent[tag.id];
    });
    list.appendChild(chip);
  });
}

async function _confirmBulkTags() {
  const add_ids    = [];
  const remove_ids = [];
  _allTags.forEach(tag => {
    const initial = _bulkTagInitial[tag.id];
    const intent  = _bulkTagIntent[tag.id];
    if (intent === 'all'  && initial !== 'all')  add_ids.push(tag.id);
    if (intent === 'none' && initial !== 'none') remove_ids.push(tag.id);
  });
  if (!add_ids.length && !remove_ids.length) { _closeBulkTagPicker(); return; }
  const filenames = [..._actSelected];
  try {
    const res = await fetch('/api/meta/batch/tags', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filenames, add_tag_ids: add_ids, remove_tag_ids: remove_ids }),
    });
    if (!res.ok) { toast('标签保存失败'); return; }
    filenames.forEach(fn => {
      const act = (_actActivities || []).find(a => a.filename === fn);
      if (!act) return;
      const curIds = new Set((act.tags || []).map(t => t.id));
      add_ids.forEach(id => curIds.add(id));
      remove_ids.forEach(id => curIds.delete(id));
      const newTags = _allTags.filter(t => curIds.has(t.id));
      _syncActivityTagsInCache(fn, newTags);
    });
    toast('标签已更新');
    _closeBulkTagPicker();
  } catch (_) { toast('标签保存失败'); }
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

/* ── 爬坡分段面板 ─────────────────────────────────────────────────────────── */
// climbfinder 坡度配色分档：下坡 / 0–4 / 4–7 / 7–10 / 10–13 / 13–16 / >16 (%)
const _CLIMB_BANDS = [
  { key: 'descent', label: '下坡'  },
  { key: 'b0',      label: '0–4%'  },
  { key: 'b4',      label: '4–7%'  },
  { key: 'b7',      label: '7–10%' },
  { key: 'b10',     label: '10–13%'},
  { key: 'b13',     label: '13–16%'},
  { key: 'b16',     label: '>16%'  },
];
const _CLIMB_BAND_COLORS = {
  descent: '#6b8cae',   // 下坡 冷灰蓝
  b0:      '#6ab04c',   // 绿
  b4:      '#f0c419',   // 黄
  b7:      '#f0932b',   // 橙
  b10:     '#eb4d4b',   // 红
  b13:     '#b33939',   // 深红
  b16:     '#6c1e9c',   // 紫
};

// 坡度分布 + 连续爬坡段块，渲染进详情左分栏（与功率分布/心率分布同列）
// 连续爬坡段卡片（坡度分布本身已在 _renderDetailDistributions 以竖柱图展示）
function _renderDetailClimbs(wrap) {
  const climbs = tracks.get(detailTrackId)?.climbs;
  if (!wrap || !climbs || (climbs.coverage || 0) < 10 || !climbs.distribution) return;
  if (!climbs.climbs || !climbs.climbs.length) return;   // 无连续爬坡段则不显示卡片区

  const cardsHtml = climbs.climbs.map((c, i) => {
    const distKm = c.distance_m >= 1000
      ? (c.distance_m / 1000).toFixed(1) + ' km'
      : Math.round(c.distance_m) + ' m';
    const atKm = (c.start_distance_m / 1000).toFixed(1);
    const maxc = c.max_grade_pct != null ? c.max_grade_pct.toFixed(1) : '—';
    return `<div class="climb-card">
      <div class="climb-card-head">爬坡 ${i + 1} <span class="climb-card-at">@ ${atKm} km</span></div>
      <div class="climb-card-body">
        <span><b>${distKm}</b><em>距离</em></span>
        <span><b>${Math.round(c.elevation_gain_m)} m</b><em>爬升</em></span>
        <span><b>${c.avg_grade_pct.toFixed(1)}%</b><em>均坡</em></span>
        <span><b>${maxc}%</b><em>最大</em></span>
      </div>
    </div>`;
  }).join('');

  const block = document.createElement('div');
  block.className = 'detail-chart-block climb-block';
  block.innerHTML =
    `<div class="detail-chart-label">连续爬坡段</div>
     <div class="climb-cards">${cardsHtml}</div>`;
  wrap.appendChild(block);
}

/* ── 3D 路线可视化（Three.js，经 window.Route3D 桥接）───────────────────────── */
let _route3DActive = false;

// 从当前详情记录序列取出带坐标的点，喂给 RouteScene
function _detailRoute3DRecords() {
  const src = _detailRecordsRef || [];
  const out = [];
  for (const r of src) {
    if (Number.isFinite(r.lat) && Number.isFinite(r.lon)) {
      out.push({ lat: r.lat, lon: r.lon, altitude: r.altitude, grade: r.grade, timestamp: r.timestamp });
    }
  }
  return out;
}

// 3D 激活时隐藏 2D 专属控件（指标切换条 / 图例 / 风向按钮），退出时恢复
function _detailRoute3DToggle2D(show) {
  const disp = show ? '' : 'none';
  const bar = document.getElementById('detail-route-metric-bar');
  const legend = document.getElementById('detail-route-legend');
  const wind = document.getElementById('detail-route-wind-btn');
  if (bar) bar.style.display = disp;
  if (legend) legend.style.display = disp;
  if (wind) wind.style.display = disp;
}

function _detailRoute3DTeardown() {
  try { window.Route3D?.unmount(); } catch {}
  _route3DActive = false;
  const layer = document.getElementById('detail-route-3d');
  const btn = document.getElementById('detail-route-3d-btn');
  const hint = document.getElementById('detail-route-3d-hint');
  if (layer) layer.style.display = 'none';
  if (btn) { btn.classList.remove('active'); btn.textContent = '3D'; btn.title = '3D 路线'; }
  if (hint) hint.textContent = '';
  _detailRoute3DToggle2D(true);
}

function toggleDetailRoute3D() {
  if (!window.Route3D) { toast('3D 模块未加载'); return; }
  if (_route3DActive) { _detailRoute3DTeardown(); return; }

  const records = _detailRoute3DRecords();
  if (records.length < 2) { toast('本次骑行无坐标数据，无法生成 3D 路线'); return; }

  const layer = document.getElementById('detail-route-3d');
  const canvas = document.getElementById('detail-route-3d-canvas');
  const btn = document.getElementById('detail-route-3d-btn');
  if (!layer || !canvas) return;
  layer.style.display = 'block';
  const inst = window.Route3D.mount(canvas, records, { transparent: false, showGround: true });
  if (!inst) { layer.style.display = 'none'; toast('3D 场景初始化失败'); return; }
  _route3DActive = true;
  if (btn) { btn.classList.add('active'); btn.textContent = '2D'; btn.title = '返回 2D 地图'; }
  _detailRoute3DToggle2D(false);
  _detailRoute3DSyncSpinUI();
}

function _detailRoute3DPalette(name, el) {
  if (!_route3DActive) return;
  window.Route3D?.setPalette(name);
  document.querySelectorAll('#detail-route-3d-palettes .det-route-metric-btn')
    .forEach(b => b.classList.toggle('active', b === el));
}

// 旋转开关
function _detailRoute3DSpin(el) {
  if (!_route3DActive) return;
  const on = !window.Route3D.isSpinning();
  window.Route3D.setSpinning(on);
  el.classList.toggle('active', on);
  el.textContent = on ? '旋转' : '静止';
}

// 转速拉手：value 1(慢)–10(快) → 每圈秒数 44−value*4（4–40s）
function _detailRoute3DSpeed(value) {
  if (!_route3DActive) return;
  window.Route3D.setSpinDuration(44 - Number(value) * 4);
}

// 地面方位罗盘开关
function _detailRoute3DCompass(el) {
  if (!_route3DActive) return;
  const on = !el.classList.contains('active');
  window.Route3D.setCompass(on);
  el.classList.toggle('active', on);
}

// 挂载后同步旋转控件初始态（默认旋转开、中速）
function _detailRoute3DSyncSpinUI() {
  const btn = document.getElementById('detail-route-3d-spin-btn');
  const speed = document.getElementById('detail-route-3d-speed');
  if (btn) { btn.classList.add('active'); btn.textContent = '旋转'; }
  if (speed) { speed.value = 5; window.Route3D.setSpinDuration(44 - 5 * 4); }
  const compass = document.getElementById('detail-route-3d-compass-btn');
  if (compass) { compass.classList.remove('active'); window.Route3D.setCompass(false); }
}

async function _detailRoute3DAddPhotos(event) {
  const input = event.target;
  const files = input.files;
  if (!files || !files.length || !_route3DActive) return;
  const hint = document.getElementById('detail-route-3d-hint');
  if (hint) hint.textContent = '解析照片…';
  try {
    const res = await window.Route3D.addPhotos(files);
    if (hint) {
      if (res.added) {
        const gps = res.methods.filter(m => m === '照片 GPS').length;
        const parts = [`已添加 ${res.added} 张`];
        if (gps) parts.push(`${gps} 张 GPS 定位`);
        hint.textContent = parts.join(' · ');
      } else {
        hint.textContent = '未识别到可用照片';
      }
    }
  } catch (e) {
    if (hint) hint.textContent = '照片解析失败';
  } finally {
    input.value = '';
  }
}


function _buildRouteMetricBar() {
  const t = tracks.get(detailTrackId);
  if (!t) return;
  const bar = document.getElementById('detail-route-metric-bar');
  if (!bar) return;
  const probe = t.distStats.length ? t.distStats : t.kmStats;
  const available = METRICS.filter(m => !m.noRoute && probe.some(s => s[m.field] != null));
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
    if (Math.abs(endPx - startPx) <= 8) return;
    if (_detailCompareMode) {
      _addCompareSegment(chart, Math.min(startPx, endPx), Math.max(startPx, endPx));
    } else {
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

// 详情页分布柱状块（功率分布 / 心率分布）——纵向柱，内联样式，复用 zone 配色
function _detailDistBlock(title, sub, items, isDark, unit = 'min') {
  const BAR_H = 140;
  const block = document.createElement('div');
  block.className = 'detail-chart-block';

  const lbl = document.createElement('div');
  lbl.className = 'detail-chart-label';
  lbl.innerHTML = `${title}${sub ? `  <span style="color:${isDark ? '#666' : '#999'};font-weight:400">${sub}</span>` : ''}`;
  block.appendChild(lbl);

  const valColor   = isDark ? '#bbb' : '#555';
  const labelColor = isDark ? '#888' : '#666';
  const subColor   = isDark ? '#666' : '#999';
  // 网格风格沿用详情页折线图：浅色横向分隔线 + 轴线
  const gridColor   = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)';
  const borderColor = isDark ? '#2a2a2a' : '#ddd';
  const tickPcts    = [100, 75, 50, 25, 0]; // 自上而下

  // Y 轴刻度区（百分比标签 + 横向网格线），与柱区共享 BAR_H 高度
  const gridLines = tickPcts.map(p => {
    const top = (100 - p) / 100 * BAR_H;
    return `<div style="position:absolute;left:0;right:0;top:${top}px;border-top:1px solid ${gridColor}"></div>`;
  }).join('');
  const yTicks = tickPcts.map(p => {
    const top = (100 - p) / 100 * BAR_H;
    return `<div style="position:absolute;right:4px;top:${top}px;transform:translateY(-50%);font-size:9px;color:${subColor};line-height:1">${p}</div>`;
  }).join('');

  const cols = items.map(it => {
    const barPx = it.pct > 0 ? Math.max(2, Math.round(it.pct / 100 * BAR_H)) : 0;
    return `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%">
        <span style="font-size:10px;color:${valColor};margin-bottom:3px">${it.pct.toFixed(1)}%</span>
        <div style="width:100%;max-width:34px;height:${barPx}px;background:${it.color};border-radius:3px 3px 0 0"></div>
      </div>`;
  }).join('');
  const labels = items.map(it => `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center">
        <span style="font-size:11px;color:${labelColor}">${it.label}</span>
        <span style="font-size:10px;color:${subColor};margin-top:1px">${it.count}${unit}</span>
      </div>`).join('');

  const chart = document.createElement('div');
  chart.style.cssText = 'padding:14px 4px 0;';
  chart.innerHTML = `
    <div style="display:flex;align-items:flex-end">
      <div style="position:relative;width:24px;height:${BAR_H}px">${yTicks}</div>
      <div style="position:relative;flex:1;height:${BAR_H}px;border-left:1px solid ${borderColor}">
        ${gridLines}
        <div style="position:absolute;left:0;right:0;bottom:0;display:flex;align-items:flex-end;gap:6px;height:100%;padding:0 4px">${cols}</div>
      </div>
    </div>
    <div style="display:flex;gap:6px;padding:5px 4px 0 28px">${labels}</div>`;
  block.appendChild(chart);
  return block;
}

function _renderDetailDistributions(wrap, records) {
  if (!records || !records.length) return;
  const isDark = !document.body.classList.contains('light-theme');
  const ftp   = (typeof _pmcConfig !== 'undefined' && _pmcConfig.ftp)   ? _pmcConfig.ftp   : 0;
  const blocks = [];

  // 功率分布 — Coggan 7 区（%FTP），与 PMC 体能管理页一致；零功率/无数据计为休息，不计入百分比
  if (ftp > 0 && records.some(r => r.power != null)) {
    const z = new Array(8).fill(0); // 0=休息, 1-7=Z1-Z7
    for (const r of records) {
      const p = r.power;
      if (p == null) continue;
      if (p <= 0) { z[0]++; continue; }
      const ratio = p / ftp;
      let i;
      if      (ratio < 0.55) i = 1;
      else if (ratio < 0.75) i = 2;
      else if (ratio < 0.90) i = 3;
      else if (ratio < 1.05) i = 4;
      else if (ratio < 1.20) i = 5;
      else if (ratio < 1.50) i = 6;
      else                   i = 7;
      z[i]++;
    }
    const pedalS = z.slice(1).reduce((a, b) => a + b, 0);
    if (pedalS > 0) {
      const items = Array.from({ length: 7 }, (_, idx) => {
        const i = idx + 1;
        return { label: `Z${i}`, pct: z[i] / pedalS * 100, count: Math.round(z[i] / 60), color: POWER_ZONE_COLORS[i - 1] };
      });
      blocks.push(_detailDistBlock('功率分布', `FTP ${ftp} W`, items, isDark));
    }
  }

  // 心率分布 — 按当前分区算法(最大心率/储备/阈值)分桶
  const hrDef = _hrZoneDef();
  if (hrDef && records.some(r => r.hr != null)) {
    const n = hrDef.colors.length;
    const h = new Array(n).fill(0);
    for (const r of records) {
      if (r.hr == null) continue;
      h[_hrZoneBucket(r.hr, hrDef)]++;
    }
    const totalS = h.reduce((a, b) => a + b, 0);
    if (totalS > 0) {
      const items = Array.from({ length: n }, (_, i) => ({
        label: hrDef.labels[i], pct: h[i] / totalS * 100, count: Math.round(h[i] / 60), color: hrDef.colors[i],
      }));
      blocks.push(_detailDistBlock('心率分布', hrDef.caption, items, isDark));
    }
  }

  // 坡度分布 — 竖柱图，与功率/心率分布同款；柱下标注该带距离(km)
  const climbs = tracks.get(detailTrackId)?.climbs;
  if (climbs && (climbs.coverage || 0) >= 10 && climbs.distribution) {
    const dist = climbs.distribution;
    const totalKm = records.length ? (records[records.length - 1].dist_m || 0) / 1000 : 0;
    const items = _CLIMB_BANDS.map(b => {
      const pct = dist[b.key] || 0;
      const km = totalKm * pct / 100;
      return { label: b.label, pct, count: km >= 10 ? Math.round(km) : km.toFixed(1), color: _CLIMB_BAND_COLORS[b.key] };
    });
    const rep = climbs.representative_grade, maxG = climbs.max_grade;
    const sub = (rep != null ? `代表 ${rep.toFixed(1)}%` : '') +
                (rep != null && maxG != null ? ' · ' : '') +
                (maxG != null ? `最大 ${maxG.toFixed(1)}%` : '');
    blocks.push(_detailDistBlock('坡度分布', sub, items, isDark, ' km'));
  }

  if (!blocks.length) return;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:16px;flex-wrap:wrap;';
  for (const b of blocks) {
    b.style.flex = '1 1 240px';
    b.style.minWidth = '0';
    row.appendChild(b);
  }
  wrap.appendChild(row);
}

// "HH:MM:SS" → 当日秒数（用于计算段时长，跨零点自动补 24h）
function _tSec(t) {
  if (!t) return null;
  const p = t.split(':');
  if (p.length !== 3) return null;
  return (+p[0]) * 3600 + (+p[1]) * 60 + (+p[2]);
}

// ── 体力衰竭：有氧解耦（Pw:HR 或 速度:HR 前后半程漂移）───────────────────────
function _renderDetailFatigue(wrap, records) {
  if (!records || records.length < 120) return;   // 数据不足，跳过
  const isDark = !document.body.classList.contains('light-theme');

  const hasPower = records.some(r => r.power != null && r.power > 0);
  const outField = hasPower ? 'power' : 'speed_kmh';
  const outLabel = hasPower ? '功率' : '速度';
  const outUnit  = hasPower ? 'W' : 'km/h';
  const outColor = hasPower ? '#f39c12' : '#2e86de';

  // 有效样本：心率 > 0 且有输出 > 0（视为运动中）
  const efRaw = records.map(r => {
    const out = r[outField], hr = r.hr;
    if (hr == null || hr <= 0 || out == null || out <= 0) return null;
    return out / hr;   // 效率因子：单位心跳产出
  });
  const validCount = efRaw.filter(v => v != null).length;
  if (validCount < 60) return;

  // 前后半程均值（按有效样本序列切半），用 均输出/均心率 更稳健
  const moving = [];
  for (let i = 0; i < records.length; i++) {
    if (efRaw[i] == null) continue;
    moving.push({ out: records[i][outField], hr: records[i].hr });
  }
  const half = Math.floor(moving.length / 2);
  const _mean = (arr, k) => arr.reduce((a, b) => a + b[k], 0) / (arr.length || 1);
  const first = moving.slice(0, half), second = moving.slice(half);
  const out1 = _mean(first, 'out'),  hr1 = _mean(first, 'hr');
  const out2 = _mean(second, 'out'), hr2 = _mean(second, 'hr');
  const ratio1 = out1 / hr1, ratio2 = out2 / hr2;
  const decouple = (ratio1 - ratio2) / ratio1 * 100;   // 正值 = 后半程效率下降 = 疲劳漂移

  let level, levelColor;
  if      (decouple < 5)  { level = '有氧耐力良好'; levelColor = '#27ae60'; }
  else if (decouple < 8)  { level = '轻度衰竭';     levelColor = '#f1c40f'; }
  else                    { level = '明显衰竭';     levelColor = '#e74c3c'; }

  // 滚动平滑的效率因子曲线（±30 样本，忽略空值），供可视化漂移趋势
  const W = 30;
  const n = efRaw.length;
  const pre = new Float64Array(n + 1), preCnt = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) {
    pre[i + 1]    = pre[i]    + (efRaw[i] != null ? efRaw[i] : 0);
    preCnt[i + 1] = preCnt[i] + (efRaw[i] != null ? 1 : 0);
  }
  const efSmooth = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (efRaw[i] == null) continue;
    const lo = Math.max(0, i - W), hi = Math.min(n, i + W + 1);
    const cnt = preCnt[hi] - preCnt[lo];
    if (cnt > 0) efSmooth[i] = (pre[hi] - pre[lo]) / cnt;
  }

  const block = document.createElement('div');
  block.className = 'detail-chart-block';

  const subColor = isDark ? '#888' : '#999';
  const lbl = document.createElement('div');
  lbl.className = 'detail-chart-label';
  lbl.innerHTML = `体力衰竭 · 有氧解耦` +
    `  <span style="color:${subColor};font-weight:400">${outLabel}:心率效率因子</span>`;
  block.appendChild(lbl);

  // 指标行（解耦率 + 前后半程对比）
  const chipStyle = `display:inline-block;padding:3px 9px;margin:2px 6px 2px 0;border-radius:6px;` +
    `font-size:12px;background:${isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'};color:${isDark ? '#ccc' : '#444'}`;
  const chips = document.createElement('div');
  chips.style.cssText = 'padding:6px 2px 2px;';
  chips.innerHTML =
    `<span style="${chipStyle};color:${levelColor};font-weight:600">解耦率 ${decouple >= 0 ? '+' : ''}${decouple.toFixed(1)}% · ${level}</span>` +
    `<span style="${chipStyle}">前半程 ${out1.toFixed(hasPower ? 0 : 1)} ${outUnit} / ${hr1.toFixed(0)} bpm</span>` +
    `<span style="${chipStyle}">后半程 ${out2.toFixed(hasPower ? 0 : 1)} ${outUnit} / ${hr2.toFixed(0)} bpm</span>`;
  block.appendChild(chips);

  const cw = document.createElement('div');
  cw.className = 'detail-chart-canvas-wrap';
  block.appendChild(cw);
  wrap.appendChild(block);

  const gridColor   = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)';
  const borderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)';
  const tickColor   = isDark ? '#555' : '#999';
  const tooltipBg   = isDark ? 'rgba(15,15,20,0.94)' : 'rgba(255,255,255,0.97)';
  const tooltipBorder = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)';
  const tooltipTitle  = isDark ? '#888' : '#999';
  const tooltipBody   = isDark ? '#ddd' : '#333';

  const chart = echarts.init(cw, null, { renderer: 'svg' });
  chart.setOption({
    animation: false,
    backgroundColor: 'transparent',
    grid: { top: 6, bottom: 22, left: 44, right: 8, containLabel: false },
    xAxis: {
      type: 'category', data: records.map(r => r.t), boundaryGap: false,
      axisLine: { lineStyle: { color: borderColor } }, axisTick: { show: false },
      axisLabel: { color: tickColor, fontSize: 10, interval: 'auto' }, splitLine: { show: false },
    },
    yAxis: {
      type: 'value', scale: true, axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: tickColor, fontSize: 10, formatter: v => v.toFixed(2) },
      splitLine: { lineStyle: { color: gridColor } },
    },
    series: [{
      type: 'line', data: efSmooth, symbol: 'none', connectNulls: false,
      lineStyle: { color: outColor, width: 1.5 }, areaStyle: { color: outColor, opacity: 0.06 },
      emphasis: { disabled: true },
      markLine: {
        silent: true, symbol: 'none',
        lineStyle: { color: levelColor, type: 'dashed', width: 1, opacity: 0.7 },
        label: { show: false },
        data: [{ yAxis: ratio1 }, { yAxis: ratio2 }],
      },
    }],
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: 'rgba(128,128,160,0.3)', width: 1 } },
      backgroundColor: tooltipBg, borderColor: tooltipBorder, borderWidth: 1,
      textStyle: { color: tooltipBody, fontSize: 11 },
      formatter: params => {
        const p = params[0];
        const val = p.value != null ? p.value.toFixed(3) : '无数据';
        return `<span style="color:${tooltipTitle}">${p.name}</span><br/>效率因子: ${val}`;
      },
    },
  });
  const ro = new ResizeObserver(() => { try { chart.resize(); } catch {} });
  ro.observe(cw);
  detailChartResizeObservers.push(ro);
  detailAuxCharts.push(chart);
}

// ── 分段平行对比：手动框选任意 N 段，按距离归零叠加曲线 ─────────────────────
// 各记录累计距离(米)：优先用后端 dist_m；缺失则由速度积分近似
function _recordsCumDist(records) {
  if (records.some(r => r.dist_m != null)) {
    let last = 0;
    return records.map(r => { if (r.dist_m != null) last = r.dist_m; return last; });
  }
  const cum = new Array(records.length);
  let d = 0, prevT = null;
  for (let i = 0; i < records.length; i++) {
    const t = _tSec(records[i].t);
    let dt = 1;
    if (prevT != null && t != null) { dt = t - prevT; if (dt < 0) dt += 24 * 3600; if (dt <= 0 || dt > 60) dt = 1; }
    prevT = t;
    const v = records[i].speed_kmh;
    if (v != null) d += (v / 3.6) * dt;
    cum[i] = d;
  }
  return cum;
}

// 叠加曲线可选指标（仅保留 records 中有数据者）
function _compareMetrics(records) {
  return METRICS.filter(m => m.rField && !m.series &&
    ['speed', 'hr', 'power', 'cadence', 'altitude'].includes(m.key) &&
    records.some(r => r[m.rField] != null));
}

function _renderDetailSegments(wrap, records) {
  if (!records || records.length < 60) return;
  const isDark = !document.body.classList.contains('light-theme');

  // 每次进入详情页重置对比状态
  _detailCompareMode = false;
  _detailCompareSegs = [];
  _detailCumDistM = _recordsCumDist(records);
  const metrics = _compareMetrics(records);
  if (!metrics.length) return;
  if (!metrics.find(m => m.key === _detailCompareMetric)) _detailCompareMetric = metrics[0].key;

  const subColor = isDark ? '#888' : '#999';
  const block = document.createElement('div');
  block.className = 'detail-chart-block';
  block.dataset.segBlock = '1';

  // 标题 + 框选开关
  const lbl = document.createElement('div');
  lbl.className = 'detail-chart-label';
  lbl.style.cssText = 'display:flex;align-items:center;justify-content:space-between;';
  const btnGroup = document.createElement('span');
  btnGroup.style.cssText = 'display:flex;gap:4px;';
  const autoBtn = document.createElement('button');
  autoBtn.textContent = '自动分段（转向）';
  autoBtn.style.cssText = 'border:none;cursor:pointer;padding:3px 10px;border-radius:5px;font-size:11px;' +
    `background:transparent;color:${subColor}`;
  autoBtn.onclick = () => {
    const segs = _autoSegmentByTurns(_detailRecordsRef || []);
    if (!segs) { toast('未检测到足够明显的转弯，无法自动分段'); return; }
    _detailCompareSegs = segs;
    _updateCompareChips();
    _updateCompareChart();
    toast(`已按转向自动生成 ${segs.length} 段`);
  };
  const toggle = document.createElement('button');
  toggle.textContent = '框选对比';
  toggle.style.cssText = 'border:none;cursor:pointer;padding:3px 10px;border-radius:5px;font-size:11px;' +
    `background:transparent;color:${subColor}`;
  _segCmpToggleBtn = toggle;
  toggle.onclick = () => { _setCompareMode(!_detailCompareMode); };
  btnGroup.append(autoBtn, toggle);
  const title = document.createElement('span');
  title.textContent = '分段平行对比 · 距离叠加';
  lbl.appendChild(title);
  lbl.appendChild(btnGroup);
  block.appendChild(lbl);

  // 提示
  const hint = document.createElement('div');
  hint.style.cssText = `font-size:11px;color:${subColor};padding:4px 2px 0;`;
  hint.textContent = '「自动分段」按转向角把路线自动切成若干段；或开启「框选对比」在上方曲线拖拽手动选段，可多选；各段起点距离归零后叠加对比。';
  block.appendChild(hint);

  // 指标切换条
  const metricBar = document.createElement('div');
  metricBar.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;padding:8px 2px 4px;';
  _segCmpMetricBarEl = metricBar;
  for (const m of metrics) {
    const b = document.createElement('button');
    b.textContent = m.label;
    b.dataset.mkey = m.key;
    b.style.cssText = 'border:none;cursor:pointer;padding:2px 9px;border-radius:5px;font-size:11px;';
    b.onclick = () => { _detailCompareMetric = m.key; _updateCompareMetricBar(isDark); _updateCompareChart(); };
    metricBar.appendChild(b);
  }
  block.appendChild(metricBar);

  // 已选段 chips
  const chips = document.createElement('div');
  chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;padding:2px 2px 6px;min-height:4px;';
  _segCmpChipsEl = chips;
  block.appendChild(chips);

  // 叠加图
  const cw = document.createElement('div');
  cw.className = 'detail-chart-canvas-wrap';
  _segCmpChartEl = cw;
  block.appendChild(cw);
  wrap.appendChild(block);

  _segCmpChart = echarts.init(cw, null, { renderer: 'svg' });
  detailAuxCharts.push(_segCmpChart);
  const ro = new ResizeObserver(() => { try { _segCmpChart.resize(); } catch {} });
  ro.observe(cw);
  detailChartResizeObservers.push(ro);

  _updateCompareMetricBar(isDark);
  _updateCompareChips();
  _updateCompareChart();
}

function _setCompareMode(on) {
  _detailCompareMode = on;
  const isDark = !document.body.classList.contains('light-theme');
  const btn = _segCmpToggleBtn;
  if (btn) {
    btn.style.background = on ? '#2e86de' : 'transparent';
    btn.style.color = on ? '#fff' : (isDark ? '#888' : '#999');
    btn.textContent = on ? '框选中 · 点此结束' : '框选对比';
  }
  // 框选模式下暂时关闭缩放态提示
  if (on && _detailZoomActive) _resetDetailZoom();
}

function _updateCompareMetricBar(isDark) {
  if (!_segCmpMetricBarEl) return;
  _segCmpMetricBarEl.querySelectorAll('button[data-mkey]').forEach(b => {
    const active = b.dataset.mkey === _detailCompareMetric;
    b.style.background = active ? (isDark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.1)') : 'transparent';
    b.style.color = active ? (isDark ? '#eee' : '#222') : (isDark ? '#888' : '#999');
    b.style.fontWeight = active ? '600' : '400';
  });
}

// 按转向角自动分段：沿累计距离每 ~25m 重采样一次经纬度，用重采样点间的方位角
// 变化识别转弯，转弯点作为分段边界；邻近转弯合并、过短分段丢弃，最多给出
// COMPARE_COLORS.length 段。找不到足够转弯时返回 null。
function _autoSegmentByTurns(records) {
  if (!records?.length || !_detailCumDistM) return null;
  const pts = [];
  for (let i = 0; i < records.length; i++) {
    const r = records[i];
    if (Number.isFinite(r.lat) && Number.isFinite(r.lon)) {
      pts.push({ i, lat: r.lat, lon: r.lon, cum: _detailCumDistM[i] });
    }
  }
  if (pts.length < 20) return null;   // 无坐标或点数太少，判不了转弯

  const STEP_M = 25;
  const sampled = [pts[0]];
  for (const p of pts) {
    if (p.cum - sampled[sampled.length - 1].cum >= STEP_M) sampled.push(p);
  }
  if (sampled[sampled.length - 1] !== pts[pts.length - 1]) sampled.push(pts[pts.length - 1]);
  if (sampled.length < 6) return null;

  const bearing = (a, b) => {
    const phi1 = a.lat * Math.PI / 180, phi2 = b.lat * Math.PI / 180;
    const dLambda = (b.lon - a.lon) * Math.PI / 180;
    const y = Math.sin(dLambda) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  };
  const angleDiff = (a, b) => ((b - a + 540) % 360) - 180;

  const TURN_DEG = 40;    // 转弯判定阈值
  const MERGE_M  = 60;    // 邻近转弯点合并半径
  const MIN_SEG_M = 300;  // 最短分段，太短的转弯边界直接丢弃

  const turns = [];
  for (let k = 1; k < sampled.length - 1; k++) {
    const b1 = bearing(sampled[k - 1], sampled[k]);
    const b2 = bearing(sampled[k], sampled[k + 1]);
    const delta = Math.abs(angleDiff(b1, b2));
    if (delta >= TURN_DEG) turns.push({ idx: sampled[k].i, cum: sampled[k].cum, delta });
  }
  if (!turns.length) return null;

  const merged = [];
  for (const t of turns) {
    const last = merged[merged.length - 1];
    if (last && t.cum - last.cum < MERGE_M) { if (t.delta > last.delta) merged[merged.length - 1] = t; }
    else merged.push(t);
  }

  const bounds = [0, ...merged.map(t => t.idx), records.length - 1];
  const cleaned = [bounds[0]];
  for (let k = 1; k < bounds.length; k++) {
    const prevCum = _detailCumDistM[cleaned[cleaned.length - 1]];
    const curCum = _detailCumDistM[bounds[k]];
    if (curCum - prevCum < MIN_SEG_M) {
      if (k === bounds.length - 1 && cleaned.length > 1) {
        // 末尾不足最短距离时去掉前一个边界，把短尾段并入上一段。
        cleaned[cleaned.length - 1] = bounds[k];
      }
      continue;
    }
    cleaned.push(bounds[k]);
  }
  if (cleaned[cleaned.length - 1] !== bounds[bounds.length - 1]) cleaned.push(bounds[bounds.length - 1]);

  let segs = [];
  for (let k = 0; k < cleaned.length - 1; k++) segs.push({ i0: cleaned[k], i1: cleaned[k + 1] });
  segs = segs.filter(s => s.i1 - s.i0 >= 5);
  if (segs.length > COMPARE_COLORS.length) {
    const routeEnd = segs[segs.length - 1].i1;
    segs = segs.slice(0, COMPARE_COLORS.length);
    segs[segs.length - 1].i1 = routeEnd;  // 超出颜色数的尾段合并，仍覆盖完整路线
  }
  return segs.length >= 2 ? segs : null;
}

function _addCompareSegment(chart, minPx, maxPx) {
  const labels = chart.getOption().xAxis[0].data;
  if (!labels || labels.length < 2) return;
  let i0 = Math.round(chart.convertFromPixel({ xAxisIndex: 0 }, minPx));
  let i1 = Math.round(chart.convertFromPixel({ xAxisIndex: 0 }, maxPx));
  if (i0 > i1) [i0, i1] = [i1, i0];
  i0 = Math.max(0, i0);
  i1 = Math.min(labels.length - 1, i1);
  if (i1 - i0 < 5) { toast('选区太短'); return; }
  if (_detailCompareSegs.length >= COMPARE_COLORS.length) { toast('最多 ' + COMPARE_COLORS.length + ' 段'); return; }
  _detailCompareSegs.push({ i0, i1 });
  _updateCompareChips();
  _updateCompareChart();
}

function _updateCompareChips() {
  if (!_segCmpChipsEl) return;
  const recs = _detailRecordsRef;
  _segCmpChipsEl.innerHTML = '';
  if (!_detailCompareSegs.length) {
    const empty = document.createElement('span');
    empty.style.cssText = 'font-size:11px;color:#999;';
    empty.textContent = _detailCompareMode ? '在曲线上拖拽以添加对比段…' : '尚未选择对比段';
    _segCmpChipsEl.appendChild(empty);
    return;
  }
  _detailCompareSegs.forEach((seg, idx) => {
    const color = COMPARE_COLORS[idx];
    const label = String.fromCharCode(65 + idx); // A,B,C…
    const km = recs ? ((_detailCumDistM[seg.i1] - _detailCumDistM[seg.i0]) / 1000) : 0;
    const chip = document.createElement('span');
    chip.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:3px 8px;border-radius:6px;' +
      `font-size:11px;background:${color}22;color:${color};border:1px solid ${color}55;`;
    chip.innerHTML = `<b>${label}</b> ${recs ? recs[seg.i0].t : ''}→${recs ? recs[seg.i1].t : ''} · ${km.toFixed(1)}km` +
      `<span data-rm="${idx}" style="cursor:pointer;font-weight:700;margin-left:2px">✕</span>`;
    chip.querySelector('[data-rm]').onclick = () => {
      _detailCompareSegs.splice(idx, 1);
      _updateCompareChips();
      _updateCompareChart();
    };
    _segCmpChipsEl.appendChild(chip);
  });
  if (_detailCompareSegs.length) {
    const clr = document.createElement('span');
    clr.textContent = '清空';
    clr.style.cssText = 'cursor:pointer;font-size:11px;color:#999;padding:3px 4px;text-decoration:underline;';
    clr.onclick = () => { _detailCompareSegs = []; _updateCompareChips(); _updateCompareChart(); };
    _segCmpChipsEl.appendChild(clr);
  }
}

function _updateCompareChart() {
  if (!_segCmpChart) return;
  const recs = _detailRecordsRef;
  const isDark = !document.body.classList.contains('light-theme');
  const gridColor   = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)';
  const borderColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)';
  const tickColor   = isDark ? '#555' : '#999';
  const tooltipBg   = isDark ? 'rgba(15,15,20,0.94)' : 'rgba(255,255,255,0.97)';
  const tooltipBorder = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)';
  const tooltipBody   = isDark ? '#ddd' : '#333';
  const meta = METRICS.find(m => m.key === _detailCompareMetric) || METRICS[0];

  _segCmpChart.clear();
  if (!recs || !_detailCompareSegs.length) {
    _segCmpChart.setOption({
      backgroundColor: 'transparent',
      title: { text: '选择至少一段后在此按距离叠加', left: 'center', top: 'middle',
        textStyle: { color: tickColor, fontSize: 12, fontWeight: 400 } },
    });
    return;
  }

  const series = _detailCompareSegs.map((seg, idx) => {
    const color = COMPARE_COLORS[idx];
    const base = _detailCumDistM[seg.i0];
    const data = [];
    for (let k = seg.i0; k <= seg.i1; k++) {
      const y = recs[k][meta.rField];
      if (y == null) continue;
      data.push([(_detailCumDistM[k] - base) / 1000, y]);
    }
    return { type: 'line', name: '段' + String.fromCharCode(65 + idx), data, symbol: 'none',
      lineStyle: { color, width: 1.5 }, itemStyle: { color }, connectNulls: false, emphasis: { disabled: true } };
  });

  _segCmpChart.setOption({
    animation: false, backgroundColor: 'transparent',
    grid: { top: 24, bottom: 30, left: 44, right: 8, containLabel: false },
    legend: { data: series.map(s => s.name), textStyle: { color: tickColor, fontSize: 10 },
      itemWidth: 12, itemHeight: 8, top: 2, right: 8 },
    xAxis: { type: 'value', name: '距离 km', nameLocation: 'middle', nameGap: 18,
      nameTextStyle: { color: tickColor, fontSize: 10 },
      axisLine: { lineStyle: { color: borderColor } }, axisTick: { show: false },
      axisLabel: { color: tickColor, fontSize: 10, formatter: v => v.toFixed(1) },
      splitLine: { show: false } },
    yAxis: { type: 'value', scale: meta.key !== 'altitude', name: meta.unit,
      nameTextStyle: { color: tickColor, fontSize: 10 },
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: tickColor, fontSize: 10 }, splitLine: { lineStyle: { color: gridColor } } },
    series,
    tooltip: { trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: 'rgba(128,128,160,0.3)', width: 1 } },
      backgroundColor: tooltipBg, borderColor: tooltipBorder, borderWidth: 1,
      textStyle: { color: tooltipBody, fontSize: 11 },
      formatter: params => {
        const km = params[0]?.axisValue;
        const head = `距离 ${(+km).toFixed(2)} km`;
        const lines = params.map(p => `<span style="color:${p.color}">●</span> ${p.seriesName}: ${p.value[1]} ${meta.unit}`);
        return `${head}<br/>${lines.join('<br/>')}`;
      } },
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
    const isDual = meta.series && meta.series.length > 0;

    // dual-series: records-only; fallback to single avg if no records
    const hasData = isDual && useRecords
      ? meta.series.some(s => records.some(r => r[s.rField] != null))
      : useRecords
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

    let labels, seriesList;
    if (isDual && useRecords) {
      labels = records.map(r => r.t);
      seriesList = meta.series.map(s => ({
        type: 'line',
        name: s.label,
        data: records.map(r => r[s.rField] ?? null),
        symbol: 'none',
        lineStyle: { color: s.color, width: 1.5 },
        areaStyle: { color: s.color, opacity: 0.04 },
        connectNulls: false,
        emphasis: { disabled: true },
      }));
    } else if (useRecords) {
      labels = records.map(r => r.t);
      let data = records.map(r => r[meta.rField] ?? null);
      if (meta.key === 'altitude') {
        const firstValid = data.findIndex(v => v != null);
        if (firstValid > 0) { labels = labels.slice(firstValid); data = data.slice(firstValid); }
      }
      seriesList = [{ type: 'line', data, symbol: 'none',
        lineStyle: { color: meta.color, width: 1.5 },
        areaStyle: { color: meta.color, opacity: 0.06 },
        connectNulls: false, emphasis: { disabled: true } }];
    } else {
      const t0 = track?.timeStatsStart ? new Date(track.timeStatsStart) : null;
      labels = (fallbackStats || []).map((_, i) => {
        if (!t0) return (i + 1) + ' min';
        const d = new Date(t0.getTime() + i * 60000);
        return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
      });
      const data = (fallbackStats || []).map(s => s[meta.field] ?? null);
      seriesList = [{ type: 'line', data, symbol: 'none',
        lineStyle: { color: meta.color, width: 1.5 },
        areaStyle: { color: meta.color, opacity: 0.06 },
        connectNulls: false, emphasis: { disabled: true } }];
    }

    const chart = echarts.init(cw, null, { renderer: 'svg' });
    chart.group = 'detail';
    chart.setOption({
      animation: false,
      backgroundColor: 'transparent',
      grid: { top: isDual ? 22 : 6, bottom: 22, left: 44, right: 8, containLabel: false },
      legend: isDual ? {
        data: meta.series.map(s => s.label),
        textStyle: { color: tickColor, fontSize: 10 },
        itemWidth: 12, itemHeight: 8,
        right: 8, top: 2,
      } : undefined,
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
        min: meta.key === 'altitude' ? 'dataMin' : undefined,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: tickColor, fontSize: 10 },
        splitLine: { lineStyle: { color: gridColor } },
      },
      series: seriesList,
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: 'rgba(128,128,160,0.3)', width: 1 } },
        backgroundColor: tooltipBg,
        borderColor: tooltipBorder,
        borderWidth: 1,
        textStyle: { color: tooltipBody, fontSize: 11 },
        formatter: isDual
          ? params => {
              const time = params[0]?.name || '';
              const lines = params.map(p => {
                const val = p.value != null ? `${p.value} ${meta.unit}` : '无数据';
                return `<span style="color:${p.color}">●</span> ${p.seriesName}: ${val}`;
              });
              return `<span style="color:${tooltipTitle}">${time}</span><br/>${lines.join('<br/>')}`;
            }
          : params => {
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

  _renderDetailDistributions(wrap, useRecords ? records : null);
  _renderDetailClimbs(wrap);

  _detailRecordsRef = useRecords ? records : null;
  if (useRecords) {
    _renderDetailFatigue(wrap, records);
    _renderDetailSegments(wrap, records);
  }
}

// Returns index of first element in arr >= val (leftmost binary search).
function _bisectLeft(arr, val) {
  let lo = 0, hi = arr.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < val) lo = m + 1; else hi = m; }
  return lo;
}

function _updateDetailRouteMarker(dataIdx) {
  if (_detailRouteHideTimer) { clearTimeout(_detailRouteHideTimer); _detailRouteHideTimer = null; }
  // 3D 模式：图表滑动暂停飞览，把骑行点移到对应进度
  if (_route3DActive) {
    const s = window.Route3D?.scene;
    if (s) { s.playing = false; s.setProgress(dataIdx / Math.max(1, _detailChartDataLen - 1)); }
    return;
  }
  if (!detailRouteMap || !_detailRouteCoords || !_detailRouteCumDist) return;
  const totalDist = _detailRouteCumDist[_detailRouteCumDist.length - 1];
  const targetDist = _detailChartIsRecords
    ? (dataIdx / Math.max(1, _detailChartDataLen - 1)) * totalDist
    : (dataIdx + 0.5) * _detailRouteStepM;

  const lo = _bisectLeft(_detailRouteCumDist, targetDist);
  const latlng = _detailRouteCoords[lo];
  if (!latlng) return;

  const _hasWind = _detailWindEnabled && _detailWindData?.hourly && _detailTotalDurationS > 0;
  if (!_hasWind) {
    if (!_detailRouteMarker) {
      _detailRouteMarker = L.circleMarker(latlng, {
        radius: 6, color: '#fff', weight: 2, fillColor: '#2e86de', fillOpacity: 1,
      }).addTo(detailRouteMap);
    } else {
      _detailRouteMarker.setLatLng(latlng);
    }
  } else if (_detailRouteMarker && detailRouteMap) {
    detailRouteMap.removeLayer(_detailRouteMarker);
    _detailRouteMarker = null;
  }

  if (_hasWind && detailRouteMap) {
    const totalDist = _detailRouteCumDist[_detailRouteCumDist.length - 1];
    const elapsedS  = (targetDist / Math.max(totalDist, 1)) * _detailTotalDurationS;
    const wind = _getHourlyWind(_detailWindData.hourly, _detailWindData.start_epoch, elapsedS);
    if (wind) {
      const bearing = _bearingByTimeWindow(elapsedS);
      const effect  = _windEffect(bearing, wind.dir);
      const color   = effect === 'headwind' ? '#e74c3c' : effect === 'tailwind' ? '#27ae60' : '#f39c12';
      const icon = L.divIcon({
        className: '',
        html: `<div style="transform:rotate(${(wind.dir + 180) % 360}deg);text-align:center;line-height:1;filter:drop-shadow(0 0 2px #000)">`
             + `<svg width="14" height="22" viewBox="0 0 14 22" xmlns="http://www.w3.org/2000/svg"><polygon points="7,0 14,10 10,10 10,22 4,22 4,10 0,10" fill="${color}"/></svg>`
             + `</div>`
             + `<div style="font-size:10px;color:#fff;text-align:center;text-shadow:0 0 2px #000;white-space:nowrap">${wind.speed} km/h</div>`,
        iconSize: [36, 36],
        iconAnchor: [18, 11],
      });
      if (!_detailWindArrow) {
        _detailWindArrow = L.marker(latlng, { icon, interactive: false }).addTo(detailRouteMap);
      } else {
        _detailWindArrow.setLatLng(latlng);
        _detailWindArrow.setIcon(icon);
      }
    }
  }
}

function _hideDetailRouteMarker() {
  if (_route3DActive) {
    const s = window.Route3D?.scene;
    if (s) s.playing = true;   // 移出图表恢复自动飞览
    return;
  }
  _detailRouteHideTimer = setTimeout(() => {
    _detailRouteHideTimer = null;
    if (_detailRouteMarker && detailRouteMap) {
      detailRouteMap.removeLayer(_detailRouteMarker);
      _detailRouteMarker = null;
    }
    if (_detailWindArrow && detailRouteMap) {
      detailRouteMap.removeLayer(_detailWindArrow);
      _detailWindArrow = null;
    }
  }, 60);
}

function _toggleDetailWind() {
  _detailWindEnabled = !_detailWindEnabled;
  const btn = document.getElementById('detail-route-wind-btn');
  if (btn) btn.classList.toggle('active', _detailWindEnabled);
  if (!_detailWindEnabled && _detailWindArrow && detailRouteMap) {
    detailRouteMap.removeLayer(_detailWindArrow);
    _detailWindArrow = null;
  }
}

function _getHourlyWind(hourly, startEpoch, elapsedS) {
  const times  = hourly.time || [];
  const speeds = hourly.windspeed_10m || [];
  const dirs   = hourly.winddirection_10m || [];
  const targetHour = Math.floor((startEpoch + elapsedS) / 3600);
  for (let i = 0; i < times.length; i++) {
    const h = Math.floor(new Date(times[i] + 'Z').getTime() / 3_600_000);
    if (h === targetHour) return { speed: Math.round(speeds[i] * 10) / 10, dir: dirs[i] };
  }
  return null;
}

function _bearingAtIndex(idx) {
  const coords = _detailRouteCoords;
  const i1 = Math.min(idx + 1, coords.length - 1);
  if (i1 === idx) return 0;
  const dlat = coords[i1][0] - coords[idx][0];
  const dlon = coords[i1][1] - coords[idx][1];
  const latM = Math.PI / 180 * ((coords[idx][0] + coords[i1][0]) / 2);
  return (Math.atan2(dlon * Math.cos(latM), dlat) * 180 / Math.PI + 360) % 360;
}

// Bearing computed over a ±3-minute sliding window centred on elapsedS.
// Converts the time window to a distance range via uniform-pace assumption,
// then takes the bearing from the window-start GPS point to the window-end point.
function _bearingByTimeWindow(elapsedS) {
  const coords  = _detailRouteCoords;
  const cumDist = _detailRouteCumDist;
  if (!coords || !cumDist || _detailTotalDurationS <= 0) return 0;
  const totalDist = cumDist[cumDist.length - 1];
  const HALF_WIN  = 180; // seconds

  const d0 = (Math.max(0,                      elapsedS - HALF_WIN) / _detailTotalDurationS) * totalDist;
  const d1 = (Math.min(_detailTotalDurationS,   elapsedS + HALF_WIN) / _detailTotalDurationS) * totalDist;

  const lo0 = _bisectLeft(cumDist, d0);
  const lo1 = _bisectLeft(cumDist, d1);

  // If window collapses to a single point, fall back to adjacent-point bearing
  if (lo0 >= lo1) return _bearingAtIndex(lo0);

  const dlat = coords[lo1][0] - coords[lo0][0];
  const dlon = coords[lo1][1] - coords[lo0][1];
  const latM = Math.PI / 180 * ((coords[lo0][0] + coords[lo1][0]) / 2);
  return (Math.atan2(dlon * Math.cos(latM), dlat) * 180 / Math.PI + 360) % 360;
}

function _windEffect(bearing, windFromDir) {
  const rel = (bearing - windFromDir + 360) % 360;
  if (rel < 45 || rel > 315) return 'headwind';
  if (rel > 135 && rel < 225) return 'tailwind';
  return 'crosswind';
}

function _detailRouteFitBounds() {
  if (_route3DActive) { window.Route3D?.scene?.resetCamera(); return; }
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

// 心率分区定义 — 三种算法：maxhr(%最大心率) / hrr(储备心率 Karvonen) / lthr(%阈值心率 Friel)
// 返回 null 表示所选模式缺少必要参数，调用方回退到无分区渲染。
// bounds 为比率阈值，桶数 = bounds.length + 1；colors/labels 与桶数等长。
// boundBpm[i] 为第 i 个阈值对应的心率(bpm)，用于图例；low/high 为图例心率轴范围。
function _hrZoneDef() {
  const mode = _pmcConfig.hrZoneMode || 'maxhr';
  const { maxHr, restHr, lthr } = _pmcConfig;
  if (mode === 'lthr') {
    if (!(lthr > 0)) return null;
    const bounds = [0.81, 0.90, 0.94, 1.00];      // Friel 骑行阈值心率 5 区
    return {
      mode, ratio: hr => hr / lthr,
      bounds,
      labels: ['Z1', 'Z2', 'Z3', 'Z4', 'Z5'],
      colors: HR_ZONE_COLORS.slice(1, 6),
      boundBpm: bounds.map(b => b * lthr),
      low: 0, high: lthr * 1.2,
      caption: `阈值心率 ${lthr} bpm`,
    };
  }
  if (mode === 'hrr') {
    if (!(maxHr > 0) || !(maxHr > restHr)) return null;
    const bounds = [0.50, 0.60, 0.70, 0.80, 0.90]; // 储备心率百分比
    return {
      mode, ratio: hr => (hr - restHr) / (maxHr - restHr),
      bounds,
      labels: ['<Z1', 'Z1', 'Z2', 'Z3', 'Z4', 'Z5'],
      colors: HR_ZONE_COLORS.slice(),
      boundBpm: bounds.map(b => restHr + b * (maxHr - restHr)),
      low: 0, high: maxHr,
      caption: `储备心率 ${restHr}–${maxHr} bpm`,
    };
  }
  if (!(maxHr > 0)) return null;
  const bounds = [0.50, 0.60, 0.70, 0.80, 0.90];   // 最大心率百分比
  return {
    mode: 'maxhr', ratio: hr => hr / maxHr,
    bounds,
    labels: ['<Z1', 'Z1', 'Z2', 'Z3', 'Z4', 'Z5'],
    colors: HR_ZONE_COLORS.slice(),
    boundBpm: bounds.map(b => b * maxHr),
    low: 0, high: maxHr,
    caption: `最大心率 ${maxHr} bpm`,
  };
}

// 依据分区定义把心率值映射到桶索引（0-based）
function _hrZoneBucket(hr, def) {
  const r = def.ratio(hr);
  let i = 0;
  while (i < def.bounds.length && r >= def.bounds[i]) i++;
  return i;
}

function _hrZoneColor(hr, def) {
  return def.colors[_hrZoneBucket(hr, def)];
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
  // 心率分区：按当前算法(最大心率/储备/阈值)取分区定义；缺参数时回退线性热力
  let hrDef = scale?.zone ? _hrZoneDef() : null;
  if (scale?.zone && !hrDef) scale = null;
  const ftp   = scale?.coggan ? _pmcConfig.ftp   : null;
  const minVal = (scale?.zone || scale?.coggan) ? (scale?.zone ? hrDef.low : 0) : (scale ? scale.min : dataMin);
  const maxVal = scale?.zone ? hrDef.high : scale?.coggan ? ftp * 2 : (scale ? scale.max : dataMax);

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
    void _setDetailTiles(tileKey);
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
      color = _hrZoneColor(val ?? 0, hrDef);
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
    // 从分区定义拼接图例：每个桶 [上一阈值, 当前阈值] 一段纯色，位置按心率轴归一化
    const span = hrDef.high - hrDef.low || 1;
    const stops = [];
    let prev = 0; // 桶起点位置(%)
    hrDef.colors.forEach((c, i) => {
      const endBpm = i < hrDef.boundBpm.length ? hrDef.boundBpm[i] : hrDef.high;
      const end = Math.max(prev, Math.min(100, (endBpm - hrDef.low) / span * 100));
      stops.push(`${c} ${prev}%, ${c} ${end}%`);
      prev = end;
    });
    legendBar.style.background = `linear-gradient(to right, ${stops.join(', ')})`;
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
    legendBar.style.background = 'linear-gradient(to right, hsl(240,88%,56%), hsl(120,88%,56%), hsl(60,88%,56%), hsl(0,88%,56%))';
  }
  const marker = document.getElementById('detail-route-legend-marker');
  if (marker && scale) {
    const pos = scale.zone
      ? Math.max(0, Math.min(1, (dataMax - hrDef.low) / (hrDef.high - hrDef.low)))
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
  _initTheme();
  initMap();
  void _loadDefaultTile();
  setupDragDrop();
  initZoomSlider();
  initPanelResize();
  initDetailSplitResize();
  initDetailTableResize();
  _initMapFloatDrag();
  _initMapFloatResize();
  document.getElementById('act-ai-chat-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _sendAiChat(); }
  });

  // Activities view is default home
  switchSidebarView('activities');

  document.getElementById('tile-select').addEventListener('change', e => {
    void setTiles(e.target.value);
  });

  _setupOptGroup('ex-tile-group', 'tile');
  _setupOptGroup('ex-color-group', 'colorMode');
  _setupOptGroup('ex-ratio-group', 'ratio');
  _setupOptGroup('ex-res-group', 'resolution');
  document.getElementById('ex-color-picker').addEventListener('input', e => {
    exportState.uniformColor = e.target.value;
  });
  document.getElementById('ex-watermark-check').addEventListener('change', e => {
    exportState.watermark = e.target.checked;
    document.getElementById('ex-username-row').style.display = e.target.checked ? 'block' : 'none';
  });
  document.getElementById('ex-username-input').addEventListener('input', e => {
    exportState.username = e.target.value;
  });
  document.getElementById('ex-group-threshold').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    exportState.groupThreshold = isNaN(v) || v < 1 ? 500 : v;
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (document.getElementById('prompts-modal').style.display === 'flex') closePromptsModal();
      else if (document.getElementById('poster-modal').style.display === 'flex') closePosterModal();
      else if (document.getElementById('compare-modal').style.display === 'flex') closeCompareModal();
      else if (document.getElementById('cal-act-modal').classList.contains('active')) calCloseActivityModal();
      else if (aiTrackId != null) closeAiView();
      else if (detailTrackId != null) closeDetailView();
      // analytics and files are sidebar views; no ESC needed
    }
  });

  document.addEventListener('mousedown', e => {
    if (e.button !== 3) return;
    e.preventDefault();
    if (document.getElementById('poster-modal').style.display === 'flex') closePosterModal();
    else if (document.getElementById('cal-act-modal').classList.contains('active')) calCloseActivityModal();
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

  // 初始加载文件库计数 & AI 配置
  refreshLibraryCount();
  _initAiConfig();
  _loadPmcConfig();
  _loadAllTags();
  _initDetailNoteButtons();

  document.getElementById('act-upload-input')?.addEventListener('change', async e => {
    let loaded = false;
    for (const file of e.target.files) {
      if (await uploadFile(file, { fit: false }) != null) loaded = true;
    }
    if (loaded) mapFitAll();
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

function _libExportZip(filenames = null) {
  if (filenames && !filenames.length) { toast('请先选择文件'); return; }
  toast('正在打包 FIT 文件，请稍候…');
  if (!filenames) {
    const a = document.createElement('a');
    a.href = '/api/files/export';
    a.download = 'fafa_all_fit.zip';
    a.click();
    return;
  }
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = '/api/files/export';
  form.style.display = 'none';
  for (const filename of filenames) {
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'filename';
    input.value = filename;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

function _libExportAll() {
  if (!_libFiles.length) { toast('没有可导出的 FIT 文件'); return; }
  _libExportZip();
}

function _libExportSelected() {
  _libExportZip([..._libSelectedSet]);
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

const _SYNC_PLATFORM_DESC = {
  onelap: '点击开始后，程序会自动打开浏览器，请在其中完成顽鹿账号登录，登录后将自动下载新的骑行文件。',
  igpsport: '将自动使用设置中配置的 iGPSport 账号密码登录，下载新的骑行文件。',
};

function _syncUpdatePlatformDesc() {
  const el = document.querySelector('input[name="sync-platform"]:checked');
  const platform = el ? el.value : 'onelap';
  const desc = document.getElementById('sync-platform-desc');
  if (desc) desc.textContent = _SYNC_PLATFORM_DESC[platform] || '';
}

function openSyncModal() {
  document.getElementById('sync-modal').style.display = 'flex';
  document.getElementById('sync-idle-view').style.display = '';
  document.getElementById('sync-progress-view').style.display = 'none';
  document.querySelectorAll('input[name="sync-platform"]').forEach(r => {
    r.addEventListener('change', _syncUpdatePlatformDesc);
  });
  _syncUpdatePlatformDesc();
}

function closeSyncModal() {
  if (_syncPollTimer) { clearInterval(_syncPollTimer); _syncPollTimer = null; }
  document.getElementById('sync-modal').style.display = 'none';
}

async function startSync() {
  const full = document.getElementById('sync-full').checked;
  const platformEl = document.querySelector('input[name="sync-platform"]:checked');
  const platform = platformEl ? platformEl.value : 'onelap';
  document.getElementById('sync-idle-view').style.display = 'none';
  document.getElementById('sync-progress-view').style.display = '';
  document.getElementById('sync-close-btn').disabled = true;
  _setSyncUI('正在启动…', 0, 0);

  try {
    const res = await fetch('/api/sync/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform, full }),
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
    const res  = await fetch('/api/sync/status');
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
      _actActivities = null;
      _pmcAllData    = null;
      _calActivities = null;
      if (_sidebarView === 'activities') {
        openActivitiesView();
      } else if (_analyticsOpen) {
        if (_analyticsTab === 'pmc') _loadAndRenderPmc();
        else if (_analyticsTab === 'calendar') _loadAndRenderCalendar();
      }
    }
  } catch (e) { console.warn('[_pollSync] 轮询出错:', e); }
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

const STRAVA_AUTH_MSG_DEFAULT = '需要先完成 Strava 授权。请点击侧栏「设置」填写 Strava 凭据，然后点击授权。';

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
    const res = await fetch('/api/strava/auth_url', { method: 'POST' });
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
    toast('请点击侧栏「设置」配置 Strava 凭据');
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
    toast('请点击侧栏「设置」配置 Strava 凭据');
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
    toast('请点击侧栏「设置」配置 Strava 凭据');
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
    if (cfg.pmc_lthr    != null) _pmcConfig.lthr   = cfg.pmc_lthr;
    if (cfg.pmc_weight  != null) _pmcConfig.weight = cfg.pmc_weight;
    if (cfg.hr_zone_mode)        _pmcConfig.hrZoneMode = cfg.hr_zone_mode;
    if (cfg.route_grade_min   != null) _routeScaleCfg.gradeMin   = cfg.route_grade_min;
    if (cfg.route_grade_max   != null) _routeScaleCfg.gradeMax   = cfg.route_grade_max;
    if (cfg.route_speed_max   != null) _routeScaleCfg.speedMax   = cfg.route_speed_max;
    if (cfg.route_cadence_max != null) _routeScaleCfg.cadenceMax = cfg.route_cadence_max;
  } catch {
    _pmcConfig.ftp    = parseInt(localStorage.getItem('pmc_ftp')     || '200', 10);
    _pmcConfig.maxHr  = parseInt(localStorage.getItem('pmc_max_hr')  || '190', 10);
    _pmcConfig.restHr = parseInt(localStorage.getItem('pmc_rest_hr') || '50',  10);
    _pmcConfig.lthr   = parseInt(localStorage.getItem('pmc_lthr')    || '0',   10);
    _pmcConfig.weight = parseFloat(localStorage.getItem('pmc_weight') || '0');
    _pmcConfig.hrZoneMode = localStorage.getItem('hr_zone_mode') || 'maxhr';
  }
}

async function openAiView() {
  const id = detailTrackId;
  const t  = tracks.get(id);
  if (!t) return;
  if (!_aiModel) { toast('AI 未配置，请点击侧栏「设置」进行配置'); return; }
  aiTrackId = id;

  const chips = _statChips(t.summary || {});
  let windData = null;
  try {
    const wr = await fetch(`/api/weather/${encodeURIComponent(t.name || '')}`);
    if (wr.ok) { const wd = await wr.json(); if (wd.available) windData = wd; }
  } catch {}
  let weatherHtml = '';
  if (windData) {
    const arrow = _windDirArrow(windData.wind_dir_deg);
    weatherHtml =
      `<span class="stat-chip">🌬️ ${windData.wind_speed_avg_kmh} km/h</span>` +
      `<span class="stat-chip">${arrow} ${windData.wind_dir_label}</span>` +
      `<span class="stat-chip">逆风${windData.headwind_pct}% / 顺风${windData.tailwind_pct}%</span>`;
  }
  await _openAndStreamModal(
    (t.name || '').replace(/\.fit$/i, ''),
    chips.map(c => `<span class="stat-chip">${c}</span>`).join('') + weatherHtml,
    () => fetch('/api/ai/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary:    t.summary        || {},
        km_stats:   t.kmStats        || [],
        dist_stats: t.distStats      || [],
        time_stats: t.timeStats      || [],
        filename:   t.name           || '',
        start_time: t.timeStatsStart || '',
        wind_data:  windData,
      }),
    }),
    _AI_EVAL_SYS_MSG
  );
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
      请点击侧栏「设置」填入 API Key 进行配置。
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
      _setErrorHtml(result, d.error || '请求失败，请点击侧栏「设置」检查配置');
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
  div.textContent = message || '请求失败，请点击侧栏「设置」检查配置';
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

function _escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[ch]);
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

/* ── Settings view ──────────────────────────────────────────────────────── */
async function loadSettingsView() {
  loadTokens();
  loadAdminUsers();
  try {
    const cfg = await fetch('/api/config/raw').then(r => r.json());
    document.getElementById('cfg-map-tile').value          = TILES[cfg.map_tile] ? cfg.map_tile : 'dark-nolabels';
    document.getElementById('cfg-pmc-ftp').value           = cfg.pmc_ftp              ?? '';
    document.getElementById('cfg-pmc-rest-hr').value       = cfg.pmc_rest_hr          ?? '';
    document.getElementById('cfg-pmc-max-hr').value        = cfg.pmc_max_hr           ?? '';
    document.getElementById('cfg-pmc-lthr').value          = cfg.pmc_lthr             ?? '';
    document.getElementById('cfg-hr-zone-mode').value      = cfg.hr_zone_mode         || 'maxhr';
    document.getElementById('cfg-pmc-weight').value        = cfg.pmc_weight           ?? '';
    document.getElementById('cfg-route-grade-min').value   = cfg.route_grade_min      ?? '';
    document.getElementById('cfg-route-grade-max').value   = cfg.route_grade_max      ?? '';
    document.getElementById('cfg-route-speed-max').value   = cfg.route_speed_max      ?? '';
    document.getElementById('cfg-route-cadence-max').value = cfg.route_cadence_max    ?? '';
    document.getElementById('cfg-wind-source').value   = cfg.wind_source          || 'auto';
    document.getElementById('cfg-api-base').value      = cfg.api_base             ?? '';
    document.getElementById('cfg-api-key').value       = cfg.api_key              ?? '';
    document.getElementById('cfg-model').value         = cfg.model                ?? '';
    document.getElementById('cfg-max-tokens').value    = cfg.max_tokens           ?? '';
    document.getElementById('cfg-onelap-user').value   = cfg.onelap_username      ?? '';
    document.getElementById('cfg-onelap-pass').value   = cfg.onelap_password      ?? '';
    document.getElementById('cfg-igp-user').value      = cfg.igpsport_username    ?? '';
    document.getElementById('cfg-igp-pass').value      = cfg.igpsport_password    ?? '';
    document.getElementById('cfg-strava-id').value     = cfg.strava_client_id     ?? '';
    document.getElementById('cfg-strava-secret').value = cfg.strava_client_secret ?? '';
    document.getElementById('cfg-strava-port').value   = cfg.strava_redirect_port ?? '';
  } catch { toast('加载配置失败'); }
}

async function saveSettings() {
  const btn = document.getElementById('settings-save-btn');
  const val = id => document.getElementById(id).value.trim();
  const num = id => { const v = parseFloat(document.getElementById(id).value); return isNaN(v) ? null : v; };
  const cfg = {
    map_tile:            val('cfg-map-tile')      || 'dark-nolabels',
    pmc_ftp:              num('cfg-pmc-ftp'),
    pmc_rest_hr:          num('cfg-pmc-rest-hr'),
    pmc_max_hr:           num('cfg-pmc-max-hr'),
    pmc_lthr:             num('cfg-pmc-lthr'),
    hr_zone_mode:         val('cfg-hr-zone-mode') || 'maxhr',
    pmc_weight:           num('cfg-pmc-weight'),
    route_grade_min:      num('cfg-route-grade-min'),
    route_grade_max:      num('cfg-route-grade-max'),
    route_speed_max:      num('cfg-route-speed-max'),
    route_cadence_max:    num('cfg-route-cadence-max'),
    wind_source:          val('cfg-wind-source')   || 'auto',
    api_base:             val('cfg-api-base')      || null,
    api_key:              val('cfg-api-key')       || null,
    model:                val('cfg-model')         || null,
    max_tokens:           num('cfg-max-tokens'),
    onelap_username:      val('cfg-onelap-user')   || null,
    onelap_password:      val('cfg-onelap-pass')   || null,
    igpsport_username:    val('cfg-igp-user')       || null,
    igpsport_password:    val('cfg-igp-pass')       || null,
    strava_client_id:     val('cfg-strava-id')     || null,
    strava_client_secret: val('cfg-strava-secret') || null,
    strava_redirect_port: num('cfg-strava-port'),
  };
  Object.keys(cfg).forEach(k => { if (cfg[k] === null) delete cfg[k]; });
  if (btn) btn.disabled = true;
  try {
    const r = await fetch('/api/config/raw', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(cfg) });
    if (!r.ok) throw new Error();
    toast('设置已保存');
    document.getElementById('tile-select').value = cfg.map_tile;
    await setTiles(cfg.map_tile);
    _initAiConfig();
    await _loadPmcConfig();
    if (_analyticsOpen && _analyticsTab === 'pmc') {
      _pmcAllData = null;
      _loadAndRenderPmc();
    }
    if (detailTrackId != null) openDetailView(detailTrackId);
  } catch { toast('保存失败'); }
  finally { if (btn) btn.disabled = false; }
}

/* ── 账户自助（头像 / 显示名 / 改密）───────────────────────────────────────── */
async function saveDisplayName() {
  const el = document.getElementById('account-display-name');
  if (!el) return;
  try {
    const r = await fetch('/api/account/profile', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ display_name: el.value.trim() }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast(d.error || '保存失败'); return; }
    toast('显示名已保存');
  } catch { toast('保存失败'); }
}

async function uploadAvatar(event) {
  const input = event.target;
  const file = input.files && input.files[0];
  if (!file) return;
  const form = new FormData();
  form.append('file', file);
  try {
    const r = await fetch('/api/account/avatar', { method: 'POST', body: form });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast(d.error || '上传失败'); input.value = ''; return; }
    toast('头像已更新');
    const img = document.getElementById('account-avatar-img');
    const fallback = document.getElementById('account-avatar-fallback');
    if (img) {
      img.style.display = '';
      img.src = img.src.split('?')[0] + '?t=' + Date.now();   // 破缓存
    }
    if (fallback) fallback.style.display = 'none';
  } catch { toast('上传失败'); }
  finally { input.value = ''; }
}

async function changeOwnPassword() {
  const curEl  = document.getElementById('account-cur-pw');
  const newEl  = document.getElementById('account-new-pw');
  const new2El = document.getElementById('account-new-pw2');
  const cur = curEl.value, pw1 = newEl.value, pw2 = new2El.value;
  if (!cur || !pw1) { toast('请填写当前密码和新密码'); return; }
  if (pw1 !== pw2) { toast('两次输入的新密码不一致'); return; }
  try {
    const r = await fetch('/api/account/password', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ current_password: cur, new_password: pw1 }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast(d.error || '修改失败'); return; }
    toast('密码已修改');
    curEl.value = ''; newEl.value = ''; new2El.value = '';
  } catch { toast('修改失败'); }
}

/* ── 授权码 / API token ─────────────────────────────────────────────────── */
async function loadTokens() {
  const box = document.getElementById('token-list');
  if (!box) return;   // 本地模式无授权码卡片
  try {
    const d = await fetch('/api/tokens').then(r => r.json());
    const toks = d.tokens || [];
    if (!toks.length) { box.innerHTML = '<div class="token-empty">尚无授权码</div>'; return; }
    box.innerHTML = toks.map(t => {
      const revoked = t.revoked ? ' token-row--revoked' : '';
      const expired = t.expires_at && new Date(t.expires_at.replace(' ', 'T') + 'Z') <= new Date();
      let status = '有效';
      if (t.revoked) status = '已撤销';
      else if (expired) status = '已过期';
      const last = t.last_used_at ? t.last_used_at : '从未使用';
      const exp  = t.expires_at ? t.expires_at : '永不过期';
      const action = t.revoked ? '' :
        `<button class="token-revoke-btn" onclick="revokeToken(${t.id})">撤销</button>`;
      const rw = t.scopes === 'read_write';
      const scopeBadge = `<span class="token-row-scope${rw ? ' token-row-scope--rw' : ''}">${rw ? '读写' : '只读'}</span>`;
      return `<div class="token-row${revoked}">
        <div class="token-row-main">
          <span class="token-row-name">${_escapeHtml(t.name)}</span>
          <span class="token-row-prefix">fafa_${_escapeHtml(t.token_prefix)}…</span>
          ${scopeBadge}
          <span class="token-row-status">${status}</span>
        </div>
        <div class="token-row-meta">创建 ${_escapeHtml(t.created_at || '')} · 最后使用 ${_escapeHtml(last)} · ${_escapeHtml(exp)}</div>
        ${action}
      </div>`;
    }).join('');
  } catch { box.innerHTML = '<div class="token-empty">加载授权码失败</div>'; }
}

async function createToken() {
  const nameEl  = document.getElementById('token-name');
  const expEl   = document.getElementById('token-expires');
  const writeEl = document.getElementById('token-write');
  const name = nameEl.value.trim();
  if (!name) { toast('请填写授权码名称'); return; }
  const body = { name };
  const days = parseInt(expEl.value, 10);
  if (!isNaN(days)) body.expires_days = days;
  if (writeEl?.checked) body.read_write = true;
  try {
    const r = await fetch('/api/tokens', {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(body),
    });
    const d = await r.json();
    if (!r.ok) { toast(d.error || '生成失败'); return; }
    nameEl.value = ''; expEl.value = ''; if (writeEl) writeEl.checked = false;
    _showTokenReveal(d.token);
    loadTokens();
  } catch { toast('生成失败'); }
}

async function revokeToken(id) {
  if (!confirm('撤销后使用该授权码的调用将立即失效，确定撤销吗？')) return;
  try {
    const r = await fetch('/api/tokens/' + id + '/revoke', { method: 'POST' });
    if (!r.ok) { const d = await r.json().catch(() => ({})); toast(d.error || '撤销失败'); return; }
    toast('已撤销');
    loadTokens();
  } catch { toast('撤销失败'); }
}

function _showTokenReveal(token) {
  document.getElementById('token-reveal-value').textContent = token;
  document.getElementById('token-reveal-modal').style.display = 'flex';
}
function closeTokenReveal() {
  document.getElementById('token-reveal-modal').style.display = 'none';
  document.getElementById('token-reveal-value').textContent = '';
}
function copyTokenReveal() {
  const v = document.getElementById('token-reveal-value').textContent;
  navigator.clipboard.writeText(v).then(() => toast('已复制到剪贴板'), () => toast('复制失败，请手动选择'));
}

/* ── 管理员：全站用户列表 ─────────────────────────────────────────────────── */
function _currentUserId() {
  const el = document.getElementById('user-name');
  const v = el ? parseInt(el.dataset.userId, 10) : NaN;
  return isNaN(v) ? null : v;
}

function _fmtBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

async function loadAdminUsers() {
  const box = document.getElementById('admin-user-list');
  if (!box) return;   // 非管理员无此卡片
  const selfId = _currentUserId();
  try {
    const d = await fetch('/api/admin/users').then(r => r.json());
    const users = d.users || [];
    const quota = d.storage_quota_bytes || 0;
    if (!users.length) { box.innerHTML = '<div class="token-empty">没有用户</div>'; return; }
    box.innerHTML = users.map(u => {
      const isSelf = u.id === selfId;
      const pct = quota ? Math.min(100, Math.round(u.storage_bytes / quota * 100)) : 0;
      const roleBadge = u.is_admin
        ? '<span class="token-row-scope token-row-scope--rw">管理员</span>'
        : '<span class="token-row-scope">普通</span>';
      const statusBadge = u.is_frozen
        ? '<span class="admin-status admin-status--frozen">已冻结</span>'
        : '<span class="admin-status">正常</span>';
      const name = _escapeHtml(u.display_name || u.username);
      const lastLogin = u.last_login_at ? _escapeHtml(u.last_login_at) : '从未登录';
      let actions = '';
      if (!isSelf) {
        actions = `
          <button class="token-revoke-btn" onclick="adminResetPassword(${u.id}, '${_escapeHtml(u.username)}')">重置密码</button>
          <button class="token-revoke-btn" onclick="adminToggleFreeze(${u.id}, ${u.is_frozen ? 'false' : 'true'})">${u.is_frozen ? '解冻' : '冻结'}</button>
          <button class="token-revoke-btn" onclick="adminToggleAdmin(${u.id}, ${u.is_admin ? 'false' : 'true'})">${u.is_admin ? '取消管理员' : '设为管理员'}</button>
          <button class="token-revoke-btn" onclick="adminDeleteUser(${u.id}, '${_escapeHtml(u.username)}')">删除</button>`;
      } else {
        actions = '<span class="admin-self-hint">（当前账号）</span>';
      }
      return `<div class="token-row admin-user-row">
        <img class="admin-user-avatar" src="/api/account/avatar/${u.id}" alt=""
             onerror="this.style.visibility='hidden'">
        <div class="admin-user-body">
          <div class="token-row-main">
            <span class="token-row-name">${name}</span>
            <span class="token-row-prefix">${_escapeHtml(u.username)}</span>
            ${roleBadge}
            ${statusBadge}
          </div>
          <div class="token-row-meta">
            创建 ${_escapeHtml(u.created_at || '')} · 最后登录 ${lastLogin} ·
            ${u.file_count} 个文件 · ${_fmtBytes(u.storage_bytes)}${quota ? ` (${pct}%)` : ''} ·
            ${u.token_count} 个有效授权码
          </div>
          <div class="admin-user-actions">${actions}</div>
        </div>
      </div>`;
    }).join('');
  } catch { box.innerHTML = '<div class="token-empty">加载用户列表失败</div>'; }
}

async function adminResetPassword(uid, username) {
  const pw = prompt(`为「${username}」设置新密码（至少 8 位）：`);
  if (!pw) return;
  try {
    const r = await fetch(`/api/admin/users/${uid}/reset_password`, {
      method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ new_password: pw }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast(d.error || '重置失败'); return; }
    toast('密码已重置');
  } catch { toast('重置失败'); }
}

async function adminToggleFreeze(uid, freeze) {
  const action = freeze ? '冻结' : '解冻';
  if (freeze && !confirm(`确定要${action}这个账号吗？冻结后该用户会被立即登出，且无法再登录。`)) return;
  try {
    const r = await fetch(`/api/admin/users/${uid}/${freeze ? 'freeze' : 'unfreeze'}`, { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast(d.error || `${action}失败`); return; }
    toast(`已${action}`);
    loadAdminUsers();
  } catch { toast(`${action}失败`); }
}

async function adminToggleAdmin(uid, makeAdmin) {
  const action = makeAdmin ? '设为管理员' : '取消管理员身份';
  if (!confirm(`确定要${action}吗？`)) return;
  try {
    const r = await fetch(`/api/admin/users/${uid}/${makeAdmin ? 'promote' : 'demote'}`, { method: 'POST' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast(d.error || '操作失败'); return; }
    toast(`已${action}`);
    loadAdminUsers();
  } catch { toast('操作失败'); }
}

async function adminDeleteUser(uid, username) {
  if (!confirm(`确定要删除账号「${username}」吗？此操作不可撤销；该用户的 fit 文件不会被删除，仍留在磁盘上。`)) return;
  try {
    const r = await fetch(`/api/admin/users/${uid}`, { method: 'DELETE' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast(d.error || '删除失败'); return; }
    toast('账号已删除');
    loadAdminUsers();
  } catch { toast('删除失败'); }
}

/* ── AI 提示词编辑器 ──────────────────────────────────────────────────────── */

let _pmtData    = null;   // GET /api/prompts 的响应
let _pmtHistory = {};     // kind → [{rev, ts, chars}]
let _pmtKind    = null;
let _pmtDrafts  = {};     // kind → 编辑中但未保存的文本，切 tab 不丢

async function openPromptsModal() {
  document.getElementById('prompts-modal').style.display = 'flex';
  document.getElementById('prompts-preview-wrap').style.display = 'none';
  document.getElementById('prompts-hint').textContent = '正在加载…';
  _pmtDrafts = {};
  try {
    const [cfg, hist] = await Promise.all([
      fetch('/api/prompts').then(r => r.json()),
      fetch('/api/prompts/history').then(r => r.json()),
    ]);
    if (cfg.error) throw new Error(cfg.error);
    _pmtData = cfg;
    _pmtHistory = hist.history || {};
  } catch (e) {
    document.getElementById('prompts-hint').textContent = '加载失败：' + e.message;
    return;
  }
  document.getElementById('prompts-hint').textContent = '';
  _pmtRenderTabs();
  _pmtRenderBlocks();
  _pmtRenderCatalog();
  const ta = document.getElementById('prompts-text');
  ta.oninput = () => {
    _pmtDrafts[_pmtKind] = ta.value;
    _pmtUpdateMeta();
    _pmtMarkTabs();
  };
  _pmtSwitchKind(_pmtData.kinds[0]);
}

function closePromptsModal() {
  if (_pmtDirtyKinds().length &&
      !confirm('有未保存的提示词修改，确定关闭吗？')) return;
  document.getElementById('prompts-modal').style.display = 'none';
  _pmtDrafts = {};
}

// 已保存的自定义，没有则用默认原文。预填默认而不是留空，用户一打开就能看到
// 并直接改；后端会把「内容等于默认」归一化为删键，所以不会存下冗余副本。
function _pmtSavedText(kind) {
  return _pmtData.templates[kind] ?? _pmtData.defaults[kind] ?? '';
}

function _pmtCurrentText(kind) {
  return (kind in _pmtDrafts) ? _pmtDrafts[kind] : _pmtSavedText(kind);
}

function _pmtDirtyKinds() {
  return Object.keys(_pmtDrafts).filter(k => _pmtDrafts[k] !== _pmtSavedText(k));
}

function _pmtRenderTabs() {
  const wrap = document.getElementById('prompts-tabs');
  wrap.innerHTML = _pmtData.kinds.map(k =>
    `<button class="pmt-tab" data-kind="${k}">${_escapeHtml(_pmtData.labels[k] || k)}` +
    `<i class="pmt-dot" style="display:none"></i></button>`).join('');
  wrap.querySelectorAll('.pmt-tab').forEach(btn => {
    btn.onclick = () => _pmtSwitchKind(btn.dataset.kind);
  });
}

function _pmtMarkTabs() {
  const dirty = new Set(_pmtDirtyKinds());
  document.querySelectorAll('#prompts-tabs .pmt-tab').forEach(btn => {
    const k = btn.dataset.kind;
    btn.classList.toggle('active', k === _pmtKind);
    btn.querySelector('.pmt-dot').style.display = dirty.has(k) ? '' : 'none';
  });
}

function _pmtSwitchKind(kind) {
  if (_pmtKind) _pmtDrafts[_pmtKind] = document.getElementById('prompts-text').value;
  _pmtKind = kind;
  document.getElementById('prompts-text').value = _pmtCurrentText(kind);
  document.getElementById('prompts-preview-wrap').style.display = 'none';
  _pmtRenderHistory();
  _pmtUpdateMeta();
  _pmtMarkTabs();
}

function _pmtRenderHistory() {
  const sel = document.getElementById('prompts-history-sel');
  const entries = _pmtHistory[_pmtKind] || [];
  const opts = ['<option value="">历史版本…</option>'];
  for (const e of entries) {
    const when = new Date(e.ts * 1000).toLocaleString('zh-CN', { hour12: false });
    opts.push(`<option value="${e.rev}">${when} · ${e.chars} 字符</option>`);
  }
  opts.push('<option value="__default__">— 默认提示词 —</option>');
  sel.innerHTML = opts.join('');
  sel.disabled = false;
  sel.onchange = () => _pmtLoadVersion(sel.value);
}

async function _pmtLoadVersion(value) {
  const sel = document.getElementById('prompts-history-sel');
  if (!value) return;
  let text;
  if (value === '__default__') {
    text = _pmtData.defaults[_pmtKind] || '';
  } else {
    try {
      const r = await fetch(`/api/prompts/history/${_pmtKind}/${value}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || '读取失败');
      text = d.text;
    } catch (e) {
      toast('读取历史版本失败：' + e.message);
      sel.value = '';
      return;
    }
  }
  // 载入编辑器作为草稿，需再点保存才生效，便于先预览确认
  document.getElementById('prompts-text').value = text;
  _pmtDrafts[_pmtKind] = text;
  sel.value = '';
  _pmtUpdateMeta();
  _pmtMarkTabs();
  toast('已载入到编辑器，点「保存」生效');
}

function _pmtUpdateMeta() {
  const text = document.getElementById('prompts-text').value;
  const limit = _pmtData.limits.max_template_chars;
  const saved = _pmtData.templates[_pmtKind];
  const isDefault = !text.trim() || text === _pmtData.defaults[_pmtKind];
  document.getElementById('prompts-status').textContent =
    isDefault ? '当前：默认提示词' : (saved ? '当前：已自定义' : '当前：草稿未保存');
  const over = text.length > limit;
  const meta = document.getElementById('prompts-meta');
  meta.textContent = `${text.length} / ${limit} 字符`;
  meta.classList.toggle('pmt-over', over);
  document.getElementById('prompts-reset-btn').disabled = !saved;
}

function _pmtRenderBlocks() {
  const wrap = document.getElementById('prompts-blocks');
  const params = _pmtData.catalog.block_params || [];
  wrap.innerHTML = params.map(p => `
    <div class="pmt-block-row">
      <label>${_escapeHtml(p.name)}</label>
      <input type="number" data-key="${p.name}" min="${p.min}" max="${p.max}"
             value="${_pmtData.blocks[p.name] ?? p.default}">
    </div>`).join('');
}

// 把变量/数据块名归类到骑行详情指标配色（速度/心率/功率/踏频/海拔），无匹配返回 ''
function _pmtMetricClass(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('wind') || n.includes('gust')) return '';   // 气象字段保持默认色
  if (n.includes('speed')) return 'speed';
  if (n.includes('cadence')) return 'cadence';
  if (n.includes('elev') || n.includes('_alt') || n.includes('ascent') || n.includes('climb')) return 'alt';
  if (n.includes('power') || n.includes('ftp') || n.startsWith('left') || n.includes('zone')) return 'power';
  if (n.includes('hr') || n.includes('heart')) return 'hr';
  return '';
}

function _pmtRenderCatalog() {
  const wrap = document.getElementById('prompts-catalog');
  const cat = _pmtData.catalog;
  const byGroup = {};
  for (const s of cat.scalars) (byGroup[s.group] ||= []).push(s);

  const chip = (token, label, title, name) => {
    const metric = _pmtMetricClass(name);
    return `<button class="pmt-var${metric ? ' pmt-var--' + metric : ''}" ` +
      `data-token="${_escapeHtml(token)}" ` +
      `title="${_escapeHtml(title)}">${_escapeHtml(label)}</button>`;
  };

  const parts = [];
  parts.push('<div class="pmt-var-group"><div class="pmt-var-group-title">数据块</div>' +
    cat.blocks.map(b => chip(`{{#${b.name}}}`, b.label, `{{#${b.name}}} — ${b.note}`, b.name)).join('') +
    '</div>');
  for (const g of cat.groups) {
    const items = byGroup[g.key];
    if (!items || !items.length) continue;
    parts.push(`<div class="pmt-var-group"><div class="pmt-var-group-title">${_escapeHtml(g.label)}</div>` +
      items.map(s => chip(`{{${s.name}}}`, s.label,
        `{{${s.name}}}${s.unit ? ' — ' + s.unit : ''}`, s.name)).join('') + '</div>');
  }
  wrap.innerHTML = parts.join('');
  wrap.querySelectorAll('.pmt-var').forEach(btn => {
    btn.onclick = () => _pmtInsert(btn.dataset.token);
  });
}

function _pmtInsert(token) {
  const ta = document.getElementById('prompts-text');
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? start;
  ta.value = ta.value.slice(0, start) + token + ta.value.slice(end);
  ta.focus();
  ta.selectionStart = ta.selectionEnd = start + token.length;
  _pmtDrafts[_pmtKind] = ta.value;
  _pmtUpdateMeta();
  _pmtMarkTabs();
}

function _pmtCollectBlocks() {
  const out = {};
  document.querySelectorAll('#prompts-blocks input[data-key]').forEach(inp => {
    const v = parseInt(inp.value, 10);
    if (!isNaN(v)) out[inp.dataset.key] = v;
  });
  return out;
}

async function _pmtPreview() {
  const hint = document.getElementById('prompts-hint');
  hint.textContent = '正在渲染预览…';
  try {
    const r = await fetch('/api/prompts/preview', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: _pmtKind,
        template: document.getElementById('prompts-text').value,
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || '预览失败');
    document.getElementById('prompts-preview-wrap').style.display = '';
    document.getElementById('prompts-preview-text').textContent = d.text;
    const warn = d.warnings.length
      ? ` · ⚠ ${d.warnings.map(_escapeHtml).join('；')}` : '';
    document.getElementById('prompts-preview-meta').innerHTML =
      `${d.chars} 字符 · 约 ${d.est_tokens} tokens${warn}`;
    hint.textContent = '';
  } catch (e) {
    hint.textContent = '预览失败：' + e.message;
  }
}

async function _pmtSave() {
  const hint = document.getElementById('prompts-hint');
  const text = document.getElementById('prompts-text').value;
  if (text.length > _pmtData.limits.max_template_chars) {
    hint.textContent = `模板超过 ${_pmtData.limits.max_template_chars} 字符上限`;
    return;
  }
  hint.textContent = '保存中…';
  try {
    const r = await fetch('/api/prompts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: _pmtKind, text, blocks: _pmtCollectBlocks() }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || '保存失败');
    await _pmtReload();
    hint.textContent = '';
    toast(d.is_default ? '已恢复为默认提示词' : (d.changed ? '提示词已保存' : '内容无变化'));
  } catch (e) {
    hint.textContent = '保存失败：' + e.message;
  }
}

async function _pmtResetKind() {
  if (!confirm(`确定把「${_pmtData.labels[_pmtKind]}」恢复为默认提示词吗？\n当前内容会存入历史版本。`)) return;
  try {
    const r = await fetch('/api/prompts/reset', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: _pmtKind }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || '恢复失败');
    delete _pmtDrafts[_pmtKind];
    await _pmtReload();
    toast('已恢复默认');
  } catch (e) {
    toast('恢复失败：' + e.message);
  }
}

async function _pmtReload() {
  const [cfg, hist] = await Promise.all([
    fetch('/api/prompts').then(r => r.json()),
    fetch('/api/prompts/history').then(r => r.json()),
  ]);
  _pmtData = cfg;
  _pmtHistory = hist.history || {};
  delete _pmtDrafts[_pmtKind];
  document.getElementById('prompts-text').value = _pmtCurrentText(_pmtKind);
  _pmtRenderBlocks();
  _pmtRenderHistory();
  _pmtUpdateMeta();
  _pmtMarkTabs();
}

/* ── Theme toggle ───────────────────────────────────────────────────────── */
async function _loadDefaultTile() {
  let tile = 'dark-nolabels';
  try {
    const cfg = await fetch('/api/config/raw').then(r => r.json());
    if (TILES[cfg.map_tile]) tile = cfg.map_tile;
  } catch {}
  // carto 瓦片明暗跟随当前主题（与 toggleTheme 一致）：首屏在浅色主题下
  // 也用浅色瓦片，仅保留设置里的“是否带路网标注”偏好。amap 等非 carto 不动。
  if (_isCartoTile(tile)) {
    const isLight = document.body.classList.contains('light-theme');
    const withLabels = tile === 'dark' || tile === 'light';
    tile = isLight ? (withLabels ? 'light' : 'light-nolabels')
                   : (withLabels ? 'dark' : 'dark-nolabels');
  }
  document.getElementById('tile-select').value = tile;
  await setTiles(tile);
}

function toggleTheme() {
  const isLight = document.body.classList.toggle('light-theme');
  localStorage.setItem('theme', isLight ? 'light' : 'dark');
  document.getElementById('theme-toggle-icon').textContent = '◑';
  document.getElementById('theme-toggle-label').textContent = isLight ? '浅色' : '深色';
  if (_isCartoTile(currentTile)) {
    const withLabels = currentTile === 'dark' || currentTile === 'light';
    const tile = isLight
      ? (withLabels ? 'light' : 'light-nolabels')
      : (withLabels ? 'dark' : 'dark-nolabels');
    document.getElementById('tile-select').value = tile;
    if (map) void setTiles(tile);
    if (detailRouteMap) void _setDetailTiles(tile);
  }
  if (_analyticsOpen && _analyticsTab === 'pmc' && _pmcAllData) {
    _loadAndRenderPmc();
  }
  if (_cmpRides.length && document.getElementById('compare-modal').style.display === 'flex') {
    _disposeCompareCharts();
    switchCompareTab(_cmpTab);
  }
}

function _initTheme() {
  if (localStorage.getItem('theme') === 'light') {
    document.body.classList.add('light-theme');
    document.getElementById('theme-toggle-icon').textContent = '◑';
    document.getElementById('theme-toggle-label').textContent = '浅色';
    // 瓦片明暗随主题的同步由 _loadDefaultTile 负责（它在 initMap 后运行、是首屏瓦片权威）
  }
}

/* ── 训练分析视图控制器 ────────────────────────────────────────────────────── */

function openAnalyticsView(tab = 'pmc') {
  _analyticsOpen = true;
  _analyticsTab  = tab;
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
    let acts;
    if (_actActivities) {
      acts = _actActivities;
    } else {
      const res  = await fetch('/api/activities');
      const data = await res.json();
      acts = data.activities || [];
    }
    if (seq !== _pmcLoadSeq || !_analyticsOpen || _analyticsTab !== 'pmc') return;
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
async function _openAndStreamModal(title, summaryHtml, fetchFn, systemMsg) {
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
  _aiChatMessages = [];
  _aiChatStreaming = false;
  const sendBtn = document.getElementById('act-ai-chat-send');
  if (sendBtn) sendBtn.disabled = true;
  const chatInput = document.getElementById('act-ai-chat-input');
  if (chatInput) chatInput.value = '';

  const loading  = document.getElementById('act-ai-modal-loading');
  const resultEl = document.getElementById('act-ai-modal-result');
  loading.style.display = 'flex';

  try {
    const res = await fetchFn();
    loading.style.display = 'none';
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      _setErrorHtml(resultEl, d.error || '请求失败，请点击侧栏「设置」检查配置');
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '', fullText = '', capturedPrompt = '';
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
          if (chunk.type === 'prompt') { capturedPrompt = chunk.content; continue; }
          if (chunk.text)  { fullText += chunk.text; resultEl.innerHTML = _renderMarkdown(fullText); }
        } catch {}
      }
    }
    if (fullText) {
      const sysMsg  = systemMsg || '你是专业骑行教练 AI，请基于原始数据回答后续问题。';
      const userMsg = capturedPrompt || '请分析。';
      _aiChatMessages = [
        { role: 'system',    content: sysMsg },
        { role: 'user',      content: userMsg },
        { role: 'assistant', content: fullText },
      ];
      if (sendBtn) sendBtn.disabled = false;
    }
  } catch (e) {
    loading.style.display = 'none';
    _setErrorHtml(resultEl, `网络错误：${e.message}`);
  }
}

function closeActAiModal() {
  document.getElementById('act-ai-modal').style.display = 'none';
  _aiChatMessages = [];
  _aiChatStreaming = false;
}

async function _sendAiChat() {
  const input = document.getElementById('act-ai-chat-input');
  const question = input?.value.trim();
  if (!question || _aiChatStreaming || !_aiChatMessages.length) return;
  input.value = '';

  const resultEl = document.getElementById('act-ai-modal-result');
  const userDiv  = document.createElement('div');
  userDiv.className = 'ai-chat-user-msg';
  userDiv.textContent = question;
  resultEl.appendChild(userDiv);

  const respDiv = document.createElement('div');
  respDiv.className = 'ai-chat-resp-msg';
  resultEl.appendChild(respDiv);
  resultEl.scrollTop = resultEl.scrollHeight;

  const messages = [..._aiChatMessages, { role: 'user', content: question }];
  _aiChatStreaming = true;
  const sendBtn = document.getElementById('act-ai-chat-send');
  if (sendBtn) sendBtn.disabled = true;

  let fullText = '';
  try {
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      _setErrorHtml(respDiv, d.error || '请求失败');
      return;
    }
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
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
          if (chunk.error) { _setErrorHtml(respDiv, chunk.error); return; }
          if (chunk.text)  { fullText += chunk.text; respDiv.innerHTML = _renderMarkdown(fullText); resultEl.scrollTop = resultEl.scrollHeight; }
        } catch {}
      }
    }
    if (fullText) {
      _aiChatMessages.push({ role: 'user',      content: question  });
      _aiChatMessages.push({ role: 'assistant', content: fullText  });
    }
  } catch (e) {
    _setErrorHtml(respDiv, `网络错误：${e.message}`);
  } finally {
    _aiChatStreaming = false;
    if (sendBtn) sendBtn.disabled = false;
  }
}

function _windDirArrow(deg) {
  // Arrow points in direction wind blows TO (deg = from-direction, +180 = to-direction)
  const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  return arrows[Math.round(((deg + 180) % 360) / 45) % 8];
}

/* ── 活动列表单条 AI 分析 ──────────────────────────────────────────────────── */
async function openActAiModal(act) {
  if (!_aiModel) { toast('AI 未配置，请点击侧栏「设置」进行配置'); return; }
  const chips = _statChips(act.summary || {});
  const { kmStats, windData } = await _fetchActivityData(act);
  let weatherHtml = '';
  if (windData) {
    const arrow = _windDirArrow(windData.wind_dir_deg);
    weatherHtml =
      `<span class="stat-chip">🌬️ ${windData.wind_speed_avg_kmh} km/h</span>` +
      `<span class="stat-chip">${arrow} ${windData.wind_dir_label}</span>` +
      `<span class="stat-chip">逆风${windData.headwind_pct}% / 顺风${windData.tailwind_pct}%</span>`;
  }
  await _openAndStreamModal(
    (act.filename || '').replace(/\.fit$/i, ''),
    chips.map(c => `<span class="stat-chip">${c}</span>`).join('') + weatherHtml,
    () => fetch('/api/ai/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ summary: act.summary || {}, km_stats: kmStats, filename: act.filename || '', start_time: act.start_time || '', wind_data: windData }) }),
    _AI_EVAL_SYS_MSG
  );
}

/* ── 训练日历 AI 建议 ──────────────────────────────────────────────────────── */
async function startCalendarAi(period) {
  if (!_aiModel) { toast('AI 未配置，请点击侧栏「设置」进行配置'); return; }
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
  }), '你是专业骑行教练 AI。以下是训练日历的原始数据，请基于此回答后续问题。');
}

async function startPmcAi() {
  if (!_pmcAllData || !_pmcAllData.days.length) {
    toast('暂无骑行数据，无法进行 AI 分析');
    return;
  }
  if (!_aiModel) {
    toast('AI 未配置，请点击侧栏「设置」进行配置');
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
  }), '你是专业骑行教练 AI。以下是体能管理图的原始数据，请基于此回答后续问题。');
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
    if (_actActivities) {
      _calActivities = _actActivities;
    } else {
      const res = await fetch('/api/activities');
      const data = await res.json();
      _calActivities = data.activities || [];
    }
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
          const _safeColor = c => /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : '#888';
          const tagDots = tags.length > 0
            ? `<div class="cal-act-tag-dots">${tags.slice(0, 4).map(t => {
                const dot = document.createElement('span');
                dot.className = 'cal-act-tag-dot';
                dot.style.background = _safeColor(t.color);
                dot.title = t.name || '';
                return dot.outerHTML;
              }).join('')}</div>`
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
      <div class="cal-sp-best-item" data-filename="${_escapeHtml(item.act.filename)}">
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

  const hdr = document.getElementById('cal-act-modal-header');
  hdr.innerHTML = '';
  const dateEl = document.createElement('div');
  dateEl.className = 'cal-act-modal-date';
  dateEl.textContent = act.date || '';
  const fileEl = document.createElement('div');
  fileEl.className = 'cal-act-modal-file';
  fileEl.textContent = act.filename || '';
  hdr.appendChild(dateEl);
  hdr.appendChild(fileEl);

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
