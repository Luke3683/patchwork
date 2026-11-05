const KEY = 'patchwork.save.v1';

/** Progress lives in the browser. Storage can be blocked, so every access is guarded. */
export class Save {
  constructor() {
    this.data = { patches: {}, worlds: {} };
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = { ...this.data, ...JSON.parse(raw) };
    } catch { /* play without saving */ }
  }

  persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch { /* play without saving */ }
  }

  hasPatch(id) {
    return !!this.data.patches[id];
  }

  /** Returns true the first time a patch is earned. */
  earnPatch(id) {
    if (this.data.patches[id]) return false;
    this.data.patches[id] = true;
    this.persist();
    return true;
  }

  /** A small per-world slot for things like saved builds. */
  world(id) {
    return this.data.worlds[id] ?? null;
  }

  setWorld(id, value) {
    this.data.worlds[id] = value;
    this.persist();
  }

  reset() {
    this.data = { patches: {}, worlds: {} };
    this.persist();
  }
}
