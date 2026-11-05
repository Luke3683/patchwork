import * as THREE from 'three';
import { Panel, DISPLAY } from './ui.js';
import { disposeTree } from './kit.js';

const YAW = new THREE.Euler(0, 0, 0, 'YXZ');
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v3 = new THREE.Vector3();
const v4 = new THREE.Vector3();
const v5 = new THREE.Vector3();
const YUP = new THREE.Vector3(0, 1, 0);

const part = (geometry, material, x = 0, y = 0, z = 0) => {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(x, y, z);
  return mesh;
};

/** Head parts. -Z is the way the player is looking. */
const HEADS = {
  person: (m) => {
    const g = new THREE.Group();
    g.add(part(new THREE.SphereGeometry(0.115, 18, 14).scale(0.92, 1.14, 1), m.skin, 0, 0, 0));
    g.add(part(new THREE.SphereGeometry(0.122, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(0.95, 1.05, 1.03), m.hair, 0, 0.018, 0.012));
    g.add(part(new THREE.SphereGeometry(0.018, 8, 6).scale(1, 1.3, 1.3), m.skin, 0, -0.015, -0.112));
    for (const s of [-1, 1]) {
      g.add(part(new THREE.SphereGeometry(0.013, 8, 6), m.dark, s * 0.042, 0.012, -0.101));
      g.add(part(new THREE.SphereGeometry(0.022, 8, 6).scale(0.5, 1, 0.8), m.skin, s * 0.107, 0, 0));
    }
    g.add(part(new THREE.CylinderGeometry(0.052, 0.062, 0.14, 12), m.skin, 0, -0.16, 0));
    return g;
  },
  orb: (m) => part(new THREE.IcosahedronGeometry(0.135, 1), m.primary),
  cube: (m) => part(new THREE.BoxGeometry(0.22, 0.22, 0.22), m.primary),
  gem: (m) => part(new THREE.OctahedronGeometry(0.18, 0), m.primary),
  capsule: (m) => part(new THREE.CapsuleGeometry(0.1, 0.1, 3, 10), m.primary),
  lantern: (m) => {
    const g = new THREE.Group();
    g.add(part(new THREE.CylinderGeometry(0.11, 0.11, 0.18, 8), m.glow));
    g.add(part(new THREE.CylinderGeometry(0.14, 0.14, 0.03, 8), m.secondary, 0, 0.1, 0));
    g.add(part(new THREE.CylinderGeometry(0.14, 0.14, 0.03, 8), m.secondary, 0, -0.1, 0));
    return g;
  },
};

const EYES = {
  none: () => new THREE.Group(),
  visor: (m) => part(new THREE.BoxGeometry(0.2, 0.055, 0.03), m.glow, 0, 0.015, -0.12),
  dots: (m) => {
    const g = new THREE.Group();
    const geo = new THREE.SphereGeometry(0.024, 8, 6);
    g.add(part(geo, m.glow, -0.05, 0.02, -0.125), part(geo, m.glow, 0.05, 0.02, -0.125));
    return g;
  },
  cyclops: (m) => part(new THREE.SphereGeometry(0.05, 12, 8), m.glow, 0, 0.02, -0.11),
  shades: (m) => {
    const g = new THREE.Group();
    const geo = new THREE.BoxGeometry(0.085, 0.05, 0.02);
    g.add(part(geo, m.dark, -0.052, 0.02, -0.125), part(geo, m.dark, 0.052, 0.02, -0.125));
    g.add(part(new THREE.BoxGeometry(0.2, 0.012, 0.012), m.dark, 0, 0.035, -0.125));
    return g;
  },
};

const HATS = {
  none: () => new THREE.Group(),
  cap: (m) => {
    const g = new THREE.Group();
    g.add(part(new THREE.SphereGeometry(0.125, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), m.secondary, 0, 0.07, 0));
    g.add(part(new THREE.BoxGeometry(0.15, 0.015, 0.12), m.secondary, 0, 0.075, -0.15));
    return g;
  },
  beanie: (m) => {
    const g = new THREE.Group();
    g.add(part(new THREE.SphereGeometry(0.128, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), m.secondary, 0, 0.06, 0));
    g.add(part(new THREE.SphereGeometry(0.035, 8, 6), m.accent, 0, 0.2, 0));
    return g;
  },
  antenna: (m) => {
    const g = new THREE.Group();
    g.add(part(new THREE.CylinderGeometry(0.006, 0.006, 0.18, 5), m.dark, 0, 0.21, 0));
    g.add(part(new THREE.SphereGeometry(0.028, 8, 6), m.glow, 0, 0.31, 0));
    return g;
  },
  mohawk: (m) => {
    const g = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const fin = part(new THREE.ConeGeometry(0.03, 0.12, 4), m.accent, 0, 0.17 - Math.abs(i - 2) * 0.012, -0.08 + i * 0.04);
      g.add(fin);
    }
    return g;
  },
  horns: (m) => {
    const g = new THREE.Group();
    for (const s of [-1, 1]) {
      const horn = part(new THREE.ConeGeometry(0.03, 0.16, 6), m.secondary, s * 0.1, 0.16, 0);
      horn.rotation.z = -s * 0.5;
      g.add(horn);
    }
    return g;
  },
  tophat: (m) => {
    const g = new THREE.Group();
    g.add(part(new THREE.CylinderGeometry(0.17, 0.17, 0.015, 12), m.dark, 0, 0.12, 0));
    g.add(part(new THREE.CylinderGeometry(0.105, 0.105, 0.18, 12), m.dark, 0, 0.21, 0));
    g.add(part(new THREE.CylinderGeometry(0.107, 0.107, 0.03, 12), m.accent, 0, 0.14, 0));
    return g;
  },
  wizard: (m) => {
    const g = new THREE.Group();
    g.add(part(new THREE.CylinderGeometry(0.19, 0.19, 0.015, 12), m.secondary, 0, 0.1, 0));
    const cone = part(new THREE.ConeGeometry(0.12, 0.36, 10), m.secondary, 0, 0.28, 0);
    cone.rotation.z = 0.12;
    g.add(cone);
    g.add(part(new THREE.OctahedronGeometry(0.025, 0), m.glow, 0.02, 0.26, -0.095));
    return g;
  },
  halo: (m) => {
    const halo = part(new THREE.TorusGeometry(0.12, 0.012, 6, 20), m.glow, 0, 0.24, 0);
    halo.rotation.x = Math.PI / 2;
    return halo;
  },
  crown: (m) => {
    const g = new THREE.Group();
    g.add(part(new THREE.CylinderGeometry(0.1, 0.1, 0.05, 10), m.accentSolid, 0, 0.14, 0));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      g.add(part(new THREE.ConeGeometry(0.022, 0.07, 4), m.accentSolid, Math.cos(a) * 0.092, 0.195, Math.sin(a) * 0.092));
    }
    return g;
  },
};

