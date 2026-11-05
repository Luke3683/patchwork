import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const DARK = 0x101114;
const CHROME = 0xcfd4dc;
const RUBBER = 0x141416;

/**
 * Builds a smooth skin through cross-sections along the Z axis, like the formers of a
 * real car body. Each station: z, half width w, top and bottom heights, and a
 * squareness e (0.5 is rounded, smaller is boxier).
 */
export function loft(stations, { sides = 22, smooth = 3, offsetX = 0 } = {}) {
  // Resample between stations with a smooth curve, so the body has no hard creases.
  const lerpKey = (a, b, t, key) => a[key] + (b[key] - a[key]) * (t * t * (3 - 2 * t) * 0.5 + t * 0.5);
  const rows = [];
  for (let i = 0; i < stations.length - 1; i++) {
    for (let s = 0; s < smooth; s++) {
      const t = s / smooth;
      const a = stations[i];
      const b = stations[i + 1];
      rows.push({
        z: a.z + (b.z - a.z) * t,
        w: lerpKey(a, b, t, 'w'),
        top: lerpKey(a, b, t, 'top'),
        bot: lerpKey(a, b, t, 'bot'),
        e: (a.e ?? 0.5) + ((b.e ?? 0.5) - (a.e ?? 0.5)) * t,
      });
    }
  }
  rows.push({ ...stations[stations.length - 1], e: stations[stations.length - 1].e ?? 0.5 });

  const pos = [];
  const idx = [];
  const ring = sides + 1;
  for (const r of rows) {
    const mid = (r.top + r.bot) / 2;
    const h = (r.top - r.bot) / 2;
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      pos.push(offsetX + Math.sign(c) * Math.abs(c) ** r.e * r.w, mid + Math.sign(s) * Math.abs(s) ** r.e * h, r.z);
    }
  }
  for (let j = 0; j < rows.length - 1; j++) {
    for (let i = 0; i < sides; i++) {
      const a = j * ring + i;
      const b = a + ring;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  // Close both ends.
  const addCap = (row, flip) => {
    const r = rows[row];
    const center = pos.length / 3;
    pos.push(offsetX, (r.top + r.bot) / 2, r.z);
    for (let i = 0; i < sides; i++) {
      const a = row * ring + i;
      if (flip) idx.push(center, a + 1, a);
      else idx.push(center, a, a + 1);
    }
  };
  addCap(0, false);
  addCap(rows.length - 1, true);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

const clean = (g) => {
  const out = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) {
    if (!['position', 'normal'].includes(name)) out.deleteAttribute(name);
  }
  if (!out.attributes.normal) out.computeVertexNormals();
  return out;
};
const merge = (parts) => mergeGeometries(parts.map(clean));
const tinted = (g, hex) => {
  const out = clean(g);
  const c = new THREE.Color(hex);
  const col = new Float32Array(out.attributes.position.count * 3);
  for (let i = 0; i < col.length; i += 3) {
    col[i] = c.r;
    col[i + 1] = c.g;
    col[i + 2] = c.b;
  }
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
};

const paintMat = (color, high) => (high
  ? new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.38, clearcoat: 1, clearcoatRoughness: 0.08 })
  : new THREE.MeshLambertMaterial({ color }));
const glassMat = (high) => (high
  ? new THREE.MeshStandardMaterial({ color: 0x0a0f15, metalness: 0.95, roughness: 0.06 })
  : new THREE.MeshLambertMaterial({ color: 0x18222c }));
const chromeMat = (high) => (high
  ? new THREE.MeshStandardMaterial({ color: CHROME, metalness: 1, roughness: 0.18 })
  : new THREE.MeshLambertMaterial({ color: CHROME }));
const rubberMat = () => new THREE.MeshLambertMaterial({ color: RUBBER });
const darkMat = () => new THREE.MeshLambertMaterial({ color: DARK });
const glow = (hex, power = 2.4) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(power), toneMapped: false });

const shadowed = (mesh) => {
  mesh.castShadow = true;
  return mesh;
};

