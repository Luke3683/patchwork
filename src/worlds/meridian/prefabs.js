import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Fully modeled buildings and street furniture from the Downtown City MegaKit. They're
 * heavy, so they're only drawn up close, and only on a computer. From farther away, and in
 * a headset, the plain textured block underneath stands in for them.
 */
const BUILDINGS = ['Building_Large_2', 'Building_Medium_2_001', 'Building_Small_1'];
const PROPS = ['Prop_ACUnit', 'Prop_Bollard', 'Prop_Planter_Single', 'Prop_ManholeCover'];
const SURFACES = {
  brick: 'T_RedBrick',
  trim: 'T_Trim',
  metal: 'T_MetalConcrete',
  concrete: 'T_Concrete',
};
const assets = { models: new Map(), textures: new Map(), ready: false };

/** Which of the game's few materials each part of the kit is drawn with. */
function classify(name) {
  if (/InteriorWall|InteriorFloor|Asphalt|Dirt/.test(name)) return 'plain';
  if (/FakeInterior/.test(name)) return 'rooms';
  if (/Glass/.test(name)) return 'glass';
  if (/RedBrick/.test(name)) return 'brick';
  if (/MetalConcrete/.test(name)) return 'metal';
  if (/Concrete/.test(name)) return 'concrete';
  return 'trim';
}

function loadModel(gltf) {
  gltf.scene.updateMatrixWorld(true);
  const groups = {};
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    const kind = classify(o.material.name);
    const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
    for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
    // The kit darkens or recolors some parts, so that travels with each part as a vertex color.
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    const { r, g: green, b } = o.material.color;
    for (let i = 0; i < n; i++) {
      c[i * 3] = r;
      c[i * 3 + 1] = green;
      c[i * 3 + 2] = b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    (groups[kind] ??= []).push(g);
  });
  const parts = {};
  const box = new THREE.Box3();
  for (const [kind, list] of Object.entries(groups)) {
    parts[kind] = mergeGeometries(list);
    list.forEach((g) => g.dispose());
    parts[kind].computeBoundingBox();
    box.union(parts[kind].boundingBox);
  }
  const center = box.getCenter(new THREE.Vector3());
  for (const g of Object.values(parts)) g.translate(-center.x, -box.min.y, -center.z);
  return { parts, size: box.getSize(new THREE.Vector3()) };
}

/** Loaded on computers only. A headset never downloads any of this. */
export async function preloadPrefabs(onProgress) {
  if (assets.ready) return;
  const loader = new GLTFLoader();
  const pictures = new THREE.TextureLoader();
  const jobs = [];
  let done = 0;
  const tick = () => {
    done += 1;
    onProgress?.(done, jobs.length);
  };
  for (const name of [...BUILDINGS, ...PROPS]) {
    jobs.push(loader.loadAsync(`assets/city/${name}.gltf`).then((g) => {
      assets.models.set(name, loadModel(g));
    }).then(tick));
  }
  for (const base of [...Object.values(SURFACES)]) {
    for (const [kind, srgb] of [['BaseColor', true], ['Normal', false], ['ORM', false]]) {
      jobs.push(pictures.loadAsync(`assets/city/${base}_${kind}.jpg`).then((t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.flipY = false; // glTF texture coordinates run the other way
        t.anisotropy = 8;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        assets.textures.set(`${base}_${kind}`, t);
      }).then(tick));
    }
  }
  for (const room of ['T_lit_interior_1', 'T_lit_interior_2', 'T_dark_interior']) {
    jobs.push(pictures.loadAsync(`assets/city/${room}.jpg`).then((t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      assets.textures.set(room, t);
    }).then(tick));
  }
  try {
    await Promise.all(jobs);
    assets.ready = true;
  } catch (error) {
    console.warn('Patchwork: the detailed buildings did not load, so the city uses its simple ones.', error);
  }
}

export const prefabsReady = () => assets.ready;
export const prefabSize = (name) => assets.models.get(name)?.size ?? null;
export { BUILDINGS as PREFAB_BUILDINGS };

