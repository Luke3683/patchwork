const KEY = 'patchwork.save.v1';

/** Progress lives in the browser. Storage can be blocked, so every access is guarded. */
export class Save {
  constructor() {
    this.data = Save.blank();
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = { ...this.data, ...JSON.parse(raw) };
    } catch { /* play without saving */ }
  }

  static blank() {
    return { patches: {}, worlds: {}, coins: 0, unlocked: {}, prefs: {}, profile: null };
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

  get coins() {
    return Number.isFinite(this.data.coins) ? this.data.coins : 0;
  }

  addCoins(n) {
    this.data.coins = Math.max(0, this.coins + n);
    this.persist();
  }

  isUnlocked(key) {
    return !!this.data.unlocked[key];
  }

  /** Spends coins on an unlock. Returns false if the player can't afford it. */
  buy(key, cost) {
    if (this.coins < cost) return false;
    this.data.coins = this.coins - cost;
    this.data.unlocked[key] = true;
    this.persist();
    return true;
  }

  reset() {
    this.data = Save.blank();
    this.persist();
  }
}
