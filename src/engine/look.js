import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const DEFAULT = { bloom: 0.28, threshold: 0.9, radius: 0.5, exposure: 1, toneMapping: THREE.NoToneMapping };
const MAX_PIXEL_RATIO = 1.5;
// How long the graphics card may take on a frame, in milliseconds, before the resolution
// changes. Measured directly where the browser allows it, because the gap between frames can
// mislead: a 30 Hz limit in a browser or monitor looks just like a slow card.
const GPU_SLOW = 18;
const GPU_FAST = 11;
const GAP_SLOW = 1000 / 48; // used only when the card can't be timed
const GAP_FAST = 1000 / 54;
const SETTLE_MS = 4000; // shaders compile and textures upload just after loading, so don't judge yet
const MIN_SCALE = 0.6;

const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

const BRIGHT = `
  varying vec2 vUv;
  uniform sampler2D tex;
  uniform float threshold;
  void main() {
    vec3 c = texture2D(tex, vUv).rgb;
    float l = max(c.r, max(c.g, c.b));
    float keep = smoothstep(threshold, threshold + 0.5, l);
    gl_FragColor = vec4(min(c * keep, vec3(4.0)), 1.0);
  }
`;

const BLUR = `
  varying vec2 vUv;
  uniform sampler2D tex;
  uniform vec2 step;
  void main() {
    vec3 c = texture2D(tex, vUv).rgb * 0.227;
    c += (texture2D(tex, vUv + step * 1.385).rgb + texture2D(tex, vUv - step * 1.385).rgb) * 0.316;
    c += (texture2D(tex, vUv + step * 3.231).rgb + texture2D(tex, vUv - step * 3.231).rgb) * 0.07;
    gl_FragColor = vec4(c, 1.0);
  }
`;

// The last step: glow, tone mapping, then a filmic finish of richer color and darkened corners.
const FINAL = `
  varying vec2 vUv;
  uniform sampler2D scene;
  uniform sampler2D glowNear;
  uniform sampler2D glowFar;
  uniform float bloom;
  uniform float radius;
  uniform float exposure;
  uniform float film;

  vec3 aces(vec3 color) {
    const mat3 inputM = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
    const mat3 outputM = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
    color = inputM * (color * exposure / 0.6);
    vec3 a = color * (color + 0.0245786) - 0.000090537;
    vec3 b = color * (0.983729 * color + 0.4329510) + 0.238081;
    return clamp(outputM * (a / b), 0.0, 1.0);
  }

  void main() {
    vec3 c = texture2D(scene, vUv).rgb;
    c += (texture2D(glowNear, vUv).rgb * (1.0 - radius * 0.5) + texture2D(glowFar, vUv).rgb * (0.5 + radius)) * bloom;
    if (film > 0.5) c = aces(c);
    else c = clamp(c * exposure, 0.0, 1.0);
    c = mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0031308)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
    if (film > 0.5) {
      float luma = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(luma), c, 1.12);
      c = mix(c, c * vec3(1.05, 1.0, 0.94), luma * 0.5);
      c = clamp(c, 0.0, 1.0);
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.26);
    }
    vec2 d = vUv - 0.5;
    c *= 1.0 - dot(d, d) * 0.5;
    gl_FragColor = vec4(c, 1.0);
  }
`;

/**
 * The cinematic layer on desktop: one smoothed scene render, a cheap glow, and a film
 * finish. It watches the frame rate and lowers the resolution rather than stuttering.
 * Headsets skip all of this, since a phone-class GPU rendering two eyes can't afford it.
 */
export class Look {
  constructor(game) {
    this.game = game;
    this.settings = { ...DEFAULT };
    this.scale = 1;
    this.targets = null;
    this.frameTime = 1 / 60;
    this.gpuMs = null;
    this.lastFrame = 0;
    this.lastChange = 0;
    this.lowPower = new URLSearchParams(location.search).has('lowgfx')
      || /OculusBrowser|Quest|Pico|Android|iPhone|iPad/i.test(navigator.userAgent);
    game.renderer.setPixelRatio(Math.min(devicePixelRatio, MAX_PIXEL_RATIO));
    game.renderer.shadowMap.enabled = true;
    game.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  }

  /** Whether this machine is running the full-quality path right now. */
  get high() {
    return !this.lowPower && !this.game.isXR && this.game.prefs?.comfort.graphics !== 'low';
  }

  set(options = {}) {
    this.settings = { ...DEFAULT, ...options };
    const { renderer } = this.game;
    renderer.toneMapping = this.settings.toneMapping;
    renderer.toneMappingExposure = this.settings.exposure;
  }

  resize() {
    this.disposeTargets();
  }

  disposeTargets() {
    if (!this.targets) return;
    for (const t of Object.values(this.targets)) t.dispose();
    this.targets = null;
  }

