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

  G.renderer.render = realRender;
  G.renderer.setAnimationLoop(() => G.frame());
  const failed = Object.entries(results).filter(([, ok]) => !ok).map(([name]) => name);
  return { passed: Object.keys(results).length - failed.length, failed, results };
}
