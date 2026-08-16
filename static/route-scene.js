/*
 * route-scene.js — FAFA 3D 路线场景（原创实现）
 *
 * 用 three.js 把一条骑行轨迹（经纬度 + 海拔 + 坡度）画成一根按坡度着色的立体
 * 管道，配一层落到地面的坡度幕布、起止海拔标注、可选地面方位罗盘、以及沿途
 * 照片钉。对外接口见 route3d.js。
 *
 * 本文件为 FAFA 自有实现，不复用任何第三方项目的源码；仅依赖 MIT 许可的 three。
 */
import * as THREE from '/static/vendor/three/three.module.min.js';
import { OrbitControls } from '/static/vendor/three/OrbitControls.js';

const DEG = Math.PI / 180;
const METERS_PER_DEG = 111_320;        // 纬度 1° 的近似米数
const PLAN_SPAN = 168;                 // 水平方向铺满的场景单位
const GROUND_Y = -14;                  // 幕布底 / 地面高度
const MAX_ROUTE_SAMPLES = 512;         // 抽稀后最多喂给曲线的点数

const clampNum = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const mix = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);

// 坡度 → 颜色的取样点（自定义配色，冷→暖随坡度上升）
const SLOPE_RAMP = [
  { g: -0.10, c: 0x3aa0c4 },
  { g: -0.03, c: 0x74cbc0 },
  { g:  0.00, c: 0xeef2d8 },
  { g:  0.04, c: 0xc7f24a },
  { g:  0.08, c: 0xf5b02e },
  { g:  0.14, c: 0xe8512f },
].map((s) => ({ g: s.g, c: new THREE.Color(s.c) }));

// 六套配色：line=管道基调, wall=幕布, dot=骑行点, grid=网格, sky=背景雾色
const PALETTES = {
  night:  { line: 0xcffb5f, wall: 0x8fbf3a, dot: 0xf3ffbb, grid: 0x50604a, sky: 0x0b0d0c },
  paper:  { line: 0xff6f45, wall: 0xd75c3c, dot: 0xffd9a6, grid: 0x67594e, sky: 0x15110f },
  ice:    { line: 0x74e9ff, wall: 0x2fa0bb, dot: 0xdafbff, grid: 0x3d5a62, sky: 0x081013 },
  sunset: { line: 0xff9046, wall: 0xd9662b, dot: 0xffe0b0, grid: 0x5a3f52, sky: 0x1c1122 },
  aurora: { line: 0x66ffdb, wall: 0x3fae92, dot: 0xd8fff4, grid: 0x2e5348, sky: 0x041410 },
  slate:  { line: 0xa1c2ff, wall: 0x5f7fbf, dot: 0xe6eefb, grid: 0x3a4658, sky: 0x0e131b },
};

function slopeToColor(grade, target) {
  const g = clampNum(grade, SLOPE_RAMP[0].g, SLOPE_RAMP[SLOPE_RAMP.length - 1].g);
  for (let i = 1; i < SLOPE_RAMP.length; i += 1) {
    const lo = SLOPE_RAMP[i - 1], hi = SLOPE_RAMP[i];
    if (g <= hi.g) {
      const t = (g - lo.g) / Math.max(1e-4, hi.g - lo.g);
      return target.copy(lo.c).lerp(hi.c, ease(t));
    }
  }
  return target.copy(SLOPE_RAMP[SLOPE_RAMP.length - 1].c);
}

// 生成一张文字贴图（用于海拔标注与罗盘方位）
function textSprite(text, hex) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 160;
  const ctx = cv.getContext('2d');
  ctx.font = '700 62px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,.6)';
  ctx.shadowBlur = 14;
  ctx.fillStyle = `#${hex.toString(16).padStart(6, '0')}`;
  ctx.fillText(text, 256, 82);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

