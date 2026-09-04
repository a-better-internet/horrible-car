// The control primitive.
//
// Every parameter in the instrument is one of these. The prototype used bare
// `<input type=range>` elements with the browser's appearance stripped off,
// which cost it four things worth having back:
//
//   * a value readout — a synthesiser whose cutoff knob shows no number is
//     guessing, and the prototype showed none anywhere;
//   * a musical taper — its frequency sliders were linear, so on a
//     100 Hz–10 kHz control everything below 1 kHz lived in the first 9% of
//     the travel;
//   * keyboard and pointer precision — no fine-drag, no arrow keys, no
//     double-click-to-default, and a global `outline: none` that removed the
//     focus ring browsers draw for people navigating without a mouse;
//   * any indication that something else was moving the value. Six automated
//     systems could be driving a knob and the knob would not move.
//
// The last one is why each track draws two things: the base value you set,
// and — in the warm accent reserved for it — where the instrument has
// currently pushed it.

import { BY_ID, toNorm, fromNorm, format, clamp, quantise } from '../params.js';

const FINE = 0.25;
const COARSE_STEP = 0.02;

function originNorm(p) {
  // Bipolar controls fill outward from the centre; unipolar ones from the left.
  return p.min < 0 && p.max > 0 ? toNorm(p, 0) : 0;
}

export class Control {
  constructor(paramId, { variant = 'bar', label = null, compact = false } = {}) {
    this.p = BY_ID[paramId];
    if (!this.p) throw new Error(`No such parameter: ${paramId}`);
    this.id = paramId;
    this.variant = this.p.type === 'bool' ? 'switch'
      : this.p.type === 'enum' ? (this.p.options.length <= 5 ? 'segment' : 'select')
        : variant;
    this.labelText = label || this.p.label;
    this.compact = compact;
    this.onInput = null;
    this.dragging = false;
    this.el = this._build();
  }

  // -------------------------------------------------------------------------

  _build() {
    const root = document.createElement('div');
    root.className = `ctl ctl--${this.variant}${this.compact ? ' ctl--compact' : ''}`;
    root.dataset.param = this.id;

    const label = document.createElement('span');
    label.className = 'ctl__label';
    label.textContent = this.labelText;
    label.id = `lbl-${this.id}`;
    this.labelEl = label;

    if (this.variant === 'switch') return this._buildSwitch(root, label);
    if (this.variant === 'segment') return this._buildSegment(root, label);
    if (this.variant === 'select') return this._buildSelect(root, label);
    if (this.variant === 'knob') return this._buildKnob(root, label);
    return this._buildBar(root, label);
  }

  _valueEl() {
    const v = document.createElement('span');
    v.className = 'ctl__value';
    this.valueEl = v;
    return v;
  }

  _buildBar(root, label) {
    const track = document.createElement('div');
    track.className = 'ctl__track';
    track.tabIndex = 0;
    track.setAttribute('role', 'slider');
    track.setAttribute('aria-labelledby', label.id);

    track.innerHTML = '<i class="ctl__fill"></i><i class="ctl__mod"></i><i class="ctl__thumb"></i>';
    this.fill = track.querySelector('.ctl__fill');
    this.mod = track.querySelector('.ctl__mod');
    this.thumb = track.querySelector('.ctl__thumb');
    this.track = track;

    root.append(label, track, this._valueEl());
    this._wirePointer(track);
    this._wireKeys(track);
    return root;
  }

