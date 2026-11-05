import * as THREE from 'three';
import { Panel, makeCard, BODY } from '../engine/ui.js';

const CODE = [
  "export default {",
  "  id: 'your-world',",
  "  name: 'Your World',",
  "  genre: 'Anything',",
  "  comfort: 'Comfortable',",
  "  color: 0x88ccff,",
  "  patch(g, s) { /* draw your quilt patch */ },",
  "  create(k) { /* build it, then k.complete() */ },",
  "};",
];

/** The end of the road, which is really the start of the next contributor's world. */
export default {
  id: 'source-room',
  name: 'The Source Room',
  hidden: true,

  create(k) {
    const { root } = k;
    k.sky({ top: 0xf4efe2, mid: 0xf4efe2, horizon: 0xf8f4ea, bottom: 0xe7e0cf });
    k.lights({ sky: 0xffffff, ground: 0xd8d0bc, sun: 0xffffff, ambient: 2.6, direct: 0.6 });
    k.fog(0xf4efe2, 12, 60);
    k.ambience([261.63, 392, 523.25], 0.012);

    const floor = new THREE.GridHelper(120, 80, 0xc9bda3, 0xc9bda3);
    floor.material.transparent = true;
    floor.material.opacity = 0.55;
    root.add(floor);

    const intro = makeCard({
      title: 'This room is empty on purpose',
      body: 'You have seen everything built so far. Every world behind you is a single file, and the next one is yours to make. It is open source, so anyone can add a portal to the Crossroads.',
      width: 2.5,
      accent: '#ff8a4c',
    });
    intro.position.set(-1.4, 1.7, -4.2);
    intro.rotation.y = 0.22;
    root.add(intro);

    const code = new Panel({ width: 2.6, height: 1.32, ppm: 300 });
    code.paint((g, W, H) => {
      g.fillStyle = '#07161f';
      g.beginPath();
      g.roundRect(0, 0, W, H, 12);
      g.fill();
      g.font = `600 ${0.068 * 300}px Consolas, Menlo, monospace`;
      g.textBaseline = 'top';
      g.fillStyle = '#b8e986';
      g.fillText('src/worlds/your-world.js', 30, 26);
      g.fillStyle = '#f4efe2';
      CODE.forEach((line, i) => g.fillText(line, 30, 66 + i * 0.1 * 300 * 0.78));
      g.font = `${0.062 * 300}px ${BODY}`;
      g.fillStyle = '#ff5c4d';
      g.fillText('Add it to src/worlds/index.js and its portal appears.', 30, H - 40);
    });
    code.position.set(1.4, 1.7, -4.2);
    code.rotation.y = -0.22;
    root.add(code);

    k.exitPortal(new THREE.Vector3(0, 0, 4)).group.lookAt(0, 0, 0);
    k.spawnSocial(0, 0);
    k.setMove(true);
    k.boundsCircle(14);
    return {};
  },
};
