import * as THREE from 'three';
import { DynamicSky } from '../../engine/sky.js';
import { Panel, DISPLAY, BODY, makeCard } from '../../engine/ui.js';
import { disposeTree, keepOnTop } from '../../engine/kit.js';
import { Terrain, makeWater, PADS, AIRPORT, CITY_HEIGHT, HALF } from './terrain.js';
import { Solids, buildCity, roadTexture } from './city.js';
import { buildFoliage, buildGrass } from './foliage.js';
import { People } from './npc.js';
import { OUTFITS, OUTFIT_LABELS } from './crowd.js';
import { Crime } from './crime.js';
import { Vehicle, TYPES } from './vehicles.js';
import { trafficCarGeometry } from './models.js';
import { Player } from './player.js';
import { Progress, UPGRADES, VEHICLE_UNLOCKS, PAINTS, upgradeCost } from './progress.js';
import { Activities } from './activities.js';
import { Hud } from './hud.js';

let cachedTerrain = null;
const VIEW_DESKTOP = 1500;
const VIEW_XR = 620;
const VEHICLE_SHOW = 240;
const TIMES = ['cycle', 'sunrise', 'noon', 'sunset', 'night'];
const TIME_VALUES = { sunrise: 0.27, noon: 0.5, sunset: 0.735, night: 0.95 };
const e1 = new THREE.Euler(0, 0, 0, 'YXZ');

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Traffic follows roads around the island. It's all one mesh, so it's cheap. */
function buildTraffic(k, terrain, parkedSpots, solids) {
  const geo = trafficCarGeometry({ low: !k.game.look.high, traffic: true });
  const moving = k.game.look.high ? 80 : 24;
  const block = (x0, z0, x1, z1) => {
    const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1], [x0, z0]];
    const pts = [];
    for (let c = 0; c < 4; c++) {
      const [ax, az] = corners[c];
      const [bx, bz] = corners[c + 1];
      const n = Math.round(Math.hypot(bx - ax, bz - az) / 10);
      for (let i = 0; i < n; i++) pts.push(new THREE.Vector3(ax + ((bx - ax) * i) / n, 0, az + ((bz - az) * i) / n));
    }
    return { pts, closed: true, offset: 3.6 };
  };
  const cityPaths = [block(-230, -230, 230, 230), block(-138, -138, 138, 138), block(-322, -46, 322, 138), block(-46, -322, 138, 322)];
  const paths = [
    { pts: terrain.road('ring').pts, closed: true, offset: 4.4 },
    { pts: terrain.road('ring').pts.slice().reverse(), closed: true, offset: 4.4 },
    { pts: terrain.road('north').pts, closed: false, offset: 3.8 },
    { pts: terrain.road('east').pts, closed: false, offset: 3.8 },
    { pts: terrain.road('south').pts, closed: false, offset: 3.8 },
  ];
  const palette = [0xff3b2e, 0x0f8fd6, 0xfff4e3, 0x14171c, 0xc4122a, 0xa9b4c2, 0xffc21a, 0x0fb5a6, 0xffffff, 0x1d7a46, 0xff5ca8, 0x123a86];
  const cars = [];
  for (let i = 0; i < moving; i++) {
    cars.push({
      path: i % 2 ? cityPaths[i % cityPaths.length] : paths[i % 4 === 0 ? 1 : i % 3 === 0 ? 2 + (i % 3) : 0],
      t: Math.random(),
      speed: 14 + Math.random() * 11,
      color: palette[i % palette.length],
      x: 0, y: 0, z: 0, yaw: 0, dir: 1, brake: 0, gone: 0,
    });
  }
  const parkedList = (parkedSpots ?? []).slice(0, k.game.look.high ? 150 : 24);
  parkedList.forEach((p, i) => {
    cars.push({
      parked: true, x: p.x, z: p.z, yaw: p.yaw, y: CITY_HEIGHT + 0.22, color: palette[(i * 5) % palette.length], gone: 0, brake: 0, spot: p,
    });
  });
  const mat = k.game.look.high
    ? new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.36 })
    : new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = k.instanced(geo, mat, cars.length, (d, i) => cars[i].color);
  mesh.frustumCulled = false;
  mesh.castShadow = true;
  const dummy = new THREE.Object3D();
  const paint = new THREE.Color();
  const update = (dt, focus) => {
    let drawn = 0;
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      if (c.gone > 0) {
        c.gone -= dt;
        // It only reappears away from the player, so nothing pops in nearby.
        if (c.gone <= 0 && Math.hypot(c.x - focus.x, c.z - focus.z) < 180) c.gone = 8;
        continue;
      }
      if (!c.parked) {
        const { pts, closed } = c.path;
        const n = pts.length;
        c.t += ((c.speed * (1 - (c.brake ?? 0))) / (10 * n)) * dt * c.dir;
        if (closed) c.t = (c.t + 1) % 1;
        else if (c.t > 1 || c.t < 0) {
          c.dir *= -1;
          c.t = Math.min(1, Math.max(0, c.t));
        }
        const fi = c.t * (closed ? n : n - 1);
        const i0 = Math.floor(fi) % n;
        const i1 = closed ? (i0 + 1) % n : Math.min(n - 1, i0 + 1);
        const f = fi - Math.floor(fi);
        const a = pts[i0];
        const b = pts[i1];
        const dx = (b.x - a.x) * c.dir;
        const dz = (b.z - a.z) * c.dir;
        const len = Math.hypot(dx, dz) || 1;
        c.x = a.x + (b.x - a.x) * f + (dz / len) * c.path.offset;
        c.z = a.z + (b.z - a.z) * f - (dx / len) * c.path.offset;
        c.y = terrain.height(c.x, c.z) + 0.22;
        c.yaw = Math.atan2(-dx, -dz);
      }
      // Only nearby cars are drawn at all. The rest keep driving unseen.
      if (Math.hypot(c.x - focus.x, c.z - focus.z) > (c.parked ? 320 : 620)) continue;
      dummy.position.set(c.x, c.y, c.z);
      dummy.rotation.set(0, c.yaw, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(drawn, dummy.matrix);
      mesh.setColorAt(drawn, paint.set(c.color));
      drawn += 1;
    }
    mesh.count = drawn;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };
  /** A stolen car leaves the street, and a replacement turns up later. */
  const remove = (c) => {
    c.gone = 60;
    if (c.parked) {
      const box = solids.all.find((b) => Math.abs((b.minX + b.maxX) / 2 - c.x) < 0.1 && Math.abs((b.minZ + b.maxZ) / 2 - c.z) < 0.1);
      if (box) box.top = -1000;
    }
  };
  return { update, cars, remove };
}

