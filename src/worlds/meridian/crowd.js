import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Real animated people, cheap enough to fill a city. Each outfit's animations are baked
 * into a texture, so the graphics card poses everyone at once and a whole street of
 * people costs one draw call per outfit, in a browser or on a headset.
 */
export const OUTFITS = ['casual', 'hoodie', 'beach', 'punk', 'suit', 'worker', 'soldier', 'adventurer', 'formal', 'woman2', 'punk2'];
export const OUTFIT_LABELS = {
  casual: 'Casual', hoodie: 'Hoodie', beach: 'Beachwear', punk: 'Punk', suit: 'Suit', worker: 'Work clothes', soldier: 'Tactical', adventurer: 'Explorer', formal: 'Formal', woman2: 'Street', punk2: 'Rocker',
};
const BAKE_FPS = 24;
const HEIGHT = 1.78;
const MAX_PER_OUTFIT = 72;
const baked = new Map();

const luma = (c) => c.r * 0.3 + c.g * 0.59 + c.b * 0.11;

function bake(gltf) {
  const { scene, animations } = gltf;
  scene.updateMatrixWorld(true);
  const meshes = [];
  scene.traverse((o) => {
    if (o.isSkinnedMesh) meshes.push(o);
  });
  const { skeleton } = meshes[0];

  // The main clothing colors can change from person to person.
  const nameOf = (m) => `${m.name} ${m.parent?.name ?? ''}`;
  const biggest = (test) => {
    let best = null;
    let most = 0;
    for (const m of meshes) {
      const name = m.material.name;
      if (!test(nameOf(m)) || /skin|hair|eye/i.test(name)) continue;
      const count = m.geometry.index?.count ?? m.geometry.attributes.position.count;
      if (count > most) {
        most = count;
        best = m;
      }
    }
    return best;
  };
  const shirtMesh = biggest((n) => /body/i.test(n));
  const pantsMesh = biggest((n) => /legs/i.test(n));
  const skinBase = luma(meshes.find((m) => /^skin$/i.test(m.material.name))?.material.color ?? new THREE.Color(0.5, 0.35, 0.2)) || 1;
  const defaults = { shirt: new THREE.Color(0.3, 0.3, 0.3), pants: new THREE.Color(0.1, 0.1, 0.1) };
  if (shirtMesh) defaults.shirt.copy(shirtMesh.material.color);
  if (pantsMesh) defaults.pants.copy(pantsMesh.material.color);

  const parts = meshes.map((mesh) => {
    const g = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone());
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'skinIndex', 'skinWeight'].includes(name)) g.deleteAttribute(name);
    }
    g.applyMatrix4(mesh.bindMatrix);
    const name = mesh.material.name;
    const { color } = mesh.material;
    let kind = 0;
    let shade = 1;
    if (/skin/i.test(name)) {
      kind = 1;
      shade = luma(color) / skinBase;
    } else if (/hair/i.test(name)) {
      kind = 2;
    } else if (mesh === shirtMesh) {
      kind = 3;
    } else if (mesh === pantsMesh) {
      kind = 4;
    }
    const n = g.attributes.position.count;
    const colors = new Float32Array(n * 3);
    const tint = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
      tint[i * 2] = kind;
      tint[i * 2 + 1] = shade;
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setAttribute('aTint', new THREE.BufferAttribute(tint, 2));
    return g;
  });
  const geometry = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  // Play every animation once, writing the skeleton's pose into a texture row by row.
  const bones = skeleton.bones;
  const clips = {};
  let total = 0;
  for (const clip of animations) {
    const frames = Math.max(2, Math.ceil(clip.duration * BAKE_FPS));
    clips[clip.name.split('|').pop()] = { start: total, frames, duration: clip.duration };
    total += frames;
  }
  const width = bones.length * 4;
  const data = new Float32Array(width * total * 4);
  const mixer = new THREE.AnimationMixer(scene);
  const m = new THREE.Matrix4();
  for (const clip of animations) {
    const info = clips[clip.name.split('|').pop()];
    mixer.stopAllAction();
    const action = mixer.clipAction(clip);
    action.play();
    for (let f = 0; f < info.frames; f++) {
      mixer.setTime((f / info.frames) * clip.duration);
      scene.updateMatrixWorld(true);
      for (let b = 0; b < bones.length; b++) {
        m.multiplyMatrices(bones[b].matrixWorld, skeleton.boneInverses[b]);
        m.toArray(data, (info.start + f) * width * 4 + b * 16);
      }
    }
    action.stop();
    mixer.uncacheClip(clip);
  }
  // Measure them standing, to make everyone a person's height with their feet on the ground.
  const idle = clips.Idle ?? Object.values(clips)[0];
  const position = geometry.attributes.position;
  const skinIndex = geometry.attributes.skinIndex;
  const skinWeight = geometry.attributes.skinWeight;
  const row = idle.start * width * 4;
  const bone = new THREE.Matrix4();
  const point = new THREE.Vector3();
  let low = Infinity;
  let top = -Infinity;
  for (let i = 0; i < position.count; i += 3) {
    let y = 0;
    for (const [get, w] of [[skinIndex.getX(i), skinWeight.getX(i)], [skinIndex.getY(i), skinWeight.getY(i)]]) {
      if (w <= 0) continue;
      bone.fromArray(data, row + get * 16);
      point.fromBufferAttribute(position, i).applyMatrix4(bone);
      y += point.y * w;
    }
    y /= Math.max(0.01, skinWeight.getX(i) + skinWeight.getY(i));
    low = Math.min(low, y);
    top = Math.max(top, y);
  }
  const scale = HEIGHT / Math.max(0.01, top - low);
  const texture = new THREE.DataTexture(data, width, total, THREE.RGBAFormat, THREE.FloatType);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return { geometry, texture, clips, scale, footY: low * scale, defaults };
}

