import { Storage } from '../utils/storage';

interface Positioned {
  x: number;
  y: number;
  isPlayer?: boolean;
}

const MAX_VOICES = 28;

/**
 * Tiny WebAudio synthesiser – every sound is generated at runtime,
 * so the game ships with zero audio files.
 */
export class AudioManager {
  private static _instance: AudioManager | null = null;
  static get instance(): AudioManager {
    if (!this._instance) this._instance = new AudioManager();
    return this._instance;
  }

  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private noise!: AudioBuffer;
  private voices = 0;
  private listenerX = 0;
  private listenerY = 0;
  private lastConfirm = 0;

  // engine
  private engOsc1: OscillatorNode | null = null;
  private engOsc2: OscillatorNode | null = null;
  private engFilter: BiquadFilterNode | null = null;
  private engGain: GainNode | null = null;
  // tyre screech
  private screechGain: GainNode | null = null;
  private screechSrc: AudioBufferSourceNode | null = null;

  /** Must be called from a user gesture (click / key) to unlock audio. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.sfx = this.ctx.createGain();
      this.sfx.connect(this.master);
      const len = this.ctx.sampleRate * 1.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.applySettings();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  applySettings(): void {
    if (!this.ctx) return;
    const s = Storage.getSettings();
    this.master.gain.value = s.masterVolume;
    this.sfx.gain.value = s.sfxVolume;
  }

  setListener(x: number, y: number): void {
    this.listenerX = x;
    this.listenerY = y;
  }

  private vol(src?: Positioned): number {
    if (!src || src.isPlayer) return 1;
    const d = Math.hypot(src.x - this.listenerX, src.y - this.listenerY);
    return Math.max(0, 1 - d / 1400) ** 1.5;
  }

  // ------------------------------------------------------------ primitives
  private tone(type: OscillatorType, f0: number, f1: number, dur: number, gain: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || gain < 0.01 || this.voices > MAX_VOICES) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfx);
    this.voices++;
    o.onended = () => this.voices--;
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(filter: BiquadFilterType, f0: number, f1: number, dur: number, gain: number, q = 1, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx || gain < 0.01 || this.voices > MAX_VOICES) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfx);
    this.voices++;
    src.onended = () => this.voices--;
    src.start(t, Math.random() * 1.0);
    src.stop(t + dur + 0.02);
  }

  // ------------------------------------------------------------ game sounds
  shot(kind: 'mg' | 'cannon' | 'rocket' | 'mine', src?: Positioned): void {
    const v = this.vol(src);
    switch (kind) {
      case 'mg':
        this.burst('bandpass', 2600, 900, 0.07, 0.22 * v, 1.2);
        this.tone('square', 190, 90, 0.05, 0.06 * v);
        break;
      case 'cannon':
        this.tone('sine', 120, 38, 0.32, 0.55 * v);
        this.burst('lowpass', 1600, 180, 0.3, 0.45 * v);
        break;
      case 'rocket':
        this.burst('bandpass', 500, 2400, 0.45, 0.3 * v, 2);
        this.tone('sawtooth', 90, 60, 0.3, 0.06 * v);
        break;
      case 'mine':
        this.tone('triangle', 420, 180, 0.12, 0.25 * v);
        this.tone('sine', 1200, 1200, 0.06, 0.1 * v, 0.12);
        break;
    }
  }

  explosion(src: Positioned, size = 1): void {
    const v = Math.min(1, this.vol(src) * (0.8 + 0.3 * size));
    this.tone('sine', 90, 28, 0.7, 0.7 * v);
    this.burst('lowpass', 2200, 90, 0.9 + 0.2 * size, 0.7 * v);
  }

  hit(src: Positioned, heavy: boolean): void {
    const v = this.vol(src);
    if (heavy) {
      this.tone('square', 240, 70, 0.15, 0.2 * v);
      this.burst('highpass', 3000, 1200, 0.12, 0.25 * v);
    } else {
      this.tone('square', 1400, 900, 0.03, 0.06 * v);
    }
  }

  /** Your shot landed – a crisp tick (a deeper one for the killing blow). Rate-limited for the machine gun. */
  hitConfirm(kill = false): void {
    const now = this.ctx?.currentTime ?? 0;
    if (!kill && now - this.lastConfirm < 0.07) return;
    this.lastConfirm = now;
    if (kill) {
      this.tone('square', 1500, 1500, 0.05, 0.14);
      this.tone('square', 900, 900, 0.1, 0.12, 0.05);
    } else {
      this.tone('triangle', 2400, 1900, 0.035, 0.16);
      this.burst('highpass', 6000, 4000, 0.03, 0.1);
    }
  }

  /** Kill streak fanfare, higher for longer streaks. */
  streak(n: number): void {
    const base = 523 * 2 ** (Math.min(n, 5) / 12);
    [1, 1.26, 1.5, 2].forEach((m, i) => this.tone('square', base * m, base * m, i === 3 ? 0.28 : 0.09, 0.11, i * 0.08));
    this.burst('bandpass', 800, 4000, 0.4, 0.12, 1.2, 0.2);
  }

  /** Drift charge reached a new level – rising chime per level. */
  driftLevel(level: number): void {
    const f = 660 * 2 ** ((level - 1) * 4 / 12);
    this.tone('triangle', f, f * 1.02, 0.12, 0.2);
    this.tone('sine', f * 2, f * 2, 0.16, 0.1, 0.05);
  }