/** Traffic slows for you, and bumping into it knocks you back. */
function trafficCollisions(world, dt) {
  const { player, traffic } = world;
  const p = player.pos;
  const v = player.vehicle;
  world.bumpCooldown = Math.max(0, (world.bumpCooldown ?? 0) - dt);
  for (const c of traffic.cars) {
    if (c.gone > 0) continue;
    const d = Math.hypot(c.x - p.x, c.z - p.z);
    c.brake = Math.max(0, (c.brake ?? 0) - dt * 2);
    if (d < 14) c.brake = 0.9;
    if (d > 3.4 || Math.abs(c.y - p.y) > 3 || !v || v.def.cls === 'plane' || v.def.cls === 'heli') continue;
    const nx = (p.x - c.x) / (d || 1);
    const nz = (p.z - c.z) / (d || 1);
    v.pos.x += nx * (3.4 - d);
    v.pos.z += nz * (3.4 - d);
    const into = v.vel.x * nx + v.vel.z * nz;
    if (into < 0) {
      v.vel.x -= nx * into * 1.3;
      v.vel.z -= nz * into * 1.3;
    }
    if (world.bumpCooldown <= 0) {
      world.bumpCooldown = 0.5;
      world.bump(v, Math.min(1, Math.abs(into) / 24));
    }
  }
}

