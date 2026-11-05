// Everything a player can customize lives here. Add an option to a list below
// and it shows up in the Avatar Studio. A cost above zero makes it an unlock.

const free = (id, name) => ({ id, name, cost: 0 });
const paid = (id, name, cost) => ({ id, name, cost });

export const CATALOG = {
  head: [free('person', 'Person'), free('orb', 'Orb'), free('cube', 'Cube'), free('gem', 'Gem'), free('capsule', 'Capsule'), paid('lantern', 'Lantern', 60)],
  eyes: [free('none', 'Natural'), free('visor', 'Visor'), free('dots', 'Dots'), free('cyclops', 'Cyclops'), paid('shades', 'Shades', 20)],
  hat: [
    free('none', 'None'), free('cap', 'Cap'), free('beanie', 'Beanie'), free('antenna', 'Antenna'),
    paid('mohawk', 'Mohawk', 20), paid('horns', 'Horns', 30), paid('tophat', 'Top hat', 30),
    paid('wizard', 'Wizard hat', 40), paid('halo', 'Halo', 50), paid('crown', 'Crown', 60),
  ],
  body: [free('human', 'Human'), free('tunic', 'Tunic'), free('robot', 'Robot'), free('slim', 'Slim'), paid('barrel', 'Barrel', 20), paid('ghost', 'Ghost', 30)],
  back: [free('none', 'None'), free('cape', 'Cape'), free('pack', 'Backpack'), paid('jetpack', 'Jetpack', 60), paid('wings', 'Wings', 80)],
  hands: [free('hand', 'Hands'), free('mitts', 'Mitts'), free('orbs', 'Orbs'), free('cubes', 'Cubes'), paid('claws', 'Claws', 25)],
  aura: [free('none', 'None'), paid('sparkle', 'Sparkle', 40), paid('embers', 'Embers', 50), paid('rings', 'Rings', 60)],
  blaster: [free('compact', 'Compact'), free('long', 'Long'), paid('round', 'Round', 25)],
  sky: [free('dusk', 'Dusk'), free('dawn', 'Dawn'), free('night', 'Night'), free('noon', 'Noon'), free('custom', 'My colors')],
  floor: [free('quilt', 'Quilt'), free('ocean', 'Ocean'), free('forest', 'Forest'), free('ember', 'Ember'), free('mono', 'Mono')],
  turn: [free('snap', 'Snap'), free('smooth', 'Smooth')],
  stars: [free('on', 'On'), free('off', 'Off')],
  graphics: [free('high', 'High'), free('low', 'Low')],
  vignette: [free('on', 'On'), free('off', 'Off')],
};

export const SKIES = {
  dusk: { top: 0x0d2c5e, mid: 0x1f7a8c, horizon: 0xff8a5c, bottom: 0x0a2233 },
  dawn: { top: 0x3f6fb5, mid: 0xc9a3c7, horizon: 0xffd9a8, bottom: 0x4a3f6b },
  night: { top: 0x03040f, mid: 0x0b1433, horizon: 0x1f3560, bottom: 0x02030a },
  noon: { top: 0x2f7fd8, mid: 0x86c5f0, horizon: 0xe6f5ff, bottom: 0x5a7a9c },
};

export const FLOORS = {
  quilt: [0xc96f4a, 0xd9a05b, 0x7f9a6a, 0x4f7f8f, 0x8a5a83, 0xe3d3b4],
  ocean: [0x12466b, 0x1b6a8f, 0x2a93a8, 0x57c0bd, 0xa6e0d0, 0x0d3350],
  forest: [0x2f5d3a, 0x4d7f46, 0x7f9a4a, 0xa89c5a, 0x5c4630, 0x35704f],
  ember: [0x4a1a14, 0x8c2f1b, 0xc9531f, 0xf08a2c, 0x2b1412, 0x6b2318],
  mono: [0x2b2b33, 0x45454f, 0x63636f, 0x8a8a96, 0xb5b5bf, 0xdcdce2],
};

export const DEFAULT_PREFS = {
  look: {
    head: 'person', eyes: 'none', hat: 'none', body: 'human', back: 'none', hands: 'hand', aura: 'none',
    headSize: 1, bodySize: 1,
    primary: 0xff5c4d, secondary: 0x16242c, accent: 0xffd166, skin: 0xd9a57c, hair: 0x2a1c14,
  },
  gear: { blaster: 'compact', blasterColor: 0xd9e4e0, sledColor: 0x24325f, laserColor: 0xfff2c9, gloveColor: 0xf4efe2, ballColor: 0xff8a4c },
  plaza: { sky: 'dusk', skyTop: 0x123456, skyHorizon: 0xff9966, floor: 'quilt', stars: 'on' },
  comfort: { speed: 3.2, snap: 30, turn: 'snap', fov: 70, sensitivity: 1, graphics: 'high', vignette: 'on' },
  audio: { volume: 70, voice: 100 },
};

