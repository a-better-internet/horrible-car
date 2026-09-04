// The systems that make the instrument move on its own.
//
// The prototype ran each of these on its own setInterval — fifteen timers,
// none of them cleared, several writing the same AudioParam. Here they share
// one scheduler and publish through the modulation router, and every one of
// them derives its phase from the audio clock rather than from a tick count.
// That last detail matters more than it looks: browsers throttle timers in
// background tabs to about one call a second, and a drone is very often left
// running in a background tab. Phase taken from `ctx.currentTime` keeps a
// twenty-minute plate cycle exactly twenty minutes long whether it was
// updated thirty times a second or once.

import { BY_ID, VOICES, clamp, toNorm, fromNorm } from './params.js';

const MODULATABLE_FOR_EVOLVE = [
  'filterFreq', 'filterQ', 'reverb', 'reverbDecay', 'delayMix', 'delayFeedback',
  'ringModFreq', 'ringModDepth', 'lfoSpeed', 'lfoDepth', 'stereoWidth',
  'shimmerVolume', 'harmonizerVolume', 'chorusVolume', 'wowFlutterVolume',
  'granularDepth', 'hazeMix', 'subMix', 'radioVolume', 'noiseColor',
  'pulseWidth', 'toneTilt', 'distortion', 'distortion2', 'supersawVolume',
  ...VOICES.map((v) => `${v}Vol`),
  ...VOICES.map((v) => `${v}Pan`),
];

/** A curve that wanders instead of merely rocking back and forth. The second
 *  partial is at an irrational multiple of the first, so the pair does not
 *  return to the same shape for a very long time. It is zero at phase zero:
 *  a plate switched on starts from wherever the patch already is rather than
 *  stepping to some offset the moment the checkbox is ticked. */
