import * as THREE from 'three';
import { Input } from './input.js';
import { Sound } from './sound.js';
import { Save } from './save.js';
import { Kit } from './kit.js';

/** Owns the renderer, the player rig and the currently loaded world. */
export class Game {
  constructor(canvas, worlds) {
    this.worlds = new Map(worlds.map((w) => [w.id, w]));
    this.canvas = canvas;
    this.started = false;
    this.busy = false;
    this.time = 0;
    this.kit = null;
    this.world = null;
    this.currentId = null;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local-floor');

    this.scene = new THREE.Scene();
    this.rig = new THREE.Group();
    this.scene.add(this.rig);
    this.camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 1200);
    this.camera.position.y = Game.DESKTOP_EYE;
    this.rig.add(this.camera);

    this.fadeMat = new THREE.MeshBasicMaterial({
      color: 0x000000, transparent: true, opacity: 1, side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false,
    });
    this.fadeMesh = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), this.fadeMat);
    this.fadeMesh.renderOrder = 9999;
    this.camera.add(this.fadeMesh);
    this.fade = { from: 1, to: 1, dur: 1, t: 1, done: null };

    this.save = new Save();
    this.sound = new Sound();
    this.input = new Input(this);

    addEventListener('resize', () => {
      if (this.isXR) return;
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight, false);
    });

    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  static DESKTOP_EYE = 1.6;

  get isXR() {
    return this.renderer.xr.isPresenting;
  }

  /** Worlds that show up as portals in the hub. */
  get portalWorlds() {
    return [...this.worlds.values()].filter((w) => !w.hidden);
  }

  get quilt() {
    const list = this.portalWorlds;
    const done = list.filter((w) => this.save.hasPatch(w.id));
    return { list, done, complete: done.length === list.length };
  }

  frame() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.time += dt;
    this.input.update(dt);
    if (this.world && !this.busy) this.world.update?.(dt, this.time);
    this.kit?.update(dt, this.time);
    this.updateFade(dt);
    this.renderer.render(this.scene, this.camera);
  }

  updateFade(dt) {
    const f = this.fade;
    if (f.t < f.dur) {
      f.t = Math.min(f.dur, f.t + dt);
      this.fadeMat.opacity = THREE.MathUtils.lerp(f.from, f.to, f.t / f.dur);
    }
    this.fadeMesh.visible = this.fadeMat.opacity > 0.001;
    if (f.t >= f.dur && f.done) {
      const done = f.done;
      f.done = null;
      done();
    }
  }

  fadeTo(to, dur) {
    return new Promise((resolve) => {
      this.fade = { from: this.fadeMat.opacity, to, dur, t: 0, done: resolve };
    });
  }

  /** Fade out, swap worlds, fade in. A world that fails to build sends the player home. */
  async enter(id) {
    if (this.busy || !this.worlds.has(id)) return;
    this.busy = true;
    this.input.enabled = false;
    await this.fadeTo(1, 0.22);
    this.kit?.teardown();
    this.kit = null;
    this.world = null;
    let failed = false;
    try {
      this.kit = new Kit(this, this.worlds.get(id));
      this.world = this.worlds.get(id).create(this.kit) || {};
      this.currentId = id;
    } catch (err) {
      console.error(`World "${id}" failed to load`, err);
      this.kit?.teardown();
      this.kit = null;
      failed = id !== 'hub';
    }
    if (failed) {
      this.busy = false;
      return this.enter('hub');
    }
    await this.fadeTo(0, 0.32);
    this.input.enabled = this.started;
    this.busy = false;
  }

  goHome() {
    if (this.currentId !== 'hub') this.enter('hub');
  }

  /** Called once the player leaves the title screen. */
  start() {
    this.started = true;
    this.sound.unlock();
    return this.enter(this.startWorld ?? 'hub');
  }

  async enterVR() {
    this.sound.unlock();
    const session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'],
    });
    session.addEventListener('end', () => {
      this.camera.position.set(0, Game.DESKTOP_EYE, 0);
      this.camera.rotation.set(0, 0, 0);
      this.input.pitch = 0;
      this.onSessionEnd?.();
    });
    await this.renderer.xr.setSession(session);
    this.input.pitch = 0;
    return this.start();
  }
}
