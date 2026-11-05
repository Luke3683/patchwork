import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CITY_HEIGHT } from './terrain.js';

const MAX = 150;
const SHIRTS = [0xe4572e, 0x2e86ab, 0xf2d24b, 0x7d4ea8, 0x76b041, 0xf2ece0, 0xff8fb0, 0x3d3a4b, 0x35c5c9, 0xe8e8e8];
const PANTS = [0x2b2f3c, 0x3f5a7a, 0x6b5a48, 0x1d1e24, 0xc9b896, 0x45503d];
const SKIN = [0xf1c9a5, 0xe0ac7e, 0xc58c5f, 0x8d5a3a, 0x5f3b26, 0xf6d7bb];
const HALF_BLOCK = 37;

const colored = (geo, hex) => {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const col = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < col.length; i += 3) {
    col[i] = c.r;
    col[i + 1] = c.g;
    col[i + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
};

function makeParts() {
  const torsoProfile = [[0.001, 0], [0.17, 0], [0.19, 0.08], [0.17, 0.3], [0.22, 0.52], [0.2, 0.6], [0.08, 0.66], [0.001, 0.67]].map(([x, y]) => new THREE.Vector2(x, y));
  const torso = new THREE.LatheGeometry(torsoProfile, 14).scale(1, 1, 0.62);
  torso.translate(0, 0.86, 0);
  const pelvis = new THREE.SphereGeometry(0.17, 10, 8).scale(1.02, 0.72, 0.72).translate(0, 0.86, 0);
  const head = mergeGeometries([
    colored(new THREE.SphereGeometry(0.115, 14, 12).scale(0.92, 1.12, 1).translate(0, 0.1, 0), 0xffffff),
    colored(new THREE.CylinderGeometry(0.05, 0.06, 0.12, 8).translate(0, -0.05, 0), 0xffffff),
    colored(new THREE.SphereGeometry(0.122, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(0.94, 1.04, 1.02).translate(0, 0.115, 0.012), 0x2a1c14),
    colored(new THREE.SphereGeometry(0.012, 6, 4).translate(-0.04, 0.115, -0.1), 0x111111),
    colored(new THREE.SphereGeometry(0.012, 6, 4).translate(0.04, 0.115, -0.1), 0x111111),
  ]);
  const leg = (s) => mergeGeometries([
    colored(new THREE.CapsuleGeometry(0.075, 0.74, 4, 10).translate(s * 0.095, -0.42, 0), 0xffffff),
    colored(new THREE.SphereGeometry(0.075, 10, 8).scale(1, 0.62, 1.8).translate(s * 0.095, -0.82, -0.05), 0x18181c),
  ]);
  const arm = (s) => colored(new THREE.CapsuleGeometry(0.048, 0.56, 4, 8).translate(s * 0.25, -0.3, 0), 0xffffff);
  return {
    torso: colored(mergeGeometries([colored(torso, 0xffffff), colored(pelvis, 0xffffff)].map((g) => { g.deleteAttribute('color'); return g; })), 0xffffff),
    head,
    legL: leg(-1),
    legR: leg(1),
    armL: arm(-1),
    armR: arm(1),
  };
}

/** Everyone on the street: civilians, gang members and cops, drawn with six meshes. */
export class People {
  constructor(world) {
    this.world = world;
    this.k = world.k;
    this.list = [];
    const material = new THREE.MeshLambertMaterial({ vertexColors: true });
    const parts = makeParts();
    this.meshes = {};
    for (const [name, geo] of Object.entries(parts)) {
      const m = new THREE.InstancedMesh(geo, material, MAX);
      m.frustumCulled = false;
      m.castShadow = true;
      m.count = 0;
      m.setColorAt(0, new THREE.Color(0xffffff));
      this.k.root.add(m);
      this.meshes[name] = m;
    }
    this.rand = Math.random;
    this.base = new THREE.Matrix4();
    this.local = new THREE.Matrix4();
    this.out = new THREE.Matrix4();
    this.obj = new THREE.Object3D();
    this.color = new THREE.Color();
    this.v = new THREE.Vector3();
  }

  add(role, x, z, opts = {}) {
    if (this.list.length >= MAX) return null;
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const p = {
      role, x, z, y: this.world.groundAt(x, z, 1e5), yaw: Math.random() * 6.28, speed: 0, state: 'walk', hp: 100, timer: 0, phase: Math.random() * 6,
      shirt: pick(SHIRTS), pants: pick(PANTS), skin: pick(SKIN), blink: 0, punch: 0, cool: 0, ...opts,
    };
    this.list.push(p);
    this.syncColors();
    return p;
  }

  /** People who walk the block around their home sidewalk. */
  addWalker(cx, cz) {
    return this.add('civilian', cx, cz, { cx, cz, t: Math.random() * 4, y: CITY_HEIGHT + 0.26, rate: 0.012 + Math.random() * 0.012 });
  }

  remove(p) {
    this.list.splice(this.list.indexOf(p), 1);
    this.syncColors();
  }

  syncColors() {
    const { meshes, color, list } = this;
    list.forEach((p, i) => {
      meshes.torso.setColorAt(i, color.set(p.shirt));
      meshes.head.setColorAt(i, color.set(p.skin));
      meshes.armL.setColorAt(i, color.set(p.skin));
      meshes.armR.setColorAt(i, color.set(p.skin));
      meshes.legL.setColorAt(i, color.set(p.pants));
      meshes.legR.setColorAt(i, color.set(p.pants));
    });
    for (const m of Object.values(meshes)) {
      m.count = list.length;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  /** The closest person in reach, in front of the attacker. */
  inReach(x, z, yaw, range = 2.1) {
    let best = null;
    let bestD = range;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    for (const p of this.list) {
      if (p.state === 'down') continue;
      const dx = p.x - x;
      const dz = p.z - z;
      const d = Math.hypot(dx, dz);
      if (d < bestD && (d < 0.8 || (dx * fx + dz * fz) / d > 0.3)) {
        best = p;
        bestD = d;
      }
    }
    return best;
  }

  /** Knocks someone back, and floors them when they've taken enough. */
  hit(p, damage, fromX, fromZ) {
    const d = Math.hypot(p.x - fromX, p.z - fromZ) || 1;
    p.x += ((p.x - fromX) / d) * 0.55;
    p.z += ((p.z - fromZ) / d) * 0.55;
    p.hp -= damage;
    p.blink = 0.18;
    if (p.hp <= 0) {
      p.state = 'down';
      p.timer = p.role === 'thug' ? 90 : 7;
      p.yaw = Math.atan2(p.x - fromX, p.z - fromZ);
      return true;
    }
    return false;
  }

  move(p, wantX, wantZ, speed, dt) {
    const len = Math.hypot(wantX, wantZ) || 1;
    const nx = p.x + (wantX / len) * speed * dt;
    const nz = p.z + (wantZ / len) * speed * dt;
    const pos = this.v.set(nx, 0, nz);
    this.world.solids.push(pos, 0.34, p.y);
    p.x = pos.x;
    p.z = pos.z;
    p.yaw = Math.atan2(-wantX, -wantZ);
    p.speed = speed;
    p.y = this.world.groundAt(p.x, p.z, p.y + 1);
  }

  update(dt, focus) {
    const { base, local, out, obj, meshes } = this;
    let dirty = false;
    this.list.forEach((p, i) => {
      const distance = Math.hypot(p.x - focus.x, p.z - focus.z);
      p.blink = Math.max(0, p.blink - dt);
      p.punch = Math.max(0, p.punch - dt);
      p.cool = Math.max(0, p.cool - dt);

      if (p.state === 'down') {
        p.timer -= dt;
        p.speed = 0;
        if (p.timer <= 0) {
          p.hp = 100;
          p.state = p.role === 'civilian' ? 'flee' : 'walk';
          p.timer = 8;
          if (p.onRise) p.onRise(p);
        }
      } else if (p.state === 'flee') {
        p.timer -= dt;
        const dx = p.x - focus.x;
        const dz = p.z - focus.z;
        this.move(p, dx + Math.sin(p.phase) * 8, dz + Math.cos(p.phase) * 8, 5.2, dt);
        if (p.timer <= 0) {
          p.state = 'walk';
          // Back to their own block, wherever they ran to.
          if (p.cx !== undefined) {
            const b = 92;
            p.cx = Math.round(p.x / b) * b;
            p.cz = Math.round(p.z / b) * b;
          }
        }
      } else if (p.role === 'civilian' && p.cx !== undefined) {
        p.t = (p.t + p.rate * dt * 4) % 4;
        const edge = Math.floor(p.t);
        const f = p.t - edge;
        const corners = [[-HALF_BLOCK, -HALF_BLOCK], [HALF_BLOCK, -HALF_BLOCK], [HALF_BLOCK, HALF_BLOCK], [-HALF_BLOCK, HALF_BLOCK]];
        const a = corners[edge];
        const b = corners[(edge + 1) % 4];
        p.x = p.cx + a[0] + (b[0] - a[0]) * f;
        p.z = p.cz + a[1] + (b[1] - a[1]) * f;
        p.y = CITY_HEIGHT + 0.26;
        p.yaw = Math.atan2(-(b[0] - a[0]), -(b[1] - a[1]));
        p.speed = 1.5;
        if (distance < 4 && this.world.player.vehicle?.speed > 6) {
          p.state = 'flee';
          p.timer = 4;
        }
      }
      // Gang members and cops are moved by the crime system, which knows who they're after.

      if (distance > 180) {
        obj.position.set(0, -1000, 0);
        obj.scale.setScalar(0.001);
        obj.updateMatrix();
        for (const m of Object.values(meshes)) m.setMatrixAt(i, obj.matrix);
        obj.scale.setScalar(1);
        dirty = true;
        return;
      }

      p.phase += dt * Math.max(0.1, p.speed) * 2.6;
      const swing = Math.sin(p.phase) * Math.min(1, p.speed / 2.2) * 0.7;
      if (p.state === 'down') {
        obj.position.set(p.x, p.y + 0.16, p.z);
        obj.rotation.set(-Math.PI / 2, 0, 0, 'XYZ');
        obj.rotation.set(0, p.yaw, 0);
        obj.rotateX(-Math.PI / 2);
      } else {
        obj.position.set(p.x, p.y + Math.abs(Math.sin(p.phase)) * 0.03 * Math.min(1, p.speed), p.z);
        obj.rotation.set(0, p.yaw, 0);
        if (p.blink > 0) obj.rotateX(0.3);
      }
      obj.scale.setScalar(1);
      obj.updateMatrix();
      base.copy(obj.matrix);

      const set = (mesh, x, y, z, rx) => {
        obj.position.set(x, y, z);
        obj.rotation.set(rx, 0, 0);
        obj.updateMatrix();
        local.copy(obj.matrix);
        out.multiplyMatrices(base, local);
        mesh.setMatrixAt(i, out);
      };
      set(meshes.torso, 0, 0, 0, 0);
      set(meshes.head, 0, 1.53, 0, 0);
      set(meshes.legL, 0, 0.86, 0, swing);
      set(meshes.legR, 0, 0.86, 0, -swing);
      set(meshes.armL, 0, 1.46, 0, -swing * 0.8);
      set(meshes.armR, 0, 1.46, 0, p.punch > 0 ? -1.5 : swing * 0.8);
      dirty = true;
    });
    if (dirty) for (const m of Object.values(meshes)) m.instanceMatrix.needsUpdate = true;
  }
}
