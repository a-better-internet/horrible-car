// Parameter state, independent of the audio engine.
//
// The UI is live before any AudioContext exists (browsers only allow one after
// a gesture), so parameter values live here and the engine, once built, reads
// the whole store and catches up. That also means presets, randomisation, the
// memory system and the macro matrix all speak one language: set a value here.

import { BY_ID, defaults, quantise, clamp } from './params.js';

export class Store {
  constructor(initial = defaults()) {
    this.values = { ...initial };
    this.listeners = new Set();
    this.engine = null;
  }

  get(id) {
    return this.values[id];
  }

  /** Coerce a raw value to whatever the parameter's type and range allow. */
  coerce(id, value) {
    const p = BY_ID[id];
    if (!p) return value;
    if (p.type === 'bool') return !!value;
    if (p.type === 'enum') {
      return p.options.some((o) => o.value === value) ? value : p.def;
    }
    const n = Number(value);
    if (!Number.isFinite(n)) return p.def;
    return quantise(p, n);
  }

  set(id, value, opts = {}) {
    const p = BY_ID[id];
    if (!p) return;
    const v = this.coerce(id, value);
    const changed = this.values[id] !== v;
    if (!changed && !opts.force) return;
    this.values[id] = v;
    if (this.engine) this.engine.apply(id, v, opts.smooth);
    for (const fn of this.listeners) fn(id, v, opts);
  }

  /** Apply many values as one update — used by presets, recall and morphing. */
  batch(obj, opts = {}) {
    for (const id of Object.keys(obj)) {
      if (BY_ID[id]) this.set(id, obj[id], opts);
    }
  }

  snapshot(filter) {
    const out = {};
    for (const id of Object.keys(this.values)) {
      if (!filter || filter(BY_ID[id])) out[id] = this.values[id];
    }
    return out;
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  attach(engine) {
    this.engine = engine;
    for (const id of Object.keys(this.values)) engine.apply(id, this.values[id]);
  }
}

export { clamp };
