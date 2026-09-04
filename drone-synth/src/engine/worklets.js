// AudioWorklet processors, as source strings compiled to blob modules at
// start-up. Everything here runs on the audio thread, which is why these are
// the parts of the instrument that could not be built out of stock nodes:
// a decimator, a frequency divider, a pitch shifter, a granular cloud and a
// capture tap.

// ---------------------------------------------------------------------------
// Decimator + bit crusher. Sample-and-hold at `rate`, then quantise to
// `bits`. The hold length is recomputed only when the message arrives, so the
// inner loop stays a compare and an index.
// ---------------------------------------------------------------------------
export const DOWNSAMPLE = `
class DownsampleProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.hold = Math.max(1, Math.floor(sampleRate / 12000));
    this.levels = 0;              // 0 = bypass quantisation
    this.phase = 0;
    this.lastL = 0;
    this.lastR = 0;
    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (d.rate !== undefined) {
        const r = Math.max(200, Math.min(sampleRate * 0.5, +d.rate || 12000));
        this.hold = Math.max(1, Math.round(sampleRate / r));
      }
      if (d.bits !== undefined) {
        const b = Math.max(1, Math.min(24, Math.round(+d.bits || 16)));
        this.levels = b >= 16 ? 0 : Math.pow(2, b - 1);
      }
    };
  }
  crush(x) {
    if (!this.levels) return x;
    return Math.round(x * this.levels) / this.levels;
  }
  process(inputs, outputs) {
    const input = inputs[0];
    const out = outputs[0];
    const oL = out[0];
    const oR = out[1] || out[0];
    const n = oL.length;
    if (!input || !input.length) {
      oL.fill(0);
      if (out[1]) oR.fill(0);
      return true;
    }
    const inL = input[0];
    const inR = input[1] || inL;
    for (let i = 0; i < n; i++) {
      if (this.phase === 0) {
        this.lastL = this.crush(inL[i]);
        this.lastR = this.crush(inR[i]);
      }
      oL[i] = this.lastL;
      oR[i] = this.lastR;
      this.phase = (this.phase + 1) % this.hold;
    }
    return true;
  }
}
registerProcessor('downsample-processor', DownsampleProcessor);
`;

// ---------------------------------------------------------------------------
// Analogue-style sub-octave divider: flip-flops clocked by zero crossings of
// the input, giving a square an octave and a twelfth below the fundamental.
//
// The prototype's version triggered on every sign change, so noise or any
// harmonic riding through zero re-clocked it and the sub warbled. This one
// uses a Schmitt trigger with a hysteresis band and an envelope-tracked
// threshold, so a quiet or noisy input divides cleanly or not at all.
// ---------------------------------------------------------------------------
export const SUB_DIVIDER = `
class SubDividerProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'blend', defaultValue: 0.35, minValue: 0, maxValue: 1, automationRate: 'k-rate' }];
  }
  constructor() {
    super();
    this.state = 1;   // Schmitt output
    this.env = 0;
    this.count = 0;
    this.sq2 = -1;
    this.sq3 = -1;
  }
  process(inputs, outputs, params) {
    const input = inputs[0];
    const out = outputs[0];
    const oL = out[0];
    const oR = out[1] || out[0];
    const n = oL.length;
    if (!input || !input.length) {
      oL.fill(0);
      if (out[1]) oR.fill(0);
      return true;
    }
    const inL = input[0];
    const inR = input[1] || inL;
    const blend = params.blend.length > 1 ? params.blend[0] : params.blend[0];
    const gFifth = blend;
    const gOct = 1 - blend;
    for (let i = 0; i < n; i++) {
      const x = 0.5 * (inL[i] + inR[i]);
      // Track signal level so the hysteresis band scales with the input.
      const a = Math.abs(x);
      this.env += (a > this.env ? 0.01 : 0.0002) * (a - this.env);
      const hyst = Math.max(0.002, this.env * 0.25);
      let edge = false;
      if (this.state > 0 && x < -hyst) { this.state = -1; edge = true; }
      else if (this.state < 0 && x > hyst) { this.state = 1; edge = true; }
      if (edge) {
        this.count++;
        if (this.count % 2 === 0) this.sq2 = -this.sq2;
        if (this.count % 3 === 0) this.sq3 = -this.sq3;
      }
      // Gate by the envelope: silence in, silence out, rather than a square
      // wave latched at whatever the last crossing left behind.
      const gate = Math.min(1, this.env * 6);
      const y = (gOct * this.sq2 + gFifth * this.sq3) * gate * 0.5;
      oL[i] = y;
      oR[i] = y;
    }
    return true;
  }
}
registerProcessor('sub-divider-processor', SubDividerProcessor);
`;

