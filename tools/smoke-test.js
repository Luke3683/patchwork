// Plays every world with a bot, much faster than real time, and prints a pass or fail for each.
// Run it from the browser console on the game page:
//   const { run } = await import('/tools/smoke-test.js'); await run();
const DT = 1 / 30;

export async function run() {
  const G = window.patchwork;
  const results = {};
  const root = () => G.kit.root;
  const realRender = G.renderer.render.bind(G.renderer);

  G.renderer.setAnimationLoop(null);
  G.renderer.render = () => {
    G.scene.updateMatrixWorld();
    G.camera.updateMatrixWorld();
  };
  G.clock.getDelta = () => DT;
  G.save.reset();
  G.started = true;
  G.input.enabled = true;
  G.input.lockFailed = true;
  const savedPrefs = JSON.stringify(G.prefs);

  const step = (seconds = DT, each) => {
    for (let i = 0; i < seconds / DT; i++) {
      each?.();
      G.frame();
    }
  };
  const aimAt = (p) => {
    const v = p.clone().project(G.camera);
    G.input.mouseNdc.set(v.x, v.y);
  };
  const click = (button = 0) => {
    G.canvas.dispatchEvent(new MouseEvent('mousedown', { button, bubbles: true }));
    dispatchEvent(new MouseEvent('mouseup', { button }));
  };
  const tap = (code) => {
    dispatchEvent(new KeyboardEvent('keydown', { code }));
    dispatchEvent(new KeyboardEvent('keyup', { code }));
  };
  const worldPos = (obj) => obj.getWorldPosition(G.rig.position.clone());
  // World changes are async, so give their promises a turn between frames.
  const settle = async () => {
    for (let i = 0; i < 300 && G.busy; i++) {
      G.frame();
      await null;
      await null;
    }
  };
  const enter = async (id) => {
    G.enter(id);
    await settle();
    step(0.1);
  };
  const pick = (i) => {
    aimAt(worldPos(G.input.targets[i].obj));
    step(DT * 3);
    click();
    step(DT * 3);
  };
  const untilPatch = (id, max, each) => {
    let t = 0;
    while (!G.save.hasPatch(id) && t < max) {
      step(DT, each);
      t += DT;
    }
    return G.save.hasPatch(id);
  };

  await settle(); // finish any transition still in progress

  // Ring Run: steer at the next ring.
  await enter('ring-run');
  pick(0);
  results['ring-run win'] = untilPatch('ring-run', 80, () => {
    const head = G.rig.position.clone();
    head.y += 1.6;
    const next = root().children
      .filter((m) => m.geometry?.type === 'TorusGeometry')
      .find((r) => r.position.z < head.z - 0.5);
    if (next) aimAt(next.position);
  });
  results['ring-run offers replay'] = G.input.targets.length === 2;

  // Ring Run: hold still and aim away, which should lose.
  G.save.data.patches = {};
  pick(0);
  G.input.mouseNdc.set(0.95, 0.95);
  step(60, () => G.input.mouseNdc.set(0.95, 0.95));
  results['ring-run loss gives no patch'] = !G.save.hasPatch('ring-run');
  G.save.earnPatch('ring-run');

  // Drone Range: never firing should lose, then shooting should win.
  await enter('drone-range');
  pick(0);
  const drones = () => root().children.filter((c) => c.isGroup && c.children[0]?.geometry?.type === 'OctahedronGeometry');
  step(90);
  results['drone-range loss shows menu'] = G.input.targets.length === 2 && !G.save.hasPatch('drone-range');
  pick(0);
  let frame = 0;
  results['drone-range win'] = untilPatch('drone-range', 120, () => {
    frame += 1;
    const list = drones();
    if (!list.length) return;
    aimAt(list[0].position);
    if (frame % 5 === 0) click();
  });

  // Pulse Line: tap the matching key as each orb reaches its ring.
  await enter('pulse-line');
  pick(0);
  const KEYS = { '-0.46': 'KeyD', '-0.17': 'KeyF', 0.17: 'KeyJ', 0.46: 'KeyK' };
  results['pulse-line win'] = untilPatch('pulse-line', 60, () => {
    for (const m of root().children) {
      if (m.geometry?.type === 'IcosahedronGeometry' && m.position.z > -1.0 && m.position.z < -0.6) {
        tap(KEYS[m.position.x]);
      }
    }
  });

  // Rune Hollow: watch the stones, then repeat them.
  await enter('rune-hollow');
  pick(5);
  const stones = G.input.targets.slice(0, 5).map((t) => t.obj);
  let seen = [];
  let last = stones.map(() => 0);
  let quiet = 0;
  results['rune-hollow win'] = untilPatch('rune-hollow', 90, () => {
    stones.forEach((s, i) => {
      const glow = s.material.emissive.g;
      if (glow > last[i] + 0.01) { seen.push(i); quiet = 0; }
      last[i] = glow;
    });
    quiet += DT;
    if (seen.length && quiet > 1.2) {
      for (const i of seen) {
        aimAt(worldPos(stones[i]));
        step(DT * 2);
        click();
        step(DT * 2);
      }
      seen = [];
      last = stones.map((s) => s.material.emissive.g);
      quiet = 0;
      // Our own clicks flash the stones, so let them settle before watching again.
      step(0.5, () => { last = stones.map((s) => s.material.emissive.g); });
    }
  });

  // Block Yard: place twelve blocks, then remove one.
  await enter('block-yard');
  const cells = () => G.save.world('block-yard')?.cells.length ?? 0;
  G.input.mouseNdc.set(-0.2, -0.45);
  for (let i = 0; i < 12; i++) {
    step(DT * 2);
    click();
    step(DT * 2);
  }
  const placed = cells();
  results['block-yard places and earns'] = G.save.hasPatch('block-yard') && placed > 12;
  click(2);
  step(DT * 3);
  results['block-yard removes'] = cells() === placed - 1;

  // Orbit Hoops: lob the ball ahead of the moving hoop.
  await enter('orbit-hoops');
  pick(0);
  const hoops = G.world.debug;
  const CHARGE_FRAMES = 11;
  const speed = 4 + (CHARGE_FRAMES + 1) * DT * 8;
  let lastX = hoops.hoop.position.x;
  let tries = 0;
  while (!G.save.hasPatch('orbit-hoops') && tries < 60) {
    tries += 1;
    G.canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
    for (let i = 0; i < CHARGE_FRAMES; i++) {
      const vx = (hoops.hoop.position.x - lastX) / DT;
      lastX = hoops.hoop.position.x;
      const head = G.camera.getWorldPosition(G.rig.position.clone());
      const dy = 3 - head.y;
      const predictX = hoops.hoop.position.x + vx * 1.25;
      const d = Math.hypot(predictX - head.x, -6.5 - head.z);
      const root2 = Math.sqrt(speed ** 4 - hoops.g * (hoops.g * d * d + 2 * dy * speed * speed));
      const pitch = Math.atan2(speed * speed - root2, hoops.g * d);
      const aim = head.clone();
      aim.x += ((predictX - head.x) / d) * Math.cos(pitch) * 10;
      aim.z += ((-6.5 - head.z) / d) * Math.cos(pitch) * 10;
      aim.y += Math.sin(pitch) * 10;
      aimAt(aim);
      step(DT);
    }
    dispatchEvent(new MouseEvent('mouseup', { button: 0 }));
    step(1.6);
    lastX = hoops.hoop.position.x;
  }
  results['orbit-hoops win'] = G.save.hasPatch('orbit-hoops');

  // Gloom Manor: follow the path to each key, then to the door.
  await enter('gloom-manor');
  pick(0);
  G.input.keys.add('KeyW');
  results['gloom-manor win'] = untilPatch('gloom-manor', 240, () => {
    const path = G.world.debug.target();
    const next = path[1] ?? path[0];
    if (next) G.rig.rotation.y = Math.atan2(G.rig.position.x - next[0], G.rig.position.z - next[1]);
    if (G.world.debug.distance() < 5 && G.world.debug.canFlash()) click();
  });
  G.input.keys.delete('KeyW');

  // Tide Cove: cast, wait for a bite, reel in, five times.
  await enter('tide-cove');
  G.input.mouseNdc.set(0, -0.2);
  results['tide-cove win'] = untilPatch('tide-cove', 120, () => {
    const state = G.world.debug.state();
    if (state === 'idle' || state === 'bite') click();
  });

  // Avatar Studio: change options, buy an unlock, pick a color and change settings.
  await enter('avatar-studio');
  const TAB = { Body: 3, Style: 4, Colors: 5, Gear: 6, Plaza: 7, Comfort: 8 };
  const FIRST_ROW = 9;
  const before = G.prefs.look.head;
  pick(FIRST_ROW + 1);
  results['studio changes the head'] = G.prefs.look.head !== before;
  pick(TAB.Style);
  G.save.data.coins = 0;
  pick(FIRST_ROW + 2); // cycle the hat backward onto the crown, which is locked
  results['studio try-on does not buy'] = G.prefs.look.hat === 'none';
  pick(FIRST_ROW + 4); // the Buy button, with no coins
  results['studio refuses without coins'] = G.prefs.look.hat === 'none' && !G.save.isUnlocked('hat:crown');
  G.save.data.coins = 100;
  pick(FIRST_ROW + 4);
  results['studio buys an unlock'] = G.prefs.look.hat === 'crown' && G.save.coins === 40 && G.save.isUnlocked('hat:crown');
  pick(TAB.Colors);
  const oldColor = G.prefs.look.primary;
  pick(FIRST_ROW);
  pick(0); // the color picker
  results['studio color picker'] = G.prefs.look.primary !== oldColor;
  pick(TAB.Comfort);
  const oldSpeed = G.prefs.comfort.speed;
  pick(FIRST_ROW + 1);
  results['studio changes settings'] = G.prefs.comfort.speed > oldSpeed;
  pick(TAB.Plaza);
  pick(FIRST_ROW); // sky, backward to My colors
  pick(FIRST_ROW + 4); // floor, backward
  results['studio changes the plaza'] = G.prefs.plaza.sky === 'custom' && G.prefs.plaza.floor !== 'quilt';

  // Every catalog option has to build, and bad data from another player can't cause harm.
  const { Avatar } = await import('/src/engine/avatar.js');
  const { CATALOG, sanitizeLook, DEFAULT_PREFS, sanitizeName, displayName } = await import('/src/engine/prefs.js');
  let built = 0;
  for (const key of ['head', 'eyes', 'hat', 'body', 'back', 'hands', 'aura']) {
    for (const option of CATALOG[key]) {
      const avatar = new Avatar({ ...DEFAULT_PREFS.look, [key]: option.id }, 'Test');
      avatar.update(DT, G.camera.position);
      avatar.dispose();
      built += 1;
    }
  }
  results['every avatar option builds'] = built > 30;
  const evil = sanitizeLook({ head: '<script>', hat: 42, primary: 'red', headSize: 1e9, bodySize: NaN, aura: null });
  results['bad avatar data is cleaned'] = evil.head === 'orb' && evil.hat === 'none' && evil.primary === DEFAULT_PREFS.look.primary
    && evil.headSize === 1.4 && evil.bodySize === 1;
  results['bad names are cleaned'] = displayName(sanitizeName(['x', 99999])).length > 0 && displayName(sanitizeName(null)).length > 0;

  // The plaza still builds with the changed settings.
  G.prefs.plaza.floor = 'quilt';

  // The finished quilt opens the gate, and walking into portals works.
  await enter('hub');
  results['quilt complete'] = G.quilt.complete;
  G.input.keys.add('KeyS');
  step(3.5);
  G.input.keys.delete('KeyS');
  await settle();
  results['walk through source gate'] = G.currentId === 'source-room';
  G.input.keys.add('KeyS');
  step(2);
  G.input.keys.delete('KeyS');
  await settle();
  results['walk through exit portal'] = G.currentId === 'hub';

  // A broken community world must not take the game down.
  G.worlds.set('broken', { id: 'broken', hidden: true, create() { throw new Error('expected test error'); } });
  G.enter('broken');
  await settle();
  await null;
  await settle();
  G.worlds.delete('broken');
  results['broken world returns to hub'] = G.currentId === 'hub';

  // The starter template loads and earns its patch.
  const template = (await import('/src/worlds/_template.js')).default;
  G.worlds.set(template.id, template);
  await enter(template.id);
  pick(0);
  results['template world works'] = G.save.hasPatch(template.id);
  G.worlds.delete(template.id);
  G.save.data.patches[template.id] = undefined;
  await enter('hub');

  Object.assign(G.prefs, JSON.parse(savedPrefs));
  G.savePrefs();
  G.renderer.render = realRender;
  G.renderer.setAnimationLoop(() => G.frame());
  const failed = Object.entries(results).filter(([, ok]) => !ok).map(([name]) => name);
  return { passed: Object.keys(results).length - failed.length, failed, results };
}
