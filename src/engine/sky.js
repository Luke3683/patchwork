import * as THREE from 'three';

const VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
  }
`;

const FRAG = /* glsl */`
  varying vec3 vDir;
  uniform vec3 top;
  uniform vec3 horizon;
  uniform vec3 ground;
  uniform vec3 sunDir;
  uniform vec3 sunColor;
  uniform vec3 cloudColor;
  uniform float night;
  uniform float time;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < CLOUD_OCTAVES; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = max(d.y, 0.0);
    vec3 col = mix(horizon, top, pow(h, 0.48));
    col = mix(col, ground, smoothstep(0.0, -0.06, d.y));

    float sd = max(dot(d, sunDir), 0.0);
    float up = smoothstep(-0.1, 0.05, sunDir.y);
    col += sunColor * up * (pow(sd, 1400.0) * 14.0 + pow(sd, 90.0) * 0.4 + pow(sd, 7.0) * 0.12);

    // The moon sits opposite the sun.
    float md = max(dot(d, -sunDir), 0.0);
    col += vec3(0.8, 0.85, 1.0) * night * (smoothstep(0.99955, 0.9997, md) * 1.6 + pow(md, 60.0) * 0.08);

    if (night > 0.01 && d.y > 0.0) {
      vec2 sp = d.xz / (d.y + 0.35) * 170.0;
      vec2 cell = floor(sp);
      float star = hash(cell);
      if (star > 0.985) {
        float twinkle = 0.65 + 0.35 * sin(time * (1.0 + star * 3.0) + star * 90.0);
        float dist = length(fract(sp) - 0.5);
        col += vec3(1.0, 0.96, 0.9) * smoothstep(0.32, 0.0, dist) * twinkle * night * smoothstep(0.0, 0.2, d.y) * 1.3;
      }
    }

    if (d.y > 0.0) {
      vec2 uv = d.xz / (d.y + 0.14) * 1.15 + vec2(time * 0.006, time * 0.002);
      float n = fbm(uv * 1.6);
      float shape = smoothstep(0.5, 0.78, n) * smoothstep(0.0, 0.14, d.y);
      float thick = smoothstep(0.55, 0.95, n);
      vec3 cloud = mix(cloudColor, cloudColor * 0.62, thick);
      cloud += sunColor * up * pow(sd, 5.0) * 0.55;
      col = mix(col, cloud, shape * 0.92);
    }

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const WHITE = new THREE.Color();
const SNAP = new THREE.Vector3();
const SAVED = new THREE.Color();
const c = (hex) => new THREE.Color(hex);
// One entry per time of day. t runs from 0 (midnight) through 0.5 (noon) back to 1.
const KEYS = [
  { t: 0.0, top: c(0x03050f), horizon: c(0x0b1430), sun: c(0x96a8d8), cloud: c(0x151b30), sky: 0.5, light: 0.45 },
  { t: 0.215, top: c(0x05081a), horizon: c(0x172040), sun: c(0x96a8d8), cloud: c(0x1c2340), sky: 0.5, light: 0.45 },
  { t: 0.262, top: c(0x233a78), horizon: c(0xff8d5c), sun: c(0xff9f6b), cloud: c(0xe88a78), sky: 0.55, light: 1.3 },
  { t: 0.33, top: c(0x1a5fd0), horizon: c(0xbfe8ff), sun: c(0xfff0d2), cloud: c(0xffffff), sky: 0.5, light: 2.1 },
  { t: 0.5, top: c(0x0f50c9), horizon: c(0x9fe0ff), sun: c(0xfff6e8), cloud: c(0xffffff), sky: 0.46, light: 2.3 },
  { t: 0.67, top: c(0x2a6cc9), horizon: c(0xffe6c9), sun: c(0xffdba0), cloud: c(0xffeed8), sky: 0.5, light: 2.1 },
  { t: 0.735, top: c(0x1f4a94), horizon: c(0xff9a68), sun: c(0xffb98a), cloud: c(0xff9c8c), sky: 0.72, light: 1.5 },
  { t: 0.785, top: c(0x0a2050), horizon: c(0xb8406a), sun: c(0xd8607a), cloud: c(0x5c2a58), sky: 0.5, light: 0.6 },
  { t: 0.84, top: c(0x05081a), horizon: c(0x172040), sun: c(0x96a8d8), cloud: c(0x1c2340), sky: 0.5, light: 0.45 },
  { t: 1.0, top: c(0x03050f), horizon: c(0x0b1430), sun: c(0x96a8d8), cloud: c(0x151b30), sky: 0.5, light: 0.45 },
];

