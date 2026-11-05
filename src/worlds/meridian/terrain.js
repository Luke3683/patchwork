import * as THREE from 'three';
import { groundMaterial, surface } from './textures.js';

export const HALF = 2200; // the map runs from -2200 to 2200 meters
export const CELL = 8;
const N = (HALF * 2) / CELL + 1;
const CHUNK = 40; // grid cells per terrain chunk
export const CITY_HEIGHT = 8;
export const CITY_RADIUS = 470;

/** Everywhere the land has to be flat, and how high. */
export const PADS = {
  city: { x: 0, z: 0, r: CITY_RADIUS, h: CITY_HEIGHT, blend: 130 },
  park: { x: 700, z: 560, r: 150, h: 16, blend: 70 },
  pier: { x: 180, z: -1510, r: 170, h: 5, blend: 80 },
  harbor: { x: -1460, z: -240, r: 150, h: 4, blend: 70 },
  lighthouse: { x: -1050, z: -1180, r: 60, h: 24, blend: 50 },
  summit: { x: 1450, z: -250, r: 34, h: 395, blend: 40 },
  isletA: { x: 1850, z: 1400, r: 80, h: 7, blend: 60 },
  isletB: { x: -1800, z: 1300, r: 70, h: 7, blend: 60 },
  grove: { x: -900, z: 240, r: 50, h: 34, blend: 60 },
};
export const AIRPORT = { x: -470, z: 660, hw: 400, hd: 80, h: 10 };
export const RUNWAY = { x: -470, z: 660, hw: 370, hd: 22 };