  ensureTargets() {
    if (this.targets) return;
    const { renderer } = this.game;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const w = Math.max(2, Math.round(size.x * this.scale));
    const h = Math.max(2, Math.round(size.y * this.scale));
    const small = (div) => new THREE.WebGLRenderTarget(Math.max(2, w >> div), Math.max(2, h >> div), { type: THREE.HalfFloatType, depthBuffer: false });
    this.targets = {
      scene: new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 2 }),
      a2: small(2),
      b2: small(2),
      a3: small(3),
      b3: small(3),
    };
    if (!this.quad) {
      const mat = (fragmentShader, uniforms) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false });
      this.bright = mat(BRIGHT, { tex: { value: null }, threshold: { value: 1 } });
      this.blur = mat(BLUR, { tex: { value: null }, step: { value: new THREE.Vector2() } });
      this.final = mat(FINAL, {
        scene: { value: null }, glowNear: { value: null }, glowFar: { value: null }, bloom: { value: 0 }, radius: { value: 0 }, exposure: { value: 1 }, film: { value: 0 },
      });
      this.quad = new FullScreenQuad(this.bright);
    }
  }

  pass(material, target) {
    const { renderer } = this.game;
    this.quad.material = material;
    renderer.setRenderTarget(target);
    this.quad.render(renderer);
  }

  blurInto(source, temp, out) {
    const { blur } = this;
    blur.uniforms.tex.value = source.texture;
    blur.uniforms.step.value.set(1 / source.width, 0);
    this.pass(blur, temp);
    blur.uniforms.tex.value = temp.texture;
    blur.uniforms.step.value.set(0, 1 / source.height);
    this.pass(blur, out);
  }

  /** Starts timing this frame on the graphics card, unless the last result is still on its way. */
  timeStart() {
    if (this.timer === undefined) {
      this.timer = this.game.renderer.getContext().getExtension('EXT_disjoint_timer_query_webgl2');
    }
    if (!this.timer || this.query) return;
    const gl = this.game.renderer.getContext();
    this.query = gl.createQuery();
    gl.beginQuery(this.timer.TIME_ELAPSED_EXT, this.query);
    this.timing = true;
  }

  timeEnd() {
    if (!this.timer) return;
    const gl = this.game.renderer.getContext();
    if (this.timing) {
      gl.endQuery(this.timer.TIME_ELAPSED_EXT);
      this.timing = false;
      return;
    }
    if (!this.query || !gl.getQueryParameter(this.query, gl.QUERY_RESULT_AVAILABLE)) return;
    if (!gl.getParameter(this.timer.GPU_DISJOINT_EXT)) {
      const ms = gl.getQueryParameter(this.query, gl.QUERY_RESULT) / 1e6;
      this.gpuMs = this.gpuMs === null ? ms : this.gpuMs + (ms - this.gpuMs) * 0.1;
    }
    gl.deleteQuery(this.query);
    this.query = null;
  }

  /** Keeps the frame rate up by trading resolution, a little at a time. */
  adapt(now) {
    const elapsed = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    // Long pauses are loading or a hidden tab, not a sign the graphics are too heavy.
    if (elapsed <= 0 || elapsed > 0.25 || document.hidden) {
      this.settleUntil = now + SETTLE_MS;
      return;
    }
    if (now < (this.settleUntil ?? 0)) return;
    this.frameTime += (elapsed - this.frameTime) * 0.05;
    if (now - this.lastChange < 1500) return;
    const timed = this.gpuMs !== null;
    const cost = timed ? this.gpuMs : this.frameTime * 1000;
    const slow = timed ? GPU_SLOW : GAP_SLOW;
    const fast = timed ? GPU_FAST : GAP_FAST;
    let next = this.scale;
    // Well under 30 frames a second is too slow whatever the card's timer says.
    const crawling = this.frameTime > 1 / 22;
    if (cost > slow || crawling) {
      next = Math.max(MIN_SCALE, Math.round((this.scale - 0.1) * 10) / 10);
      // Climbing back to this resolution just made it slow, so wait a while before trying again.
      if (now - this.lastRaise < 4000) this.raiseAfter = now + 30000;
    } else if (cost < fast && !crawling && now - this.lastChange > 5000 && now > (this.raiseAfter ?? 0)) {
      next = Math.min(1, Math.round((this.scale + 0.1) * 10) / 10);
      if (next !== this.scale) this.lastRaise = now;
    }
    if (next !== this.scale) {
      this.scale = next;
      this.lastChange = now;
      this.disposeTargets();
    }
  }

  render() {
    const { renderer, scene, camera } = this.game;
    if (!this.high) {
      renderer.render(scene, camera);
      return;
    }
    this.adapt(performance.now());
    this.ensureTargets();
    this.timeStart();
    const { targets: t, settings: s } = this;
    renderer.setRenderTarget(t.scene);
    renderer.render(scene, camera);

    this.bright.uniforms.tex.value = t.scene.texture;
    this.bright.uniforms.threshold.value = s.threshold;
    this.pass(this.bright, t.a2);
    this.blurInto(t.a2, t.b2, t.a2);
    this.blur.uniforms.tex.value = t.a2.texture;
    this.blur.uniforms.step.value.set(0, 0);
    this.pass(this.blur, t.a3);
    this.blurInto(t.a3, t.b3, t.a3);

    const u = this.final.uniforms;
    u.scene.value = t.scene.texture;
    u.glowNear.value = t.a2.texture;
    u.glowFar.value = t.a3.texture;
    u.bloom.value = s.bloom;
    u.radius.value = s.radius;
    u.exposure.value = s.exposure;
    u.film.value = s.toneMapping === THREE.NoToneMapping ? 0 : 1;
    this.pass(this.final, null);
    this.timeEnd();
  }
}
