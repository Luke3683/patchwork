import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HALF, CELL } from './terrain.js';

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** One image holding every kind of leaf, so all trees share a single material. */
function foliageAtlas() {
  const S = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const g = canvas.getContext('2d');
  const rand = seeded(31337);

  // Top left: a pine bough, dark needles fanning out from a stem.
  const bough = (ox, oy, w, h) => {
    g.fillStyle = 'rgb(120,155,115)';
    g.beginPath();
    g.moveTo(ox + w / 2, oy + 6);
    g.lineTo(ox + w * 0.96, oy + h * 0.96);
    g.quadraticCurveTo(ox + w / 2, oy + h * 0.82, ox + w * 0.04, oy + h * 0.96);
    g.closePath();
    g.fill();
    for (let i = 0; i < 1500; i++) {
      const t = rand();
      const y = oy + h * t;
      const x = ox + w / 2 + (rand() - 0.5) * w * t * 0.98;
      const l = 12 + rand() * 18;
      const a = Math.PI / 2 + (x - (ox + w / 2)) * 0.012 + (rand() - 0.5) * 0.5;
      const v = 150 + rand() * 105;
      g.strokeStyle = `rgb(${v * 0.75},${v},${v * 0.72})`;
      g.lineWidth = 1.6 + rand() * 1.4;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
  };
  bough(0, 0, S / 2, S / 2);

  // Top right: a broadleaf canopy, a dense blob of little leaves.
  g.fillStyle = 'rgb(120,150,100)';
  g.beginPath();
  g.arc(S * 0.75, S * 0.25, S * 0.19, 0, Math.PI * 2);
  g.fill();
  for (let i = 0; i < 2600; i++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * S * 0.225;
    const x = S * 0.75 + Math.cos(a) * r;
    const y = S * 0.25 + Math.sin(a) * r;
    const v = 130 + rand() * 125;
    g.fillStyle = `rgb(${v * 0.9},${v},${v * 0.8})`;
    g.beginPath();
    g.ellipse(x, y, 6 + rand() * 6, 3 + rand() * 3, rand() * 6, 0, Math.PI * 2);
    g.fill();
  }

  // Bottom left: a palm frond, with leaflets running down a curved spine.
  for (let i = 0; i < 90; i++) {
    const t = i / 90;
    const y = S / 2 + 10 + t * (S / 2 - 20);
    const x = S * 0.25;
    const l = (1 - t * t) * S * 0.2 * (0.86 + rand() * 0.28);
    for (const side of [-1, 1]) {
      const v = 170 + rand() * 80;
      g.strokeStyle = `rgb(${v * 0.85},${v},${v * 0.72})`;
      g.lineWidth = 4 + (1 - t) * 3;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + side * l * 0.6, y + 6, x + side * l, y + 34 + t * 10);
      g.stroke();
    }
  }
  g.strokeStyle = 'rgb(210,210,150)';
  g.lineWidth = 5;
  g.beginPath();
  g.moveTo(S * 0.25, S / 2 + 10);
  g.lineTo(S * 0.25, S - 10);
  g.stroke();

  // Bottom right: bark, filling the square so trunks can use it.
  g.fillStyle = '#6e5540';
  g.fillRect(S / 2, S / 2, S / 2, S / 2);
  for (let i = 0; i < 1400; i++) {
    const v = 50 + rand() * 80;
    g.fillStyle = `rgba(${v},${v * 0.78},${v * 0.6},0.5)`;
    g.fillRect(S / 2 + rand() * S / 2, S / 2 + rand() * S / 2, 3 + rand() * 4, 14 + rand() * 40);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

const REGION = {
  pine: [0, 0.5, 0.5, 1],
  leaf: [0.5, 0.5, 1, 1],
  palm: [0, 0, 0.5, 0.5],
  bark: [0.52, 0.02, 0.98, 0.48],
};

function card(width, height, region, rotY, tilt = 0, x = 0, y = 0, z = 0, droop = 0) {
  const geo = new THREE.PlaneGeometry(width, height, 1, droop ? 3 : 1);
  const [u0, v0, u1, v1] = region;
  const uv = geo.attributes.uv;
  const pos = geo.attributes.position;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    const t = 0.5 - pos.getY(i) / height; // 0 at the top of the card, 1 at the bottom
    if (droop) pos.setZ(i, pos.getZ(i) + droop * t * t);
  }
  geo.rotateX(tilt);
  geo.rotateY(rotY);
  geo.translate(x, y, z);
  return geo;
}

function trunk(r0, r1, h, bendX = 0, sides = 6) {
  const geo = new THREE.CylinderGeometry(r1, r0, h, sides, 4, true);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const [u0, v0, u1, v1] = REGION.bark;
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getY(i) / h + 0.5;
    pos.setX(i, pos.getX(i) + bendX * t * t);
    uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
  }
  geo.translate(0, h / 2, 0);
  return geo;
}