/** A full day and night: moving sun, clouds, stars, and matching light and fog. */
export class DynamicSky {
  constructor(k, { time = 0.72, cycleMinutes = 16, fogNear = 180, fogFar = 1500 } = {}) {
    this.k = k;
    this.time = time;
    this.cycleMinutes = cycleMinutes;
    this.frozen = false;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.night = 0;
    this.fogNear = fogNear;
    this.fogFar = fogFar;
    this.uniforms = {
      top: { value: new THREE.Color() },
      horizon: { value: new THREE.Color() },
      ground: { value: new THREE.Color() },
      sunDir: { value: this.sunDir },
      sunColor: { value: new THREE.Color() },
      cloudColor: { value: new THREE.Color() },
      night: { value: 0 },
      time: { value: 0 },
    };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(2600, 32, 20),
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: this.uniforms,
        side: THREE.BackSide,
        depthWrite: false,
        defines: { CLOUD_OCTAVES: k.game.look.high ? 5 : 3 },
      }),
    );
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    k.root.add(this.dome);
    k.skyObj = this.dome;

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
    this.light = new THREE.DirectionalLight(0xffffff, 1);
    k.root.add(this.hemi, this.light, this.light.target);
    if (k.game.look.high) {
      this.light.castShadow = true;
      this.light.shadow.mapSize.set(2048, 2048);
      const cam = this.light.shadow.camera;
      cam.left = -130;
      cam.right = 130;
      cam.top = 130;
      cam.bottom = -130;
      cam.near = 10;
      cam.far = 1100;
      this.light.shadow.bias = -0.0006;
      this.light.shadow.normalBias = 0.6;
    }
    k.scene.fog = new THREE.Fog(0xffffff, fogNear, fogFar);
    this.update(0, new THREE.Vector3());
    if (k.game.look.high) {
      // Everything glossy reflects this sky, refreshed as the time of day changes.
      this.pmrem = new THREE.PMREMGenerator(k.game.renderer);
      this.envScene = new THREE.Scene();
      this.envScene.add(new THREE.Mesh(this.dome.geometry, this.dome.material));
      this.envTarget = null;
      this.envTime = -1;
      k.onDispose(() => {
        k.scene.environment = null;
        this.envTarget?.dispose();
        this.pmrem.dispose();
      });
    }
  }

  /** The current colors, blended between the two nearest times of day. */
  sample() {
    const t = this.time;
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1].t <= t) i++;
    const a = KEYS[i];
    const b = KEYS[i + 1];
    const f = THREE.MathUtils.clamp((t - a.t) / (b.t - a.t), 0, 1);
    return { a, b, f };
  }

  update(dt, focus) {
    if (!this.frozen) this.time = (this.time + dt / (this.cycleMinutes * 60)) % 1;
    const u = this.uniforms;
    u.time.value += dt;
    const { a, b, f } = this.sample();
    u.top.value.lerpColors(a.top, b.top, f);
    u.horizon.value.lerpColors(a.horizon, b.horizon, f);
    u.ground.value.copy(u.horizon.value).multiplyScalar(0.35);
    u.sunColor.value.lerpColors(a.sun, b.sun, f);
    u.cloudColor.value.lerpColors(a.cloud, b.cloud, f);

    const angle = (this.time - 0.25) * Math.PI * 2;
    this.sunDir.set(Math.cos(angle) * 0.92, Math.sin(angle), 0.38).normalize();
    this.night = THREE.MathUtils.smoothstep(-this.sunDir.y, -0.02, 0.2);
    this.dusk = THREE.MathUtils.smoothstep(-this.sunDir.y, -0.1, 0.12); // city lights come on before dark
    u.night.value = this.night;

    const skyLevel = THREE.MathUtils.lerp(a.sky, b.sky, f);
    const lightLevel = THREE.MathUtils.lerp(a.light, b.light, f);
    // Plenty of bounce light, so shadows stay readable at street level even at sunset.
    WHITE.setRGB(1, 1, 1);
    this.hemi.color.copy(u.top.value).lerp(u.horizon.value, 0.5).lerp(WHITE, 0.62);
    this.hemi.groundColor.copy(u.horizon.value).lerp(WHITE, 0.5).multiplyScalar(0.72);
    this.hemi.intensity = skyLevel * (this.pmrem ? 2.3 : 2.5);
    this.light.color.copy(u.sunColor.value).lerp(WHITE, 0.42);
    this.light.intensity = lightLevel;
    const lightDir = this.sunDir.y > -0.03 ? this.sunDir : this.moonDir();
    // Moving the shadow area in steps stops shadow edges crawling as you walk.
    SNAP.set(Math.round(focus.x / 4) * 4, Math.round(focus.y / 4) * 4, Math.round(focus.z / 4) * 4);
    this.light.position.copy(SNAP).addScaledVector(lightDir, 500);
    this.light.target.position.copy(SNAP);
    if (this.light.castShadow) {
      // Shadows redraw every other frame, which nobody can see and saves a lot of work.
      this.shadowTick = !this.shadowTick;
      this.light.shadow.autoUpdate = false;
      this.light.shadow.needsUpdate = this.shadowTick;
    }

    if (this.pmrem && !this.k.game.isXR && Math.abs(this.time - this.envTime) > 0.02) {
      this.envTime = this.time;
      const old = this.envTarget;
      const { toneMapping } = this.k.game.renderer;
      this.k.game.renderer.toneMapping = THREE.NoToneMapping;
      // Light bounced from the sky is paler than the sky looks. A pure blue dome would turn
      // every gray road and shadow blue.
      SAVED.copy(u.top.value);
      u.top.value.lerp(WHITE, 0.45).lerp(u.horizon.value, 0.3);
      this.envTarget = this.pmrem.fromScene(this.envScene, 0, 1, 4000);
      u.top.value.copy(SAVED);
      this.k.game.renderer.toneMapping = toneMapping;
      this.k.scene.environment = this.envTarget.texture;
      this.k.scene.environmentIntensity = 0.9;
      old?.dispose();
    }

    const fog = this.k.scene.fog;
    fog.color.copy(u.horizon.value).lerp(u.top.value, 0.12);
    this.dome.position.copy(focus);
  }

  moonDir() {
    this.moon ??= new THREE.Vector3();
    return this.moon.copy(this.sunDir).negate().setY(Math.abs(this.sunDir.y) + 0.2).normalize();
  }
}
