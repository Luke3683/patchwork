import * as THREE from 'three';
import { buildPrefabs, buildProps, prefabsReady, prefabSize, PREFAB_BUILDINGS } from './prefabs.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { AIRPORT, RUNWAY, PADS, CITY_HEIGHT, CITY_RADIUS } from './terrain.js';
import { tex, surface } from './textures.js';

const SPACING = 92;
const STREET_HALF = 8;
const BLOCK_HALF = SPACING / 2 - STREET_HALF;
const FLOOR = 3.2;
const SIGN_WORDS = ['ARCADE', 'NOODLES', 'MOTEL', 'TIDE BAR', 'CINEMA', 'ORBIT FM', 'DINER', 'PATCH & CO', 'RAMEN', 'GARAGE', 'HOTEL', 'BOWLING', 'JUKEBOX', 'SKY LOUNGE'];
const SIGN_COLORS = ['#ff3d8b', '#35e0ff', '#ffd23f', '#7cff6b', '#c07bff', '#ff7a2e'];

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Tells the world what's solid. Grouped into cells so lookups stay fast. */
export class Solids {
  constructor() {
    this.cells = new Map();
    this.all = [];
    this.ramps = [];
  }

  key(x, z) {
    return `${Math.floor(x / 60)},${Math.floor(z / 60)}`;
  }

  add(minX, maxX, minZ, maxZ, top, bottom = -100) {
    const box = { minX, maxX, minZ, maxZ, top, bottom };
    this.all.push(box);
    for (let x = Math.floor(minX / 60); x <= Math.floor(maxX / 60); x++) {
      for (let z = Math.floor(minZ / 60); z <= Math.floor(maxZ / 60); z++) {
        const k = `${x},${z}`;
        if (!this.cells.has(k)) this.cells.set(k, []);
        this.cells.get(k).push(box);
      }
    }
    return box;
  }

  near(x, z) {
    return this.cells.get(this.key(x, z)) ?? [];
  }

  /** The top of whatever solid surface is under this spot, within stepping reach of y. */
  groundAt(x, z, y) {
    let best = -Infinity;
    for (const b of this.near(x, z)) {
      if (x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ && y >= b.top - 1.3 && b.top > best) best = b.top;
    }
    for (const r of this.ramps) {
      const dx = x - r.x;
      const dz = z - r.z;
      if (Math.abs(dx) > r.reach || Math.abs(dz) > r.reach) continue;
      const along = dx * r.dirX + dz * r.dirZ;
      const side = dx * r.dirZ - dz * r.dirX;
      if (Math.abs(side) <= r.width / 2 && along >= 0 && along <= r.length) {
        const h = r.base + (along / r.length) * r.height;
        if (y >= h - 2.2 && h > best) best = h;
      }
    }
    return best;
  }

  /** Pushes a circle out of walls. Returns true if it hit one. */
  push(pos, radius, feetY, out) {
    let hit = false;
    for (const b of this.near(pos.x, pos.z)) {
      if (feetY >= b.top - 1.2 || feetY + 1.6 < b.bottom) continue;
      const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
      const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      hit = true;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        pos.x = cx + (dx / d) * radius;
        pos.z = cz + (dz / d) * radius;
        out?.set(dx / d, 0, dz / d);
      } else {
        // The center is inside the box, so leave through the nearest wall.
        const l = pos.x - b.minX;
        const r = b.maxX - pos.x;
        const n = pos.z - b.minZ;
        const f = b.maxZ - pos.z;
        const m = Math.min(l, r, n, f);
        if (m === l) { pos.x = b.minX - radius; out?.set(-1, 0, 0); }
        else if (m === r) { pos.x = b.maxX + radius; out?.set(1, 0, 0); }
        else if (m === n) { pos.z = b.minZ - radius; out?.set(0, 0, -1); }
        else { pos.z = b.maxZ + radius; out?.set(0, 0, 1); }
      }
    }
    return hit;
  }
}

const FACADES = [
  { id: 'office', image: 'office', tile: 26, floors: true, roughness: 0.32, metalness: 0.55 },
  { id: 'tower', image: 'tower', tile: 34, roughness: 0.22, metalness: 0.7 },
  { id: 'teal', image: 'teal', tile: 30, roughness: 0.25, metalness: 0.65 },
  { id: 'brickA', image: 'brickA', tile: 13, roughness: 0.82, metalness: 0.05 },
  { id: 'brickB', image: 'brickB', tile: 13, roughness: 0.82, metalness: 0.05 },
  { id: 'stone', image: 'stone', tile: 13, roughness: 0.7, metalness: 0.1 },
];
const TOWER_STYLES = [0, 1, 2];
const BLOCK_STYLES = [3, 4, 5];

