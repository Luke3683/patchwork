import * as THREE from 'three';
import { Panel, makeCard, DISPLAY, BODY } from '../engine/ui.js';
import { disposeTree } from '../engine/kit.js';
import { SKIES, FLOORS } from '../engine/prefs.js';

const PLAZA = 11;
const QUILT_COLS = 5;
const CELL = 240;

export const hexString = (hex) => `#${hex.toString(16).padStart(6, '0')}`;

/** Paints the quilt: one patch per world, plus an empty one for whoever builds the next. */
export function paintQuilt(g, game) {
  const { list } = game.quilt;
  const slots = [...list, null];
  g.fillStyle = '#231b3d';
  g.fillRect(0, 0, g.canvas.width, g.canvas.height);
  slots.forEach((world, i) => {
    const x = (i % QUILT_COLS) * CELL;
    const y = Math.floor(i / QUILT_COLS) * CELL;
    g.save();
    g.translate(x + 8, y + 8);
    const s = CELL - 16;
    g.beginPath();
    g.rect(0, 0, s, s);
    g.clip();
    if (world && game.save.hasPatch(world.id)) {
      world.patch(g, s);
    } else {
      g.fillStyle = '#2d2450';
      g.fillRect(0, 0, s, s);
      g.fillStyle = '#6a5f92';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `${s * 0.11}px ${DISPLAY}`;
      if (world) {
        g.fillText(world.name.split(' ')[0], s / 2, s / 2);
      } else {
        g.fillText('YOUR', s / 2, s / 2 - s * 0.08);
        g.fillText('WORLD', s / 2, s / 2 + s * 0.08);
      }
    }
    g.restore();
    g.strokeStyle = '#f4efe2';
    g.lineWidth = 3;
    g.setLineDash([12, 8]);
    g.strokeRect(x + 8, y + 8, CELL - 16, CELL - 16);
    g.setLineDash([]);
  });
}

