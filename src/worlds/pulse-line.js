import * as THREE from 'three';

const BPM = 112;
const BEAT = 60 / BPM;
const BARS = 16;
const TRAVEL = 2;
const SPAWN_Z = -16;
const HIT_Z = -0.8;
const WIN_RATIO = 0.7;
const ACCENT = '#ff6f91';
const LANES = [
  { x: -0.46, y: -0.3, key: 'KeyD', color: 0xff6f91 },
  { x: -0.17, y: -0.1, key: 'KeyF', color: 0xff6f91 },
  { x: 0.17, y: -0.1, key: 'KeyJ', color: 0x63e6be },
  { x: 0.46, y: -0.3, key: 'KeyK', color: 0x63e6be },
];
const BAR_PATTERNS = [
  [0, 2],
  [0, 1, 2, 3],
  [0, 1, 2, 2.5, 3],
  [0, 0.5, 1.5, 2, 3],
  [0, 1, 1.5, 2, 3, 3.5],
];
const ROOTS = [110, 87.31, 130.81, 98];
const SCALE = [1, 1.2, 1.5, 1.8, 2];

/** The note chart comes from a fixed seed, so everyone plays the same song. */
function buildChart() {
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const notes = [];
  let lane = 1;
  for (let bar = 0; bar < BARS; bar++) {
    const pattern = BAR_PATTERNS[bar < 2 ? 0 : bar < 6 ? 1 : 2 + (bar % 3)];
    for (const beat of pattern) {
      lane = (lane + 1 + Math.floor(rand() * 3)) % LANES.length;
      notes.push({ t: (bar + 1) * 4 * BEAT + beat * BEAT, lane, bar, state: 'waiting', mesh: null });
    }
  }
  return notes;
}

