import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const DEFAULT = { bloom: 0.28, threshold: 0.9, radius: 0.5, exposure: 1, toneMapping: THREE.NoToneMapping };
const SLOW_FRAME = 1 / 24;

// A filmic finish: slightly richer color and darkened corners.
const GRADE = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    varying vec2 vUv;
    uniform sampler2D tDiffuse;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float luma = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(luma), c, 1.3);
      c = mix(c, c * vec3(0.92, 1.03, 1.05), (1.0 - luma) * 0.5);
      c = mix(c, c * vec3(1.1, 1.0, 0.88), luma * 0.55);
      c = clamp(c, 0.0, 1.0);
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.3);
      vec2 d = vUv - 0.5;
      c *= 1.0 - dot(d, d) * 0.55;
      gl_FragColor = vec4(c, 1.0);
    }`,
};

/**
 * The cinematic layer: glow and color grading on desktop. Headsets skip the glow
 * pass, because a phone-class GPU rendering two eyes can't afford it, so worlds
 * should also make their glowing things bright with their own materials.
 */
export class Look {
  constructor(game) {
    this.game = game;
    this.settings = { ...DEFAULT };
    this.composer = null;
    this.slowTime = 0;
    this.lowPower = new URLSearchParams(location.search).has('lowgfx')
      || /OculusBrowser|Quest|Pico|Android|iPhone|iPad/i.test(navigator.userAgent);
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
    if (this.bloomPass) this.applyBloom();
  }

  applyBloom() {
    this.bloomPass.strength = this.settings.bloom;
    this.bloomPass.threshold = this.settings.threshold;
    this.bloomPass.radius = this.settings.radius;
  }

  ensureComposer() {
    if (this.composer) return;
    const { renderer, scene, camera } = this.game;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.3, 0.5, 0.9);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new ShaderPass(GRADE));
    this.applyBloom();
  }

  resize(width, height) {
    this.composer?.setSize(width, height);
  }

  render(dt) {
    const { renderer, scene, camera } = this.game;
    if (!this.high || this.settings.bloom <= 0) {
      renderer.render(scene, camera);
      return;
    }
    // A machine that can't keep up quietly drops to the simple path.
    if (dt >= SLOW_FRAME) this.slowTime += dt;
    else this.slowTime = Math.max(0, this.slowTime - dt);
    if (this.slowTime > 6 && !new URLSearchParams(location.search).has('hifi')) {
      this.lowPower = true;
      console.info('Patchwork: lowered graphics to keep the frame rate up.');
    }
    this.ensureComposer();
    this.composer.render(dt);
  }
}
