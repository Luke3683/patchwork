// Levels, upgrades and everything that keeps the game moving. Add an upgrade to
// UPGRADES and it appears in the menu. Saved in the player's browser.

export const UPGRADES = {
  engine: { name: 'Engine', note: 'Top speed and acceleration for everything you drive', max: 5, base: 60 },
  handling: { name: 'Handling', note: 'Sharper turns and better grip', max: 5, base: 50 },
  nitro: { name: 'Nitro', note: 'Stronger boost that lasts longer', max: 3, base: 90 },
  boots: { name: 'Jump boots', note: 'Jump higher on foot', max: 3, base: 40 },
  sprint: { name: 'Sprint', note: 'Run faster on foot', max: 3, base: 40 },
  boxing: { name: 'Boxing', note: 'Your punches land harder', max: 3, base: 70 },
  toughness: { name: 'Toughness', note: 'Take less damage in a fight', max: 3, base: 70 },
  jetpack: { name: 'Jetpack', note: 'Hold jump in the air to fly. More levels, more fuel', max: 3, base: 200, level: 3 },
};

export const VEHICLE_UNLOCKS = {
  heli: { name: 'Helicopter', cost: 180, level: 2 },
  supercar: { name: 'Supercar', cost: 320, level: 3 },
  jet: { name: 'Jet', cost: 700, level: 5 },
};

export const PAINTS = [0xe4572e, 0x2e86ab, 0xffd23f, 0x7cff6b, 0xff3d8b, 0x7d4ea8, 0xf2ece0, 0x23252c, 0x35e0ff, 0xc9402f];

export const upgradeCost = (id, level) => Math.round(UPGRADES[id].base * 1.75 ** level);
export const xpForLevel = (level) => Math.round(120 * level ** 1.55);

const blank = () => ({
  xp: 0, level: 1, upgrades: {}, shards: [], zones: [], best: {}, owned: {}, paints: {}, time: 'cycle', jobsDone: 0,
});

export class Progress {
  constructor(world) {
    this.world = world;
    this.save = world.k.save;
    const saved = this.save.world('meridian');
    this.data = { ...blank(), ...(saved && typeof saved === 'object' ? saved : {}) };
    for (const id of Object.keys(UPGRADES)) {
      if (!Number.isInteger(this.data.upgrades[id])) this.data.upgrades[id] = 0;
    }
  }

  persist() {
    this.save.setWorld('meridian', this.data);
  }

  get upgrades() {
    return this.data.upgrades;
  }

  get level() {
    return this.data.level;
  }

  get coins() {
    return this.save.coins;
  }

  /** How far through the current level, from 0 to 1. */
  get levelProgress() {
    return Math.min(1, this.data.xp / xpForLevel(this.data.level));
  }

  grant(xp, coins, reason) {
    this.data.xp += xp;
    if (coins) this.save.addCoins(coins);
    const parts = [];
    if (coins) parts.push(`+${coins} coins`);
    if (xp) parts.push(`+${xp} XP`);
    this.world.hud.flash(reason, parts.join('  '));
    while (this.data.xp >= xpForLevel(this.data.level)) {
      this.data.xp -= xpForLevel(this.data.level);
      this.data.level += 1;
      this.world.onLevelUp(this.data.level);
    }
    this.persist();
  }

  canBuyUpgrade(id) {
    const def = UPGRADES[id];
    const lv = this.upgrades[id];
    if (lv >= def.max) return { ok: false, why: 'Maxed out' };
    if ((def.level ?? 0) > this.level) return { ok: false, why: `Reach level ${def.level}` };
    if (this.coins < upgradeCost(id, lv)) return { ok: false, why: `${upgradeCost(id, lv)} coins` };
    return { ok: true, why: `Buy ${upgradeCost(id, lv)}` };
  }

  buyUpgrade(id) {
    if (!this.canBuyUpgrade(id).ok) return false;
    this.save.addCoins(-upgradeCost(id, this.upgrades[id]));
    this.upgrades[id] += 1;
    this.persist();
    return true;
  }

  owns(type) {
    return !VEHICLE_UNLOCKS[type] || !!this.data.owned[type];
  }

  canBuyVehicle(type) {
    const def = VEHICLE_UNLOCKS[type];
    if (this.owns(type)) return { ok: false, why: 'Owned' };
    if (def.level > this.level) return { ok: false, why: `Reach level ${def.level}` };
    if (this.coins < def.cost) return { ok: false, why: `${def.cost} coins` };
    return { ok: true, why: `Buy ${def.cost}` };
  }

  buyVehicle(type) {
    if (!this.canBuyVehicle(type).ok) return false;
    this.save.addCoins(-VEHICLE_UNLOCKS[type].cost);
    this.data.owned[type] = true;
    this.persist();
    return true;
  }
}