function pineGeometry() {
  const parts = [trunk(0.34, 0.08, 13)];
  for (let layer = 0; layer < 5; layer++) {
    const size = 6.6 - layer * 1.05;
    const y = 4.4 + layer * 2.1;
    for (let i = 0; i < 3; i++) parts.push(card(size, size * 0.86, REGION.pine, (i / 3) * Math.PI + layer * 0.5, 0, 0, y, 0));
  }
  return mergeGeometries(parts);
}

function leafyGeometry() {
  const parts = [trunk(0.32, 0.16, 5.2)];
  const blobs = [[0, 6.4, 0, 6.4], [1.4, 5.3, 0.6, 4.6], [-1.3, 5.5, -0.5, 4.4], [0.3, 7.6, -0.8, 4.2]];
  for (const [x, y, z, size] of blobs) {
    for (let i = 0; i < 3; i++) parts.push(card(size, size, REGION.leaf, (i / 3) * Math.PI + x, 0, x, y, z));
    parts.push(card(size, size, REGION.leaf, 0, -Math.PI / 2, x, y, z));
  }
  return mergeGeometries(parts);
}

function palmGeometry() {
  const parts = [trunk(0.27, 0.15, 9.6, 0.7, 7)];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const frond = card(1.9, 4.6, REGION.palm, 0, 0, 0, 0, 0, -2.1);
    frond.translate(0, -2.3, 0);
    frond.rotateX(Math.PI / 2 - 0.62 + (i % 2) * 0.25);
    frond.rotateY(a);
    frond.translate(0.7, 9.6, 0);
    parts.push(frond);
  }
  return mergeGeometries(parts);
}

export function foliageMaterial() {
  return new THREE.MeshLambertMaterial({
    map: foliageAtlas(),
    alphaTest: 0.35,
    side: THREE.DoubleSide,
  });
}