// ---------------------------------------------------------------------------
// Pitch shifter: two taps on a delay line, read at the pitch ratio, offset by
// half a window and crossfaded with an equal-power (sine) window so the
// discontinuity when a tap wraps is always covered by the other tap.
//
// This is what "Harmonizer" and "Shimmer" needed. The prototype wobbled a
// delay time with an LFO, which is vibrato — it moves pitch back and forth
// around the original and never holds an interval.
// ---------------------------------------------------------------------------
export const PITCH_SHIFT = `
class PitchShiftProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'ratio', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' },
      { name: 'window', defaultValue: 0.08, minValue: 0.01, maxValue: 0.4, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super();
    this.size = Math.ceil(sampleRate * 0.5);
    this.bufL = new Float32Array(this.size);
    this.bufR = new Float32Array(this.size);
    this.write = 0;
    this.phase = 0;
  }
  read(buf, pos) {
    let p = pos;
    while (p < 0) p += this.size;
    while (p >= this.size) p -= this.size;
    const i0 = Math.floor(p);
    const frac = p - i0;
    const i1 = i0 + 1 >= this.size ? 0 : i0 + 1;
    return buf[i0] + (buf[i1] - buf[i0]) * frac;
  }
  process(inputs, outputs, params) {
    const input = inputs[0];
    const out = outputs[0];
    const oL = out[0];
    const oR = out[1] || out[0];
    const n = oL.length;
    if (!input || !input.length) {
      oL.fill(0);
      if (out[1]) oR.fill(0);
      return true;
    }
    const inL = input[0];
    const inR = input[1] || inL;
    const ratio = params.ratio[0];
    const W = Math.max(64, Math.floor(params.window[0] * sampleRate));
    // Delay grows (or shrinks) at (1 - ratio) samples per sample; wrapping it
    // into one window is what makes the shift continuous rather than a slide.
    const inc = (1 - ratio) / W;
    for (let i = 0; i < n; i++) {
      this.bufL[this.write] = inL[i];
      this.bufR[this.write] = inR[i];
      let p1 = this.phase;
      let p2 = p1 + 0.5;
      if (p2 >= 1) p2 -= 1;
      const d1 = p1 * W;
      const d2 = p2 * W;
      const g1 = Math.sin(Math.PI * p1);
      const g2 = Math.sin(Math.PI * p2);
      oL[i] = g1 * this.read(this.bufL, this.write - d1) + g2 * this.read(this.bufL, this.write - d2);
      oR[i] = g1 * this.read(this.bufR, this.write - d1) + g2 * this.read(this.bufR, this.write - d2);
      this.phase += inc;
      while (this.phase >= 1) this.phase -= 1;
      while (this.phase < 0) this.phase += 1;
      this.write++;
      if (this.write >= this.size) this.write = 0;
    }
    return true;
  }
}
registerProcessor('pitch-shift-processor', PitchShiftProcessor);
`;

