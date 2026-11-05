import * as THREE from 'three';

const CELLS = 7; // the maze is this many rooms across
const SIZE = CELLS * 2 + 1; // the grid also has a slot for each wall between rooms
const TILE = 2.4;
const KEYS_NEEDED = 3;
const HUNT_SPEED = 1.6;
const WANDER_SPEED = 1.1;
const HEARING = 8; // how many tiles away, along the halls, the lurker can hear you
const FLASH_RANGE = 7;
const FLASH_FREEZE = 5;
const FLASH_COOLDOWN = 12;
const REST_AFTER_CATCH = 12;
const PLAYER_RADIUS = 0.32;
const EXTRA_OPENINGS = 0.22;
const ACCENT = '#c9b6ff';

/** Carves a maze with a few loops, so you can run around the lurker. True means wall. */
function carveMaze() {
  const grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(true));
  const stack = [[1, 1]];
  grid[1][1] = false;
  while (stack.length) {
    const [x, z] = stack[stack.length - 1];
    const options = [[2, 0], [-2, 0], [0, 2], [0, -2]]
      .map(([dx, dz]) => [x + dx, z + dz, x + dx / 2, z + dz / 2])
      .filter(([nx, nz]) => nx > 0 && nz > 0 && nx < SIZE - 1 && nz < SIZE - 1 && grid[nz][nx]);
    if (!options.length) {
      stack.pop();
      continue;
    }
    const [nx, nz, wx, wz] = options[Math.floor(Math.random() * options.length)];
    grid[wz][wx] = false;
    grid[nz][nx] = false;
    stack.push([nx, nz]);
  }
  for (let z = 1; z < SIZE - 1; z++) {
    for (let x = 1; x < SIZE - 1; x++) {
      const between = (x % 2 === 0 && z % 2 === 1) || (x % 2 === 1 && z % 2 === 0);
      if (between && grid[z][x] && Math.random() < EXTRA_OPENINGS) grid[z][x] = false;
    }
  }
  return grid;
}

const toWorld = (c) => (c + 0.5) * TILE;
const toCell = (w) => Math.floor(w / TILE);