function makeNoise(seed) {
  let s = seed;
  const rand = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const table = new Float32Array(65536);
  for (let i = 0; i < table.length; i++) table[i] = rand();
  const at = (x, z) => table[((x & 255) | ((z & 255) << 8)) >>> 0];
  const noise = (x, z) => {
    const xi = Math.floor(x);
    const zi = Math.floor(z);
    let fx = x - xi;
    let fz = z - zi;
    fx = fx * fx * (3 - 2 * fx);
    fz = fz * fz * (3 - 2 * fz);
    const a = at(xi, zi);
    const b = at(xi + 1, zi);
    const c = at(xi, zi + 1);
    const d = at(xi + 1, zi + 1);
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
  };
  const fbm = (x, z, octaves) => {
    let v = 0;
    let amp = 0.5;
    let f = 1;
    for (let i = 0; i < octaves; i++) {
      v += amp * noise(x * f, z * f);
      f *= 2.03;
      amp *= 0.5;
    }
    return v;
  };
  return { noise, fbm, rand };
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function rawHeight(n, x, z) {
  const r = Math.hypot(x, z);
  const edge = r + (n.fbm(x * 0.0011 + 40, z * 0.0011 + 40, 3) - 0.5) * 560;
  const land = smooth(1850, 1400, edge);
  let h = -28 + land * (31 + n.fbm(x * 0.0035, z * 0.0035, 4) * 58);

  // The range in the east, with sharp ridges.
  const dm = Math.hypot(x - 1450, z + 250);
  if (dm < 820) {
    const m = smooth(820, 90, dm);
    const ridge = 1 - Math.abs(2 * n.fbm(x * 0.004 + 9, z * 0.004 + 9, 4) - 1);
    h += m * (150 + ridge * ridge * 330);
  }
  // Rolling hills in the western forest.
  const dw = Math.hypot(x + 950, z - 160);
  if (dw < 620) h += smooth(620, 100, dw) * (20 + n.fbm(x * 0.008, z * 0.008, 3) * 62);

  for (const islet of [PADS.isletA, PADS.isletB]) {
    const d = Math.hypot(x - islet.x, z - islet.z);
    if (d < 300) h = Math.max(h, -22 + smooth(300, 70, d) * 36);
  }
  return h;
}

/** A closed loop around the island. Its shape dodges the airport and the western harbor spur. */
function ringPoints() {
  const pts = [];
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    // The bulge swings the highway wide around the western end of the airfield.
    const off = ((a - 5.43 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const r = 1120 + Math.sin(a * 3 + 0.6) * 90 + Math.sin(a * 5 + 2) * 45 + Math.exp(-off * off * 3.2) * 300;
    pts.push(new THREE.Vector3(Math.sin(a) * r, 0, Math.cos(a) * r));
  }
  return new THREE.CatmullRomCurve3(pts, true, 'centripetal').getSpacedPoints(Math.floor((2 * Math.PI * 1120) / 10));
}

const line = (ax, az, bx, bz, step = 10) => {
  const d = Math.hypot(bx - ax, bz - az);
  const n = Math.ceil(d / step);
  return Array.from({ length: n + 1 }, (_, i) => new THREE.Vector3(ax + ((bx - ax) * i) / n, 0, az + ((bz - az) * i) / n));
};

export class Terrain {
  constructor() {
    this.n = makeNoise(20261105);
    this.heights = new Float32Array(N * N);
    this.colorNoise = new Float32Array(N * N);
    const weight = new Float32Array(N * N);
    const target = new Float32Array(N * N);

    const n = this.n;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = i * CELL - HALF;
        const z = j * CELL - HALF;
        this.heights[i + j * N] = rawHeight(n, x, z);
      }
    }

    const stamp = (x, z, h, inner, outer) => {
      const i0 = Math.max(0, Math.floor((x - outer + HALF) / CELL));
      const i1 = Math.min(N - 1, Math.ceil((x + outer + HALF) / CELL));
      const j0 = Math.max(0, Math.floor((z - outer + HALF) / CELL));
      const j1 = Math.min(N - 1, Math.ceil((z + outer + HALF) / CELL));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const d = Math.hypot(i * CELL - HALF - x, j * CELL - HALF - z);
          const w = smooth(outer, inner, d);
          const id = i + j * N;
          if (w > weight[id]) {
            weight[id] = w;
            target[id] = h;
          }
        }
      }
    };

    // Roads, each with heights smoothed so they climb hills gently.
    this.roads = [
      { name: 'ring', pts: ringPoints(), closed: true, hw: 9 },
      { name: 'north', pts: line(0, CITY_RADIUS - 20, 0, 1200), hw: 8 },
      { name: 'south', pts: line(0, -CITY_RADIUS + 20, 60, -1460), hw: 8 },
      { name: 'east', pts: line(CITY_RADIUS - 20, 0, 1170, 0), hw: 8 },
      { name: 'west', pts: line(-CITY_RADIUS + 20, 0, -1430, -240), hw: 8 },
      { name: 'parkSpur', pts: line(360, 200, 620, 500), hw: 7 },
      { name: 'airportSpur', pts: line(-140, 700, 0, 700), hw: 7 },
      { name: 'groveSpur', pts: line(-880, 220, -600, -80), hw: 6 },
      { name: 'lightSpur', pts: line(-1030, -1150, -760, -820), hw: 6 },
    ];
    for (const road of this.roads) {
      const raw = road.pts.map((p) => this.rawAt(p.x, p.z));
      const m = raw.length;
      const span = 12;
      road.heights = raw.map((_, i) => {
        let sum = 0;
        for (let k = -span; k <= span; k++) {
          const idx = road.closed ? (i + k + m) % m : THREE.MathUtils.clamp(i + k, 0, m - 1);
          sum += raw[idx];
        }
        return Math.min(150, Math.max(4.5, sum / (span * 2 + 1)));
      });
      road.pts.forEach((p, i) => { p.y = road.heights[i]; });
    }
    // Spurs must meet the land they lead to, so their ends take the pad height.
    this.pinRoad('north', 0, CITY_HEIGHT);
    this.pinRoad('south', 0, CITY_HEIGHT);
    this.pinRoad('east', 0, CITY_HEIGHT);
    this.pinRoad('west', 0, CITY_HEIGHT);
    this.pinRoad('south', -1, PADS.pier.h);
    this.pinRoad('west', -1, PADS.harbor.h);
    this.pinRoad('parkSpur', 0, CITY_HEIGHT);
    this.pinRoad('parkSpur', -1, PADS.park.h);
    this.pinRoad('airportSpur', 0, AIRPORT.h);
    this.pinRoad('groveSpur', 0, PADS.grove.h);
    this.pinRoad('lightSpur', 0, PADS.lighthouse.h);
    for (const name of ['north', 'east', 'south', 'west']) this.pinRoadToRing(name);

    for (const road of this.roads) {
      road.pts.forEach((p) => stamp(p.x, p.z, p.y, road.hw + 4, road.hw + 34));
    }
    for (const pad of Object.values(PADS)) stamp(pad.x, pad.z, pad.h, pad.r, pad.r + pad.blend);
    // The airfield is a rectangle.
    for (let x = AIRPORT.x - AIRPORT.hw; x <= AIRPORT.x + AIRPORT.hw; x += 40) {
      stamp(x, AIRPORT.z, AIRPORT.h, AIRPORT.hd, AIRPORT.hd + 70);
    }

    for (let id = 0; id < N * N; id++) {
      this.heights[id] += (target[id] - this.heights[id]) * weight[id];
    }
    this.padWeight = weight;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = i * CELL - HALF;
        const z = j * CELL - HALF;
        this.colorNoise[i + j * N] = n.fbm(x * 0.012, z * 0.012, 2);
      }
    }
  }

  rawAt(x, z) {
    const i = THREE.MathUtils.clamp(Math.round((x + HALF) / CELL), 0, N - 1);
    const j = THREE.MathUtils.clamp(Math.round((z + HALF) / CELL), 0, N - 1);
    return this.heights[i + j * N];
  }

  road(name) {
    return this.roads.find((r) => r.name === name);
  }

  /** Blends one end of a road to a fixed height over its last stretch. */
  pinRoad(name, end, h) {
    const road = this.road(name);
    const count = road.pts.length;
    const span = Math.min(30, count);
    for (let i = 0; i < span; i++) {
      const idx = end === 0 ? i : count - 1 - i;
      const t = 1 - i / span;
      road.pts[idx].y += (h - road.pts[idx].y) * (t * t * (3 - 2 * t));
    }
  }

  pinRoadToRing(name) {
    const road = this.road(name);
    const ring = this.road('ring');
    const crossing = road.pts.findIndex((p) => ring.pts.some((q) => Math.hypot(p.x - q.x, p.z - q.z) < 12));
    if (crossing < 0) return;
    const p = road.pts[crossing];
    const q = ring.pts.reduce((best, c) => (Math.hypot(c.x - p.x, c.z - p.z) < Math.hypot(best.x - p.x, best.z - p.z) ? c : best));
    const span = 30;
    for (let k = -span; k <= span; k++) {
      const idx = crossing + k;
      if (idx < 0 || idx >= road.pts.length) continue;
      const t = 1 - Math.abs(k) / span;
      road.pts[idx].y += (q.y - road.pts[idx].y) * (t * t * (3 - 2 * t));
    }
  }

  /** The ground height at any spot, matching the triangles the player sees. */
  height(x, z) {
    const gx = (x + HALF) / CELL;
    const gz = (z + HALF) / CELL;
    if (gx < 0 || gz < 0 || gx >= N - 1 || gz >= N - 1) return -30;
    const i = Math.floor(gx);
    const j = Math.floor(gz);
    const fx = gx - i;
    const fz = gz - j;
    const h = this.heights;
    const a = h[i + j * N];
    const d = h[i + 1 + (j + 1) * N];
    // Each quad is split along the same diagonal as the mesh.
    if (fx + fz < 1) {
      const b = h[i + 1 + j * N];
      const c = h[i + (j + 1) * N];
      return a + (b - a) * fx + (c - a) * fz;
    }
    const b = h[i + 1 + j * N];
    const c = h[i + (j + 1) * N];
    return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  }

  /** How steep the ground is around a grid point. */
  slopeAt(i, j) {
    const h = this.heights;
    const at = (a, b) => h[Math.min(N - 1, Math.max(0, a)) + Math.min(N - 1, Math.max(0, b)) * N];
    return Math.hypot(at(i + 1, j) - at(i - 1, j), at(i, j + 1) - at(i, j - 1)) / (CELL * 2);
  }

  /** Everything blends, so hillsides shade from meadow to rock to snow without hard edges. */
  colorAt(c, id, x, z, h, slope) {
    const shade = this.colorNoise[id];
    const pad = this.padWeight[id];
    const west = smooth(-300, -900, x);
    const dry = smooth(100, 900, x) * 0.45 + smooth(-800, -1400, z) * 0.55;
    const patch = this.n.noise(x * 0.0065 + 70, z * 0.0065 + 70);
    // Meadow, with broad patches of darker and golden grass.
    let r = 0.2 + shade * 0.14 + dry * 0.26 - west * 0.05 + patch * 0.16;
    let g = 0.44 + shade * 0.16 + dry * 0.03 - west * 0.1 + patch * 0.09;
    let b = 0.13 + shade * 0.06 - west * 0.02;
    const blend = (rr, gg, bb, t) => {
      r += (rr - r) * t;
      g += (gg - g) * t;
      b += (bb - b) * t;
    };
    blend(0.4 + shade * 0.1, 0.36 + shade * 0.09, 0.33 + shade * 0.08, Math.max(smooth(0.5, 0.95, slope), smooth(190, 270, h + shade * 40)));
    blend(0.96, 0.98, 1, smooth(285, 340, h + shade * 70) * (1 - smooth(1.1, 1.7, slope)));
    if (pad < 0.5) blend(0.88, 0.74, 0.5, smooth(6.5, 3, h));
    if (h < 0) blend(0.62, 0.55, 0.38, 1);
    return c.setRGB(r, g, b);
  }

  /** Chunks of smooth, photo-textured ground. Distant chunks are hidden each frame by the world. */
  buildMeshes(k) {
    const mat = groundMaterial(k.game.look.high);
    const chunks = [];
    const count = Math.ceil((N - 1) / CHUNK);
    const h = this.heights;
    const at = (a, b) => h[Math.min(N - 1, Math.max(0, a)) + Math.min(N - 1, Math.max(0, b)) * N];
    for (let cz = 0; cz < count; cz++) {
      for (let cx = 0; cx < count; cx++) {
        const i0 = cx * CHUNK;
        const j0 = cz * CHUNK;
        const i1 = Math.min(N - 1, (cx + 1) * CHUNK);
        const j1 = Math.min(N - 1, (cz + 1) * CHUNK);
        const w = i1 - i0 + 1;
        const d = j1 - j0 + 1;
        const pos = new Float32Array(w * d * 3);
        const nor = new Float32Array(w * d * 3);
        const splat = new Float32Array(w * d * 3);
        const tint = new Float32Array(w * d * 3);
        let highest = -Infinity;
        let v = 0;
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            const id = i + j * N;
            const y = h[id];
            const x = i * CELL - HALF;
            const z = j * CELL - HALF;
            highest = Math.max(highest, y);
            pos[v * 3] = x;
            pos[v * 3 + 1] = y;
            pos[v * 3 + 2] = z;
            // Normals from the height differences, so chunks join without a seam.
            const nx = at(i - 1, j) - at(i + 1, j);
            const nz = at(i, j - 1) - at(i, j + 1);
            const len = Math.hypot(nx, CELL * 2, nz);
            nor[v * 3] = nx / len;
            nor[v * 3 + 1] = (CELL * 2) / len;
            nor[v * 3 + 2] = nz / len;
            const slope = this.slopeAt(i, j);
            const shade = this.colorNoise[id];
            const pad = this.padWeight[id];
            const snow = smooth(285, 340, y + shade * 70) * (1 - smooth(1.1, 1.7, slope));
            const rock = Math.max(smooth(0.5, 0.95, slope), smooth(190, 270, y + shade * 40));
            const sand = y < 0 ? 1 : pad < 0.5 ? smooth(6.5, 3, y) : 0;
            splat[v * 3] = rock;
            splat[v * 3 + 1] = sand;
            splat[v * 3 + 2] = snow;
            const west = smooth(-300, -900, x);
            const dry = smooth(100, 900, x) * 0.45 + smooth(-800, -1400, z) * 0.55;
            const patch = this.n.noise(x * 0.0065 + 70, z * 0.0065 + 70);
            tint[v * 3] = 0.62 + patch * 0.34 + dry * 0.44 - west * 0.12;
            tint[v * 3 + 1] = 1.02 + patch * 0.16 + dry * 0.02 - west * 0.12;
            tint[v * 3 + 2] = 0.46 + shade * 0.16 - dry * 0.1 - west * 0.04;
            v += 1;
          }
        }
        if (highest < -2) continue; // nothing here rises near the water
        const index = [];
        for (let b = 0; b < d - 1; b++) {
          for (let a = 0; a < w - 1; a++) {
            const q = a + b * w;
            index.push(q, q + w, q + 1, q + 1, q + w, q + w + 1);
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        geo.setAttribute('splat', new THREE.BufferAttribute(splat, 3));
        geo.setAttribute('tint', new THREE.BufferAttribute(tint, 3));
        geo.setIndex(index);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.receiveShadow = true;
        mesh.userData.center = new THREE.Vector2((cx + 0.5) * CHUNK * CELL - HALF, (cz + 0.5) * CHUNK * CELL - HALF);
        k.root.add(mesh);
        chunks.push(mesh);
      }
    }
    return chunks;
  }

  /** Road ribbons that follow the ground. */
  buildRoads(k, lineMaterial) {
    const pos = [];
    const uv = [];
    const idx = [];
    for (const road of this.roads) {
      const { pts, hw, closed } = road;
      let travelled = 0;
      const start = pos.length / 3;
      const count = closed ? pts.length + 1 : pts.length;
      for (let n = 0; n < count; n++) {
        const i = n % pts.length;
        const prev = pts[closed ? (i - 1 + pts.length) % pts.length : Math.max(0, i - 1)];
        const next = pts[closed ? (i + 1) % pts.length : Math.min(pts.length - 1, i + 1)];
        const dx = next.x - prev.x;
        const dz = next.z - prev.z;
        const len = Math.hypot(dx, dz) || 1;
        const nx = -dz / len;
        const nz = dx / len;
        const p = pts[i];
        for (const s of [-1, 1]) {
          const x = p.x + nx * hw * s;
          const z = p.z + nz * hw * s;
          pos.push(x, this.height(x, z) + 0.22, z);
          uv.push(s < 0 ? 0 : 1, travelled / 16);
        }
        travelled += 10;
        if (n > 0) {
          const a = start + (n - 1) * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const asphalt = surface(k.game.look.high, 'asphalt', { repeat: 2, repeatY: 1.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(geo, asphalt);
    mesh.receiveShadow = true;
    k.root.add(mesh);
    const paintLines = new THREE.Mesh(geo, lineMaterial);
    paintLines.renderOrder = 1;
    k.root.add(paintLines);
    return mesh;
  }

  /** The map shown on the HUD, painted once. */
  buildMapCanvas() {
    const size = 360;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const g = canvas.getContext('2d');
    const img = g.createImageData(size, size);
    const c = new THREE.Color();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const wx = (x / size) * HALF * 2 - HALF;
        const wz = (y / size) * HALF * 2 - HALF;
        const h = this.height(wx, wz);
        const i = (x + y * size) * 4;
        if (h < 0) {
          const t = clamp01(-h / 22);
          img.data[i] = 26 - t * 12;
          img.data[i + 1] = 92 - t * 44;
          img.data[i + 2] = 130 - t * 44;
        } else {
          this.colorAt(c, Math.floor((wx + HALF) / CELL) + Math.floor((wz + HALF) / CELL) * N, wx, wz, h, 0);
          img.data[i] = c.r * 190;
          img.data[i + 1] = c.g * 190;
          img.data[i + 2] = c.b * 190;
        }
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    const toMap = (v) => ((v + HALF) / (HALF * 2)) * size;
    g.strokeStyle = 'rgba(40,40,50,0.95)';
    g.lineWidth = 2.5;
    for (const road of this.roads) {
      g.beginPath();
      road.pts.forEach((p, i) => (i ? g.lineTo(toMap(p.x), toMap(p.z)) : g.moveTo(toMap(p.x), toMap(p.z))));
      if (road.closed) g.closePath();
      g.stroke();
    }
    return canvas;
  }

  /** Low-res depths, so the water can tell where the shallows and shores are. */
  buildDepthTexture() {
    const size = 256;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const h = this.height(((x + 0.5) / size) * HALF * 2 - HALF, ((y + 0.5) / size) * HALF * 2 - HALF);
        const v = clamp01((h + 25) / 50) * 255;
        const i = (x + y * size) * 4;
        data[i] = v;
        data[i + 1] = v;
        data[i + 2] = v;
        data[i + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, size, size);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }
}

const WATER_VERT = /* glsl */`
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const WATER_FRAG = /* glsl */`
  varying vec3 vW;
  uniform sampler2D depthTex;
  uniform float time;
  uniform float halfSize;
  uniform vec3 sunDir;
  uniform vec3 sunColor;
  uniform vec3 skyColor;
  uniform vec3 fogCol;
  uniform float fogNear;
  uniform float fogFar;
  uniform float night;

  float wave(vec2 p, vec2 d, float f, float s) { return sin(dot(p, d) * f + time * s); }

  void main() {
    vec2 uv = (vW.xz + halfSize) / (2.0 * halfSize);
    float h = -25.0;
    if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) h = texture2D(depthTex, uv).r * 50.0 - 25.0;
    float depth = clamp(-h / 13.0, 0.0, 1.0);

    vec2 p = vW.xz;
    float dist = length(cameraPosition - vW);
    float detail = smoothstep(500.0, 40.0, dist);
    float dx = wave(p, vec2(0.8, 0.6), 0.13, 1.1) * 0.5 + wave(p, vec2(-0.5, 0.86), 0.31, 1.7) * 0.25
      + wave(p, vec2(0.96, -0.28), 0.77, 2.6) * 0.13 * detail + wave(p, vec2(0.2, 0.98), 1.9, 3.8) * 0.06 * detail;
    float dz = wave(p, vec2(0.7, -0.7), 0.17, 1.3) * 0.5 + wave(p, vec2(0.3, 0.95), 0.41, 2.1) * 0.25
      + wave(p, vec2(-0.9, 0.42), 0.93, 3.0) * 0.13 * detail + wave(p, vec2(-0.8, -0.6), 2.2, 4.3) * 0.06 * detail;
    float calm = mix(0.16, 1.0, smoothstep(900.0, 90.0, dist)); // far water reads as smooth, not striped
    vec3 n = normalize(vec3(dx * 0.13 * calm, 1.0, dz * 0.13 * calm));

    vec3 view = normalize(cameraPosition - vW);
    float fres = pow(1.0 - max(dot(n, view), 0.0), 4.0);
    float daylight = 1.0 - night * 0.86;
    vec3 shallow = vec3(0.0, 0.78, 0.68) * daylight;
    vec3 deep = vec3(0.0, 0.2, 0.42) * daylight;
    vec3 col = mix(shallow, deep, depth);
    col = mix(col, skyColor, 0.08 + fres * 0.82);

    vec3 r = reflect(-sunDir, n);
    float spec = pow(max(dot(r, view), 0.0), 170.0) * 5.0 + pow(max(dot(r, view), 0.0), 24.0) * 0.16;
    col += sunColor * spec * smoothstep(-0.05, 0.06, sunDir.y);

    float shore = smoothstep(0.34, 0.0, depth);
    float foam = shore * (0.5 + 0.5 * sin(depth * 34.0 - time * 1.3 + dx * 3.0));
    foam = smoothstep(0.56, 1.0, foam) + smoothstep(0.07, 0.0, depth) * 0.7;
    col = mix(col, vec3(0.95) * max(daylight, 0.2), clamp(foam, 0.0, 1.0) * 0.72);

    float fog = smoothstep(fogNear, fogFar, dist);
    col = mix(col, fogCol, fog);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function makeWater(terrain, sky) {
  const uniforms = {
    depthTex: { value: terrain.buildDepthTexture() },
    time: { value: 0 },
    halfSize: { value: HALF },
    sunDir: { value: sky.sunDir },
    sunColor: sky.uniforms.sunColor,
    skyColor: sky.uniforms.horizon,
    fogCol: { value: new THREE.Color() },
    fogNear: { value: sky.fogNear },
    fogFar: { value: sky.fogFar },
    night: sky.uniforms.night,
  };
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(9000, 9000, 1, 1).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({ vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, uniforms }),
  );
  mesh.frustumCulled = false;
  mesh.userData.uniforms = uniforms;
  return mesh;
}
