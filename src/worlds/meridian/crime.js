import * as THREE from 'three';
import { Vehicle } from './vehicles.js';
import { PADS } from './terrain.js';

const STAR_COOLDOWN = 22; // seconds out of sight to lose a star
const CONTACT_RANGE = 150;
const ROB_TIME = 5;
const ROB_RESET = 180;
const STATION = { x: -230, z: 46 };
const HOSPITAL = { x: 230, z: -46 };
const HOSTILE_RANGE = 24;
const PUNCH_COOLDOWN = 0.42;
const MAX_STOLEN = 6;

/** Stealing, fighting and the police: everything that can get you in trouble. */
export class Crime {
  constructor(world) {
    this.world = world;
    this.k = world.k;
    this.wanted = 0;
    this.heat = 0;
    this.health = 100;
    this.lastHurt = 99;
    this.cops = []; // { car, driver, stuck, lastPos }
    this.officers = [];
    this.arrest = 0;
    this.sirenTimer = 0;
    this.punchCool = 0;
    this.punchAnim = 0;
    this.stolen = [];
    this.robbing = null;
    this.buildStores();
    this.buildTurfs();
  }

  // --- Stores ------------------------------------------------------------------------

  buildStores() {
    const { world, k } = this;
    const spots = world.city.storeSpots;
    const step = Math.max(1, Math.floor(spots.length / 10));
    const chosen = spots.filter((_, i) => i % step === 0).slice(0, 10);
    const ringGeo = new THREE.TorusGeometry(1.1, 0.06, 6, 24).rotateX(Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff4040).multiplyScalar(2), toneMapped: false });
    this.stores = chosen.map((s) => {
      const y = world.groundAt(s.x, s.z, 1e5);
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(s.x, y + 0.2, s.z);
      k.root.add(ring);
      return { x: s.x, z: s.z, y, ring, reset: 0 };
    });
  }

  robHeld() {
    const { input } = this.k;
    return this.k.isXR ? input.axes.gripR > 0.5 : input.keys.has('KeyG');
  }

  updateStores(dt, p, hud) {
    let near = null;
    for (const s of this.stores) {
      s.reset = Math.max(0, s.reset - dt);
      s.ring.visible = s.reset <= 0;
      if (s.reset <= 0 && Math.hypot(s.x - p.x, s.z - p.z) < 2.6 && Math.abs(s.y - p.y) < 3 && !this.world.player.vehicle) near = s;
    }
    this.nearStore = near;
    if (!near) {
      this.robbing = null;
      return;
    }
    if (this.robHeld()) {
      if (this.robbing?.store !== near) {
        this.robbing = { store: near, time: 0 };
        this.k.sound.tone({ f: 880, d: 0.4, type: 'square', g: 0.05, slide: 200 });
        this.addWanted(1, 'The alarm went off');
      }
      this.robbing.time += dt;
      if (this.robbing.time >= ROB_TIME) {
        const cash = 50 + Math.floor(Math.random() * 110);
        near.reset = ROB_RESET;
        this.robbing = null;
        this.k.sound.play('pickup');
        this.world.progress.grant(35, cash, `Robbed the store: $${cash}`);
        this.addWanted(1);
      }
    } else {
      this.robbing = null;
    }
  }

  // --- Rival gangs, who start the fights -----------------------------------------------

  buildTurfs() {
    const { world } = this;
    const parks = world.city.parks;
    const turfSpots = [
      parks[0] ? { x: parks[0][0], z: parks[0][1], name: 'the park crew' } : { x: 138, z: -138, name: 'the park crew' },
      { x: PADS.harbor.x + 10, z: PADS.harbor.z + 40, name: 'the dock crew' },
      { x: PADS.pier.x - 80, z: PADS.pier.z + 40, name: 'the boardwalk crew' },
    ];
    this.turfs = turfSpots.map((t, index) => {
      const members = [];
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const m = world.people.add('thug', t.x + Math.cos(a) * 7, t.z + Math.sin(a) * 7, {
          shirt: [0x7a1420, 0x14407a, 0x1c6b3a][index],
          homeX: t.x + Math.cos(a) * 7,
          homeZ: t.z + Math.sin(a) * 7,
          onRise: (who) => {
            who.x = who.homeX;
            who.z = who.homeZ;
          },
        });
        if (m) members.push(m);
      }
      return { ...t, members, cleared: false };
    });
  }

  updateThugs(dt) {
    const { world } = this;
    const { player, people } = world;
    const p = player.pos;
    this.crewCool = Math.max(0, (this.crewCool ?? 0) - dt); // a crew takes turns, so it's a fight rather than a wall
    for (const turf of this.turfs) {
      let downCount = 0;
      for (const m of turf.members) {
        if (m.state === 'down') {
          downCount += 1;
          continue;
        }
        const dx = p.x - m.x;
        const dz = p.z - m.z;
        const d = Math.hypot(dx, dz);
        const home = Math.hypot(m.homeX - m.x, m.homeZ - m.z);
        if (d < HOSTILE_RANGE && home < 60 && Math.abs(m.y - p.y) < 6) {
          if (d > 1.25) people.move(m, dx, dz, player.vehicle ? 3 : 4.2, dt);
          else {
            m.speed = 0;
            m.yaw = Math.atan2(-dx, -dz);
            if (m.cool <= 0 && !player.vehicle && this.crewCool <= 0) {
              this.crewCool = 0.85;
              m.cool = 1.3 + Math.random() * 0.7;
              m.punch = 0.22;
              this.hurt(6);
            }
          }
        } else if (home > 1.5) {
          people.move(m, m.homeX - m.x, m.homeZ - m.z, 2, dt);
        } else {
          m.speed = 0;
        }
      }
      if (downCount === turf.members.length && !turf.cleared) {
        turf.cleared = true;
        this.k.sound.play('levelup');
        world.hud.banner('Turf cleared', `You beat ${turf.name}. They'll be back.`);
        world.progress.grant(160, 150, `Cleared ${turf.name}`);
      } else if (downCount < turf.members.length) {
        turf.cleared = false;
      }
    }
  }

  // --- Fighting ------------------------------------------------------------------------

  /** Left click on desktop. In a headset, you actually swing your fists. */
  updateFists(dt) {
    const { world, k } = this;
    const { player, people } = world;
    this.punchCool = Math.max(0, this.punchCool - dt);
    this.punchAnim = Math.max(0, this.punchAnim - dt);
    if (player.vehicle || world.paused) return;
    if (k.isXR) {
      for (const hand of k.input.hands) {
        if (hand.velocity.length() < 2.6 || this.punchCool > 0) continue;
        for (const person of people.list) {
          if (person.state === 'down') continue;
          const reach = Math.hypot(person.x - hand.origin.x, person.z - hand.origin.z);
          if (reach < 0.75 && hand.origin.y > person.y + 0.5 && hand.origin.y < person.y + 1.9) {
            hand.pulse(1, 70);
            this.landPunch(person);
            break;
          }
        }
      }
      return;
    }
    const mouse = k.input.mouse;
    if (mouse.pressed && !mouse.hit && this.punchCool <= 0) {
      this.punchCool = PUNCH_COOLDOWN;
      this.punchAnim = 0.2;
      this.punchSide = !this.punchSide;
      k.sound.noise({ d: 0.09, g: 0.05, f: 900 });
      const target = people.inReach(player.pos.x, player.pos.z, player.bodyYaw);
      if (target) this.landPunch(target);
    }
  }

  landPunch(person) {
    const { world, k } = this;
    const { player, people } = world;
    this.punchCool = PUNCH_COOLDOWN;
    const damage = 30 + world.upgrades.boxing * 14;
    const floored = people.hit(person, damage, player.pos.x, player.pos.z);
    k.sound.play('block');
    k.burst(new THREE.Vector3(person.x, person.y + 1.4, person.z), 0xfff0c9, 5, 2);
    player.shake = Math.max(player.shake, 0.12);
    if (person.role === 'civilian') {
      if (!floored) {
        person.state = 'flee';
        person.timer = 7;
      }
      this.addWanted(1, 'Someone called the police');
    } else if (person.role === 'cop') {
      this.addWanted(1, 'You hit a cop');
    } else if (floored) {
      const cash = 12 + Math.floor(Math.random() * 26);
      world.progress.grant(22, cash, `Knocked out a rival: $${cash}`);
    }
  }

  hurt(amount) {
    const armor = 1 - this.world.upgrades.toughness * 0.12;
    this.health -= amount * armor;
    this.lastHurt = 0;
    this.world.player.shake = Math.max(this.world.player.shake, 0.3);
    this.k.sound.play('hurt');
    this.k.input.primary.pulse(0.8, 90);
    if (this.health <= 0) this.knockedOut();
  }

  knockedOut() {
    const { world } = this;
    const fine = Math.floor(this.k.save.coins * 0.1);
    this.k.save.addCoins(-fine);
    this.clearHeat();
    world.player.exitVehicle();
    world.player.spawn(HOSPITAL.x, HOSPITAL.z, Math.PI);
    this.health = 100;
    world.hud.banner('Knocked out', `You woke up outside the hospital. The bill was $${fine}.`);
  }

  // --- Stealing cars ---------------------------------------------------------------------

  /** Pulls the driver out of a car and gives you the keys. */
  carjack(car) {
    const { world, k } = this;
    const { traffic, people } = world;
    const v = new Vehicle(world, car.shape === 'sport' ? 'supercar' : 'car', car.x, car.z, car.yaw, { color: car.color });
    v.stolen = true;
    world.vehicles.push(v);
    this.stolen.push(v);
    traffic.remove(car);
    if (!car.parked) {
      const driver = people.add('civilian', car.x + Math.cos(car.yaw) * 2.2, car.z - Math.sin(car.yaw) * 2.2, { state: 'flee', timer: 9 });
      if (driver) {
        driver.cx = Math.round(car.x / 92) * 92;
        driver.cz = Math.round(car.z / 92) * 92;
        driver.t = Math.random() * 4;
        driver.rate = 0.015;
      }
      this.addWanted(1, 'Carjacking reported');
    } else {
      k.sound.tone({ f: 700, d: 0.25, type: 'square', g: 0.05, slide: 300 });
      if (Math.random() < 0.3) this.addWanted(1, 'The car alarm got noticed');
    }
    // Old stolen cars get towed, so the island doesn't fill up.
    while (this.stolen.length > MAX_STOLEN) {
      const old = this.stolen.findIndex((x) => !x.driver);
      if (old < 0) break;
      const [gone] = this.stolen.splice(old, 1);
      world.vehicles.splice(world.vehicles.indexOf(gone), 1);
      gone.dispose();
    }
    return v;
  }

  // --- The police ------------------------------------------------------------------------

  addWanted(amount, why) {
    const before = this.wanted;
    this.wanted = Math.min(5, this.wanted + amount);
    this.heat = 0;
    if (this.wanted > before && why) this.world.hud.flash('Wanted', why);
    if (this.wanted > before) this.k.sound.tone({ f: 620, d: 0.32, type: 'square', g: 0.04, slide: 260 });
  }

  clearHeat() {
    this.wanted = 0;
    this.heat = 0;
    this.arrest = 0;
    for (const c of this.cops) {
      this.world.vehicles.splice(this.world.vehicles.indexOf(c.car), 1);
      c.car.dispose();
    }
    this.cops = [];
    for (const o of this.officers) this.world.people.remove(o);
    this.officers = [];
  }

  spawnCop() {
    const { world } = this;
    const { player, terrain } = world;
    const p = player.pos;
    // Come in along a road, out of sight of the player.
    const roads = [terrain.road('ring').pts, terrain.road('north').pts, terrain.road('east').pts, terrain.road('south').pts];
    let spot = null;
    for (let tries = 0; tries < 30 && !spot; tries++) {
      const pts = roads[Math.floor(Math.random() * roads.length)];
      const c = pts[Math.floor(Math.random() * pts.length)];
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (d > 140 && d < 340) spot = c;
    }
    if (!spot) {
      // In the city, the streets are the roads.
      const a = Math.random() * Math.PI * 2;
      const gx = (Math.round((p.x + Math.cos(a) * 190) / 92 - 0.5) + 0.5) * 92;
      const gz = (Math.round((p.z + Math.sin(a) * 190) / 92 - 0.5) + 0.5) * 92;
      spot = new THREE.Vector3(gx, 0, gz);
    }
    const car = new Vehicle(world, 'police', spot.x, spot.z, Math.atan2(spot.x - p.x, spot.z - p.z), { color: 0x101116 });
    car.isPolice = true;
    world.vehicles.push(car);
    this.cops.push({ car, officer: null, stuck: 0, lastX: spot.x, lastZ: spot.z, flash: 0 });
  }

  updatePolice(dt) {
    const { world, k } = this;
    const { player, people } = world;
    const p = player.pos;
    const wantedCars = this.wanted === 0 ? 0 : Math.min(4, Math.ceil(this.wanted * 0.8));
    if (this.cops.length < wantedCars && Math.random() < dt * 0.8) this.spawnCop();

    let closest = Infinity;
    for (const c of [...this.cops]) {
      const car = c.car;
      const dx = p.x - car.pos.x;
      const dz = p.z - car.pos.z;
      const d = Math.hypot(dx, dz);
      closest = Math.min(closest, d);

      const want = Math.atan2(-dx, -dz);
      const diff = ((want - car.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const onFoot = !player.vehicle;
      const stop = onFoot && d < 18;
      const controls = {
        steer: THREE.MathUtils.clamp(-diff * 2.4, -1, 1),
        gas: stop ? 0 : Math.abs(diff) > 2.3 ? 0.45 : 1,
        brake: stop ? 1 : 0,
        boost: false,
        handbrake: Math.abs(diff) > 1.1 && car.speed > 18,
      };
      car.update(dt, controls);
      car.group.visible = true;

      // Ramming the player hurts them.
      if (player.vehicle && d < 4.4 && car.speed > 8) {
        this.ramCool = (this.ramCool ?? 0) - dt;
        if (this.ramCool <= 0) {
          this.ramCool = 0.8;
          world.bump(player.vehicle, 0.5);
          const nx = dx / (d || 1);
          const nz = dz / (d || 1);
          player.vehicle.vel.x += nx * 7;
          player.vehicle.vel.z += nz * 7;
        }
      }

      // Stuck on a wall? Back up, and eventually come round another way.
      c.flash += dt;
      c.stuck = Math.hypot(car.pos.x - c.lastX, car.pos.z - c.lastZ) < 0.15 && !stop ? c.stuck + dt : 0;
      c.lastX = car.pos.x;
      c.lastZ = car.pos.z;
      if (c.stuck > 1.5) car.vel.addScaledVector(new THREE.Vector3(Math.sin(car.yaw), 0, Math.cos(car.yaw)), dt * 40);
      if (c.stuck > 6 || d > 700) {
        world.vehicles.splice(world.vehicles.indexOf(car), 1);
        car.dispose();
        this.cops.splice(this.cops.indexOf(c), 1);
        continue;
      }
      for (const [i, f] of (car.model.flashers ?? []).entries()) f.visible = Math.floor(c.flash * 5) % 2 === i;

      // Out of the car, on foot, when you are.
      if (stop && d < 18 && !c.officer && this.officers.length < 6) {
        const o = people.add('cop', car.pos.x + 2, car.pos.z + 2, { shirt: 0x1d2e52, pants: 0x151a2a });
        if (o) {
          c.officer = o;
          this.officers.push(o);
        }
      }
    }

    let touching = false;
    for (const o of this.officers) {
      if (o.state === 'down') continue;
      const dx = p.x - o.x;
      const dz = p.z - o.z;
      const d = Math.hypot(dx, dz);
      closest = Math.min(closest, d);
      if (d > 1.15) people.move(o, dx, dz, player.vehicle ? 2.5 : 4.9, dt);
      else {
        o.speed = 0;
        o.yaw = Math.atan2(-dx, -dz);
        if (!player.vehicle) touching = true;
      }
    }
    if (touching) {
      this.arrest += dt;
      if (this.arrest > 2.4) this.arrested();
    } else {
      this.arrest = Math.max(0, this.arrest - dt * 0.7);
    }

    // Keep out of range long enough, and they lose interest one star at a time.
    if (this.wanted > 0) {
      if (closest > CONTACT_RANGE) this.heat += dt;
      else this.heat = Math.max(0, this.heat - dt * 0.5);
      if (this.heat > STAR_COOLDOWN) {
        this.heat = 0;
        this.wanted -= 1;
        k.sound.play('gate');
        world.hud.flash('Cooling off', this.wanted ? `${this.wanted} stars left` : 'You got away with it');
        if (this.wanted === 0) {
          world.progress.grant(40, 0, 'Escaped the police');
          this.clearHeat();
        }
      }
    }

    // The siren carries, and gets louder as they close in.
    this.sirenTimer -= dt;
    if (this.cops.length && this.sirenTimer <= 0 && closest < 340) {
      this.sirenTimer = 0.42;
      this.sirenHigh = !this.sirenHigh;
      const level = Math.min(0.06, 7 / Math.max(60, closest));
      k.sound.tone({ f: this.sirenHigh ? 760 : 590, d: 0.4, type: 'sawtooth', g: level });
    }
  }

  arrested() {
    const { world } = this;
    const fine = Math.floor(this.k.save.coins * 0.2);
    this.k.save.addCoins(-fine);
    this.clearHeat();
    world.player.exitVehicle();
    world.player.spawn(STATION.x, STATION.z, 0);
    world.hud.banner('Arrested', `You paid a $${fine} fine and got out of the station.`);
    this.k.sound.play('fail');
  }

  // --- Every frame ------------------------------------------------------------------------

  update(dt) {
    const { world } = this;
    const { player, hud } = world;
    this.lastHurt += dt;
    if (this.lastHurt > 6 && this.health < 100) this.health = Math.min(100, this.health + dt * 9);
    this.updateFists(dt);
    this.updateThugs(dt);
    this.updateStores(dt, player.pos, hud);
    this.updatePolice(dt);
  }

  /** A punch for the player's body to animate. */
  get punching() {
    return this.punchAnim > 0;
  }
}