  wallHit(src: Positioned, strength: number): void {
    const v = this.vol(src) * Math.min(1, strength / 500);
    this.tone('sine', 110, 45, 0.18, 0.5 * v);
    this.burst('lowpass', 900, 120, 0.2, 0.4 * v);
  }

  carHit(src: Positioned, strength: number): void {
    const v = this.vol(src) * Math.min(1, strength / 450);
    this.tone('triangle', 160, 60, 0.2, 0.45 * v);
    this.burst('bandpass', 1400, 400, 0.18, 0.35 * v, 1.5);
  }

  boost(power = 1, src?: Positioned): void {
    const v = this.vol(src);
    this.tone('sawtooth', 180, 700 * power, 0.35, 0.09 * v);
    this.burst('bandpass', 400, 3000, 0.45, 0.25 * v, 1.5);
  }

  shield(src?: Positioned): void {
    const v = this.vol(src);
    this.tone('sine', 440, 660, 0.4, 0.2 * v);
    this.tone('sine', 660, 990, 0.4, 0.12 * v, 0.05);
  }

  blink(src?: Positioned): void {
    const v = this.vol(src);
    this.tone('sine', 1800, 250, 0.22, 0.25 * v);
    this.burst('highpass', 4000, 1500, 0.15, 0.2 * v);
  }

  emp(src?: Positioned): void {
    const v = this.vol(src);
    this.tone('sawtooth', 70, 35, 0.6, 0.3 * v);
    this.tone('square', 900, 120, 0.4, 0.1 * v);
    this.burst('highpass', 5000, 2000, 0.35, 0.3 * v);
  }

  pickup(): void {
    this.tone('sine', 880, 880, 0.08, 0.2);
    this.tone('sine', 1320, 1320, 0.12, 0.2, 0.07);
  }

  kill(): void {
    this.tone('square', 523, 523, 0.08, 0.1);
    this.tone('square', 784, 784, 0.08, 0.1, 0.08);
    this.tone('square', 1046, 1046, 0.16, 0.1, 0.16);
  }

  lap(): void {
    this.tone('triangle', 660, 660, 0.12, 0.25);
    this.tone('triangle', 990, 990, 0.2, 0.25, 0.12);
  }

  countdown(go: boolean): void {
    if (go) this.tone('square', 880, 880, 0.45, 0.2);
    else this.tone('square', 440, 440, 0.2, 0.18);
  }

  click(): void {
    this.tone('square', 900, 600, 0.04, 0.08);
  }

  denied(): void {
    this.tone('square', 180, 140, 0.1, 0.1);
  }

  // ------------------------------------------------------------ loops
  startEngine(): void {
    const ctx = this.ctx;
    if (!ctx || this.engOsc1) return;
    this.engOsc1 = ctx.createOscillator();
    this.engOsc2 = ctx.createOscillator();
    this.engOsc1.type = 'sawtooth';
    this.engOsc2.type = 'square';
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 500;
    this.engFilter.Q.value = 4;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0.0;
    this.engOsc1.connect(this.engFilter);
    this.engOsc2.connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.sfx);
    this.engOsc1.start();
    this.engOsc2.start();

    this.screechSrc = ctx.createBufferSource();
    this.screechSrc.buffer = this.noise;
    this.screechSrc.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500;
    bp.Q.value = 6;
    this.screechGain = ctx.createGain();
    this.screechGain.gain.value = 0;
    this.screechSrc.connect(bp).connect(this.screechGain).connect(this.sfx);
    this.screechSrc.start();
  }

  /** ratio: speed / maxSpeed; throttle 0..1; boost 0..1.5 */
  updateEngine(ratio: number, throttle: number, boost: number, screech: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.engOsc1 || !this.engOsc2 || !this.engFilter || !this.engGain || !this.screechGain) return;
    const t = ctx.currentTime;
    const r = Math.min(1.3, Math.max(0, ratio));
    // fake gearbox: rpm climbs within each gear
    const gears = 4;
    const g = Math.min(gears - 1, Math.floor(r * gears));
    const within = r * gears - g;
    const rpm = 0.3 + 0.7 * within;
    const f = 42 + g * 10 + rpm * 70 + boost * 25;
    this.engOsc1.frequency.setTargetAtTime(f, t, 0.05);
    this.engOsc2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
    this.engFilter.frequency.setTargetAtTime(300 + 1400 * rpm * (0.5 + 0.5 * Math.abs(throttle)) + boost * 800, t, 0.06);
    this.engGain.gain.setTargetAtTime(0.045 + 0.04 * Math.abs(throttle) + 0.03 * boost, t, 0.08);
    this.screechGain.gain.setTargetAtTime(screech * 0.07, t, 0.05);
  }

  stopEngine(): void {
    try {
      this.engOsc1?.stop();
      this.engOsc2?.stop();
      this.screechSrc?.stop();
    } catch {
      /* already stopped */
    }
    this.engOsc1?.disconnect();
    this.engOsc2?.disconnect();
    this.engGain?.disconnect();
    this.screechGain?.disconnect();
    this.engOsc1 = this.engOsc2 = null;
    this.engFilter = null;
    this.engGain = null;
    this.screechGain = null;
    this.screechSrc = null;
  }
}