/** Paints a facade from a real wall photo, with framed windows that reflect the sky. */
function facadeTextures(style, high) {
  const S = high ? 1024 : 512;
  const mk = () => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    return c;
  };
  const color = mk();
  const orm = mk();
  const glow = mk();
  const g = color.getContext('2d');
  const m = orm.getContext('2d');
  const e = glow.getContext('2d');
  const rand = seeded(style.seed);
  e.fillStyle = '#000';
  e.fillRect(0, 0, S, S);
  // Green is roughness and blue is metalness, the channels three.js reads.
  m.fillStyle = 'rgb(0,232,0)';
  m.fillRect(0, 0, S, S);
  const rows = 4;
  const ch = S / rows;

  if (style.shop) {
    const bays = 3;
    const bw = S / bays;
    g.fillStyle = '#6f6a60';
    g.fillRect(0, 0, S, S);
    for (let x = 0; x < bays; x++) {
      const bx = x * bw;
      // A painted sign band across the top of each shop.
      g.fillStyle = ['#2f4858', '#7a2f2a', '#2e5e4e', '#59406e', '#8a6a2a', '#1f3a5f'][Math.floor(rand() * 6)];
      g.fillRect(bx, 0, bw, S * 0.2);
      m.fillStyle = 'rgb(0,120,60)';
      m.fillRect(bx, 0, bw, S * 0.2);
      const left = bx + bw * 0.05;
      const top = S * 0.25;
      const w = bw * 0.9;
      const h = S * 0.62;
      const lit = g.createLinearGradient(0, top, 0, top + h);
      lit.addColorStop(0, '#8a7c66');
      lit.addColorStop(0.5, '#4a4238');
      lit.addColorStop(1, '#1d1a16');
      g.fillStyle = lit;
      g.fillRect(left, top, w, h);
      // Goods on shelves, seen through the glass.
      // Displays and racks, in muted tones so they read as a shop from any distance.
      for (let shelf = 0; shelf < 3; shelf++) {
        const sy = top + h * (0.22 + shelf * 0.27);
        g.fillStyle = 'rgba(40,34,28,0.75)';
        g.fillRect(left + 6, sy + h * 0.13, w - 12, 5);
        for (let px = left + 10; px < left + w - 22;) {
          const pw = 10 + rand() * 16;
          const ph = h * (0.07 + rand() * 0.07);
          g.fillStyle = `hsl(${rand() * 360},${6 + rand() * 18}%,${18 + rand() * 24}%)`;
          g.fillRect(px, sy + h * 0.13 - ph, pw, ph);
          px += pw + 3;
        }
      }
      // The sky reflected across the glass.
      const shine = g.createLinearGradient(left, top, left + w, top + h);
      shine.addColorStop(0, 'rgba(190,215,235,0.34)');
      shine.addColorStop(0.45, 'rgba(190,215,235,0.05)');
      shine.addColorStop(0.62, 'rgba(190,215,235,0.2)');
      shine.addColorStop(1, 'rgba(190,215,235,0.02)');
      g.fillStyle = shine;
      g.fillRect(left, top, w, h);
      g.fillStyle = '#23262b';
      g.fillRect(left - 5, top - 5, w + 10, 7);
      g.fillRect(left - 5, top + h, w + 10, 9);
      g.fillRect(left - 5, top, 6, h);
      g.fillRect(left + w, top, 6, h);
      g.fillRect(left + w * 0.5, top, 5, h);
      m.fillStyle = 'rgb(0,70,120)';
      m.fillRect(left, top, w, h);
      e.drawImage(color, left, top, w, h, left, top, w, h);
    }
  } else if (style.curtain) {
    const cols = 8;
    const cw = S / cols;
    g.fillStyle = style.base;
    g.fillRect(0, 0, S, S);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const shade = 0.82 + rand() * 0.3;
        g.fillStyle = `rgba(${(120 * shade) | 0},${(150 * shade) | 0},${(180 * shade) | 0},0.45)`;
        g.fillRect(x * cw + 2, y * ch + 2, cw - 4, ch - 4);
        m.fillStyle = `rgb(0,${(14 + rand() * 18) | 0},${(225 + rand() * 30) | 0})`;
        m.fillRect(x * cw + 2, y * ch + 2, cw - 4, ch - 4);
        if (rand() < 0.3) {
          const warm = rand();
          e.fillStyle = warm < 0.65 ? '#ffc877' : warm < 0.85 ? '#fff0c9' : '#a8dcff';
          e.fillRect(x * cw + 3, y * ch + 3, cw - 6, ch - 6);
        }
      }
    }
    g.fillStyle = '#20262c';
    for (let x = 0; x <= cols; x++) g.fillRect(x * cw - 1.5, 0, 3, S);
    for (let y = 0; y <= rows; y++) g.fillRect(0, y * ch - 3, S, 6);
  } else {
    const image = tex(style.photo)?.image;
    if (image) {
      const n = style.photo === 'brick' ? 2 : 1;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) g.drawImage(image, (x * S) / n, (y * S) / n, S / n, S / n);
    } else {
      g.fillStyle = '#c9c2b4';
      g.fillRect(0, 0, S, S);
    }
    const cols = style.cols;
    const cw = S / cols;
    for (let y = 0; y < rows; y++) {
      // A shadow line under each floor's ledge.
      const band = g.createLinearGradient(0, y * ch, 0, y * ch + ch * 0.1);
      band.addColorStop(0, 'rgba(0,0,0,0.42)');
      band.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = band;
      g.fillRect(0, y * ch, S, ch * 0.1);
      for (let x = 0; x < cols; x++) {
        const wx = x * cw + cw * 0.2;
        const wy = y * ch + ch * 0.2;
        const ww = cw * 0.6;
        const wh = ch * 0.58;
        g.fillStyle = 'rgba(30,26,22,0.8)';
        g.fillRect(wx - 5, wy - 5, ww + 10, wh + 10);
        const sky = g.createLinearGradient(0, wy, 0, wy + wh);
        sky.addColorStop(0, '#7f97a9');
        sky.addColorStop(1, '#3d4d5c');
        g.fillStyle = sky;
        g.fillRect(wx, wy, ww, wh);
        // Blinds drawn partway in some windows.
        if (rand() < 0.4) {
          g.fillStyle = 'rgba(200,194,178,0.75)';
          g.fillRect(wx, wy, ww, wh * (0.15 + rand() * 0.35));
        }
        g.fillStyle = 'rgba(25,22,20,0.9)';
        g.fillRect(wx + ww / 2 - 1.5, wy, 3, wh);
        g.fillStyle = 'rgba(245,240,230,0.7)';
        g.fillRect(wx - 7, wy + wh + 5, ww + 14, 5);
        g.fillStyle = 'rgba(0,0,0,0.3)';
        g.fillRect(wx - 7, wy + wh + 10, ww + 14, 7);
        m.fillStyle = 'rgb(0,28,200)';
        m.fillRect(wx, wy, ww, wh);
        if (rand() < 0.3) {
          const warm = rand();
          e.fillStyle = warm < 0.7 ? '#ffc877' : warm < 0.88 ? '#fff0c9' : '#a8dcff';
          e.fillRect(wx, wy, ww, wh);
        }
      }
    }
  }
  const make = (canvas, srgb) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  return { map: make(color, true), orm: make(orm, false), emissiveMap: make(glow, true) };
}

/** Collects walls for one facade style into a single mesh, so the whole city is few draw calls. */
class FacadeBatch {
  constructor(style, high) {
    this.style = style;
    this.high = high;
    this.pos = [];
    this.uv = [];
    this.col = [];
    this.nor = [];
  }

