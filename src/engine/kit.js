import * as THREE from 'three';
import { Panel, makeCard, makeButtonFace } from './ui.js';

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const dummy = new THREE.Object3D();
const color = new THREE.Color();

const PORTAL_VERT = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const PORTAL_FRAG = /* glsl */`
  varying vec2 vUv;
  uniform float time;
  uniform vec3 tint;
  uniform float power;
  void main() {
    vec2 p = vUv - 0.5;
    float r = length(p) * 2.0;
    float a = atan(p.y, p.x);
    float s = sin(a * 3.0 + r * 9.0 - time * 2.4) * 0.5 + 0.5;
    vec3 c = mix(tint * 0.28, tint, s * power);
    c = mix(c, vec3(1.0), smoothstep(0.55, 0.0, r) * 0.65 * power);
    gl_FragColor = vec4(c, 1.0);
    #include <colorspace_fragment>
  }
`;

/**
 * The toolkit handed to each world's create() function.
 * Anything added to kit.root is cleaned up for you when the player leaves.
 */
export class Kit {
  constructor(game, def) {
    this.game = game;
    this.def = def;
    this.scene = game.scene;
    this.rig = game.rig;
    this.camera = game.camera;
    this.input = game.input;
    this.sound = game.sound;
    this.save = game.save;
    this.isXR = game.isXR;

    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.portals = [];
    this.toasts = [];
    this.disposers = [];
    this.attached = [];
    this.skyObj = null;
    this.bursts = null;

    this.scene.fog = null;
    this.input.reset();
    this.spawn(0, 0, 0);
  }

  // --- Player -------------------------------------------------------------

  /** Places the player. Yaw 0 looks toward -Z. */
  spawn(x, z, yaw = 0, y = 0) {
    this.rig.position.set(x, y, z);
    this.rig.rotation.set(0, yaw, 0);
    this.input.pitch = 0;
    this.rig.updateMatrixWorld(true);
  }

  setMove(enabled) {
    this.input.locomotion = enabled;
  }

  /** fn receives the rig position and may clamp it. */
  setBounds(fn) {
    this.input.bounds = fn;
  }

  /** Keeps the player inside a circle on the ground. */
  boundsCircle(radius, cx = 0, cz = 0) {
    this.setBounds((p) => {
      const dx = p.x - cx;
      const dz = p.z - cz;
      const d = Math.hypot(dx, dz);
      if (d > radius) {
        p.x = cx + (dx / d) * radius;
        p.z = cz + (dz / d) * radius;
      }
    });
  }

  head(out = new THREE.Vector3()) {
    this.camera.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(this.camera.matrixWorld);
  }

  /** Attach something to the player so it moves with them, like a vehicle. */
  attachToRig(obj) {
    this.rig.add(obj);
    this.attached.push(obj);
    return obj;
  }

  // --- Scenery ------------------------------------------------------------

