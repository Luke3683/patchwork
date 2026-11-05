import * as THREE from 'three';

const GOAL = 5;
const TIME_LIMIT = 75;
const GRAVITY = 3.2; // moon gravity gives you time to watch the ball sail
const HOOP_RADIUS = 0.46;
const HOOP_Z = -6.5;
const HOOP_Y = 3;
const BALL_RADIUS = 0.13;
const MAX_BALLS = 8;
const ACCENT = '#9fb8ff';

export default {
  id: 'orbit-hoops',
  name: 'Orbit Hoops',
  genre: 'Sports',
  comfort: 'Comfortable',
  color: 0x9fb8ff,
  seats: true,

  patch(g, s) {
    g.fillStyle = '#14173a';
    g.fillRect(0, 0, s, s);
    g.strokeStyle = '#9fb8ff';
    g.lineWidth = s * 0.06;
    g.beginPath();
    g.ellipse(s / 2, s * 0.45, s * 0.3, s * 0.1, 0, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#ff8a4c';
    g.beginPath();
    g.arc(s * 0.5, s * 0.72, s * 0.13, 0, Math.PI * 2);
    g.fill();
  },

  create(k) {
    const { root, input } = k;
    k.sky({ top: 0x05060f, mid: 0x0a0e24, horizon: 0x1c2450, bottom: 0x05060f, stars: 1100 });
    k.lights({ sky: 0xbcd0ff, ground: 0x2a2d3f, sun: 0xffffff, ambient: 1.2, direct: 2.6, dir: [0.6, 0.8, 0.4] });

    const planet = new THREE.Mesh(new THREE.SphereGeometry(70, 32, 20), new THREE.MeshLambertMaterial({ color: 0x3d7fb0 }));
    planet.position.set(120, 75, -260);
    root.add(planet);

    const moon = new THREE.MeshLambertMaterial({ color: 0x8b8e9c, flatShading: true });
    root.add(new THREE.Mesh(new THREE.CircleGeometry(120, 48).rotateX(-Math.PI / 2), moon));
    k.instanced(new THREE.TorusGeometry(1, 0.14, 5, 14).rotateX(Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x6f7280, flatShading: true }), 40, (d) => {
      const a = Math.random() * Math.PI * 2;
      const r = 12 + Math.random() * 90;
      d.position.set(Math.sin(a) * r, 0.03, Math.cos(a) * r);
      d.scale.setScalar(1 + Math.random() * 5);
      d.scale.y = 0.4;
    });
    const court = new THREE.Mesh(
      new THREE.RingGeometry(9, 9.1, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x9fb8ff }),
    );
    court.position.set(0, 0.01, -3);
    root.add(court);

    // The hoop slides side to side, a little faster with each basket.
    const hoop = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(HOOP_RADIUS, 0.03, 8, 28), new THREE.MeshBasicMaterial({ color: 0xff8a4c }));
    ring.rotation.x = Math.PI / 2;
    hoop.add(ring);
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1, 0.06), new THREE.MeshLambertMaterial({ color: 0xf4efe2 }));
    board.position.set(0, 0.42, -HOOP_RADIUS - 0.12);
    hoop.add(board);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, HOOP_Y, 6).translate(0, -HOOP_Y / 2, 0), new THREE.MeshLambertMaterial({ color: 0x4a4f66 }));
    pole.position.z = -HOOP_RADIUS - 0.16;
    hoop.add(pole);
    hoop.position.set(0, HOOP_Y, HOOP_Z);
    root.add(hoop);

    const scoreBoard = k.board({ width: 2.3, height: 0.5, at: [0, 5.1, -7.2], scale: 1.6 });

    const ballGeo = new THREE.IcosahedronGeometry(BALL_RADIUS, 1);
    const ballMat = new THREE.MeshLambertMaterial({ color: k.prefs.gear.ballColor, flatShading: true });
    const balls = [];
    const held = new Map();

    let state = 'menu';
    let baskets = 0;
    let timeLeft = TIME_LIMIT;
    let hoopTime = 0;
    let menu = null;

    const updateBoard = () => {
      scoreBoard.card({
        title: `Baskets ${baskets} / ${GOAL}`,
        body: state === 'play' ? `${Math.ceil(timeLeft)} seconds left` : 'Low gravity. Lob it high.',
        accent: ACCENT,
      });
    };
    const clearBalls = () => {
      balls.splice(0).forEach((b) => root.remove(b.mesh));
      for (const [hand, h] of held) hand.mount.remove(h.mesh);
      held.clear();
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
    function start() {
      menu?.close();
      menu = null;
      clearBalls();
      baskets = 0;
      timeLeft = TIME_LIMIT;
      state = 'play';
      updateBoard();
    }
    const finish = (won) => {
      state = 'menu';
      clearBalls();
      if (won) k.win();
      else k.sound.play('fail');
      showMenu(won ? 'Nothing but stars' : 'Time is up', `You sank ${baskets} of ${GOAL}.`, 'Play again');
      updateBoard();
    };

    const throwBall = (hand, charge) => {
      const mesh = new THREE.Mesh(ballGeo, ballMat);
      const velocity = new THREE.Vector3();
      if (hand.source) {
        // In VR the ball leaves your hand as fast as you threw it, with a little help.
        velocity.copy(hand.velocity).multiplyScalar(1.7);
        if (velocity.length() < 1) velocity.copy(hand.dir).multiplyScalar(2);
      } else {
        // On desktop, hold the button longer to throw harder.
        velocity.copy(hand.dir).multiplyScalar(4 + Math.min(charge, 1) * 8);
      }
      mesh.position.copy(hand.origin).addScaledVector(hand.dir, 0.25);
      root.add(mesh);
      balls.push({ mesh, velocity, life: 6 });
      if (balls.length > MAX_BALLS) root.remove(balls.shift().mesh);
      k.sound.tone({ f: 300, d: 0.12, type: 'triangle', g: 0.1, slide: 200 });
      hand.pulse(0.3, 30);
    };

    k.spawn(0, 0);
    updateBoard();
    showMenu(
      'Orbit Hoops',
      `Hold the trigger to grab a ball, swing and let go to throw it. On desktop, hold the mouse button longer for more power. Sink ${GOAL} in ${TIME_LIMIT} seconds.`,
      'Tip off',
    );

    const before = new THREE.Vector3();
    return {
      debug: { hoop, g: GRAVITY },
      update(dt) {
        if (state !== 'play') return;

        hoopTime += dt * (0.45 + baskets * 0.06);
        hoop.position.x = Math.sin(hoopTime) * 2.4;

        timeLeft -= dt;
        updateBoard();
        if (timeLeft <= 0) {
          finish(baskets >= GOAL);
          return;
        }

        for (const hand of input.hands) {
          if (hand.pressed && !hand.hit && !held.has(hand)) {
            const mesh = new THREE.Mesh(ballGeo, ballMat);
            mesh.position.z = -0.14;
            hand.mount.add(mesh);
            held.set(hand, { mesh, charge: 0 });
          }
          const h = held.get(hand);
          if (!h) continue;
          h.charge += dt;
          if (hand.released || !hand.down) {
            hand.mount.remove(h.mesh);
            held.delete(hand);
            throwBall(hand, h.charge);
          }
        }

        for (let i = balls.length - 1; i >= 0; i--) {
          const b = balls[i];
          before.copy(b.mesh.position);
          b.velocity.y -= GRAVITY * dt;
          b.mesh.position.addScaledVector(b.velocity, dt);
          b.mesh.rotation.x += dt * 4;
          const p = b.mesh.position;
          if (p.y < BALL_RADIUS) {
            p.y = BALL_RADIUS;
            b.velocity.y = Math.abs(b.velocity.y) * 0.6;
            b.velocity.x *= 0.85;
            b.velocity.z *= 0.85;
          }
          // Bounce off the backboard.
          const boardZ = HOOP_Z - HOOP_RADIUS - 0.09;
          if (before.z > boardZ && p.z <= boardZ && Math.abs(p.x - hoop.position.x) < 0.75 && Math.abs(p.y - (HOOP_Y + 0.42)) < 0.5) {
            b.velocity.z = Math.abs(b.velocity.z) * 0.5;
            p.z = boardZ;
          }
          // A basket is a ball falling through the ring from above.
          if (before.y > HOOP_Y && p.y <= HOOP_Y && !b.scored) {
            const off = Math.hypot(p.x - hoop.position.x, p.z - HOOP_Z);
            if (off < HOOP_RADIUS) {
              b.scored = true;
              baskets += 1;
              k.sound.play('patch');
              k.burst(hoop.position, 0xff8a4c, 22, 4);
              input.primary.pulse(0.8, 90);
              updateBoard();
              if (baskets >= GOAL) {
                finish(true);
                return;
              }
            }
          }
          b.life -= dt;
          if (b.life <= 0) {
            root.remove(b.mesh);
            balls.splice(i, 1);
          }
        }
      },
    };
  },
};