  /** A building of any footprint. The points are put into the order that makes walls face out. */
  prism(footprint, baseY, height, tint, smooth = false, vScale = null) {
    const points = [...footprint].reverse();
    const c = new THREE.Color(tint);
    const y0 = baseY;
    const y1 = baseY + height;
    const tile = this.style.tile;
    const v = vScale ?? (tile ? height / tile : height / (FLOOR * 4));
    let along = 0;
    const count = points.length;
    const normalAt = (i) => {
      const [ax, az] = points[i];
      const [bx, bz] = points[(i + 1) % count];
      const len = Math.hypot(bx - ax, bz - az) || 1;
      return [(bz - az) / len, 0, -(bx - ax) / len];
    };
    for (let i = 0; i < count; i++) {
      const a = points[i];
      const b = points[(i + 1) % count];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const across = tile ?? 10;
      const u = smooth ? along + len / across : Math.round(len / across) || 1;
      const u0 = smooth ? along : 0;
      const n = normalAt(i);
      const na = smooth ? normalAt((i - 1 + count) % count).map((x, k) => (x + n[k]) / 2) : n;
      const nb = smooth ? normalAt((i + 1) % count).map((x, k) => (x + n[k]) / 2) : n;
      this.vert([a[0], y0, a[1]], [u0, 0], c, na);
      this.vert([a[0], y1, a[1]], [u0, v], c, na);
      this.vert([b[0], y1, b[1]], [u, v], c, nb);
      this.vert([a[0], y0, a[1]], [u0, 0], c, na);
      this.vert([b[0], y1, b[1]], [u, v], c, nb);
      this.vert([b[0], y0, b[1]], [u, 0], c, nb);
      along = u;
    }
    // The roof, a darker fan from the middle.
    const cx = points.reduce((s, p) => s + p[0], 0) / count;
    const cz = points.reduce((s, p) => s + p[1], 0) / count;
    const roof = c.clone().multiplyScalar(0.34);
    const none = [0.001, 0.001];
    for (let i = 0; i < count; i++) {
      const a = points[i];
      const b = points[(i + 1) % count];
      this.vert([cx, y1, cz], none, roof, [0, 1, 0]);
      this.vert([b[0], y1, b[1]], none, roof, [0, 1, 0]);
      this.vert([a[0], y1, a[1]], none, roof, [0, 1, 0]);
    }
  }

  vert(p, t, c, n) {
    this.pos.push(...p);
    this.uv.push(...t);
    this.col.push(c.r, c.g, c.b);
    this.nor.push(...n);
  }

  build() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    let mat;
    if (this.style.image) {
      const common = {
        map: tex(`facade_${this.style.image}`), emissiveMap: tex(`facade_${this.style.image}`, 'glow'), emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true,
      };
      mat = this.high
        ? new THREE.MeshStandardMaterial({ ...common, roughness: this.style.roughness, metalness: this.style.metalness })
        : new THREE.MeshLambertMaterial(common);
    } else {
      const { map, orm, emissiveMap } = facadeTextures(this.style, this.high);
      const common = { map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true };
      mat = this.high
        ? new THREE.MeshStandardMaterial({ ...common, roughnessMap: orm, metalnessMap: orm, roughness: 1, metalness: 1 })
        : new THREE.MeshLambertMaterial(common);
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

/** Colored parts merged into one mesh. */
export function paint(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const count = g.attributes.position.count;
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  for (const name of Object.keys(g.attributes)) {
    if (!['position', 'normal', 'color'].includes(name)) g.deleteAttribute(name);
  }
  return g;
}

export const sharedMat = () => new THREE.MeshLambertMaterial({ vertexColors: true });

/** World-scale texture coordinates, so photo surfaces never stretch. */
function planarUv(geo, scale) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i) / scale;
    uv[i * 2 + 1] = pos.getZ(i) / scale;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

function neonSign(word, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = 'rgba(8,6,20,0.92)';
  g.fillRect(0, 0, 512, 128);
  g.strokeStyle = color;
  g.lineWidth = 6;
  g.strokeRect(8, 8, 496, 112);
  g.font = '700 74px "Anton", Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 26;
  g.fillStyle = '#fff';
  g.fillText(word, 256, 68, 470);
  g.fillStyle = color;
  g.fillText(word, 256, 68, 470);
  const tex2 = new THREE.CanvasTexture(canvas);
  tex2.colorSpace = THREE.SRGBColorSpace;
  return tex2;
}

function chamfered(x, z, w, d, c) {
  const l = x - w / 2;
  const r = x + w / 2;
  const n = z - d / 2;
  const f = z + d / 2;
  return [[l + c, f], [r - c, f], [r, f - c], [r, n + c], [r - c, n], [l + c, n], [l, n + c], [l, f - c]];
}

function circle(x, z, radius, sides = 22) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    pts.push([x + Math.sin(a) * radius, z + Math.cos(a) * radius]);
  }
  return pts;
}

