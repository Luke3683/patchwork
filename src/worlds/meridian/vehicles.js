import * as THREE from 'three';
import { MODELS } from './models.js';
import { disposeTree } from '../../engine/kit.js';

export const TYPES = {
  bike: { label: 'Motorcycle', cls: 'land', top: 50, accel: 17, turn: 2.15, grip: 7, color: 0xe4572e, pitch: 95 },
  car: { label: 'Coupe', cls: 'land', top: 44, accel: 13, turn: 1.55, grip: 6, color: 0x2e86ab, pitch: 75 },
  supercar: { label: 'Supercar', cls: 'land', top: 74, accel: 25, turn: 1.8, grip: 7.5, color: 0xffd23f, pitch: 120 },
  police: { label: 'Police cruiser', cls: 'land', top: 62, accel: 19, turn: 1.75, grip: 7, color: 0x101116, pitch: 85 },
  plane: { label: 'Prop plane', cls: 'plane', top: 80, stall: 28, takeoff: 34, turn: 1, color: 0xf2ece0, pitch: 90 },
  jet: { label: 'Jet', cls: 'plane', top: 190, stall: 48, takeoff: 58, turn: 1.25, color: 0x8d97a6, pitch: 180 },
  heli: { label: 'Helicopter', cls: 'heli', top: 42, color: 0xc9402f, pitch: 55 },
  boat: { label: 'Speedboat', cls: 'boat', top: 36, accel: 11, turn: 1.2, grip: 2.2, color: 0xf2ece0, pitch: 80 },
};

const GRAVITY = 19;
const FORWARD = new THREE.Vector3();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const hitNormal = new THREE.Vector3();

export class Vehicle {
  constructor(world, type, x, z, yaw, { y = null, color = null } = {}) {
    this.world = world;
    this.type = type;
    this.def = TYPES[type];
    this.home = { x, z, yaw, y };
    this.model = MODELS[type](color ?? this.def.color, world.k.game.look.high);
    this.group = this.model.group;
    world.k.root.add(this.group);
    this.vel = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this.driver = false;
    this.nitro = 1;
    this.throttle = 0;
    this.spin = 0;
    this.steerAngle = 0;
    this.lean = 0;
    this.pitch = 0;
    this.roll = 0;
    this.airTime = 0;
    this.lastAir = 0;
    this.boosting = false;
    this.place(x, z, yaw, y);
  }

  get speed() {
    return this.vel.length();
  }

  get airborne() {
    return !this.grounded;
  }

  setColor(hex) {
    this.group.children[0].material?.color?.set(hex);
  }

  place(x, z, yaw, y = null) {
    this.yaw = yaw;
    this.pitch = 0;
    this.roll = 0;
    this.lean = 0;
    this.vel.set(0, 0, 0);
    this.throttle = 0;
    const ground = this.def.cls === 'boat' ? 0.1 : y ?? this.world.groundAt(x, z, 1e5);
    this.pos.set(x, ground + (this.model.gear ?? 0), z);
    this.grounded = true;
    this.sync();
  }

  respawn() {
    this.place(this.home.x, this.home.z, this.home.yaw, this.home.y);
  }

  /** Called each frame with the driver's controls, or none when parked. */
  update(dt, c) {
    const cls = this.def.cls;
    if (cls === 'land') this.updateLand(dt, c);
    else if (cls === 'plane') this.updatePlane(dt, c);
    else if (cls === 'heli') this.updateHeli(dt, c);
    else this.updateBoat(dt, c);
    this.sync();
  }

  /** How the upgrades shape this vehicle. */
  stats() {
    const u = this.world.upgrades;
    return {
      top: this.def.top * (1 + u.engine * 0.09),
      accel: (this.def.accel ?? 0) * (1 + u.engine * 0.11),
      turn: (this.def.turn ?? 0) * (1 + u.handling * 0.07),
      grip: (this.def.grip ?? 0) * (1 + u.handling * 0.1),
      nitroPower: 1.45 + u.nitro * 0.12,
      nitroDrain: 0.26 / (1 + u.nitro * 0.35),
    };
  }

