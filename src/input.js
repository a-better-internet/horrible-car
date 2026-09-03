/*
 * Input.
 *
 * The arcade cabinet had an analog steering wheel (a quadrature encoder read
 * as left=0x7F / centre=0x3F / right=0x00), a one-sided analog gas pedal on
 * ADC channel 3, and two buttons -- trigger and thumb.  We present exactly
 * that shape to the game: a continuous `steer` in [-1,1], a continuous
 * `throttle` in [0,1], a `brake`, and two action buttons.
 *
 * Keyboard is ramped into the analog range rather than jumping to full lock,
 * so a keyboard player gets something close to wheel feel.  A mouse or an
 * analog stick drives `steer` directly, which is how the MiSTer core exposes
 * "wheel mode" for this game.
 */

import { clamp, approach } from './util.js';
import { WHEEL_ACCEL, WHEEL_RETURN } from './config.js';

/** Keys we own; the browser must not scroll or search when they are pressed. */
const OWNED = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'Enter', 'NumpadEnter', 'ShiftLeft', 'ShiftRight',
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyZ', 'KeyX', 'KeyC', 'KeyP', 'KeyM', 'KeyF',
  'Tab', 'Backspace', "Quote", 'Slash',
]);

export class Input {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();

    // Analog outputs, the only thing the game reads.
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;

    // Held buttons.
    this.fire = false;
    this.special = false;

    // Latched edges, cleared once per rendered frame by endFrame().
    this.edges = {
      start: false, pause: false, mute: false, fullscreen: false,
      fire: false, special: false, nitro: false, debug: false, any: false,
    };

    /** Pointer steering ("wheel mode"), enabled by moving the mouse. */
    this.wheelMode = false;
    this.pointerSteer = 0;
    this.pointerFire = false;
    this.gamepadIndex = null;