/** Torsos hang below the head, centered on y = 0. */
const BODIES = {
  human: (m) => {
    const profile = [[0.001, -0.37], [0.165, -0.37], [0.185, -0.28], [0.16, -0.06], [0.215, 0.17], [0.2, 0.24], [0.09, 0.31], [0.001, 0.32]]
      .map(([x, y]) => new THREE.Vector2(x, y));
    return part(new THREE.LatheGeometry(profile, 18).scale(1, 1, 0.62), m.primarySmooth);
  },
  tunic: (m) => part(new THREE.CylinderGeometry(0.1, 0.24, 0.72, 8), m.primary),
  robot: (m) => {
    const g = new THREE.Group();
    g.add(part(new THREE.BoxGeometry(0.34, 0.4, 0.2), m.primary, 0, 0.14, 0));
    g.add(part(new THREE.BoxGeometry(0.2, 0.2, 0.14), m.secondary, 0, -0.18, 0));
    g.add(part(new THREE.BoxGeometry(0.08, 0.08, 0.02), m.glow, 0, 0.2, -0.105));
    return g;
  },
  slim: (m) => part(new THREE.CapsuleGeometry(0.09, 0.5, 3, 8), m.primary),
  barrel: (m) => {
    const g = new THREE.Group();
    g.add(part(new THREE.CylinderGeometry(0.2, 0.2, 0.6, 10), m.primary));
    for (const y of [-0.18, 0.18]) g.add(part(new THREE.CylinderGeometry(0.205, 0.205, 0.04, 10), m.secondary, 0, y, 0));
    return g;
  },
  ghost: (m) => part(new THREE.ConeGeometry(0.28, 0.85, 9), m.ghost),
};