function wheel(r, w, high) {
  const g = new THREE.Group();
  const profile = [[0.001, -w / 2], [r * 0.62, -w / 2], [r * 0.94, -w / 2], [r, -w * 0.3], [r, w * 0.3], [r * 0.94, w / 2], [r * 0.62, w / 2], [0.001, w / 2]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const tire = new THREE.LatheGeometry(profile, 22).rotateZ(Math.PI / 2);
  g.add(new THREE.Mesh(tire, rubberMat()));
  const spokes = [];
  for (let i = 0; i < 5; i++) {
    const spoke = new THREE.BoxGeometry(w + 0.03, r * 0.13, r * 0.52).translate(0, 0, r * 0.3);
    spoke.rotateX((i / 5) * Math.PI * 2);
    spokes.push(spoke);
  }
  spokes.push(new THREE.CylinderGeometry(r * 0.2, r * 0.2, w + 0.05, 12).rotateZ(Math.PI / 2));
  spokes.push(new THREE.TorusGeometry(r * 0.6, r * 0.05, 6, 22).rotateY(Math.PI / 2).translate(w * 0.5, 0, 0));
  spokes.push(new THREE.TorusGeometry(r * 0.6, r * 0.05, 6, 22).rotateY(Math.PI / 2).translate(-w * 0.5, 0, 0));
  g.add(new THREE.Mesh(merge(spokes), chromeMat(high)));
  g.children.forEach(shadowed);
  return g;
}

/** Sedans, sports cars and SUVs share one recipe with different proportions. */
function carBody({ L = 2.28, W = 0.94, hood = 0.86, deck = 0.92, floor = 0.3, roof = 1.42, cabinFront = -0.72, cabinBack = 1.2, tail = 0.9, low = false }) {
  const q = low ? { sides: 10, smooth: 1 } : null;
  return {
    body: loft([
      { z: -L, w: W * 0.62, top: hood * 0.72, bot: floor + 0.14, e: 0.38 },
      { z: -L + 0.14, w: W * 0.86, top: hood * 0.82, bot: floor + 0.04, e: 0.34 },
      { z: -L + 0.6, w: W * 0.98, top: hood * 0.94, bot: floor, e: 0.3 },
      { z: -0.9, w: W, top: hood, bot: floor, e: 0.3 },
      { z: cabinFront, w: W, top: hood + 0.03, bot: floor, e: 0.3 },
      { z: 0.4, w: W, top: (hood + deck) / 2 + 0.02, bot: floor, e: 0.3 },
      { z: cabinBack, w: W * 0.98, top: deck, bot: floor, e: 0.3 },
      { z: L - 0.45, w: W * 0.96, top: deck, bot: floor + 0.02, e: 0.32 },
      { z: L - 0.08, w: W * 0.82, top: deck * tail, bot: floor + 0.1, e: 0.36 },
      { z: L, w: W * 0.6, top: deck * tail * 0.92, bot: floor + 0.2, e: 0.4 },
    ], q ?? { sides: 28, smooth: 4 }),
    cabin: loft([
      { z: cabinFront - 0.2, w: W * 0.84, top: hood - 0.02, bot: hood - 0.1, e: 0.5 },
      { z: cabinFront + 0.22, w: W * 0.8, top: hood + (roof - hood) * 0.55, bot: hood - 0.14, e: 0.46 },
      { z: cabinFront + 0.72, w: W * 0.74, top: roof, bot: hood - 0.14, e: 0.42 },
      { z: (cabinFront + cabinBack) / 2 + 0.28, w: W * 0.74, top: roof + 0.015, bot: hood - 0.14, e: 0.42 },
      { z: cabinBack - 0.22, w: W * 0.74, top: roof - 0.02, bot: deck - 0.12, e: 0.44 },
      { z: cabinBack + 0.28, w: W * 0.8, top: deck + 0.03, bot: deck - 0.1, e: 0.5 },
    ], q ?? { sides: 22, smooth: 3 }),
    roof: loft([
      { z: cabinFront + 0.56, w: W * 0.68, top: roof + 0.018, bot: roof - 0.03, e: 0.5 },
      { z: cabinFront + 0.8, w: W * 0.72, top: roof + 0.028, bot: roof - 0.02, e: 0.5 },
      { z: cabinBack - 0.3, w: W * 0.72, top: roof + 0.028, bot: roof - 0.02, e: 0.5 },
      { z: cabinBack - 0.12, w: W * 0.66, top: roof - 0.01, bot: roof - 0.05, e: 0.5 },
    ], q ?? { sides: 16, smooth: 2 }),
  };
}

function assembleCar(color, high, shape, { wheelR = 0.36, wheelW = 0.25, axle = 1.34, track = 0.86, seatY = 0.62, chase = 7, chaseHeight = 2.4 } = {}) {
  const g = new THREE.Group();
  const parts = carBody(shape);
  const L = shape.L ?? 2.28;
  const W = shape.W ?? 0.94;
  const paint = paintMat(color, high);
  // The body must stay the first child: that's what the paint shop recolors.
  g.add(shadowed(new THREE.Mesh(merge([parts.body, parts.roof]), paint)));
  g.add(shadowed(new THREE.Mesh(parts.cabin, glassMat(high))));

  // Wheel arches, mirrors, door seams, grille and sills.
  const dark = [];
  for (const [x, z] of [[-1, axle], [1, axle], [-1, -axle], [1, -axle]]) {
    dark.push(new THREE.CylinderGeometry(wheelR * 1.14, wheelR * 1.14, 0.06, 20).rotateZ(Math.PI / 2).translate(x * (W + 0.002), wheelR, z));
  }
  dark.push(new THREE.BoxGeometry(W * 1.2, 0.14, 0.04).translate(0, (shape.floor ?? 0.3) + 0.2, -L + 0.012));
  dark.push(new THREE.BoxGeometry(W * 2.01, 0.07, L * 1.5).translate(0, (shape.floor ?? 0.3) + 0.02, 0));
  for (const s of [-1, 1]) {
    dark.push(new THREE.BoxGeometry(0.012, 0.42, 0.012).translate(s * (W + 0.004), (shape.floor ?? 0.3) + 0.36, -0.15));
    dark.push(new THREE.BoxGeometry(0.012, 0.42, 0.012).translate(s * (W + 0.004), (shape.floor ?? 0.3) + 0.36, 0.72));
  }
  g.add(new THREE.Mesh(merge(dark), darkMat()));
  const mirrors = [-1, 1].map((s) => new THREE.SphereGeometry(0.075, 8, 6).scale(1, 0.72, 1).translate(s * (W + 0.06), (shape.hood ?? 0.86) + 0.1, (shape.cabinFront ?? -0.72) + 0.28));
  g.add(new THREE.Mesh(merge(mirrors), paint));

  // Lights.
  const hoodY = (shape.hood ?? 0.86) * 0.78;
  const head = new THREE.Mesh(merge([-1, 1].map((s) => new THREE.SphereGeometry(0.16, 10, 8).scale(1.25, 0.46, 0.5).translate(s * W * 0.62, hoodY, -L + 0.1))), glow(0xfff2d9, 2.8));
  const tailY = (shape.deck ?? 0.92) * 0.9;
  const tail = new THREE.Mesh(merge([-1, 1].map((s) => new THREE.BoxGeometry(W * 0.56, 0.08, 0.03).translate(s * W * 0.46, tailY, L - 0.07))), glow(0xff2020, 1.9));
  g.add(head, tail);

  const wheels = [[-track, axle], [track, axle], [-track, -axle], [track, -axle]].map(([x, z]) => {
    const w = wheel(wheelR, wheelW, high);
    w.position.set(x, wheelR, z);
    g.add(w);
    return w;
  });
  return { group: g, wheels, steer: wheels.slice(2), head, tail, seat: new THREE.Vector3(-0.38, seatY, 0.05), radius: 2, chase, chaseHeight };
}

function car(color, high) {
  return assembleCar(color, high, {});
}

function supercar(color, high) {
  const out = assembleCar(color, high, {
    L: 2.32, W: 1, hood: 0.66, deck: 0.8, floor: 0.2, roof: 1.12, cabinFront: -0.6, cabinBack: 0.95, tail: 0.92,
  }, { wheelR: 0.36, wheelW: 0.33, axle: 1.38, track: 0.92, seatY: 0.42, chase: 7, chaseHeight: 2.1 });
  const wing = merge([
    new THREE.BoxGeometry(1.86, 0.035, 0.36).translate(0, 1.06, 2.08),
    new THREE.BoxGeometry(0.05, 0.3, 0.2).translate(-0.7, 0.92, 2.08),
    new THREE.BoxGeometry(0.05, 0.3, 0.2).translate(0.7, 0.92, 2.08),
    new THREE.BoxGeometry(2, 0.03, 0.34).translate(0, 0.2, -2.34),
  ]);
  out.group.add(shadowed(new THREE.Mesh(wing, darkMat())));
  return out;
}

function police(color, high) {
  const out = assembleCar(color, high, {});
  // Black and white panels, and the light bar.
  const panel = loft([
    { z: -0.95, w: 0.952, top: 0.8, bot: 0.3, e: 0.3 },
    { z: 0.9, w: 0.952, top: 0.82, bot: 0.3, e: 0.3 },
  ], { sides: 28, smooth: 2 });
  out.group.add(new THREE.Mesh(panel, new THREE.MeshLambertMaterial({ color: 0xf4f4f4 })));
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.3).translate(0, 1.47, 0.15), darkMat());
  const red = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.14, 0.26).translate(-0.31, 1.56, 0.15), glow(0xff1a1a, 3));
  const blue = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.14, 0.26).translate(0.31, 1.56, 0.15), glow(0x2a6bff, 3));
  out.group.add(base, red, blue);
  out.flashers = [red, blue];
  return out;
}