function tectonicShape(phase, skew = 0) {
  const p = phase + skew * 0.3 * Math.sin(2 * Math.PI * phase);
  return 0.72 * Math.sin(2 * Math.PI * p) + 0.28 * Math.sin(2 * Math.PI * p * 1.6180339887);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Smoothstep: morphs that ease in and out read as intentional; linear ones
 *  read as an automation curve someone forgot to shape. */
function ease(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/** Semitone offset expressed in the parameter's own units (Hz), so the router
 *  can sum it with everything else and the pitch slider can show the ghost. */
function semitoneOffsetHz(baseHz, semitones) {
  return baseHz * (Math.pow(2, semitones / 12) - 1);
}

// ---------------------------------------------------------------------------

export class Systems {
  constructor(store, router) {
    this.store = store;
    this.router = router;
    this.engine = null;
    this.ctx = null;

    this.lastTime = 0;
    this.running = false;
    this.timer = null;
    // Smoothing for systems that publish a new value every tick. Their motion
    // is already a continuous trajectory, so the ramp only has to bridge one
    // tick — long smoothing here would double-smooth and, worse, would mean
    // every write restarted a multi-second glide from the current value, so
    // the parameter could never move faster than the slowest system touching
    // it. Tracked from the real tick interval so a throttled background tab
    // (where timers fire about once a second) still bridges its gaps.
    this.tickSmooth = 0.08;

    // Sequencer
    this.seq = { index: 0, next: 0, dir: 1, lastFire: 0 };

    // Tectonic plates, each with its own free-running phase
    // Phase starts at zero and is reset whenever a plate is switched on, so
    // "62% through a 20-minute cycle" on the timeline is a fact rather than a
    // decoration. (The prototype filled these bars with Math.random().)
    this.plates = {
      harmonic: { phase: 0, value: 0, wasEnabled: false },
      timbral: { phase: 0, value: 0, wasEnabled: false },
      spatial: { phase: 0, value: 0, wasEnabled: false },
    };

    // Random drift
    this.rand = { value: 0, next: 0 };

    // Organic drift: one slow random walk per target, seeded apart
    this.walks = {};

    // Envelope follower
    this.env = { level: 0, buf: null };

    // Probability gate
    this.gate = { next: 0, open: true };

    // Auto-evolve. `home` is the patch the evolution orbits — see triggerEvolve.
    this.evolve = { next: 0, lastSnapshot: null, home: null, count: 0 };

    // Memory
    this.memory = { slots: [], next: 0, lastRecall: 0 };

    // Active base-value morphs (auto-evolve, memory recall, preset morph)
    this.morphs = [];

    this.listeners = new Set();
  }

  attach(engine) {
    this.engine = engine;
    this.ctx = engine.ctx;
    this.env.buf = new Uint8Array(engine.nodes.envAnalyser.frequencyBinCount);
    const now = this.ctx.currentTime;
    this.lastTime = now;
    this.seq.next = now + this.store.get('seqStepTime');
    this.rand.next = now;
    this.gate.next = now;
    this.evolve.next = now + this.store.get('evolveRate');
    this.memory.next = now + this.store.get('memoryInterval') * 60;
  }

  start() {
    if (this.running) return;
    this.running = true;
    // A plain interval, not requestAnimationFrame: rAF stops entirely in a
    // background tab, and an instrument designed to be left running for an
    // hour must keep evolving when it is not the frontmost thing on screen.
    this.timer = setInterval(() => this.tick(), 33);
  }

  stop() {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(event, detail) {
    for (const fn of this.listeners) fn(event, detail);
  }

  // -------------------------------------------------------------------------

  tick() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const dt = Math.max(0, Math.min(2, now - this.lastTime));
    this.lastTime = now;
    this.tickSmooth = Math.max(0.05, Math.min(2, dt * 1.6));

    this.tickMorphs(now);
    this.tickMorphVoices();
    this.tickOrganic(dt);
    this.tickRandom(now);
    this.tickEnvelope(dt);
    this.tickGate(now);
    this.tickSequencer(now);
    this.tickPlates(dt);
    this.tickEvolve(now);
    this.tickMemory(now);

    this.router.flush();
  }

  // ---- morphs of base values ----------------------------------------------

  /**
   * Move base values over time. Auto-evolve and memory recall both work this
   * way, so the sliders visibly travel to their new positions instead of
   * jumping, and whatever moved is plainly the patch itself rather than a
   * hidden offset the user cannot see or undo.
   */
  startMorph(target, durationSeconds, tag = 'morph') {
    const now = this.ctx ? this.ctx.currentTime : 0;
    const entries = [];
    for (const id of Object.keys(target)) {
      const p = BY_ID[id];
      if (!p || p.type !== 'num') continue;
      const from = Number(this.store.get(id));
      const to = clamp(Number(target[id]), p.min, p.max);
      if (Math.abs(from - to) < 1e-9) continue;
      entries.push({ id, from, to });
    }
    if (!entries.length) return null;
    // One morph per parameter: a second morph over the same knob supersedes
    // the first rather than the two fighting to the end of their durations.
    this.morphs = this.morphs.filter((m) => !entries.some((e) => e.id === m.id));
    for (const e of entries) {
      this.morphs.push({ ...e, t0: now, dur: Math.max(0.05, durationSeconds), tag });
    }
    this.emit('morph-start', { tag, count: entries.length, duration: durationSeconds });
    return entries.length;
  }

  cancelMorphs(tag) {
    this.morphs = tag ? this.morphs.filter((m) => m.tag !== tag) : [];
  }

  tickMorphs(now) {
    if (!this.morphs.length) return;
    const still = [];
    for (const m of this.morphs) {
      const t = (now - m.t0) / m.dur;
      const v = lerp(m.from, m.to, ease(t));
      this.store.set(m.id, v, { smooth: 0.08 });
      if (t < 1) still.push(m);
    }
    if (still.length !== this.morphs.length) this.emit('morph-progress', { active: still.length });
    this.morphs = still;
  }

  get morphProgress() {
    if (!this.morphs.length || !this.ctx) return null;
    const now = this.ctx.currentTime;
    let worst = 1;
    for (const m of this.morphs) worst = Math.min(worst, (now - m.t0) / m.dur);
    return { t: clamp(worst, 0, 1), tag: this.morphs[0].tag, count: this.morphs.length };
  }

  // ---- wave morph ---------------------------------------------------------

  /**
   * The morph crossfader, published as offsets rather than written over the
   * mixer. Disengaging returns the three voices to whatever levels they had.
   */
  tickMorphVoices() {
    if (!this.store.get('morphEnable')) {
      this.router.clearSource('morph');
      return;
    }
    const v = this.store.get('waveMorph');
    let sine, square, saw;
    if (v <= 0.5) {
      const t = v / 0.5;
      sine = 1 - t; square = t; saw = 0;
    } else {
      const t = (v - 0.5) / 0.5;
      sine = 0; square = 1 - t; saw = t;
    }
    const want = { sineVol: sine, squareVol: square, sawtoothVol: saw };
    for (const id of Object.keys(want)) {
      this.router.offset(id, 'morph', want[id] - Number(this.store.get(id)), this.tickSmooth);
    }
  }

  // ---- organic drift ------------------------------------------------------

  /**
   * The slow life the instrument has even with every automated system off.
   * A bounded random walk per target — the prototype used
   * linearRampToValueAtTime from whatever the last scheduled event happened
   * to be, which meant the ramp's starting point was undefined and the drift
   * could step rather than glide.
   */
  tickOrganic(dt) {
    const amount = Number(this.store.get('organicDrift'));
    if (amount <= 0) {
      this.router.clearSource('organic');
      return;
    }
    const step = (key, rate, range) => {
      let w = this.walks[key];
      if (!w) w = this.walks[key] = { v: 0, target: (Math.random() * 2 - 1), t: 0 };
      w.t += dt;
      if (w.t >= rate) {
        w.t = 0;
        w.target = Math.random() * 2 - 1;
      }
      // One-pole toward the target: continuous, and bounded by construction.
      w.v += (w.target - w.v) * Math.min(1, dt / (rate * 0.5));
      return w.v * range * amount;
    };
    for (let i = 0; i < VOICES.length; i++) {
      const v = VOICES[i];
      this.router.offset(`${v}Detune`, 'organic', step(`${v}d`, 3 + i * 0.7, 6), this.tickSmooth);
      this.router.offset(`${v}Pan`, 'organic', step(`${v}p`, 5 + i * 1.1, 0.18), this.tickSmooth);
    }
    const base = Number(this.store.get('filterFreq'));
    this.router.offset('filterFreq', 'organic', base * step('filt', 4.5, 0.12), this.tickSmooth);
  }

  // ---- random drift -------------------------------------------------------

  tickRandom(now) {
    const amount = Number(this.store.get('randAmount'));
    if (amount <= 0) {
      this.router.clearSource('random');
      return;
    }
    if (now >= this.rand.next) {
      this.rand.value = Math.random() * 2 - 1;
      this.rand.next = now + Number(this.store.get('randRate'));
      this.emit('random-step', { value: this.rand.value });
    }
    const k = this.rand.value * amount;
    const tau = Number(this.store.get('randRate')) * 0.5;
    const fBase = Number(this.store.get('filterFreq'));
    this.router.offset('filterFreq', 'random', fBase * (Math.pow(2, k * 0.5) - 1), tau);
    this.router.offset('stereoWidth', 'random', k * 0.4, tau);
    for (const v of VOICES) this.router.offset(`${v}Pan`, 'random', k * 0.2, tau);
  }

  // ---- envelope follower --------------------------------------------------

  tickEnvelope(dt) {
    const sens = Number(this.store.get('envFollow'));
    const toFilter = Number(this.store.get('envToFilter'));
    if (sens <= 0 || !this.engine) {
      this.router.clearSource('env');
      this.env.level = 0;
      return;
    }
    const analyser = this.engine.nodes.envAnalyser;
    analyser.getByteTimeDomainData(this.env.buf);
    let peak = 0;
    for (let i = 0; i < this.env.buf.length; i++) {
      const a = Math.abs(this.env.buf[i] - 128);
      if (a > peak) peak = a;
    }
    const level = peak / 128;
    const smooth = Number(this.store.get('envSmooth'));
    const a = Math.min(1, dt / Math.max(0.005, smooth));
    this.env.level += (level - this.env.level) * a;
    if (toFilter > 0) {
      const base = Number(this.store.get('filterFreq'));
      const octaves = this.env.level * sens * toFilter * 3;
      // The follower's own time constant already shapes the trajectory; the
      // ramp only bridges a tick.
      this.router.offset('filterFreq', 'env', base * (Math.pow(2, octaves) - 1), this.tickSmooth);
    } else {
      this.router.offset('filterFreq', 'env', 0);
    }
  }

  // ---- probability gate ---------------------------------------------------

  tickGate(now) {
    if (!this.engine) return;
    const chance = Number(this.store.get('probGate'));
    const depth = Number(this.store.get('probDepth'));
    const rate = Number(this.store.get('probRate'));
    if (chance >= 1 || depth <= 0) {
      if (!this.gate.open) {
        this.gate.open = true;
        this.engine.ramp(this.engine.nodes.probGate.gain, 1, 0.05);
        this.emit('gate', { open: true });
      }
      this.gate.next = now + 1 / Math.max(0.01, rate);
      return;
    }
    if (now < this.gate.next) return;
    this.gate.next = now + 1 / Math.max(0.01, rate);
    const open = Math.random() < chance;
    if (open !== this.gate.open) this.emit('gate', { open });
    this.gate.open = open;
    const slew = Number(this.store.get('probSlew'));
    this.engine.ramp(this.engine.nodes.probGate.gain, open ? 1 : 1 - depth, slew);
  }

  // ---- step sequencer -----------------------------------------------------

  tickSequencer(now) {
    if (!this.store.get('seqOn')) {
      this.router.clearSource('seq');
      return;
    }
    const stepTime = Number(this.store.get('seqStepTime'));
    if (now >= this.seq.next) {
      this.seq.next = now + stepTime;
      this.advanceStep();
      this.emit('seq-step', { index: this.seq.index });
    }
    const v = Number(this.store.get(`seqStep${this.seq.index}`));
    const glide = Number(this.store.get('seqSmooth'));

    const amtFilter = Number(this.store.get('seqAmtFilter'));
    if (amtFilter > 0) {
      const base = Number(this.store.get('filterFreq'));
      this.router.offset('filterFreq', 'seq', base * (Math.pow(2, v * amtFilter) - 1), glide);
    } else {
      this.router.offset('filterFreq', 'seq', 0);
    }

    const amtRing = Number(this.store.get('seqAmtRing'));
    this.router.offset('ringModDepth', 'seq', amtRing > 0 ? v * amtRing : 0, glide);

    // The prototype defined a pulse-width slew for the sequencer and never
    // called it, and had no pitch target at all — the two destinations a
    // drone sequencer most wants.
    const amtPW = Number(this.store.get('seqAmtPW'));
    this.router.offset('pulseWidth', 'seq', amtPW > 0 ? v * amtPW : 0, glide);

    const amtPitch = Number(this.store.get('seqAmtPitch'));
    if (amtPitch > 0) {
      for (const voice of VOICES) {
        const base = Number(this.store.get(`${voice}Pitch`));
        this.router.offset(`${voice}Pitch`, 'seq', semitoneOffsetHz(base, v * amtPitch), glide);
      }
      const ssBase = Number(this.store.get('supersawPitch'));
      this.router.offset('supersawPitch', 'seq', semitoneOffsetHz(ssBase, v * amtPitch), glide);
    } else {
      for (const voice of VOICES) this.router.offset(`${voice}Pitch`, 'seq', 0);
      this.router.offset('supersawPitch', 'seq', 0);
    }
  }

  advanceStep() {
    const len = Math.max(1, Math.round(Number(this.store.get('seqLength'))));
    const mode = this.store.get('seqMode');
    if (mode === 'random') {
      this.seq.index = Math.floor(Math.random() * len);
      return;
    }
    if (mode === 'reverse') {
      this.seq.index = (this.seq.index - 1 + len) % len;
      return;
    }
    if (mode === 'pingpong') {
      if (len === 1) { this.seq.index = 0; return; }
      let i = this.seq.index + this.seq.dir;
      if (i >= len) { i = len - 2; this.seq.dir = -1; }
      else if (i < 0) { i = 1; this.seq.dir = 1; }
      this.seq.index = clamp(i, 0, len - 1);
      return;
    }
    this.seq.index = (this.seq.index + 1) % len;
  }

  resetSequencer() {
    this.seq.index = 0;
    this.seq.dir = 1;
    if (this.ctx) this.seq.next = this.ctx.currentTime + Number(this.store.get('seqStepTime'));
  }

  // ---- tectonic plates ----------------------------------------------------

  /**
   * Three independent slow cycles. The prototype exposed a cycle length, a
   * depth and a progress bar for each and used none of them: the plates only
   * acted when Auto-Evolve happened to fire, they all moved on that one
   * shared timer, and the progress bars were filled with Math.random().
   */
  tickPlates(dt) {
    const step = (name, enabled, cycleMinutes) => {
      const p = this.plates[name];
      if (enabled && !p.wasEnabled) p.phase = 0;
      p.wasEnabled = enabled;
      if (!enabled) return null;
      p.phase += dt / Math.max(1, cycleMinutes * 60);
      while (p.phase >= 1) p.phase -= 1;
      return p;
    };

    // Harmonic: the whole instrument drifts through an interval and back.
    const hEnabled = !!this.store.get('harmonicDriftEnable');
    const h = step('harmonic', hEnabled, Number(this.store.get('harmonicCycle')));
    if (h) {
      const semis = tectonicShape(h.phase) * Number(this.store.get('harmonicDepth'));
      h.value = semis;
      for (const voice of VOICES) {
        const base = Number(this.store.get(`${voice}Pitch`));
        this.router.offset(`${voice}Pitch`, 'harmonic', semitoneOffsetHz(base, semis), this.tickSmooth);
      }
      const ss = Number(this.store.get('supersawPitch'));
      this.router.offset('supersawPitch', 'harmonic', semitoneOffsetHz(ss, semis), this.tickSmooth);
    } else {
      this.router.clearSource('harmonic');
      this.plates.harmonic.value = 0;
    }

    // Timbral: cutoff, pulse width and spectral tilt travel together.
    const tEnabled = !!this.store.get('timbralDriftEnable');
    const t = step('timbral', tEnabled, Number(this.store.get('timbralCycle')));
    if (t) {
      const skew = Number(this.store.get('timbralSpeed'));
      const shape = tectonicShape(t.phase, skew);
      const octaves = shape * Number(this.store.get('timbralDepth'));
      t.value = octaves;
      const base = Number(this.store.get('filterFreq'));
      this.router.offset('filterFreq', 'timbral', base * (Math.pow(2, octaves) - 1), this.tickSmooth);
      this.router.offset('pulseWidth', 'timbral', shape * 0.18, this.tickSmooth);
      this.router.offset('toneTilt', 'timbral', shape * 3.5, this.tickSmooth);
    } else {
      this.router.clearSource('timbral');
      this.plates.timbral.value = 0;
    }

    // Spatial: width breathes, and the voices orbit at different phases so
    // the image turns rather than merely widening.
    const sEnabled = !!this.store.get('spatialDriftEnable');
    const sp = step('spatial', sEnabled, Number(this.store.get('spatialCycle')));
    if (sp) {
      const range = Number(this.store.get('spatialRange'));
      const shape = tectonicShape(sp.phase);
      sp.value = shape * range;
      this.router.offset('stereoWidth', 'spatial', shape * range * 0.5, this.tickSmooth);
      for (let i = 0; i < VOICES.length; i++) {
        const off = tectonicShape(sp.phase + i / VOICES.length);
        this.router.offset(`${VOICES[i]}Pan`, 'spatial', off * range * 0.35, this.tickSmooth);
      }
    } else {
      this.router.clearSource('spatial');
      this.plates.spatial.value = 0;
    }
  }

  plateState(name) {
    const p = this.plates[name];
    const enabled = !!this.store.get(`${name}DriftEnable`);
    const cycle = Number(this.store.get(`${name}Cycle`));
    return {
      enabled,
      phase: p.phase,
      value: p.value,
      cycleMinutes: cycle,
      remainingSeconds: enabled ? (1 - p.phase) * cycle * 60 : null,
    };
  }

  // ---- auto-evolve --------------------------------------------------------

  tickEvolve(now) {
    if (!this.store.get('autoEvolve')) {
      this.evolve.next = now + Number(this.store.get('evolveRate'));
      return;
    }
    if (now < this.evolve.next) return;
    this.evolve.next = now + Number(this.store.get('evolveRate'));
    this.triggerEvolve();
  }

  /**
   * Nudge the patch itself. This is the one system that rewrites base values:
   * that is what "evolve" means, and the alternative — a hidden offset — gives
   * you a patch whose sound and whose controls disagree. The pre-evolve state
   * is kept so a single click puts it back.
   */
  triggerEvolve(depthOverride) {
    const depth = depthOverride === undefined ? Number(this.store.get('evolveDepth')) : depthOverride;
    if (depth <= 0) return 0;
    this.evolve.lastSnapshot = this.store.snapshot((p) => p && p.mod && p.type === 'num');
    if (!this.evolve.home) this.setEvolveHome();

    const pool = MODULATABLE_FOR_EVOLVE.filter((id) => BY_ID[id]);
    // Move a handful of things a long way rather than everything a little:
    // the second reads as noise, the first as the patch having gone somewhere.
    const n = Math.max(2, Math.round(2 + depth * 6));
    const picked = new Set();
    while (picked.size < Math.min(n, pool.length)) {
      picked.add(pool[Math.floor(Math.random() * pool.length)]);
    }

    const target = {};
    for (const id of picked) {
      const p = BY_ID[id];
      const cur = Number(this.store.get(id));
      const home = this.evolve.home[id] !== undefined ? Number(this.evolve.home[id]) : cur;
      // Stepping in slider space, not in the parameter's own units. A ±35%
      // linear nudge means one thing on a 0..1 mix and something absurd on a
      // 0.1..2000 Hz exponential control, where it would leap several octaves
      // at the bottom of the range and barely stir at the top.
      const nCur = toNorm(p, cur);
      const nHome = toNorm(p, home);
      // A plain random walk against clamped ends is an absorbing process: run
      // it long enough and every parameter is pinned at its minimum or its
      // maximum, which is exactly what a left-running drone did. Pulling a
      // quarter of the way back toward the patch it started from turns the
      // walk into an orbit — it still goes somewhere, but it comes back.
      const nRev = nCur + (nHome - nCur) * 0.25;
      const nNext = clamp(nRev + (Math.random() * 2 - 1) * depth * 0.35, 0, 1);
      target[id] = clamp(fromNorm(p, nNext), p.min, p.max);
    }
    const duration = Math.max(2, Number(this.store.get('evolveRate')) * 0.8);
    this.startMorph(target, duration, 'evolve');
    this.evolve.count++;
    this.emit('evolve', { count: this.evolve.count, changed: Object.keys(target).length, duration });
    return Object.keys(target).length;
  }

  /** Re-anchor the orbit on the patch as it stands now. */
  setEvolveHome() {
    this.evolve.home = this.store.snapshot((p) => p && p.mod && p.type === 'num');
  }

  undoEvolve() {
    if (!this.evolve.lastSnapshot) return false;
    this.startMorph(this.evolve.lastSnapshot, 2, 'undo');
    this.evolve.lastSnapshot = null;
    this.emit('evolve-undo', {});
    return true;
  }

  /**
   * Called when a parameter changes so timers can be re-aimed. Without this,
   * shortening Auto-Evolve from ten minutes to ten seconds still leaves you
   * waiting out the remainder of the ten minutes, which reads as a dead knob.
   */
  onParamChanged(id, value) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    switch (id) {
      case 'autoEvolve':
        if (value) { this.setEvolveHome(); this.evolve.next = now + Number(this.store.get('evolveRate')); }
        break;
      case 'evolveRate':
        this.evolve.next = Math.min(this.evolve.next, now + Number(value));
        break;
      case 'memoryEnable':
        if (value) this.memory.next = now + Number(this.store.get('memoryInterval')) * 60;
        break;
      case 'memoryInterval':
        this.memory.next = Math.min(this.memory.next, now + Number(value) * 60);
        break;
      case 'memoryDepth':
        this.trimMemory();
        break;
      case 'seqOn':
        if (value) this.resetSequencer();
        break;
      case 'seqStepTime':
        this.seq.next = Math.min(this.seq.next, now + Number(value));
        break;
      case 'randRate':
        this.rand.next = Math.min(this.rand.next, now + Number(value));
        break;
      default:
        break;
    }
  }

  get evolveCountdown() {
    if (!this.ctx || !this.store.get('autoEvolve')) return null;
    return Math.max(0, this.evolve.next - this.ctx.currentTime);
  }

  // ---- memory -------------------------------------------------------------

  /**
   * The prototype shipped nine controls and three buttons for this and never
   * wrote a line of it — no listeners, no storage, no recall. It captures the
   * patch periodically, keeps the last N, and now and then morphs back into
   * one of them, which is what makes a long session circle around a set of
   * related states instead of wandering away and never returning.
   */
  takeSnapshot(manual = false) {
    const snap = {
      at: Date.now(),
      audioTime: this.ctx ? this.ctx.currentTime : 0,
      manual,
      values: this.store.snapshot((p) => p && p.mod && p.type === 'num'),
    };
    this.memory.slots.push(snap);
    this.trimMemory();
    this.emit('memory', { count: this.memory.slots.length, action: 'snapshot' });
    return snap;
  }

  trimMemory() {
    const depth = Math.max(1, Math.round(Number(this.store.get('memoryDepth'))));
    while (this.memory.slots.length > depth) this.memory.slots.shift();
  }

  recall(index = -1) {
    if (!this.memory.slots.length) return false;
    const i = index < 0 ? Math.floor(Math.random() * this.memory.slots.length) : clamp(index, 0, this.memory.slots.length - 1);
    const snap = this.memory.slots[i];
    const minutes = Number(this.store.get('memoryMorphTime'));
    this.startMorph(snap.values, minutes * 60, 'memory');
    this.memory.lastRecall = this.ctx ? this.ctx.currentTime : 0;
    this.emit('memory', { count: this.memory.slots.length, action: 'recall', index: i });
    return true;
  }

  clearMemory() {
    this.memory.slots = [];
    this.emit('memory', { count: 0, action: 'clear' });
  }

  tickMemory(now) {
    if (!this.store.get('memoryEnable')) {
      this.memory.next = now + Number(this.store.get('memoryInterval')) * 60;
      return;
    }
    if (now < this.memory.next) return;
    this.memory.next = now + Number(this.store.get('memoryInterval')) * 60;
    this.takeSnapshot(false);
    if (this.memory.slots.length > 1 && Math.random() < Number(this.store.get('memoryProbability'))) {
      this.recall(-1);
    }
  }

  get memoryCountdown() {
    if (!this.ctx || !this.store.get('memoryEnable')) return null;
    return Math.max(0, this.memory.next - this.ctx.currentTime);
  }
}

export { tectonicShape, ease, semitoneOffsetHz };
