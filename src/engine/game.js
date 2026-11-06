import * as THREE from 'three';
import { Input } from './input.js';
import { Sound } from './sound.js';
import { Save } from './save.js';
import { Kit } from './kit.js';
import { Net } from './net.js';
import { loadPrefs } from './prefs.js';
import { Look } from './look.js';

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
    this.prefs = loadPrefs(this.save.data.prefs);
    this.look = new Look(this);
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.net = new Net(this);
    this.applyPrefs();

    addEventListener('resize', () => {
      if (this.isXR) return;
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight, false);
      this.look.resize();
    });

    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  static DESKTOP_EYE = 1.6;

  get isXR() {
    return this.renderer.xr.isPresenting;
  }

  /** Pushes the player's settings into the systems that use them. */
  applyPrefs() {
    const { audio, comfort, gear } = this.prefs;
    this.sound.setLevels(audio.volume / 100, audio.voice / 100);
    this.camera.fov = comfort.fov;
    this.camera.updateProjectionMatrix();
    for (const hand of this.input.controllers) hand.laser.material.color.set(gear.laserColor);
  }

  savePrefs() {
    this.save.data.prefs = this.prefs;
    this.save.persist();
    this.applyPrefs();
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
    this.net.update(dt);
    if (this.world && !this.busy) this.world.update?.(dt, this.time);
    this.kit?.update(dt, this.time);
    this.updateFade(dt);
    this.look.render();
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
      // Others hear we've arrived first, so a new world can talk to them as it builds.
      this.currentId = id;
      this.net.worldChanged();
      this.kit = new Kit(this, this.worlds.get(id));
      this.world = this.worlds.get(id).create(this.kit) || {};
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
    const target = this.startWorld ?? this.currentId ?? 'hub';
    // The title screen already runs inside the first world, so there's nothing to rebuild.
    if (target === this.currentId && !this.busy) {
      this.input.enabled = true;
      this.net.worldChanged();
      this.world?.onStart?.();
      return Promise.resolve();
    }
    return this.enter(target);
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