  _buildKnob(root, label) {
    const wrap = document.createElement('div');
    wrap.className = 'ctl__dial';
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'slider');
    wrap.setAttribute('aria-labelledby', label.id);
    // 270° of travel starting at the 7-o'clock position, the convention every
    // hardware knob follows and therefore the one people already read.
    wrap.innerHTML = `
      <svg viewBox="0 0 48 48" aria-hidden="true">
        <path class="dial__bg" d="M10.3 37.7 A19 19 0 1 1 37.7 37.7" />
        <path class="dial__val" d="M10.3 37.7 A19 19 0 1 1 37.7 37.7" />
        <path class="dial__mod" d="M10.3 37.7 A19 19 0 1 1 37.7 37.7" />
        <line class="dial__pointer" x1="24" y1="24" x2="24" y2="8" />
      </svg>`;
    this.dialVal = wrap.querySelector('.dial__val');
    this.dialMod = wrap.querySelector('.dial__mod');
    this.dialPointer = wrap.querySelector('.dial__pointer');
    this.track = wrap;
    // 19px radius over 270° of a circle whose full circumference is 2πr.
    this.dialLength = 2 * Math.PI * 19 * 0.75;
    for (const el of [this.dialVal, this.dialMod]) {
      el.style.strokeDasharray = `${this.dialLength} ${this.dialLength * 2}`;
    }
    root.append(wrap, label, this._valueEl());
    this._wirePointer(wrap, 'vertical');
    this._wireKeys(wrap);
    return root;
  }

  _buildSwitch(root, label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ctl__switch';
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-labelledby', label.id);
    btn.innerHTML = '<i class="ctl__knob"></i>';
    btn.addEventListener('click', () => this._emit(!this.value));
    this.switchEl = btn;
    root.append(label, btn, this._valueEl());
    return root;
  }

  _buildSegment(root, label) {
    // Five options in a 200px row truncates every label to "Sawto…". Above
    // three, the label moves to its own line and the buttons get the width.
    if (this.p.options.length > 3) root.classList.add('ctl--stacked');
    const group = document.createElement('div');
    group.className = 'ctl__segment';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-labelledby', label.id);
    this.segButtons = [];
    for (const opt of this.p.options) {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.textContent = opt.label;
      b.title = opt.full || opt.label;
      b.addEventListener('click', () => this._emit(opt.value));
      group.append(b);
      this.segButtons.push({ button: b, value: opt.value });
    }
    root.append(label, group);
    return root;
  }

  _buildSelect(root, label) {
    const sel = document.createElement('select');
    sel.className = 'ctl__select';
    sel.setAttribute('aria-labelledby', label.id);
    for (const opt of this.p.options) {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      sel.append(o);
    }
    sel.addEventListener('change', () => this._emit(sel.value));
    this.selectEl = sel;
    root.append(label, sel);
    return root;
  }

  // -------------------------------------------------------------------------
  // Interaction
  // -------------------------------------------------------------------------

  _wirePointer(el, axis = 'horizontal') {
    let startNorm = 0;
    let startX = 0;
    let startY = 0;
    let moved = false;

    const move = (e) => {
      if (!this.dragging) return;
      const fine = e.shiftKey ? FINE : 1;
      let next;
      if (axis === 'vertical') {
        // Dials are dragged, never rotated to the pointer: a rotate-to-cursor
        // knob jumps to wherever you grabbed it.
        const dy = startY - e.clientY;
        const dx = e.clientX - startX;
        next = startNorm + ((dy + dx) / 160) * fine;
      } else if (e.shiftKey) {
        next = startNorm + ((e.clientX - startX) / this.track.getBoundingClientRect().width) * fine;
      } else {
        const r = this.track.getBoundingClientRect();
        next = (e.clientX - r.left) / Math.max(1, r.width);
      }
      if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) > 2) moved = true;
      this._emitNorm(next);
    };

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      el.focus({ preventScroll: true });
      this.dragging = true;
      moved = false;
      startX = e.clientX;
      startY = e.clientY;
      startNorm = toNorm(this.p, this.value);
      el.setPointerCapture(e.pointerId);
      el.classList.add('is-dragging');
      // A plain click on a bar jumps to the position; a shift-click starts a
      // relative fine drag from where the value already is.
      if (axis === 'horizontal' && !e.shiftKey) move(e);
    });
    el.addEventListener('pointermove', move);
    const end = (e) => {
      if (!this.dragging) return;
      this.dragging = false;
      el.classList.remove('is-dragging');
      try { el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      if (this.onCommit) this.onCommit(this.id, this.value, moved);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);

    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const step = (e.shiftKey ? COARSE_STEP * FINE : COARSE_STEP) * (e.deltaY < 0 ? 1 : -1);
      this._emitNorm(toNorm(this.p, this.value) + step);
    }, { passive: false });

    el.addEventListener('dblclick', (e) => {
      e.preventDefault();
      this._emit(this.p.def);
    });
  }

  _wireKeys(el) {
    el.addEventListener('keydown', (e) => {
      const fine = e.shiftKey ? FINE : 1;
      let delta = 0;
      switch (e.key) {
        case 'ArrowRight': case 'ArrowUp': delta = COARSE_STEP * fine; break;
        case 'ArrowLeft': case 'ArrowDown': delta = -COARSE_STEP * fine; break;
        case 'PageUp': delta = COARSE_STEP * 5; break;
        case 'PageDown': delta = -COARSE_STEP * 5; break;
        case 'Home': e.preventDefault(); this._emit(this.p.min); return;
        case 'End': e.preventDefault(); this._emit(this.p.max); return;
        case 'Backspace': case 'Delete': e.preventDefault(); this._emit(this.p.def); return;
        default: return;
      }
      e.preventDefault();
      // Stepped parameters move by whole steps, so an arrow key on "Voices"
      // goes 5 -> 7 rather than nudging by an invisible fraction.
      if (this.p.step && (this.p.max - this.p.min) / this.p.step <= 64) {
        this._emit(this.value + Math.sign(delta) * this.p.step);
      } else {
        this._emitNorm(toNorm(this.p, this.value) + delta);
      }
    });
  }

  _emitNorm(norm) {
    this._emit(quantise(this.p, fromNorm(this.p, clamp(norm, 0, 1))));
  }

  _emit(value) {
    // Update the local value before dispatching. Key repeats and wheel ticks
    // arrive faster than the render loop, and reading the value back from the
    // last painted frame made every event after the first in a frame compute
    // the same target — so holding an arrow key moved the control at frame
    // rate rather than at key-repeat rate. render() corrects this against the
    // store on the next frame if anything clamped or quantised it.
    this.value = value;
    if (this.onInput) this.onInput(this.id, value);
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  /**
   * @param value      the base value — what the user set
   * @param effective  where automation currently has it, if anywhere
   * @param sources    names of the systems doing the moving, for the tooltip
   */
  render(value, effective = null, sources = null) {
    this.value = value;
    const p = this.p;

    if (this.variant === 'switch') {
      const on = !!value;
      this.switchEl.setAttribute('aria-checked', String(on));
      this.switchEl.classList.toggle('is-on', on);
      this.valueEl.textContent = on ? 'ON' : 'OFF';
      this.el.classList.toggle('is-active', on);
      return;
    }
    if (this.variant === 'segment') {
      for (const s of this.segButtons) {
        const on = s.value === value;
        s.button.classList.toggle('is-on', on);
        s.button.setAttribute('aria-checked', String(on));
        s.button.tabIndex = on ? 0 : -1;
      }
      return;
    }
    if (this.variant === 'select') {
      if (this.selectEl.value !== value) this.selectEl.value = value;
      return;
    }

    const baseN = toNorm(p, value);
    const modded = effective !== null && Math.abs(effective - value) > (p.max - p.min) * 1e-4;
    const effN = modded ? toNorm(p, effective) : baseN;
    const org = originNorm(p);

    this.valueEl.textContent = format(p, modded ? effective : value);
    this.valueEl.classList.toggle('is-modulated', modded);
    this.el.classList.toggle('is-modulated', modded);

    const target = this.track;
    target.setAttribute('aria-valuemin', String(p.min));
    target.setAttribute('aria-valuemax', String(p.max));
    target.setAttribute('aria-valuenow', String(value));
    target.setAttribute('aria-valuetext', modded
      ? `${format(p, value)}, currently ${format(p, effective)}`
      : format(p, value));
    if (modded && sources && sources.length) {
      target.title = `${this.labelText}: set to ${format(p, value)}, moved to ${format(p, effective)} by ${sources.join(', ')}`;
    } else if (target.title) {
      target.title = '';
    }

    if (this.variant === 'knob') {
      this.dialVal.style.strokeDashoffset = String(this.dialLength * (1 - baseN));
      this.dialPointer.style.transform = `rotate(${-135 + effN * 270}deg)`;
      this.dialMod.style.opacity = modded ? '1' : '0';
      if (modded) {
        const from = Math.min(baseN, effN);
        const span = Math.abs(effN - baseN);
        this.dialMod.style.strokeDasharray = `${this.dialLength * span} ${this.dialLength * 2}`;
        this.dialMod.style.strokeDashoffset = String(-this.dialLength * from);
      }
      return;
    }

    const lo = Math.min(org, baseN);
    this.fill.style.left = `${lo * 100}%`;
    this.fill.style.width = `${Math.abs(baseN - org) * 100}%`;
    this.thumb.style.left = `${effN * 100}%`;
    if (modded) {
      this.mod.style.opacity = '1';
      this.mod.style.left = `${Math.min(baseN, effN) * 100}%`;
      this.mod.style.width = `${Math.abs(effN - baseN) * 100}%`;
    } else {
      this.mod.style.opacity = '0';
      this.mod.style.width = '0%';
    }
  }
}