function bike(color, high) {
  const g = new THREE.Group();
  const tank = loft([
    { z: -0.74, w: 0.07, top: 1, bot: 0.74, e: 0.6 },
    { z: -0.5, w: 0.16, top: 1.06, bot: 0.62, e: 0.55 },
    { z: -0.12, w: 0.17, top: 1.06, bot: 0.6, e: 0.55 },
    { z: 0.2, w: 0.11, top: 0.92, bot: 0.66, e: 0.6 },
    { z: 0.42, w: 0.1, top: 0.96, bot: 0.8, e: 0.6 },
    { z: 0.96, w: 0.03, top: 1.12, bot: 1.02, e: 0.7 },
  ], { sides: 18, smooth: 3 });
  const fairing = loft([
    { z: -1.02, w: 0.06, top: 0.84, bot: 0.66, e: 0.6 },
    { z: -0.86, w: 0.16, top: 1.04, bot: 0.56, e: 0.55 },
    { z: -0.54, w: 0.2, top: 1.12, bot: 0.44, e: 0.5 },
    { z: -0.18, w: 0.17, top: 0.74, bot: 0.34, e: 0.55 },
    { z: 0.14, w: 0.05, top: 0.56, bot: 0.34, e: 0.7 },
  ], { sides: 18, smooth: 3 });
  g.add(shadowed(new THREE.Mesh(merge([tank, fairing]), paintMat(color, high))));
  const seat = loft([
    { z: -0.02, w: 0.13, top: 0.98, bot: 0.86, e: 0.5 },
    { z: 0.42, w: 0.12, top: 1.02, bot: 0.92, e: 0.5 },
    { z: 0.74, w: 0.06, top: 1.1, bot: 1.02, e: 0.6 },
  ], { sides: 14, smooth: 2 });
  g.add(new THREE.Mesh(seat, new THREE.MeshLambertMaterial({ color: 0x17171b })));
  const metal = merge([
    new THREE.CylinderGeometry(0.026, 0.026, 0.82, 8).rotateX(0.42).translate(0.06, 0.72, -0.88),
    new THREE.CylinderGeometry(0.026, 0.026, 0.82, 8).rotateX(0.42).translate(-0.06, 0.72, -0.88),
    new THREE.CylinderGeometry(0.016, 0.016, 0.62, 6).rotateZ(Math.PI / 2).translate(0, 1.13, -0.62),
    new THREE.CylinderGeometry(0.055, 0.075, 0.82, 12).rotateX(Math.PI / 2 - 0.1).translate(0.15, 0.45, 0.5),
    new THREE.BoxGeometry(0.1, 0.34, 0.9).rotateX(0.16).translate(0, 0.34, 0.2),
  ]);
  g.add(shadowed(new THREE.Mesh(metal, chromeMat(high))));
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.2, 0.02).rotateX(0.5).translate(0, 1.16, -0.82), glassMat(high)));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.075, 10, 8).scale(1.2, 1, 0.6).translate(0, 0.88, -1), glow(0xfff2d9, 2.8));
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.05, 0.03).translate(0, 1.05, 0.98), glow(0xff2020, 2));
  g.add(head, tail);
  const front = wheel(0.33, 0.11, high);
  front.position.set(0, 0.33, -1.06);
  const back = wheel(0.34, 0.15, high);
  back.position.set(0, 0.34, 0.76);
  g.add(front, back);
  return { group: g, wheels: [front, back], steer: [front], head, tail, seat: new THREE.Vector3(0, 0.85, 0.1), radius: 1, chase: 5.6, chaseHeight: 2 };
}