/** Loads and bakes every outfit, once, before the world is built. */
export async function preloadCrowd(onProgress) {
  const loader = new GLTFLoader();
  let done = 0;
  await Promise.all(OUTFITS.map(async (name) => {
    if (baked.has(name)) return;
    try {
      const gltf = await loader.loadAsync(`assets/people/${name}.glb`);
      baked.set(name, bake(gltf));
    } catch (error) {
      console.warn(`Patchwork: could not load the ${name} outfit.`, error);
    }
    done += 1;
    onProgress?.(done, OUTFITS.length);
  }));
}

const DECLARE = /* glsl */`
  attribute vec2 aTint;
  attribute vec4 skinIndex;
  attribute vec4 skinWeight;
  attribute vec3 aFrame;
  attribute vec2 aPrev;
  attribute vec4 aColors;
  vec3 unpackColor(float v) {
    vec3 c = vec3(mod(floor(v / 65536.0), 256.0), mod(floor(v / 256.0), 256.0), mod(v, 256.0)) / 255.0;
    return mix(c * 0.0773993808, pow(c * 0.9478672986 + 0.0521327014, vec3(2.4)), step(0.04045, c));
  }
  uniform highp sampler2D boneTex;
  mat4 boneAt(int b, int f) {
    return mat4(
      texelFetch(boneTex, ivec2(b * 4, f), 0),
      texelFetch(boneTex, ivec2(b * 4 + 1, f), 0),
      texelFetch(boneTex, ivec2(b * 4 + 2, f), 0),
      texelFetch(boneTex, ivec2(b * 4 + 3, f), 0));
  }
  mat4 poseAt(int f) {
    ivec4 i = ivec4(skinIndex);
    return skinWeight.x * boneAt(i.x, f) + skinWeight.y * boneAt(i.y, f) + skinWeight.z * boneAt(i.z, f) + skinWeight.w * boneAt(i.w, f);
  }
  mat4 crowdPose() {
    mat4 a = poseAt(int(aFrame.x));
    #ifdef CROWD_SMOOTH
      a = a * (1.0 - aFrame.z) + poseAt(int(aFrame.y)) * aFrame.z;
      if (aPrev.y > 0.001) a = a * (1.0 - aPrev.y) + poseAt(int(aPrev.x)) * aPrev.y;
    #endif
    return a;
  }
`;

