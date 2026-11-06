/**
 * The car radio. Nothing here is a recording: each station is composed as it plays, so the
 * music is endless, original, and adds nothing to the download.
 */
const STATIONS = [
  {
    name: 'Neon 88.1',
    tag: 'Night drive synth',
    bpm: 102,
    chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],
    kick: 'x...x...x...x...',
    snare: '....x.......x...',
    hat: '..x...x...x...x.',
    bass: 'x.x.x.x.x.x.x.x.',
    lead: 'sawtooth',
    pad: 'sawtooth',
    arp: true,
    cutoff: 1500,
  },
  {
    name: 'Boulevard 96.5',
    tag: 'Street beats',
    bpm: 84,
    chords: [[48, 51, 55], [44, 48, 51], [51, 55, 58], [46, 50, 53]],
    kick: 'x.....x...x.....',
    snare: '....x.......x...',
    hat: 'x.x.x.x.x.xxx.x.',
    bass: 'x.....x...x...x.',
    lead: 'square',
    pad: 'triangle',
    stab: true,
    cutoff: 1100,
  },
  {
    name: 'Low Tide 104.3',
    tag: 'Slow and easy',
    bpm: 72,
    chords: [[50, 53, 57, 60], [55, 59, 62, 65], [48, 52, 55, 59], [45, 48, 52, 55]],
    kick: 'x.......x.x.....',
    snare: '....x.......x...',
    hat: '..x...x...x...x.',
    bass: 'x...x...x...x...',
    lead: 'triangle',
    pad: 'triangle',
    dusty: true,
    cutoff: 800,
  },
];
const SCALE = [0, 3, 5, 7, 10];
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

export class Radio {
  constructor(sound) {
    this.sound = sound;
    this.index = 0;
    this.playing = false;
    this.step = 0;
    this.nextTime = 0;
    this.bus = null;
    this.seed = 1;
  }

  get station() {
    return STATIONS[this.index];
  }

  /** Whatever was on last time comes back on when you get in. */
  start() {
    const { ctx, master } = this.sound;
    if (!ctx) return;
    if (!this.bus) {
      this.bus = ctx.createGain();
      this.bus.connect(master);
      const length = ctx.sampleRate;
      this.noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    }
    this.bus.gain.setTargetAtTime(0.5, ctx.currentTime, 0.2);
    this.playing = !this.off;
    this.nextTime = ctx.currentTime + 0.1;
  }

  stop() {
    this.playing = false;
    const { ctx } = this.sound;
    if (this.bus) this.bus.gain.setTargetAtTime(0, ctx.currentTime, 0.12);
  }

  /** The next station, then silence, then around again. Returns what to show the player. */
  next() {
    if (this.off) {
      this.off = false;
      this.index = 0;
    } else if (this.index === STATIONS.length - 1) {
      this.off = true;
    } else {
      this.index += 1;
    }
    this.step = 0;
    this.seed += 7;
    if (this.off) {
      this.stop();
      return { name: 'Radio off', tag: 'Press R to turn it back on' };
    }
    this.start();
    return this.station;
  }

  tone(type, freq, at, length, level, cutoff = 4000, slide = 0) {
    const { ctx } = this.sound;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), at + length);
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(filter).connect(gain).connect(this.bus);
    osc.start(at);
    osc.stop(at + length + 0.02);
  }

  hiss(at, length, level, cutoff) {
    const { ctx } = this.sound;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = cutoff;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    source.connect(filter).connect(gain).connect(this.bus);
    source.start(at, Math.random() * 0.8, length + 0.02);
  }

  /** One sixteenth note of the current station. */
  play(s, step, at) {
    const pos = step % 16;
    const bar = Math.floor(step / 16);
    const beat = 60 / s.bpm;
    const chord = s.chords[Math.floor(bar / 2) % s.chords.length];
    // The drums drop out every so often, so it doesn't feel like a loop.
    const breakdown = bar % 16 >= 14;
    if (!breakdown && s.kick[pos] === 'x') this.tone('sine', 120, at, 0.2, 0.9, 900, 0.32);
    if (!breakdown && s.snare[pos] === 'x') {
      this.hiss(at, 0.16, s.dusty ? 0.14 : 0.3, 1500);
      this.tone('triangle', 190, at, 0.1, 0.22, 1200, 0.6);
    }
    if (s.hat[pos] === 'x') this.hiss(at, 0.04, s.dusty ? 0.05 : 0.1, 7000);
    if (s.dusty && pos === 0) this.hiss(at, beat * 4, 0.012, 3000);
    if (s.bass[pos] === 'x') this.tone(s.stab ? 'sine' : 'triangle', midi(chord[0] - 12), at, beat * (s.stab ? 0.9 : 0.42), 0.5, 500, s.stab ? 0.84 : 0);
    if (pos === 0) {
      for (const n of chord) this.tone(s.pad, midi(n), at, beat * (s.stab ? 0.7 : 3.8), 0.07, s.cutoff);
    }
    if (s.stab && (pos === 6 || pos === 10)) for (const n of chord) this.tone('triangle', midi(n + 12), at, beat * 0.35, 0.05, 1500);
    if (s.arp && pos % 2 === 0) {
      const n = chord[(pos / 2 + bar) % chord.length] + 12 * (1 + (pos % 8 === 0 ? 1 : 0));
      this.tone('sawtooth', midi(n), at, beat * 0.3, 0.035, s.cutoff * 1.6);
    }
    // A simple tune that wanders around the scale, different every eight bars.
    if (bar % 4 >= 2) {
      const r = Math.sin((Math.floor(bar / 8) + this.seed) * 12.9898 + pos * 78.233) * 43758.5453;
      const chance = r - Math.floor(r);
      if (pos % 2 === 0 && chance < 0.42) {
        const note = 69 + SCALE[Math.floor(chance * 11.9) % SCALE.length] + (s.dusty ? -12 : 0);
        this.tone(s.lead, midi(note), at, beat * 0.6, 0.05, s.cutoff * 1.3);
      }
    }
  }

  /** Called every frame. Writes the next fraction of a second of music. */
  update() {
    if (!this.playing) return;
    const { ctx } = this.sound;
    if (!ctx || ctx.state !== 'running') return;
    const s = this.station;
    const sixteenth = 60 / s.bpm / 4;
    if (this.nextTime < ctx.currentTime) this.nextTime = ctx.currentTime + 0.02;
    while (this.nextTime < ctx.currentTime + 0.3) {
      this.play(s, this.step, this.nextTime);
      this.nextTime += sixteenth;
      this.step += 1;
    }
  }
}