function airfoil(span, rootChord, tipChord, sweep, thickness, y, z, dihedral = 0) {
  const stations = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const chord = rootChord + (tipChord - rootChord) * t;
    stations.push({ z: t * span, w: chord / 2, top: thickness * (1 - t * 0.6), bot: -thickness * 0.4 * (1 - t * 0.6), e: 0.72, cx: sweep * t });
  }
  const make = (side) => {
    const g = loft(stations, { sides: 14, smooth: 1 });
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const along = pos.getZ(i);
      pos.setXYZ(i, side * along, y + pos.getY(i) + (along / span) * dihedral, z + pos.getX(i) + (along / span) * sweep);
    }
    if (side < 0) {
      const index = g.index.array;
      for (let i = 0; i < index.length; i += 3) {
        const tmp = index[i];
        index[i] = index[i + 1];
        index[i + 1] = tmp;
      }
    }
    g.computeVertexNormals();
    return g;
  };
  return [make(1), make(-1)];
}

function plane(color, jet, high) {
  const g = new THREE.Group();
  const fuselage = jet
    ? loft([
      { z: -4, w: 0.02, top: 0.02, bot: -0.02 },
      { z: -3.2, w: 0.3, top: 0.3, bot: -0.28 },
      { z: -1.7, w: 0.52, top: 0.56, bot: -0.5 },
      { z: 0.6, w: 0.6, top: 0.58, bot: -0.52 },
      { z: 2.8, w: 0.5, top: 0.46, bot: -0.42 },
      { z: 3.7, w: 0.38, top: 0.36, bot: -0.34 },
    ], { sides: 22, smooth: 4 })
    : loft([
      { z: -3, w: 0.2, top: 0.16, bot: -0.2 },
      { z: -2.6, w: 0.48, top: 0.36, bot: -0.4 },
      { z: -1, w: 0.56, top: 0.56, bot: -0.46 },
      { z: 0.3, w: 0.54, top: 0.58, bot: -0.44 },
      { z: 2, w: 0.26, top: 0.28, bot: -0.14 },
      { z: 3.6, w: 0.08, top: 0.14, bot: 0.02 },
    ], { sides: 22, smooth: 4 });
  const wings = jet ? airfoil(4.8, 2.9, 0.7, 2.1, 0.13, -0.08, 0.1, 0.1) : airfoil(5.5, 1.5, 0.9, 0.25, 0.17, 0.42, -0.5, 0.2);
  const stabs = jet ? airfoil(2.2, 1.4, 0.5, 1, 0.07, 0.14, 2.7) : airfoil(1.9, 0.92, 0.5, 0.22, 0.07, 0.16, 3);
  const finGeo = (jet ? loft([
    { z: 0, w: 0.75, top: 0.04, bot: -0.04, e: 0.7 },
    { z: 2, w: 0.3, top: 0.03, bot: -0.03, e: 0.7 },
  ], { sides: 10, smooth: 2 }) : loft([
    { z: 0, w: 0.56, top: 0.04, bot: -0.04, e: 0.7 },
    { z: 1.3, w: 0.26, top: 0.03, bot: -0.03, e: 0.7 },
  ], { sides: 10, smooth: 2 }));
  const finPos = finGeo.attributes.position;
  for (let i = 0; i < finPos.count; i++) {
    const h = finPos.getZ(i);
    finPos.setXYZ(i, finPos.getY(i), h + (jet ? 0.45 : 0.2), finPos.getX(i) + (jet ? 3 : 3.1) + h * 0.45);
  }
  finGeo.computeVertexNormals();
  g.add(shadowed(new THREE.Mesh(merge([fuselage, ...wings, ...stabs, finGeo]), paintMat(color, high))));
  const canopy = loft(jet
    ? [{ z: -2.3, w: 0.05, top: 0.42, bot: 0.3 }, { z: -1.6, w: 0.34, top: 0.92, bot: 0.34 }, { z: -0.8, w: 0.3, top: 0.9, bot: 0.4 }, { z: -0.1, w: 0.1, top: 0.6, bot: 0.46 }]
    : [{ z: -1.3, w: 0.08, top: 0.5, bot: 0.34 }, { z: -0.8, w: 0.4, top: 0.92, bot: 0.34 }, { z: 0.2, w: 0.38, top: 0.94, bot: 0.4 }, { z: 0.9, w: 0.1, top: 0.56, bot: 0.42 }], { sides: 16, smooth: 3 });
  g.add(new THREE.Mesh(canopy, glassMat(high)));
  const gearParts = [];
  const wheels = [];
  for (const [x, z] of (jet ? [[-1, 0.6], [1, 0.6], [0, -2.5]] : [[-1.1, -0.2], [1.1, -0.2], [0, 3]])) {
    gearParts.push(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 6).translate(x, -0.6, z));
    const w = wheel(0.17, 0.1, high);
    w.position.set(x, -0.87, z);
    g.add(w);
    wheels.push(w);
  }
  g.add(new THREE.Mesh(merge(gearParts), darkMat()));
  const out = { group: g, wheels, steer: [], props: [], seat: new THREE.Vector3(0, jet ? 0.25 : 0.2, jet ? -1.3 : -0.3), radius: 3.4, chase: jet ? 14 : 12, chaseHeight: 3.6, gear: 1.04 };
  if (jet) {
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.34, 2.8, 14).rotateX(-Math.PI / 2).translate(0, 0, 5.1), glow(0xffa23a, 2.8));
    g.add(flame);
    out.flame = flame;
  } else {
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8).scale(1, 1, 1.5).translate(0, -0.02, -3.06), chromeMat(high)));
    const prop = new THREE.Group();
    prop.position.set(0, -0.02, -3.2);
    prop.add(new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.12, 0.03), darkMat()));
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1.16, 24), new THREE.MeshBasicMaterial({ color: 0x20242c, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false }));
    prop.add(disc);
    g.add(prop);
    out.props.push({ obj: prop, axis: 'z', speed: 32 });
  }
  return out;
}