/** Trees grouped by area, so distant groups can be hidden whole. */
function scatter(k, geometry, material, points, cellSize = 480) {
  const cells = new Map();
  for (const p of points) {
    const key = `${Math.floor(p.x / cellSize)},${Math.floor(p.z / cellSize)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(p);
  }
  const groups = [];
  for (const list of cells.values()) {
    const mesh = k.instanced(geometry, material, list.length, (d, i) => {
      const p = list[i];
      d.position.set(p.x, p.y, p.z);
      d.rotation.y = p.r;
      d.scale.setScalar(p.s);
      return p.color;
    });
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: material.map, alphaTest: 0.35 });
    mesh.computeBoundingSphere();
    mesh.userData.center = new THREE.Vector2(mesh.boundingSphere.center.x, mesh.boundingSphere.center.z);
    groups.push(mesh);
  }
  return groups;
}

/** Every tree and rock on the island. Returns groups for the world to show and hide. */
export function buildFoliage(k, terrain, extraPalms = []) {
  const high = k.game.look.high;
  const rand = seeded(9182);
  const material = foliageMaterial();
  const N = (HALF * 2) / CELL + 1;
  const pines = [];
  const leafy = [];
  const palms = extraPalms.filter((_, i) => high || i % 4 === 0).map(([x, y, z]) => ({ x, y, z, r: rand() * 6, s: 0.95 + rand() * 0.35, color: 0xffffff }));
  const rocks = [];
  const attempts = high ? 90000 : 16000;
  for (let i = 0; i < attempts; i++) {
    const x = (rand() - 0.5) * HALF * 1.95;
    const z = (rand() - 0.5) * HALF * 1.95;
    const h = terrain.height(x, z);
    if (h < 1.5) continue;
    const id = Math.round((x + HALF) / CELL) + Math.round((z + HALF) / CELL) * N;
    if (terrain.padWeight[id] > 0.05) continue;
    const density = terrain.n.fbm(x * 0.006 + 3, z * 0.006 + 3, 3);
    const roll = rand();
    const slope = terrain.slopeAt(Math.round((x + HALF) / CELL), Math.round((z + HALF) / CELL));
    if (h < 7) {
      if (roll < 0.035) palms.push({ x, y: h - 0.1, z, r: rand() * 6, s: 0.9 + rand() * 0.5, color: 0xffffff });
    } else if (h > 240 || slope > 0.85) {
      if (roll < 0.016) rocks.push({ x, y: h, z, r: rand() * 6, s: 1 + rand() * 3.4, color: 0x8d8b88 });
    } else if (density > 0.4 && h < 205) {
      if (roll < 0.3) {
        const tone = 0.62 + rand() * 0.4;
        const c = new THREE.Color();
        if (x < -100 || h > 70) {
          c.setRGB(0.42 * tone, 0.62 * tone, 0.45 * tone);
          pines.push({ x, y: h - 0.2, z, r: rand() * 6, s: 0.75 + rand() * 0.95, color: c.getHex() });
        } else {
          const autumn = rand() < 0.14;
          if (autumn) c.setRGB(0.95 * tone, 0.6 * tone, 0.28 * tone);
          else c.setRGB(0.48 * tone, 0.68 * tone, 0.34 * tone);
          leafy.push({ x, y: h - 0.2, z, r: rand() * 6, s: 0.85 + rand() * 0.8, color: c.getHex() });
        }
      }
    } else if (roll < 0.008) {
      rocks.push({ x, y: h, z, r: rand() * 6, s: 0.5 + rand() * 1.6, color: 0x8d8b88 });
    }
  }
  const rockGeo = new THREE.DodecahedronGeometry(1.4, 1);
  const pos = rockGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const n = 1 + Math.sin(pos.getX(i) * 3.1 + pos.getZ(i) * 2.3) * 0.13;
    pos.setXYZ(i, pos.getX(i) * n, pos.getY(i) * 0.72, pos.getZ(i) * n);
  }
  rockGeo.computeVertexNormals();
  const rockMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  return [
    ...scatter(k, pineGeometry(), material, pines),
    ...scatter(k, leafyGeometry(), material, leafy),
    ...scatter(k, palmGeometry(), material, palms),
    ...scatter(k, rockGeo, rockMat, rocks),
  ];
}

/**
 * Grass that fills the ground around the player, and moves with them. Desktop only,
 * since thousands of see-through blades are too much for a headset.
 */
export function buildGrass(k, terrain) {
  const count = 7000;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const g = canvas.getContext('2d');
  const rand = seeded(777);
  for (let i = 0; i < 120; i++) {
    const x = rand() * 256;
    const lean = (rand() - 0.5) * 34;
    const h = 60 + rand() * 66;
    const v = 150 + rand() * 105;
    g.strokeStyle = `rgb(${v * 0.82},${v},${v * 0.6})`;
    g.lineWidth = 1.8 + rand() * 2.2;
    g.beginPath();
    g.moveTo(x, 128);
    g.quadraticCurveTo(x + lean * 0.2, 128 - h * 0.6, x + lean, 128 - h);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.4, side: THREE.DoubleSide, color: 0x9fb46e });
  const blade = mergeGeometries([
    new THREE.PlaneGeometry(1.9, 0.42).translate(0, 0.21, 0),
    new THREE.PlaneGeometry(1.9, 0.42).translate(0, 0.21, 0).rotateY(Math.PI / 2),
  ]);
  const mesh = new THREE.InstancedMesh(blade, material, count);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.receiveShadow = true;
  k.root.add(mesh);
  const dummy = new THREE.Object3D();
  const N = (HALF * 2) / CELL + 1;
  const SPACING = 1.5;
  const RADIUS = 62;
  let lastX = Infinity;
  let lastZ = Infinity;
  const hash = (x, z) => {
    const v = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
    return v - Math.floor(v);
  };
  return (focus) => {
    if (Math.hypot(focus.x - lastX, focus.z - lastZ) < 9) return;
    lastX = focus.x;
    lastZ = focus.z;
    let n = 0;
    const steps = Math.floor(RADIUS / SPACING);
    const cx = Math.round(focus.x / SPACING);
    const cz = Math.round(focus.z / SPACING);
    for (let i = -steps; i <= steps && n < count; i++) {
      for (let j = -steps; j <= steps && n < count; j++) {
        if (i * i + j * j > steps * steps) continue;
        const gx = cx + i;
        const gz = cz + j;
        const r0 = hash(gx, gz);
        if (r0 > 0.62) continue; // gaps keep it from looking like a carpet
        const x = gx * SPACING + (hash(gz, gx) - 0.5) * SPACING;
        const z = gz * SPACING + (r0 - 0.3) * SPACING;
        const h = terrain.height(x, z);
        if (h < 4.6 || h > 200) continue;
        const ix = Math.round((x + HALF) / CELL);
        const iz = Math.round((z + HALF) / CELL);
        if (terrain.padWeight[ix + iz * N] > 0.35 || terrain.slopeAt(ix, iz) > 0.55) continue;
        dummy.position.set(x, h - 0.02, z);
        dummy.rotation.y = r0 * 6.28;
        dummy.scale.setScalar(0.72 + r0 * 0.8);
        dummy.updateMatrix();
        mesh.setMatrixAt(n++, dummy.matrix);
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  };
}
