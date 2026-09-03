/*
 * Audio.
 *
 * Everything is synthesised: no asset loading, no decode latency, and the
 * engine note can track speed continuously.  The AudioContext is created
 * lazily on the first user gesture, because every modern browser blocks
 * autoplay -- and every call is guarded so the whole game still runs if audio
 * is unavailable entirely.
 *
 * One-shot voices disconnect themselves in `onended`, so nothing accumulates
 * over a long session.
 */

import { clamp, storage } from './util.js';
import { SETTINGS_KEY as SETTINGS } from './config.js';

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.engineBus = null;
    this.ready = false;
    this.failed = false;
    this.muted = !!storage.get(SETTINGS, {}).muted;
    this._noiseBuffer = null;
    this._engine = null;
    this._music = null;
    this._nextNote = 0;
    this._step = 0;
    this._musicOn = false;
    this._musicScale = [0, 3, 5, 7, 10];
    this._musicRoot = 55;
  }

  /** Create (or resume) the context.  Safe to call on every gesture. */
  init() {
    if (this.failed) return false;
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) { this.failed = true; return false; }
        this.ctx = new Ctor();

        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.85;
        this.master.connect(this.ctx.destination);

        this.sfxBus = this.ctx.createGain();
        this.sfxBus.gain.value = 0.9;
        this.sfxBus.connect(this.master);

        this.musicBus = this.ctx.createGain();
        this.musicBus.gain.value = 0.34;
        this.musicBus.connect(this.master);

        this.engineBus = this.ctx.createGain();
        this.engineBus.gain.value = 0.0;
        this.engineBus.connect(this.master);

        this._buildNoise();
        this._buildEngine();
        this.ready = true;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return true;
    } catch {
      this.failed = true;
      this.ctx = null;
      return false;
    }
  }

  get t() { return this.ctx ? this.ctx.currentTime : 0; }

  setMuted(m) {
    this.muted = !!m;
    const s = storage.get(SETTINGS, {});
    s.muted = this.muted;
    storage.set(SETTINGS, s);
    if (this.master) {
      const now = this.t;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.85, now, 0.03);
    }
  }

  toggleMute() { this.setMuted(!this.muted); return this.muted; }

  // ------------------------------------------------------------- primitives

  _buildNoise() {
    const len = Math.floor(this.ctx.sampleRate * 1.2);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noiseBuffer = buf;
  }

  /** A noise burst through a filter -- the basis of every impact sound. */
  _noise(dur, { type = 'bandpass', freq = 900, q = 1, gain = 0.5, sweep = 0, bus, delay = 0 } = {}) {
    if (!this.ready || this.muted) return;
    const now = this.t + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.loop = true;
    const filt = this.ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(Math.max(30, freq), now);
    if (sweep) filt.frequency.exponentialRampToValueAtTime(Math.max(30, freq + sweep), now + dur);
    filt.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain, now + Math.min(0.012, dur * 0.25));
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(filt).connect(g).connect(bus || this.sfxBus);
    src.start(now);
    src.stop(now + dur + 0.02);
    src.onended = () => { try { src.disconnect(); filt.disconnect(); g.disconnect(); } catch {} };
  }

  /** A single pitched blip. */
  _tone(freq, dur, { type = 'square', gain = 0.22, to = null, bus, delay = 0 } = {}) {
    if (!this.ready || this.muted) return;
    const now = this.t + delay;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, freq), now);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain, now + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g).connect(bus || this.sfxBus);
    osc.start(now);
    osc.stop(now + dur + 0.02);
    osc.onended = () => { try { osc.disconnect(); g.disconnect(); } catch {} };
  }

  // ---------------------------------------------------------------- engine

  _buildEngine() {
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // Two detuned saws for the body of the note...
    const oscA = ctx.createOscillator(); oscA.type = 'sawtooth';
    const oscB = ctx.createOscillator(); oscB.type = 'sawtooth';
    oscB.detune.value = 11;
    // ...a square an octave down for the lumpy V6 bottom end...
    const oscC = ctx.createOscillator(); oscC.type = 'square';

    // ...and filtered noise, because this thing has 210,000 miles on it.
    const rattle = ctx.createBufferSource();
    rattle.buffer = this._noiseBuffer;
    rattle.loop = true;
    const rattleFilt = ctx.createBiquadFilter();
    rattleFilt.type = 'bandpass';
    rattleFilt.frequency.value = 320;
    rattleFilt.Q.value = 1.4;
    const rattleGain = ctx.createGain();
    rattleGain.gain.value = 0.16;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    lp.Q.value = 0.9;

    const mixA = ctx.createGain(); mixA.gain.value = 0.34;
    const mixB = ctx.createGain(); mixB.gain.value = 0.26;
    const mixC = ctx.createGain(); mixC.gain.value = 0.30;

    oscA.connect(mixA).connect(lp);
    oscB.connect(mixB).connect(lp);
    oscC.connect(mixC).connect(lp);
    rattle.connect(rattleFilt).connect(rattleGain).connect(lp);
    lp.connect(this.engineBus);

    oscA.frequency.setValueAtTime(60, now);
    oscB.frequency.setValueAtTime(60, now);
    oscC.frequency.setValueAtTime(30, now);

    oscA.start(now); oscB.start(now); oscC.start(now); rattle.start(now);
    this._engine = { oscA, oscB, oscC, lp, rattleFilt, rattleGain };
  }

  /**
   * Drive the engine note.
   * @param {number} rpm 0..1 normalised engine speed (includes fake gearing)
   * @param {number} load 0..1 throttle/load, controls volume and brightness
   * @param {boolean} running
   */
  setEngine(rpm, load, running) {
    if (!this.ready || !this._engine) return;
    const now = this.t;
    const e = this._engine;
    const f = 52 + clamp(rpm, 0, 1) * 190;
    const smooth = 0.05;
    e.oscA.frequency.setTargetAtTime(f, now, smooth);
    e.oscB.frequency.setTargetAtTime(f * 1.005, now, smooth);
    e.oscC.frequency.setTargetAtTime(f * 0.5, now, smooth);
    e.lp.frequency.setTargetAtTime(500 + rpm * 2600 + load * 700, now, smooth);
    e.rattleFilt.frequency.setTargetAtTime(220 + rpm * 700, now, smooth);
    e.rattleGain.gain.setTargetAtTime(0.10 + rpm * 0.16, now, smooth);
    const vol = running ? 0.11 + load * 0.10 + rpm * 0.06 : 0;
    this.engineBus.gain.setTargetAtTime(vol, now, 0.09);
  }

  stopEngine() {
    if (!this.ready) return;
    this.engineBus.gain.setTargetAtTime(0, this.t, 0.08);
  }

  // ------------------------------------------------------------------- sfx

  shoot(pitch = 1) {
    this._tone(760 * pitch, 0.07, { type: 'square', gain: 0.13, to: 220 * pitch });
    this._noise(0.05, { freq: 2200, q: 0.8, gain: 0.10 });
  }

  bigShot() {
    this._tone(300, 0.20, { type: 'sawtooth', gain: 0.20, to: 70 });
    this._noise(0.28, { freq: 1600, q: 0.6, gain: 0.22, sweep: -1300 });
  }

  explosion(size = 1) {
    const d = 0.30 + size * 0.34;
    this._noise(d, { type: 'lowpass', freq: 1400 * size, q: 0.7, gain: 0.42, sweep: -1100 });
    this._tone(150 * size, d * 0.7, { type: 'triangle', gain: 0.26, to: 34 });
  }

  crash() {
    this._noise(0.55, { type: 'bandpass', freq: 480, q: 0.5, gain: 0.5, sweep: -380 });
    this._tone(110, 0.42, { type: 'square', gain: 0.28, to: 38 });
    this._tone(84, 0.6, { type: 'sawtooth', gain: 0.16, to: 30 });
  }

  scrape() {
    this._noise(0.22, { type: 'bandpass', freq: 2600, q: 6, gain: 0.16 });
  }

  pickup() {
    this._tone(520, 0.09, { type: 'square', gain: 0.16 });
    this._tone(780, 0.10, { type: 'square', gain: 0.16, delay: 0.07 });
    this._tone(1040, 0.16, { type: 'square', gain: 0.15, delay: 0.15 });
  }

  weaponPod() {
    this._tone(392, 0.10, { type: 'square', gain: 0.17 });
    this._tone(523, 0.10, { type: 'square', gain: 0.17, delay: 0.09 });
    this._tone(659, 0.10, { type: 'square', gain: 0.17, delay: 0.18 });
    this._tone(880, 0.22, { type: 'square', gain: 0.17, delay: 0.27 });
  }

  nitro() {
    this._noise(0.9, { type: 'highpass', freq: 700, q: 0.5, gain: 0.28, sweep: 3000 });
    this._tone(180, 0.7, { type: 'sawtooth', gain: 0.14, to: 900 });
  }

  shield() {
    this._tone(240, 0.5, { type: 'sine', gain: 0.18, to: 960 });
    this._tone(360, 0.5, { type: 'sine', gain: 0.12, to: 1440 });
  }

  /** The sliding door.  It is the only thing on this van still under warranty. */
  slidingDoor() {
    this._noise(0.42, { type: 'bandpass', freq: 900, q: 3, gain: 0.20, sweep: -520 });
    this._tone(90, 0.10, { type: 'square', gain: 0.16, delay: 0.40 });
  }

  lowFuel() {
    this._tone(880, 0.09, { type: 'square', gain: 0.15 });
    this._tone(880, 0.09, { type: 'square', gain: 0.15, delay: 0.16 });
  }

  uiBlip(up = true) {
    this._tone(up ? 660 : 330, 0.07, { type: 'square', gain: 0.13 });
  }

  fanfare() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((n, i) => this._tone(n, 0.22, { type: 'square', gain: 0.15, delay: i * 0.12 }));
  }

  gameOver() {
    const notes = [392, 349, 311, 262, 196];
    notes.forEach((n, i) => this._tone(n, 0.42, { type: 'sawtooth', gain: 0.16, delay: i * 0.24 }));
  }

  // ----------------------------------------------------------------- music

  /**
   * Start a simple driving bass loop.  Scheduled with lookahead from the
   * game's update tick, so it never depends on timer accuracy.
   */
  startMusic(root = null, scale = null) {
    if (!this.ready) return;
    // Called with no arguments (e.g. resuming from pause) it keeps whatever
    // mood the current stage set.
    if (root !== null) this._musicRoot = root;
    if (scale !== null) this._musicScale = scale;
    this._musicOn = true;
    this._nextNote = Math.max(this._nextNote, this.t + 0.05);
  }

  stopMusic() { this._musicOn = false; }

  /** Call every frame; schedules any notes falling inside the lookahead. */
  tickMusic(intensity = 0.5) {
    if (!this.ready || !this._musicOn || this.muted) return;
    const now = this.t;
    const beat = 60 / (104 + intensity * 46) / 2; // eighth notes
    const lookahead = 0.25;
    let guard = 0;
    if (this._nextNote < now) this._nextNote = now + 0.02;
    while (this._nextNote < now + lookahead && guard++ < 32) {
      const s = this._step;
      const deg = this._musicScale[(s * 3) % this._musicScale.length];
      const oct = s % 8 === 6 ? 12 : 0;
      const freq = this._musicRoot * Math.pow(2, (deg + oct) / 12);
      const when = this._nextNote - now;
      this._tone(freq, beat * 0.9, {
        type: 'square', gain: 0.10 + intensity * 0.05, bus: this.musicBus, delay: when,
      });
      if (s % 4 === 0) {
        this._noise(0.07, { type: 'lowpass', freq: 200, gain: 0.34, bus: this.musicBus, delay: when });
      }
      if (s % 4 === 2) {
        this._noise(0.05, { type: 'highpass', freq: 5200, gain: 0.10, bus: this.musicBus, delay: when });
      }
      this._step = (s + 1) % 64;
      this._nextNote += beat;
    }
  }
}
