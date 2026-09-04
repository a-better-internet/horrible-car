// The modulation router.
//
// The prototype had six systems — the sequencer, auto-evolve, the tectonic
// plates, the envelope follower, random drift and the always-on organic drift
// — all calling setTargetAtTime on the same AudioParams. Web Audio has no
// notion of "who asked for this", so the last writer won and the sound
// depended on timer phase. Turning the sequencer off restored a cutoff the
// envelope follower was still moving; the user's own filter knob was
// overwritten within 50 ms of being touched.
//
// Here every automated system publishes a named, signed *offset* against a
// parameter instead of writing the node. The router sums them, adds the user's
// base value, clamps to the parameter's range and performs the single write.
// One writer per parameter, and the effective value is a number the UI can
// draw, which is what makes the evolution visible rather than merely audible.
//
// Slow systems only. Anything that has to move at audio rate (the pitch LFO,
// cross-modulation, the ring carrier, tremolo, chorus and wow delay lines,
// the breath) is a real connection into an AudioParam and never comes through
// here.

import { BY_ID, clamp } from '../params.js';

export class ModRouter {
  constructor(store) {
    this.store = store;
    this.offsets = new Map();   // paramId -> Map(sourceName -> amount)
    this.effective = new Map(); // paramId -> last computed value
    this.dirty = new Set();
    this.onApply = null;        // (id, value, smoothSeconds) => void
    this.smooth = new Map();    // paramId -> seconds, from the modulating system
    this.urgent = new Map();    // paramId -> seconds, for this flush only
  }

  /**
   * Publish `amount` (in the parameter's own units) from `source`. Passing 0
   * or null clears that source's contribution, so a system that switches off
   * simply stops contributing and the parameter returns to its base value.
   */
  offset(id, source, amount, smoothSeconds) {
    if (!BY_ID[id]) return;
    let m = this.offsets.get(id);
    if (!amount) {
      if (!m || !m.has(source)) return;
      m.delete(source);
      if (!m.size) this.offsets.delete(id);
    } else {
      if (!m) this.offsets.set(id, (m = new Map()));
      if (m.get(source) === amount && this.smooth.get(id) === smoothSeconds) return;
      m.set(source, amount);
    }
    if (smoothSeconds !== undefined) this.smooth.set(id, smoothSeconds);
    this.dirty.add(id);
  }

  /** Drop every offset a system owns — how a system is switched off cleanly. */
  clearSource(source) {
    for (const [id, m] of this.offsets) {
      if (m.delete(source)) {
        if (!m.size) this.offsets.delete(id);
        this.dirty.add(id);
      }
    }
  }

  /** Base + every offset, clamped: what the parameter is actually worth now. */
  compute(id) {
    const p = BY_ID[id];
    const base = Number(this.store.get(id));
    if (p.type !== 'num') return base;
    let sum = base;
    const m = this.offsets.get(id);
    if (m) for (const v of m.values()) sum += v;
    return clamp(sum, p.min, p.max);
  }

  /** Which systems are currently contributing to this parameter, if any. */
  sourcesFor(id) {
    const m = this.offsets.get(id);
    if (!m) return [];
    const out = [];
    for (const [src, v] of m) if (v) out.push(src);
    return out;
  }

  hasSource(id, source) {
    const m = this.offsets.get(id);
    return !!(m && m.get(source));
  }

  /** True when an automated system is currently moving this parameter. */
  isModulated(id) {
    const m = this.offsets.get(id);
    if (!m) return false;
    for (const v of m.values()) if (v) return true;
    return false;
  }

  /**
   * The base value moved, so anything with offsets has to be recomputed.
   *
   * The smoothing belongs to the *change*, not to the parameter. A tectonic
   * plate asks for four-second glides because that is how a plate should
   * move; if a knob move inherited that, turning the pitch up with a plate
   * running would take four seconds to be heard, and the control would feel
   * broken. So a base change carries its own, much shorter, smoothing and
   * uses it for this flush only.
   */
  markBaseChanged(id, smoothSeconds = 0.02) {
    if (!this.offsets.has(id)) return;
    this.dirty.add(id);
    this.urgent.set(id, smoothSeconds);
  }

  /**
   * Flush pending changes. Called on a slow timer: every system feeding this
   * router works in seconds or minutes, so recomputing at ~30 Hz is far more
   * resolution than any of them need, and it keeps the audio thread free of
   * per-frame parameter churn.
   */
  flush() {
    if (!this.dirty.size) return 0;
    let n = 0;
    for (const id of this.dirty) {
      const v = this.compute(id);
      const prev = this.effective.get(id);
      this.effective.set(id, v);
      if (prev === undefined || Math.abs(prev - v) > 1e-9) {
        const smooth = this.urgent.has(id) ? this.urgent.get(id) : this.smooth.get(id);
        if (this.onApply) this.onApply(id, v, smooth);
        n++;
      }
    }
    this.dirty.clear();
    this.urgent.clear();
    return n;
  }

  /** Effective value for the UI, falling back to the base when untouched. */
  valueFor(id) {
    if (this.offsets.has(id)) {
      if (!this.effective.has(id)) this.effective.set(id, this.compute(id));
      return this.effective.get(id);
    }
    return Number(this.store.get(id));
  }
}
