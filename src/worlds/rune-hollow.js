import * as THREE from 'three';
import { Panel } from '../engine/ui.js';

const ROUNDS = [3, 4, 5];
const TONES = [261.63, 293.66, 329.63, 392, 440];
const ACCENT = '#b8e986';

// Invented glyphs, drawn as strokes in a 0-1 box.
const GLYPHS = [
  [[[0.5, 0.05], [0.5, 0.95]], [[0.5, 0.3], [0.85, 0.05]], [[0.5, 0.6], [0.15, 0.35]]],
  [[[0.2, 0.05], [0.8, 0.5], [0.2, 0.95]], [[0.8, 0.05], [0.8, 0.95]]],
  [[[0.15, 0.2], [0.85, 0.2]], [[0.5, 0.2], [0.5, 0.8]], [[0.15, 0.8], [0.85, 0.8]], [[0.15, 0.5], [0.3, 0.5]]],
  [[[0.5, 0.05], [0.9, 0.5], [0.5, 0.95], [0.1, 0.5], [0.5, 0.05]], [[0.5, 0.35], [0.5, 0.65]]],
  [[[0.2, 0.95], [0.2, 0.05], [0.8, 0.35], [0.2, 0.6]], [[0.2, 0.6], [0.85, 0.95]]],
];

function drawGlyph(g, strokes, x, y, s, color, width) {
  g.strokeStyle = color;
  g.lineWidth = width;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const stroke of strokes) {
    g.beginPath();
    stroke.forEach(([px, py], i) => {
      if (i) g.lineTo(x + px * s, y + py * s);
      else g.moveTo(x + px * s, y + py * s);
    });
    g.stroke();
  }
}

