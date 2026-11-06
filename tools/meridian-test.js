// Plays the open world with a bot, much faster than real time.
// From the browser console on the game page:
//   const { run } = await import('/tools/meridian-test.js'); await run();
const DT = 1 / 30;
const PADS_FAR = { x: -1800, z: 1300 };

export async function run() {
  const G = window.patchwork;
  const r = {};
  const notes = {};
  window.meridianPartial = { r, notes }; // readable if the run throws partway
  G.renderer.setAnimationLoop(null);
  G.look.render = () => {
    G.scene.updateMatrixWorld();
    G.camera.updateMatrixWorld();
  };
  G.clock.getDelta = () => DT;
  G.save.reset();
  G.input.lockFailed = true;
  G.input.lastLook = performance.now() + 1e9;

  const settle = async () => {
    for (let i = 0; i < 400 && G.busy; i++) {
      G.frame();
      await null;
      await null;
    }
  };
  await settle();
  G.enter('meridian'); // rebuild it with the fresh save
  await settle();
  const step = (seconds, each) => {
    for (let i = 0; i < seconds / DT; i++) {
      each?.();
      G.frame();
    }
  };
  const hold = (...codes) => codes.forEach((c) => G.input.keys.add(c));
  const release = () => G.input.keys.clear();
  const tap = (code) => {
    dispatchEvent(new KeyboardEvent('keydown', { code }));
    dispatchEvent(new KeyboardEvent('keyup', { code }));
    G.frame();
  };
  const click = () => {
    G.canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
  };

  G.start();
  await settle();
  step(0.5);
  const W = G.world.world;
  const P = W.player;
  r['started on the island'] = G.currentId === 'meridian' && G.input.enabled && G.input.free;
  notes.spawn = P.pos.toArray().map((n) => +n.toFixed(1));
  r['spawn is on the ground'] = Math.abs(P.pos.y - W.groundAt(P.pos.x, P.pos.z, P.pos.y)) < 0.2;

  // On foot, on an open stretch of street.
  P.spawn(46, 300);
  step(0.2);
  const startZ = P.pos.z;
  G.rig.rotation.y = 0;
  hold('KeyW');
  step(2);
  release();
  r['walking moves you'] = P.pos.z < startZ - 3;
  const walkSpeed = startZ - P.pos.z;
  G.rig.rotation.y = 0;
  const z2 = P.pos.z;
  hold('KeyW', 'ShiftLeft');
  step(2);
  release();
  r['sprinting is faster'] = z2 - P.pos.z > walkSpeed * 1.5;
  step(0.3);
  tap('Space');
  let peak = P.pos.y;
  const groundY = W.groundAt(P.pos.x, P.pos.z, P.pos.y);
  step(0.6, () => { peak = Math.max(peak, P.pos.y); });
  r['jumping leaves the ground'] = peak > groundY + 0.8;
  step(1);

  // Walls stop you.
  P.pos.set(46, 8.5, 46 + 0);
  const box = W.solids.all.find((b) => b.top > 30 && b.minX > 0 && b.minZ > 0);
  P.pos.set(box.minX - 2, W.groundAt(box.minX - 2, (box.minZ + box.maxZ) / 2, 100), (box.minZ + box.maxZ) / 2);
  G.rig.rotation.y = -Math.PI / 2;
  hold('KeyW');
  step(2);
  release();
  r['buildings are solid'] = P.pos.x < box.minX + 0.1;

  const teleportTo = (v) => {
    P.pos.copy(v.pos);
    P.pos.x += 2;
    step(0.1);
  };
  const enter = (type, pick = (v) => v.type === type) => {
    const v = W.vehicles.find(pick);
    teleportTo(v);
    tap('KeyF');
    step(0.1);
    return v;
  };
  const leave = () => {
    if (P.vehicle) tap('KeyF');
    step(0.2);
  };

  // Motorcycle.
  const bike = enter('bike');
  r['F gets you on the motorcycle'] = P.vehicle === bike;
  G.rig.rotation.y = bike.yaw;
  bike.place(0, 45, Math.PI / 2);
  const bikeStart = bike.pos.clone();
  hold('KeyW');
  let top = 0;
  step(2, () => { top = Math.max(top, bike.speed); });
  release();
  r['the motorcycle accelerates'] = top > 12;
  notes.bikeSpeed2s = +top.toFixed(1);
  r['the motorcycle moves'] = bike.pos.distanceTo(bikeStart) > 15;
  const yaw0 = bike.yaw;
  hold('KeyW', 'KeyD');
  step(0.6);
  release();
  r['it steers'] = Math.abs(bike.yaw - yaw0) > 0.2;
  r['it leans into turns'] = Math.abs(bike.lean) > 0.05;
  leave();
  r['F gets you off'] = !P.vehicle;
  r['you land beside it'] = P.pos.distanceTo(bike.pos) < 6;

  // A full lap of the highway holding the road, by steering at the next point.
  const car = enter('car');
  r['you can get in a car'] = P.vehicle === car;
  const ring = W.terrain.road('ring').pts;
  car.place(ring[0].x, ring[0].z, Math.atan2(-(ring[1].x - ring[0].x), -(ring[1].z - ring[0].z)));
  let idx = 0;
  let maxSpeed = 0;
  let lowest = 1e9;
  let maxGap = 0;
  let laps = 0;
  const driveOnRoad = (seconds) => step(seconds, () => {
    while (Math.hypot(ring[idx].x - car.pos.x, ring[idx].z - car.pos.z) < 22) {
      idx = (idx + 1) % ring.length;
      if (idx === 0) laps += 1;
    }
    const t = ring[idx];
    const want = Math.atan2(-(t.x - car.pos.x), -(t.z - car.pos.z));
    const diff = ((want - car.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    G.input.keys.clear();
    if (car.speed < 30) G.input.keys.add('KeyW');
    if (diff > 0.05) G.input.keys.add('KeyA');
    if (diff < -0.05) G.input.keys.add('KeyD');
    maxSpeed = Math.max(maxSpeed, car.speed);
    lowest = Math.min(lowest, car.pos.y);
    maxGap = Math.max(maxGap, Math.hypot(car.pos.x - t.x, car.pos.z - t.z));
  });
  driveOnRoad(280);
  release();
  r['the highway can be driven all the way round'] = laps >= 1 || idx > ring.length * 0.9;
  notes.lap = { laps, idx, of: ring.length, maxSpeed: +maxSpeed.toFixed(1), lowest: +lowest.toFixed(1), maxGap: +maxGap.toFixed(1) };
  r['the highway stays above water'] = lowest > 1;
  leave();

  // The plane takes off from the runway and climbs.
  const planeV = enter('plane', (v) => v.type === 'plane' && Math.abs(v.pos.z - 660) < 5);
  r['you can board a plane'] = P.vehicle === planeV;
  planeV.place(-800, 660, -Math.PI / 2, 10.25);
  notes.planeStart = planeV.pos.toArray();
  hold('ShiftLeft');
  step(9);
  notes.planeRollSpeed = +planeV.flightSpeed.toFixed(1);
  notes.planeRollX = +planeV.pos.x.toFixed(0);
  G.rig.rotation.y = planeV.yaw;
  G.input.pitch = 0.3;
  step(5);
  notes.planeAfterPull = { y: +planeV.pos.y.toFixed(1), speed: +planeV.flightSpeed.toFixed(1), pitch: +planeV.pitch.toFixed(2) };
  r['the plane takes off'] = planeV.pos.y > 16 && P.vehicle === planeV;
  const climbY = planeV.pos.y;
  step(4);
  r['the plane climbs'] = planeV.pos.y > climbY + 15;
  G.input.pitch = -0.1;
  const headingBefore = planeV.yaw;
  G.rig.rotation.y = planeV.yaw - 1.2; // point the camera off to the right
  step(3.5);
  r['the plane turns toward where you point'] = Math.abs(planeV.yaw - headingBefore) > 0.25;
  notes.plane = { y: +planeV.pos.y.toFixed(1), speed: +planeV.flightSpeed.toFixed(1), roll: +planeV.roll.toFixed(2) };
  release();

  // Flying into a mountain is a crash, and you walk away.
  planeV.pos.set(1450, 120, 300);
  planeV.yaw = 0;
  planeV.pitch = 0;
  planeV.roll = 0;
  planeV.flightSpeed = 60;
  planeV.throttle = 1;
  G.rig.rotation.y = 0;
  G.input.pitch = -0.14;
  hold('ShiftLeft');
  step(20);
  release();
  r['crashing puts you on foot, unhurt'] = !P.vehicle;
  r['the crashed plane returns to the airfield'] = Math.hypot(planeV.pos.x - planeV.home.x, planeV.pos.z - planeV.home.z) < 1;
  step(2);

  // The helicopter needs buying first.
  G.save.data.coins = 5000;
  W.progress.data.level = 6;
  W.progress.buyVehicle('heli');
  W.progress.buyVehicle('jet');
  W.progress.buyVehicle('supercar');
  const heli = enter('heli');
  r['you can fly a helicopter'] = P.vehicle === heli;
  hold('ShiftLeft');
  step(4);
  release();
  r['the helicopter lifts off'] = heli.pos.y > W.groundAt(heli.pos.x, heli.pos.z, heli.pos.y) + 15;
  hold('KeyW');
  const hx = heli.pos.clone();
  step(4);
  release();
  r['the helicopter flies forward'] = heli.pos.distanceTo(hx) > 40;
  leave();
  step(1);

  // The boat.
  const boat = enter('boat');
  r['you can drive a boat'] = P.vehicle === boat;
  const bx = boat.pos.clone();
  boat.yaw = Math.atan2(-boat.pos.x, -boat.pos.z);
  hold('KeyW');
  step(3);
  release();
  r['the boat moves on the water'] = boat.speed > 5 && boat.pos.y < 2;
  notes.boat = { speed: +boat.speed.toFixed(1), y: +boat.pos.y.toFixed(2), start: bx.toArray().map((n) => +n.toFixed(0)) };
  leave();

  // Swimming: you don't sink out of the world.
  P.pos.set(0, 5, -2100);
  step(3);
  r['you can swim'] = P.swimming && P.pos.y > -2;

  // Progress: shards, places, level-ups, upgrades.
  const prog = W.progress;
  prog.data.level = 1;
  prog.data.xp = 0;
  G.save.data.coins = 0;
  const shard = W.activities.shards.find((s) => !s.taken);
  const shardsBefore = prog.data.shards.length;
  P.pos.copy(shard.mesh.position);
  step(0.1);
  r['shards can be collected'] = shard.taken && prog.data.shards.length === shardsBefore + 1;
  r['shards pay coins'] = G.save.coins > 0;
  P.spawn(W.activities.zones[1].x, W.activities.zones[1].z);
  step(0.1);
  r['discovering a place counts'] = prog.data.zones.includes('airport');
  prog.grant(100000, 0, 'test');
  r['XP raises your level'] = prog.level > 3;
  notes.levelFrom100k = prog.level;
  prog.data.level = 3;
  prog.data.xp = 0;
  G.save.data.coins = 100000;
  const engine0 = prog.upgrades.engine;
  r['upgrades can be bought'] = prog.buyUpgrade('engine') && prog.upgrades.engine === engine0 + 1;
  const bikeTop = bike.stats().top;
  prog.buyUpgrade('engine');
  r['engine upgrades make vehicles faster'] = bike.stats().top > bikeTop;
  G.save.data.coins = 0;
  r['upgrades need coins'] = !prog.buyUpgrade('handling');
  G.save.data.coins = 100000;
  prog.buyUpgrade('jetpack');
  P.spawn(0, 40, 0);
  step(0.3);
  hold('Space');
  step(0.05);
  G.input.keysPressed.add('Space');
  step(1.5);
  release();
  r['the jetpack flies'] = P.pos.y > W.groundAt(P.pos.x, P.pos.z, 100) + 5;
  notes.jetpackHeight = +(P.pos.y - W.terrain.height(P.pos.x, P.pos.z)).toFixed(1);
  step(4);

  // Menu.
  tap('KeyU');
  r['the menu opens and pauses'] = W.paused && !!W.menu;
  ['Vehicles', 'Travel', 'World', 'Upgrades'].forEach((t) => W.openMenu(t));
  r['every menu tab opens'] = !!W.menu;
  tap('KeyU');
  r['the menu closes'] = !W.paused && !W.menu;
  W.openMenu('Travel');
  const dest = W.menu.targets[6];
  const worldPos = dest.getWorldPosition(G.rig.position.clone());
  const ndc = worldPos.project(G.camera);
  G.input.mouseNdc.set(ndc.x, ndc.y);
  step(0.1);
  click();
  step(0.1);
  r['fast travel works'] = !W.paused && Math.hypot(P.pos.x, P.pos.z - 40) > 100;
  notes.travelTo = P.pos.toArray().map((n) => +n.toFixed(0));

  // A courier job from start to finish, then a streak.
  const A = W.activities;
  P.spawn(A.hq.x, A.hq.z);
  step(0.2);
  r['walking into HQ starts a job'] = !!A.job;
  const coinsBefore = G.save.coins;
  let job = A.job;
  P.spawn(job.spot.x, job.spot.z);
  step(0.2);
  r['delivering pays and starts the next job'] = G.save.coins > coinsBefore && !!A.job && A.job !== job && A.jobStreak === 1;
  job = A.job;
  job.time = 0.01;
  step(0.2);
  r['running out of time ends the streak'] = !A.job && A.jobStreak === 0;

  // A race: Downtown Dash, gate by gate.
  const dash = A.races.find((x) => x.id === 'downtown');
  const raceCar = enter('car');
  raceCar.place(dash.at[0], dash.at[1], 0);
  P.pos.copy(raceCar.pos);
  step(0.2);
  r['driving into a beacon starts the race'] = A.race?.def === dash;
  for (const gate of dash.gates) {
    raceCar.pos.set(gate.x, gate.y, gate.z);
    step(0.2);
  }
  r['finishing a race records your time'] = !A.race && dash.id in prog.data.best;
  leave();

  // Air time pays, by launching off a ramp at speed.
  const ramp = W.solids.ramps[2];
  const stuntBike = enter('bike');
  stuntBike.place(ramp.x - ramp.dirX * 60, ramp.z - ramp.dirZ * 60, Math.atan2(-ramp.dirX, -ramp.dirZ));
  const stuntBefore = G.save.coins;
  hold('KeyW', 'ShiftLeft');
  let maxAir = 0;
  step(9, () => { maxAir = Math.max(maxAir, stuntBike.pos.y - W.terrain.height(stuntBike.pos.x, stuntBike.pos.z)); });
  release();
  notes.rampAir = +maxAir.toFixed(1);
  r['ramps launch you'] = maxAir > 3;
  r['air time earns coins'] = G.save.coins > stuntBefore;
  leave();

  // Crime: fists, stealing, stores and the police.
  const C = W.crime;
  C.clearHeat();
  G.save.data.coins = 1000;
  const walker = W.people.list.find((x) => x.role === 'civilian');
  walker.state = 'walk';
  P.spawn(walker.x, walker.z + 1.2, 0);
  step(0.05);
  P.bodyYaw = Math.atan2(-(walker.x - P.pos.x), -(walker.z - P.pos.z));
  click();
  step(0.1);
  r['punching someone lands'] = walker.hp < 100 || walker.state === 'down';
  r['hitting a civilian makes them run'] = walker.state === 'flee' || walker.state === 'down';
  r['hitting a civilian raises your wanted level'] = C.wanted >= 1;
  C.clearHeat();

  const turf = C.turfs[0];
  P.spawn(turf.x + 14, turf.z, 0);
  const startHealth = C.health;
  step(4);
  r['rival gangs come after you'] = turf.members.some((m) => Math.hypot(m.x - P.pos.x, m.z - P.pos.z) < 3);
  let lowest2 = C.health;
  step(4, () => { lowest2 = Math.min(lowest2, C.health); });
  r['rivals can hurt you'] = lowest2 < startHealth;
  notes.healthAfterFourSeconds = Math.round(C.health);
  r['one crew does not flatten you instantly'] = C.health > 40;
  C.health = 100;
  const beforeFight = G.save.coins;
  let swings = 0;
  while (turf.members.some((m) => m.state !== 'down') && swings < 200) {
    swings += 1;
    C.health = 100;
    const m = turf.members.find((x) => x.state !== 'down');
    P.pos.x = m.x;
    P.pos.z = m.z + 1;
    P.bodyYaw = 0;
    C.punchCool = 0;
    click();
    step(0.1);
  }
  notes.swingsToClearTurf = swings;
  r['you can knock out a whole crew'] = turf.members.every((m) => m.state === 'down');
  r['beating a crew pays'] = G.save.coins > beforeFight && turf.cleared;
  C.clearHeat();

  // Carjacking a moving car.
  const moving = W.traffic.cars.find((c) => !c.parked && !c.gone);
  step(0.2);
  P.spawn(moving.x + 2, moving.z + 2, 0);
  step(0.05);
  r['a nearby car can be stolen'] = P.nearbyCar != null;
  const target = P.nearbyCar;
  tap('KeyF');
  step(0.1);
  r['pressing F steals the car'] = !!P.vehicle && P.vehicle.stolen && target.gone > 0;
  r['carjacking brings heat'] = !target.parked ? C.wanted >= 1 : true;
  hold('KeyW');
  step(1);
  release();
  r['the stolen car drives'] = P.vehicle?.speed > 3;
  leave();
  C.clearHeat();

  // Breaking into a parked car removes its collision too.
  const parkedCar = W.traffic.cars.find((c) => c.parked && !c.gone);
  r['parked cars line the streets'] = !!parkedCar;
  P.spawn(parkedCar.x + 2.2, parkedCar.z + 2.2, 0);
  step(0.05);
  P.nearbyCar = parkedCar;
  P.nearby = null;
  tap('KeyF');
  step(0.1);
  r['you can break into a parked car'] = !!P.vehicle?.stolen && parkedCar.gone > 0;
  leave();
  C.clearHeat();

  // Robbing a store.
  const store = C.stores[0];
  r['there are stores to rob'] = C.stores.length >= 5;
  P.spawn(store.x, store.z, 0);
  const cash0 = G.save.coins;
  hold('KeyG');
  step(5.5, () => { P.pos.set(store.x, store.y, store.z); });
  release();
  r['robbing a store pays cash'] = G.save.coins > cash0;
  r['robbing a store brings the police'] = C.wanted >= 2;
  notes.robbery = { cash: G.save.coins - cash0, wanted: C.wanted };

  // The police come, chase you and arrest you if you stand still.
  P.spawn(46, 300, 0);
  C.wanted = 3;
  step(12);
  r['police cars respond'] = C.cops.length >= 1;
  notes.copDistance = C.cops.map((c) => Math.round(c.car.pos.distanceTo(P.pos)));
  const spawnDistance = C.cops[0]?.car.pos.distanceTo(P.pos) ?? 0;
  step(45, () => { C.health = 100; });
  notes.afterChase = { wanted: C.wanted, officers: C.officers.length, spawnDistance: Math.round(spawnDistance), cops: C.cops.map((c) => Math.round(c.car.pos.distanceTo(P.pos))), pos: P.pos.toArray().map((n) => Math.round(n)) };
  r['standing still gets you arrested'] = C.wanted === 0 && Math.hypot(P.pos.x + 230, P.pos.z - 46) < 40;

  // Staying out of range makes them lose interest.
  C.clearHeat();
  P.spawn(PADS_FAR.x, PADS_FAR.z, 0);
  C.wanted = 1;
  C.cops.length = 0;
  step(40, () => { C.cops.length = 0; });
  r['getting away clears your wanted level'] = C.wanted === 0;

  // Getting beaten up sends you to the hospital, not a game over.
  C.health = 5;
  C.hurt(50);
  r['being knocked out wakes you at the hospital'] = C.health === 100 && Math.hypot(P.pos.x - 230, P.pos.z + 46) < 3;

  // Every boat and boat-race gate has to be in real water.
  const dry = [
    ...W.vehicles.filter((v) => v.type === 'boat').map((v) => v.pos),
    ...A.races.find((x) => x.kind === 'boat').gates,
  ].filter((p) => W.terrain.height(p.x, p.z) > -1);
  r['boats and boat races are in deep water'] = dry.length === 0;

  // Nothing parked starts inside a wall or under the ground.
  const buried = W.vehicles.filter((v) => {
    const g = W.terrain.height(v.pos.x, v.pos.z);
    return v.def.cls !== 'boat' && v.pos.y < g - 0.5;
  }).map((v) => v.type);
  notes.buried = buried;
  r['no vehicle is buried'] = buried.length === 0;
  const walled = W.vehicles.filter((v) => {
    const p = v.pos.clone();
    return W.solids.near(p.x, p.z).some((b) => p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ && p.y < b.top - 1.3);
  }).map((v) => `${v.type} ${Math.round(v.pos.x)},${Math.round(v.pos.z)}`);
  notes.walled = walled;
  r['no vehicle is inside a building'] = walled.length === 0;

  // Portals and leaving: the world cleans up after itself.
  P.spawn(27, 26);
  G.rig.rotation.y = 0;
  hold('KeyW');
  step(4);
  release();
  await settle();
  r['the Crossroads portal works'] = G.currentId === 'hub';
  r['leaving restores normal controls'] = !G.input.free && G.camera.far < 2000 && !document.getElementById('hud');
  G.enter('meridian');
  await settle();
  step(0.5);
  r['you can come back to the island'] = G.currentId === 'meridian' && !!document.getElementById('hud');
  const after = G.world.world.progress;
  notes.after = { shards: after.data.shards.length, upgrades: after.upgrades, level: after.level, saved: !!G.save.world('meridian') };
  r['your progress survived'] = after.data.shards.length >= 1 && after.upgrades.jetpack >= 1;

  const failed = Object.entries(r).filter(([, ok]) => !ok).map(([name]) => name);
  return { passed: Object.keys(r).length - failed.length, failed, notes };
}