  updateLand(dt, c) {
    const s = this.stats();
    const f = FORWARD.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const fwd = this.vel.x * f.x + this.vel.z * f.z;
    const steer = c?.steer ?? 0;
    const gas = c?.gas ?? 0;
    const brake = c?.brake ?? 0;
    const handbrake = c?.handbrake ?? false;

    this.boosting = !!c?.boost && this.nitro > 0.02 && gas > 0 && this.grounded;
    if (this.boosting) this.nitro = Math.max(0, this.nitro - s.nitroDrain * dt);
    else this.nitro = Math.min(1, this.nitro + 0.05 * dt);
    const top = s.top * (this.boosting ? s.nitroPower : 1);

    if (this.grounded) {
      const speedFactor = Math.min(1, Math.abs(fwd) / 8);
      const dir = fwd >= -0.5 ? 1 : -1;
      const steerDamp = 1 - Math.min(0.55, Math.abs(fwd) / (s.top * 2.2));
      this.yaw -= steer * s.turn * speedFactor * steerDamp * dir * dt;

      let force = 0;
      if (gas > 0) force += gas * s.accel * (1 - Math.min(0.95, Math.max(0, fwd) / top)) * (this.boosting ? 1.8 : 1);
      if (brake > 0) force -= fwd > 1 ? brake * 34 : brake * 8 * (fwd > -12 ? 1 : 0);
      if (handbrake && fwd > 0) force -= 9;
      this.vel.x += f.x * force * dt;
      this.vel.z += f.z * force * dt;

      // Sideways slide is scrubbed away by the tires, less so with the handbrake on.
      const fw2 = this.vel.x * f.x + this.vel.z * f.z;
      const sideX = this.vel.x - f.x * fw2;
      const sideZ = this.vel.z - f.z * fw2;
      const grip = Math.exp(-(handbrake ? 1.2 : s.grip) * dt);
      this.vel.x = f.x * fw2 + sideX * grip;
      this.vel.z = f.z * fw2 + sideZ * grip;
      const roll = Math.exp(-(gas > 0 ? 0.05 : 0.32) * dt);
      this.vel.x *= roll;
      this.vel.z *= roll;
    }

    this.moveGround(dt);

    const leanTarget = this.type === 'bike' ? THREE.MathUtils.clamp(steer * Math.min(1, Math.abs(fwd) / 18) * 0.62, -0.62, 0.62) : steer * Math.min(1, Math.abs(fwd) / 30) * 0.05;
    this.lean = THREE.MathUtils.damp(this.lean, leanTarget, 7, dt);
    this.steerAngle = THREE.MathUtils.damp(this.steerAngle, -steer * 0.42, 12, dt);
    this.spin += (fwd / 0.36) * dt;
    this.throttle = THREE.MathUtils.damp(this.throttle, gas, 4, dt);
  }

  /** Gravity, terrain following, ramps, and hitting things. */
  moveGround(dt) {
    const { world, pos, vel } = this;
    const before = world.groundAt(pos.x, pos.z, pos.y);
    pos.x += vel.x * dt;
    pos.z += vel.z * dt;
    this.collide();
    const ground = world.groundAt(pos.x, pos.z, pos.y);
    const rise = (ground - before) / Math.max(dt, 1e-3);

    if (this.grounded) {
      if (ground >= pos.y - 0.45) {
        // Still on the ground. Going up a slope stores upward speed for launches.
        vel.y = THREE.MathUtils.clamp(rise, -40, 24);
        pos.y = ground;
      } else {
        this.grounded = false;
        this.airTime = 0;
      }
    }
    if (!this.grounded) {
      vel.y -= GRAVITY * dt;
      pos.y += vel.y * dt;
      this.airTime += dt;
      if (pos.y <= ground) {
        if (this.driver && this.airTime > 1) world.onAirTime(this, this.airTime);
        if (vel.y < -10) {
          world.bump(this, Math.min(1, -vel.y / 30));
          vel.x *= 0.92;
          vel.z *= 0.92;
        }
        pos.y = ground;
        vel.y = 0;
        this.grounded = true;
        this.airTime = 0;
      }
    }

    // Tilt to match the slope, sampled under the nose and tail.
    const len = this.model.radius;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    let pitchTarget;
    if (this.grounded) {
      const front = world.groundAt(pos.x + fx * len, pos.z + fz * len, pos.y);
      const back = world.groundAt(pos.x - fx * len, pos.z - fz * len, pos.y);
      pitchTarget = Math.atan2(front - back, len * 2);
    } else {
      pitchTarget = Math.atan2(vel.y, Math.hypot(vel.x, vel.z) + 8);
    }
    this.pitch = THREE.MathUtils.damp(this.pitch, pitchTarget, this.grounded ? 12 : 3, dt);

    if (world.submerged(this)) world.onSink(this);
  }

  collide() {
    const { world, pos, vel } = this;
    if (world.solids.push(pos, this.model.radius * 0.72, pos.y, hitNormal)) {
      const into = vel.x * hitNormal.x + vel.z * hitNormal.z;
      if (into < 0) {
        vel.x -= hitNormal.x * into * 1.35;
        vel.z -= hitNormal.z * into * 1.35;
        vel.x *= 0.72;
        vel.z *= 0.72;
        if (this.driver && into < -6) world.bump(this, Math.min(1, -into / 30));
      }
    }
  }

