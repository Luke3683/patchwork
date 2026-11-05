import * as THREE from 'three';
import { Panel, makeCard, BODY, DISPLAY } from '../engine/ui.js';
import { disposeTree } from '../engine/kit.js';
import { Avatar } from '../engine/avatar.js';
import { CATALOG, NAME_A, NAME_B } from '../engine/prefs.js';

const ACCENT = '#27e0cc';
const choice = (label, group, key, list = CATALOG[key]) => ({ kind: 'choice', label, group, key, list });
const number = (label, group, key, min, max, step, format = (v) => String(v)) => ({ kind: 'number', label, group, key, min, max, step, format });
const paint = (label, group, key) => ({ kind: 'color', label, group, key });
const percent = (v) => `${Math.round(v)}%`;

// Each tab is a list of rows. Adding a row here is all it takes to expose a new setting.
const TABS = {
  Body: [
    choice('Head', 'look', 'head'),
    choice('Body', 'look', 'body'),
    choice('Hands', 'look', 'hands'),
    number('Head size', 'look', 'headSize', 0.8, 1.4, 0.05, (v) => `${Math.round(v * 100)}%`),
    number('Body size', 'look', 'bodySize', 0.8, 1.25, 0.05, (v) => `${Math.round(v * 100)}%`),
    { kind: 'name', label: 'First name', index: 0, list: NAME_A },
    { kind: 'name', label: 'Last name', index: 1, list: NAME_B },
  ],
  Style: [
    choice('Eyes', 'look', 'eyes'),
    choice('Hat', 'look', 'hat'),
    choice('Back', 'look', 'back'),
    choice('Aura', 'look', 'aura'),
  ],
  Colors: [
    paint('Main color', 'look', 'primary'),
    paint('Second color', 'look', 'secondary'),
    paint('Glow color', 'look', 'accent'),
    paint('Skin', 'look', 'skin'),
    paint('Hair', 'look', 'hair'),
  ],
  Gear: [
    choice('Blaster', 'gear', 'blaster'),
    paint('Blaster color', 'gear', 'blasterColor'),
    paint('Sled color', 'gear', 'sledColor'),
    paint('Laser color', 'gear', 'laserColor'),
    paint('Glove color', 'gear', 'gloveColor'),
    paint('Ball color', 'gear', 'ballColor'),
  ],
  Plaza: [
    choice('Sky', 'plaza', 'sky'),
    paint('Sky top', 'plaza', 'skyTop'),
    paint('Sky horizon', 'plaza', 'skyHorizon'),
    choice('Floor', 'plaza', 'floor'),
    choice('Stars', 'plaza', 'stars'),
  ],
  Comfort: [
    number('Move speed', 'comfort', 'speed', 1.5, 5, 0.25, (v) => `${v.toFixed(2)} m/s`),
    choice('Turning', 'comfort', 'turn'),
    number('Snap angle', 'comfort', 'snap', 15, 45, 15, (v) => `${v} degrees`),
    number('Desktop view', 'comfort', 'fov', 60, 100, 5, (v) => `${v} degrees`),
    number('Mouse speed', 'comfort', 'sensitivity', 0.5, 2, 0.1, (v) => `${Math.round(v * 100)}%`),
    choice('Graphics', 'comfort', 'graphics'),
    choice('VR tunnel view', 'comfort', 'vignette'),
    number('Game volume', 'audio', 'volume', 0, 100, 10, percent),
    number('Voice volume', 'audio', 'voice', 0, 100, 10, percent),
  ],
};

