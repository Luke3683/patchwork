/** Everything you hear is synthesized, so the repo ships no audio files to license. */
export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.voiceBus = null;
    this.levels = { volume: 0.7, voice: 1 };
  }

  setLevels(volume, voice) {
    this.levels = { volume, voice };
    if (this.master) this.master.gain.value = volume;
    if (this.voiceBus) this.voiceBus.gain.value = voice;
  }

  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.levels.volume;
      this.master.connect(this.ctx.destination);
      this.voiceBus = this.ctx.createGain();
      this.voiceBus.gain.value = this.levels.voice;
      this.voiceBus.connect(this.ctx.destination);
    }
    this.ctx.resume?.();
  }

  get running() {
    return this.ctx?.state === 'running';
  }

  get now() {
    return this.ctx?.currentTime ?? 0;
  }

  tone({ f = 440, at = 0, d = 0.2, type = 'sine', g = 0.2, slide = 0 }) {
    if (!this.running) return;
    const start = Math.max(at, this.ctx.currentTime);
    const osc = this.ctx.createOscillator();
    const amp = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, start);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f + slide), start + d);
    amp.gain.setValueAtTime(0.0001, start);
    amp.gain.exponentialRampToValueAtTime(g, start + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + d);
    osc.connect(amp).connect(this.master);
    osc.start(start);
    osc.stop(start + d + 0.02);
  }

  noise({ at = 0, d = 0.15, g = 0.15, f = 1200, type = 'lowpass' }) {
    if (!this.running) return;
    const start = Math.max(at, this.ctx.currentTime);
    const length = Math.ceil(this.ctx.sampleRate * d);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = f;
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(g, start);
    amp.gain.exponentialRampToValueAtTime(0.0001, start + d);
    src.connect(filter).connect(amp).connect(this.master);
    src.start(start);
  }

  play(name) {
    const n = this.now;
    switch (name) {
      case 'hover': return this.tone({ f: 880, d: 0.04, g: 0.03 });
      case 'select': return this.tone({ f: 520, d: 0.12, type: 'triangle', g: 0.14, slide: 260 });
      case 'portal':
        this.noise({ d: 0.5, g: 0.1, f: 900 });
        return this.tone({ f: 180, d: 0.55, type: 'sawtooth', g: 0.07, slide: 500 });
      case 'shoot':
        return this.tone({ f: 980, d: 0.11, type: 'square', g: 0.05, slide: -760 });
      case 'boom':
        this.noise({ d: 0.35, g: 0.2, f: 700 });
        return this.tone({ f: 120, d: 0.3, g: 0.2, slide: -80 });
      case 'hurt': return this.tone({ f: 170, d: 0.35, type: 'sawtooth', g: 0.14, slide: -90 });
      case 'miss': return this.tone({ f: 210, d: 0.16, type: 'triangle', g: 0.09, slide: -80 });
      case 'block':
        this.noise({ d: 0.07, g: 0.1, f: 1800 });
        return this.tone({ f: 240, d: 0.09, type: 'triangle', g: 0.14 });
      case 'unblock': return this.tone({ f: 180, d: 0.09, type: 'triangle', g: 0.1, slide: -70 });
      case 'patch':
        [523, 659, 784, 1047].forEach((f, i) => this.tone({ f, at: n + i * 0.11, d: 0.45, type: 'triangle', g: 0.14 }));
        return undefined;
      case 'fail':
        [392, 330, 262].forEach((f, i) => this.tone({ f, at: n + i * 0.16, d: 0.3, type: 'triangle', g: 0.12 }));
        return undefined;
      default: return undefined;
    }
  }

  /** A soft held chord. Returns a function that stops it. */
  pad(freqs, g = 0.018) {
    if (!this.running) return () => {};
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(0.0001, this.now);
    amp.gain.exponentialRampToValueAtTime(g, this.now + 2);
    amp.connect(this.master);
    const oscs = freqs.map((f, i) => {
      const osc = this.ctx.createOscillator();
      osc.type = i % 2 ? 'triangle' : 'sine';
      osc.frequency.value = f;
      osc.detune.value = (i - 1) * 4;
      osc.connect(amp);
      osc.start();
      return osc;
    });
    return () => {
      const t = this.now;
      amp.gain.cancelScheduledValues(t);
      amp.gain.setValueAtTime(Math.max(amp.gain.value, 0.0001), t);
      amp.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      oscs.forEach((o) => o.stop(t + 0.45));
    };
  }
}