export function buildCity(k, terrain, solids) {
  const { root } = k;
  const high = k.game.look.high;
  const rand = seeded(7777);
  const batches = FACADES.map((s) => new FacadeBatch(s, high));
  const shopBatch = new FacadeBatch({ shop: true, seed: 66 }, high);
  // Soft pastels and warm whites, the colors of a sunny seaside city.
  const neutral = [0xffffff, 0xece6dc, 0xd9dde4];

  const storefronts = [];
  const sidewalks = [];
  const parks = [];
  const lampSpots = [];
  const signSpots = [];
  const rooftops = [];
  const storeSpots = [];
  const prefabSpots = [];
  const useModels = high && prefabsReady();
  const y0 = CITY_HEIGHT;

  for (let bx = -5; bx <= 5; bx++) {
    for (let bz = -5; bz <= 5; bz++) {
      const cx = bx * SPACING;
      const cz = bz * SPACING;
      const r = Math.hypot(cx, cz);
      if (r > CITY_RADIUS - 55) continue;
      sidewalks.push([cx, cz]);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) lampSpots.push([cx + sx * (BLOCK_HALF - 1), cz + sz * (BLOCK_HALF - 1)]);
      // The middle block is Spire Plaza, and a few others are parks.
      if (bx === 0 && bz === 0) continue;
      if (rand() < 0.11) {
        parks.push([cx, cz]);
        continue;
      }
      const downtown = Math.max(0, 1 - r / (CITY_RADIUS - 40));
      const lots = rand() < 0.3 + downtown * 0.4 ? 1 : rand() < 0.5 ? 2 : 4;
      const inner = BLOCK_HALF - 3;
      const placed = [];
      if (lots === 1) placed.push([cx, cz, inner * 2 - rand() * 8, inner * 2 - rand() * 8]);
      if (lots === 2) {
        const size = inner - 1;
        if (rand() < 0.5) placed.push([cx - inner / 2, cz, size, inner * 2 - 2], [cx + inner / 2, cz, size, inner * 2 - 2]);
        else placed.push([cx, cz - inner / 2, inner * 2 - 2, size], [cx, cz + inner / 2, inner * 2 - 2, size]);
      }
      if (lots === 4) {
        const size = inner - 1;
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) placed.push([cx + (sx * inner) / 2, cz + (sz * inner) / 2, size, size]);
      }
      for (const [x, z, w, d] of placed) {
        // Low-rise lots near the middle of town are fully modeled, facing their street.
        if (useModels && Math.min(w, d) < 40 && r > 60 && r < 640 && rand() < 0.75) {
          const name = PREFAB_BUILDINGS[Math.floor(rand() * PREFAB_BUILDINGS.length)];
          const size = prefabSize(name);
          const facingX = rand() < 0.5;
          const outX = x >= cx ? 1 : -1;
          const outZ = z >= cz ? 1 : -1;
          const yaw = facingX ? (outX > 0 ? Math.PI / 2 : -Math.PI / 2) : (outZ > 0 ? 0 : Math.PI);
          const across = facingX ? d : w;
          const deep = facingX ? w : d;
          // As many side by side as suit the width of the lot, making a proper row of buildings.
          const count = Math.max(1, Math.round(across / (size.x * 1.35)));
          const scale = Math.min(across / (count * size.x), (deep * 0.95) / size.z);
          const height = size.y * scale;
          const reach = (size.z * scale) / 2;
          for (let n = 0; n < count; n++) {
            const along = ((n + 0.5) / count - 0.5) * across;
            const bx = facingX ? x + outX * (w / 2 - reach) : x + along;
            const bz = facingX ? z + along : z + outZ * (d / 2 - reach);
            prefabSpots.push({ prefab: name, x: bx, y: y0 + 0.2, z: bz, yaw, scale });
            // A plain block just inside the walls casts the shadow and is what you see from afar.
            const bw = (facingX ? size.z : size.x) * scale - 1.4;
            const bd = (facingX ? size.x : size.z) * scale - 1.4;
            const stand = batches[BLOCK_STYLES[n % BLOCK_STYLES.length]];
            stand.prism(chamfered(bx, bz, bw, bd, 0.2), y0 + 0.2, height - 1.5, 0xffffff);
            solids.add(bx - bw / 2 - 0.5, bx + bw / 2 + 0.5, bz - bd / 2 - 0.5, bz + bd / 2 + 0.5, y0 + height);
            rooftops.push([bx, y0 + height - 1.3, bz]);
          }
          continue;
        }
        const floors = Math.round(4 + rand() * 7 + downtown * downtown * (20 + rand() * 46));
        const height = floors * FLOOR;
        const tall = height > 62;
        const styles = tall ? TOWER_STYLES : BLOCK_STYLES;
        const pick = styles[Math.floor(rand() * styles.length)];
        const batch = batches[pick];
        const tint = neutral[Math.floor(rand() * neutral.length)];
        const base = y0 + 3.8;
        const round = tall && rand() < 0.22;

        shopBatch.prism(chamfered(x, z, w + 0.5, d + 0.5, 0.2), y0 + 0.25, 3.6, 0xffffff, false, 1);
        const awningColor = [0xff4d3d, 0xfff4e3, 0x14b8ad, 0xffc940, 0x2f9e5b, 0xff6fa8][Math.floor(rand() * 6)];
        storefronts.push(paint(new THREE.BoxGeometry(w + 2.4, 0.2, d + 2.4).translate(x, y0 + 3.62, z), awningColor));
        if (rand() < 0.3) storeSpots.push({ x, z: z + d / 2 + 2.2, y: y0 + 0.3, yaw: 0 });

        if (round) {
          const radius = Math.min(w, d) / 2;
          batch.prism(circle(x, z, radius), base, height, tint, true);
          batch.prism(circle(x, z, radius * 0.7), base + height, FLOOR * 2, tint, true);
          solids.add(x - radius * 0.86, x + radius * 0.86, z - radius * 0.86, z + radius * 0.86, base + height);
          rooftops.push([x, base + height + FLOOR * 2, z]);
        } else if (tall && rand() < 0.75) {
          // Towers step back as they rise, which makes a better skyline.
          const h1 = height * (0.42 + rand() * 0.22);
          const inset = 0.72;
          batch.prism(chamfered(x, z, w, d, 1.4), base, h1, tint);
          batch.prism(chamfered(x, z, w * inset, d * inset, 1.2), base + h1, height - h1, tint);
          solids.add(x - w / 2, x + w / 2, z - d / 2, z + d / 2, base + h1);
          solids.add(x - (w * inset) / 2, x + (w * inset) / 2, z - (d * inset) / 2, z + (d * inset) / 2, base + height);
          rooftops.push([x, base + height, z]);
          storefronts.push(paint(new THREE.BoxGeometry(w + 0.5, 0.5, d + 0.5).translate(x, base + h1, z), 0xc5c9cf));
        } else {
          batch.prism(chamfered(x, z, w, d, pick < 2 ? 1.2 : 0.3), base, height, tint);
          solids.add(x - w / 2, x + w / 2, z - d / 2, z + d / 2, base + height);
          rooftops.push([x, base + height, z]);
          // A cornice and a raised parapet finish the top of older buildings.
          if (!tall) storefronts.push(paint(new THREE.BoxGeometry(w + 0.7, 0.55, d + 0.7).translate(x, base + height, z), 0xdcd6c8));
        }
        if (height > 22) {
          const side = Math.floor(rand() * 4);
          signSpots.push({ x, z, w, d, side, y: base + 4 + rand() * Math.min(22, height - 16) });
        }
      }
    }
  }
  batches.forEach((b) => root.add(b.build()));
  const windowMats = batches.map((_, i) => root.children[root.children.length - batches.length + i].material);

  const shops = new THREE.Mesh(mergeGeometries(storefronts), sharedMat());
  shops.castShadow = true;
  shops.receiveShadow = true;
  root.add(shops);

  const shopMesh = shopBatch.build();
  root.add(shopMesh);

  // Sidewalks and parks, in photographed concrete and grass.
  const walkParts = sidewalks.map(([x, z]) => planarUv(new THREE.BoxGeometry(BLOCK_HALF * 2, 0.26, BLOCK_HALF * 2).translate(x, y0 + 0.13, z), 5));
  const walks = new THREE.Mesh(mergeGeometries(walkParts), surface(high, 'sidewalk'));
  walks.receiveShadow = true;
  root.add(walks);
  if (parks.length) {
    const parkMesh = new THREE.Mesh(
      mergeGeometries(parks.map(([x, z]) => planarUv(new THREE.BoxGeometry(BLOCK_HALF * 2 - 3, 0.3, BLOCK_HALF * 2 - 3).translate(x, y0 + 0.16, z), 8))),
      surface(high, 'grass'),
    );
    parkMesh.receiveShadow = true;
    root.add(parkMesh);
  }

  // Streets: photographed asphalt, with lane markings laid over it.
  const parts = [];
  const lineParts = [];
  for (let i = -5; i <= 5; i++) {
    const c = (i + 0.5) * SPACING;
    const half = Math.sqrt(Math.max(0, CITY_RADIUS * CITY_RADIUS - c * c));
    if (half < 20) continue;
    parts.push(planarUv(new THREE.BoxGeometry(STREET_HALF * 2 + 1, 0.02, half * 2).translate(c, y0 + 0.19, 0), 9));
    parts.push(planarUv(new THREE.BoxGeometry(half * 2, 0.02, STREET_HALF * 2 + 1).translate(0, y0 + 0.2, c), 9));
    const a = new THREE.PlaneGeometry(STREET_HALF * 2 + 1, half * 2).rotateX(-Math.PI / 2);
    setStreetUv(a, half * 2);
    a.translate(c, y0 + 0.235, 0);
    lineParts.push(a);
    const b = new THREE.PlaneGeometry(half * 2, STREET_HALF * 2 + 1).rotateX(-Math.PI / 2);
    setStreetUv(b, half * 2, true);
    b.translate(0, y0 + 0.24, c);
    lineParts.push(b);
  }
  const streets = new THREE.Mesh(mergeGeometries(parts), surface(high, 'asphalt'));
  streets.receiveShadow = true;
  root.add(streets);
  const lines = new THREE.Mesh(mergeGeometries(lineParts), new THREE.MeshLambertMaterial({ map: roadTexture(true), transparent: true, depthWrite: false }));
  lines.receiveShadow = true;
  root.add(lines);

  // Crosswalks, street palms and traffic lights at each corner.
  const zebra = document.createElement('canvas');
  zebra.width = 128;
  zebra.height = 64;
  const zg = zebra.getContext('2d');
  zg.fillStyle = 'rgba(235,232,220,0.92)';
  for (let x = 4; x < 128; x += 16) zg.fillRect(x, 0, 8, 64);
  const crossTex = new THREE.CanvasTexture(zebra);
  crossTex.colorSpace = THREE.SRGBColorSpace;
  const crossings = [];
  const palms = [];
  const lights = [];
  const parked = [];
  for (let i = -4; i <= 4; i++) {
    for (let j = -4; j <= 4; j++) {
      const x = (i + 0.5) * SPACING;
      const z = (j + 0.5) * SPACING;
      if (Math.hypot(x, z) > CITY_RADIUS - 60) continue;
      crossings.push([x, z + STREET_HALF + 1.6, 0], [x, z - STREET_HALF - 1.6, 0], [x + STREET_HALF + 1.6, z, Math.PI / 2], [x - STREET_HALF - 1.6, z, Math.PI / 2]);
      lights.push([x + STREET_HALF + 1.6, z + STREET_HALF + 1.6, 0]);
      lights.push([x - STREET_HALF - 1.6, z - STREET_HALF - 1.6, Math.PI]);
      // Palms and parked cars line the block between corners.
      for (let n = -2; n <= 2; n++) {
        if (n === 0) continue;
        const along = (n / 2.5) * (BLOCK_HALF - 4) + SPACING / 2;
        palms.push([x + along, y0 + 0.2, z + STREET_HALF + 1.5]);
        if (rand() < 0.35) parked.push({ x: x + along, z: z + STREET_HALF - 1.2, yaw: Math.PI / 2 });
        if (rand() < 0.35) parked.push({ x: x - STREET_HALF + 1.2, z: z + along, yaw: 0 });
      }
    }
  }
  const crossMat = new THREE.MeshLambertMaterial({ map: crossTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  k.instanced(new THREE.PlaneGeometry(STREET_HALF * 2, 3).rotateX(-Math.PI / 2), crossMat, crossings.length, (d, i) => {
    d.position.set(crossings[i][0], y0 + 0.26, crossings[i][1]);
    d.rotation.y = crossings[i][2];
  });
  const lightGeo = mergeGeometries([
    paint(new THREE.CylinderGeometry(0.08, 0.1, 5, 8).translate(0, 2.5, 0), 0x25272c),
    paint(new THREE.CylinderGeometry(0.05, 0.05, 3.4, 6).rotateZ(Math.PI / 2).translate(-1.7, 5, 0), 0x25272c),
    paint(new THREE.BoxGeometry(0.3, 0.9, 0.3).translate(-3.2, 4.6, 0), 0x17181b),
    paint(new THREE.SphereGeometry(0.1, 8, 6).translate(-3.2, 4.3, 0.17), 0x38ff6a),
    paint(new THREE.SphereGeometry(0.1, 8, 6).translate(-3.2, 4.92, 0.17), 0x551111),
  ]);
  k.instanced(lightGeo, sharedMat(), lights.length, (d, i) => {
    d.position.set(lights[i][0], y0 + 0.25, lights[i][1]);
    d.rotation.y = lights[i][2];
  });
  parked.forEach((p) => solids.add(p.x - 1.5, p.x + 1.5, p.z - 1.5, p.z + 1.5, y0 + 1.5, y0));

  // Lamp posts, and the glows that come on at night.
  const postGeo = mergeGeometries([
    paint(new THREE.CylinderGeometry(0.07, 0.11, 6.2, 8).translate(0, 3.1, 0), 0x32343c),
    paint(new THREE.TorusGeometry(0.55, 0.05, 6, 10, Math.PI / 2).rotateZ(0).translate(0.02, 6, 0), 0x32343c),
    paint(new THREE.CylinderGeometry(0.16, 0.2, 0.1, 10).translate(0.55, 6.5, 0), 0xf2e6c8),
  ]);
  k.instanced(postGeo, sharedMat(), lampSpots.length, (d, i) => {
    d.position.set(lampSpots[i][0], y0 + 0.25, lampSpots[i][1]);
    d.rotation.y = (i % 4) * Math.PI * 0.5;
  });
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = glowCanvas.height = 64;
  const gg = glowCanvas.getContext('2d');
  const grad = gg.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,240,200,1)');
  grad.addColorStop(0.25, 'rgba(255,205,130,0.55)');
  grad.addColorStop(1, 'rgba(255,190,110,0)');
  gg.fillStyle = grad;
  gg.fillRect(0, 0, 64, 64);
  const glowTex = new THREE.CanvasTexture(glowCanvas);
  const glowPos = new Float32Array(lampSpots.length * 3);
  lampSpots.forEach(([x, z], i) => {
    glowPos[i * 3] = x;
    glowPos[i * 3 + 1] = y0 + 6.5;
    glowPos[i * 3 + 2] = z;
  });
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.BufferAttribute(glowPos, 3));
  const lampGlow = new THREE.Points(glowGeo, new THREE.PointsMaterial({
    map: glowTex, size: 2.4, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  lampGlow.frustumCulled = false;
  root.add(lampGlow);

  const pool = k.instanced(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false }),
    lampSpots.length,
    (d, i) => {
      d.position.set(lampSpots[i][0] + (i % 4 === 0 ? 3 : i % 4 === 1 ? 0 : i % 4 === 2 ? -3 : 0), y0 + 0.34, lampSpots[i][1] + (i % 4 === 1 ? 3 : i % 4 === 3 ? -3 : 0));
      d.scale.set(26, 1, 26);
    },
  );

  // Neon signs on building walls.
  const signGeo = new THREE.PlaneGeometry(12, 3);
  signSpots.slice(0, high ? 44 : 14).forEach((spot, i) => {
    const color = SIGN_COLORS[i % SIGN_COLORS.length];
    const mat = new THREE.MeshBasicMaterial({ map: neonSign(SIGN_WORDS[i % SIGN_WORDS.length], color), fog: true, toneMapped: false });
    mat.color.setScalar(1.6);
    const sign = new THREE.Mesh(signGeo, mat);
    const { x, z, w, d, side, y } = spot;
    const outX = side === 0 ? 1 : side === 1 ? -1 : 0;
    const outZ = side === 2 ? 1 : side === 3 ? -1 : 0;
    sign.position.set(x + outX * (w / 2 + 0.3), y, z + outZ * (d / 2 + 0.3));
    sign.rotation.y = Math.atan2(outX, outZ);
    root.add(sign);
  });

  // Air conditioners and antennas give the skyline some texture.
  const clutterGeo = mergeGeometries([
    paint(new THREE.BoxGeometry(3, 1.7, 2.2).translate(-1.2, 0.85, 0), 0x8a8e96),
    paint(new THREE.CylinderGeometry(0.9, 0.9, 2, 12).translate(2, 1, 1.4), 0x74787f),
    paint(new THREE.CylinderGeometry(0.05, 0.09, 8, 6).translate(1, 4, -1), 0x3a3d46),
  ]);
  k.instanced(clutterGeo, sharedMat(), rooftops.length, (dd, i) => {
    dd.position.set(rooftops[i][0], rooftops[i][1], rooftops[i][2]);
    dd.rotation.y = i * 1.3;
  });

  buildSpire(k, solids, y0);
  const landmarks = buildLandmarks(k, terrain, solids);
  const prefabs = buildPrefabs(root, prefabSpots);
  if (useModels) {
    const furniture = { Prop_Bollard: [], Prop_Planter_Single: [], Prop_ManholeCover: [] };
    for (const [cx, cz] of sidewalks) {
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        for (const off of [2.2, 3.4, 4.6]) {
          furniture.Prop_Bollard.push({ x: cx + sx * (BLOCK_HALF - off), y: y0 + 0.26, z: cz + sz * (BLOCK_HALF - 0.8) });
          furniture.Prop_Bollard.push({ x: cx + sx * (BLOCK_HALF - 0.8), y: y0 + 0.26, z: cz + sz * (BLOCK_HALF - off) });
        }
      }
      if (rand() < 0.5) {
        const px = cx + (rand() < 0.5 ? -1 : 1) * (BLOCK_HALF - 1.3);
        const pz = cz + (rand() - 0.5) * 30;
        furniture.Prop_Planter_Single.push({ x: px, y: y0 + 0.26, z: pz });
        solids.add(px - 1, px + 1, pz - 1, pz + 1, y0 + 0.9, y0);
      }
      furniture.Prop_ManholeCover.push({ x: cx + BLOCK_HALF + 5, y: y0 + 0.24, z: cz + (rand() - 0.5) * 40, scale: 1.3 });
    }
    buildProps(root, furniture);
  }
  return {
    update(dusk, t) {
      const glow = dusk;
      for (const m of windowMats) m.emissiveIntensity = glow * 0.42;
      prefabs.setNight(glow);
      lampGlow.material.opacity = glow;
      pool.material.opacity = glow * 0.32;
      shopMesh.material.emissiveIntensity = glow * 1.5;
      landmarks.update(t, glow);
    },
    prefabs,
    rooftops,
    parks,
    sidewalks,
    palms,
    parked,
    storeSpots,
  };
}