  updatePlane(dt, c) {
    const u = this.world.upgrades;
    const top = this.def.top * (1 + u.engine * 0.08);
    const authority = this.def.turn * (1 + u.handling * 0.06);
    this.throttle = THREE.MathUtils.clamp(this.throttle + (c?.throttle ?? 0) * dt * 0.55, 0, 1);
    if (!c) this.throttle = Math.max(0, this.throttle - dt);

    let speed = this.flightSpeed ?? 0;
    const f = FORWARD.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const target = this.throttle * top;
    speed += (target - speed) * dt * (speed < target ? 0.22 : 0.32);
    speed -= f.y * 17 * dt;
    speed = Math.max(0, speed);

    const control = THREE.MathUtils.clamp((speed - 8) / 30, 0, 1);
    const pitchIn = c?.pitch ?? 0;
    const rollIn = c?.roll ?? 0;
    const ground = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y) + this.model.gear;
    const onGround = this.pos.y <= ground + 0.25;

    if (onGround) {
      // Rolling on the wheels. The rudder steers, and pulling back lifts off at speed.
      this.yaw -= rollIn * Math.min(1, speed / 6) * dt * 0.8;
      this.roll = THREE.MathUtils.damp(this.roll, 0, 8, dt);
      const lift = speed > this.def.takeoff ? Math.max(0, pitchIn) * 0.34 : 0;
      this.pitch = THREE.MathUtils.damp(this.pitch, lift, 3, dt);
      if ((c?.brake ?? 0) > 0) speed = Math.max(0, speed - 24 * dt);
    } else {
      this.pitch = THREE.MathUtils.clamp(this.pitch + pitchIn * 0.7 * authority * control * dt, -1.0, 0.85);
      this.roll = THREE.MathUtils.clamp(this.roll + rollIn * 1.8 * authority * control * dt, -1.25, 1.25);
      if (Math.abs(rollIn) < 0.05) this.roll = THREE.MathUtils.damp(this.roll, 0, 1.2, dt);
      this.yaw -= Math.sin(this.roll) * 0.75 * authority * control * dt;
      this.pitch -= Math.abs(Math.sin(this.roll)) * 0.06 * dt;
      // Too slow and the wing gives up: the nose drops until speed comes back.
      if (speed < this.def.stall) {
        const stall = 1 - speed / this.def.stall;
        this.pitch = THREE.MathUtils.damp(this.pitch, -0.7, stall * 1.6, dt);
      }
    }
    this.flightSpeed = speed;
    const liftGap = onGround ? 0 : Math.max(0, this.def.stall - speed) * 0.55;
    f.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    this.vel.copy(f).multiplyScalar(speed);
    this.vel.y -= liftGap;
    if (onGround && this.vel.y < 0) this.vel.y = 0;
    this.pos.addScaledVector(this.vel, dt);

