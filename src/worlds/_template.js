// Copy this file to start a new world, then add it to src/worlds/index.js.
// See CONTRIBUTING.md for what the kit can do.
import * as THREE from 'three';

export default {
  id: 'bell-tower', // unique, used in saves and in ?world=bell-tower
  name: 'Bell Tower',
  genre: 'Tutorial',
  comfort: 'Comfortable', // Comfortable, Moderate or Intense
  color: 0x88ccff,

  // Draw this world's quilt patch. g is a canvas 2D context, s is the patch size.
  patch(g, s) {
    g.fillStyle = '#88ccff';
    g.fillRect(0, 0, s, s);
  },

  // Runs when the player arrives. Anything added to k.root is cleaned up when they leave.
  create(k) {
    k.sky({ top: 0x336699, mid: 0x88bbdd, horizon: 0xeef6ff, bottom: 0x88aa77 });
    k.lights({ sky: 0xffffff, ground: 0x667755 });

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(20, 24).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0x88aa77 }),
    );
    k.root.add(ground);

    const bell = new THREE.Mesh(
      new THREE.ConeGeometry(0.5, 0.8, 12),
      new THREE.MeshLambertMaterial({ color: 0xffcc55, flatShading: true }),
    );
    bell.position.set(0, 1.6, -3);
    k.root.add(bell);

    // Targets work with both a controller's trigger and a mouse click.
    k.input.addTarget(bell, {
      onSelect: () => {
        k.sound.tone({ f: 660, d: 1.2, type: 'triangle' });
        k.complete(); // earns this world's patch
      },
    });

    k.exitPortal(new THREE.Vector3(3, 0, -2)).group.lookAt(0, 0, 0);
    k.spawn(0, 0);
    k.setMove(true);
    k.boundsCircle(18);

    // Return an object with update() to run code every frame.
    return {
      update(dt, t) {
        bell.rotation.z = Math.sin(t * 2) * 0.1;
      },
    };
  },
};