function heli(color, high) {
  const g = new THREE.Group();
  const cabin = loft([
    { z: -2.1, w: 0.2, top: 1.7, bot: 1.2 },
    { z: -1.6, w: 0.86, top: 2.32, bot: 0.74 },
    { z: -0.4, w: 1.05, top: 2.6, bot: 0.66 },
    { z: 0.8, w: 0.82, top: 2.5, bot: 0.84 },
    { z: 1.6, w: 0.32, top: 2.14, bot: 1.42 },
    { z: 5.2, w: 0.1, top: 1.98, bot: 1.76 },
  ], { sides: 20, smooth: 4 });
  const fin = loft([{ z: 4.8, w: 0.3, top: 2.92, bot: 1.76, e: 0.8 }, { z: 5.4, w: 0.03, top: 3.1, bot: 1.9, e: 0.9 }], { sides: 8, smooth: 2 });
  g.add(shadowed(new THREE.Mesh(merge([cabin, fin]), paintMat(color, high))));
  const glass = loft([
    { z: -2.14, w: 0.15, top: 1.78, bot: 1.2 },
    { z: -1.62, w: 0.84, top: 2.3, bot: 0.8 },
    { z: -0.86, w: 0.98, top: 2.48, bot: 0.9 },
    { z: -0.5, w: 0.3, top: 2.3, bot: 1.1 },
  ], { sides: 18, smooth: 3 });
  g.add(new THREE.Mesh(glass, glassMat(high)));
  const skid = [-0.95, 0.95].flatMap((x) => [
    new THREE.CylinderGeometry(0.05, 0.05, 3.5, 8).rotateX(Math.PI / 2).translate(x, 0.08, -0.3),
    new THREE.CylinderGeometry(0.035, 0.035, 0.7, 6).rotateZ(x * 0.2).translate(x * 0.92, 0.42, 0.5),
    new THREE.CylinderGeometry(0.035, 0.035, 0.7, 6).rotateZ(x * 0.2).translate(x * 0.92, 0.42, -1.1),
  ]);
  skid.push(new THREE.CylinderGeometry(0.09, 0.14, 0.7, 8).translate(0, 2.92, -0.2));
  g.add(shadowed(new THREE.Mesh(merge(skid), darkMat())));
  const rotor = new THREE.Group();
  rotor.position.set(0, 3.32, -0.2);
  rotor.add(new THREE.Mesh(merge([new THREE.BoxGeometry(9.2, 0.04, 0.24), new THREE.BoxGeometry(0.24, 0.04, 9.2)]), darkMat()));
  rotor.add(new THREE.Mesh(new THREE.CircleGeometry(4.6, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x20242c, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false })));
  g.add(rotor);
  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.22, 2.3, 5.2);
  tailRotor.add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 1.4, 0.12), darkMat()));
  g.add(tailRotor);
  return {
    group: g, wheels: [], steer: [], props: [{ obj: rotor, axis: 'y', speed: 26 }, { obj: tailRotor, axis: 'x', speed: 40 }], seat: new THREE.Vector3(-0.32, 1.22, -0.8), radius: 3, chase: 12, chaseHeight: 4,
  };
}