/** Back items. +Z is behind the player. */
const BACKS = {
  none: () => new THREE.Group(),
  cape: (m) => {
    const cape = part(new THREE.BoxGeometry(0.36, 0.72, 0.015), m.secondary, 0, -0.04, 0.17);
    cape.rotation.x = 0.14;
    return cape;
  },
  pack: (m) => part(new THREE.BoxGeometry(0.24, 0.3, 0.14), m.secondary, 0, 0.1, 0.19),
  jetpack: (m) => {
    const g = new THREE.Group();
    for (const s of [-1, 1]) {
      g.add(part(new THREE.CylinderGeometry(0.055, 0.055, 0.34, 8), m.secondary, s * 0.08, 0.12, 0.17));
      const flame = part(new THREE.ConeGeometry(0.045, 0.16, 7), m.glow, s * 0.08, -0.13, 0.17);
      flame.rotation.x = Math.PI;
      g.add(flame);
    }
    return g;
  },
  wings: (m) => {
    const g = new THREE.Group();
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(0.62, 0.34);
    shape.lineTo(0.5, 0.05);
    shape.lineTo(0.42, -0.12);
    shape.lineTo(0.2, -0.2);
    shape.closePath();
    const geo = new THREE.ShapeGeometry(shape);
    for (const s of [-1, 1]) {
      const wing = part(geo, m.wing, s * 0.05, 0.14, 0.16);
      wing.scale.x = s;
      wing.rotation.y = s * 0.45;
      g.add(wing);
    }
    return g;
  },
};

const HANDS = {
  hand: (m) => {
    const g = new THREE.Group();
    g.add(part(new THREE.SphereGeometry(0.046, 10, 8).scale(0.86, 0.72, 1.3), m.skin));
    g.add(part(new THREE.CapsuleGeometry(0.014, 0.04, 3, 6).rotateX(Math.PI / 2 - 0.5), m.skin, 0.04, 0, -0.03));
    return g;
  },
  mitts: (m) => part(new THREE.IcosahedronGeometry(0.05, 0), m.secondary),
  orbs: (m) => part(new THREE.SphereGeometry(0.045, 10, 8), m.glow),
  cubes: (m) => part(new THREE.BoxGeometry(0.075, 0.075, 0.075), m.secondary),
  claws: (m) => {
    const g = new THREE.Group();
    g.add(part(new THREE.IcosahedronGeometry(0.04, 0), m.primary));
    for (const x of [-0.03, 0, 0.03]) {
      const claw = part(new THREE.ConeGeometry(0.012, 0.07, 4), m.accentSolid, x, 0, -0.06);
      claw.rotation.x = -Math.PI / 2;
      g.add(claw);
    }
    return g;
  },
};

function makeAura(kind, look) {
  if (kind === 'rings') {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: look.accent, transparent: true, opacity: 0.65 });
    for (let i = 0; i < 2; i++) {
      const ring = part(new THREE.TorusGeometry(0.42 + i * 0.1, 0.008, 5, 28), mat, 0, -0.15 + i * 0.3, 0);
      ring.rotation.x = Math.PI / 2 + (i ? 0.3 : -0.3);
      g.add(ring);
    }
    g.userData.spin = 1.2;
    return g;
  }
  const count = 26;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 * 3;
    const r = 0.28 + (i % 5) * 0.05;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = -0.5 + (i / count) * 1.1;
    pos[i * 3 + 2] = Math.sin(a) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    color: kind === 'embers' ? 0xff7a2e : look.accent, size: 0.03, transparent: true, opacity: 0.9, depthWrite: false,
  }));
  points.userData.spin = kind === 'embers' ? 0.7 : 1.5;
  return points;
}

function pick(table, id, fallbackId) {
  return (table[id] ?? table[fallbackId]);
}

/** One person's body: head, torso, hands and name tag, built from a look. */
export class Avatar {
  constructor(look, name = '') {
    this.group = new THREE.Group();
    this.head = new THREE.Group();
    this.torso = new THREE.Group();
    this.left = new THREE.Group();
    this.right = new THREE.Group();
    this.group.add(this.head, this.torso, this.left, this.right);
    this.tag = null;
    this.aura = null;
    this.target = {
      head: new THREE.Vector3(0, 1.55, 0),
      headQ: new THREE.Quaternion(),
      left: new THREE.Vector3(-0.3, 1.05, -0.15),
      leftQ: new THREE.Quaternion(),
      right: new THREE.Vector3(0.3, 1.05, -0.15),
      rightQ: new THREE.Quaternion(),
      showLeft: true,
      showRight: true,
    };
    this.setLook(look);
    this.setName(name);
    this.snap();
  }