export default {
  id: 'pulse-line',
  name: 'Pulse Line',
  genre: 'Rhythm',
  comfort: 'Comfortable',
  color: 0xff6f91,

  patch(g, s) {
    g.fillStyle = '#141338';
    g.fillRect(0, 0, s, s);
    [0.3, 0.75, 0.5, 0.9, 0.4, 0.65].forEach((h, i) => {
      g.fillStyle = i % 2 ? '#63e6be' : '#ff6f91';
      const w = s / 8;
      g.fillRect(s * 0.1 + i * w * 1.1, s * (0.9 - h * 0.8), w * 0.8, s * h * 0.8);
    });
  },

  create(k) {
    const { root, input, sound } = k;
    k.sky({ top: 0x090a24, mid: 0x141338, horizon: 0x22184d, bottom: 0x05061a, stars: 200 });
    k.lights({ sky: 0xbdbcff, ground: 0x241a4f, sun: 0xffffff, ambient: 1.6, direct: 1.6, dir: [0, 1, 1] });
    k.fog(0x101030, 8, 46);

    // The tunnel rings throb on every kick.
    const TUNNEL = 16;
    const hoops = k.instanced(
      new THREE.TorusGeometry(5.4, 0.07, 5, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
      TUNNEL,
      (d, i) => { d.position.z = -i * 3.4; return i % 2 ? 0xff6f91 : 0x63e6be; },
    );
    hoops.frustumCulled = false;
    const dummy = new THREE.Object3D();

    const track = new THREE.Mesh(
      new THREE.PlaneGeometry(2.1, 60).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x241f5c }),
    );
    track.position.set(0, 0, -28);
    root.add(track);

    const board = k.board({ width: 2.3, height: 0.5, at: [0, 3.4, -7], scale: 1.9 });

    const orbGeo = new THREE.IcosahedronGeometry(0.12, 1);
    const orbMats = LANES.map((l) => new THREE.MeshBasicMaterial({ color: l.color }));
    const gateGeo = new THREE.TorusGeometry(0.15, 0.008, 6, 24);
    const gates = LANES.map((l) => {
      const gate = new THREE.Mesh(gateGeo, new THREE.MeshBasicMaterial({ color: l.color, transparent: true, opacity: 0.6 }));
      gate.visible = false;
      root.add(gate);
      return gate;
    });

    const glove = () => new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xf4efe2 }),
    );

    let state = 'menu';
    let song = 0;
    let audioStart = 0;
    let notes = [];
    let nextSpawn = 0;
    let nextStep = 0;
    let hits = 0;
    let combo = 0;
    let beatEnv = 0;
    let eye = 1.6;
    let menu = null;
    const pos = new THREE.Vector3();
    const toOrb = new THREE.Vector3();
    const songLength = (BARS + 1) * 4 * BEAT;

    const updateBoard = () => {
      board.card({
        title: `${hits} / ${notes.length || '?'} hit`,
        body: combo > 1 ? `Combo ${combo}` : `Land ${Math.round(WIN_RATIO * 100)}% to earn the patch`,
        accent: ACCENT,
      });
    };
    const scheduleMusic = () => {
      if (!sound.running) return;
      const step = BEAT / 4;
      while (nextStep * step < song + 0.15 && nextStep * step < songLength) {
        const at = audioStart + nextStep * step;
        const bar = Math.floor(nextStep / 16);
        const root16 = ROOTS[bar % ROOTS.length];
        if (nextStep % 4 === 0) sound.tone({ f: 130, at, d: 0.16, g: 0.4, slide: -90 });
        if (nextStep % 4 === 2) sound.noise({ at, d: 0.05, g: 0.05, f: 6000, type: 'highpass' });
        if (nextStep % 8 === 4 && bar > 0) sound.noise({ at, d: 0.11, g: 0.09, f: 2200, type: 'bandpass' });
        if ([0, 3, 6, 8, 11, 14].includes(nextStep % 16)) {
          sound.tone({ f: root16, at, d: 0.18, type: 'sawtooth', g: 0.08 });
        }
        nextStep += 1;
      }
    };
    const hitNote = (note, hand) => {
      note.state = 'hit';
      note.mesh.getWorldPosition(pos);
      k.burst(pos, LANES[note.lane].color, 14, 3.5);
      root.remove(note.mesh);
      hits += 1;
      combo += 1;
      sound.tone({ f: ROOTS[note.bar % ROOTS.length] * 4 * SCALE[note.lane], d: 0.22, type: 'triangle', g: 0.16 });
      hand?.pulse(0.8, 45);
      updateBoard();
    };
    const showMenu = (title, body, label) => {
      input.lasers = true;
      menu = k.menu({
        title,
        body,
        accent: ACCENT,
        buttons: [
          { label, onSelect: start },
          { label: 'Leave', onSelect: () => k.game.goHome(), accent: '#f4efe2' },
        ],
      });
    };
    const start = () => {
      menu?.close();
      menu = null;
      for (const n of notes) if (n.mesh) root.remove(n.mesh);
      notes = buildChart();
      nextSpawn = 0;
      nextStep = 0;
      hits = 0;
      combo = 0;
      song = -0.4;
      audioStart = sound.now + 0.4;
      eye = k.head(pos).y;
      LANES.forEach((l, i) => {
        gates[i].position.set(l.x, eye + l.y, HIT_Z);
        gates[i].visible = true;
      });
      input.lasers = false;
      for (const hand of input.hands) {
        if (hand.source && !hand.mount.children.length) hand.mount.add(glove());
      }
      updateBoard();
      state = 'play';
    };

    k.spawn(0, 0);
    updateBoard();
    showMenu(
      'Pulse Line',
      'Punch each orb as it reaches its ring. Playing on desktop? Tap D F J K for the four rings, left to right. Land 70% of the song to earn the patch.',
      'Play',
    );

    return {
      update(dt) {
        // Tunnel motion and the kick-driven throb run all the time.
        beatEnv = Math.max(0, beatEnv - dt * 5);
        const scroll = state === 'play' ? song * 4 : k.game.time * 1.5;
        for (let i = 0; i < TUNNEL; i++) {
          dummy.position.set(0, 1.6, -(((i * 3.4 - scroll) % (TUNNEL * 3.4)) + TUNNEL * 3.4) % (TUNNEL * 3.4));
          dummy.scale.setScalar(1 + beatEnv * 0.09);
          dummy.updateMatrix();
          hoops.setMatrixAt(i, dummy.matrix);
        }
        hoops.instanceMatrix.needsUpdate = true;
        if (state !== 'play') return;

        const before = song;
        song = sound.running ? sound.now - audioStart : song + dt;
        if (Math.floor(song / BEAT) !== Math.floor(before / BEAT)) beatEnv = 1;
        scheduleMusic();

        while (nextSpawn < notes.length && notes[nextSpawn].t - TRAVEL <= song) {
          const n = notes[nextSpawn++];
          n.mesh = new THREE.Mesh(orbGeo, orbMats[n.lane]);
          n.state = 'flying';
          root.add(n.mesh);
        }

        const hands = input.hands.filter((h) => h.source);
        for (const n of notes) {
          if (n.state !== 'flying') continue;
          const l = LANES[n.lane];
          const progress = 1 - (n.t - song) / TRAVEL;
          n.mesh.position.set(l.x, eye + l.y, THREE.MathUtils.lerp(SPAWN_Z, HIT_Z, progress));
          n.mesh.rotation.y += dt * 4;

          for (const hand of hands) {
            toOrb.copy(n.mesh.position).sub(hand.origin);
            if (toOrb.length() < 0.27) {
              hitNote(n, hand);
              break;
            }
          }
          if (n.state === 'flying' && n.mesh.position.z > 0.5) {
            n.state = 'missed';
            root.remove(n.mesh);
            combo = 0;
            sound.play('miss');
            updateBoard();
          }
        }

        // Desktop players tap a key for a lane, or click with the cursor on the orb.
        if (!k.game.isXR) {
          LANES.forEach((l, laneIndex) => {
            if (!input.keyPressed(l.key)) return;
            const n = notes
              .filter((c) => c.state === 'flying' && c.lane === laneIndex && Math.abs(c.t - song) < 0.28)
              .sort((a, b) => Math.abs(a.t - song) - Math.abs(b.t - song))[0];
            if (n) hitNote(n);
          });
          const mouse = input.mouse;
          if (mouse.pressed) {
            for (const n of notes) {
              if (n.state !== 'flying' || Math.abs(n.t - song) > 0.32) continue;
              toOrb.copy(n.mesh.position).sub(mouse.origin);
              const along = toOrb.dot(mouse.dir);
              if (toOrb.lengthSq() - along * along < 0.05) {
                hitNote(n);
                break;
              }
            }
          }
        }

        if (song > songLength + 0.8) {
          state = 'menu';
          gates.forEach((gate) => { gate.visible = false; });
          for (const hand of hands) hand.mount.clear();
          const ratio = hits / notes.length;
          const won = ratio >= WIN_RATIO;
          if (won) k.complete();
          else sound.play('fail');
          showMenu(
            won ? 'In the pocket' : 'Off the beat',
            `You landed ${hits} of ${notes.length} (${Math.round(ratio * 100)}%).${won ? '' : ' You need 70%.'}`,
            'Play again',
          );
        }
      },
    };
  },
};