    this._bind();
  }

  _bind() {
    const onKeyDown = (e) => {
      if (e.repeat) {
        if (OWNED.has(e.code)) e.preventDefault();
        return;
      }
      if (OWNED.has(e.code)) e.preventDefault();
      this.keys.add(e.code);
      this.edges.any = true;

      switch (e.code) {
        case 'Enter': case 'NumpadEnter': this.edges.start = true; break;
        case 'KeyP': this.edges.pause = true; break;
        case 'Escape': this.edges.pause = true; break;
        case 'KeyM': this.edges.mute = true; break;
        case 'KeyF': this.edges.fullscreen = true; break;
        case 'Space': case 'KeyZ': this.edges.fire = true; break;
        case 'ShiftLeft': case 'ShiftRight': case 'KeyX': this.edges.special = true; break;
        case 'KeyC': this.edges.nitro = true; break;
        case 'Backquote': this.edges.debug = true; break;
        default: break;
      }
      // Any keyboard steering input takes control back from the mouse.
      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight'
          || e.code === 'KeyA' || e.code === 'KeyD') {
        this.wheelMode = false;
      }
    };

    const onKeyUp = (e) => {
      if (OWNED.has(e.code)) e.preventDefault();
      this.keys.delete(e.code);
    };

    // Releasing everything on blur prevents the classic "stuck throttle after
    // alt-tab" bug: keyup never fires for a window that lost focus.
    const releaseAll = () => {
      this.keys.clear();
      this.pointerFire = false;
    };

    window.addEventListener('keydown', onKeyDown, { passive: false });
    window.addEventListener('keyup', onKeyUp, { passive: false });
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) releaseAll();
    });

    // ---- pointer as steering wheel -------------------------------------
    const pointerX = (e) => {
      const r = this.canvas.getBoundingClientRect();
      if (r.width <= 0) return 0;
      return clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1);
    };
    this.canvas.addEventListener('pointermove', (e) => {
      // A dead zone in the middle keeps the van from twitching when the
      // pointer merely passes over the screen.
      const x = pointerX(e);
      this.pointerSteer = Math.abs(x) < 0.04 ? 0 : clamp(x * 1.25, -1, 1);
      this.wheelMode = true;
      this.edges.any = true;
    });
    this.canvas.addEventListener('pointerdown', (e) => {
      this.canvas.focus();
      this.pointerSteer = clamp(pointerX(e) * 1.25, -1, 1);
      this.wheelMode = true;
      if (e.button === 0) { this.pointerFire = true; this.edges.fire = true; }
      if (e.button === 2) { this.edges.special = true; }
      this.edges.any = true;
      e.preventDefault();
    });
    const up = (e) => { if (e.button === 0) this.pointerFire = false; };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('gamepadconnected', (e) => {
      if (this.gamepadIndex === null) this.gamepadIndex = e.gamepad.index;
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.gamepadIndex === e.gamepad.index) this.gamepadIndex = null;
    });
  }

  _held(...codes) { return codes.some((c) => this.keys.has(c)); }

  /** Read the active gamepad, if any.  Returns null when there isn't one. */
  _gamepad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    if (!pads) return null;
    // Re-acquire lazily: some browsers only populate pads after a button press.
    if (this.gamepadIndex === null) {
      for (const p of pads) if (p && p.connected) { this.gamepadIndex = p.index; break; }
    }
    const pad = this.gamepadIndex === null ? null : pads[this.gamepadIndex];
    return pad && pad.connected ? pad : null;
  }

  /**
   * Advance the analog model.  Call once per simulation step with the fixed
   * dt so wheel ramping is framerate-independent.
   */
  update(dt) {
    const pad = this._gamepad();

    // ---- steering -------------------------------------------------------
    let target = 0;
    let analogDirect = false;

    const kLeft = this._held('ArrowLeft', 'KeyA');
    const kRight = this._held('ArrowRight', 'KeyD');
    if (kLeft !== kRight) target = kLeft ? -1 : 1;

    if (pad) {
      const ax = pad.axes.length > 0 ? pad.axes[0] : 0;
      if (Math.abs(ax) > 0.14) {
        this.steer = clamp(ax, -1, 1);
        analogDirect = true;
        this.wheelMode = false;
      } else if (target === 0 && Math.abs(ax) <= 0.14 && !this.wheelMode) {
        // Stick centred: fall through to the ramp so we return to centre.
      }
      if (pad.buttons[14] && pad.buttons[14].pressed) target = -1;
      if (pad.buttons[15] && pad.buttons[15].pressed) target = 1;
    }

    if (!analogDirect) {
      if (this.wheelMode && target === 0) {
        this.steer = this.pointerSteer;
      } else {
        // Ramp toward full lock, spring back to centre faster than you can
        // turn in -- that is roughly how a self-centring wheel behaves.
        const rate = target === 0 ? WHEEL_RETURN : WHEEL_ACCEL;
        this.steer = approach(this.steer, target, rate, dt);
      }
    }
    this.steer = clamp(this.steer, -1, 1);

    // ---- pedals ---------------------------------------------------------
    // The cabinet's pedal was a pot: we model travel rather than a switch, so
    // feathering the throttle is possible from the keyboard too.
    let throttleTarget = this._held('ArrowUp', 'KeyW') ? 1 : 0;
    let brakeTarget = this._held('ArrowDown', 'KeyS') ? 1 : 0;
    if (pad) {
      const rt = pad.buttons[7] ? pad.buttons[7].value : 0;
      const lt = pad.buttons[6] ? pad.buttons[6].value : 0;
      if (rt > 0.05) throttleTarget = Math.max(throttleTarget, rt);
      if (lt > 0.05) brakeTarget = Math.max(brakeTarget, lt);
      if (pad.buttons[0] && pad.buttons[0].pressed) throttleTarget = 1;
    }
    this.throttle = approach(this.throttle, throttleTarget, 5.5, dt);
    this.brake = approach(this.brake, brakeTarget, 8.0, dt);

    // ---- buttons --------------------------------------------------------
    const padFire = pad && ((pad.buttons[2] && pad.buttons[2].pressed)
      || (pad.buttons[5] && pad.buttons[5].pressed));
    const padSpecial = pad && (pad.buttons[1] && pad.buttons[1].pressed);
    const padNitro = pad && (pad.buttons[3] && pad.buttons[3].pressed);

    const fireNow = this._held('Space', 'KeyZ') || this.pointerFire || !!padFire;
    const specialNow = this._held('ShiftLeft', 'ShiftRight', 'KeyX') || !!padSpecial;

    if (padNitro && !this._padNitroPrev) this.edges.nitro = true;
    this._padNitroPrev = !!padNitro;

    if (padFire && !this._padFirePrev) this.edges.fire = true;
    if (padSpecial && !this._padSpecialPrev) this.edges.special = true;
    if (pad && pad.buttons[9] && pad.buttons[9].pressed && !this._padStartPrev) {
      this.edges.start = true;
    }
    this._padFirePrev = !!padFire;
    this._padSpecialPrev = !!padSpecial;
    this._padStartPrev = !!(pad && pad.buttons[9] && pad.buttons[9].pressed);

    this.fire = fireNow;
    this.special = specialNow;
  }

  /**
   * Read and clear one latched edge.
   *
   * The simulation runs several fixed steps per rendered frame, so an edge
   * that merely stayed `true` for the whole frame would fire once per step --
   * three cruise missiles for one keypress.  Consuming is how a step claims
   * an edge for itself.
   * @param {keyof Input['edges']} name
   */
  consume(name) {
    if (!this.edges[name]) return false;
    this.edges[name] = false;
    return true;
  }

  /** Clear latched edges.  Call once per rendered frame, after game logic. */
  endFrame() {
    const e = this.edges;
    e.start = e.pause = e.mute = e.fullscreen = false;
    e.fire = e.special = e.nitro = e.debug = e.any = false;
  }
}
