// Builds the panel grid from the layout, and the handful of widgets that are
// more than a row of controls.

import { BY_ID, PARAMS, format, toNorm, fromNorm, clamp, xyLabel } from '../params.js';
import { TABS } from './layout.js';
import { Control } from './control.js';
import { MACRO_IDS } from '../macros.js';

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

function button(label, className = 'btn') {
  const b = el('button', className, label);
  b.type = 'button';
  return b;
}

/** Every modulatable numeric parameter, grouped by the tab it lives in. */
function paramOptionGroups() {
  const groups = [];
  const seen = new Set();
  for (const tab of TABS) {
    const items = [];
    for (const panel of tab.panels) {
      for (const id of panel.controls || []) {
        const p = BY_ID[id];
        if (!p || p.type !== 'num' || !p.mod || seen.has(id)) continue;
        seen.add(id);
        items.push({ id, label: `${panel.title} · ${p.label}` });
      }
    }
    if (items.length) groups.push({ label: tab.label, items });
  }
  return groups;
}

function paramSelect(value, onChange, { allowNone = true, label = null } = {}) {
  const sel = el('select', 'ctl__select');
  if (label) sel.setAttribute('aria-label', label);
  if (allowNone) {
    const none = el('option', null, '— none —');
    none.value = '';
    sel.append(none);
  }
  for (const group of paramOptionGroups()) {
    const g = document.createElement('optgroup');
    g.label = group.label;
    for (const item of group.items) {
      const o = el('option', null, item.label);
      o.value = item.id;
      g.append(o);
    }
    sel.append(g);
  }
  sel.value = value || '';
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

// ---------------------------------------------------------------------------

export class PanelBuilder {
  constructor(app) {
    this.app = app;
    this.controls = new Map();   // paramId -> Control[]
    this.widgets = {};
  }

  addControl(paramId, opts) {
    const c = new Control(paramId, opts);
    c.onInput = (id, value) => this.app.setParam(id, value, 'ui');
    const list = this.controls.get(paramId) || [];
    list.push(c);
    this.controls.set(paramId, list);
    return c;
  }

  build(container, hasWorklets) {
    container.innerHTML = '';
    const tabPanels = {};
    for (const tab of TABS) {
      const section = el('section', 'tab-panel');
      section.id = `tab-${tab.id}`;
      section.setAttribute('role', 'tabpanel');
      section.setAttribute('aria-labelledby', `tabbtn-${tab.id}`);
      section.hidden = true;

      if (tab.hint) section.append(el('p', 'tab-hint', tab.hint));

      const grid = el('div', 'panel-grid');
      for (const panel of tab.panels) grid.append(this.buildPanel(panel, hasWorklets));
      section.append(grid);
      container.append(section);
      tabPanels[tab.id] = section;
    }
    return tabPanels;
  }

  buildPanel(panel, hasWorklets) {
    const box = el('article', 'panel');
    if (panel.span) box.classList.add(`panel--span${panel.span}`);
    const unavailable = panel.requires === 'worklets' && !hasWorklets;
    if (unavailable) box.classList.add('is-unavailable');

    const head = el('header', 'panel__head');
    head.append(el('h3', 'panel__title', panel.title));
    if (panel.led) {
      const led = el('i', 'led');
      led.dataset.led = panel.led;
      head.append(led);
    }
    box.append(head);

    if (unavailable) {
      box.append(el('p', 'panel__note panel__note--warn',
        'Needs AudioWorklet, which this browser did not provide. Every other module still works.'));
    } else if (panel.note) {
      box.append(el('p', 'panel__note', panel.note));
    }

    if (panel.meter) {
      const m = el('div', 'panel__meter');
      m.dataset.meter = panel.meter;
      m.append(el('i', 'panel__meter-fill'));
      box.append(m);
    }

    const rows = el('div', 'panel__rows');
    for (const id of panel.controls || []) {
      rows.append(this.addControl(id).el);
    }
    box.append(rows);

    for (const key of panel.extras || []) {
      const w = this[`widget_${key.replace(/-/g, '_')}`];
      if (w) box.append(w.call(this));
    }
    return box;
  }

  // -------------------------------------------------------------------------
  // Widgets
  // -------------------------------------------------------------------------

  widget_seq_depths() {
    const wrap = el('div', 'subgroup');
    wrap.append(el('h4', 'subgroup__title', 'Destinations'));
    const rows = el('div', 'panel__rows');
    for (const id of ['seqAmtFilter', 'seqAmtRing', 'seqAmtPitch', 'seqAmtPW']) {
      rows.append(this.addControl(id).el);
    }
    wrap.append(rows);
    return wrap;
  }

  widget_seq_steps() {
    const wrap = el('div', 'subgroup');
    wrap.append(el('h4', 'subgroup__title', 'Steps'));
    const grid = el('div', 'seq-steps');
    for (let i = 0; i < 8; i++) {
      const cell = el('div', 'seq-step');
      cell.dataset.step = String(i);
      cell.append(this.addControl(`seqStep${i}`, { compact: true }).el);
      grid.append(cell);
    }
    wrap.append(grid);
    const actions = el('div', 'btn-row');
    const rand = button('Randomise steps');
    rand.addEventListener('click', () => this.app.randomiseSteps());
    const reset = button('Reset');
    reset.addEventListener('click', () => this.app.resetSteps());
    actions.append(rand, reset);
    wrap.append(actions);
    this.widgets.seqSteps = grid;
    return wrap;
  }

  widget_evolve_actions() {
    const row = el('div', 'btn-row');
    const now = button('Evolve now', 'btn btn--primary');
    now.addEventListener('click', () => this.app.evolveNow());
    const undo = button('Undo last');
    undo.addEventListener('click', () => this.app.undoEvolve());
    const anchor = button('Re-anchor here');
    anchor.title = 'Make the current patch the one evolution orbits.';
    anchor.addEventListener('click', () => this.app.anchorEvolve());
    row.append(now, undo, anchor);

    const status = el('p', 'panel__status');
    status.dataset.status = 'evolve';
    const wrap = el('div', 'subgroup');
    wrap.append(row, status);
    return wrap;
  }

  widget_plate_timeline() {
    const wrap = el('div', 'timeline');
    for (const name of ['harmonic', 'timbral', 'spatial']) {
      const row = el('div', 'timeline__row');
      row.dataset.plate = name;
      row.append(el('span', 'timeline__label', name[0].toUpperCase() + name.slice(1)));
      const bar = el('div', 'timeline__bar');
      bar.append(el('i', 'timeline__progress'));
      bar.append(el('i', 'timeline__cursor'));
      row.append(bar);
      row.append(el('span', 'timeline__readout', '—'));
      wrap.append(row);
    }
    this.widgets.timeline = wrap;
    return wrap;
  }

  widget_memory_actions() {
    const wrap = el('div', 'subgroup');
    const row = el('div', 'btn-row');
    const snap = button('Take snapshot', 'btn btn--primary');
    snap.addEventListener('click', () => this.app.memorySnapshot());
    const recall = button('Recall random');
    recall.addEventListener('click', () => this.app.memoryRecall());
    const clear = button('Clear');
    clear.addEventListener('click', () => this.app.memoryClear());
    row.append(snap, recall, clear);
    wrap.append(row);

    const list = el('ol', 'memory-list');
    list.setAttribute('aria-label', 'Stored snapshots');
    wrap.append(list);
    const status = el('p', 'panel__status');
    status.dataset.status = 'memory';
    wrap.append(status);
    this.widgets.memoryList = list;
    return wrap;
  }

  widget_macro_bank() {
    const bank = el('div', 'macro-bank');
    for (const id of MACRO_IDS) {
      const cell = el('div', 'macro');
      const knob = this.addControl(id, { variant: 'knob', label: `Macro ${id.slice(-1)}` });
      cell.append(knob.el);

      const slots = el('div', 'macro__slots');
      for (let slot = 0; slot < 3; slot++) {
        const row = el('div', 'macro__slot');
        const assigned = (this.app.macros.assignments[id] || [])[slot];
        if (!assigned) row.classList.add('is-empty');
        const sel = paramSelect(assigned ? assigned.id : '', (value) => {
          this.app.assignMacro(id, slot, value);
          depth.disabled = !value;
          row.classList.toggle('is-empty', !value);
        }, { label: `Macro ${id.slice(-1)} slot ${slot + 1} target` });
        row.append(sel);

        const depth = el('input', 'macro__depth');
        depth.type = 'range';
        depth.min = '-1';
        depth.max = '1';
        depth.step = '0.05';
        depth.value = String(assigned ? assigned.depth : 0.8);
        depth.setAttribute('aria-label', `Macro ${id.slice(-1)} slot ${slot + 1} depth`);
        depth.disabled = !assigned;
        const read = el('span', 'macro__depth-value');
        const showDepth = () => {
          const v = Number(depth.value);
          read.textContent = `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
        };
        depth.addEventListener('input', () => {
          this.app.setMacroDepth(id, slot, Number(depth.value));
          showDepth();
        });
        showDepth();
        row.append(depth, read);
        slots.append(row);
      }
      cell.append(slots);
      bank.append(cell);
    }
    return bank;
  }

  widget_xy_pad() {
    const wrap = el('div', 'xy');
    const pad = el('div', 'xy__pad');
    pad.tabIndex = 0;
    pad.setAttribute('role', 'application');
    pad.setAttribute('aria-label', 'XY performance pad');
    pad.innerHTML = '<i class="xy__cross-h"></i><i class="xy__cross-v"></i><i class="xy__cursor"></i>';
    const cursor = pad.querySelector('.xy__cursor');
    const crossH = pad.querySelector('.xy__cross-h');
    const crossV = pad.querySelector('.xy__cross-v');

    const readout = el('div', 'xy__readout');
    readout.innerHTML = '<span data-xy="x"></span><span data-xy="y"></span>';

    let active = false;
    const at = (e) => {
      const r = pad.getBoundingClientRect();
      const x = clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1);
      const y = clamp(1 - (e.clientY - r.top) / Math.max(1, r.height), 0, 1);
      this.app.setXY(x, y);
    };
    pad.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      active = true;
      pad.setPointerCapture(e.pointerId);
      pad.classList.add('is-active');
      pad.focus({ preventScroll: true });
      at(e);
    });
    pad.addEventListener('pointermove', (e) => { if (active) at(e); });
    const stop = (e) => {
      if (!active) return;
      active = false;
      pad.classList.remove('is-active');
      try { pad.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    };
    pad.addEventListener('pointerup', stop);
    pad.addEventListener('pointercancel', stop);
    // Keyboard-reachable, which the prototype's mouse-only pad was not.
    pad.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.01 : 0.05;
      const x = Number(this.app.store.get('xyX'));
      const y = Number(this.app.store.get('xyY'));
      const moves = {
        ArrowLeft: [x - step, y], ArrowRight: [x + step, y],
        ArrowDown: [x, y - step], ArrowUp: [x, y + step],
      };
      const m = moves[e.key];
      if (!m) return;
      e.preventDefault();
      this.app.setXY(clamp(m[0], 0, 1), clamp(m[1], 0, 1));
    });

    wrap.append(pad, readout);
    this.widgets.xy = { pad, cursor, crossH, crossV, readout };
    return wrap;
  }

  widget_signal_path() {
    const wrap = el('div', 'flow');
    const stages = [
      ['Voices', 'five oscillators, supersaw, radio'],
      ['Inserts', 'drive · drive · tilt · tremolo'],
      ['Sends', 'reverb · delay · shimmer · harmonizer · chorus · wow · granular · haze · sub'],
      ['Ring', 'dry / wet crossfade'],
      ['Filter', 'multi-mode, modulated in cents'],
      ['Width', 'mid / side'],
      ['Gate', 'probability'],
      ['Breath', 'slow amplitude'],
      ['Master', 'DC block · level · limiter'],
    ];
    for (const [name, detail] of stages) {
      const s = el('div', 'flow__stage');
      s.append(el('span', 'flow__name', name));
      s.append(el('span', 'flow__detail', detail));
      wrap.append(s);
    }
    return wrap;
  }
}

export { el, button, paramSelect, paramOptionGroups };