  setLook(look) {
    for (const arm of this.arms ?? []) {
      this.group.remove(arm.upper, arm.lower);
      arm.upper.geometry.dispose();
      arm.lower.geometry.dispose();
    }
    for (const part0 of [this.head, this.torso, this.left, this.right]) {
      disposeTree(part0);
      part0.clear();
    }
    const flat = (color) => new THREE.MeshLambertMaterial({ color, flatShading: true });
    const m = {
      primary: flat(look.primary),
      primarySmooth: new THREE.MeshLambertMaterial({ color: look.primary }),
      skin: new THREE.MeshLambertMaterial({ color: look.skin ?? 0xd9a57c }),
      hair: new THREE.MeshLambertMaterial({ color: look.hair ?? 0x2a1c14 }),
      pants: new THREE.MeshLambertMaterial({ color: look.secondary }),
      secondary: flat(look.secondary),
      accentSolid: flat(look.accent),
      accent: new THREE.MeshBasicMaterial({ color: look.accent }),
      glow: new THREE.MeshBasicMaterial({ color: look.accent }),
      dark: flat(0x1a1824),
      ghost: new THREE.MeshLambertMaterial({ color: look.primary, transparent: true, opacity: 0.55, depthWrite: false }),
      wing: new THREE.MeshLambertMaterial({ color: look.secondary, side: THREE.DoubleSide, transparent: true, opacity: 0.88 }),
    };
    const headInner = new THREE.Group();
    headInner.add(
      pick(HEADS, look.head, 'orb')(m),
      pick(EYES, look.eyes, 'visor')(m),
      pick(HATS, look.hat, 'none')(m),
    );
    headInner.scale.setScalar(look.headSize);
    this.head.add(headInner);

    const torsoInner = new THREE.Group();
    torsoInner.add(pick(BODIES, look.body, 'tunic')(m), pick(BACKS, look.back, 'none')(m));
    torsoInner.scale.setScalar(look.bodySize);
    this.torso.add(torsoInner);

    this.human = look.body === 'human';
    this.arms = null;
    if (this.human) {
      // Hips and knees bend, and elbows follow wherever the hands are.
      const thigh = new THREE.CapsuleGeometry(0.078, 0.34, 4, 10).translate(0, -0.21, 0);
      const shin = new THREE.CapsuleGeometry(0.058, 0.32, 4, 10).translate(0, -0.2, 0);
      const shoe = new THREE.SphereGeometry(0.07, 10, 8).scale(0.92, 0.62, 1.85);
      this.legs = [-1, 1].map((s) => {
        const hip = part(thigh, m.pants, s * 0.095, -0.36, 0);
        const knee = part(shin, m.pants, 0, -0.42, 0);
        knee.add(part(shoe, m.dark, 0, -0.39, -0.05));
        hip.add(knee);
        this.torso.add(hip);
        return { hip, knee };
      });
      const unit = new THREE.CapsuleGeometry(0.05, 1, 4, 8);
      const sleeve = new THREE.CapsuleGeometry(0.056, 1, 4, 8);
      this.arms = [-1, 1].map((s) => {
        const upper = new THREE.Mesh(sleeve, m.primarySmooth);
        const lower = new THREE.Mesh(unit, m.skin);
        this.torso.parent.add(upper, lower);
        return { s, upper, lower };
      });
    } else {
      const legGeo = new THREE.CapsuleGeometry(0.075, 0.46, 3, 8).translate(0, -0.3, 0);
      this.legs = [-1, 1].map((s) => {
        const leg = part(legGeo, m.secondary, s * 0.11, -0.34, 0);
        this.torso.add(leg);
        return leg;
      });
    }

    this.aura = null;
    if (look.aura !== 'none') {
      this.aura = makeAura(look.aura, look);
      this.torso.add(this.aura);
    }
    const handFn = pick(HANDS, look.hands, 'mitts');
    this.left.add(handFn(m));
    this.right.add(handFn(m));
  }