export default {
  id: 'rune-hollow',
  name: 'Rune Hollow',
  genre: 'Fantasy puzzle',
  comfort: 'Comfortable',
  color: 0xb8e986,

  patch(g, s) {
    g.fillStyle = '#1d3a33';
    g.fillRect(0, 0, s, s);
    drawGlyph(g, GLYPHS[3], s * 0.2, s * 0.2, s * 0.6, '#b8e986', s * 0.05);
  },

  create(k) {
    const { root, sound } = k;
    k.sky({ top: 0x0a1633, mid: 0x1c3355, horizon: 0x4c7a78, bottom: 0x0a1a1c, stars: 400 });
    k.lights({ sky: 0x9fc4e8, ground: 0x1e3a2c, sun: 0xcfe4ff, ambient: 1.5, direct: 1.2, dir: [0.4, 0.8, -0.3] });
    k.fog(0x274a57, 10, 70);
    k.ambience([130.81, 196, 261.63], 0.012);

    const moon = new THREE.Mesh(new THREE.SphereGeometry(16, 20, 14), new THREE.MeshBasicMaterial({ color: 0xf3f0d7, fog: false }));
    moon.position.set(70, 120, -240);
    root.add(moon);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(90, 32).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0x2a4f3a }),
    );
    root.add(ground);

    // The pine forest, kept as instances so it stays cheap on a headset.
    const trees = [];
    for (let i = 0; i < 110; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 13 + Math.random() * 42;
      trees.push({ x: Math.sin(a) * r, z: Math.cos(a) * r, h: 5 + Math.random() * 6 });
    }
    k.instanced(new THREE.CylinderGeometry(0.16, 0.26, 1, 5), new THREE.MeshLambertMaterial({ color: 0x3b2a22 }), trees.length, (d, i) => {
      d.position.set(trees[i].x, trees[i].h * 0.15, trees[i].z);
      d.scale.y = trees[i].h * 0.3;
    });
    const pine = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const coneGeo = new THREE.ConeGeometry(1, 1, 6);
    k.instanced(coneGeo, pine, trees.length * 2, (d, i) => {
      const t = trees[i >> 1];
      const up = i % 2;
      d.position.set(t.x, t.h * (up ? 0.72 : 0.45), t.z);
      d.scale.set(t.h * (up ? 0.2 : 0.3), t.h * 0.5, t.h * (up ? 0.2 : 0.3));
      return (i >> 1) % 3 ? 0x1f4a3c : 0x28594a;
    });

    // The old tree blossoms a little more with each round you clear.
    const bark = new THREE.MeshLambertMaterial({ color: 0x3f2d24, flatShading: true });
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 1.3, 7, 7), bark);
    trunk.position.set(0, 3.5, -10);
    root.add(trunk);
    const crownSpots = [[0, 8.6, -10, 4], [-3, 7.2, -9.5, 2.6], [3, 7.4, -10.5, 2.8], [0.5, 10.6, -10.5, 2.5]];
    const leaf = new THREE.MeshLambertMaterial({ color: 0x2f6a56, flatShading: true });
    for (const [x, y, z, r] of crownSpots) {
      const c = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), leaf);
      c.position.set(x, y, z);
      root.add(c);
    }
    const BLOSSOMS = 150;
    const blossomSpots = Array.from({ length: BLOSSOMS }, () => {
      const [x, y, z, r] = crownSpots[Math.floor(Math.random() * crownSpots.length)];
      return new THREE.Vector3().randomDirection().multiplyScalar(r * 0.92).add(new THREE.Vector3(x, y, z));
    });
    const blossoms = k.instanced(
      new THREE.IcosahedronGeometry(0.14, 0),
      new THREE.MeshBasicMaterial({ color: 0xffb7d5 }),
      BLOSSOMS,
      (d, i) => { d.position.copy(blossomSpots[i]); d.scale.setScalar(0); },
    );
    const dummy = new THREE.Object3D();
    let bloomTarget = 0;
    let bloom = 0;

    const fireflyCount = 60;
    const flyPositions = new Float32Array(fireflyCount * 3);
    const flySeeds = Array.from({ length: fireflyCount }, () => [
      (Math.random() - 0.5) * 22, 0.4 + Math.random() * 3.2, -Math.random() * 16 + 4, Math.random() * 6,
    ]);
    const flyGeo = new THREE.BufferGeometry();
    flyGeo.setAttribute('position', new THREE.BufferAttribute(flyPositions, 3));
    root.add(new THREE.Points(flyGeo, new THREE.PointsMaterial({ color: 0xe6ff9c, size: 0.07, transparent: true, depthWrite: false })));

    // Five standing stones in an arc, each with its own glyph and note.
    const stones = GLYPHS.map((glyph, i) => {
      const a = THREE.MathUtils.degToRad(-58 + i * 29);
      const mat = new THREE.MeshLambertMaterial({ color: 0x6d7a78, flatShading: true, emissive: 0x000000 });
      const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.56, 2.4, 5), mat);
      stone.position.set(Math.sin(a) * 3.4, 1.2, -Math.cos(a) * 3.4);
      stone.rotation.y = -a;
      root.add(stone);
      const face = new Panel({ width: 0.6, height: 0.6, ppm: 320 });
      face.paint((g, W) => drawGlyph(g, glyph, W * 0.12, W * 0.12, W * 0.76, '#ffffff', W * 0.07));
      face.material.color.set(0x8ad8c0);
      face.position.set(Math.sin(a) * 2.93, 1.55, -Math.cos(a) * 2.93);
      face.lookAt(0, 1.55, 0);
      root.add(face);
      const glow = { stone, mat, face, level: 0 };
      k.input.addTarget(stone, { onSelect: () => press(i) });
      return glow;
    });

    const board = k.board({ width: 2.3, height: 0.5, at: [0, 3.5, -5.4], scale: 1.5 });

    let state = 'menu';
    let round = 0;
    let sequence = [];
    let cursor = 0;
    let showIndex = 0;
    let wait = 0;
    let menu = null;

    const flash = (i) => {
      stones[i].level = 1;
      sound.tone({ f: TONES[i], d: 0.55, type: 'triangle', g: 0.2 });
      sound.tone({ f: TONES[i] * 2, d: 0.35, g: 0.05 });
    };
    const setBoard = (title, body) => board.card({ title, body, accent: ACCENT });
    const beginRound = () => {
      sequence = Array.from({ length: ROUNDS[round] }, () => Math.floor(Math.random() * stones.length));
      replay();
    };
    const replay = () => {
      showIndex = 0;
      cursor = 0;
      wait = 0.9;
      state = 'show';
      setBoard(`Verse ${round + 1} of ${ROUNDS.length}`, 'Listen, and watch the stones.');
    };
    const press = (i) => {
      if (state !== 'input') return;
      flash(i);
      if (i !== sequence[cursor]) {
        sound.play('fail');
        setBoard('The grove forgets', 'Listen again.');
        state = 'wait';
        wait = 1.2;
        return;
      }
      cursor += 1;
      if (cursor < sequence.length) return;
      round += 1;
      bloomTarget = round / ROUNDS.length;
      k.burst(stones[i].stone.position, 0xffb7d5, 18, 3);
      if (round >= ROUNDS.length) {
        state = 'menu';
        k.complete();
        setBoard('The old tree remembers', 'Look up. You woke it.');
        menu = k.menu({
          title: 'Song complete',
          body: 'The tree is in bloom. Stay as long as you like.',
          at: [0, -2],
          accent: ACCENT,
          buttons: [{ label: 'Leave', onSelect: () => k.game.goHome(), accent: '#f4efe2' }],
        });
        return;
      }
      state = 'next';
      wait = 1.1;
    };

    k.spawn(0, 0.9);
    k.setMove(true);
    k.boundsCircle(9.5);
    setBoard('Rune Hollow', 'The old tree sleeps.');
    menu = k.menu({
      title: 'Rune Hollow',
      body: 'The stones sing a verse. Sing it back by pulling the trigger or clicking each stone in the same order. Three verses wake the old tree.',
      at: [0, -1.9],
      accent: ACCENT,
      buttons: [
        {
          label: 'Listen',
          onSelect: () => {
            menu.close();
            menu = null;
            round = 0;
            bloomTarget = 0;
            beginRound();
          },
        },
        { label: 'Leave', onSelect: () => k.game.goHome(), accent: '#f4efe2' },
      ],
    });

    return {
      update(dt, t) {
        for (const s of stones) {
          s.level = Math.max(0, s.level - dt * 2.4);
          s.mat.emissive.setRGB(s.level * 0.25, s.level * 0.7, s.level * 0.55);
          s.face.material.color.setRGB(0.5 + s.level * 0.5, 0.8 + s.level * 0.2, 0.7 + s.level * 0.3);
        }

        flySeeds.forEach(([x, y, z, p], i) => {
          flyPositions[i * 3] = x + Math.sin(t * 0.4 + p) * 1.4;
          flyPositions[i * 3 + 1] = y + Math.sin(t * 0.9 + p * 2) * 0.4;
          flyPositions[i * 3 + 2] = z + Math.cos(t * 0.5 + p) * 1.4;
        });
        flyGeo.attributes.position.needsUpdate = true;

        if (bloom < bloomTarget - 0.001 || bloom > bloomTarget + 0.001) {
          bloom = THREE.MathUtils.damp(bloom, bloomTarget, 1.3, dt);
          for (let i = 0; i < BLOSSOMS; i++) {
            dummy.position.copy(blossomSpots[i]);
            dummy.scale.setScalar(THREE.MathUtils.clamp(bloom * BLOSSOMS - i, 0, 1) * (0.7 + (i % 5) * 0.2));
            dummy.updateMatrix();
            blossoms.setMatrixAt(i, dummy.matrix);
          }
          blossoms.instanceMatrix.needsUpdate = true;
        }

        if (state === 'show') {
          wait -= dt;
          if (wait <= 0) {
            if (showIndex < sequence.length) {
              flash(sequence[showIndex]);
              showIndex += 1;
              wait = 0.72;
            } else {
              state = 'input';
              setBoard('Your turn', `Sing back ${sequence.length} stones.`);
            }
          }
        } else if (state === 'wait') {
          wait -= dt;
          if (wait <= 0) replay();
        } else if (state === 'next') {
          wait -= dt;
          if (wait <= 0) beginRound();
        }
      },
    };
  },
};
