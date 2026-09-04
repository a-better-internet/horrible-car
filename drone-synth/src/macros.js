// Macros: one control moving several parameters at once.
//
// The prototype's four macros were hardcoded and absolute — macro 1 wrote the
// filter cutoff to `100 + value × 9900`, so touching it at rest slammed the
// cutoff to 100 Hz regardless of where the patch had it. A macro that
// destroys the patch the instant you touch it is not usable in performance.
//
// Here a macro is a relative offset in slider space. When it leaves zero it
// anchors on the values the parameters already have, and returning it to zero
// puts them back exactly.

import { BY_ID, toNorm, fromNorm, clamp, xyLabel } from './params.js';

export const DEFAULT_ASSIGNMENTS = {
  macro1: [{ id: 'filterFreq', depth: 0.85 }, { id: 'reverb', depth: 0.5 }],
  macro2: [{ id: 'ringModDepth', depth: 0.8 }, { id: 'distortion', depth: 0.6 }],
  macro3: [{ id: 'lfoDepth', depth: 0.75 }, { id: 'tremolo', depth: 0.5 }],
  macro4: [{ id: 'delayMix', depth: 0.8 }, { id: 'delayFeedback', depth: 0.7 }],
};

export const MACRO_IDS = ['macro1', 'macro2', 'macro3', 'macro4'];

export class MacroMatrix {
  constructor(store) {
    this.store = store;
    this.assignments = JSON.parse(JSON.stringify(DEFAULT_ASSIGNMENTS));
    this.anchors = {};
    this.last = { macro1: 0, macro2: 0, macro3: 0, macro4: 0 };
    this.applying = false;
  }

  setAssignments(next) {
    if (!next) return;
    for (const id of MACRO_IDS) {
      if (!Array.isArray(next[id])) continue;
      this.assignments[id] = next[id]
        .filter((t) => t && BY_ID[t.id] && BY_ID[t.id].type === 'num')
        .slice(0, 4)
        .map((t) => ({ id: t.id, depth: clamp(Number(t.depth) || 0, -1, 1) }));
      delete this.anchors[id];
    }
  }

  assign(macroId, slot, paramId, depth = 0.8) {
    const list = this.assignments[macroId] || (this.assignments[macroId] = []);
    if (!paramId) list.splice(slot, 1);
    else if (BY_ID[paramId] && BY_ID[paramId].type === 'num') list[slot] = { id: paramId, depth };
    // Re-anchor: the macro's current position now means something different.
    delete this.anchors[macroId];
    this.apply(macroId, Number(this.store.get(macroId)));
  }

  setDepth(macroId, slot, depth) {
    const t = (this.assignments[macroId] || [])[slot];
    if (!t) return;
    t.depth = clamp(Number(depth) || 0, -1, 1);
    this.apply(macroId, Number(this.store.get(macroId)));
  }

  /** Capture where every target sits, so the macro can move relative to it. */
  anchor(macroId) {
    const a = {};
    for (const t of this.assignments[macroId] || []) {
      const p = BY_ID[t.id];
      if (p) a[t.id] = toNorm(p, Number(this.store.get(t.id)));
    }
    this.anchors[macroId] = a;
    return a;
  }

  apply(macroId, value) {
    const targets = this.assignments[macroId] || [];
    if (!targets.length) return;
    const v = clamp(Number(value) || 0, 0, 1);
    // Anchoring on the way up out of zero is what makes the control feel like
    // a hardware macro: it adds to the patch rather than replacing it.
    if (v > 0 && this.last[macroId] <= 0) this.anchor(macroId);
    if (!this.anchors[macroId]) this.anchor(macroId);
    const anchors = this.anchors[macroId];
    this.applying = true;
    try {
      for (const t of targets) {
        const p = BY_ID[t.id];
        if (!p) continue;
        const base = anchors[t.id] !== undefined ? anchors[t.id] : toNorm(p, Number(this.store.get(t.id)));
        this.store.set(t.id, fromNorm(p, clamp(base + v * t.depth, 0, 1)), { smooth: 0.05 });
      }
    } finally {
      this.applying = false;
    }
    this.last[macroId] = v;
    if (v <= 0) delete this.anchors[macroId];
  }

  /**
   * A target moved by something other than this macro invalidates the anchor;
   * otherwise the next macro move would drag it back to a stale position.
   */
  invalidate(paramId) {
    if (this.applying) return;
    for (const id of MACRO_IDS) {
      const a = this.anchors[id];
      if (a && a[paramId] !== undefined && Number(this.store.get(id)) <= 0) delete this.anchors[id];
    }
  }

  describe(macroId) {
    return (this.assignments[macroId] || [])
      .map((t) => `${xyLabel(t.id)}${t.depth < 0 ? ' ↓' : ''}`)
      .join(' · ') || 'unassigned';
  }

  toJSON() {
    return JSON.parse(JSON.stringify(this.assignments));
  }
}

/**
 * The XY pad writes absolute values across each target's full range. That is
 * what a performance surface should do — a position on the pad is a sound,
 * and the same position always gives the same sound.
 */
export function applyXY(store, x, y) {
  const write = (paramId, norm) => {
    const p = BY_ID[paramId];
    if (!p || p.type !== 'num') return;
    store.set(paramId, fromNorm(p, clamp(norm, 0, 1)), { smooth: 0.04 });
  };
  write(store.get('xyParamX'), x);
  write(store.get('xyParamY'), y);
}