  setName(name) {
    if (this.tag) {
      this.group.remove(this.tag);
      disposeTree(this.tag);
      this.tag = null;
    }
    if (!name) return;
    this.tag = new Panel({ width: 0.8, height: 0.15, ppm: 320, side: THREE.DoubleSide });
    this.tag.paint((g, W, H) => {
      g.fillStyle = 'rgba(7,22,31,0.86)';
      g.beginPath();
      g.roundRect(0, 0, W, H, 14);
      g.fill();
      g.fillStyle = '#f4efe2';
      g.font = `${H * 0.46}px ${DISPLAY}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(name, W / 2, H / 2 + 1, W - 16);
    });
    this.group.add(this.tag);
  }

  /** Jump straight to the target pose, skipping the smoothing. */
  snap() {
    this.apply(1);
  }

  update(dt, viewer) {
    this.apply(1 - Math.exp(-14 * dt));
    this.walk(dt);
    if (this.aura) this.aura.rotation.y += dt * this.aura.userData.spin;
    if (this.tag && viewer) this.tag.lookAt(viewer);
  }

  /** Swings the legs based on how fast the body is actually moving. */
  walk(dt) {
    if (dt <= 0 || !this.legs) return;
    const p = this.head.position;
    const speed = Math.hypot(p.x - this.lastX, p.z - this.lastZ) / dt;
    this.lastX = p.x;
    this.lastZ = p.z;
    if (!Number.isFinite(speed)) return;
    this.stride = THREE.MathUtils.damp(this.stride ?? 0, Math.min(speed, 9), 10, dt);
    this.phase = (this.phase ?? 0) + this.stride * dt * 2.2;
    const swing = Math.min(1, this.stride / 3) * 0.75;
    if (this.human) {
      this.legs.forEach(({ hip, knee }, i) => {
        const side = i ? -1 : 1;
        if (this.seated) {
          hip.rotation.x = 1.35;
          knee.rotation.x = -1.3;
        } else {
          const s = Math.sin(this.phase) * side;
          hip.rotation.x = s * swing * 0.9;
          knee.rotation.x = -Math.max(0, -Math.cos(this.phase) * side) * swing * 1.25 - 0.04;
        }
      });
      return;
    }
    this.legs[0].rotation.x = Math.sin(this.phase) * swing;
    this.legs[1].rotation.x = -Math.sin(this.phase) * swing;
    for (const leg of this.legs) leg.visible = !this.seated;
  }

  /** Lays a limb between two joints. */
  bone(mesh, a, b, radiusBase) {
    v2.subVectors(b, a);
    const len = v2.length() || 0.001;
    mesh.position.copy(a).addScaledVector(v2, 0.5);
    mesh.quaternion.setFromUnitVectors(YUP, v2.divideScalar(len));
    mesh.scale.set(1, (len + radiusBase * 2) / (1 + radiusBase * 2), 1);
  }

  updateArms() {
    if (!this.arms) return;
    const yaw = this.torso.rotation.y;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    for (const { s, upper, lower } of this.arms) {
      const hand = s < 0 ? this.left : this.right;
      upper.visible = lower.visible = hand.visible;
      if (!hand.visible) continue;
      v3.set(this.torso.position.x + s * 0.235 * cos, this.torso.position.y + 0.21, this.torso.position.z - s * 0.235 * sin);
      v4.copy(hand.position);
      // The elbow sits partway along, pushed down and out.
      v5.lerpVectors(v3, v4, 0.5);
      v5.y -= 0.07;
      v5.x += s * 0.05 * cos;
      v5.z -= s * 0.05 * sin;
      this.bone(upper, v3, v5, 0.056);
      this.bone(lower, v5, v4, 0.05);
    }
  }

  apply(k) {
    const t = this.target;
    this.head.position.lerp(t.head, k);
    this.head.quaternion.slerp(t.headQ, k);
    this.left.position.lerp(t.left, k);
    this.left.quaternion.slerp(t.leftQ, k);
    this.right.position.lerp(t.right, k);
    this.right.quaternion.slerp(t.rightQ, k);
    this.left.visible = t.showLeft;
    this.right.visible = t.showRight;

    YAW.setFromQuaternion(this.head.quaternion);
    this.torso.position.copy(this.head.position);
    this.torso.position.y -= 0.58;
    this.torso.rotation.set(0, YAW.y, 0);
    this.updateArms();
    if (this.tag) {
      v1.copy(this.head.position);
      v1.y += 0.48;
      this.tag.position.copy(v1);
    }
  }

  dispose() {
    disposeTree(this.group);
  }
}