function boat(color, high) {
  const g = new THREE.Group();
  const hull = loft([
    { z: -3.2, w: 0.03, top: 1.12, bot: 0.92, e: 0.8 },
    { z: -2.4, w: 0.66, top: 1, bot: 0.26, e: 0.7 },
    { z: -1, w: 1.14, top: 0.92, bot: -0.06, e: 0.7 },
    { z: 1, w: 1.26, top: 0.88, bot: -0.1, e: 0.62 },
    { z: 2.5, w: 1.2, top: 0.86, bot: -0.1, e: 0.55 },
  ], { sides: 22, smooth: 4 });
  g.add(shadowed(new THREE.Mesh(hull, paintMat(color, high))));
  const deck = new THREE.BoxGeometry(1.96, 0.05, 3.5).translate(0, 0.85, 0.72);
  g.add(new THREE.Mesh(deck, new THREE.MeshStandardMaterial({ color: 0xc69a68, roughness: 0.55 })));
  const shield = loft([{ z: -0.86, w: 0.92, top: 1.5, bot: 0.86, e: 0.6 }, { z: -0.5, w: 0.84, top: 1.56, bot: 0.86, e: 0.6 }], { sides: 18, smooth: 2 });
  g.add(new THREE.Mesh(shield, glassMat(high)));
  const motor = loft([{ z: 2.46, w: 0.26, top: 1.3, bot: 0.3, e: 0.5 }, { z: 2.92, w: 0.2, top: 1.24, bot: 0.4, e: 0.5 }], { sides: 12, smooth: 2 });
  g.add(shadowed(new THREE.Mesh(motor, darkMat())));
  return { group: g, wheels: [], steer: [], seat: new THREE.Vector3(0, 0.86, 0.1), radius: 2, chase: 8, chaseHeight: 3 };
}