function patchSurface(material, texture) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.boneTex = { value: texture };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${DECLARE}`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        if (aTint.x > 0.5) {
          float picked = aTint.x < 1.5 ? aColors.x : aTint.x < 2.5 ? aColors.y : aTint.x < 3.5 ? aColors.z : aColors.w;
          vColor = unpackColor(picked) * aTint.y;
        }`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        mat4 crowd = crowdPose();
        objectNormal = normalize(mat3(crowd) * objectNormal);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed = (crowd * vec4(position, 1.0)).xyz;`);
  };
}

function patchDepth(material, texture) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.boneTex = { value: texture };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${DECLARE}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed = (crowdPose() * vec4(position, 1.0)).xyz;`);
  };
}

/** One outfit, ready to be drawn many times per frame. */
class OutfitMesh {
  constructor(root, name, high) {
    const b = baked.get(name);
    this.baked = b;
    this.name = name;
    const geometry = b.geometry.clone();
    const add = (attr, size) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PER_OUTFIT * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(attr, a);
      return a;
    };
    this.attrs = { frame: add('aFrame', 3), prev: add('aPrev', 2), colors: add('aColors', 4) };
    const material = high ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0 }) : new THREE.MeshLambertMaterial({ vertexColors: true });
    if (high) material.defines = { CROWD_SMOOTH: 1 };
    patchSurface(material, b.texture);
    this.mesh = new THREE.InstancedMesh(geometry, material, MAX_PER_OUTFIT);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.castShadow = high;
    if (high) {
      const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      depth.defines = { CROWD_SMOOTH: 1 };
      patchDepth(depth, b.texture);
      this.mesh.customDepthMaterial = depth;
    }
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    root.add(this.mesh);
    this.count = 0;
  }

  begin() {
    this.count = 0;
  }

  finish() {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    for (const a of Object.values(this.attrs)) a.needsUpdate = true;
  }
}

const scratch = new THREE.Object3D();
const BLEND_TIME = 0.16;

/** Draws people. Each person is any object with position, facing, an outfit and colors. */
export class Crowd {
  constructor(root, high) {
    this.outfits = new Map();
    for (const name of OUTFITS) if (baked.has(name)) this.outfits.set(name, new OutfitMesh(root, name, high));
    this.ready = this.outfits.size > 0;
  }

  begin() {
    for (const o of this.outfits.values()) o.begin();
  }

  finish() {
    for (const o of this.outfits.values()) o.finish();
  }

  /** Moves a person's animation on, and draws them this frame. */
  draw(p, clipName, rate, dt, { hold = false, restart = false, dip = 0 } = {}) {
    const outfit = this.outfits.get(p.outfit) ?? this.outfits.values().next().value;
    if (!outfit || outfit.count >= MAX_PER_OUTFIT) return;
    const { clips, scale, footY, defaults } = outfit.baked;
    const clip = clips[clipName] ?? clips.Idle;

    if (p.clip !== clip || restart) {
      if (p.clip) {
        p.prevFrame = p.frameNow ?? clip.start;
        p.blend = 1;
      }
      p.clip = clip;
      p.clipT = 0;
    }
    p.clipT += dt * rate;
    const f = (p.clipT / clip.duration) * clip.frames;
    let frameA;
    let frameB;
    let frac;
    if (hold && f >= clip.frames - 1) {
      frameA = clip.frames - 1;
      frameB = frameA;
      frac = 0;
    } else {
      const wrapped = ((f % clip.frames) + clip.frames) % clip.frames;
      frameA = Math.floor(wrapped);
      frameB = (frameA + 1) % clip.frames;
      frac = wrapped - frameA;
    }
    p.frameNow = clip.start + frameA;
    p.blend = Math.max(0, (p.blend ?? 0) - dt / BLEND_TIME);

    const i = outfit.count;
    outfit.count += 1;
    scratch.position.set(p.x, p.y - dip - footY * (p.size ?? 1), p.z);
    scratch.rotation.set(0, p.yaw + Math.PI, 0);
    scratch.scale.setScalar(scale * (p.size ?? 1));
    scratch.updateMatrix();
    outfit.mesh.setMatrixAt(i, scratch.matrix);

    const { frame, prev, colors } = outfit.attrs;
    frame.setXYZ(i, clip.start + frameA, clip.start + frameB, frac);
    prev.setXY(i, p.prevFrame ?? 0, p.blend);
    colors.setXYZW(i, p.skin, p.hair ?? 0x2a1c14, p.shirt ?? defaults.shirt.getHex(), p.pants ?? defaults.pants.getHex());
  }
}
