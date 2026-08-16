/*
 * route3d.js — FAFA 3D 路线可视化整合层
 * 桥接 RouteScene（ESM）与经典脚本 app.js：暴露 window.Route3D。
 * 照片按 EXIF（GPS → 拍摄时间 → 平均分布）匹配到路线进度，直接调用 exifr（MIT）。
 * 本文件为 FAFA 自有实现。
 */
import { RouteScene } from './route-scene.js';
import * as exifr from '/static/vendor/exifr/exifr.esm.js';

let scene = null;
let photos = [];

function releasePhotos() {
  for (const p of photos) { try { URL.revokeObjectURL(p.url); } catch {} }
  photos = [];
}

// 挂载 3D 场景。records: [{lat, lon, altitude, grade, timestamp}]（已过滤出有坐标点）
function mount(canvas, records, opts = {}) {
  unmount();
  if (!canvas || !records || records.length < 2) return null;
  scene = new RouteScene(canvas, null, opts);
  scene.setRoute({ records });
  return scene;
}

function unmount() {
  if (scene) { try { scene.dispose(); } catch {} scene = null; }
  releasePhotos();
}

function setPalette(name) { scene?.setPalette(name); }
function setPlaying(playing) { if (scene) scene.playing = Boolean(playing); }
function setSpinning(spinning) { if (scene) scene.spinning = Boolean(spinning); }
function isSpinning() { return scene ? Boolean(scene.spinning) : false; }
function setCompass(visible) { scene?.setCompassVisible(visible); }
// 每圈秒数（越小越快）。UI 传"转速"由调用方换算。
function setSpinDuration(seconds) {
  if (scene) scene.autoSpinDuration = Math.max(4, Math.min(60, Number(seconds) || scene.autoSpinDuration));
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`无法读取照片：${file.name}`)); };
    image.src = url;
  });
}

async function readMetadata(file) {
  const [dateInfo, gpsInfo] = await Promise.all([
    exifr.parse(file, ['DateTimeOriginal', 'CreateDate', 'DateTimeDigitized']).catch(() => undefined),
    exifr.gps(file).catch(() => undefined),
  ]);
  const capturedAt = dateInfo?.DateTimeOriginal ?? dateInfo?.CreateDate ?? dateInfo?.DateTimeDigitized ?? null;
  return {
    capturedAt: capturedAt instanceof Date ? capturedAt : capturedAt ? new Date(capturedAt) : null,
    latitude: gpsInfo?.latitude,
    longitude: gpsInfo?.longitude,
  };
}

// 添加照片：按 EXIF GPS → 拍摄时间 → 平均分布 匹配到路线进度，落成 3D 标记
async function addPhotos(files) {
  if (!scene) return { added: 0, methods: [] };
  const accepted = [...files].filter((f) => f.type.startsWith('image/')).slice(0, 12);
  const methods = [];
  for (let i = 0; i < accepted.length; i += 1) {
    const file = accepted[i];
    let loaded, meta;
    try {
      [loaded, meta] = await Promise.all([loadImage(file), readMetadata(file)]);
    } catch { continue; }

    let method = '平均分布';
    let progress = (i + 1) / (accepted.length + 1);
    if (Number.isFinite(meta.latitude) && Number.isFinite(meta.longitude)) {
      progress = scene.progressForCoordinate(meta.latitude, meta.longitude);
      method = '照片 GPS';
    } else if (meta.capturedAt && !Number.isNaN(meta.capturedAt.getTime())) {
      const tp = scene.progressForTimestamp(meta.capturedAt);
      if (tp != null) { progress = tp; method = '拍摄时间'; }
    }

    const photo = {
      id: crypto.randomUUID(), file, image: loaded.image, url: loaded.url,
      capturedAt: meta.capturedAt, progress, method,
      label: file.name.replace(/\.[^.]+$/, ''),
    };
    photos.push(photo);
    scene.addPhoto(photo);
    methods.push(method);
  }
  return { added: methods.length, methods };
}

function clearPhotos() {
  if (scene) { try { scene.clearPhotos(); } catch {} }
  releasePhotos();
}

window.Route3D = {
  mount, unmount, setPalette, setPlaying, setSpinning, isSpinning, setSpinDuration,
  setCompass, addPhotos, clearPhotos,
  get scene() { return scene; },
};