export const NAME_A = [
  'Amber', 'Brisk', 'Cobalt', 'Dusty', 'Ember', 'Fuzzy', 'Golden', 'Hazel', 'Indigo', 'Jolly', 'Keen', 'Lucky',
  'Mossy', 'Nimble', 'Opal', 'Plucky', 'Quiet', 'Rusty', 'Silver', 'Tidal', 'Umber', 'Velvet', 'Wild', 'Zesty',
];
export const NAME_B = [
  'Otter', 'Badger', 'Comet', 'Drifter', 'Falcon', 'Gecko', 'Heron', 'Ibis', 'Jackal', 'Kestrel', 'Lynx', 'Marten',
  'Newt', 'Owl', 'Puffin', 'Quail', 'Raven', 'Stoat', 'Tapir', 'Urchin', 'Vole', 'Wombat', 'Yak', 'Zebra',
];

export const displayName = ([a, b]) => `${NAME_A[a] ?? 'Mystery'} ${NAME_B[b] ?? 'Guest'}`;

const clampInt = (v, max) => (Number.isInteger(v) && v >= 0 && v <= max ? v : null);
const inList = (list, id, fallback) => (list.some((o) => o.id === id) ? id : fallback);
const color = (v, fallback) => clampInt(v, 0xffffff) ?? fallback;
const num = (v, min, max, fallback) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);

/** Names travel as two list positions, never free text, so nobody can type abuse into a name tag. */
export function sanitizeName(raw) {
  const pair = Array.isArray(raw) ? raw : [];
  return [clampInt(pair[0], NAME_A.length - 1) ?? 0, clampInt(pair[1], NAME_B.length - 1) ?? 0];
}

/** Also used on looks received from other players, whose data can't be trusted. */
export function sanitizeLook(raw) {
  const d = DEFAULT_PREFS.look;
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    head: inList(CATALOG.head, r.head, d.head),
    eyes: inList(CATALOG.eyes, r.eyes, d.eyes),
    hat: inList(CATALOG.hat, r.hat, d.hat),
    body: inList(CATALOG.body, r.body, d.body),
    back: inList(CATALOG.back, r.back, d.back),
    hands: inList(CATALOG.hands, r.hands, d.hands),
    aura: inList(CATALOG.aura, r.aura, d.aura),
    headSize: num(r.headSize, 0.8, 1.4, d.headSize),
    bodySize: num(r.bodySize, 0.8, 1.25, d.bodySize),
    primary: color(r.primary, d.primary),
    secondary: color(r.secondary, d.secondary),
    accent: color(r.accent, d.accent),
    skin: color(r.skin, d.skin),
    hair: color(r.hair, d.hair),
  };
}

export function loadPrefs(saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  const d = DEFAULT_PREFS;
  const g = { ...d.gear, ...s.gear };
  const p = { ...d.plaza, ...s.plaza };
  const c = { ...d.comfort, ...s.comfort };
  const a = { ...d.audio, ...s.audio };
  return {
    look: sanitizeLook(s.look),
    gear: {
      blaster: inList(CATALOG.blaster, g.blaster, d.gear.blaster),
      blasterColor: color(g.blasterColor, d.gear.blasterColor),
      sledColor: color(g.sledColor, d.gear.sledColor),
      laserColor: color(g.laserColor, d.gear.laserColor),
      gloveColor: color(g.gloveColor, d.gear.gloveColor),
      ballColor: color(g.ballColor, d.gear.ballColor),
    },
    plaza: {
      sky: inList(CATALOG.sky, p.sky, d.plaza.sky),
      skyTop: color(p.skyTop, d.plaza.skyTop),
      skyHorizon: color(p.skyHorizon, d.plaza.skyHorizon),
      floor: inList(CATALOG.floor, p.floor, d.plaza.floor),
      stars: inList(CATALOG.stars, p.stars, d.plaza.stars),
    },
    comfort: {
      speed: num(c.speed, 1.5, 5, d.comfort.speed),
      snap: num(c.snap, 15, 45, d.comfort.snap),
      turn: inList(CATALOG.turn, c.turn, d.comfort.turn),
      fov: num(c.fov, 60, 100, d.comfort.fov),
      sensitivity: num(c.sensitivity, 0.5, 2, d.comfort.sensitivity),
      graphics: inList(CATALOG.graphics, c.graphics, d.comfort.graphics),
      vignette: inList(CATALOG.vignette, c.vignette, d.comfort.vignette),
    },
    audio: { volume: num(a.volume, 0, 100, d.audio.volume), voice: num(a.voice, 0, 100, d.audio.voice) },
  };
}
