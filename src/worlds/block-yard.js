import * as THREE from 'three';

const S = 0.5; // one block, in meters
const LIMIT_XZ = 28;
const LIMIT_Y = 30;
const MAX_BLOCKS = 4000;
const GOAL = 12;
const REACH = 16;
const ACCENT = '#ffd166';
const PALETTE = [0xe4572e, 0xf3a712, 0xf7e7ce, 0x76b041, 0x2e86ab, 0x7d4ea8, 0x3d3a4b, 0xff9fb2];
const key = (x, y, z) => `${x},${y},${z}`;

// A little gatehouse so the yard does not start empty.
function starterBuild() {
  const cells = [];
  for (let y = 0; y < 5; y++) {
    for (const x of [-3, 3]) for (const z of [-11, -10]) cells.push([x, y, z, y === 4 ? 1 : 2]);
  }
  for (let x = -3; x <= 3; x++) for (const z of [-11, -10]) cells.push([x, 5, z, x % 2 ? 0 : 1]);
  for (let x = -3; x <= 3; x += 2) cells.push([x, 6, -11, 4]);
  return cells;
}

export default {
  id: 'block-yard',
  name: 'Block Yard',
  genre: 'Creative sandbox',
  comfort: 'Comfortable',
  color: 0xffd166,

  patch(g, s) {
    const n = 4;
    const c = s / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        g.fillStyle = `#${PALETTE[(x * 3 + y * 5) % PALETTE.length].toString(16).padStart(6, '0')}`;
        g.fillRect(x * c, y * c, c, c);
      }
    }
  },

  create(k) {
    const { root, input, sound, save, def } = k;
    k.sky({ top: 0x4fa3e0, mid: 0x9fd4f5, horizon: 0xe9f6ff, bottom: 0xb7d7a8 });
    k.lights({ sky: 0xffffff, ground: 0x9db38a, sun: 0xfff4dc, ambient: 1.9, direct: 1.9, dir: [0.5, 1, 0.6] });
    k.fog(0xe4f3fd, 60, 280);

    const ground = new THREE.Mesh(
      new THREE.CylinderGeometry(LIMIT_XZ * S + 3, LIMIT_XZ * S - 2, 1.5, 28).translate(0, -0.75, 0),
      new THREE.MeshLambertMaterial({ color: 0x8cc269, flatShading: true }),
    );
    root.add(ground);
    k.instanced(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), 70, (d, i) => {
      const a = (Math.floor(i / 5) / 14) * Math.PI * 2;
      d.position.set(
        Math.sin(a) * (70 + (i % 3) * 20) + (i % 5) * 3.5,
        16 + (Math.floor(i / 5) % 4) * 6 + (i % 2),
        Math.cos(a) * (70 + (i % 3) * 20) + ((i * 3) % 5),
      );
      d.scale.set(3.4 - (i % 5) * 0.3, 1.6, 2.6);
    });

    const blocks = new Map();
    const stored = save.world(def.id);
    if (stored?.cells) stored.cells.forEach(([x, y, z, c]) => blocks.set(key(x, y, z), { x, y, z, c }));
    else starterBuild().forEach(([x, y, z, c]) => blocks.set(key(x, y, z), { x, y, z, c }));

    const mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(S * 0.98, S * 0.98, S * 0.98),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      MAX_BLOCKS,
    );
    mesh.frustumCulled = false;
    mesh.setColorAt(0, new THREE.Color(0xffffff));
    root.add(mesh);
    const dummy = new THREE.Object3D();
    const tint = new THREE.Color();
    const rebuild = () => {
      let i = 0;
      for (const b of blocks.values()) {
        dummy.position.set((b.x + 0.5) * S, (b.y + 0.5) * S, (b.z + 0.5) * S);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        mesh.setColorAt(i, tint.set(PALETTE[b.c]));
        i += 1;
      }
      mesh.count = i;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    };
    const persist = () => save.setWorld(def.id, { cells: [...blocks.values()].map((b) => [b.x, b.y, b.z, b.c]) });
    rebuild();

    const ghost = new THREE.Mesh(
      new THREE.BoxGeometry(S, S, S),
      new THREE.MeshBasicMaterial({ color: PALETTE[0], transparent: true, opacity: 0.45, depthWrite: false }),
    );
    ghost.visible = false;
    root.add(ghost);

    // Walks the ray through the grid, one cell at a time.
    const castRay = (origin, dir) => {
      const o = origin.clone().divideScalar(S);
      const cell = [Math.floor(o.x), Math.floor(o.y), Math.floor(o.z)];
      const step = [Math.sign(dir.x), Math.sign(dir.y), Math.sign(dir.z)];
      const delta = [Math.abs(1 / dir.x), Math.abs(1 / dir.y), Math.abs(1 / dir.z)];
      const next = [0, 1, 2].map((a) => {
        const p = [o.x, o.y, o.z][a];
        const d = [dir.x, dir.y, dir.z][a];
        return d > 0 ? (cell[a] + 1 - p) * delta[a] : d < 0 ? (p - cell[a]) * delta[a] : Infinity;
      });
      let prev = null;
      let t = 0;
      while (t < REACH / S) {
        if (cell[1] < 0) return prev ? { place: prev } : null;
        const here = blocks.get(key(...cell));
        if (here) return { block: here, place: prev };
        prev = [...cell];
        const a = next[0] < next[1] ? (next[0] < next[2] ? 0 : 2) : next[1] < next[2] ? 1 : 2;
        t = next[a];
        next[a] += delta[a];
        cell[a] += step[a];
      }
      return null;
    };
    const canPlace = ([x, y, z]) => y >= 0 && y < LIMIT_Y && Math.hypot(x, z) < LIMIT_XZ - 1 && blocks.size < MAX_BLOCKS;

    let colorIndex = 0;
    let placed = 0;
    const earned = () => save.hasPatch(def.id);

    const board = k.board({ width: 2.5, height: 0.5, at: [-1.9, 2.6, -3.6] });
    board.rotation.y = 0.45;
    const updateBoard = () => {
      board.card({
        title: earned() ? 'Keep building' : `Blocks ${Math.min(placed, GOAL)} / ${GOAL}`,
        body: k.isXR
          ? 'Trigger places. Grip removes. Pick a color on the stand.'
          : 'Click places. Right click removes. Keys 1 to 8 pick a color.',
        accent: ACCENT,
      });
    };

    // The paint stand floats near the player's starting spot.
    const swatches = PALETTE.map((hex, i) => {
      const swatch = new THREE.Mesh(
        new THREE.BoxGeometry(0.2, 0.2, 0.2),
        new THREE.MeshLambertMaterial({ color: hex }),
      );
      swatch.position.set(1.15 + (i % 4) * 0.28, 1.28 - Math.floor(i / 4) * 0.28, -1.2);
      root.add(swatch);
      input.addTarget(swatch, {
        onSelect: () => {
          selectColor(i);
          sound.play('select');
        },
      });
      return swatch;
    });
    const selectColor = (i) => {
      colorIndex = i;
      ghost.material.color.set(PALETTE[i]);
      swatches.forEach((s, j) => s.scale.setScalar(j === i ? 1.3 : 1));
    };
    selectColor(0);

    const reset = k.button('Clear yard', () => {
      blocks.clear();
      rebuild();
      persist();
    }, { accent: '#f4efe2' });
    reset.position.set(1.57, 0.68, -1.2);
    root.add(reset);

    k.exitPortal(new THREE.Vector3(-5.5, 0, 3.5)).group.lookAt(0, 0, 0);

    k.spawn(0, 0);
    k.setMove(true);
    k.boundsCircle(LIMIT_XZ * S - 0.5);
    updateBoard();

    return {
      update() {
        for (let i = 0; i < PALETTE.length; i++) {
          if (input.keyPressed(`Digit${i + 1}`)) selectColor(i);
        }

        ghost.visible = false;
        for (const hand of input.hands) {
          const aimingAtUi = !!hand.hit;
          const cast = aimingAtUi ? null : castRay(hand.origin, hand.dir);
          if (hand === input.primary && cast?.place && canPlace(cast.place)) {
            const [x, y, z] = cast.place;
            ghost.position.set((x + 0.5) * S, (y + 0.5) * S, (z + 0.5) * S);
            ghost.visible = true;
          }
          if (hand.pressed && cast?.place && canPlace(cast.place)) {
            const [x, y, z] = cast.place;
            blocks.set(key(x, y, z), { x, y, z, c: colorIndex });
            rebuild();
            persist();
            sound.play('block');
            hand.pulse(0.3, 20);
            placed += 1;
            if (placed >= GOAL) k.complete();
            updateBoard();
          }
          if (hand.squeezed && cast?.block) {
            const b = cast.block;
            blocks.delete(key(b.x, b.y, b.z));
            rebuild();
            persist();
            sound.play('unblock');
            hand.pulse(0.2, 20);
          }
        }
      },
    };
  },
};