function surfaceMaterial(base) {
  const orm = assets.textures.get(`${base}_ORM`);
  return new THREE.MeshStandardMaterial({
    map: assets.textures.get(`${base}_BaseColor`),
    normalMap: assets.textures.get(`${base}_Normal`),
    roughnessMap: orm,
    metalnessMap: orm,
    roughness: 1,
    metalness: 1,
    vertexColors: true,
    envMapIntensity: 0.6,
  });
}

/** Places copies of each building. `update` draws just the ones near the player. */
export function buildPrefabs(root, spots, range = 210) {
  if (!assets.ready || !spots.length) return { update() {}, setNight() {} };
  const materials = {
    brick: surfaceMaterial(SURFACES.brick),
    trim: surfaceMaterial(SURFACES.trim),
    metal: surfaceMaterial(SURFACES.metal),
    concrete: surfaceMaterial(SURFACES.concrete),
    plain: new THREE.MeshStandardMaterial({ color: 0x8c8880, roughness: 0.9, vertexColors: false }),
    rooms: new THREE.MeshStandardMaterial({
      map: assets.textures.get('T_dark_interior'), emissiveMap: assets.textures.get('T_lit_interior_1'), emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.8,
    }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x28343c, roughness: 0.06, metalness: 0.9, transparent: true, opacity: 0.55, envMapIntensity: 1.5,
    }),
  };
  const groups = BUILDINGS.map((name) => {
    const mine = spots.filter((s) => s.prefab === name);
    const model = assets.models.get(name);
    const meshes = Object.entries(model.parts).map(([kind, geo]) => {
      const m = new THREE.InstancedMesh(geo, materials[kind], Math.max(1, mine.length));
      m.frustumCulled = false;
      m.receiveShadow = true;
      m.castShadow = false; // the block underneath already casts the shadow
      m.count = 0;
      root.add(m);
      return m;
    });
    const matrices = mine.map((s) => {
      const o = new THREE.Object3D();
      o.position.set(s.x, s.y, s.z);
      o.rotation.y = s.yaw;
      o.scale.setScalar(s.scale);
      o.updateMatrix();
      return o.matrix.clone();
    });
    return { mine, meshes, matrices };
  });
  let timer = 0;
  return {
    update(dt, focus) {
      timer -= dt;
      if (timer > 0) return;
      timer = 0.35;
      for (const { mine, meshes, matrices } of groups) {
        let n = 0;
        mine.forEach((s, i) => {
          if (Math.hypot(s.x - focus.x, s.z - focus.z) > range) return;
          for (const m of meshes) m.setMatrixAt(n, matrices[i]);
          n += 1;
        });
        for (const m of meshes) {
          m.count = n;
          m.instanceMatrix.needsUpdate = true;
        }
      }
    },
    setNight(glow) {
      materials.rooms.emissiveIntensity = glow * 1.6;
    },
  };
}

/** Street furniture is small, so it can be scattered everywhere on a computer. */
export function buildProps(root, spots) {
  if (!assets.ready) return;
  const metal = surfaceMaterial(SURFACES.metal);
  const trim = surfaceMaterial(SURFACES.trim);
  for (const [name, list] of Object.entries(spots)) {
    const model = assets.models.get(name);
    if (!model || !list.length) continue;
    for (const [kind, geo] of Object.entries(model.parts)) {
      const m = new THREE.InstancedMesh(geo, kind === 'metal' ? metal : trim, list.length);
      const o = new THREE.Object3D();
      list.forEach((s, i) => {
        o.position.set(s.x, s.y, s.z);
        o.rotation.y = s.yaw ?? 0;
        o.scale.setScalar(s.scale ?? 1);
        o.updateMatrix();
        m.setMatrixAt(i, o.matrix);
      });
      m.receiveShadow = true;
      m.castShadow = name !== 'Prop_ManholeCover';
      root.add(m);
    }
  }
}