export const MODELS = {
  car,
  supercar,
  police,
  bike,
  plane: (c, h) => plane(c, false, h),
  jet: (c, h) => plane(c, true, h),
  heli,
  boat,
};

/** Merged cars for traffic and parking, so hundreds stay cheap. The paint comes from the instance color. */
export function trafficCarGeometry(shape = {}) {
  const parts = carBody(shape);
  const W = shape.W ?? 0.94;
  const body = tinted(merge([parts.body, parts.roof]), 0xffffff);
  const cabin = tinted(parts.cabin, 0x10161e);
  const tyres = [[-0.86, 1.34], [0.86, 1.34], [-0.86, -1.34], [0.86, -1.34]].map(([x, z]) => tinted(new THREE.CylinderGeometry(0.36, 0.36, 0.25, shape.low ? 7 : 12).rotateZ(Math.PI / 2).translate(x, 0.36, z), 0x0d0d0f));
  const lamp = (s, z, y, hex) => tinted(new THREE.BoxGeometry(W * 0.5, 0.08, 0.03).translate(s * W * 0.46, y, z), hex);
  return mergeGeometries([body, cabin, ...tyres, lamp(-1, 2.22, 0.8, 0x801010), lamp(1, 2.22, 0.8, 0x801010), lamp(-1, -2.27, 0.62, 0xe8e0c4), lamp(1, -2.27, 0.62, 0xe8e0c4)]);
}
