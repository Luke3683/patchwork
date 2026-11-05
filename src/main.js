import { Game } from './engine/game.js';
import { worlds } from './worlds/index.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

async function boot() {
  // ?emulate fakes a Quest 3 in the browser, so you can test VR code without a headset.
  if (params.has('emulate')) {
    const { XRDevice, metaQuest3 } = await import('https://cdn.jsdelivr.net/npm/iwer@2.0.1/build/iwer.module.js');
    const device = new XRDevice(metaQuest3);
    device.installRuntime();
    window.xrDevice = device;
  }

  await Promise.race([
    Promise.all([document.fonts.load('40px "Bowlby One"'), document.fonts.load('20px "Atkinson Hyperlegible"')]),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]).catch(() => {});

  const game = new Game($('scene'), worlds);
  window.patchwork = game; // handy in the console

  if (params.get('patches') === 'all') {
    game.portalWorlds.forEach((w) => game.save.earnPatch(w.id));
  }
  if (game.worlds.has(params.get('world'))) game.startWorld = params.get('world');

  renderSwatches(game);
  await game.enter('hub');

  const hideTitle = () => document.body.classList.add('playing');
  const showTitle = () => {
    document.body.classList.remove('playing');
    renderSwatches(game);
  };

  $('play-desktop').addEventListener('click', () => {
    hideTitle();
    game.input.requestLock();
    game.start();
  });

  game.onSessionEnd = showTitle;
  const vrButton = $('enter-vr');
  let vrSupported = false;
  try {
    vrSupported = await navigator.xr?.isSessionSupported('immersive-vr');
  } catch { /* the frame or browser refuses WebXR */ }
  if (vrSupported) {
    vrButton.hidden = false;
    $('vr-note').textContent = 'Headset found. Put it on, then press Enter VR.';
    vrButton.addEventListener('click', async () => {
      try {
        hideTitle();
        await game.enterVR();
      } catch (err) {
        console.error(err);
        showTitle();
        $('vr-note').textContent = `The headset session could not start: ${err.message}`;
      }
    });
  } else {
    $('vr-note').textContent = 'No headset detected in this browser. To play in VR, open the game in your headset\'s browser.';
  }

  $('reset').addEventListener('click', () => {
    game.save.reset();
    renderSwatches(game);
    game.enter('hub');
  });
}

function renderSwatches(game) {
  const row = $('quilt-row');
  row.replaceChildren();
  const { list, done } = game.quilt;
  for (const world of list) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 96;
    canvas.className = 'swatch';
    canvas.title = world.name;
    const earned = game.save.hasPatch(world.id);
    const g = canvas.getContext('2d');
    if (earned) {
      world.patch(g, 96);
    } else {
      g.fillStyle = `#${world.color.toString(16).padStart(6, '0')}`;
      g.fillRect(0, 0, 96, 96);
      canvas.classList.add('unearned');
    }
    row.append(canvas);
  }
  $('quilt-count').textContent = `${done.length} of ${list.length} patches earned`;
  $('reset').hidden = done.length === 0;
}

boot().catch((err) => {
  console.error(err);
  $('vr-note').textContent = `The game could not start: ${err.message}`;
});