export default {
  id: 'gloom-manor',
  name: 'Gloom Manor',
  genre: 'Horror maze',
  comfort: 'Moderate',
  color: 0xc9b6ff,

  patch(g, s) {
    g.fillStyle = '#0a0812';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#c9b6ff';
    g.beginPath();
    g.moveTo(s * 0.5, s * 0.14);
    g.lineTo(s * 0.86, s * 0.42);
    g.lineTo(s * 0.14, s * 0.42);
    g.closePath();
    g.fill();
    g.fillRect(s * 0.24, s * 0.42, s * 0.52, s * 0.42);
    g.fillStyle = '#ff5c4d';
    g.fillRect(s * 0.32, s * 0.52, s * 0.12, s * 0.12);
    g.fillRect(s * 0.56, s * 0.52, s * 0.12, s * 0.12);
    g.fillStyle = '#0a0812';
    g.fillRect(s * 0.44, s * 0.68, s * 0.12, s * 0.16);
  },

  create(k) {
    const { root, rig } = k;
    k.sky({ top: 0x04040a, mid: 0x05050c, horizon: 0x070710, bottom: 0x030307 });
    root.add(new THREE.HemisphereLight(0x5a5478, 0x181420, 0.5));
    k.fog(0x050509, 1.5, 13);

    const grid = carveMaze();
    const open = (x, z) => x >= 0 && z >= 0 && x < SIZE && z < SIZE && !grid[z][x];
    const wallCells = [];
    for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) if (grid[z][x]) wallCells.push([x, z]);
    k.instanced(
      new THREE.BoxGeometry(TILE, 3.2, TILE),
      new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
      wallCells.length,
      (d, i) => {
        d.position.set(toWorld(wallCells[i][0]), 1.6, toWorld(wallCells[i][1]));
        return (wallCells[i][0] + wallCells[i][1]) % 3 ? 0x4a4258 : 0x3d3549;
      },
    );
    const span = SIZE * TILE;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(span, span).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x2a2433 }));
    ground.position.set(span / 2, 0, span / 2);
    root.add(ground);
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(span, span).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x15121c }));
    ceiling.position.set(span / 2, 3.2, span / 2);
    root.add(ceiling);

    // The only real light is the lantern you carry.
    const lantern = new THREE.PointLight(0xffcf8f, 9, 11, 1.4);
    lantern.position.y = 1.5;
    k.attachToRig(lantern);

    // Breadth-first search through the maze. The lurker hunts with this.
    const pathFrom = ([sx, sz], [tx, tz]) => {
      const seen = new Map([[`${sx},${sz}`, null]]);
      const queue = [[sx, sz]];
      while (queue.length) {
        const [x, z] = queue.shift();
        if (x === tx && z === tz) {
          const path = [];
          let at = `${x},${z}`;
          while (at) {
            path.unshift(at.split(',').map(Number));
            at = seen.get(at);
          }
          return path;
        }
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const id = `${x + dx},${z + dz}`;
          if (open(x + dx, z + dz) && !seen.has(id)) {
            seen.set(id, `${x},${z}`);
            queue.push([x + dx, z + dz]);
          }
        }
      }
      return [];
    };

    const START = [1, 1];
    const DOOR = [SIZE - 2, SIZE - 2];
    const rooms = [];
    for (let z = 1; z < SIZE; z += 2) for (let x = 1; x < SIZE; x += 2) rooms.push([x, z]);
    const candidates = rooms
      .filter(([x, z]) => pathFrom(START, [x, z]).length > 6 && (x !== DOOR[0] || z !== DOOR[1]))
      .sort(() => Math.random() - 0.5);

    const keyGeo = new THREE.OctahedronGeometry(0.16, 0);
    const keyMat = new THREE.MeshBasicMaterial({ color: 0xffd166 });
    const keys = candidates.slice(0, KEYS_NEEDED).map((cell) => {
      const mesh = new THREE.Mesh(keyGeo, keyMat);
      mesh.position.set(toWorld(cell[0]), 1.2, toWorld(cell[1]));
      root.add(mesh);
      return { cell, mesh, taken: false };
    });

    const doorMat = new THREE.MeshBasicMaterial({ color: 0x3d2f55 });
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.6, 0.2), doorMat);
    door.position.set(toWorld(DOOR[0]), 1.3, toWorld(DOOR[1]));
    root.add(door);

    // The lurker: a tall shape with two small lights for eyes.
    const lurker = new THREE.Group();
    lurker.add(new THREE.Mesh(new THREE.ConeGeometry(0.42, 2.2, 7).translate(0, 1.1, 0), new THREE.MeshBasicMaterial({ color: 0x08060e })));
    const eye = new THREE.SphereGeometry(0.035, 8, 6);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3b3b, fog: false });
    const eyeL = new THREE.Mesh(eye, eyeMat);
    const eyeR = new THREE.Mesh(eye, eyeMat);
    eyeL.position.set(-0.08, 1.75, 0.2);
    eyeR.position.set(0.08, 1.75, 0.2);
    lurker.add(eyeL, eyeR);
    root.add(lurker);

    const board = k.board({ width: 1.1, height: 0.46, at: [0, 0.78, -0.9], scale: 0.55, parent: new THREE.Group() });
    const hud = board.parent;
    k.attachToRig(hud);
    board.rotation.x = -0.4;

    let state = 'menu';
    let found = 0;
    let lurkerDelay = 6;
    let flashCooldown = 0;
    let flashGlow = 0;
    let lurkerNext = null;
    let lurkerHunting = false;
    let wanderRoom = null;
    let repath = 0;
    let beat = 0;
    let menu = null;
    const lurkerCell = () => [toCell(lurker.position.x), toCell(lurker.position.z)];
    const playerCell = () => [toCell(rig.position.x), toCell(rig.position.z)];

    const updateBoard = () => {
      board.card({
        title: `Keys ${found} / ${KEYS_NEEDED}`,
        body: flashCooldown > 0 ? 'Lantern flash recharging.' : 'Lantern flash ready.',
        accent: ACCENT,
      });
    };
    // The lurker always starts from the room farthest from you.
    const placeLurker = (rest = 6) => {
      lurkerNext = null;
      wanderRoom = null;
      let far = [SIZE - 2, 1];
      let longest = 0;
      for (const room of rooms) {
        const length = pathFrom(playerCell(), room).length;
        if (length > longest) {
          longest = length;
          far = room;
        }
      }
      lurker.position.set(toWorld(far[0]), 0, toWorld(far[1]));
      lurkerDelay = rest;
    };
    const placePlayer = () => {
      rig.position.set(toWorld(START[0]), 0, toWorld(START[1]));
      rig.rotation.y = Math.PI;
      k.input.pitch = 0;
    };

    // Walls stop you one axis at a time, so you slide along them.
    const last = new THREE.Vector3();
    const blocked = (x, z) => {
      for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        if (!open(toCell(x + ox * PLAYER_RADIUS), toCell(z + oz * PLAYER_RADIUS))) return true;
      }
      return false;
    };
    k.setBounds((p) => {
      const nx = p.x;
      const nz = p.z;
      p.x = blocked(nx, last.z) ? last.x : nx;
      p.z = blocked(p.x, nz) ? last.z : nz;
      last.copy(p);
    });

    placePlayer();
    placeLurker();
    last.copy(rig.position);
    updateBoard();
    k.ambience([55, 58.3], 0.03);

    menu = k.menu({
      title: 'Gloom Manor',
      body: `Find ${KEYS_NEEDED} keys in the dark and reach the door. Something walks these halls, and it hunts by sound. Listen for the heartbeat. Pull the trigger to flash your lantern and freeze it for a moment.`,
      at: [0, -1.5],
      accent: ACCENT,
      buttons: [
        {
          label: 'Go inside',
          onSelect: () => {
            menu.close();
            menu = null;
            k.setMove(true);
            state = 'play';
          },
        },
        { label: 'Leave', onSelect: () => k.game.goHome(), accent: '#f4efe2' },
      ],
    });

    const target = new THREE.Vector3();
    return {
      debug: {
        lurker,
        distance: () => Math.hypot(rig.position.x - lurker.position.x, rig.position.z - lurker.position.z),
        canFlash: () => flashCooldown <= 0,
        found: () => found,
        target: () => {
          const key = keys.find((c) => !c.taken);
          return pathFrom(playerCell(), key ? key.cell : DOOR).map(([x, z]) => [toWorld(x), toWorld(z)]);
        },
      },
      update(dt, t) {
        for (const key of keys) {
          if (key.taken) continue;
          key.mesh.rotation.y += dt * 2;
          key.mesh.position.y = 1.2 + Math.sin(t * 2) * 0.08;
        }
        if (state !== 'play') return;

        for (const key of keys) {
          if (!key.taken && key.mesh.position.distanceTo(target.set(rig.position.x, 1.2, rig.position.z)) < 0.95) {
            key.taken = true;
            root.remove(key.mesh);
            found += 1;
            k.sound.play('select');
            k.input.primary.pulse(0.6, 80);
            updateBoard();
            if (found >= KEYS_NEEDED) {
              doorMat.color.set(0xffd166);
              k.toast('A door has opened', 'Find it in the far corner.', ACCENT);
            }
          }
        }

        if (found >= KEYS_NEEDED && Math.hypot(rig.position.x - door.position.x, rig.position.z - door.position.z) < 1.2) {
          state = 'menu';
          k.setMove(false);
          k.win(25);
          menu = k.menu({
            title: 'You got out',
            body: 'The door slams behind you. Whatever it was stays inside.',
            at: [0, -1.4],
            accent: ACCENT,
            buttons: [{ label: 'Leave', onSelect: () => k.game.goHome(), accent: '#f4efe2' }],
          });
          return;
        }

        const dist = Math.hypot(rig.position.x - lurker.position.x, rig.position.z - lurker.position.z);

        // The lantern flash stops the lurker in its tracks if it's close enough.
        const wasReady = flashCooldown <= 0;
        flashCooldown = Math.max(0, flashCooldown - dt);
        if (wasReady !== (flashCooldown <= 0)) updateBoard();
        flashGlow = Math.max(0, flashGlow - dt * 2.5);
        lantern.intensity = 9 + flashGlow * 60;
        const flasher = k.input.hands.find((h) => h.pressed && !h.hit);
        if (flasher && flashCooldown <= 0) {
          flashCooldown = FLASH_COOLDOWN;
          flashGlow = 1;
          updateBoard();
          k.sound.noise({ d: 0.3, g: 0.14, f: 3200, type: 'highpass' });
          flasher.pulse(0.8, 90);
          if (dist < FLASH_RANGE) lurkerDelay = Math.max(lurkerDelay, FLASH_FREEZE);
        }

        lurkerDelay -= dt;
        const awake = lurkerDelay <= 0;
        if (awake) {
          // It only hunts you once it can hear you. The rest of the time it wanders.
          repath -= dt;
          if (repath <= 0) {
            repath = 0.3;
            const toPlayer = pathFrom(lurkerCell(), playerCell());
            lurkerHunting = toPlayer.length <= HEARING;
            let path = toPlayer;
            if (!lurkerHunting) {
              if (!wanderRoom || (lurkerCell()[0] === wanderRoom[0] && lurkerCell()[1] === wanderRoom[1])) {
                wanderRoom = rooms[Math.floor(Math.random() * rooms.length)];
              }
              path = pathFrom(lurkerCell(), wanderRoom);
            }
            lurkerNext = path[1] ?? path[0] ?? null;
          }
          if (lurkerHunting && dist < TILE) target.set(rig.position.x, 0, rig.position.z);
          else if (lurkerNext) target.set(toWorld(lurkerNext[0]), 0, toWorld(lurkerNext[1]));
          else target.copy(lurker.position);
          const step = target.sub(lurker.position);
          const len = step.length();
          if (len > 0.001) {
            const speed = lurkerHunting ? HUNT_SPEED * (1 + found * 0.08) : WANDER_SPEED;
            lurker.rotation.y = Math.atan2(step.x, step.z);
            lurker.position.addScaledVector(step, Math.min(1, (speed * dt) / len));
          }
        }

        // A heartbeat that quickens as it gets closer.
        beat -= dt;
        if (dist < 12 && beat <= 0) {
          beat = 0.35 + (dist / 12) * 1.1;
          k.sound.tone({ f: 58, d: 0.14, g: 0.5 * (1 - dist / 14), slide: -20 });
          if (dist < 5) k.input.primary.pulse(0.3 * (1 - dist / 5) + 0.1, 40);
        }

        if (awake && dist < 0.9) {
          k.sound.play('hurt');
          k.toast('It found you', 'You wake at the entrance. Your keys are safe.', ACCENT);
          placePlayer();
          last.copy(rig.position);
          placeLurker(REST_AFTER_CATCH);
        }
      },
    };
  },
};