// ---------------------------------------------------------------------------
// Granular cloud over a rolling capture of the live signal.
//
// The prototype's "granular" retriggered a fixed noise buffer, so it granulated
// noise, not the instrument. This keeps four seconds of the actual output in a
// circular buffer and scatters Hann-windowed grains across it, which is what
// makes the effect track whatever the drone is currently doing.
// ---------------------------------------------------------------------------
export const GRANULAR = `
const MAX_GRAINS = 48;
class GranularProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'density', defaultValue: 12, minValue: 0, maxValue: 120, automationRate: 'k-rate' },
      { name: 'size', defaultValue: 0.12, minValue: 0.005, maxValue: 0.8, automationRate: 'k-rate' },
      { name: 'scatter', defaultValue: 0.5, minValue: 0, maxValue: 3.5, automationRate: 'k-rate' },
      { name: 'pitch', defaultValue: 1, minValue: 0.125, maxValue: 8, automationRate: 'k-rate' },
      { name: 'spread', defaultValue: 0.6, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }
  constructor() {
    super();
    this.size = Math.ceil(sampleRate * 4);
    this.bufL = new Float32Array(this.size);
    this.bufR = new Float32Array(this.size);
    this.write = 0;
    this.nextGrain = 0;
    this.grains = [];
    for (let i = 0; i < MAX_GRAINS; i++) {
      this.grains.push({ on: false, pos: 0, step: 1, len: 1, age: 0, gl: 1, gr: 1 });
    }
  }
  read(buf, pos) {
    let p = pos;
    while (p < 0) p += this.size;
    while (p >= this.size) p -= this.size;
    const i0 = Math.floor(p);
    const frac = p - i0;
    const i1 = i0 + 1 >= this.size ? 0 : i0 + 1;
    return buf[i0] + (buf[i1] - buf[i0]) * frac;
  }
  spawn(size, scatter, pitch, spread) {
    const g = this.grains.find((x) => !x.on);
    if (!g) return;
    const len = Math.max(32, Math.floor(size * sampleRate));
    // Read from behind the write head by at least one grain length, so a
    // grain never overtakes the writer and reads samples it has not stored.
    const back = len + Math.random() * scatter * sampleRate;
    g.on = true;
    g.pos = this.write - back;
    g.step = pitch;
    g.len = len;
    g.age = 0;
    const pan = (Math.random() * 2 - 1) * spread;
    g.gl = Math.cos((pan + 1) * Math.PI / 4);
    g.gr = Math.sin((pan + 1) * Math.PI / 4);
  }
  process(inputs, outputs, params) {
    const input = inputs[0];
    const out = outputs[0];
    const oL = out[0];
    const oR = out[1] || out[0];
    const n = oL.length;
    oL.fill(0);
    if (out[1]) oR.fill(0);
    if (input && input.length) {
      const inL = input[0];
      const inR = input[1] || inL;
      for (let i = 0; i < n; i++) {
        let w = this.write + i;
        if (w >= this.size) w -= this.size;
        this.bufL[w] = inL[i];
        this.bufR[w] = inR[i];
      }
    }
    const density = params.density[0];
    const size = params.size[0];
    const scatter = params.scatter[0];
    const pitch = params.pitch[0];
    const spread = params.spread[0];
    const period = density > 0 ? sampleRate / density : Infinity;
    for (let i = 0; i < n; i++) {
      if (density > 0) {
        this.nextGrain--;
        if (this.nextGrain <= 0) {
          this.spawn(size, scatter, pitch, spread);
          // Jitter the spawn clock so grains do not queue into a buzz at the
          // density frequency.
          this.nextGrain = period * (0.6 + Math.random() * 0.8);
        }
      }
      for (let k = 0; k < MAX_GRAINS; k++) {
        const g = this.grains[k];
        if (!g.on) continue;
        const t = g.age / g.len;
        if (t >= 1) { g.on = false; continue; }
        const win = 0.5 - 0.5 * Math.cos(2 * Math.PI * t);
        oL[i] += this.read(this.bufL, g.pos) * win * g.gl;
        oR[i] += this.read(this.bufR, g.pos) * win * g.gr;
        g.pos += g.step;
        g.age++;
      }
      this.write++;
      if (this.write >= this.size) this.write = 0;
    }
    // Overlapping Hann grains sum well above unity at high density; scale by
    // the expected overlap count so the mix knob stays meaningful.
    const overlap = Math.max(1, Math.sqrt(Math.max(1, density * size)));
    const norm = 0.8 / overlap;
    for (let i = 0; i < n; i++) {
      oL[i] *= norm;
      oR[i] *= norm;
    }
    return true;
  }
}
registerProcessor('granular-processor', GranularProcessor);
`;

// ---------------------------------------------------------------------------
// Capture tap for Freeze. Records N seconds and posts the two channels back,
// replacing the deprecated ScriptProcessorNode the prototype used (which ran
// on the main thread and dropped samples whenever the UI was busy).
// ---------------------------------------------------------------------------
export const CAPTURE = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.idx = 0;
    this.L = null;
    this.R = null;
    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (d.cmd === 'record') {
        const len = Math.max(1, Math.floor(d.seconds * sampleRate));
        this.L = new Float32Array(len);
        this.R = new Float32Array(len);
        this.idx = 0;
        this.recording = true;
      } else if (d.cmd === 'cancel') {
        this.recording = false;
        this.L = this.R = null;
      }
    };
  }
  process(inputs) {
    if (!this.recording) return true;
    const input = inputs[0];
    if (!input || !input.length) return true;
    const inL = input[0];
    const inR = input[1] || inL;
    const n = inL.length;
    for (let i = 0; i < n && this.idx < this.L.length; i++, this.idx++) {
      this.L[this.idx] = inL[i];
      this.R[this.idx] = inR[i];
    }
    if (this.idx >= this.L.length) {
      this.recording = false;
      const L = this.L;
      const R = this.R;
      this.L = this.R = null;
      this.port.postMessage({ done: true, L, R }, [L.buffer, R.buffer]);
    }
    return true;
  }
}
registerProcessor('capture-processor', CaptureProcessor);
`;

export const ALL_WORKLETS = [DOWNSAMPLE, SUB_DIVIDER, PITCH_SHIFT, GRANULAR, CAPTURE];

export async function loadWorklets(ctx) {
  if (!ctx.audioWorklet) return false;
  const urls = [];
  try {
    for (const src of ALL_WORKLETS) {
      const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
      urls.push(url);
      await ctx.audioWorklet.addModule(url);
    }
    return true;
  } catch (err) {
    console.warn('AudioWorklet unavailable; worklet-based modules disabled.', err);
    return false;
  } finally {
    // The modules are compiled by now; the object URLs would otherwise pin
    // their blobs for the lifetime of the document.
    for (const url of urls) URL.revokeObjectURL(url);
  }
}