export default {
  id: 'avatar-studio',
  name: 'Avatar Studio',
  hidden: true,

  create(k) {
    const { game, root, save } = k;
    k.sky({ top: 0x0a2233, mid: 0x14505e, horizon: 0xff9e7a, bottom: 0x07161f });
    k.lights({ sky: 0xfff0f5, ground: 0x5b3b70, sun: 0xfff4e0, ambient: 1.9, direct: 1.8, dir: [0.2, 1, 0.8] });
    k.fog(0x14505e, 14, 70);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(9, 32).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0x10303c }),
    );
    root.add(floor);

    // The preview stands on a turntable, so you can see what's on your back too.
    const stage = new THREE.Vector3(1.75, 0, -2.5);
    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 0.72, 24), new THREE.MeshLambertMaterial({ color: 0xff5c4d }));
    pedestal.position.copy(stage).setY(0.36);
    root.add(pedestal);

    const tryOn = {}; // items being tried on but not bought yet
    const previewLook = () => {
      const look = { ...game.prefs.look };
      for (const [path, id] of Object.entries(tryOn)) {
        const [group, key] = path.split('.');
        if (group === 'look') look[key] = id;
      }
      return look;
    };
    const preview = new Avatar(previewLook(), game.net.myName);
    root.add(preview.group);
    const spinQ = new THREE.Quaternion();
    const UP = new THREE.Vector3(0, 1, 0);
    const offset = new THREE.Vector3();
    const head = new THREE.Vector3();

    const panel = new THREE.Group();
    panel.position.set(-1.25, 0, -2.3);
    panel.rotation.y = 0.32;
    root.add(panel);

    let tab = 'Body';
    let picking = null; // the color row being edited
    let targets = [];

    const pref = (row) => game.prefs[row.group][row.key];
    const unlockKey = (row, id) => `${row.key}:${id}`;
    const owned = (row, option) => option.cost === 0 || save.isUnlocked(unlockKey(row, option.id));
    const commit = (group, key, value) => {
      game.prefs[group][key] = value;
      game.savePrefs();
      if (group === 'look') {
        preview.setLook(previewLook());
        game.net.broadcastState();
      }
    };

    const addButton = (label, onSelect, x, y, opts) => {
      const face = k.button(label, onSelect, opts);
      face.position.set(x, y, 0.01);
      panel.add(face);
      targets.push(face);
      return face;
    };

    const cycle = (row, dir) => {
      const path = `${row.group}.${row.key}`;
      const current = tryOn[path] ?? pref(row);
      const i = row.list.findIndex((o) => o.id === current);
      const next = row.list[(i + dir + row.list.length) % row.list.length];
      if (owned(row, next)) {
        delete tryOn[path];
        commit(row.group, row.key, next.id);
      } else {
        tryOn[path] = next.id;
        if (row.group === 'look') preview.setLook(previewLook());
      }
      rebuild();
    };

    const buy = (row, option) => {
      if (!save.buy(unlockKey(row, option.id), option.cost)) {
        k.sound.play('miss');
        k.toast('Not enough coins', `${option.name} costs ${option.cost}. Beat worlds to earn more.`, ACCENT);
        return;
      }
      k.sound.play('patch');
      delete tryOn[`${row.group}.${row.key}`];
      commit(row.group, row.key, option.id);
      rebuild();
    };

    const addRow = (row, y) => {
      const label = new Panel({ width: 1.45, height: 0.2, ppm: 380 });
      let value = '';
      let priced = null;
      let swatch = null;
      if (row.kind === 'choice') {
        const current = tryOn[`${row.group}.${row.key}`] ?? pref(row);
        const option = row.list.find((o) => o.id === current) ?? row.list[0];
        value = option.name;
        if (!owned(row, option)) priced = option;
      } else if (row.kind === 'number') {
        value = row.format(pref(row));
      } else if (row.kind === 'name') {
        value = row.list[game.net.profile.name[row.index]];
      } else {
        swatch = `#${pref(row).toString(16).padStart(6, '0')}`;
      }
      label.paint((g, W, H) => {
        g.fillStyle = picking === row ? '#3a2a5e' : '#07161f';
        g.beginPath();
        g.roundRect(0, 0, W, H, 10);
        g.fill();
        g.textBaseline = 'middle';
        g.fillStyle = '#a9c0c7';
        g.font = `${H * 0.32}px ${BODY}`;
        g.fillText(row.label, 14, H / 2, W * 0.45);
        g.fillStyle = priced ? '#ff8a4c' : '#f4efe2';
        g.font = `700 ${H * 0.34}px ${BODY}`;
        g.fillText(priced ? `${value} (${priced.cost})` : value, W * 0.46, H / 2, W * 0.52);
        if (swatch) {
          g.fillStyle = swatch;
          g.fillRect(W * 0.46, H * 0.2, W * 0.46, H * 0.6);
        }
      });
      label.position.set(-0.28, y, 0);
      panel.add(label);

      const side = { accent: ACCENT, width: 0.2 };
      if (row.kind === 'color') {
        addButton('Pick', () => { picking = picking === row ? null : row; rebuild(); }, 0.72, y, { accent: ACCENT, width: 0.42 });
        return;
      }
      if (row.kind === 'choice') {
        addButton('<', () => cycle(row, -1), 0.6, y, side);
        addButton('>', () => cycle(row, 1), 0.83, y, side);
        if (priced) addButton(`Buy ${priced.cost}`, () => buy(row, priced), 1.28, y, { accent: '#ff5c4d', width: 0.62 });
      } else if (row.kind === 'number') {
        const change = (dir) => {
          const raw = pref(row) + dir * row.step;
          const stepped = Math.round(raw / row.step) * row.step;
          commit(row.group, row.key, Math.min(row.max, Math.max(row.min, Number(stepped.toFixed(3)))));
          rebuild();
        };
        addButton('<', () => change(-1), 0.6, y, side);
        addButton('>', () => change(1), 0.83, y, side);
      } else {
        const change = (dir) => {
          const name = [...game.net.profile.name];
          name[row.index] = (name[row.index] + dir + row.list.length) % row.list.length;
          game.net.setName(name);
          preview.setName(game.net.myName);
          rebuild();
        };
        addButton('<', () => change(-1), 0.6, y, side);
        addButton('>', () => change(1), 0.83, y, side);
      }
    };

    // The color picker: any hue across, light to dark top to bottom, plain grays on the right.
    const picker = new Panel({ width: 1.3, height: 0.86, ppm: 200 });
    const GRAY_FROM = 0.88;
    picker.paint((g, W, H) => {
      const image = g.createImageData(W, H);
      const c = new THREE.Color();
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const u = x / W;
          const l = 1 - y / H;
          if (u < GRAY_FROM) c.setHSL(u / GRAY_FROM, 1, l, THREE.SRGBColorSpace);
          else c.setRGB(l, l, l, THREE.SRGBColorSpace);
          const hex = c.getHex();
          const i = (x + y * W) * 4;
          image.data[i] = (hex >> 16) & 255;
          image.data[i + 1] = (hex >> 8) & 255;
          image.data[i + 2] = hex & 255;
          image.data[i + 3] = 255;
        }
      }
      g.putImageData(image, 0, 0);
    });
    picker.material.transparent = false;
    picker.position.set(0.15, 1.05, -2.15);
    picker.visible = false;
    root.add(picker);
    const picked = new THREE.Color();
    k.input.addTarget(picker, {
      onSelect: (hand) => {
        const uv = hand.hit?.uv;
        if (!uv || !picking) return;
        if (uv.x < GRAY_FROM) picked.setHSL(uv.x / GRAY_FROM, 1, uv.y, THREE.SRGBColorSpace);
        else picked.setRGB(uv.y, uv.y, uv.y, THREE.SRGBColorSpace);
        k.sound.play('select');
        commit(picking.group, picking.key, picked.getHex());
        rebuild();
      },
    });

    function rebuild() {
      targets.forEach((t) => k.input.removeTarget(t));
      targets = [];
      disposeTree(panel);
      panel.clear();

      const coins = new Panel({ width: 1.1, height: 0.22, ppm: 340 });
      coins.paint((g, W, H) => {
        g.fillStyle = '#07161f';
        g.beginPath();
        g.roundRect(0, 0, W, H, 12);
        g.fill();
        g.fillStyle = '#ff5c4d';
        g.font = `${H * 0.44}px ${DISPLAY}`;
        g.textBaseline = 'middle';
        g.fillText(`${save.coins} coins`, 16, H / 2);
      });
      coins.position.set(-0.45, 2.84, 0);
      panel.add(coins);
      addButton('Done', () => game.goHome(), 0.55, 2.84, { accent: '#f4efe2', width: 0.5 });

      Object.keys(TABS).forEach((name, i) => {
        const x = -0.66 + (i % 3) * 0.66;
        const y = 2.58 - Math.floor(i / 3) * 0.23;
        addButton(name, () => {
          tab = name;
          picking = null;
          rebuild();
        }, x, y, { accent: name === tab ? ACCENT : '#a9c0c7', width: 0.62 });
      });
      TABS[tab].forEach((row, i) => addRow(row, 2.04 - i * 0.235));
      picker.visible = !!picking;
    }

    const hint = makeCard({
      title: 'Try anything on',
      body: 'Locked items show on your avatar for free. Buy the ones you like with coins from beating worlds.',
      width: 1.5,
      accent: ACCENT,
    });
    hint.position.set(stage.x + 0.1, 2.72, stage.z);
    hint.rotation.y = -0.4;
    root.add(hint);

    k.exitPortal(new THREE.Vector3(0, 0, 3.4)).group.lookAt(0, 0, 0);
    k.spawnSocial(0, 0.1);
    k.setMove(true);
    k.boundsCircle(6);
    rebuild();

    return {
      update(dt, t) {
        const yaw = Math.PI + 0.4 + Math.sin(t * 0.5) * 1.5;
        spinQ.setFromAxisAngle(UP, yaw);
        const pose = preview.target;
        pose.head.set(stage.x, 1.72, stage.z);
        pose.headQ.copy(spinQ);
        for (const [side, s] of [['left', -1], ['right', 1]]) {
          offset.set(s * 0.32, 1.12, -0.12).applyQuaternion(spinQ).add(stage);
          pose[side].copy(offset);
          pose[`${side}Q`].copy(spinQ);
        }
        preview.update(dt, k.head(head));
      },
    };
  },
};
