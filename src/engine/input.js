import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const m1 = new THREE.Matrix4();

/**
 * One pointer. In VR that is a controller or tracked hand, on desktop the mouse.
 * Worlds read the same fields either way, so most gameplay code needs no VR branch.
 */
export class Hand {
  constructor(id, obj) {
    this.id = id;
    this.obj = obj; // follows the aiming pose, -Z points along the ray
    this.mount = new THREE.Group(); // worlds put held items (blasters, wands) here
    this.obj.add(this.mount);
    this.origin = new THREE.Vector3();
    this.dir = new THREE.Vector3(0, 0, -1);
    this.velocity = new THREE.Vector3(); // how fast the hand is moving, for throwing
    this.lastOrigin = null;
    this.down = false;
    this.pressed = false; // true for the one frame the trigger went down
    this.released = false;
    this.squeezed = false; // same for the grip button (right click on desktop)
    this.hit = null; // { target, point, distance, uv } when aiming at a UI target
    this.source = null; // XRInputSource
    this.queue = { press: false, release: false, squeeze: false };
  }

  pulse(intensity = 0.5, ms = 40) {
    this.source?.gamepad?.hapticActuators?.[0]?.pulse?.(intensity, ms);
  }
}

export class Input {
  constructor(game) {
    this.game = game;
    this.enabled = false;
    this.locomotion = false;
    this.lasers = true;
    this.bounds = null;
    this.targets = [];
    this.raycaster = new THREE.Raycaster();
    this.yawVel = 0;
    this.pitch = 0;
    this.keys = new Set();
    this.keysPressed = new Set();
    this.locked = false;
    this.lockFailed = false;
    this.lockWorked = false;
    this.mouseNdc = new THREE.Vector2();
    this.look = { active: false, moved: 0 };
    this.snapLatch = false;
    this.menuLatch = false;
    this.free = false; // the world handles movement, turning and face buttons itself
    this.allowTurn = false; // with free, whether the right stick still turns the player
    this.cursor = false; // desktop: the mouse is a normal cursor, as in a menu
    this.lastLook = 0;
    this.axes = { moveX: 0, moveY: 0, lookX: 0, lookY: 0, triggerL: 0, triggerR: 0, gripL: 0, gripR: 0 };
    this.buttons = { a: false, b: false, x: false, y: false }; // true for one frame
    this.buttonsHeld = { a: false, b: false, x: false, y: false };

    this.mouse = new Hand('mouse', new THREE.Group());
    this.mouse.obj.position.set(0.3, -0.26, -0.7);
    game.camera.add(this.mouse.obj);

    this.controllers = [0, 1].map((i) => this.setupController(i));
    this.setupDesktop();
  }

  /** Hands currently driving the game. */
  get hands() {
    if (!this.game.isXR) return [this.mouse];
    return this.controllers.filter((h) => h.source);
  }

  /** The hand to use when a world only needs one. */
  get primary() {
    const hands = this.hands;
    return hands.find((h) => h.source?.handedness === 'right') ?? hands[0] ?? this.mouse;
  }