// 把一张照片画成带圆角边框和标签的贴图
function photoSprite(photo) {
  const W = 480, H = 600;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#161a17';
  ctx.fillRect(0, 0, W, H);
  const img = photo.image;
  if (img && img.naturalWidth) {
    const ir = img.naturalWidth / img.naturalHeight, tr = W / H;
    let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
    if (ir > tr) { sw = sh * tr; sx = (img.naturalWidth - sw) / 2; }
    else { sh = sw / tr; sy = (img.naturalHeight - sh) / 2; }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, W, H);
  }
  const grad = ctx.createLinearGradient(0, H * 0.55, 0, H);
  grad.addColorStop(0, 'rgba(5,7,6,0)');
  grad.addColorStop(1, 'rgba(5,7,6,.88)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, H * 0.5, W, H * 0.5);
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(244,247,232,.9)';
  ctx.strokeRect(4, 4, W - 8, H - 8);
  ctx.fillStyle = '#f4f7e8';
  ctx.font = '700 30px Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText((photo.label || '').slice(0, 18), 30, H - 58);
  ctx.fillStyle = 'rgba(244,247,232,.7)';
  ctx.font = '600 22px Arial, sans-serif';
  ctx.fillText((photo.method || '').toString(), 30, H - 26);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

function disposeTree(obj) {
  obj.traverse((n) => {
    n.geometry?.dispose?.();
    const m = n.material;
    if (Array.isArray(m)) m.forEach((x) => { x.map?.dispose?.(); x.dispose?.(); });
    else if (m) { m.map?.dispose?.(); m.dispose?.(); }
  });
}

export class RouteScene {
  constructor(canvas, onFrame, options = {}) {
    this.canvas = canvas;
    this.onFrame = onFrame || null;
    this.transparent = Boolean(options.transparent);
    this.showGround = options.showGround ?? !this.transparent;

    // 状态
    this.paletteName = 'night';
    this.playing = true;
    this.spinning = true;
    this.autoSpinDuration = 24;   // 每圈秒数
    this.progress = 0;
    this.spinAngle = 0;
    this.floatClock = 0;
    this.ready = false;
    this.disposed = false;
    this.photos = [];

    // three 基础
    this.scene = new THREE.Scene();
    const sky = PALETTES[this.paletteName].sky;
    this.scene.background = this.transparent ? null : new THREE.Color(sky);
    this.scene.fog = this.transparent ? null : new THREE.FogExp2(sky, 0.0033);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 3000);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: this.transparent,
      preserveDrawingBuffer: true,
    });
    if (this.transparent) this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = false;
    this.controls.minDistance = 90;
    this.controls.maxDistance = 460;
    this.controls.minPolarAngle = Math.PI * 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.49;

    this.root = new THREE.Group();      // 承载全部路线内容，整体自转
    this.root.rotation.order = 'YXZ';
    this.scene.add(this.root);

    this.clock = new THREE.Clock();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    if (canvas.parentElement) this.resizeObserver.observe(canvas.parentElement);
    this.resetCamera();
    this.resize();

    this._tick = this._tick.bind(this);
    requestAnimationFrame(this._tick);
  }

  // ── 视口 ──────────────────────────────────────────────────────────────────
  resize() {
    const parent = this.canvas.parentElement;
    const w = Math.max(1, parent ? parent.clientWidth : 1000);
    const h = Math.max(1, parent ? parent.clientHeight : 750);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  resetCamera() {
    const w = this.canvas.parentElement?.clientWidth ?? 1000;
    const narrow = w < 640;
    this.camera.position.set(narrow ? 6 : 18, narrow ? 168 : 120, narrow ? 340 : 258);
    this.controls.target.set(0, 8, 0);
    this.controls.update();
  }

  // ── 建路线 ────────────────────────────────────────────────────────────────
  setRoute(payload) {
    this._clearRoute();
    const records = (payload && payload.records) || [];
    this.records = records;
    if (records.length < 2) return;

    const pts = this._project(records);
    if (pts.length < 2) return;
    this.points = pts.map((p) => p.pos);
    this.routeMetadata = pts.map((p) => ({ lat: p.lat, lon: p.lon, altitude: p.alt }));
    this.slopes = this._slopeProfile(pts);
    this.curve = new THREE.CatmullRomCurve3(this.points, false, 'centripetal', 0.35);

    const pal = PALETTES[this.paletteName];
    const divisions = clampNum(this.points.length * 3, 400, 1400);

    // 主管道（按坡度顶点着色）
    const tubeGeo = new THREE.TubeGeometry(this.curve, divisions, 0.7, 6, false);
    this._paintTube(tubeGeo, divisions, 6);
    this.tube = new THREE.Mesh(tubeGeo, new THREE.MeshBasicMaterial({ vertexColors: true }));
    this.root.add(this.tube);

    // 外发光管
    const glowGeo = new THREE.TubeGeometry(this.curve, divisions, 1.6, 6, false);
    this._paintTube(glowGeo, divisions, 6);
    this.glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.15,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.root.add(this.glow);

    this._buildCurtain();
    if (this.showGround) this._buildGround(pal);
    this._buildElevationTags(pts, pal);
    this._buildRider(pal);
    this._buildCompass(pal);

    this.progress = 0;
    this.ready = true;
    this.resetCamera();
    this.resize();
  }

  // 经纬度 + 海拔 → 居中、缩放到场景单位的点集（-z 指北, +x 指东）
  _project(records) {
    const lats = records.map((r) => r.lat), lons = records.map((r) => r.lon);
    const alts = records.map((r) => Number(r.altitude) || 0);
    const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
    const lon0 = (Math.min(...lons) + Math.max(...lons)) / 2;
    const cos0 = Math.cos(lat0 * DEG);

    const raw = records.map((r, i) => ({
      x: (r.lon - lon0) * DEG * METERS_PER_DEG * cos0,
      z: -(r.lat - lat0) * DEG * METERS_PER_DEG,
      alt: alts[i], lat: r.lat, lon: r.lon,
    }));
    const xs = raw.map((p) => p.x), zs = raw.map((p) => p.z);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minZ = Math.min(...zs), maxZ = Math.max(...zs);
    const minA = Math.min(...alts), maxA = Math.max(...alts);
    const planScale = PLAN_SPAN / Math.max(maxX - minX, maxZ - minZ, 1);
    const altRange = Math.max(maxA - minA, 1);
    const vertScale = clampNum(altRange * planScale * 6, 16, 46) / altRange;
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;

    const stride = Math.max(1, Math.ceil(records.length / MAX_ROUTE_SAMPLES));
    const picked = raw.filter((_, i) => i % stride === 0 || i === raw.length - 1);
    let prev = null;
    const out = [];
    for (const p of picked) {
      const v = new THREE.Vector3(
        (p.x - cx) * planScale,
        4 + (p.alt - minA) * vertScale,
        (p.z - cz) * planScale,
      );
      if (prev) {                        // 轻微向前一点靠拢，抹掉 GPS 抖动
        v.x = mix(v.x, prev.x, 0.16);
        v.y = mix(v.y, prev.y, 0.28);
        v.z = mix(v.z, prev.z, 0.16);
      }
      out.push({ pos: v, alt: p.alt, lat: p.lat, lon: p.lon });
      prev = v;
    }
    return out;
  }

  // 每个采样点的坡度：优先用记录坡度，否则由海拔/水平位移推算，末尾做空间平滑
  _slopeProfile(pts) {
    const recs = this.records;
    const stride = Math.max(1, Math.ceil(recs.length / pts.length));
    const graded = recs.filter((r) => Number.isFinite(r.grade));
    const useRecorded = graded.length >= recs.length * 0.5
      && graded.some((r) => Math.abs(r.grade) > 0.05);

    const along = [0];
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1].pos, b = pts[i].pos;
      along.push(along[i - 1] + Math.hypot(b.x - a.x, b.z - a.z));
    }

    let raw;
    if (useRecorded) {
      raw = pts.map((_, i) => {
        const r = recs[Math.min(recs.length - 1, i * stride)];
        return clampNum((Number.isFinite(r?.grade) ? r.grade : 0) / 100, -0.16, 0.18);
      });
    } else {
      raw = pts.map((p, i) => {
        let lo = i, hi = i;
        while (lo > 0 && along[i] - along[lo] < 3.2) lo -= 1;
        while (hi < pts.length - 1 && along[hi] - along[i] < 3.2) hi += 1;
        const run = Math.max(1, along[hi] - along[lo]);
        return clampNum((pts[hi].alt - pts[lo].alt) / (run * 4), -0.16, 0.18);
      });
    }
    // 距离加权平滑
    return raw.map((_, i) => {
      let acc = 0, wsum = 0;
      for (let j = 0; j < raw.length; j += 1) {
        const d = Math.abs(along[j] - along[i]);
        if (d > 3.4) continue;
        const w = 1 - d / 3.4;
        acc += raw[j] * w; wsum += w;
      }
      return wsum ? acc / wsum : raw[i];
    });
  }

  _paintTube(geo, tubular, radial) {
    const count = geo.attributes.position.count;
    const colors = new Float32Array(count * 3);
    const col = new THREE.Color();
    for (let s = 0; s <= tubular; s += 1) {
      const f = (s / tubular) * (this.slopes.length - 1);
      const i0 = Math.floor(f), i1 = Math.min(this.slopes.length - 1, i0 + 1);
      slopeToColor(mix(this.slopes[i0] ?? 0, this.slopes[i1] ?? 0, ease(f - i0)), col);
      for (let r = 0; r <= radial; r += 1) {
        const idx = (s * (radial + 1) + r) * 3;
        colors[idx] = col.r; colors[idx + 1] = col.g; colors[idx + 2] = col.b;
      }
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  // 幕布：路线每段向地面拉出一条渐隐色带
  _buildCurtain() {
    const pos = [], colarr = [], fade = [];
    const top = new THREE.Color(), bottom = new THREE.Color();
    const P = this.points, S = this.slopes;
    for (let i = 1; i < P.length; i += 1) {
      const a = P[i - 1], b = P[i];
      slopeToColor(S[i - 1] ?? 0, top);
      const tR = top.r, tG = top.g, tB = top.b;
      slopeToColor(S[i] ?? 0, top);
      bottom.setRGB(tR * 0.22, tG * 0.22, tB * 0.22);
      // 两个三角形：a_top, b_top, a_bot / b_top, b_bot, a_bot
      const aB = [a.x, GROUND_Y, a.z], bB = [b.x, GROUND_Y, b.z];
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z, aB[0], aB[1], aB[2]);
      pos.push(b.x, b.y, b.z, bB[0], bB[1], bB[2], aB[0], aB[1], aB[2]);
      fade.push(1, 1, 0, 1, 0, 0);
      const cT = [tR, tG, tB], cB = [bottom.r, bottom.g, bottom.b];
      colarr.push(...cT, ...cT, ...cB, ...cT, ...cB, ...cB);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colarr, 3));
    geo.setAttribute('aFade', new THREE.Float32BufferAttribute(fade, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uAlpha: { value: 0.36 } },
      vertexShader: `
        attribute float aFade; attribute vec3 color;
        varying float vFade; varying vec3 vCol;
        void main(){ vFade = aFade; vCol = color;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform float uAlpha; varying float vFade; varying vec3 vCol;
        void main(){ float a = pow(smoothstep(0.0,1.0,vFade),1.5) * uAlpha;
          gl_FragColor = vec4(vCol, a); }`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    this.curtain = new THREE.Mesh(geo, mat);
    this.root.add(this.curtain);
  }

  _buildGround(pal) {
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(128, 80),
      new THREE.MeshBasicMaterial({ color: pal.sky, transparent: true, opacity: 0.5, depthWrite: false }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = GROUND_Y - 0.1;
    this.root.add(disc);

    this.grid = new THREE.GridHelper(252, 18, pal.grid, pal.grid);
    this.grid.position.y = GROUND_Y - 0.02;
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.15;
    this.grid.material.depthWrite = false;
    this.root.add(this.grid);
  }

  _buildElevationTags(pts, pal) {
    let lo = 0, hi = 0;
    for (let i = 1; i < pts.length; i += 1) {
      if (pts[i].alt < pts[lo].alt) lo = i;
      if (pts[i].alt > pts[hi].alt) hi = i;
    }
    this.tags = [];
    for (const [i, mark] of [[hi, '▲'], [lo, '▼']]) {
      const text = `${mark} ${Math.round(pts[i].alt)} M`;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: textSprite(text, pal.line), transparent: true, depthWrite: false,
      }));
      sp.position.copy(pts[i].pos).add(new THREE.Vector3(0, 15, 0));
      sp.scale.set(26, 8.1, 1);
      this.root.add(sp);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([pts[i].pos, pts[i].pos.clone().add(new THREE.Vector3(0, 11, 0))]),
        new THREE.LineBasicMaterial({ color: pal.line, transparent: true, opacity: 0.5 }),
      );
      this.root.add(line);
      this.tags.push({ sprite: sp, line, text });
    }
  }

  _buildRider(pal) {
    this.rider = new THREE.Mesh(
      new THREE.SphereGeometry(1.9, 16, 16),
      new THREE.MeshBasicMaterial({ color: pal.dot }),
    );
    this.riderHalo = new THREE.Mesh(
      new THREE.SphereGeometry(3.6, 16, 16),
      new THREE.MeshBasicMaterial({ color: pal.dot, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.root.add(this.rider, this.riderHalo);
  }

  // 地面方位罗盘：十字轴 + N/E/S/W，N 红色恒指北（投影里 -z=北,+x=东）
  _buildCompass(pal) {
    const g = new THREE.Group();
    const R = 120, y = GROUND_Y + 0.08, NORTH = 0xff5a5a;
    const nsMat = new THREE.LineBasicMaterial({ color: NORTH, transparent: true, opacity: 0.4 });
    const ewMat = new THREE.LineBasicMaterial({ color: pal.grid, transparent: true, opacity: 0.4 });
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(
      [new THREE.Vector3(0, y, -R), new THREE.Vector3(0, y, R)]), nsMat));
    g.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(
      [new THREE.Vector3(-R, y, 0), new THREE.Vector3(R, y, 0)]), ewMat));
    this.compassAxis = { ns: nsMat, ew: ewMat };
    this.compassTags = [];
    const marks = [
      { t: 'N', p: [0, y, -R], c: NORTH, north: true },
      { t: 'E', p: [R, y, 0], c: pal.line, north: false },
      { t: 'S', p: [0, y, R], c: pal.line, north: false },
      { t: 'W', p: [-R, y, 0], c: pal.line, north: false },
    ];
    for (const m of marks) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: textSprite(m.t, m.c), transparent: true, depthWrite: false }));
      sp.position.set(m.p[0], m.p[1] + 6, m.p[2]);
      sp.scale.set(13, 4.1, 1);
      g.add(sp);
      this.compassTags.push({ sprite: sp, text: m.t, north: m.north });
    }
    g.visible = false;
    this.compassGroup = g;
    this.root.add(g);
  }

  setCompassVisible(v) { if (this.compassGroup) this.compassGroup.visible = Boolean(v); }

  // ── 配色 ──────────────────────────────────────────────────────────────────
  setPalette(name) {
    if (!PALETTES[name]) return;
    this.paletteName = name;
    const pal = PALETTES[name];
    this.scene.background?.setHex(pal.sky);
    this.scene.fog?.color.setHex(pal.sky);
    this.rider?.material.color.setHex(pal.dot);
    this.riderHalo?.material.color.setHex(pal.dot);
    this.grid?.material.color.setHex(pal.grid);
    if (this.compassAxis) this.compassAxis.ew.color.setHex(pal.grid);
    for (const tag of this.tags ?? []) {
      tag.sprite.material.map.dispose();
      tag.sprite.material.map = textSprite(tag.text, pal.line);
      tag.line.material.color.setHex(pal.line);
    }
    for (const tag of this.compassTags ?? []) {
      if (tag.north) continue;
      tag.sprite.material.map.dispose();
      tag.sprite.material.map = textSprite(tag.text, pal.line);
    }
  }

  // ── 进度 / 采样 ───────────────────────────────────────────────────────────
  setProgress(p) { this.progress = ((p % 1) + 1) % 1; }

  sampleAt(p) {
    if (!this.records?.length) return null;
    return this.records[Math.min(this.records.length - 1, Math.round(p * (this.records.length - 1)))];
  }

  // 最近轨迹点 → 归一化进度（照片 GPS 定位用）
  progressForCoordinate(lat, lon) {
    if (!this.routeMetadata?.length) return 0;
    const cos = Math.cos(lat * DEG);
    let best = 0, bestD = Infinity;
    for (let i = 0; i < this.routeMetadata.length; i += 1) {
      const m = this.routeMetadata[i];
      const dx = (m.lon - lon) * cos, dy = m.lat - lat;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best / Math.max(1, this.routeMetadata.length - 1);
  }

  // 拍摄时间 → 进度（容忍 ±8h 时区偏移；越界返回 null）
  progressForTimestamp(date) {
    const recs = this.records;
    if (!recs?.length) return null;
    const times = recs.map((r) => new Date(r.timestamp).getTime());
    const t0 = times[0], tN = times[times.length - 1];
    if (!Number.isFinite(t0) || !Number.isFinite(tN)) return null;
    let target = date.getTime(), best = Infinity;
    for (const off of [0, 8 * 3600e3, -8 * 3600e3]) {
      const c = date.getTime() + off;
      const gap = c < t0 ? t0 - c : c > tN ? c - tN : 0;
      if (gap < best) { best = gap; target = c; }
    }
    if (best > 12 * 3600e3) return null;
    let idx = 0, bd = Infinity;
    for (let i = 0; i < times.length; i += 1) {
      const d = Math.abs(times[i] - target);
      if (d < bd) { bd = d; idx = i; }
    }
    return idx / Math.max(1, times.length - 1);
  }

  // ── 照片钉 ────────────────────────────────────────────────────────────────
  addPhoto(photo) {
    if (!this.curve) return null;
    const at = this.curve.getPointAt(clampNum(photo.progress, 0, 1));
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: photoSprite(photo), transparent: true, depthWrite: false, opacity: 0.9,
    }));
    sprite.center.set(0.5, 0.05);
    sprite.position.copy(at).add(new THREE.Vector3(0, 6, 0));
    sprite.scale.set(12, 15, 1);
    const stem = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([at, at.clone().add(new THREE.Vector3(0, 6, 0))]),
      new THREE.LineBasicMaterial({ color: PALETTES[this.paletteName].line, transparent: true, opacity: 0.35 }),
    );
    this.root.add(stem, sprite);
    const marker = { photo, sprite, stem };
    this.photos.push(marker);
    return marker;
  }

  clearPhotos() {
    for (const m of this.photos) {
      this.root.remove(m.sprite, m.stem);
      disposeTree(m.sprite); disposeTree(m.stem);
    }
    this.photos = [];
  }

  activePhoto(p) {
    let near = null, nd = Infinity;
    for (const m of this.photos) {
      const raw = Math.abs(p - m.photo.progress);
      const d = Math.min(raw, 1 - raw);
      if (d < nd) { nd = d; near = m; }
    }
    return near?.photo ?? null;
  }

  // ── 每帧 ──────────────────────────────────────────────────────────────────
  _clearRoute() {
    if (this.root) { disposeTree(this.root); this.scene.remove(this.root); }
    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';
    this.scene.add(this.root);
    this.photos = [];
    this.ready = false;
  }

  _tick() {
    if (this.disposed) return;
    requestAnimationFrame(this._tick);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.ready) {
      if (this.playing) this.setProgress(this.progress + dt / 18);
      if (this.spinning) {
        this.spinAngle = (this.spinAngle + dt * (Math.PI * 2) / this.autoSpinDuration) % (Math.PI * 2);
        this.floatClock += dt;
      }
      this.root.rotation.y = this.spinAngle;
      const bob = this.spinning ? 1 : 0;
      this.root.rotation.x = THREE.MathUtils.degToRad(-7) + Math.sin(this.floatClock * 0.7) * 0.024 * bob;
      this.root.position.y = Math.sin(this.floatClock * 0.66) * 2.0 * bob;

      const at = this.curve.getPointAt(this.progress);
      this.rider.position.copy(at);
      this.riderHalo.position.copy(at);
      const pulse = 1 + ((performance.now() / 900) % 1) * 1.1;
      this.riderHalo.scale.setScalar(pulse);
      this.riderHalo.material.opacity = 0.26 * (2 - pulse);

      this.onFrame?.(this.progress, this.sampleAt(this.progress), this.activePhoto(this.progress));
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    this.ready = false;
    try { this.resizeObserver?.disconnect(); } catch {}
    try { this.clearPhotos(); } catch {}
    try { disposeTree(this.root); } catch {}
    try { this.controls?.dispose(); } catch {}
    try { this.renderer?.dispose(); } catch {}
  }
}
