// A clumsy bot that mashes random controls in every vehicle, all over the map, hunting for
// the moments a real player gets stuck, falls through the world or breaks the game.
// From the browser console on the game page:
//   const { run } = await import('/tools/meridian-chaos.js'); await run();
const DT = 1 / 30;
const KEYS = ['KeyW', 'KeyW', 'KeyW', 'KeyA', 'KeyD', 'KeyS', 'Space', 'ShiftLeft', 'KeyZ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

export async function run({ seconds = 40, seed = 7, rounds = 6 } = {}) {
  const G = window.patchwork;
  G.renderer.setAnimationLoop(null);
  G.look.render = () => {
    G.scene.updateMatrixWorld();
    G.camera.updateMatrixWorld();
  };
  G.clock.getDelta = () => DT;
  G.input.lockFailed = true;
  G.input.lastLook = performance.now() + 1e9;
  for (let i = 0; i < 400 && G.busy; i++) {
    G.frame();
    await null;
  }
  G.start?.();
  for (let i = 0; i < 400 && G.busy; i++) {
    G.frame();
    await null;
  }
  const W = G.world.world ?? G.world;
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const P = W.player;
  const problems = [];
  const counts = {};
  const report = (kind, detail) => {
    counts[kind] = (counts[kind] ?? 0) + 1;
    if (counts[kind] <= 4) problems.push({ kind, ...detail });
  };
  const finite = (...n) => n.every(Number.isFinite);
  const where = () => ({ x: Math.round(P.pos.x), y: +P.pos.y.toFixed(1), z: Math.round(P.pos.z) });
  const check = (label) => {
    const v = P.vehicle;
    const cam = G.camera.getWorldPosition(new (P.pos.constructor)());
    if (!finite(P.pos.x, P.pos.y, P.pos.z, cam.x, cam.y, cam.z)) report('not a number', { label });
    if (v && !finite(v.pos.x, v.pos.y, v.pos.z, v.yaw, v.pitch, v.roll, v.speed)) report('vehicle not a number', { label, type: v.type });
    const h = W.terrain.height(P.pos.x, P.pos.z);
    if (P.pos.y < h - 1.2 && h > -1) report('under the ground', { label, ...where(), ground: +h.toFixed(1) });
    if (P.pos.y < -30) report('fell out of the world', { label, ...where() });
    if (Math.abs(P.pos.x) > 3600 || Math.abs(P.pos.z) > 3600) report('left the map', { label, ...where() });
    const camGround = W.terrain.height(cam.x, cam.z);
    if (cam.y < camGround + 0.05 && camGround > 0) report('camera in the ground', { label, ...where(), cam: +cam.y.toFixed(1), ground: +camGround.toFixed(1) });
    if (v && v.speed > 420) report('absurd speed', { label, type: v.type, speed: Math.round(v.speed) });
    if (!v && !P.swimming) {
      for (const b of W.solids.near(P.pos.x, P.pos.z)) {
        if (P.pos.x > b.minX + 0.1 && P.pos.x < b.maxX - 0.1 && P.pos.z > b.minZ + 0.1 && P.pos.z < b.maxZ - 0.1 && P.pos.y < b.top - 0.5 && P.pos.y > b.bottom) {
          report('inside a building', { label, ...where() });
          break;
        }
      }
    }
    if (W.paused && !W.menu) report('paused with no menu', { label });
  };
  const step = (n, each) => {
    for (let i = 0; i < n; i++) {
      each?.(i);
      G.frame();
      check(label);
    }
  };
  let label = '';
  const tap = (code) => {
    dispatchEvent(new KeyboardEvent('keydown', { code }));
    dispatchEvent(new KeyboardEvent('keyup', { code }));
    G.frame();
  };

  /** Mashes keys and swings the camera about for a while, noticing when progress stops. */
  const mash = (frames, stuckKind) => {
    let held = [];
    let anchor = P.pos.clone();
    let still = 0;
    const startMoney = G.save.coins;
    step(frames, (i) => {
      if (i % 24 === 0) {
        held.forEach((k) => G.input.keys.delete(k));
        held = [];
        const n = 1 + Math.floor(rnd() * 3);
        for (let j = 0; j < n; j++) held.push(KEYS[Math.floor(rnd() * KEYS.length)]);
        if (rnd() < 0.7) held.push('KeyW');
        held.forEach((k) => G.input.keys.add(k));
        G.rig.rotation.y += (rnd() - 0.5) * 0.7;
        G.input.pitch = Math.max(-1, Math.min(0.9, G.input.pitch + (rnd() - 0.5) * 0.4));
      }
      if (P.pos.distanceTo(anchor) > 1.5) {
        anchor.copy(P.pos);
        still = 0;
      } else if (G.input.keys.has('KeyW') && !W.paused) {
        still += 1;
        if (still === 30 * 10) {
          // A person would back up or steer away. Only count it if that doesn't help either.
          const from = P.pos.clone();
          const saved = [...G.input.keys];
          let escaped = false;
          for (const tryKeys of [['KeyS'], ['KeyS', 'KeyA'], ['KeyW', 'KeyD'], ['KeyW', 'KeyA'], ['KeyS', 'KeyD']]) {
            G.input.keys.clear();
            tryKeys.forEach((k) => G.input.keys.add(k));
            for (let f = 0; f < 150; f++) G.frame();
            if (P.pos.distanceTo(from) > 3) {
              escaped = true;
              break;
            }
          }
          G.input.keys.clear();
          saved.forEach((k) => G.input.keys.add(k));
          report(escaped ? `${stuckKind} (got free by reversing)` : `${stuckKind} for good`, { label, ...where() });
          still = 0;
        }
      }
    });
    held.forEach((k) => G.input.keys.delete(k));
    G.input.keys.clear();
    return { startMoney };
  };

  /** Whatever just happened, can they still get out and walk away? */
  const canWalkAway = () => {
    if (P.vehicle) {
      tap('KeyF');
      if (P.vehicle) report('could not get out', { label, ...where() });
    }
    step(45);
    const from = P.pos.clone();
    let best = 0;
    for (const yaw of [0, 1.6, 3.1, 4.7]) {
      G.rig.rotation.y = yaw;
      G.input.keys.add('KeyW');
      step(45);
      G.input.keys.clear();
      best = Math.max(best, Math.hypot(P.pos.x - from.x, P.pos.z - from.z));
    }
    if (best < 2) report('stuck on foot', { label, ...where(), moved: +best.toFixed(2) });
  };

  const spots = () => {
    const pads = W.terrain.pads ?? {};
    const list = [[0, 40], [46, 120], [138, -92], [-230, 70], [300, 300], [-800, 660], [-300, 715]];
    for (const p of Object.values(pads)) if (p?.x !== undefined) list.push([p.x, p.z]);
    const ring = W.terrain.road('ring').pts;
    for (let i = 0; i < 8; i++) {
      const q = ring[Math.floor(rnd() * ring.length)];
      list.push([q.x, q.z]);
    }
    for (let i = 0; i < 6; i++) list.push([(rnd() - 0.5) * 3600, (rnd() - 0.5) * 3600]);
    return list;
  };

  const types = ['car', 'supercar', 'bike', 'plane', 'heli', 'boat'];
  for (const t of types) W.progress.data.owned[t] = true;
  W.progress.data.owned.jet = true;
  const frames = Math.round(seconds / DT);
  const started = performance.now();
  for (let round = 0; round < rounds; round++) {
    const places = spots();
    const at = () => places[Math.floor(rnd() * places.length)];

    // On foot, including over the water and up the mountains.
    {
      const [x, z] = at();
      label = `foot ${x | 0},${z | 0}`;
      if (P.vehicle) P.exitVehicle();
      P.spawn(x, z, rnd() * 6);
      mash(frames / 2, 'stuck on foot while walking');
      canWalkAway();
      await null;
    }
    for (const type of types) {
      const v = W.vehicles.find((c) => c.type === type);
      if (!v) continue;
      const [x, z] = type === 'boat' ? W.deepWater(...at()) : at();
      label = `${type} ${x | 0},${z | 0}`;
      if (P.vehicle) P.exitVehicle();
      v.place(x, z, rnd() * 6);
      P.pos.copy(v.pos);
      P.enterVehicle(v);
      if (v.def.cls === 'plane' && rnd() < 0.6) {
        v.pos.y += 150;
        v.flightSpeed = 60;
        v.throttle = 0.8;
      }
      mash(frames, `${type} stuck`);
      canWalkAway();
      v.respawn();
      await null;
    }

    // The menu, opened and closed at awkward moments.
    label = 'menu';
    for (const tab of ['Upgrades', 'Vehicles', 'Travel', 'World']) {
      W.openMenu(tab);
      step(4);
      if (!W.paused) report('menu did not pause', { tab });
      W.closeMenu();
      step(4);
      if (W.paused) report('still paused after closing the menu', { tab });
    }
  }
  return { ms: Math.round(performance.now() - started), counts, problems };
}