class World {
  constructor(k) {
    this.k = k;
    this.time = 0;
    this.paused = false;
    this.menu = null;
    this.solids = new Solids();
    if (!cachedTerrain) cachedTerrain = new Terrain();
    this.terrain = cachedTerrain;
    this.progress = new Progress(this);
    this.view = k.game.look.high ? VIEW_DESKTOP : VIEW_XR;
    const { camera } = k;
    const oldNear = camera.near;
    const oldFar = camera.far;
    camera.near = k.game.look.high ? 0.35 : 0.1;
    camera.far = 3000;
    camera.updateProjectionMatrix();
    k.onDispose(() => {
      camera.near = oldNear;
      camera.far = oldFar;
      camera.fov = k.prefs.comfort.fov;
      camera.updateProjectionMatrix();
    });

    this.sky = new DynamicSky(k, { time: 0.64, fogNear: this.view * 0.32, fogFar: this.view });
    this.applyTimePref();
    this.water = makeWater(this.terrain, this.sky);
    k.root.add(this.water);

    this.chunks = this.terrain.buildMeshes(k);
    const roadLines = new THREE.MeshLambertMaterial({ map: roadTexture(false), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    this.terrain.buildRoads(k, roadLines);
    this.city = buildCity(k, this.terrain, this.solids);
    this.nature = buildFoliage(k, this.terrain, this.city.palms);
    this.grass = k.game.look.high ? buildGrass(k, this.terrain) : null;
    this.traffic = buildTraffic(k, this.terrain, this.city.parked, this.solids);
    this.people = new People(this);
    for (let i = 0; i < (k.game.look.high ? 90 : 24); i++) {
      const [cx, cz] = this.city.sidewalks[Math.floor(Math.random() * this.city.sidewalks.length)];
      this.people.addWalker(cx, cz);
    }

    this.vehicles = [];
    this.spawnVehicles();
    this.hud = new Hud(this);
    this.activities = new Activities(this);
    this.player = new Player(this);
    this.crime = new Crime(this);

    this.flames = this.buildFlames();
    this.ghosts = new Map();
    this.setupNetwork();

    // The Crossroads portal, in the shadow of the Spire.
    const portal = k.portal({
      tint: 0xffd23f,
      accent: '#ffd23f',
      title: 'The Crossroads',
      subtitle: '8 worlds to play, and the Avatar Studio',
      position: new THREE.Vector3(27, CITY_HEIGHT + 0.6, 16),
      radius: 2,
      onEnter: () => k.game.enter('hub'),
    });
    portal.group.lookAt(0, CITY_HEIGHT + 0.6, 42);
    k.proximityPos = () => this.player.pos.clone().setY(this.player.pos.y + 1.6);

    k.input.free = true;
    k.setMove(false);

    this.player.spawn(0, 40, Math.PI);
    this.attract = !k.game.started;
    this.announce = true;
  }

  get upgrades() {
    return this.progress.upgrades;
  }

  /** The ground under a spot, counting roofs and ramps within reach of y. */
  groundAt(x, z, y) {
    return Math.max(this.terrain.height(x, z), this.solids.groundAt(x, z, y));
  }

  /** Walks away from the island center until the water is deep enough for a boat. */
  deepWater(x, z) {
    const len = Math.hypot(x, z) || 1;
    let px = x;
    let pz = z;
    for (let i = 0; i < 500 && this.terrain.height(px, pz) > -3; i++) {
      px += (x / len) * 8;
      pz += (z / len) * 8;
    }
    return [px, pz];
  }

  submerged(v) {
    return v.pos.y < -1.4 && this.terrain.height(v.pos.x, v.pos.z) < -1.4;
  }

  spawnVehicles() {
    const add = (type, x0, z0, yaw, opts) => {
      // Boats always start in water deep enough to move.
      const [x, z] = type === 'boat' ? this.deepWater(x0, z0) : [x0, z0];
      const v = new Vehicle(this, type, x, z, yaw, opts);
      const paintHex = this.progress.data.paints[type];
      if (Number.isInteger(paintHex)) v.setColor(paintHex);
      this.vehicles.push(v);
      return v;
    };
    // Right outside the spawn point, because nobody should have to wait to ride something.
    add('bike', 11, 46, Math.PI / 2);
    add('car', -11, 46, -Math.PI / 2, { color: 0x2e86ab });
    add('bike', 46, 10, 0, { color: 0x35e0ff });
    add('car', -46, -14, Math.PI, { color: 0xc9402f });
    add('car', 138, 30, 0, { color: 0xf2ece0 });
    add('bike', -138, 60, 0, { color: 0x7cff6b });
    add('car', 230, -30, Math.PI, { color: 0x7d4ea8 });
    add('car', -230, 70, 0, { color: 0x23252c });
    add('bike', 46, -230, 0, { color: 0xffd23f });
    add('supercar', 18, 70, Math.PI / 2);
    // Airfield.
    add('plane', -790, 660, -Math.PI / 2, { y: AIRPORT.h + 0.25 });
    add('plane', -300, 715, Math.PI / 2, { y: AIRPORT.h + 0.2, color: 0xe4572e });
    add('jet', -380, 715, Math.PI / 2, { y: AIRPORT.h + 0.2 });
    // Rooftop-free helipads at the airfield and the harbor.
    add('heli', -230, 715, Math.PI / 2, { y: AIRPORT.h + 0.2 });
    add('heli', PADS.harbor.x + 50, PADS.harbor.z - 60, 0);
    // Boats at the docks.
    add('boat', PADS.harbor.x - 180, PADS.harbor.z - 32, Math.PI / 2);
    add('boat', PADS.harbor.x - 110, PADS.harbor.z + 32, Math.PI / 2, { color: 0xffd23f });
    add('boat', PADS.pier.x + 40, PADS.pier.z - 320, 0, { color: 0xe4572e });
    // Stunt park, the mountain road and the far side of the island.
    add('bike', PADS.park.x - 130, PADS.park.z - 90, 0.5 + Math.PI / 2 + Math.PI, { color: 0xff3d8b });
    add('car', PADS.park.x, PADS.park.z, 0, { color: 0xff7a2e });
    add('supercar', PADS.park.x + 30, PADS.park.z + 20, 0, { color: 0xc9402f });
    add('bike', PADS.pier.x - 20, PADS.pier.z + 30, 0, { color: 0xf2ece0 });
    add('car', PADS.grove.x + 10, PADS.grove.z, 0, { color: 0x6b4a30 });
    add('car', PADS.harbor.x + 10, PADS.harbor.z + 10, 0, { color: 0x8c7a3a });
    const ring = this.terrain.road('ring').pts;
    [60, 180, 300, 500].forEach((i, n) => {
      const p = ring[i];
      const q = ring[(i + 2) % ring.length];
      add(n % 2 ? 'bike' : 'car', p.x + 11, p.z + 11, Math.atan2(-(q.x - p.x), -(q.z - p.z)));
    });
  }

  buildFlames() {
    const count = 60;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3).fill(-1000);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      color: new THREE.Color(0xffa23a).multiplyScalar(2), size: 0.5, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false,
    }));
    pts.frustumCulled = false;
    this.k.root.add(pts);
    return { pts, pos, next: 0, life: new Float32Array(count) };
  }

  flame(p, yaw) {
    const f = this.flames;
    for (let n = 0; n < 2; n++) {
      const i = f.next;
      f.next = (f.next + 1) % f.life.length;
      f.life[i] = 0.5;
      f.pos[i * 3] = p.x + Math.sin(yaw) * 0.28 + (Math.random() - 0.5) * 0.2;
      f.pos[i * 3 + 1] = p.y + 0.7;
      f.pos[i * 3 + 2] = p.z + Math.cos(yaw) * 0.28 + (Math.random() - 0.5) * 0.2;
    }
  }

  // --- Things that happen ----------------------------------------------------------

  bump(v, amount) {
    if (!v.driver) return;
    this.player.shake = Math.max(this.player.shake, amount);
    this.k.sound.play(amount > 0.45 ? 'crash' : 'block');
    this.k.input.primary.pulse(amount, 80);
  }

  onAirTime(v, seconds) {
    if (v.def.cls === 'land') this.activities.onAirTime(seconds);
  }

  onCrash(v) {
    this.k.sound.play('crash');
    this.k.burst(v.pos, 0xff9a4d, 40, 11);
    this.player.shake = 1;
    this.hud.banner('Crashed', 'You walked away from it. Your plane is back at the airfield.');
    this.player.exitVehicle();
    v.respawn();
    v.flightSpeed = 0;
  }

  onSink(v) {
    if (!v.driver) {
      v.respawn();
      return;
    }
    this.hud.banner('Splash', 'The vehicle sank. You swam for it.');
    this.k.sound.play('miss');
    this.player.exitVehicle();
    v.respawn();
    v.flightSpeed = 0;
  }

  onEnterVehicle() {}

  onExitVehicle() {}

  onLevelUp(level) {
    const { k } = this;
    k.sound.play('levelup');
    k.burst(this.player.pos.clone().setY(this.player.pos.y + 1.5), 0xffd23f, 70, 8);
    const unlocks = Object.values(VEHICLE_UNLOCKS).filter((u) => u.level === level).map((u) => u.name);
    const jet = UPGRADES.jetpack.level === level ? ['Jetpack'] : [];
    const news = [...unlocks, ...jet];
    this.hud.banner(`Level ${level}`, news.length ? `Now for sale: ${news.join(', ')}. Press U.` : 'Keep going.');
  }

  applyTimePref() {
    const pref = this.progress.data.time;
    this.sky.frozen = pref !== 'cycle';
    if (pref !== 'cycle') this.sky.time = TIME_VALUES[pref] ?? 0.655;
  }

  // --- Menu: upgrades, vehicles, travel ---------------------------------------------

  openMenu(tab = 'Upgrades') {
    const { k, progress } = this;
    this.closeMenu();
    this.paused = true;
    this.menuTab = tab;
    k.input.cursor = true;
    k.input.lasers = true;
    k.input.pitch = 0;
    document.exitPointerLock?.();
    this.player.vehicle?.update(0, null);

    const group = new THREE.Group();
    const targets = [];
    const button = (label, onSelect, x, y, opts) => {
      const b = k.button(label, onSelect, opts);
      b.position.set(x, y, 0.01);
      group.add(b);
      targets.push(b);
      return b;
    };
    const row = (title, note, right, y) => {
      const p = new Panel({ width: 2.18, height: 0.24, ppm: 320 });
      p.paint((g, W, H) => {
        g.fillStyle = 'rgba(7,22,31,0.95)';
        g.beginPath();
        g.roundRect(0, 0, W, H, 10);
        g.fill();
        g.textBaseline = 'middle';
        g.fillStyle = '#f4efe2';
        g.font = `${H * 0.34}px ${DISPLAY}`;
        g.fillText(title, 16, H * 0.34, W * 0.5);
        g.fillStyle = '#a9c0c7';
        g.font = `${H * 0.26}px ${BODY}`;
        g.fillText(note, 16, H * 0.72, W * 0.76);
        g.fillStyle = '#ff5c4d';
        g.font = `700 ${H * 0.3}px ${BODY}`;
        g.textAlign = 'right';
        g.fillText(right, W - 16, H * 0.34);
      });
      p.position.set(-0.36, y, 0);
      group.add(p);
    };

    const head = makeCard({
      title: `Level ${progress.level}`,
      body: `${this.hud.xpText()}   ·   ${progress.coins} coins   ·   ${progress.data.shards.length}/${this.activities.shards.length} shards   ·   ${progress.data.zones.length}/${this.activities.zones.length} places`,
      width: 2.9,
      accent: '#ff5c4d',
    });
    head.position.set(0, 1.28, 0);
    group.add(head);
    ['Upgrades', 'Vehicles', 'Travel', 'World'].forEach((name, i) => {
      button(name, () => this.openMenu(name), -1.09 + i * 0.73, 0.86, { accent: name === tab ? '#ff5c4d' : '#a9c0c7', width: 0.68 });
    });
    button('Close', () => this.closeMenu(), 0, -1.44, { accent: '#f4efe2', width: 0.9 });

    let y = 0.58;
    if (tab === 'Upgrades') {
      for (const [id, def] of Object.entries(UPGRADES)) {
        const check = progress.canBuyUpgrade(id);
        const lv = progress.upgrades[id];
        row(def.name, def.note, `${lv} / ${def.max}`, y);
        button(lv >= def.max ? 'Max' : `${upgradeCost(id, lv)}`, () => {
          if (progress.buyUpgrade(id)) k.sound.play('patch');
          else {
            k.sound.play('miss');
            this.hud.flash(def.name, check.why);
          }
          this.openMenu('Upgrades');
        }, 1.1, y, { accent: check.ok ? '#7cff6b' : '#8a8598', width: 0.56 });
        y -= 0.28;
      }
    } else if (tab === 'Vehicles') {
      for (const [type, def] of Object.entries(VEHICLE_UNLOCKS)) {
        const check = progress.canBuyVehicle(type);
        const owned = progress.owns(type);
        row(def.name, `Unlocks at level ${def.level}. Yours everywhere on the island.`, owned ? 'Owned' : check.why, y);
        button(owned ? 'Owned' : `${def.cost}`, () => {
          if (progress.buyVehicle(type)) k.sound.play('patch');
          else k.sound.play('miss');
          this.openMenu('Vehicles');
        }, 1.1, y, { accent: owned ? '#f4efe2' : check.ok ? '#7cff6b' : '#8a8598', width: 0.56 });
        y -= 0.28;
      }
      const v = this.player.vehicle ?? this.player.nearby;
      if (v) {
        row(`Paint: ${v.def.label}`, 'Respray whatever you are in or standing next to. Free.', '', y);
        y -= 0.3;
        PAINTS.forEach((hex, i) => {
          const swatch = button(' ', () => {
            v.setColor(hex);
            progress.data.paints[v.type] = hex;
            progress.persist();
            k.sound.play('select');
          }, -1.3 + i * 0.26, y, { accent: `#${hex.toString(16).padStart(6, '0')}`, width: 0.23 });
          swatch.renderOrder = 61;
        });
      } else {
        row('Paint', 'Stand next to a vehicle to respray it.', '', y);
      }
    } else if (tab === 'Travel') {
      const places = [
        ['Downtown', 0, 40], ['Airfield', -300, 700], ['Stunt Park', PADS.park.x, PADS.park.z - 60],
        ['Sunset Pier', PADS.pier.x, PADS.pier.z + 60], ['Old Harbor', PADS.harbor.x + 40, PADS.harbor.z],
        ['Mount Halden', PADS.summit.x, PADS.summit.z + 14], ['Cabin Grove', PADS.grove.x, PADS.grove.z - 12],
        ['Lighthouse', PADS.lighthouse.x + 18, PADS.lighthouse.z],
      ];
      places.forEach(([name, x, z], i) => {
        const col = i % 2;
        button(name, () => {
          this.player.exitVehicle();
          this.closeMenu();
          this.teleport(x, z);
        }, -0.72 + col * 1.44, y - Math.floor(i / 2) * 0.32, { accent: '#35e0ff', width: 1.34 });
      });
    } else {
      const pref = progress.data.time;
      row('Time of day', 'The sun keeps moving on Cycle, or stay at your favorite hour.', pref, y);
      button('Change', () => {
        progress.data.time = TIMES[(TIMES.indexOf(pref) + 1) % TIMES.length];
        progress.persist();
        this.applyTimePref();
        this.openMenu('World');
      }, 1.1, y, { accent: '#ff5c4d', width: 0.56 });
      y -= 0.3;
      const worn = this.player.hero.outfit;
      row('Your clothes', 'Change your whole look. Your colors come from the Avatar Studio.', OUTFIT_LABELS[worn] ?? worn, y);
      button('Change', () => {
        const next = OUTFITS[(OUTFITS.indexOf(worn) + 1) % OUTFITS.length];
        this.player.hero.outfit = next;
        this.player.hero.clip = null;
        progress.data.outfit = next;
        progress.persist();
        this.openMenu('World');
      }, 1.1, y, { accent: '#ff5c4d', width: 0.56 });
      y -= 0.3;
      const tuned = this.player.radio.off ? 'Off' : this.player.radio.station.name;
      row('Radio', 'Plays in anything you drive. Changes with R on a keyboard.', tuned, y);
      button('Next', () => {
        this.player.radio.next();
        if (!this.player.vehicle) this.player.radio.stop();
        this.openMenu('World');
      }, 1.1, y, { accent: '#ff5c4d', width: 0.56 });
      y -= 0.3;
      row('Your avatar', 'Hats, wings, colors, sky and comfort settings live in the Avatar Studio.', '', y);
      button('Go', () => k.game.enter('avatar-studio'), 1.1, y, { accent: '#ffb7d5', width: 0.56 });
      y -= 0.3;
      row('The Crossroads', 'Eight smaller worlds, each with a patch to earn.', '', y);
      button('Go', () => k.game.enter('hub'), 1.1, y, { accent: '#ffd23f', width: 0.56 });
      y -= 0.3;
      if (k.game.isXR) {
        row('Controls', 'Stick moves. Right trigger gas, left trigger brake. A jump. B get in. X mic.', '', y);
      } else {
        row('View', `Press V on foot to switch between first and third person.`, '', y);
      }
    }

    // In front of the player, wherever they're looking, above everything else.
    const dir = k.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    const eye = k.head();
    group.position.copy(eye).addScaledVector(dir, 3).setY(eye.y - 0.05);
    group.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI;
    keepOnTop(group);
    k.root.add(group);
    this.menu = { group, targets };
  }

  closeMenu() {
    const { k } = this;
    if (!this.menu) {
      this.paused = false;
      return;
    }
    this.menu.targets.forEach((t) => k.input.removeTarget(t));
    k.root.remove(this.menu.group);
    disposeTree(this.menu.group);
    this.menu = null;
    this.paused = false;
    k.input.cursor = false;
    k.input.lasers = !this.player.vehicle;
    if (!k.game.isXR && !k.input.lockFailed) k.input.requestLock();
  }

  teleport(x, z) {
    this.player.spawn(x, z, this.k.rig.rotation.y);
    this.hud.banner('Fast travel', 'Welcome.');
  }

  // --- Multiplayer: everyone sees your vehicle ---------------------------------------

  setupNetwork() {
    const { k } = this;
    this.netTimer = 0;
    k.net.on('veh', (data, from) => {
      if (!Array.isArray(data) || data.length !== 9) return;
      const [typeIndex, ...nums] = data;
      if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 2e7)) return;
      const types = Object.keys(TYPES);
      const type = types[typeIndex];
      let ghost = this.ghosts.get(from);
      if (typeIndex === -1 || !type) {
        if (ghost) this.removeGhost(from);
        return;
      }
      if (!ghost || ghost.type !== type) {
        if (ghost) this.removeGhost(from);
        const v = new Vehicle(this, type, nums[0], nums[2], nums[3]);
        ghost = { v, type, pos: new THREE.Vector3(nums[0], nums[1], nums[2]), q: new THREE.Quaternion() };
        this.ghosts.set(from, ghost);
      }
      ghost.pos.set(nums[0], nums[1], nums[2]);
      e1.set(nums[4], nums[3], nums[5]);
      ghost.q.setFromEuler(e1);
      ghost.spin = nums[6];
      if (ghost.colorSet !== nums[7]) {
        ghost.colorSet = nums[7];
        ghost.v.setColor(nums[7]);
      }
    });
    k.onDispose(() => { for (const id of [...this.ghosts.keys()]) this.removeGhost(id); });
  }

  removeGhost(id) {
    const g = this.ghosts.get(id);
    if (g) {
      g.v.dispose();
      this.ghosts.delete(id);
    }
  }

  updateNetwork(dt) {
    const { k, player } = this;
    const here = new Set(k.net.peers().map((p) => p.id));
    for (const id of [...this.ghosts.keys()]) if (!here.has(id)) this.removeGhost(id);
    for (const g of this.ghosts.values()) {
      const a = 1 - Math.exp(-12 * dt);
      g.v.group.position.lerp(g.pos, a);
      g.v.group.quaternion.slerp(g.q, a);
      for (const p of g.v.model.props ?? []) p.obj.rotation[p.axis] += p.speed * dt;
      if (g.v.model.wheels) for (const w of g.v.model.wheels) w.rotation.x -= (g.spin ?? 0) * dt;
    }
    this.netTimer += dt;
    if (this.netTimer < 0.1 || !here.size) return;
    this.netTimer = 0;
    const v = player.vehicle;
    if (!v) {
      if (this.sentVehicle) k.net.send('veh', [-1, 0, 0, 0, 0, 0, 0, 0, 0]);
      this.sentVehicle = false;
      return;
    }
    this.sentVehicle = true;
    const color = v.group.children[0].material?.color?.getHex() ?? 0xffffff;
    const round = (n) => Math.round(n * 100) / 100;
    k.net.send('veh', [
      Object.keys(TYPES).indexOf(v.type), round(v.pos.x), round(v.pos.y), round(v.pos.z), round(v.yaw), round(v.pitch), round(-v.lean),
      round(v.speed / 0.36), color,
    ]);
  }

  peersOnMap() {
    return this.k.net.peers().filter((p) => p.avatar).map((p) => ({ x: p.avatar.head.position.x, z: p.avatar.head.position.z }));
  }

  // --- Every frame -------------------------------------------------------------------

  updateCulling(focus) {
    const limit = this.view + 240;
    const limit2 = limit * limit;
    for (const m of this.chunks) {
      const c = m.userData.center;
      const dx = c.x - focus.x;
      const dz = c.y - focus.z;
      m.visible = dx * dx + dz * dz < limit2;
    }
    const treeLimit = (this.k.game.look.high ? this.view * 0.72 + 320 : 400) ** 2;
    for (const m of this.nature) {
      const c = m.userData.center;
      const dx = c.x - focus.x;
      const dz = c.y - focus.z;
      m.visible = dx * dx + dz * dz < treeLimit;
    }
    const showDistance = this.k.game.look.high ? VEHICLE_SHOW : 170;
    for (const v of this.vehicles) {
      v.group.visible = v.driver || v.isPolice || v.pos.distanceToSquared(focus) < showDistance * showDistance;
    }
  }

  /** Flying over the city while the title screen is up. */
  updateAttract(t) {
    const { rig, camera, input, game } = this.k;
    this.sky.frozen = true;
    this.sky.time = 0.655;
    const shots = [
      { from: [46, 11, 330], to: [46, 13, 150], look: [46, 60, -240] },
      { from: [-360, 150, 280], to: [-120, 190, 420], look: [0, 120, 0] },
      { from: [-180, 30, -1760], to: [150, 34, -1790], look: [240, 44, -1520] },
      { from: [-760, 18, 600], to: [-380, 26, 610], look: [-260, 14, 720] },
      { from: [720, 250, -720], to: [980, 300, -640], look: [1450, 380, -250] },
      { from: [300, 60, 300], to: [190, 90, 190], look: [-60, 170, -60] },
    ];
    const SHOT = 11;
    const index = Math.floor(t / SHOT) % shots.length;
    const f = (t % SHOT) / SHOT;
    if (index !== this.shotIndex) {
      // Dip to black between shots, like a film cut.
      if (this.shotIndex !== undefined && !game.busy) game.fadeTo(1, 0.01).then(() => game.fadeTo(0, 0.7));
      this.shotIndex = index;
    }
    const shot = shots[index];
    const x = shot.from[0] + (shot.to[0] - shot.from[0]) * f;
    const y = shot.from[1] + (shot.to[1] - shot.from[1]) * f;
    const z = shot.from[2] + (shot.to[2] - shot.from[2]) * f;
    const dx = shot.look[0] - x;
    const dy = shot.look[1] - y;
    const dz = shot.look[2] - z;
    rig.position.set(x, y - camera.position.y, z);
    rig.rotation.y = Math.atan2(-dx, -dz);
    input.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    camera.rotation.x = input.pitch;
  }

  update(dt, t) {
    this.time = t;
    const { k, player } = this;
    const started = k.game.started;
    if (started && this.attract) {
      this.attract = false;
      this.sky.frozen = false;
      this.applyTimePref();
      this.k.game.fadeMat.opacity = 0;
      player.spawn(0, 40, Math.PI);
      k.input.pitch = -0.12;
    }

    if (!started) {
      this.updateAttract(t);
    } else if (!this.paused) {
      const { input } = k;
      const openKey = k.isXR ? input.buttons.y : input.keyPressed('KeyU') || input.keyPressed('Tab');
      if (openKey) this.openMenu();
      else {
        player.update(dt);
        this.activities.update(dt, t);
        this.crime.update(dt);
      }
      for (const v of this.vehicles) {
        if (v !== player.vehicle && !v.grounded) v.update(dt, null);
        else if (v !== player.vehicle && v.def.cls === 'boat' && v.group.visible) v.update(dt, null);
      }
      if (!k.isXR && input.keyPressed('KeyH')) this.closeMenu();
    } else {
      const { input } = k;
      if (k.isXR ? input.buttons.y : input.keyPressed('KeyU') || input.keyPressed('Escape') || input.keyPressed('Tab')) this.closeMenu();
    }

    const focus = started ? player.pos : k.rig.position;
    this.sky.update(dt, focus);
    this.water.position.set(focus.x, 0, focus.z);
    const u = this.water.userData.uniforms;
    u.time.value = t;
    u.fogCol.value.copy(k.scene.fog.color);
    this.city.update(this.sky.dusk, t);
    if (started && !this.paused) trafficCollisions(this, dt);
    this.traffic.update(dt, focus);
    this.people.update(dt, focus);
    this.city.prefabs.update(dt, focus);
    this.grass?.(focus);
    this.updateCulling(focus);

    // Fading jetpack sparks.
    const f = this.flames;
    let moved = false;
    for (let i = 0; i < f.life.length; i++) {
      if (f.life[i] > 0) {
        f.life[i] -= dt;
        f.pos[i * 3 + 1] -= dt * 7;
        if (f.life[i] <= 0) f.pos[i * 3 + 1] = -1000;
        moved = true;
      }
    }
    if (moved) f.pts.geometry.attributes.position.needsUpdate = true;

    this.hud.update(dt);
    this.updateNetwork(dt);
    if (started && this.announce) {
      this.announce = false;
      this.hud.banner('Welcome to Meridian', 'Grab that motorcycle. Everything on this island is yours to explore.');
    }
  }

  onStart() {
    this.attract = true; // the next update moves the player into place
  }
}

export default {
  id: 'meridian',
  name: 'Meridian',
  hidden: true,
  look: { bloom: 0.3, threshold: 0.95, radius: 0.5, exposure: 1.18, toneMapping: THREE.ACESFilmicToneMapping },

  create(k) {
    const world = new World(k);
    return {
      world,
      update: (dt, t) => world.update(dt, t),
      onStart: () => world.onStart(),
    };
  },
};