  setupController(i) {
    const obj = this.game.renderer.xr.getController(i);
    const hand = new Hand(`xr${i}`, obj);
    this.game.rig.add(obj);

    hand.model = new THREE.Group();
    const stub = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.018, 0.08, 3, 8).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xf4efe2 }),
    );
    stub.position.z = 0.02;
    hand.model.add(stub);
    obj.add(hand.model);

    const laserGeo = new THREE.CylinderGeometry(0.0015, 0.004, 1, 6).rotateX(Math.PI / 2).translate(0, 0, -0.5);
    hand.laser = new THREE.Mesh(laserGeo, new THREE.MeshBasicMaterial({
      color: 0xfff2c9, transparent: true, opacity: 0.55, depthWrite: false, fog: false,
    }));
    obj.add(hand.laser);

    obj.addEventListener('connected', (e) => { hand.source = e.data; });
    obj.addEventListener('disconnected', () => { hand.source = null; hand.down = false; });
    obj.addEventListener('selectstart', () => { hand.queue.press = true; });
    obj.addEventListener('selectend', () => { hand.queue.release = true; });
    obj.addEventListener('squeezestart', () => { hand.queue.squeeze = true; });
    return hand;
  }

  setupDesktop() {
    const { canvas } = this.game;
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (this.locked) this.lockWorked = true;
      document.body.classList.toggle('locked', this.locked);
    });
    document.addEventListener('pointerlockerror', () => this.onLockRefused());

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled || this.game.isXR) return;
      if (!this.locked && !this.lockFailed && !this.cursor && e.button === 0) {
        this.requestLock();
        return;
      }
      if (e.button === 0) this.mouse.queue.press = true;
      if (e.button === 2) {
        if (this.locked) this.mouse.queue.squeeze = true;
        else this.look = { active: true, moved: 0 };
      }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.queue.release = true;
      if (e.button === 2 && this.look.active) {
        if (this.look.moved < 5) this.mouse.queue.squeeze = true;
        this.look.active = false;
      }
    });
    addEventListener('mousemove', (e) => {
      this.mouseNdc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
      if (this.locked || this.look.active) {
        const dx = THREE.MathUtils.clamp(e.movementX, -200, 200);
        const dy = THREE.MathUtils.clamp(e.movementY, -200, 200);
        const sens = 0.0022 * this.game.prefs.comfort.sensitivity;
        this.look.moved += Math.abs(dx) + Math.abs(dy);
        this.lastLook = performance.now();
        this.game.rig.rotation.y -= dx * sens;
        this.pitch = THREE.MathUtils.clamp(this.pitch - dy * sens, -1.45, 1.45);
      }
    });
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      this.keysPressed.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  requestLock() {
    try {
      const result = this.game.canvas.requestPointerLock?.();
      if (!this.game.canvas.requestPointerLock) this.onLockRefused();
      result?.catch?.(() => this.onLockRefused());
    } catch {
      this.onLockRefused();
    }
  }

  /** Browsers refuse a re-lock just after Esc, so only give up if it never worked. */
  onLockRefused() {
    if (!this.lockWorked) this.lockFailed = true;
  }

  /** True for the one frame a key went down. */
  keyPressed(code) {
    return this.enabled && this.currentKeys.has(code);
  }

  addTarget(obj, { onSelect, onEnter, onLeave } = {}) {
    const target = { obj, onSelect, onEnter, onLeave, hovered: false };
    this.targets.push(target);
    return target;
  }

  removeTarget(obj) {
    this.targets = this.targets.filter((t) => t.obj !== obj);
  }

  update(dt) {
    this.currentKeys = this.keysPressed;
    this.keysPressed = new Set();
    const xr = this.game.isXR;
    this.mouse.obj.visible = !xr;

    for (const hand of [this.mouse, ...this.controllers]) {
      const q = hand.queue;
      hand.pressed = q.press;
      hand.released = q.release;
      hand.squeezed = q.squeeze;
      if (q.press) hand.down = true;
      if (q.release) hand.down = false;
      hand.queue = { press: false, release: false, squeeze: false };
      hand.hit = null;
    }

    if (!this.enabled) {
      if (!this.game.started) this.game.rig.rotation.y += dt * 0.06;
      this.setLasers(false);
      this.applyDesktopCamera(xr);
      return;
    }

    if (xr) this.updateXR(dt);
    else this.updateDesktop(dt);
    this.updateRays(xr, dt);
    this.updateTargets();
  }

  applyDesktopCamera(xr) {
    if (!xr) this.game.camera.rotation.set(this.pitch, 0, 0);
  }

  updateDesktop(dt) {
    const { rig } = this.game;
    if (!this.free) {
      const turn = (this.keys.has('KeyE') || this.keys.has('ArrowRight') ? 1 : 0)
        - (this.keys.has('KeyQ') || this.keys.has('ArrowLeft') ? 1 : 0);
      rig.rotation.y -= turn * dt * 1.8;
      const lookV = (this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('ArrowDown') ? 1 : 0);
      this.pitch = THREE.MathUtils.clamp(this.pitch + lookV * dt * 1.2, -1.45, 1.45);
    }
    this.applyDesktopCamera(false);

    const a = this.axes;
    a.moveX = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
    a.moveY = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);

    if (this.keyPressed('KeyH') || this.keyPressed('Tab')) this.game.goHome();
    if (this.keyPressed('KeyM')) this.game.net.toggleMic();

    if (!this.locomotion) return;
    const x = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    const z = (this.keys.has('KeyS') ? 1 : 0) - (this.keys.has('KeyW') ? 1 : 0);
    if (x || z) {
      const speed = this.game.prefs.comfort.speed * (this.keys.has('ShiftLeft') ? 1.8 : 1);
      v1.set(x, 0, z).normalize().applyAxisAngle(UP, rig.rotation.y).multiplyScalar(speed * dt);
      rig.position.add(v1);
      this.bounds?.(rig.position);
    }
  }

  updateXR(dt) {
    const { rig, camera } = this.game;
    const { speed, snap: snapDegrees, turn } = this.game.prefs.comfort;
    let menu = false;
    let mic = false;
    let snap = 0;
    const axes = this.axes;
    const held = { a: false, b: false, x: false, y: false };
    axes.moveX = 0;
    axes.moveY = 0;
    axes.lookX = 0;
    axes.lookY = 0;
    axes.triggerL = 0;
    axes.triggerR = 0;
    axes.gripL = 0;
    axes.gripR = 0;
    for (const hand of this.controllers) {
      const pad = hand.source?.gamepad;
      if (!pad) continue;
      const isLeft = hand.source.handedness === 'left';
      const lower = !!pad.buttons[4]?.pressed; // A on the right hand, X on the left
      const upper = !!pad.buttons[5]?.pressed; // B on the right hand, Y on the left
      if (upper && !this.free) menu = true;
      if (lower && isLeft) mic = true;
      if (isLeft) {
        held.x = lower;
        held.y = upper;
      } else {
        held.a = lower;
        held.b = upper;
      }
      const ax = pad.axes.length >= 4 ? pad.axes[2] : pad.axes[0] ?? 0;
      const ay = pad.axes.length >= 4 ? pad.axes[3] : pad.axes[1] ?? 0;
      const dead = (n) => (Math.abs(n) < 0.12 ? 0 : n);
      if (isLeft) {
        axes.moveX = dead(ax);
        axes.moveY = -dead(ay);
        axes.triggerL = pad.buttons[0]?.value ?? 0;
        axes.gripL = pad.buttons[1]?.value ?? 0;
      } else {
        axes.lookX = dead(ax);
        axes.lookY = -dead(ay);
        axes.triggerR = pad.buttons[0]?.value ?? 0;
        axes.gripR = pad.buttons[1]?.value ?? 0;
      }
      if (hand.source.handedness === 'left' && this.locomotion) {
        if (Math.hypot(ax, ay) > 0.15) {
          camera.getWorldDirection(v1).setY(0).normalize();
          v2.crossVectors(v1, UP);
          rig.position.addScaledVector(v1, -ay * speed * dt).addScaledVector(v2, ax * speed * dt);
          this.bounds?.(rig.position);
        }
      } else if (hand.source.handedness !== 'left') {
        snap = ax;
      }
    }
    if (menu && !this.menuLatch) this.game.goHome();
    this.menuLatch = menu;
    if (mic && !this.micLatch) this.game.net.toggleMic();
    this.micLatch = mic;

    for (const name of Object.keys(held)) {
      this.buttons[name] = held[name] && !this.buttonsHeld[name];
      this.buttonsHeld[name] = held[name];
    }

    if (!this.locomotion && !this.allowTurn) return;
    if (turn === 'smooth') {
      if (Math.abs(snap) > 0.2) this.turnAroundHead(-snap * dt * 1.5);
    } else if (Math.abs(snap) > 0.6) {
      if (!this.snapLatch) this.turnAroundHead(THREE.MathUtils.degToRad(snap > 0 ? -snapDegrees : snapDegrees));
      this.snapLatch = true;
    } else if (Math.abs(snap) < 0.3) {
      this.snapLatch = false;
    }
  }

  /** Turns the player without moving their head, so it doesn't feel like sliding. */
  turnAroundHead(angle) {
    const { rig, camera } = this.game;
    camera.getWorldPosition(v1);
    rig.rotateY(angle);
    rig.updateMatrixWorld(true);
    camera.getWorldPosition(v2);
    rig.position.add(v1.sub(v2));
  }

  updateRays(xr, dt) {
    const { camera } = this.game;
    if (xr) {
      for (const hand of this.controllers) {
        hand.obj.updateWorldMatrix(true, false);
        hand.origin.setFromMatrixPosition(hand.obj.matrixWorld);
        hand.dir.set(0, 0, -1).transformDirection(hand.obj.matrixWorld);
        if (hand.lastOrigin && dt > 0) {
          v1.copy(hand.origin).sub(hand.lastOrigin).divideScalar(dt);
          hand.velocity.lerp(v1, 0.5);
          hand.lastOrigin.copy(hand.origin);
        } else {
          hand.lastOrigin = hand.origin.clone();
        }
      }
      return;
    }
    camera.updateWorldMatrix(true, false);
    if (this.locked) this.raycaster.setFromCamera(v1.set(0, 0, 0), camera);
    else this.raycaster.setFromCamera(this.mouseNdc, camera);
    this.mouse.origin.copy(this.raycaster.ray.origin);
    this.mouse.dir.copy(this.raycaster.ray.direction);

    // Point whatever the mouse hand is holding along the ray.
    const obj = this.mouse.obj;
    obj.updateWorldMatrix(true, false);
    v1.setFromMatrixPosition(obj.matrixWorld);
    v2.copy(this.mouse.origin).addScaledVector(this.mouse.dir, 30);
    m1.lookAt(v1, v2, UP);
    q1.setFromRotationMatrix(m1);
    camera.getWorldQuaternion(obj.quaternion).invert().multiply(q1);
  }

  updateTargets() {
    const meshes = this.targets.filter((t) => t.obj.visible).map((t) => t.obj);
    const hovered = new Set();
    for (const hand of this.hands) {
      let length = 6;
      if (meshes.length) {
        this.raycaster.ray.origin.copy(hand.origin);
        this.raycaster.ray.direction.copy(hand.dir);
        this.raycaster.near = 0;
        this.raycaster.far = 40;
        const hit = this.raycaster.intersectObjects(meshes, false)[0];
        if (hit) {
          const target = this.targets.find((t) => t.obj === hit.object);
          hand.hit = { target, point: hit.point, distance: hit.distance, uv: hit.uv };
          hovered.add(target);
          length = hit.distance;
        }
      }
      if (hand.laser) {
        hand.laser.visible = this.lasers;
        hand.laser.scale.z = length;
      }
    }
    this.setLasers(this.lasers);

    for (const t of this.targets) {
      const now = hovered.has(t);
      if (now !== t.hovered) {
        t.hovered = now;
        (now ? t.onEnter : t.onLeave)?.();
        if (now) {
          this.game.sound.play('hover');
          for (const hand of this.hands) if (hand.hit?.target === t) hand.pulse(0.15, 12);
        }
      }
    }
    for (const hand of this.hands) {
      if (hand.pressed && hand.hit?.target.onSelect) {
        hand.pulse(0.5, 30);
        hand.hit.target.onSelect(hand);
      }
    }
    document.body.classList.toggle('aiming', hovered.size > 0);
  }

  setLasers(on) {
    for (const hand of this.controllers) {
      hand.laser.visible = on && !!hand.source;
      hand.model.visible = !!hand.source && hand.mount.children.length === 0;
    }
  }

  /** Called between worlds. */
  reset() {
    this.targets = [];
    this.locomotion = false;
    this.lasers = true;
    this.bounds = null;
    this.free = false;
    this.allowTurn = false;
    this.cursor = false;
    for (const hand of [this.mouse, ...this.controllers]) hand.mount.clear();
    document.body.classList.remove('aiming');
  }
}
