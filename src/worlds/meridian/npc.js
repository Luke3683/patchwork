import * as THREE from 'three';
import { CITY_HEIGHT } from './terrain.js';
import { Crowd } from './crowd.js';

const MAX = 150;
const SHIRTS = [0xe4572e, 0x2e86ab, 0xf2d24b, 0x7d4ea8, 0x76b041, 0xf2ece0, 0xff8fb0, 0x3d3a4b, 0x35c5c9, 0xe8e8e8];
const PANTS = [0x2b2f3c, 0x3f5a7a, 0x6b5a48, 0x1d1e24, 0xc9b896, 0x45503d];
const SKIN = [0xf1c9a5, 0xe0ac7e, 0xc58c5f, 0x8d5a3a, 0x5f3b26, 0xf6d7bb];
const HAIR = [0x1a120d, 0x2a1c14, 0x4a2f1b, 0x7a5230, 0xc9a35c, 0x8d8d8d, 0x101010];
const STREET_CLOTHES = ['casual', 'hoodie', 'beach', 'suit', 'worker', 'formal', 'woman2', 'punk2', 'adventurer', 'punk'];
const GANG_CLOTHES = ['punk', 'hoodie', 'punk2'];
const HALF_BLOCK = 37;
const EDGE = HALF_BLOCK * 2;

/** Everyone on the street: civilians, gang members and cops. */
export class People {
  constructor(world) {
    this.world = world;
    this.k = world.k;
    this.list = [];
    this.high = this.k.game.look.high;
    this.crowd = new Crowd(this.k.root, this.high);
    this.hero = null;
    this.v = new THREE.Vector3();
  }

  add(role, x, z, opts = {}) {
    if (this.list.length >= MAX) return null;
    const pick = (a) => a[Math.floor(Math.random() * a.length)];
    const outfit = role === 'cop' ? 'soldier' : role === 'thug' ? pick(GANG_CLOTHES) : pick(STREET_CLOTHES);
    const p = {
      role, x, z, y: this.world.groundAt(x, z, 1e5), yaw: Math.random() * 6.28, speed: 0, state: 'walk', hp: 100, timer: 0, clipT: 0,
      outfit, skin: pick(SKIN), hair: pick(HAIR), size: 0.94 + Math.random() * 0.1, blink: 0, punch: 0, cool: 0, ...opts,
    };
    // About half keep the outfit's own colors, and the rest put together something of their own.
    if (role === 'civilian' && Math.random() < 0.5) {
      p.shirt = p.shirt ?? pick(SHIRTS);
      p.pants = p.pants ?? pick(PANTS);
    }
    this.list.push(p);
    return p;
  }

  /** People who walk the block around their home sidewalk. */
  addWalker(cx, cz) {
    // Most are off somewhere, and some just stand around enjoying the day.
    const standing = Math.random() < 0.22;
    return this.add('civilian', cx, cz, { cx, cz, t: Math.random() * 4, y: CITY_HEIGHT + 0.26, rate: standing ? 0 : 1.15 + Math.random() * 0.65, waves: standing && Math.random() < 0.3 });
  }

  remove(p) {
    this.list.splice(this.list.indexOf(p), 1);
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
    p.blink = 0.34;
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

  /** The animation that suits what someone is doing right now. */
  pickClip(p) {
    if (p.state === 'down') return ['Death', 1, { hold: true }];
    if (p.punch > 0) return [p.punchLeft ? 'Punch_Left' : 'Punch_Right', 1.5, {}];
    if (p.blink > 0) return ['HitRecieve', 1.4, { hold: true }];
    if (p.speed > 2.6) return ['Run', p.speed / 4.6, {}];
    if (p.speed > 0.2) return ['Walk', p.speed / 1.5, {}];
    return [p.waves ? 'Wave' : 'Idle', 1, {}];
  }

  update(dt, focus) {
    const { crowd } = this;
    const reach = this.high ? 150 : 70;
    crowd.begin();
    for (const p of this.list) {
      const distance = Math.hypot(p.x - focus.x, p.z - focus.z);
      p.blink = Math.max(0, p.blink - dt);
      if (p.punch > 0 && p.punch - dt <= 0) p.punchLeft = !p.punchLeft;
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
        const wander = (p.size ?? 1) * 40;
        this.move(p, dx + Math.sin(wander) * 8, dz + Math.cos(wander) * 8, 5.2, dt);
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
        p.t = (p.t + (p.rate * dt) / EDGE) % 4;
        const edge = Math.floor(p.t);
        const f = p.t - edge;
        const corners = [[-HALF_BLOCK, -HALF_BLOCK], [HALF_BLOCK, -HALF_BLOCK], [HALF_BLOCK, HALF_BLOCK], [-HALF_BLOCK, HALF_BLOCK]];
        const a = corners[edge];
        const b = corners[(edge + 1) % 4];
        p.x = p.cx + a[0] + (b[0] - a[0]) * f;
        p.z = p.cz + a[1] + (b[1] - a[1]) * f;
        p.y = CITY_HEIGHT + 0.26;
        p.yaw = Math.atan2(-(b[0] - a[0]), -(b[1] - a[1]));
        p.speed = p.rate;
        if (distance < 4 && this.world.player.vehicle?.speed > 6) {
          p.state = 'flee';
          p.timer = 4;
        }
      }
      // Gang members and cops are moved by the crime system, which knows who they're after.

      if (distance > reach) continue;
      const [clip, rate, opts] = this.pickClip(p);
      crowd.draw(p, clip, rate, dt, opts);
    }
    const { hero } = this;
    if (hero?.visible) crowd.draw(hero, hero.action, hero.rate, dt, hero.opts);
    crowd.finish();
  }
}
