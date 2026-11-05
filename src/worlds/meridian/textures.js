import * as THREE from 'three';

const NAMES = ['asphalt', 'grass', 'rock', 'sand', 'snow', 'sidewalk', 'plaster', 'brick', 'concrete'];
const cache = new Map();
let ready = null;

/** Loads the photo textures before the island is built. Headsets skip the extra maps. */
export function preloadTextures(detail = true, onProgress = () => {}) {
  if (ready) return ready;
  const loader = new THREE.TextureLoader();
  const kinds = detail ? ['diff', 'nor', 'rough'] : ['diff'];
  const jobs = NAMES.flatMap((name) => kinds.map((kind) => [name, kind]));
  let done = 0;
  ready = Promise.all(jobs.map(([name, kind]) => loader.loadAsync(`assets/textures/${name}_${kind}.jpg`).then((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 8;
    if (kind === 'diff') t.colorSpace = THREE.SRGBColorSpace;
    cache.set(`${name}_${kind}`, t);
    done += 1;
    onProgress(done, jobs.length);
  }).catch((err) => {
    // A missing texture shouldn't stop the game. That surface just renders flat.
    console.warn(`Could not load ${name}_${kind}`, err);
  })));
  return ready;
}

export const tex = (name, kind = 'diff') => cache.get(`${name}_${kind}`) ?? null;

/** A copy that can have its own tiling, sharing the same image. */
export function tiled(name, kind, x, y = x) {
  const base = tex(name, kind);
  if (!base) return null;
  const t = base.clone();
  t.repeat.set(x, y);
  t.needsUpdate = true;
  return t;
}

/** A photo surface: full detail on desktop, a cheaper material in a headset. */
export function surface(high, name, { repeat = 1, repeatY = repeat, color = 0xffffff, roughness = 1, normalScale = 1, vertexColors = false, ...rest } = {}) {
  const map = tiled(name, 'diff', repeat, repeatY);
  if (!high) return new THREE.MeshLambertMaterial({ map, color, vertexColors, ...rest });
  const normalMap = tiled(name, 'nor', repeat, repeatY);
  return new THREE.MeshStandardMaterial({
    map,
    normalMap,
    normalScale: new THREE.Vector2(normalScale, normalScale),
    roughnessMap: tiled(name, 'rough', repeat, repeatY),
    roughness,
    metalness: 0,
    envMapIntensity: 0.3, // rough ground barely mirrors the sky
    color,
    vertexColors,
    ...rest,
  });
}

/** The ground: grass, rock, sand and snow blended by the weights painted into the terrain. */
export function groundMaterial(high) {
  const material = high
    ? new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, envMapIntensity: 0.35 })
    : new THREE.MeshLambertMaterial();
  material.customProgramCacheKey = () => `meridian-ground-${high}`;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.tGrass = { value: tex('grass') };
    shader.uniforms.tRock = { value: tex('rock') };
    shader.uniforms.tSand = { value: tex('sand') };
    shader.uniforms.tSnow = { value: tex('snow') };
    if (high) {
      shader.uniforms.nGrass = { value: tex('grass', 'nor') };
      shader.uniforms.nRock = { value: tex('rock', 'nor') };
      shader.uniforms.nSand = { value: tex('sand', 'nor') };
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 splat;
        attribute vec3 tint;
        varying vec3 vSplat;
        varying vec3 vTint;
        varying vec3 vGroundPos;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vSplat = splat;
        vTint = tint;
        vGroundPos = (modelMatrix * vec4(position, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tGrass;
        uniform sampler2D tRock;
        uniform sampler2D tSand;
        uniform sampler2D tSnow;
        ${high ? 'uniform sampler2D nGrass; uniform sampler2D nRock; uniform sampler2D nSand;' : ''}
        varying vec3 vSplat;
        varying vec3 vTint;
        varying vec3 vGroundPos;`)
      .replace('#include <map_fragment>', `
        vec2 gp = vGroundPos.xz;
        // Two scales of each photo hide the repeating pattern from far away.
        vec3 gGrass = mix(texture2D(tGrass, gp / 7.0).rgb, texture2D(tGrass, gp / 41.0).rgb, 0.5) * vTint;
        vec3 gRock = mix(texture2D(tRock, gp / 26.0).rgb, texture2D(tRock, vec2(gp.x + gp.y, vGroundPos.y) / 19.0).rgb, 0.5);
        vec3 gSand = texture2D(tSand, gp / 9.0).rgb;
        vec3 gSnow = texture2D(tSnow, gp / 15.0).rgb;
        vec3 gCol = gGrass;
        gCol = mix(gCol, gRock, vSplat.r);
        gCol = mix(gCol, gSand, vSplat.g);
        gCol = mix(gCol, gSnow, vSplat.b);
        diffuseColor.rgb = gCol;`);
    if (high) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
        vec2 nG = texture2D(nGrass, gp / 7.0).xy * 2.0 - 1.0;
        vec2 nR = texture2D(nRock, gp / 26.0).xy * 2.0 - 1.0;
        vec2 nS = texture2D(nSand, gp / 9.0).xy * 2.0 - 1.0;
        vec2 nB = mix(mix(nG, nR, vSplat.r), nS, vSplat.g) * (1.0 - vSplat.b * 0.8);
        normal = normalize(normal + (viewMatrix * vec4(nB.x, 0.0, -nB.y, 0.0)).xyz * 0.85);`);
    }
  };
  return material;
}