  /** A gradient dome. Colors run from straight up to straight down. */
  sky({ top, mid, horizon, bottom, stars = 0 }) {
    const geo = new THREE.SphereGeometry(800, 32, 24);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const cTop = new THREE.Color(top);
    const cMid = new THREE.Color(mid);
    const cHor = new THREE.Color(horizon);
    const cBot = new THREE.Color(bottom ?? horizon);
    for (let i = 0; i < pos.count; i++) {
      const h = pos.getY(i) / 800;
      if (h > 0.3) color.lerpColors(cMid, cTop, (h - 0.3) / 0.7);
      else if (h > 0) color.lerpColors(cHor, cMid, h / 0.3);
      else color.lerpColors(cHor, cBot, Math.min(1, -h / 0.18));
      color.toArray(colors, i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.skyObj = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false,
    }));
    this.skyObj.renderOrder = -10;
    if (stars) {
      const points = new Float32Array(stars * 3);
      for (let i = 0; i < stars; i++) {
        v1.randomDirection();
        if (v1.y < 0.02) v1.y = Math.abs(v1.y) + 0.02;
        v1.normalize().multiplyScalar(760).toArray(points, i * 3);
      }
      const starGeo = new THREE.BufferGeometry();
      starGeo.setAttribute('position', new THREE.BufferAttribute(points, 3));
      this.skyObj.add(new THREE.Points(starGeo, new THREE.PointsMaterial({
        color: 0xfff6e0, size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85, depthWrite: false,
      })));
    }
    this.root.add(this.skyObj);
    return this.skyObj;
  }

  lights({ sky = 0xffffff, ground = 0x444444, sun = 0xffffff, ambient = 1.6, direct = 1.8, dir = [0.5, 1, 0.3] }) {
    this.root.add(new THREE.HemisphereLight(sky, ground, ambient));
    const light = new THREE.DirectionalLight(sun, direct);
    light.position.set(...dir);
    this.root.add(light);
  }

  fog(hex, near, far) {
    this.scene.fog = new THREE.Fog(hex, near, far);
  }

  /** Scatter copies of a geometry cheaply. place(dummy, i) sets each transform. */
  instanced(geometry, material, count, place) {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    for (let i = 0; i < count; i++) {
      dummy.position.set(0, 0, 0);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      const tint = place(dummy, i);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (tint !== undefined) mesh.setColorAt(i, color.set(tint));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.root.add(mesh);
    return mesh;
  }

  // --- Interface ----------------------------------------------------------

  /** A live scoreboard fixed in the world. Update it with board.card({ title, body }). */
  board({ width = 1.6, height = 0.5, at = [0, 2.5, -4], scale = 1, parent = this.root } = {}) {
    const panel = new Panel({ width, height });
    panel.position.set(...at);
    panel.scale.setScalar(scale);
    parent.add(panel);
    return panel;
  }

  button(label, onSelect, { accent, width } = {}) {
    const face = makeButtonFace(label, accent, width);
    face.material.color.setScalar(0.86);
    this.input.addTarget(face, {
      onSelect: (hand) => {
        this.sound.play('select');
        onSelect(hand);
      },
      onEnter: () => { face.material.color.setScalar(1); face.scale.setScalar(1.06); },
      onLeave: () => { face.material.color.setScalar(0.86); face.scale.setScalar(1); },
    });
    return face;
  }

  /**
   * A card with buttons, placed relative to the player at [x, z] and at eye height.
   * buttons: [{ label, onSelect, accent }]. Call .close() to remove it.
   */
  menu({ title, body, buttons = [], at = [0, -2.3], width = 1.8, accent }) {
    const group = new THREE.Group();
    const card = makeCard({ title, body, width, accent });
    group.add(card);
    const faces = buttons.map((b, i) => {
      const face = this.button(b.label, b.onSelect, { accent: b.accent ?? accent });
      const gap = 0.8;
      face.position.set((i - (buttons.length - 1) / 2) * gap, -card.geometry.parameters.height / 2 - 0.16, 0.01);
      group.add(face);
      return face;
    });
    this.rig.updateMatrixWorld(true);
    v1.set(at[0], 0, at[1]);
    this.rig.localToWorld(v1);
    group.position.set(v1.x, this.head(v2).y + 0.02, v1.z);
    group.rotation.y = this.rig.rotation.y + Math.atan2(-at[0], -at[1]);
    this.root.add(group);
    return {
      group,
      close: () => {
        faces.forEach((f) => this.input.removeTarget(f));
        this.root.remove(group);
        disposeTree(group);
      },
    };
  }

  /** A short message that appears in front of the player and fades away. */
  toast(title, body = '', accent = '#ffd166') {
    const card = makeCard({ title, body, width: 1.5, accent });
    card.material.depthTest = false;
    card.renderOrder = 50;
    this.head(v1);
    this.camera.getWorldDirection(v2).setY(0).normalize();
    card.position.copy(v1).addScaledVector(v2, 1.5);
    card.position.y -= 0.12;
    card.lookAt(v1);
    this.root.add(card);
    this.toasts.push({ card, life: 3.2 });
  }

  /** A swirling gateway. It opens when selected or when the player walks into it. */
  portal({ tint, title, subtitle, position, onEnter, radius = 1.25, locked = false, accent }) {
    const group = new THREE.Group();
    group.position.copy(position);
    const uniforms = {
      time: { value: 0 },
      tint: { value: new THREE.Color(tint) },
      power: { value: locked ? 0.15 : 1 },
    };
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 40),
      new THREE.ShaderMaterial({ vertexShader: PORTAL_VERT, fragmentShader: PORTAL_FRAG, uniforms, side: THREE.DoubleSide }),
    );
    disc.position.y = radius + 0.35;
    group.add(disc);

    const frameMat = new THREE.MeshLambertMaterial({ color: tint, flatShading: true });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.1, 6, 28), frameMat);
    ring.position.y = disc.position.y;
    group.add(ring);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.7, radius * 0.86, 0.3, 7), frameMat);
    base.position.y = 0.1;
    group.add(base);

    if (title) {
      const label = makeCard({ title, body: subtitle, width: 1.9, accent });
      label.scale.setScalar(1.5);
      label.position.y = radius * 2 + 0.6 + (label.geometry.parameters.height * 1.5) / 2;
      group.add(label);
    }
    this.root.add(group);

    const portal = { group, disc, uniforms, onEnter, locked, used: false, ring };
    const open = () => {
      if (portal.used || portal.locked) return;
      portal.used = true;
      this.sound.play('portal');
      onEnter();
    };
    portal.open = open;
    this.input.addTarget(disc, {
      onSelect: open,
      onEnter: () => ring.scale.setScalar(1.05),
      onLeave: () => ring.scale.setScalar(1),
    });
    this.portals.push(portal);
    return portal;
  }

  /** A portal back to the hub. */
  exitPortal(position, label = 'Back to the Crossroads') {
    return this.portal({
      tint: 0xf4efe2, title: label, position, radius: 0.85, onEnter: () => this.game.goHome(),
    });
  }

  /** Throws a shower of little shards. */
  burst(position, tint = 0xffffff, count = 14, speed = 4) {
    if (!this.bursts) {
      const max = 160;
      const mesh = new THREE.InstancedMesh(
        new THREE.TetrahedronGeometry(0.06),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
        max,
      );
      mesh.frustumCulled = false;
      mesh.setColorAt(0, color.set(0xffffff));
      this.root.add(mesh);
      this.bursts = {
        mesh, next: 0,
        items: Array.from({ length: max }, () => ({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0 })),
      };
      for (let i = 0; i < max; i++) {
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
    }
    const b = this.bursts;
    for (let i = 0; i < count; i++) {
      const item = b.items[b.next];
      item.pos.copy(position);
      item.vel.randomDirection().multiplyScalar(speed * (0.4 + Math.random()));
      item.life = 0.5 + Math.random() * 0.4;
      b.mesh.setColorAt(b.next, color.set(tint));
      b.next = (b.next + 1) % b.items.length;
    }
    b.mesh.instanceColor.needsUpdate = true;
  }

  // --- Progress -----------------------------------------------------------

  /** Awards this world's quilt patch. Safe to call more than once. */
  complete() {
    if (this.save.earnPatch(this.def.id)) {
      this.sound.play('patch');
      this.toast('Patch earned', `${this.def.name} is stitched into your quilt.`);
    }
  }

  /** Plays a soft background chord until the player leaves. */
  ambience(freqs, gain) {
    this.onDispose(this.sound.pad(freqs, gain));
  }

  onDispose(fn) {
    this.disposers.push(fn);
  }

  // --- Internals ----------------------------------------------------------

  update(dt, t) {
    if (this.skyObj) this.skyObj.position.copy(this.rig.position);

    if (this.portals.length) {
      this.head(v1);
      for (const p of this.portals) {
        p.uniforms.time.value = t;
        if (!this.input.enabled || p.used || p.locked) continue;
        p.group.getWorldPosition(v2);
        if (Math.hypot(v1.x - v2.x, v1.z - v2.z) < 0.7) p.open();
      }
    }

    for (let i = this.toasts.length - 1; i >= 0; i--) {
      const toast = this.toasts[i];
      toast.life -= dt;
      toast.card.material.opacity = Math.min(1, toast.life * 2);
      if (toast.life <= 0) {
        this.root.remove(toast.card);
        disposeTree(toast.card);
        this.toasts.splice(i, 1);
      }
    }

    if (this.bursts) {
      const { items, mesh } = this.bursts;
      items.forEach((item, i) => {
        if (item.life <= 0) return;
        item.life -= dt;
        item.vel.multiplyScalar(1 - dt * 1.6);
        item.pos.addScaledVector(item.vel, dt);
        dummy.position.copy(item.pos);
        dummy.rotation.set(item.life * 9, item.life * 7, 0);
        dummy.scale.setScalar(Math.max(0, item.life) * 1.6);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  teardown() {
    this.disposers.forEach((fn) => fn());
    for (const obj of this.attached) {
      this.rig.remove(obj);
      disposeTree(obj);
    }
    this.scene.remove(this.root);
    disposeTree(this.root);
    for (const hand of [this.input.mouse, ...this.input.controllers]) disposeTree(hand.mount);
    this.input.reset();
  }
}

export function disposeTree(root) {
  root.traverse((obj) => {
    obj.geometry?.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const m of mats) {
      m.map?.dispose();
      m.dispose();
    }
    obj.dispose?.();
  });
}
