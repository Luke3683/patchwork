import { Game } from './engine/game.js';
import { worlds } from './worlds/index.js';
import { Net } from './engine/net.js';

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

  setupRooms(game);

  $('reset').addEventListener('click', () => {
    game.save.reset();
    renderSwatches(game);
    game.enter('hub');
  });
}

function setupRooms(game) {
  const { net } = game;
  const status = $('room-status');
  const defaultStatus = status.textContent;
  const invite = Net.cleanCode(params.get('room'));
  const idleStatus = invite
    ? `You've been invited to room ${invite}. Press Join if you trust who sent this. People in the room can see your IP address.`
    : defaultStatus;
  if (invite) $('room-code').value = invite;

  const render = () => {
    const live = net.status === 'online' || net.status === 'connecting';
    $('room-setup').hidden = live;
    $('room-live').hidden = !live;
    $('room-name').textContent = net.code ?? '';
    $('room-mic').textContent = net.micOn ? 'Turn off mic' : 'Turn on mic';
    if (net.status === 'failed') status.textContent = net.error;
    else if (net.status === 'connecting') status.textContent = 'Connecting…';
    else if (net.status === 'online') {
      const count = net.peers.size;
      status.textContent = count
        ? `You are ${net.myName}. ${count} friend${count > 1 ? 's are' : ' is'} connected.`
        : `You are ${net.myName}. Waiting for friends. Send them the invite link. If nobody appears, one of your networks may be blocking direct connections.`;
    } else {
      status.textContent = idleStatus;
    }
    document.body.classList.toggle('in-room', live);
  };
  net.onChange = render;

  const join = async (code) => {
    game.sound.unlock();
    try {
      await net.join(code);
    } catch (err) {
      status.textContent = err.message;
    }
  };
  $('room-create').addEventListener('click', () => join(Net.makeCode()));
  $('room-join').addEventListener('click', () => join($('room-code').value));
  $('room-code').addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') join($('room-code').value);
  });
  $('room-leave').addEventListener('click', () => net.leave());
  $('room-copy').addEventListener('click', async () => {
    const link = `${location.origin}${location.pathname}?room=${net.code}`;
    try {
      await navigator.clipboard.writeText(link);
      status.textContent = 'Invite link copied. Send it to your friends.';
    } catch {
      status.textContent = `Send your friends this link: ${link}`;
    }
  });
  $('room-mic').addEventListener('click', async () => {
    game.sound.unlock();
    try {
      await net.setMic(!net.micOn);
    } catch (err) {
      console.warn(err);
      status.textContent = 'Your browser blocked the microphone or none was found.';
    }
  });
  addEventListener('pagehide', () => net.leave());
  render();
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
  $('quilt-count').textContent = `${done.length} of ${list.length} patches earned · ${game.save.coins} coins`;
  $('reset').hidden = done.length === 0;
}

boot().catch((err) => {
  console.error(err);
  $('vr-note').textContent = `The game could not start: ${err.message}`;
});
