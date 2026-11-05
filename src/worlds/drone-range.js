import * as THREE from 'three';

const KILLS_NEEDED = 25;
const MAX_SHIELDS = 5;
const AIM_RADIUS = 0.62;
const ACCENT = '#4fd6c4';

export default {
  id: 'drone-range',
  name: 'Drone Range',
  genre: 'Shooter',
  comfort: 'Comfortable',
  color: 0x4fd6c4,
  seats: true,

  patch(g, s) {
    g.fillStyle = '#0e2b34';
    g.fillRect(0, 0, s, s);
    g.strokeStyle = '#4fd6c4';
    g.lineWidth = s * 0.05;
    g.beginPath();
    g.arc(s / 2, s / 2, s * 0.3, 0, Math.PI * 2);
    g.moveTo(s / 2, s * 0.08);
    g.lineTo(s / 2, s * 0.92);
    g.moveTo(s * 0.08, s / 2);
    g.lineTo(s * 0.92, s / 2);
    g.stroke();
    g.fillStyle = '#ff7a2e';
    g.beginPath();
    g.arc(s / 2, s / 2, s * 0.09, 0, Math.PI * 2);
    g.fill();
  },

  create(k) {
    const { root, input } = k;
    k.sky({ top: 0x030a14, mid: 0x06202b, horizon: 0x0d3a42, bottom: 0x02060c, stars: 900 });
    k.lights({ sky: 0x9fe9e0, ground: 0x10242b, sun: 0xfff1d6, ambient: 1.2, direct: 2.6, dir: [-0.7, 0.5, 0.3] });

    // A banded gas giant with a ring fills the sky.
    const planetTex = document.createElement('canvas');
    planetTex.width = 256;
    planetTex.height = 128;
    const pg = planetTex.getContext('2d');
    for (let y = 0; y < 128; y += 8) {
      pg.fillStyle = ['#d97b52', '#e8a874', '#b65b45', '#f0c79a', '#c96f4a'][Math.floor(y / 8 + (y % 24 ? 1 : 0)) % 5];
      pg.fillRect(0, y, 256, 8);
    }
    const tex = new THREE.CanvasTexture(planetTex);
    tex.colorSpace = THREE.SRGBColorSpace;
    const planet = new THREE.Mesh(new THREE.SphereGeometry(170, 32, 20), new THREE.MeshLambertMaterial({ map: tex }));
    planet.position.set(-240, 90, -470);
    planet.rotation.z = 0.35;
    root.add(planet);
    const belt = new THREE.Mesh(
      new THREE.RingGeometry(215, 290, 64),
      new THREE.MeshBasicMaterial({ color: 0xe8c9a0, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
    );
    belt.position.copy(planet.position);
    belt.rotation.set(1.25, 0.3, 0);
    root.add(belt);

    const hull = new THREE.MeshLambertMaterial({ color: 0x33505a, flatShading: true });
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 2.6, 0.5, 12).translate(0, -0.25, 0), hull);
    root.add(deck);
    const trim = new THREE.Mesh(
      new THREE.RingGeometry(1.0, 1.06, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x4fd6c4 }),
    );
    trim.position.y = 0.01;
    root.add(trim);
    const rail = new THREE.Mesh(new THREE.TorusGeometry(3.1, 0.035, 6, 48), new THREE.MeshLambertMaterial({ color: 0x4fd6c4 }));
    rail.rotation.x = Math.PI / 2;
    rail.position.y = 1.05;
    root.add(rail);
    k.instanced(new THREE.BoxGeometry(5, 3, 40), hull, 3, (d, i) => {
      d.position.set((i - 1) * 16, -12 - (i % 2) * 7, 14 - i * 6);
      d.rotation.y = i * 0.25;
    });
    k.instanced(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshLambertMaterial({ color: 0x55565f, flatShading: true }), 50, (d) => {
      d.position.setFromSphericalCoords(70 + Math.random() * 110, 1 + Math.random() * 1.1, Math.random() * Math.PI * 2);
      d.scale.setScalar(0.6 + Math.random() * 4);
      d.rotation.set(Math.random() * 6, Math.random() * 6, 0);
    });

    const board = k.board({ width: 2.3, height: 0.5, at: [0, 3.4, -5], scale: 1.6 });

    // Blasters aim straight along the hand's ray.
    const { blaster, blasterColor } = k.prefs.gear;
    const gunBody = blaster === 'round'
      ? new THREE.SphereGeometry(0.06, 10, 8).translate(0, 0, -0.06)
      : new THREE.BoxGeometry(0.045, 0.06, blaster === 'long' ? 0.32 : 0.2).translate(0, 0, blaster === 'long' ? -0.12 : -0.07);
    const gunBarrel = new THREE.CylinderGeometry(0.014, 0.018, 0.1, 8).rotateX(Math.PI / 2).translate(0, 0.012, blaster === 'long' ? -0.3 : -0.2);
    const gunMat = new THREE.MeshLambertMaterial({ color: blasterColor, flatShading: true });
    const tipMat = new THREE.MeshBasicMaterial({ color: 0x4fd6c4 });
    const makeBlaster = () => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(gunBody, gunMat), new THREE.Mesh(gunBarrel, tipMat));
      return g;
    };

    const tracers = Array.from({ length: 8 }, () => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.016, 0.016, 1).translate(0, 0, -0.5),
        new THREE.MeshBasicMaterial({ color: 0x9ffff0, transparent: true, depthWrite: false }),
      );
      m.visible = false;
      m.userData.life = 0;
      root.add(m);
      return m;
    });
    let nextTracer = 0;

    const droneGeo = new THREE.OctahedronGeometry(0.42, 0);
    const haloGeo = new THREE.TorusGeometry(0.58, 0.05, 5, 14);
    const droneMat = new THREE.MeshLambertMaterial({ color: 0xff7a2e, emissive: 0x7a2506, flatShading: true });
    const haloMat = new THREE.MeshBasicMaterial({ color: 0xffd166 });
    const drones = [];
    const head = new THREE.Vector3();
    const v = new THREE.Vector3();
    const muzzle = new THREE.Vector3();

    let state = 'menu';
    let kills = 0;
    let shields = MAX_SHIELDS;
    let spawnIn = 0;
    let menu = null;

    const updateBoard = () => {
      board.card({
        title: `Downed ${kills} / ${KILLS_NEEDED}`,
        body: `Shields ${'■ '.repeat(shields)}${'□ '.repeat(MAX_SHIELDS - shields)}`,
        accent: ACCENT,
      });
    };
    const removeDrone = (d) => {
      root.remove(d.group);
      drones.splice(drones.indexOf(d), 1);
    };
    const spawnDrone = () => {
      const group = new THREE.Group();
      const halo = new THREE.Mesh(haloGeo, haloMat);
      halo.rotation.x = Math.PI / 2;
      group.add(new THREE.Mesh(droneGeo, droneMat), halo);
      const a = (Math.random() - 0.5) * 2.5;
      group.position.set(Math.sin(a) * 30, 1.5 + Math.random() * 8, -Math.cos(a) * 30);
      root.add(group);
      drones.push({ group, phase: Math.random() * 6, speed: 3 + (kills / KILLS_NEEDED) * 3.2 + Math.random() });
    };
    const fire = (hand) => {
      k.sound.play('shoot');
      hand.pulse(0.45, 30);
      let best = null;
      let bestT = 45;
      for (const d of drones) {
        v.copy(d.group.position).sub(hand.origin);
        const t = v.dot(hand.dir);
        if (t > 0 && t < bestT && v.lengthSq() - t * t < AIM_RADIUS * AIM_RADIUS) {
          best = d;
          bestT = t;
        }
      }
      const tracer = tracers[nextTracer];
      nextTracer = (nextTracer + 1) % tracers.length;
      hand.mount.children[0]?.getWorldPosition(muzzle);
      muzzle.addScaledVector(hand.dir, 0.25);
      tracer.position.copy(muzzle);
      tracer.quaternion.setFromUnitVectors(v.set(0, 0, -1), hand.dir);
      tracer.scale.z = bestT;
      tracer.visible = true;
      tracer.userData.life = 0.09;
      if (best) {
        k.burst(best.group.position, 0xff9a4d, 18, 6);
        k.sound.play('boom');
        removeDrone(best);
        kills += 1;
        updateBoard();
        if (kills >= KILLS_NEEDED) finish(true);
      }
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
      while (drones.length) removeDrone(drones[0]);
      kills = 0;
      shields = MAX_SHIELDS;
      spawnIn = 0.6;
      updateBoard();
      state = 'play';
    };
    const finish = (won) => {
      state = 'menu';
      while (drones.length) removeDrone(drones[0]);
      if (won) k.win();
      else k.sound.play('fail');
      showMenu(
        won ? 'Range clear' : 'Shields down',
        won ? 'Every drone is scrap. The deck is yours.' : `You downed ${kills}. You need ${KILLS_NEEDED}.`,
        'Play again',
      );
    };

    k.spawn(0, 0);
    updateBoard();
    showMenu(
      'Drone Range',
      `Drones are closing on the deck. Aim and pull the trigger (or click) to shoot them before they reach you. Down ${KILLS_NEEDED} to earn the patch.`,
      'Start',
    );

    return {
      update(dt, t) {
        for (const hand of input.hands) {
          if (!hand.mount.children.length) hand.mount.add(makeBlaster());
        }
        for (const tr of tracers) {
          if (tr.userData.life > 0) {
            tr.userData.life -= dt;
            tr.material.opacity = tr.userData.life / 0.09;
            if (tr.userData.life <= 0) tr.visible = false;
          }
        }
        if (state !== 'play') return;

        for (const hand of input.hands) if (hand.pressed) fire(hand);
        if (state !== 'play') return;

        spawnIn -= dt;
        if (spawnIn <= 0 && drones.length < 12) {
          spawnDrone();
          spawnIn = THREE.MathUtils.lerp(1.5, 0.65, kills / KILLS_NEEDED);
        }
        k.head(head);
        for (const d of [...drones]) {
          const p = d.group.position;
          v.copy(head).sub(p);
          const dist = v.length();
          v.normalize().multiplyScalar(d.speed * dt);
          p.add(v);
          p.x += Math.sin(t * 1.7 + d.phase) * dt * 1.5;
          p.y += Math.cos(t * 2.3 + d.phase) * dt * 1.1;
          d.group.rotation.y += dt * 3;
          if (dist < 1.5) {
            k.burst(p, 0xff4d4d, 14, 3);
            k.sound.play('hurt');
            for (const hand of input.hands) hand.pulse(1, 140);
            removeDrone(d);
            shields -= 1;
            updateBoard();
            if (shields <= 0) {
              finish(false);
              return;
            }
          }
        }
      },
    };
  },
};