    const groundNow = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y) + this.model.gear;
    if (this.pos.y <= groundNow) {
      const dig = groundNow - this.pos.y;
      const hard = !onGround && (this.vel.y < -12 || Math.abs(this.roll) > 0.6 || this.pitch < -0.32 || (dig > 0.35 && speed > 20));
      this.pos.y = groundNow;
      if (hard && this.driver) this.world.onCrash(this);
      if (this.pitch < 0) this.pitch = 0;
    }
    if (this.world.solids.push(this.pos, this.model.radius * 0.6, this.pos.y, hitNormal) && speed > 15 && this.driver) this.world.onCrash(this);
    if (this.pos.y < -0.2 && this.world.terrain.height(this.pos.x, this.pos.z) < -0.2) this.world.onSink(this);

    this.grounded = onGround;
    this.lean = this.roll;
    for (const p of this.model.props ?? []) p.obj.rotation[p.axis] += (this.throttle * p.speed + (this.throttle > 0 ? 4 : 0)) * dt;
    if (this.model.flame) {
      this.model.flame.visible = this.throttle > 0.05;
      this.model.flame.scale.z = 0.5 + this.throttle * 0.9 + Math.sin(performance.now() * 0.05) * 0.06;
    }
  }

  updateHeli(dt, c) {
    const u = this.world.upgrades;
    const top = this.def.top * (1 + u.engine * 0.08);
    const on = !!c;
    const lift = c?.lift ?? 0;
    const forward = c?.pitch ?? 0;
    const strafe = c?.strafe ?? 0;
    this.throttle = THREE.MathUtils.damp(this.throttle, on ? 1 : 0, 1.3, dt);
    this.yaw -= (c?.yaw ?? 0) * 1.5 * dt;
    const f = FORWARD.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const rx = -f.z;
    const rz = f.x;
    const k = 1 - Math.exp(-1.5 * dt);
    this.vel.x += (f.x * forward * top + rx * strafe * top * 0.6 - this.vel.x) * k;
    this.vel.z += (f.z * forward * top + rz * strafe * top * 0.6 - this.vel.z) * k;
    const vyTarget = on ? lift * 15 : -9;
    this.vel.y += (vyTarget - this.vel.y) * (1 - Math.exp(-2.2 * dt));
    this.pos.addScaledVector(this.vel, dt);
    const ground = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y);
    if (this.pos.y <= ground) {
      this.pos.y = ground;
      if (this.vel.y < 0) this.vel.y = 0;
      this.vel.x *= Math.exp(-4 * dt);
      this.vel.z *= Math.exp(-4 * dt);
    }
    this.grounded = this.pos.y <= ground + 0.05;
    if (this.world.solids.push(this.pos, this.model.radius, this.pos.y, hitNormal)) {
      const into = this.vel.x * hitNormal.x + this.vel.z * hitNormal.z;
      if (into < 0) {
        this.vel.x -= hitNormal.x * into * 1.4;
        this.vel.z -= hitNormal.z * into * 1.4;
        if (this.driver && into < -8) this.world.bump(this, Math.min(1, -into / 30));
      }
    }
    this.pitch = THREE.MathUtils.damp(this.pitch, -forward * 0.32, 3, dt);
    this.roll = THREE.MathUtils.damp(this.roll, -strafe * 0.3 - (c?.yaw ?? 0) * 0.12, 3, dt);
    this.lean = this.roll;
    for (const p of this.model.props) p.obj.rotation[p.axis] += this.throttle * p.speed * dt;
    if (this.pos.y < -0.5 && this.world.terrain.height(this.pos.x, this.pos.z) < -0.5) this.world.onSink(this);
  }

  updateBoat(dt, c) {
    const s = this.stats();
    const f = FORWARD.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const fwd = this.vel.x * f.x + this.vel.z * f.z;
    const steer = c?.steer ?? 0;
    const gas = c?.gas ?? 0;
    const brake = c?.brake ?? 0;
    this.yaw -= steer * s.turn * Math.min(1, Math.abs(fwd) / 5) * (fwd >= 0 ? 1 : -1) * dt;
    let force = gas * s.accel * (1 - Math.min(0.95, Math.max(0, fwd) / s.top));
    if (brake > 0) force -= fwd > 0 ? brake * 12 : brake * 5;
    this.vel.x += f.x * force * dt;
    this.vel.z += f.z * force * dt;
    const fw2 = this.vel.x * f.x + this.vel.z * f.z;
    const grip = Math.exp(-s.grip * dt);
    const sideX = this.vel.x - f.x * fw2;
    const sideZ = this.vel.z - f.z * fw2;
    this.vel.x = (f.x * fw2 + sideX * grip) * Math.exp(-0.22 * dt);
    this.vel.z = (f.z * fw2 + sideZ * grip) * Math.exp(-0.22 * dt);

    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;
    // Boats run aground in the shallows.
    if (this.world.terrain.height(nx, nz) > -1) {
      this.vel.multiplyScalar(0.5);
      if (this.world.terrain.height(this.pos.x, this.pos.z) > -1) {
        this.pos.x = nx;
        this.pos.z = nz;
      }
    } else {
      this.pos.x = nx;
      this.pos.z = nz;
    }
    this.world.solids.push(this.pos, this.model.radius * 0.7, 1, hitNormal);
    const t = this.world.time;
    this.pos.y = 0.04 + Math.sin(t * 1.5 + this.pos.x * 0.08) * 0.1 + Math.min(0.5, Math.max(0, fwd) * 0.014);
    this.pitch = THREE.MathUtils.damp(this.pitch, Math.min(0.18, Math.max(0, fwd) * 0.006) + Math.sin(t * 1.1) * 0.015, 3, dt);
    this.lean = THREE.MathUtils.damp(this.lean, steer * Math.min(1, Math.abs(fwd) / 18) * 0.2 + Math.sin(t * 0.8) * 0.02, 4, dt);
    this.grounded = true;
    this.throttle = THREE.MathUtils.damp(this.throttle, gas, 4, dt);
  }

  sync() {
    this.group.position.copy(this.pos);
    euler.set(this.pitch, this.yaw, this.def.cls === 'land' || this.def.cls === 'boat' ? -this.lean : -this.roll);
    this.group.quaternion.setFromEuler(euler);
    if (this.model.wheels.length) {
      for (const w of this.model.wheels) w.rotation.x = -this.spin;
      for (const w of this.model.steer) w.rotation.y = this.steerAngle;
    }
  }

  /** Engine pitch for the sound, from its speed and how hard it's pushed. */
  enginePitch() {
    const ratio = Math.min(1.4, this.speed / this.def.top);
    return this.def.pitch * (0.7 + ratio * 1.6 + this.throttle * 0.25);
  }

  dispose() {
    this.world.k.root.remove(this.group);
    disposeTree(this.group);
  }
}
