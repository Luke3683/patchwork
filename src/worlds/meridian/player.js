import * as THREE from 'three';
import { Avatar } from '../../engine/avatar.js';
import { OUTFITS } from './crowd.js';
import { Radio } from './radio.js';

const GRAVITY = 19;
const EYE = 1.6;
const ENTER_RANGE = 5.5;
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const q2 = new THREE.Quaternion();
const e1 = new THREE.Euler(0, 0, 0, 'YXZ');

/** The person: walking, running, swimming, flying a jetpack, and getting in and out of things. */
export class Player {
  constructor(world) {
    this.world = world;
    this.k = world.k;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.bodyYaw = 0;
    this.grounded = true;
    this.swimming = false;
    this.vehicle = null;
    this.nearby = null;
    this.stamina = 1;
    this.fuel = 1;
    this.firstPerson = false;
    this.camDist = 7;
    this.shake = 0;
    this.jetting = false;

    this.avatar = new Avatar(this.k.prefs.look);
    this.k.root.add(this.avatar.group);
    this.avatar.setName('');
    const look = this.k.prefs.look;
    this.hero = {
      x: 0, y: 0, z: 0, yaw: 0, skin: look.skin, hair: look.hair, shirt: look.primary, pants: look.secondary, outfit: OUTFITS.includes(world.progress.data.outfit) ? world.progress.data.outfit : 'casual', action: 'Idle', rate: 1, opts: {}, visible: false,
    };
    this.world.people.hero = this.hero;
    this.vehicleEngine = null;
    this.radio = new Radio(this.k.sound);
    this.wind = null;
    this.vignette = new THREE.Mesh(
      new THREE.RingGeometry(0.2, 1.4, 40),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false, fog: false }),
    );
    this.vignette.position.z = -0.3;
    this.vignette.renderOrder = 90;
    this.vignette.visible = false;
    this.k.camera.add(this.vignette);
    this.lastYaw = 0;

    this.k.game.net.poseOverride = () => this.networkPose();
    this.k.onDispose(() => {
      this.k.camera.remove(this.vignette);
      this.vignette.geometry.dispose();
      this.vignette.material.dispose();
      this.k.game.net.poseOverride = null;
      this.vehicleEngine?.stop();
      this.wind?.stop();
      this.radio.stop();
    });
  }

  get xr() {
    return this.k.isXR;
  }

  spawn(x, z, yaw = 0) {
    this.pos.set(x, this.world.groundAt(x, z, 1e5), z);
    this.vel.set(0, 0, 0);
    this.bodyYaw = yaw;
    this.k.rig.position.copy(this.pos);
    this.k.rig.rotation.set(0, yaw, 0);
    this.k.input.pitch = -0.12;
  }

  /** The jump and sprint upgrades. */
  get stats() {
    const u = this.world.upgrades;
    return {
      walk: this.k.prefs.comfort.speed,
      run: this.k.prefs.comfort.speed * (2.2 + u.sprint * 0.3),
      jump: 7 + u.boots * 2.4,
      jetpack: u.jetpack,
    };
  }

  input() {
    const { input } = this.k;
    return { x: input.axes.moveX, y: input.axes.moveY };
  }

  jumpPressed() {
    const { input } = this.k;
    return this.xr ? input.buttons.a : input.keyPressed('Space');
  }

  jumpHeld() {
    const { input } = this.k;
    return this.xr ? input.buttonsHeld.a : input.keys.has('Space');
  }

  sprintHeld() {
    const { input } = this.k;
    return this.xr ? input.axes.gripL > 0.4 : input.keys.has('ShiftLeft') || input.keys.has('ShiftRight');
  }

  enterPressed() {
    const { input } = this.k;
    return this.xr ? input.buttons.b : input.keyPressed('KeyF');
  }

  update(dt) {
    const w = this.world;
    this.shake = Math.max(0, this.shake - dt * 2.2);
    if (this.vehicle) {
      this.driveVehicle(dt);
    } else {
      this.walk(dt);
      this.findNearby();
    }
    if (this.enterPressed() && !w.paused) {
      if (this.vehicle) this.exitVehicle();
      else if (this.nearby) {
        if (this.nearby.isPolice) w.crime.addWanted(1, 'You stole a police car');
        if (w.progress.owns(this.nearby.type) || this.nearby.stolen) this.enterVehicle(this.nearby);
        else w.hud.flash(this.nearby.def.label, 'Buy it from the Vehicles tab in the menu first.');
      } else if (this.nearbyCar) {
        this.enterVehicle(w.crime.carjack(this.nearbyCar));
        this.nearbyCar = null;
      }
    }
    if (!this.xr && this.k.input.keyPressed('KeyV')) this.firstPerson = !this.firstPerson;
    if (this.vehicle && !w.paused && this.k.input.keyPressed('KeyR')) {
      const now = this.radio.next();
      w.hud.flash(now.name, now.tag);
    }
    this.radio.update();
    this.placeCamera(dt);
    this.updateVignette(dt);
    this.updateAvatar(dt);
    this.updateSound();
  }

  /** Fast motion and turning in a headset are what cause motion sickness, so they narrow the view. */
  updateVignette(dt) {
    const on = this.xr && this.k.prefs.comfort.vignette !== 'off';
    this.vignette.visible = on;
    if (!on) return;
    const v = this.vehicle;
    const speed = v ? v.speed : Math.hypot(this.vel.x, this.vel.z);
    const yaw = this.k.rig.rotation.y;
    const turn = Math.abs(((yaw - this.lastYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) / Math.max(dt, 0.001);
    this.lastYaw = yaw;
    const wanted = Math.min(0.92, Math.max(0, speed - 4) * 0.022 + Math.min(1, turn) * 0.55);
    const m = this.vignette.material;
    m.opacity += (wanted - m.opacity) * (1 - Math.exp(-6 * dt));
  }

  findNearby() {
    // Any car on the road or at the curb can be taken.
    let bestCar = null;
    let carD = ENTER_RANGE;
    for (const c of this.world.traffic.cars) {
      if (c.gone) continue;
      const d = Math.hypot(c.x - this.pos.x, c.z - this.pos.z);
      if (d < carD && Math.abs(c.y - this.pos.y) < 3) {
        carD = d;
        bestCar = c;
      }
    }
    this.nearbyCar = bestCar;

    let best = null;
    let bestD = ENTER_RANGE;
    for (const v of this.world.vehicles) {
      const d = v.pos.distanceTo(this.pos);
      if (d < bestD + v.model.radius) {
        const score = d - v.model.radius;
        if (score < bestD) {
          bestD = score;
          best = v;
        }
      }
    }
    this.nearby = best;
  }

  walk(dt) {
    const { rig, input, camera } = this.k;
    const w = this.world;
    const s = this.stats;
    const stick = this.input();
    const moving = Math.hypot(stick.x, stick.y) > 0.1;
    const sprint = this.sprintHeld() && moving && this.stamina > 0.02;
    if (sprint) this.stamina = Math.max(0, this.stamina - dt * 0.14);
    else this.stamina = Math.min(1, this.stamina + dt * 0.1);
    const speed = (sprint ? s.run : s.walk) * (this.swimming ? 0.55 : 1);

    // Move relative to where the player is looking.
    let yaw;
    if (this.xr) {
      camera.getWorldDirection(v1);
      yaw = Math.atan2(-v1.x, -v1.z);
    } else {
      yaw = rig.rotation.y;
    }
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const wantX = (stick.x * cos - stick.y * sin) * speed;
    const wantZ = (-stick.x * sin - stick.y * cos) * speed;
    const accel = this.grounded || this.swimming ? 14 : 3;
    const a = 1 - Math.exp(-accel * dt);
    this.vel.x += (wantX - this.vel.x) * a;
    this.vel.z += (wantZ - this.vel.z) * a;
    if (moving && (this.vel.x * this.vel.x + this.vel.z * this.vel.z) > 0.5) {
      const target = Math.atan2(-this.vel.x, -this.vel.z);
      const diff = ((target - this.bodyYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.bodyYaw += diff * (1 - Math.exp(-11 * dt));
    }

    // In VR the room can move the head around, so the rig stays the source of truth.
    if (this.xr) {
      this.pos.x = rig.position.x;
      this.pos.z = rig.position.z;
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    w.solids.push(this.pos, 0.42, this.pos.y);

    if (this.jumpPressed() && (this.grounded || this.swimming)) {
      this.vel.y = s.jump;
      this.grounded = false;
      this.k.sound.tone({ f: 240, d: 0.14, type: 'triangle', g: 0.09, slide: 180 });
    }

    // The jetpack burns while the jump button is held in the air.
    this.jetting = false;
    if (s.jetpack > 0 && !this.grounded && !this.swimming && this.jumpHeld() && this.fuel > 0.01 && this.vel.y < 16) {
      this.vel.y += (30 + s.jetpack * 6) * dt;
      this.fuel = Math.max(0, this.fuel - (0.22 / s.jetpack) * dt);
      this.jetting = true;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      this.vel.x += fx * Math.max(0, stick.y) * 9 * dt;
      this.vel.z += fz * Math.max(0, stick.y) * 9 * dt;
    } else if (this.grounded) {
      this.fuel = Math.min(1, this.fuel + dt * 0.35);
    }

    this.vel.y -= GRAVITY * dt;
    this.pos.y += this.vel.y * dt;
    const ground = w.groundAt(this.pos.x, this.pos.z, this.pos.y);
    const swimLevel = -1.2;
    this.swimming = ground < swimLevel && this.pos.y <= swimLevel + 0.01;
    if (this.swimming) {
      this.pos.y = swimLevel;
      this.vel.y = Math.max(0, this.vel.y);
      this.grounded = false;
    } else if (this.pos.y <= ground) {
      this.pos.y = ground;
      this.vel.y = 0;
      this.grounded = true;
    } else {
      this.grounded = this.grounded && this.pos.y - ground < 0.3;
      if (this.grounded) this.pos.y = ground;
    }

    if (this.xr) {
      rig.position.x = this.pos.x;
      rig.position.z = this.pos.z;
      rig.position.y = this.pos.y;
    }
    input.allowTurn = true;
  }

  enterVehicle(v) {
    this.vehicle = v;
    v.driver = true;
    this.nearby = null;
    this.vel.set(0, 0, 0);
    this.k.input.allowTurn = false;
    this.k.input.lasers = false;
    this.k.sound.play('select');
    if (v.def.cls === 'plane') {
      v.throttle = 0;
      v.flightSpeed = v.flightSpeed ?? 0;
      if (!this.xr) this.world.hud.banner('Hold W', 'Build speed, then point the mouse up to climb. Point where you want to go.');
    }
    this.vehicleEngine?.stop();
    this.vehicleEngine = this.k.sound.engine();
    this.radio.start();
    if (!this.radio.off) this.world.hud.flash(this.radio.station.name, `${this.radio.station.tag}. Press R to change station.`);
    this.world.onEnterVehicle(v);
    this.k.rig.rotation.y = v.yaw;
  }

  exitVehicle() {
    const v = this.vehicle;
    if (!v) return;
    v.driver = false;
    this.vehicle = null;
    this.vehicleEngine?.stop();
    this.vehicleEngine = null;
    this.radio.stop();
    this.k.input.lasers = true;
    this.k.sound.play('select');
    // Step out on the driver's side, on whatever is there.
    const side = v.def.cls === 'plane' ? 4.2 : v.model.radius * 0.8 + 0.8;
    const x = v.pos.x + Math.cos(v.yaw) * -side;
    const z = v.pos.z + Math.sin(v.yaw) * side;
    this.pos.set(x, Math.max(v.pos.y, this.world.groundAt(x, z, v.pos.y + 2)), z);
    this.vel.copy(v.vel).multiplyScalar(0.2);
    this.bodyYaw = v.yaw;
    this.grounded = false;
    this.world.onExitVehicle(v);
    if (this.xr) this.k.rig.position.copy(this.pos);
  }

  /** Reads the keyboard or controllers as vehicle controls. */
  controls() {
    const { input } = this.k;
    const { keys, axes } = input;
    const cls = this.vehicle.def.cls;
    const xr = this.xr;
    const c = {};
    if (cls === 'land' || cls === 'boat') {
      // Keys are all or nothing, so ease into the turn the way a steering wheel would.
      const rate = axes.moveX === 0 ? 11 : 6.5;
      this.steerIn = THREE.MathUtils.damp(this.steerIn ?? 0, axes.moveX, xr ? 40 : rate, this.frameDt);
      c.steer = this.steerIn;
      c.gas = xr ? axes.triggerR : Math.max(0, axes.moveY);
      c.brake = xr ? axes.triggerL : Math.max(0, -axes.moveY);
      c.handbrake = xr ? input.buttonsHeld.a : keys.has('Space');
      c.boost = xr ? axes.gripR > 0.5 : keys.has('ShiftLeft') || keys.has('ShiftRight');
    } else if (cls === 'plane' && xr) {
      c.pitch = -axes.moveY; // pull back to climb
      c.roll = axes.moveX;
      c.throttle = axes.triggerR - axes.triggerL;
      c.brake = input.buttonsHeld.a ? 1 : 0;
    } else if (cls === 'plane') {
      // On a computer you just point where you want to go. The keys can nudge the aim too.
      const v = this.vehicle;
      const up = keys.has('KeyW') || keys.has('ShiftLeft') || keys.has('ShiftRight') ? 1 : 0;
      const down = keys.has('KeyS') || keys.has('KeyZ') ? 1 : 0;
      c.throttle = up - down;
      c.brake = keys.has('Space') || (down && v.grounded) ? 1 : 0;
      const turn = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      const lift = (keys.has('ArrowUp') ? 1 : 0) - (keys.has('ArrowDown') ? 1 : 0);
      this.k.rig.rotation.y -= turn * 1.1 * this.frameDt;
      input.pitch = THREE.MathUtils.clamp(input.pitch + lift * 0.7 * this.frameDt, -1, 0.9);
      const aimPitch = input.pitch + 0.14;
      const yawError = ((this.k.rig.rotation.y - v.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      c.aim = { pitch: aimPitch, roll: -yawError * 1.5 };
      c.pitch = aimPitch > 0.03 ? 1 : 0; // lifts the nose once there's takeoff speed
      c.roll = THREE.MathUtils.clamp(-yawError * 1.5, -1, 1);
    } else {
      c.pitch = axes.moveY;
      c.yaw = axes.moveX;
      c.strafe = xr ? axes.lookX : 0;
      const up = xr ? axes.triggerR : keys.has('ShiftLeft') || keys.has('ShiftRight') || keys.has('Space') ? 1 : 0;
      const down = xr ? axes.triggerL : keys.has('KeyZ') ? 1 : 0;
      c.lift = up - down;
    }
    return c;
  }

  driveVehicle(dt) {
    this.frameDt = dt;
    const v = this.vehicle;
    v.update(dt, this.world.paused ? null : this.controls());
    this.pos.copy(v.pos);
    this.bodyYaw = v.yaw;
    if (this.xr) this.k.input.allowTurn = false;
  }

  placeCamera(dt) {
    const { rig, input, camera } = this.k;
    const v = this.vehicle;
    if (this.xr) {
      // In a headset, you sit in the seat. The horizon stays level to keep it comfortable.
      if (v) {
        const s = v.model.seat;
        const sin = Math.sin(v.yaw);
        const cos = Math.cos(v.yaw);
        rig.position.set(v.pos.x + s.x * cos + s.z * sin, v.pos.y + s.y - EYE * 0.55, v.pos.z - s.x * sin + s.z * cos);
        rig.rotation.y = v.yaw;
      }
      return;
    }

    // Desktop: a chase camera, or your own eyes.
    const body = v ?? this;
    const targetY = v ? v.pos.y + v.model.chaseHeight * 0.45 : this.pos.y + EYE;
    if (this.firstPerson && !v) {
      rig.position.copy(this.pos);
      return;
    }
    // After a moment without touching the mouse, the camera swings back behind the vehicle.
    const idle = performance.now() - input.lastLook > 800;
    if (v && idle && v.speed > 2 && v.def.cls !== 'plane') {
      const diff = ((v.yaw - rig.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      rig.rotation.y += diff * (1 - Math.exp(-2.8 * dt));
      const wantPitch = -0.14;
      input.pitch += (wantPitch - input.pitch) * (1 - Math.exp(-2.5 * dt));
    }
    const yaw = rig.rotation.y;
    const pitch = input.pitch;
    const speedPull = v ? Math.min(1, v.speed / v.def.top) : 0;
    const wantDist = v ? v.model.chase * (1 + speedPull * 0.32) : 4.4;
    this.camDist += (wantDist - this.camDist) * (1 - Math.exp(-3 * dt));
    v1.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    let dist = this.camDist;

    // Keep the camera out of the ground and walls.
    const cx0 = body.pos.x;
    const cz0 = body.pos.z;
    for (let step = 1; step <= 6; step++) {
      const t = (dist * step) / 6;
      const px = cx0 - v1.x * t;
      const py = targetY - v1.y * t;
      const pz = cz0 - v1.z * t;
      const under = this.world.terrain.height(px, pz) + 0.6;
      let blocked = py < under;
      if (!blocked) {
        for (const b of this.world.solids.near(px, pz)) {
          if (px > b.minX && px < b.maxX && pz > b.minZ && pz < b.maxZ && py < b.top && py > b.bottom) {
            blocked = true;
            break;
          }
        }
      }
      if (blocked) {
        dist = Math.max(1.6, (dist * (step - 1)) / 6);
        break;
      }
    }

    const shakeX = this.shake ? (Math.random() - 0.5) * this.shake * 0.5 : 0;
    const shakeY = this.shake ? (Math.random() - 0.5) * this.shake * 0.5 : 0;
    const camX = cx0 - v1.x * dist + shakeX;
    const camZ = cz0 - v1.z * dist;
    // Never below the ground, however steep the hill behind you.
    const camY = Math.max(targetY - v1.y * dist + shakeY, this.world.terrain.height(cx0 - v1.x * dist, camZ) + 0.7);
    rig.position.set(camX, camY - camera.position.y, camZ);

    // A wider view at speed makes going fast feel fast.
    const fovTarget = this.k.prefs.comfort.fov + (v ? speedPull * 16 + (v.boosting ? 8 : 0) : 0);
    if (Math.abs(camera.fov - fovTarget) > 0.05) {
      camera.fov += (fovTarget - camera.fov) * (1 - Math.exp(-4 * dt));
      camera.updateProjectionMatrix();
    }
  }

  updateAvatar(dt) {
    const av = this.avatar;
    const v = this.vehicle;
    const hideSelf = this.xr || (this.firstPerson && !v);
    this.updateHero(hideSelf);
    av.group.visible = false;
    const t = av.target;
    if (v) {
      const s = v.model.seat;
      v.group.updateWorldMatrix(true, false);
      t.head.set(s.x, s.y + 0.72, s.z).applyMatrix4(v.group.matrixWorld);
      e1.set(v.pitch * 0.5, v.yaw, 0);
      t.headQ.setFromEuler(e1);
      t.left.set(s.x - 0.24, s.y + 0.3, s.z - 0.5).applyMatrix4(v.group.matrixWorld);
      t.right.set(s.x + 0.24, s.y + 0.3, s.z - 0.5).applyMatrix4(v.group.matrixWorld);
      t.leftQ.copy(t.headQ);
      t.rightQ.copy(t.headQ);
      av.seated = true;
      // Enclosed cockpits hide the driver.
      av.group.visible = !hideSelf && (v.type === 'bike' || v.type === 'boat');
      av.snap();
    } else {
      av.seated = false;
      t.head.set(this.pos.x, this.pos.y + EYE, this.pos.z);
      e1.set(0, this.bodyYaw, 0);
      t.headQ.setFromEuler(e1);
      const swingAmount = Math.min(1, Math.hypot(this.vel.x, this.vel.z) / 3) * 0.32;
      const phase = (av.phase ?? 0);
      const sin = Math.sin(this.bodyYaw);
      const cos = Math.cos(this.bodyYaw);
      const punching = this.world.crime?.punching;
      const punchSide = this.world.crime?.punchSide ? 'left' : 'right';
      for (const [name, side, sign] of [['left', -1, 1], ['right', 1, -1]]) {
        const fwd = Math.sin(phase) * swingAmount * sign;
        v2.set(side * 0.34, EYE - 0.88, -fwd);
        if (punching && name === punchSide) v2.set(side * 0.12, EYE - 0.3, -0.62);
        t[name].set(this.pos.x + v2.x * cos + v2.z * sin, this.pos.y + v2.y + Math.abs(fwd) * 0.2, this.pos.z - v2.x * sin + v2.z * cos);
        t[`${name}Q`].copy(t.headQ);
      }
      if (this.jetting) this.world.flame(this.pos, this.bodyYaw);
    }
    t.showLeft = true;
    t.showRight = true;
    av.update(dt, null);
  }

  /** Your own body on foot, with the same animations as everyone else in the city. */
  updateHero(hideSelf) {
    const h = this.hero;
    h.visible = !hideSelf && !this.vehicle && this.world.people.crowd.ready;
    if (!h.visible) return;
    const look = this.k.prefs.look;
    h.skin = look.skin;
    h.hair = look.hair;
    h.shirt = look.primary;
    h.pants = look.secondary;
    h.x = this.pos.x;
    h.y = this.pos.y;
    h.z = this.pos.z;
    h.yaw = this.bodyYaw;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const crime = this.world.crime;
    h.opts = { dip: this.swimming ? 1.2 : 0 };
    if (crime?.punching) {
      h.action = crime.punchSide ? 'Punch_Left' : 'Punch_Right';
      h.rate = 1.6;
    } else if (this.swimming) {
      h.action = 'Walk';
      h.rate = 0.6 + speed * 0.2;
    } else if (!this.grounded) {
      h.action = 'Run';
      h.rate = 0.35;
    } else if (speed > 3.2) {
      h.action = 'Run';
      h.rate = speed / 4.6;
    } else if (speed > 0.25) {
      h.action = 'Walk';
      h.rate = speed / 1.5;
    } else {
      h.action = 'Idle';
      h.rate = 1;
    }
  }

  updateSound() {
    const v = this.vehicle;
    if (v && this.vehicleEngine) {
      const level = 0.05 + v.throttle * 0.05 + Math.min(1, v.speed / v.def.top) * 0.03;
      this.vehicleEngine.set(v.enginePitch(), v.def.cls === 'heli' ? 0.1 : level);
    }
    if (!this.wind) this.wind = this.k.sound.breeze();
    const speed = v ? v.speed : Math.hypot(this.vel.x, this.vel.z, this.vel.y);
    this.wind.set(Math.min(0.14, 0.012 + speed * 0.0016), 300 + Math.min(2200, speed * 22));
  }

  /** What other players see, instead of the third-person camera position. */
  networkPose() {
    const { camera, input } = this.k;
    const out = [];
    const write = (p, q) => out.push(p.x, p.y, p.z, q.x, q.y, q.z, q.w);
    if (this.xr && !this.vehicle) {
      camera.updateWorldMatrix(true, false);
      v1.setFromMatrixPosition(camera.matrixWorld);
      camera.getWorldQuaternion(q1);
      write(v1, q1);
      for (const side of ['left', 'right']) {
        const hand = input.hands.find((h) => h.source?.handedness === side);
        if (hand) {
          hand.obj.getWorldPosition(v2);
          hand.obj.getWorldQuaternion(q2);
          write(v2, q2);
        } else {
          write(v1, q1);
        }
      }
    } else {
      const t = this.avatar.target;
      write(t.head, t.headQ);
      write(t.left, t.leftQ);
      write(t.right, t.rightQ);
    }
    const pose = out.map((n) => Math.round(n * 1000) / 1000);
    pose.push(3);
    return pose;
  }
}