function setStreetUv(geo, length, across) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i);
    const v = uv.getY(i);
    if (across) uv.setXY(i, v, u * (length / 16));
    else uv.setXY(i, u, v * (length / 16));
  }
}

/** Only the painted lines. It sits on top of the asphalt photo. */
export function roadTexture(city) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 1024;
  const g = canvas.getContext('2d');
  if (!city) {
    g.fillStyle = '#e8e4d4';
    g.fillRect(16, 0, 7, 1024);
    g.fillRect(489, 0, 7, 1024);
    g.fillStyle = '#e9c23a';
    g.fillRect(248, 160, 7, 360);
  } else {
    // A dashed center line, and a solid line along each curb.
    g.fillStyle = '#d9d4c4';
    g.fillRect(252, 160, 8, 360);
    g.fillRect(30, 0, 6, 1024);
    g.fillRect(476, 0, 6, 1024);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

function buildSpire(k, solids, y0) {
  const { root } = k;
  const high = k.game.look.high;
  const plaza = new THREE.Mesh(planarUv(new THREE.CylinderGeometry(32, 34, 0.5, 40).translate(0, y0 + 0.3, 0), 5), surface(high, 'sidewalk', { color: 0xdedbd2 }));
  plaza.receiveShadow = true;
  root.add(plaza);
  const parts = [
    new THREE.CylinderGeometry(13, 16, 44, 32).translate(0, y0 + 22, 0),
    new THREE.CylinderGeometry(9, 12.4, 70, 32).translate(0, y0 + 79, 0),
    new THREE.CylinderGeometry(5, 8.4, 80, 32).translate(0, y0 + 154, 0),
    new THREE.CylinderGeometry(0.6, 4.6, 60, 32).translate(0, y0 + 224, 0),
  ];
  const towerMat = high
    ? new THREE.MeshStandardMaterial({ color: 0x8fb0cc, metalness: 0.95, roughness: 0.1 })
    : new THREE.MeshLambertMaterial({ color: 0x9dc0de });
  const spire = new THREE.Mesh(mergeGeometries(parts), towerMat);
  spire.castShadow = true;
  spire.receiveShadow = true;
  root.add(spire);
  solids.add(-14, 14, -14, 14, y0 + 44);

  const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x35e0ff).multiplyScalar(2.4), toneMapped: false });
  const bands = [];
  for (let i = 0; i < 16; i++) {
    const h = 5 + i * 2.6;
    bands.push(new THREE.CylinderGeometry(15.9 - h * 0.067, 16 - h * 0.067, 0.26, 32, 1, true).translate(0, y0 + h, 0));
  }
  root.add(new THREE.Mesh(mergeGeometries(bands), ringMat));
  [44, 114, 194].forEach((h, i) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry([18, 15, 11][i], 0.4, 8, 48), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = y0 + h;
    root.add(ring);
  });
  const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(2.6, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3d8b).multiplyScalar(3), toneMapped: false }));
  beacon.position.y = y0 + 257;
  root.add(beacon);
}