export default {
  id: 'hub',
  name: 'The Crossroads',
  hidden: true,

  create(k) {
    const { game, root } = k;
    const quilt = game.quilt;

    // Sky, floor and stars all come from the player's settings in the Avatar Studio.
    const { plaza } = k.prefs;
    const sky = plaza.sky === 'custom'
      ? { top: plaza.skyTop, mid: new THREE.Color(plaza.skyTop).lerp(new THREE.Color(plaza.skyHorizon), 0.45).getHex(), horizon: plaza.skyHorizon, bottom: plaza.skyTop }
      : SKIES[plaza.sky];
    const FABRICS = FLOORS[plaza.floor];
    k.sky({ ...sky, stars: plaza.stars === 'on' ? 500 : 0 });
    k.lights({ sky: 0xbfe8ff, ground: 0x2f5d66, sun: 0xffc48a, ambient: 1.7, direct: 2.2, dir: [-0.6, 0.45, 0.8] });
    k.fog(new THREE.Color(sky.mid).lerp(new THREE.Color(sky.horizon), 0.35).getHex(), 45, 300);
    k.ambience([110, 164.8, 220, 277.2], 0.014);

    // The plaza floor is itself a quilt.
    const tiles = [];
    const S = 1.5;
    for (let x = -8; x <= 8; x++) {
      for (let z = -8; z <= 8; z++) {
        if (Math.hypot(x * S, z * S) < PLAZA - 0.5) tiles.push([x * S, z * S]);
      }
    }
    const fabric = (a, b) => FABRICS[Math.abs((a * 7 + b * 13 + a * b * 3)) % FABRICS.length];
    k.instanced(
      new THREE.BoxGeometry(S - 0.06, 0.14, S - 0.06),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      tiles.length,
      (d, i) => {
        d.position.set(tiles[i][0], -0.07, tiles[i][1]);
        return fabric(tiles[i][0] / S, tiles[i][1] / S);
      },
    );
    const rockMat = new THREE.MeshLambertMaterial({ color: 0x3a2b52, flatShading: true });
    const seam = new THREE.Mesh(new THREE.CylinderGeometry(PLAZA, PLAZA - 0.3, 0.3, 28), rockMat);
    seam.position.y = -0.2;
    root.add(seam);
    const rock = new THREE.Mesh(new THREE.ConeGeometry(PLAZA - 0.3, 16, 12, 2), rockMat);
    rock.rotation.x = Math.PI;
    rock.position.y = -8.3;
    root.add(rock);

    // Far-off islands give the sky some depth.
    const islands = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3;
      const dist = 42 + (i % 3) * 26;
      const size = 3 + (i % 4) * 2.2;
      const island = new THREE.Mesh(
        new THREE.DodecahedronGeometry(size, 0),
        new THREE.MeshLambertMaterial({ color: FABRICS[i % FABRICS.length], flatShading: true }),
      );
      island.scale.y = 0.6;
      island.position.set(Math.sin(a) * dist, -6 + (i % 5) * 7, Math.cos(a) * dist);
      island.userData = { y: island.position.y, phase: i * 1.7 };
      root.add(island);
      islands.push(island);
    }

    // The quilt hangs above the portals and fills in as you play.
    const rows = Math.ceil((quilt.list.length + 1) / QUILT_COLS);
    const quiltW = 9;
    const quiltH = (quiltW / QUILT_COLS) * rows;
    const banner = new Panel({ width: quiltW, height: quiltH, ppm: (QUILT_COLS * CELL) / quiltW });
    banner.material.transparent = false;
    banner.paint((g) => paintQuilt(g, game));
    banner.position.set(0, 4.7 + quiltH / 2, -10.2);
    root.add(banner);
    const wood = new THREE.MeshLambertMaterial({ color: 0x4a3324, flatShading: true });
    for (const x of [-quiltW / 2 - 0.2, quiltW / 2 + 0.2]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.17, 5.2 + quiltH, 6), wood);
      post.position.set(x, (5.2 + quiltH) / 2, -10.25);
      root.add(post);
    }
    const bar = new THREE.Mesh(new THREE.BoxGeometry(quiltW + 0.9, 0.2, 0.2), wood);
    bar.position.set(0, 4.85 + quiltH, -10.25);
    root.add(bar);

    // One portal per world, in an arc. Adding a world to the registry adds a portal here.
    const spawn = new THREE.Vector3(0, 0, 3);
    const arc = THREE.MathUtils.degToRad(100);
    quilt.list.forEach((world, i) => {
      const n = quilt.list.length;
      const a = n > 1 ? -arc + (i / (n - 1)) * arc * 2 : 0;
      const earned = game.save.hasPatch(world.id);
      const portal = k.portal({
        tint: world.color,
        accent: hexString(world.color),
        title: world.name,
        subtitle: `${world.genre} · ${world.comfort}${earned ? ' · Patch earned' : ''}`,
        position: new THREE.Vector3(Math.sin(a) * 9, 0, -Math.cos(a) * 9),
        onEnter: () => game.enter(world.id),
      });
      portal.group.lookAt(spawn);
    });

    // The Source Gate stays dark until the quilt is finished.
    const gate = k.portal({
      tint: quilt.complete ? 0xfff2c9 : 0x8c86a3,
      accent: '#fff2c9',
      title: 'The Source Gate',
      subtitle: quilt.complete ? 'Your quilt is finished. Step through.' : 'Opens when every patch is earned.',
      position: new THREE.Vector3(0, 0, 9.4),
      locked: !quilt.complete,
      radius: 1.5,
      onEnter: () => game.enter('source-room'),
    });
    gate.group.lookAt(0, 0, 0);

    const island = k.portal({
      tint: 0xff7a2e,
      accent: '#ff7a2e',
      title: 'Meridian',
      subtitle: 'The open world',
      position: new THREE.Vector3(0, 0, -3.6),
      radius: 1.5,
      onEnter: () => game.enter('meridian'),
    });
    island.group.lookAt(spawn);

    const studio = k.portal({
      tint: 0xffb7d5,
      accent: '#ffb7d5',
      title: 'Avatar Studio',
      subtitle: `Customize everything · ${k.save.coins} coins`,
      position: new THREE.Vector3(-3.3, 0, -1.3),
      radius: 0.95,
      onEnter: () => game.enter('avatar-studio'),
    });
    studio.group.lookAt(spawn);

    // The room board lists who's here, with a mute button for each person.
    const board = new THREE.Group();
    board.position.set(3.3, 0, -1.3);
    board.lookAt(spawn);
    root.add(board);
    let boardFaces = [];
    let boardVersion = -1;
    const rebuildBoard = () => {
      const { net } = game;
      boardVersion = net.rosterVersion;
      boardFaces.forEach((f) => k.input.removeTarget(f));
      boardFaces = [];
      disposeTree(board);
      board.clear();
      const peers = [...net.peers.values()];
      const header = makeCard({
        title: net.inRoom ? `Room ${net.code}` : 'Playing solo',
        body: net.inRoom
          ? `You are ${net.myName}. ${peers.length ? `${peers.length} friend${peers.length > 1 ? 's' : ''} connected.` : 'Waiting for friends to join.'}`
          : 'To play with friends, create or join a room from the title screen.',
        width: 1.9,
        accent: '#b8e986',
      });
      let y = 2.5 - header.geometry.parameters.height / 2;
      header.position.y = y;
      board.add(header);
      y -= header.geometry.parameters.height / 2;
      if (net.inRoom) {
        const mic = k.button(net.micOn ? 'Mic is on' : 'Mic is off', () => net.toggleMic(), { accent: net.micOn ? '#b8e986' : '#f4efe2', width: 0.9 });
        mic.position.set(0, y - 0.14, 0.01);
        board.add(mic);
        boardFaces.push(mic);
        y -= 0.28;
      }
      for (const peer of peers) {
        const where = game.worlds.get(peer.world)?.name ?? 'On the title screen';
        const row = new Panel({ width: 1.3, height: 0.2, ppm: 400 });
        row.paint((g, W, H) => {
          g.fillStyle = '#07161f';
          g.beginPath();
          g.roundRect(0, 0, W, H, 10);
          g.fill();
          g.fillStyle = '#f4efe2';
          g.font = `${H * 0.34}px ${BODY}`;
          g.textBaseline = 'middle';
          g.fillText(`${peer.nameText}${peer.mic ? ' (mic on)' : ''}`, 14, H * 0.32, W - 24);
          g.fillStyle = '#a9c0c7';
          g.font = `${H * 0.28}px ${BODY}`;
          g.fillText(where, 14, H * 0.72, W - 24);
        });
        row.position.set(-0.3, y - 0.14, 0);
        board.add(row);
        const mute = k.button(peer.muted ? 'Unmute' : 'Mute', () => net.setPeerMuted(peer.id, !peer.muted), { accent: peer.muted ? '#ff8a4c' : '#f4efe2', width: 0.55 });
        mute.position.set(0.68, y - 0.14, 0.01);
        board.add(mute);
        boardFaces.push(mute);
        y -= 0.24;
      }
    };
    rebuildBoard();

    const moves = k.isXR
      ? 'Move with the left stick and turn with the right. Press B or Y to come back here from any world.'
      : 'WASD to move, mouse to look. Press H to come back here from any world.';
    const sign = makeCard({
      title: 'Earn every patch',
      body: `Aim at a portal and pull the trigger, or walk straight into it. ${moves}`,
      width: 1.75,
      accent: '#ff5c4d',
    });
    sign.position.set(0, 1.12, 0.7);
    sign.rotation.x = -0.32;
    root.add(sign);

    k.spawnSocial(spawn.x, spawn.z);
    k.setMove(true);
    k.boundsCircle(PLAZA - 0.7);

    if (quilt.complete) k.toast('The quilt is finished', 'The Source Gate is open behind you.', '#fff2c9');

    return {
      update(dt, t) {
        if (boardVersion !== game.net.rosterVersion) rebuildBoard();
        for (const island of islands) {
          island.position.y = island.userData.y + Math.sin(t * 0.3 + island.userData.phase) * 0.8;
        }
      },
    };
  },
};
