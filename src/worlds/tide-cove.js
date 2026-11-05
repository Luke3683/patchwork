import * as THREE from 'three';

const GOAL = 5;
const BITE_WINDOW = 1.5;
const ACCENT = '#63d2c6';
const FISH = [
  { name: 'Amberfin', color: 0xf3a712 },
  { name: 'Moon Perch', color: 0xdfe6f5 },
  { name: 'Coral Darter', color: 0xff6f91 },
  { name: 'Teal Glider', color: 0x2a93a8 },
  { name: 'Velvet Eel', color: 0x7d4ea8 },
  { name: 'Lantern Trout', color: 0xffd166 },
  { name: 'Mossback', color: 0x76b041 },
];

export default {
  id: 'tide-cove',
  name: 'Tide Cove',
  genre: 'Cozy fishing',
  comfort: 'Comfortable',
  color: 0x63d2c6,
  seats: true,

  patch(g, s) {
    g.fillStyle = '#12466b';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#63d2c6';
    g.beginPath();
    g.ellipse(s * 0.46, s * 0.5, s * 0.26, s * 0.14, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(s * 0.68, s * 0.5);
    g.lineTo(s * 0.88, s * 0.34);
    g.lineTo(s * 0.88, s * 0.66);
    g.closePath();
    g.fill();
    g.fillStyle = '#12466b';
    g.beginPath();
    g.arc(s * 0.32, s * 0.47, s * 0.03, 0, Math.PI * 2);
    g.fill();
  },

  create(k) {
    const { root, input, sound } = k;
    k.sky({ top: 0x2c3e73, mid: 0xc76b8a, horizon: 0xffc58a, bottom: 0x1b6a8f });
    k.lights({ sky: 0xffdcc0, ground: 0x1b6a8f, sun: 0xffd3a0, ambient: 1.6, direct: 2.2, dir: [-0.6, 0.4, -0.7] });
    k.fog(0xe8a78c, 40, 340);
    k.ambience([174.6, 261.6, 349.2], 0.01);

    const water = new THREE.Mesh(
      new THREE.CircleGeometry(600, 48).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0x1b6a8f }),
    );
    water.position.y = -1;
    root.add(water);
    const sun = new THREE.Mesh(new THREE.CircleGeometry(38, 32), new THREE.MeshBasicMaterial({ color: 0xffe6b0, fog: false }));
    sun.position.set(-150, 42, -300);
    sun.lookAt(0, 0, 0);
    root.add(sun);

    // The pier and a few far-off islands.
    const plank = new THREE.MeshLambertMaterial({ color: 0x7a5236, flatShading: true });
    root.add(new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.16, 11).translate(0, -0.08, 2.5), plank));
    k.instanced(new THREE.CylinderGeometry(0.11, 0.13, 3, 6), plank, 8, (d, i) => {
      d.position.set(i % 2 ? 1.6 : -1.6, -1.3, -2.6 + Math.floor(i / 2) * 3.4);
    });
    k.instanced(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0x3d6a57, flatShading: true }), 8, (d, i) => {
      const a = -1.2 + (i / 7) * 2.4;
      d.position.set(Math.sin(a) * (120 + (i % 3) * 40), -1, -Math.cos(a) * (120 + (i % 3) * 40));
      d.scale.set(18 + (i % 4) * 8, 7 + (i % 3) * 5, 14);
    });

    const board = k.board({ width: 2.2, height: 0.5, at: [-2.1, 2.1, -2.2] });
    board.rotation.y = 0.5;

    // The rod sits in your hand, and its line runs out to the float.
    const makeRod = () => {
      const rod = new THREE.Mesh(
        new THREE.CylinderGeometry(0.004, 0.012, 1.1, 5).rotateX(Math.PI / 2).translate(0, 0, -0.55),
        new THREE.MeshLambertMaterial({ color: 0x5a3a24 }),
      );
      rod.rotation.x = 0.35;
      const tip = new THREE.Object3D();
      tip.position.z = -1.1;
      rod.add(tip);
      rod.userData.tip = tip;
      return rod;
    };
    const float = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff5f5f }));
    float.visible = false;
    root.add(float);
    const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xf4efe2 }));
    line.frustumCulled = false;
    line.visible = false;
    root.add(line);

    // A caught fish pops out of the water and hangs in the air for a moment.
    const fishBody = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8).scale(1.6, 0.8, 0.5), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }));
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.22, 4).rotateZ(Math.PI / 2).translate(0.38, 0, 0), fishBody.material);
    const caughtFish = new THREE.Group();
    caughtFish.add(fishBody, tail);
    caughtFish.visible = false;
    root.add(caughtFish);
    let fishTimer = 0;

    const collection = new Map();
    let total = 0;
    let state = 'idle'; // idle, flying, waiting, bite
    let timer = 0;
    const from = new THREE.Vector3();
    const to = new THREE.Vector3();
    const tipPos = new THREE.Vector3();

    const updateBoard = (note = 'Pull the trigger to cast.') => {
      const list = [...collection.entries()].map(([name, n]) => `${name} x${n}`).join(', ');
      board.card({ title: `Caught ${total}${total < GOAL ? ` / ${GOAL}` : ''}`, body: list || note, accent: ACCENT });
    };
    const reelIn = () => {
      state = 'idle';
      float.visible = false;
      line.visible = false;
    };
    const cast = (hand) => {
      // Land the float where the ray meets the water, within casting range.
      const t = hand.dir.y < -0.02 ? (hand.origin.y + 1) / -hand.dir.y : 14;
      const dist = THREE.MathUtils.clamp(t, 5, 22);
      to.copy(hand.origin).addScaledVector(hand.dir, dist).setY(-0.97);
      if (to.z > -2) to.z = -2 - Math.random() * 6;
      from.copy(hand.origin);
      state = 'flying';
      timer = 0;
      float.visible = true;
      line.visible = true;
      sound.tone({ f: 500, d: 0.3, type: 'triangle', g: 0.06, slide: -300 });
    };
    const catchFish = (hand) => {
      const fish = FISH[Math.floor(Math.random() * FISH.length)];
      collection.set(fish.name, (collection.get(fish.name) ?? 0) + 1);
      total += 1;
      fishBody.material.color.set(fish.color);
      caughtFish.position.copy(float.position).setY(1);
      caughtFish.visible = true;
      fishTimer = 1.8;
      k.burst(float.position, 0xffffff, 16, 3);
      sound.play('patch');
      hand.pulse(0.9, 120);
      k.toast(fish.name, 'Into the bucket.', ACCENT);
      reelIn();
      updateBoard();
      if (total === GOAL) k.win();
      else if (total > GOAL) k.save.addCoins(2);
    };

    k.spawn(0, 0);
    k.setMove(true);
    k.setBounds((p) => {
      p.x = THREE.MathUtils.clamp(p.x, -1.3, 1.3);
      p.z = THREE.MathUtils.clamp(p.z, -2.4, 7.2);
    });
    updateBoard();
    k.exitPortal(new THREE.Vector3(0, 0, 6.6)).group.lookAt(0, 0, 0);

    return {
      debug: { state: () => state },
      update(dt, t) {
        for (const hand of input.hands) {
          if (!hand.mount.children.length) hand.mount.add(makeRod());
        }
        if (fishTimer > 0) {
          fishTimer -= dt;
          caughtFish.rotation.y += dt * 3;
          caughtFish.rotation.z = Math.sin(t * 16) * 0.3;
          if (fishTimer <= 0) caughtFish.visible = false;
        }

        const hand = input.primary;
        const pressed = input.hands.find((h) => h.pressed && !h.hit);
        hand.mount.children[0]?.userData.tip.getWorldPosition(tipPos);

        if (state === 'idle' && pressed) {
          cast(pressed);
        } else if (state === 'flying') {
          timer += dt / 0.7;
          float.position.lerpVectors(from, to, Math.min(1, timer));
          float.position.y += Math.sin(Math.min(1, timer) * Math.PI) * 2.2;
          if (timer >= 1) {
            state = 'waiting';
            timer = 2 + Math.random() * 3.5;
            k.burst(float.position, 0xdff6ff, 8, 1.5);
            sound.noise({ d: 0.2, g: 0.08, f: 1500 });
          }
        } else if (state === 'waiting') {
          float.position.y = -0.97 + Math.sin(t * 2.4) * 0.025;
          timer -= dt;
          if (pressed) {
            reelIn();
          } else if (timer <= 0) {
            state = 'bite';
            timer = BITE_WINDOW;
            sound.noise({ d: 0.25, g: 0.2, f: 2200 });
            sound.tone({ f: 880, d: 0.15, type: 'triangle', g: 0.14 });
            hand.pulse(1, 200);
            k.burst(float.position, 0xffffff, 12, 2.5);
          }
        } else if (state === 'bite') {
          float.position.y = -1.15 + Math.sin(t * 24) * 0.09;
          timer -= dt;
          if (pressed) {
            catchFish(pressed);
          } else if (timer <= 0) {
            reelIn();
            sound.play('miss');
            updateBoard('It got away. Cast again and pull when the float dips.');
          }
        }

        if (line.visible) {
          const p = lineGeo.attributes.position;
          p.setXYZ(0, tipPos.x, tipPos.y, tipPos.z);
          p.setXYZ(1, float.position.x, float.position.y, float.position.z);
          p.needsUpdate = true;
        }
      },
    };
  },
};