function buildLandmarks(k, terrain, solids) {
  const { root } = k;

  // The airport: runway, hangars, control tower.
  const runwayTex = runwayTexture();
  const runway = new THREE.Mesh(
    new THREE.PlaneGeometry(RUNWAY.hw * 2, RUNWAY.hd * 2).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ map: runwayTex }),
  );
  runway.position.set(RUNWAY.x, AIRPORT.h + 0.25, RUNWAY.z);
  runway.receiveShadow = true;
  root.add(runway);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(420, 80).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x4d4e55 }));
  apron.position.set(-300, AIRPORT.h + 0.2, 715);
  apron.receiveShadow = true;
  root.add(apron);
  const buildings = [];
  for (let i = 0; i < 4; i++) {
    const x = -470 + i * 62;
    const hangar = new THREE.CylinderGeometry(19, 19, 44, 8, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2);
    hangar.translate(x, AIRPORT.h, 770);
    buildings.push(paint(hangar, i % 2 ? 0x8d97a6 : 0xa2694f));
    solids.add(x - 19, x + 19, 748, 792, AIRPORT.h + 19);
  }
  buildings.push(paint(new THREE.CylinderGeometry(3.4, 4.4, 30, 8).translate(-160, AIRPORT.h + 15, 755), 0xd8cfbb));
  buildings.push(paint(new THREE.CylinderGeometry(7, 5, 6, 8).translate(-160, AIRPORT.h + 33, 755), 0x24405e));
  solids.add(-165, -155, 750, 760, AIRPORT.h + 36);

  // The stunt park: ramps of every size.
  const park = PADS.park;
  const addRamp = (x, z, angle, length, width, height, base = park.h, tint = 0xff7a2e) => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(length, 0);
    shape.lineTo(length, height);
    shape.closePath();
    const wedge = new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
    wedge.translate(0, 0, -width / 2);
    wedge.rotateY(-angle);
    wedge.translate(x, base, z);
    buildings.push(paint(wedge, tint));
    solids.ramps.push({
      x, z, dirX: Math.cos(angle), dirZ: Math.sin(angle), length, width, height, base, reach: Math.max(length, width) + 2,
    });
  };
  addRamp(park.x - 110, park.z - 60, 0.5, 34, 14, 9);
  addRamp(park.x + 20, park.z + 60, -0.9, 26, 12, 7, park.h, 0xffd23f);
  addRamp(park.x - 60, park.z + 70, 0.1, 44, 16, 16, park.h, 0xff3d8b);
  addRamp(park.x + 70, park.z - 70, 2.4, 30, 12, 11, park.h, 0x35e0ff);
  // Road ramps that launch you off the highway, for anyone who spots them.
  const ring = terrain.road('ring');
  [40, 210, 400].forEach((idx, i) => {
    const p = ring.pts[idx];
    const q = ring.pts[(idx + 4) % ring.pts.length];
    const angle = Math.atan2(q.z - p.z, q.x - p.x);
    addRamp(p.x, p.z, angle, 30, 9, 6 + i * 2, terrain.height(p.x, p.z) + 0.2, 0xffd23f);
  });

  // The pier.
  const pier = PADS.pier;
  buildings.push(paint(new THREE.BoxGeometry(28, 1, 240).translate(pier.x, 6, pier.z - 240), 0x7a5a3c));
  solids.add(pier.x - 14, pier.x + 14, pier.z - 360, pier.z - 120, 6.5, 5.5);
  for (let i = 0; i < 12; i++) {
    for (const s of [-1, 1]) buildings.push(paint(new THREE.CylinderGeometry(0.5, 0.5, 16, 5).translate(pier.x + s * 13, -2, pier.z - 130 - i * 20), 0x54402c));
  }

  // Food stalls and tents on the boardwalk.
  [0xc9402f, 0x2e86ab, 0xffd23f, 0x76b041, 0xff6f91].forEach((color, i) => {
    const x = pier.x - 70 + i * 26;
    const z = pier.z - 70;
    buildings.push(paint(new THREE.BoxGeometry(11, 3.2, 8).translate(x, pier.h + 1.6, z), 0xf2ece0));
    buildings.push(paint(new THREE.ConeGeometry(9.4, 3.6, 4).rotateY(Math.PI / 4).translate(x, pier.h + 5, z), color));
    solids.add(x - 5.5, x + 5.5, z - 4, z + 4, pier.h + 3.2);
  });

  // The harbor docks and warehouses.
  const harbor = PADS.harbor;
  buildings.push(paint(new THREE.BoxGeometry(170, 1, 26).translate(harbor.x - 150, 3.6, harbor.z), 0x6a6a6f));
  solids.add(harbor.x - 235, harbor.x - 65, harbor.z - 13, harbor.z + 13, 4.1, 3.1);
  for (let i = 0; i < 3; i++) {
    const x = harbor.x - 40 + i * 44;
    buildings.push(paint(new THREE.BoxGeometry(36, 14, 26).translate(x, harbor.h + 7, harbor.z + 60), [0x8c4a3a, 0x3f6f8c, 0x8c7a3a][i]));
    solids.add(x - 18, x + 18, harbor.z + 47, harbor.z + 73, harbor.h + 14);
  }

  // The lighthouse.
  const lh = PADS.lighthouse;
  [[0, 6, 0xf2ece0], [6, 12, 0xc9402f], [12, 18, 0xf2ece0], [18, 24, 0xc9402f], [24, 30, 0xf2ece0]].forEach(([a, b, color]) => {
    const r0 = 6 - a * 0.1;
    const r1 = 6 - b * 0.1;
    buildings.push(paint(new THREE.CylinderGeometry(r1, r0, b - a, 12).translate(lh.x, lh.h + (a + b) / 2, lh.z), color));
  });
  buildings.push(paint(new THREE.ConeGeometry(4, 4, 10).translate(lh.x, lh.h + 36, lh.z), 0x3a3d46));
  solids.add(lh.x - 5.5, lh.x + 5.5, lh.z - 5.5, lh.z + 5.5, lh.h + 30);

  // Cabins in the grove.
  const grove = PADS.grove;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const x = grove.x + Math.cos(a) * 30;
    const z = grove.z + Math.sin(a) * 30;
    buildings.push(paint(new THREE.BoxGeometry(9, 4.4, 7).translate(x, grove.h + 2.2, z), 0x6b4a30));
    buildings.push(paint(new THREE.ConeGeometry(7, 3.4, 4).rotateY(Math.PI / 4).translate(x, grove.h + 6.1, z), 0x37261b));
    solids.add(x - 4.5, x + 4.5, z - 3.5, z + 3.5, grove.h + 4.4);
  }

  // A viewing deck on the summit.
  const summit = PADS.summit;
  buildings.push(paint(new THREE.CylinderGeometry(20, 22, 1, 12).translate(summit.x, summit.h + 0.4, summit.z), 0x8a8f9c));

  const static_ = new THREE.Mesh(mergeGeometries(buildings), new THREE.MeshLambertMaterial({ vertexColors: true }));
  static_.castShadow = true;
  static_.receiveShadow = true;
  root.add(static_);

  // The big wheel at the pier.
  const wheel = new THREE.Group();
  wheel.position.set(pier.x + 60, 44, pier.z - 10);
  const rimMat = new THREE.MeshLambertMaterial({ color: 0xe8e4d4, flatShading: true });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(34, 0.7, 6, 40), rimMat);
  wheel.add(rim);
  const spokes = [];
  const cabGeo = mergeGeometries([paint(new THREE.BoxGeometry(3.4, 3, 3.4), 0xffffff), paint(new THREE.BoxGeometry(3.8, 0.4, 3.8).translate(0, 1.7, 0), 0x333333)]);
  const cabs = [];
  const lightMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd23f).multiplyScalar(2), toneMapped: false });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.3, 68, 0.3), rimMat);
    spoke.rotation.z = a;
    if (i < 6) wheel.add(spoke);
    spokes.push(spoke);
    const cab = new THREE.Mesh(cabGeo, new THREE.MeshLambertMaterial({ vertexColors: true, color: [0xff3d8b, 0x35e0ff, 0xffd23f, 0x7cff6b][i % 4] }));
    cab.userData.a = a;
    root.add(cab);
    cabs.push(cab);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.55, 6, 4), lightMat);
    bulb.position.set(Math.cos(a) * 34, Math.sin(a) * 34, 0);
    wheel.add(bulb);
  }
  root.add(wheel);
  const legs = new THREE.Mesh(
    mergeGeometries([-1, 1].flatMap((s) => [-1, 1].map((f) => {
      const leg = new THREE.CylinderGeometry(0.5, 0.8, 46, 5);
      leg.rotateZ(s * 0.32);
      leg.rotateX(f * 0.13);
      leg.translate(pier.x + 60 + s * 8, 21, pier.z - 10 + f * 3);
      return leg;
    }))),
    rimMat,
  );
  root.add(legs);

  // The lighthouse beam.
  const beam = new THREE.Mesh(
    new THREE.ConeGeometry(16, 170, 12, 1, true).translate(0, -85, 0).rotateZ(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xfff2c9, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false }),
  );
  beam.position.set(lh.x, lh.h + 32, lh.z);
  root.add(beam);

  // Two airships drift around the island.
  const ship = mergeGeometries([
    paint(new THREE.SphereGeometry(1, 14, 10).scale(30, 9, 9), 0xe9e4d8),
    paint(new THREE.BoxGeometry(10, 3, 4).translate(0, -9.5, 0), 0x3a3d46),
    paint(new THREE.BoxGeometry(8, 8, 0.6).translate(-28, 4, 0), 0xc9402f),
  ]);
  const shipMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const airships = [0, Math.PI].map(() => {
    const m = new THREE.Mesh(ship, shipMat);
    root.add(m);
    return m;
  });

  return {
    update(t, glow) {
      wheel.rotation.z = t * 0.05;
      for (const cab of cabs) {
        const a = cab.userData.a + wheel.rotation.z;
        cab.position.set(wheel.position.x + Math.cos(a) * 34, wheel.position.y + Math.sin(a) * 34 - 2, wheel.position.z);
      }
      beam.rotation.y = t * 0.5;
      beam.material.opacity = glow * 0.16;
      airships.forEach((m, i) => {
        const a = t * 0.012 + i * Math.PI;
        const r = 780 + i * 240;
        m.position.set(Math.cos(a) * r, 260 + i * 70, Math.sin(a) * r);
        m.rotation.y = -a - Math.PI / 2;
      });
    },
  };
}

function runwayTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  g.fillStyle = '#2e2f35';
  g.fillRect(0, 0, 2048, 128);
  g.fillStyle = '#ece8da';
  g.fillRect(0, 6, 2048, 4);
  g.fillRect(0, 118, 2048, 4);
  for (let x = 90; x < 1960; x += 70) g.fillRect(x, 62, 40, 4);
  for (const end of [14, 1990]) {
    for (let y = 18; y < 110; y += 14) g.fillRect(end, y, 44, 8);
  }
  g.font = '700 46px sans-serif';
  g.textBaseline = 'middle';
  g.fillText('27', 76, 64);
  g.fillText('09', 1920, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}
