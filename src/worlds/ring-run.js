import * as THREE from 'three';

const RING_COUNT = 14;
const RINGS_NEEDED = 10;
const RING_GAP = 55;
const RING_RADIUS = 2.6;
const SPAN = 420;
const ACCENT = '#ff8a4c';

export default {
  id: 'ring-run',
  name: 'Ring Run',
  genre: 'Racing',
  comfort: 'Intense',
  color: 0xff8a4c,

  patch(g, s) {
    g.fillStyle = '#ffc27a';
    g.fillRect(0, 0, s, s);
    ['#e9756a', '#ff8a4c', '#3a4a8c'].forEach((c, i) => {
      g.strokeStyle = c;
      g.lineWidth = s * 0.07;
      g.beginPath();
      g.arc(s / 2, s / 2, s * (0.42 - i * 0.13), 0, Math.PI * 2);
      g.stroke();
    });
  },

  create(k) {
    const { root, rig, input } = k;
    k.sky({ top: 0x35468c, mid: 0xe9756a, horizon: 0xffc27a, bottom: 0xb5643c });
    k.lights({ sky: 0xffd9b0, ground: 0xa35a34, sun: 0xfff0d0, ambient: 1.6, direct: 2.4, dir: [0.4, 0.5, 0.7] });
    k.fog(0xf6b27e, 90, 430);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2400, 2400).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0xc9804b }),
    );
    root.add(ground);

    // Mesas and rocks recycle past the player, so the desert never runs out.
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const dummy = new THREE.Object3D();
    const makeScatter = (count, geo, spawnFn, tints) => {
      const items = Array.from({ length: count }, spawnFn);
      const mesh = k.instanced(geo, stoneMat, count, (d, i) => tints[i % tints.length]);
      mesh.frustumCulled = false;
      const write = (i) => {
        const it = items[i];
        dummy.position.set(it.x, it.h / 2, it.z);
        dummy.scale.set(it.w, it.h, it.w);
        dummy.rotation.y = it.r;
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      };
      const scatter = () => {
        items.forEach((it, i) => {
          it.z = rig.position.z + 40 - Math.random() * SPAN;
          write(i);
        });
        mesh.instanceMatrix.needsUpdate = true;
      };
      const recycle = () => {
        let dirty = false;
        items.forEach((it, i) => {
          if (it.z > rig.position.z + 40) {
            it.z -= SPAN;
            write(i);
            dirty = true;
          }
        });
        if (dirty) mesh.instanceMatrix.needsUpdate = true;
      };
      return { scatter, recycle };
    };
    const side = () => (Math.random() < 0.5 ? -1 : 1);
    const mesas = makeScatter(
      60,
      new THREE.CylinderGeometry(0.8, 1.05, 1, 7),
      () => ({
        x: side() * (26 + Math.random() * 130), z: 0, w: 8 + Math.random() * 16, h: 14 + Math.random() * 44, r: Math.random() * 6,
      }),
      [0xb5573a, 0xa24a3a, 0xc76b42, 0x8f4436],
    );
    const rocks = makeScatter(
      130,
      new THREE.DodecahedronGeometry(0.6, 0),
      () => ({
        x: side() * (2 + Math.random() * 60), z: 0, w: 0.5 + Math.random() * 1.6, h: 0.5 + Math.random() * 2.4, r: Math.random() * 6,
      }),
      [0x8f4f30, 0xa8623a, 0x774029],
    );

    // Rails around the player give the eyes something steady to hold on to.
    const sled = new THREE.Group();
    const hull = new THREE.MeshLambertMaterial({ color: k.prefs.gear.sledColor, flatShading: true });
    sled.add(new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.45, 0.16, 8).translate(0, -0.08, 0), hull));
    const rail = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.028, 6, 24), new THREE.MeshLambertMaterial({ color: 0xffd166 }));
    rail.rotation.x = Math.PI / 2;
    rail.position.y = 0.82;
    sled.add(rail);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.82, 5), hull);
      post.position.set(Math.cos(a) * 0.8, 0.41, Math.sin(a) * 0.8);
      sled.add(post);
    }
    k.attachToRig(sled);
    const dash = k.board({ width: 1.1, height: 0.46, at: [0, 1.12, -1.3], scale: 0.62, parent: sled });
    dash.rotation.x = -0.3;

    const ringGeo = new THREE.TorusGeometry(RING_RADIUS, 0.13, 8, 36);
    const beamGeo = new THREE.CylinderGeometry(0.04, 0.04, 1, 5).translate(0, 0.5, 0);
    const rings = Array.from({ length: RING_COUNT }, () => {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
      const ring = new THREE.Mesh(ringGeo, mat);
      const beam = new THREE.Mesh(beamGeo, mat);
      root.add(ring, beam);
      return { ring, beam, mat };
    });

    let state = 'menu';
    let speed = 0;
    let next = 0;
    let through = 0;
    const vel = new THREE.Vector2();
    const head = new THREE.Vector3();
    let brake = 0;
    let menu = null;

    const paintRings = () => {
      rings.forEach((r, i) => {
        r.mat.color.set(i === next ? 0xfff27a : i < next ? 0x77614a : 0xff5f7e);
        r.ring.scale.setScalar(i === next ? 1 : 0.9);
      });
    };
    const updateDash = () => {
      dash.card({
        title: `Ring ${Math.min(next + 1, RING_COUNT)} / ${RING_COUNT}`,
        body: `Through ${through}, need ${RINGS_NEEDED}`,
        accent: ACCENT,
      });
    };
    const reset = () => {
      k.spawn(0, 0, 0, 5);
      vel.set(0, 0);
      next = 0;
      through = 0;
      speed = 0;
      let x = 0;
      let y = 6.5;
      rings.forEach((r, i) => {
        x = THREE.MathUtils.clamp(x + (Math.random() - 0.5) * 18, -14, 14);
        y = THREE.MathUtils.clamp(y + (Math.random() - 0.5) * 9, 4, 13);
        const z = -RING_GAP * (i + 1.4);
        r.ring.position.set(x, y, z);
        r.beam.position.set(x, 0, z);
        r.beam.scale.y = y - RING_RADIUS;
      });
      mesas.scatter();
      rocks.scatter();
      paintRings();
      updateDash();
    };

    const showMenu = (title, body, label) => {
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
      reset();
      state = 'run';
    };

    reset();
    showMenu(
      'Ring Run',
      `The sled flies itself forward. Aim your hand or mouse where you want to go and thread the rings. Clear ${RINGS_NEEDED} of ${RING_COUNT} to earn the patch.`,
      'Launch',
    );

    return {
      update(dt) {
        ground.position.x = rig.position.x;
        ground.position.z = rig.position.z;
        if (state === 'menu') return;

        if (state === 'brake') {
          speed = Math.max(0, speed - 34 * dt);
          rig.position.z -= speed * dt;
          mesas.recycle();
          rocks.recycle();
          brake -= dt;
          if (brake <= 0) {
            state = 'menu';
            const won = through >= RINGS_NEEDED;
            if (won) k.win();
            else k.sound.play('fail');
            showMenu(
              won ? 'Clean run' : 'Too many missed',
              `You threaded ${through} of ${RING_COUNT} rings.${won ? '' : ` You need ${RINGS_NEEDED}.`}`,
              'Fly again',
            );
          }
          return;
        }

        speed = Math.min(26, speed + 9 * dt);
        const dir = input.primary.dir;
        vel.x = THREE.MathUtils.damp(vel.x, dir.x * 17, 5, dt);
        vel.y = THREE.MathUtils.damp(vel.y, dir.y * 14, 5, dt);
        rig.position.x = THREE.MathUtils.clamp(rig.position.x + vel.x * dt, -34, 34);
        rig.position.y = THREE.MathUtils.clamp(rig.position.y + vel.y * dt, 0.6, 18);
        rig.position.z -= speed * dt;
        mesas.recycle();
        rocks.recycle();

        const ring = rings[next];
        k.head(head);
        if (head.z < ring.ring.position.z) {
          const off = Math.hypot(head.x - ring.ring.position.x, head.y - ring.ring.position.y);
          if (off < RING_RADIUS + 0.3) {
            through += 1;
            k.sound.tone({ f: 330 * 2 ** (through / 6), d: 0.3, type: 'triangle', g: 0.18 });
            k.burst(ring.ring.position, 0xfff27a, 22, 7);
            input.primary.pulse(0.7, 70);
          } else {
            k.sound.play('miss');
          }
          next += 1;
          paintRings();
          updateDash();
          if (next >= RING_COUNT) {
            state = 'brake';
            brake = 1.1;
          }
        }
      },
    };
  },
};
