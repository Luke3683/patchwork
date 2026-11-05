import * as THREE from 'three';
import { AIRPORT, PADS } from './terrain.js';

const SHARD_COUNT = 36;
const JOB_TIME_PER_METER = 1 / 24;
const v1 = new THREE.Vector3();

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** A column of light you can see from far away. */
function makeBeacon(k, x, y, z, color, height = 32) {
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color), transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, height, 18, 1, true).translate(0, height / 2, 0), mat);
  beam.position.set(x, y, z);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.14, 6, 28).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2), toneMapped: false }));
  ring.position.set(x, y + 0.4, z);
  k.root.add(beam, ring);
  return {
    beam,
    ring,
    setVisible(on) {
      beam.visible = on;
      ring.visible = on;
    },
  };
}

/** Races, courier jobs, shards to find, places to discover and stunts. */
export class Activities {
  constructor(world) {
    this.world = world;
    this.k = world.k;
    this.race = null;
    this.job = null;
    this.jobStreak = 0;
    this.buildShards();
    this.buildZones();
    this.buildRaces();
    this.buildJobs();
    this.buildGate();
  }

  // --- Shards: hidden all over the island, on rooftops, peaks and far islets --------

  buildShards() {
    const { world, k } = this;
    const rand = seeded(424242);
    const spots = [];
    const roofs = world.city.rooftops;
    for (let i = 0; i < 10; i++) {
      const [x, y, z] = roofs[Math.floor(rand() * roofs.length)];
      spots.push([x, y + 2.2, z]);
    }
    const special = [
      [PADS.summit.x, PADS.summit.h + 2.5, PADS.summit.z],
      [PADS.isletA.x, PADS.isletA.h + 2, PADS.isletA.z],
      [PADS.isletB.x, PADS.isletB.h + 2, PADS.isletB.z],
      [PADS.pier.x, 8.2, PADS.pier.z - 350],
      [AIRPORT.x + 360, AIRPORT.h + 2, AIRPORT.z],
      [PADS.lighthouse.x, PADS.lighthouse.h + 32, PADS.lighthouse.z],
      [0, 8 + 46, 0],
      [PADS.grove.x, PADS.grove.h + 2, PADS.grove.z],
    ];
    spots.push(...special);
    while (spots.length < SHARD_COUNT) {
      const a = rand() * Math.PI * 2;
      const r = 300 + rand() * 1250;
      const x = Math.sin(a) * r;
      const z = Math.cos(a) * r;
      const h = world.terrain.height(x, z);
      if (h > 2) spots.push([x, h + 2, z]);
    }
    const geo = new THREE.OctahedronGeometry(0.75, 0);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x4dffd2).multiplyScalar(1.9), toneMapped: false });
    this.shards = spots.map((p, i) => {
      const taken = world.progress.data.shards.includes(i);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(p[0], p[1], p[2]);
      mesh.visible = !taken;
      k.root.add(mesh);
      return { mesh, id: i, taken };
    });
  }

  // --- Places worth finding ---------------------------------------------------------

  buildZones() {
    this.zones = [
      { id: 'downtown', name: 'Downtown Meridian', x: 0, z: 0, r: 300 },
      { id: 'airport', name: 'Meridian Airfield', x: AIRPORT.x, z: AIRPORT.z, r: 300 },
      { id: 'park', name: 'Stunt Park', x: PADS.park.x, z: PADS.park.z, r: 170 },
      { id: 'pier', name: 'Sunset Pier', x: PADS.pier.x, z: PADS.pier.z, r: 220 },
      { id: 'harbor', name: 'Old Harbor', x: PADS.harbor.x, z: PADS.harbor.z, r: 190 },
      { id: 'lighthouse', name: 'Lighthouse Cape', x: PADS.lighthouse.x, z: PADS.lighthouse.z, r: 110 },
      { id: 'grove', name: 'Cabin Grove', x: PADS.grove.x, z: PADS.grove.z, r: 130 },
      { id: 'summit', name: 'Mount Halden Summit', x: PADS.summit.x, z: PADS.summit.z, r: 90 },
      { id: 'isletA', name: 'Far East Islet', x: PADS.isletA.x, z: PADS.isletA.z, r: 180 },
      { id: 'isletB', name: 'Castaway Islet', x: PADS.isletB.x, z: PADS.isletB.z, r: 170 },
    ];
  }

  // --- Races -------------------------------------------------------------------------

  buildRaces() {
    const { world, k } = this;
    const { terrain } = world;
    const ring = terrain.road('ring').pts;
    const every = (pts, n) => Array.from({ length: n }, (_, i) => pts[Math.floor((i / n) * pts.length)].clone());
    const onGround = (list) => list.map(([x, z]) => new THREE.Vector3(x, world.groundAt(x, z, 1e5), z));
    const start = ring[0];
    this.races = [
      {
        id: 'highway', name: 'Island Circuit', kind: 'land', note: 'One lap of the highway. Bring something fast.',
        at: [start.x, start.z], gates: [...every(ring, 18).slice(1), start.clone()], radius: 16,
      },
      {
        id: 'downtown', name: 'Downtown Dash', kind: 'land', note: 'Tight corners through the city grid.',
        at: [46, 230],
        gates: onGround([[46, 46], [-138, 46], [-138, -138], [138, -138], [138, 46], [230, 46], [230, 230], [46, 230]]), radius: 12,
      },
      {
        id: 'sky', name: 'Sky Gates', kind: 'air', note: 'Fly through every gate. Needs a plane or helicopter.',
        at: [-200, 662],
        gates: [
          [200, 120, 660], [600, 140, 300], [900, 200, -100], [1200, 340, -350], [800, 180, -750],
          [200, 90, -900], [-300, 130, -500], [-120, 240, -60], [-700, 110, 300], [-500, 60, 660],
        ].map(([x, y, z]) => new THREE.Vector3(x, y, z)),
        radius: 26,
      },
      {
        id: 'boat', name: 'Harbor Run', kind: 'boat', note: 'Round the buoys. Boats only.',
        at: [-1720, -240],
        gates: [[-1900, -60], [-2000, -500], [-1720, -760], [-1500, -640], [-1700, -240]].map(([x, z]) => new THREE.Vector3(x, 0.4, z)), radius: 18,
      },
    ];
    const boatRace = this.races.find((race) => race.kind === 'boat');
    boatRace.at = world.deepWater(boatRace.at[0], boatRace.at[1]);
    boatRace.gates = boatRace.gates.map((g) => {
      const [x, z] = world.deepWater(g.x, g.z);
      return new THREE.Vector3(x, 0.4, z);
    });
    for (const race of this.races) {
      const [x, z] = race.at;
      const y = race.kind === 'boat' ? 0 : world.groundAt(x, z, 1e5);
      race.y = y;
      race.beacon = makeBeacon(k, x, y, z, 0xff7a2e);
    }
  }

  distanceOf(race) {
    let total = 0;
    let from = new THREE.Vector3(race.at[0], race.y, race.at[1]);
    for (const g of race.gates) {
      total += from.distanceTo(g);
      from = g;
    }
    return total;
  }

  fits(race) {
    const v = this.world.player.vehicle;
    if (!v) return false;
    const cls = v.def.cls;
    if (race.kind === 'land') return cls === 'land';
    if (race.kind === 'air') return cls === 'plane' || cls === 'heli';
    return cls === 'boat';
  }

  startRace(race) {
    this.cancelJob();
    this.race = { def: race, index: 0, time: 0 };
    race.gates.length && this.showGate(race.gates[0], race.radius);
    this.k.sound.play('portal');
    this.world.hud.banner(race.name, `${race.gates.length} gates. Go!`);
  }

  finishRace() {
    const { def, time } = this.race;
    const dist = this.distanceOf(def);
    const speed = def.kind === 'air' ? 62 : def.kind === 'boat' ? 22 : 34;
    const gold = dist / speed;
    const silver = gold * 1.3;
    const medal = time <= gold ? 'Gold' : time <= silver ? 'Silver' : 'Bronze';
    const coins = Math.round((dist / 90) * (medal === 'Gold' ? 1.6 : medal === 'Silver' ? 1.1 : 0.7) + 12);
    const xp = Math.round((dist / 45) * (medal === 'Gold' ? 1.5 : medal === 'Silver' ? 1.1 : 0.8) + 20);
    const { best } = this.world.progress.data;
    const record = !best[def.id] || time < best[def.id];
    if (record) best[def.id] = time;
    def.rest = true;
    this.race = null;
    this.hideGate();
    this.k.sound.play('patch');
    this.world.progress.grant(xp, coins, `${medal}: ${def.name} in ${time.toFixed(1)}s${record ? ', new record' : ''}`);
  }

  // --- Courier jobs: a new one is always waiting -------------------------------------

  buildJobs() {
    const { world, k } = this;
    this.hq = { x: 46, z: -46 };
    const y = world.groundAt(this.hq.x, this.hq.z, 1e5);
    this.hq.y = y;
    this.hq.beacon = makeBeacon(k, this.hq.x, y, this.hq.z, 0x4dffd2);
    this.dropSpots = [
      [PADS.park.x, PADS.park.z], [PADS.pier.x, PADS.pier.z + 40], [PADS.harbor.x + 60, PADS.harbor.z - 40],
      [PADS.grove.x, PADS.grove.z], [PADS.lighthouse.x + 22, PADS.lighthouse.z + 22], [AIRPORT.x + 140, AIRPORT.z + 58],
      [-230, -230], [230, 138], [-46, 322], [322, -46], [-322, 138], [138, -322], [PADS.summit.x, PADS.summit.z + 16],
    ].map(([x, z]) => ({ x, z, y: world.groundAt(x, z, 1e5) }));
    this.dropBeacon = makeBeacon(k, 0, 0, 0, 0x4dffd2, 140);
    this.dropBeacon.setVisible(false);
  }

  startJob() {
    const { pos } = this.world.player;
    const options = this.dropSpots.filter((s) => Math.hypot(s.x - pos.x, s.z - pos.z) > 180);
    const spot = options[Math.floor(Math.random() * options.length)];
    const dist = Math.hypot(spot.x - pos.x, spot.z - pos.z);
    // Longer routes and longer streaks pay better.
    this.job = { spot, dist, time: Math.max(35, dist * JOB_TIME_PER_METER + 16), total: 0 };
    this.job.total = this.job.time;
    this.dropBeacon.beam.position.set(spot.x, spot.y, spot.z);
    this.dropBeacon.ring.position.set(spot.x, spot.y + 0.4, spot.z);
    this.dropBeacon.setVisible(true);
    this.k.sound.play('portal');
    this.world.hud.banner('Courier job', `Deliver within ${Math.round(this.job.time)} seconds. Follow the green light.`);
  }

  cancelJob() {
    this.job = null;
    this.jobStreak = 0;
    this.dropBeacon.setVisible(false);
  }

  finishJob() {
    const { dist } = this.job;
    this.jobStreak += 1;
    const multiplier = 1 + Math.min(4, this.jobStreak - 1) * 0.25;
    const coins = Math.round((12 + dist / 28) * multiplier);
    const xp = Math.round((14 + dist / 20) * multiplier);
    this.world.progress.data.jobsDone += 1;
    this.k.sound.play('patch');
    this.world.progress.grant(xp, coins, `Delivered! Streak x${this.jobStreak}`);
    // Keep the run going: the next job starts from here.
    this.job = null;
    this.dropBeacon.setVisible(false);
    this.startJob();
  }

  // --- The gate you fly or drive through during a race -------------------------------

  buildGate() {
    this.gate = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.05, 8, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd23f).multiplyScalar(2.4), toneMapped: false, fog: false }),
    );
    this.gate.visible = false;
    this.k.root.add(this.gate);
    this.gateBeam = makeBeacon(this.k, 0, 0, 0, 0xffd23f, 200);
    this.gateBeam.setVisible(false);
  }

  showGate(p, radius) {
    this.gate.position.copy(p);
    this.gate.position.y += this.race?.def.kind === 'air' ? 0 : radius * 0.55;
    this.gate.scale.setScalar(radius * 0.86);
    this.gate.visible = true;
    this.gateBeam.beam.position.set(p.x, this.world.terrain.height(p.x, p.z), p.z);
    this.gateBeam.ring.position.set(p.x, -500, p.z);
    this.gateBeam.beam.visible = true;
  }

  hideGate() {
    this.gate.visible = false;
    this.gateBeam.setVisible(false);
  }

  // --- Every frame ------------------------------------------------------------------

  update(dt, t) {
    const { world, k } = this;
    const { player, progress, hud } = world;
    const p = player.pos;

    for (const shard of this.shards) {
      if (shard.taken) continue;
      const d = shard.mesh.position.distanceTo(p);
      if (d < 900) {
        shard.mesh.visible = true;
        shard.mesh.rotation.y = t * 1.6;
        shard.mesh.position.y += Math.sin(t * 2 + shard.id) * 0.004;
      } else {
        shard.mesh.visible = false;
      }
      if (d < (player.vehicle ? player.vehicle.model.radius + 3.2 : 2.6) + 0.5) {
        shard.taken = true;
        shard.mesh.visible = false;
        progress.data.shards.push(shard.id);
        k.sound.play('pickup');
        k.burst(shard.mesh.position, 0x4dffd2, 18, 5);
        progress.grant(30, 20, `Shard ${progress.data.shards.length} of ${this.shards.length}`);
        if (progress.data.shards.length === this.shards.length) progress.grant(500, 400, 'Every shard found');
      }
    }

    for (const zone of this.zones) {
      if (!progress.data.zones.includes(zone.id) && Math.hypot(p.x - zone.x, p.z - zone.z) < zone.r) {
        progress.data.zones.push(zone.id);
        k.sound.play('levelup');
        hud.banner('Discovered', zone.name);
        progress.grant(zone.id === 'summit' || zone.id.startsWith('islet') ? 120 : 60, 25, `Found ${zone.name}`);
      }
    }

    if (this.race) {
      const r = this.race;
      r.time += dt;
      const gate = r.def.gates[r.index];
      const target = v1.copy(gate);
      if (r.def.kind !== 'air') target.y = p.y;
      if (target.distanceTo(p) < r.def.radius) {
        r.index += 1;
        k.sound.play('gate');
        player.vehicle && k.input.primary.pulse(0.6, 60);
        if (r.index >= r.def.gates.length) {
          this.finishRace();
        } else {
          this.showGate(r.def.gates[r.index], r.def.radius);
        }
      } else if (!player.vehicle) {
        hud.banner('Race over', 'You left your vehicle.');
        this.race = null;
        this.hideGate();
      }
    } else {
      for (const race of this.races) {
        const near = Math.hypot(p.x - race.at[0], p.z - race.at[1]) < 9 && Math.abs(p.y - race.y) < 12;
        race.beacon.setVisible(!this.job);
        if (!near) race.rest = false;
        if (near && !this.job && !race.rest && this.fits(race)) {
          this.startRace(race);
          break;
        }
        if (near && !this.job && !player.vehicle && !race.told) {
          race.told = true;
          hud.flash(race.name, race.note);
        } else if (!near) {
          race.told = false;
        }
      }
    }

    if (this.job) {
      const j = this.job;
      j.time -= dt;
      if (Math.hypot(p.x - j.spot.x, p.z - j.spot.z) < 9 && Math.abs(p.y - j.spot.y) < 14) {
        this.finishJob();
      } else if (j.time <= 0) {
        k.sound.play('fail');
        hud.banner('Too slow', `Your streak of ${this.jobStreak} is over. Back to Courier HQ for more.`);
        this.cancelJob();
      }
      this.hq.beacon.setVisible(false);
    } else {
      this.hq.beacon.setVisible(!this.race);
      if (!this.race && Math.hypot(p.x - this.hq.x, p.z - this.hq.z) < 6 && Math.abs(p.y - this.hq.y) < 8) {
        if (!this.hqCooldown) this.startJob();
        this.hqCooldown = true;
      } else {
        this.hqCooldown = false;
      }
    }
  }

  /** Air time in a land vehicle earns a stunt bonus. */
  onAirTime(seconds) {
    const coins = Math.round(seconds * 6);
    const xp = Math.round(seconds * 12);
    this.world.progress.grant(xp, coins, `Stunt: ${seconds.toFixed(1)}s of air`);
  }

  /** What the HUD should list as the current goal. */
  status() {
    if (this.race) {
      const r = this.race;
      return { title: r.def.name, line: `Gate ${r.index + 1} of ${r.def.gates.length}`, timer: r.time, target: r.def.gates[r.index] };
    }
    if (this.job) return { title: `Courier streak x${this.jobStreak + 1}`, line: 'Follow the green light', timer: this.job.time, target: this.job.spot, urgent: this.job.time < 10 };
    return null;
  }
}
