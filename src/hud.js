/*
 * HUD and the between-play screens.
 *
 * Laid out for a 320x240 raster: everything is on integer pixel boundaries
 * and drawn with the 5x7 bitmap font, so nothing ever lands half a pixel off
 * once the buffer is scaled up.
 */

import * as K from './config.js';
import { UI, THEMES } from './palette.js';
import { clamp, commas, pad } from './util.js';
import { STATE } from './game.js';
import {
  text, textRight, textCentered, textCenteredShadow, textWidth,
} from './font.js';

// The HUD is drawn through a UI_SCALE transform, so it lays out in the
// original 320x240 arcade raster and comes out crisp at any multiple.
const W = K.BASE_W;
const H = K.BASE_H;

/** Horizontal bar with a border, used for fuel and stage progress. */
function bar(ctx, x, y, w, h, frac, fill, back, border) {
  ctx.fillStyle = border;
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = back;
  ctx.fillRect(x, y, w, h);
  const fw = Math.round(w * clamp(frac, 0, 1));
  if (fw > 0) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, fw, h);
  }
}

export class Hud {
  /** @param {CanvasRenderingContext2D} ctx */
  constructor(ctx) { this.ctx = ctx; }

  /** @param {import('./game.js').Game} g */
  render(g, paused) {
    switch (g.state) {
      case STATE.ATTRACT: this._attract(g); break;
      case STATE.READY: this._playHud(g); this._ready(g); break;
      case STATE.PLAY: this._playHud(g); break;
      case STATE.STAGE_END: this._playHud(g); this._stageEnd(g); break;
      case STATE.GAME_OVER: this._playHud(g); this._gameOver(g); break;
      default: break;
    }
    if (paused) this._paused();
  }

  // ------------------------------------------------------------- play HUD

  _playHud(g) {
    const ctx = this.ctx;

    // ---- panels ----------------------------------------------------------
    // Solid, not translucent: a readout you cannot read at 200 mph over a
    // bright road is not a readout.
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, 0, W, 19);
    ctx.fillRect(0, H - 26, W, 26);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, H - 52, 62, 26);
    ctx.fillStyle = UI.dim;
    ctx.fillRect(0, 19, W, 1);
    ctx.fillRect(0, H - 27, W, 1);

    text(ctx, 'SCORE', 4, 2, UI.grey, 1);
    text(ctx, commas(Math.floor(g.score)), 4, 10, UI.white, 1);

    textCentered(ctx, `STAGE ${pad(g.stage, 2)}/${K.TOTAL_STAGES}`, W / 2, 2, UI.grey, 1);
    textCentered(ctx, (g.track.name || '').slice(0, 18), W / 2, 10, UI.amber, 1);

    textRight(ctx, 'HI', W - 4, 2, UI.grey, 1);
    textRight(ctx, commas(Math.floor(g.highScore)), W - 4, 10, UI.yellow, 1);

    // ---- fuel ------------------------------------------------------------
    // Two tanks, as the cabinet showed them.  The reserve sits to the right
    // of the main gauge and only lights up when you are actually on it, so
    // the switchover is impossible to miss at 200 mph.
    const critical = g.onReserve || g.fuel < 18;
    const blink = critical && Math.floor(g.time * 8) % 2 === 0;
    const mainFrac = g.fuel / K.FUEL_MAX;
    const resFrac = g.reserve / K.RESERVE_MAX;
    const mainColor = g.fuel < 20 ? UI.amber : UI.green;
    const resColor = g.reserve < 10 ? UI.red : UI.amber;

    text(ctx, 'FUEL', 4, H - 22, blink ? UI.red : UI.grey, 1);
    text(ctx, `${pad(Math.ceil(g.totalFuel), 3)}`, 30, H - 22, blink ? UI.red : UI.white, 1);
    bar(ctx, 4, H - 12, 74, 7, mainFrac,
      g.onReserve ? UI.dim : (blink ? UI.white : mainColor), '#000', UI.dim);

    // The reserve reads as full-but-idle when you are not on it: showing it
    // dark made a full reserve look like an empty one.
    text(ctx, 'RES', 84, H - 22, g.onReserve ? (blink ? UI.red : UI.amber) : UI.grey, 1);
    bar(ctx, 84, H - 12, 34, 7, resFrac,
      g.onReserve ? (blink ? UI.white : resColor) : 'rgba(190,120,40,0.55)', '#000', UI.dim);

    // ---- speed -----------------------------------------------------------
    const mph = Math.max(0, g.mph);
    textRight(ctx, `${pad(mph, 3)}`, W - 24, H - 22, g.nitroTimer > 0 ? UI.cyan : UI.white, 2);
    textRight(ctx, 'MPH', W - 3, H - 16, UI.grey, 1);

    // ---- multiplier ------------------------------------------------------
    // Kills and clean passes build it; a wreck takes it away.
    const mx = 126;
    const mCol = g.multiplier >= 6 ? UI.magenta
      : g.multiplier >= 3 ? UI.yellow
        : g.multiplier >= 2 ? UI.amber : UI.grey;
    text(ctx, 'MULT', mx, H - 22, mCol, 1);
    text(ctx, `X${g.multiplier}`, mx + 28, H - 23, mCol, 2);
    // Progress toward the next step.
    if (g.multiplier < K.MULTIPLIER_MAX) {
      bar(ctx, mx, H - 10, 40, 3, g.chain / K.CHAIN_PER_LEVEL, mCol, '#000', 'rgba(0,0,0,0.5)');
    } else {
      text(ctx, 'MAX', mx, H - 11, UI.magenta, 1);
    }

    // ---- weapon / ordnance ----------------------------------------------
    text(ctx, g.weapon.short, 4, H - 50, UI.cyan, 1);
    const ammoX = 4 + textWidth('SPRD', 1) + 5;
    if (g.ammo !== Infinity) text(ctx, `${pad(g.ammo, 3)}`, ammoX, H - 50, UI.white, 1);
    else text(ctx, '---', ammoX, H - 50, UI.dim, 1);

    // Ordnance pips: the fastest possible read on what you have left.
    const pips = (label, y, count, max, color) => {
      text(ctx, label, 4, y, count > 0 ? color : UI.grey, 1);
      for (let i = 0; i < max; i++) {
        ctx.fillStyle = i < count ? color : 'rgba(255,255,255,0.16)';
        ctx.fillRect(26 + i * 5, y + 1, 4, 5);
      }
    };
    pips('MSL', H - 41, g.missiles, K.CRUISE_MISSILE.maxCount, UI.red);
    pips('NOS', H - 33, g.nitroCharges, K.NITRO.maxCharges, UI.amber);

    if (g.shieldTimer > 0) {
      const sh = g.shieldTimer / K.SHIELD.duration;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(W - 52, H - 52, 52, 18);
      text(ctx, 'SHIELD', W - 48, H - 50, UI.cyan, 1);
      bar(ctx, W - 48, H - 41, 42, 4, sh, UI.cyan, '#000', UI.dim);
    }

    // ---- stage progress --------------------------------------------------
    const py = 21;
    bar(ctx, 4, py, W - 8, 3, g.progress, UI.amber, 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0.4)');
    // Marker for the van's position along the route.
    ctx.fillStyle = UI.white;
    ctx.fillRect(Math.round(4 + (W - 8) * clamp(g.progress, 0, 1)) - 1, py - 1, 2, 5);

    // ---- warnings --------------------------------------------------------
    if (g.reserveAnnounce > 0 && Math.floor(g.time * 6) % 2 === 0) {
      textCenteredShadow(ctx, 'MAIN TANK DRY -- ON RESERVE', W / 2, 30, UI.red, 1);
    } else if (critical && Math.floor(g.time * 4) % 2 === 0 && g.state === STATE.PLAY) {
      textCenteredShadow(ctx, g.onReserve ? 'RESERVE FUEL' : 'LOW FUEL', W / 2, 30, UI.red, 1);
    }
    if (g.offRoad && g.state === STATE.PLAY && Math.floor(g.time * 6) % 2 === 0) {
      textCenteredShadow(ctx, 'GET BACK ON THE ROAD', W / 2, 40, UI.amber, 1);
    }
    if (g.rescue.active && !g.rescue.dropped) {
      textCenteredShadow(ctx, 'RESCUE CRUISER INBOUND', W / 2, 74, UI.cyan, 1);
    }
  }

  // ---------------------------------------------------------------- overlays

  _ready(g) {
    const ctx = this.ctx;
    const t = g.readyTimer;
    dim(ctx, 0.35);
    textCenteredShadow(ctx, `STAGE ${g.stage}`, W / 2, 78, UI.white, 2);
    textCenteredShadow(ctx, g.track.name, W / 2, 96, UI.amber, 1);
    textCenteredShadow(ctx, (THEMES[g.theme] || THEMES.day).name, W / 2, 106, UI.cyan, 1);

    const n = Math.ceil(t);
    const label = n <= 0 ? 'GO' : n === 1 ? 'SET' : n === 2 ? 'READY' : `${n}`;
    textCenteredShadow(ctx, label, W / 2, 126, n <= 1 ? UI.green : UI.yellow, 2);

    if (g.stage === 1) {
      textCenteredShadow(ctx, 'FUEL IS YOUR TIMER', W / 2, 152, UI.grey, 1);
      textCenteredShadow(ctx, 'GRAB GLOBES OR THE RALLY ENDS', W / 2, 162, UI.grey, 1);
    }
  }

  _stageEnd(g) {
    const ctx = this.ctx;
    dim(ctx, 0.45);
    textCenteredShadow(ctx, 'STAGE CLEAR', W / 2, 70, UI.green, 2);
    textCenteredShadow(ctx, `${g.track.name}`, W / 2, 90, UI.amber, 1);
    textCenteredShadow(ctx, `FUEL BONUS  ${Math.ceil(g.bonusFuel)}`, W / 2, 108, UI.cyan, 1);
    textCenteredShadow(ctx, `SCORE  ${commas(Math.floor(g.score))}`, W / 2, 120, UI.white, 1);
    if (g.stage < K.TOTAL_STAGES) {
      textCenteredShadow(ctx, `+${K.FUEL_STAGE_BONUS} FUEL FOR STAGE ${g.stage + 1}`,
        W / 2, 138, UI.grey, 1);
    }
  }

  _gameOver(g) {
    const ctx = this.ctx;
    dim(ctx, 0.6);
    if (g.completedRally) {
      textCenteredShadow(ctx, 'RALLY COMPLETE', W / 2, 62, UI.green, 2);
      textCenteredShadow(ctx, 'ALL 50 STAGES. THE VAN HELD.', W / 2, 82, UI.amber, 1);
    } else {
      textCenteredShadow(ctx, 'OUT OF FUEL', W / 2, 62, UI.red, 2);
      textCenteredShadow(ctx, `YOU MADE IT TO STAGE ${g.stage}`, W / 2, 82, UI.amber, 1);
    }
    textCenteredShadow(ctx, `FINAL SCORE  ${commas(Math.floor(g.score))}`, W / 2, 100, UI.white, 1);
    textCenteredShadow(ctx, `KILLS ${g.stats.kills}   GLOBES ${g.stats.globes}   WRECKS ${g.stats.crashes}`,
      W / 2, 112, UI.grey, 1);
    textCenteredShadow(ctx, `CLOSE PASSES ${g.stats.nearMisses}   BEST MULTIPLIER X${g.stats.best}`,
      W / 2, 122, UI.grey, 1);
    if (Math.floor(g.score) >= g.highScore && g.score > 0) {
      if (Math.floor(g.time * 4) % 2 === 0) {
        textCenteredShadow(ctx, 'NEW HIGH SCORE', W / 2, 136, UI.yellow, 1);
      }
    }
    if (g.gameOverTimer < 5.2 && Math.floor(g.time * 2) % 2 === 0) {
      textCenteredShadow(ctx, 'PRESS ENTER TO DRIVE AGAIN', W / 2, 152, UI.cyan, 1);
    }
  }

  _paused() {
    const ctx = this.ctx;
    dim(ctx, 0.6);
    textCenteredShadow(ctx, 'PAUSED', W / 2, 100, UI.white, 2);
    textCenteredShadow(ctx, 'PRESS P TO RESUME', W / 2, 124, UI.grey, 1);
  }

  // ----------------------------------------------------------------- attract

  /**
   * Attract screen.
   *
   * The demo drives underneath, so the layout leaves the band the van
   * occupies clear and puts the copy above and below it.  Every text block
   * gets a solid panel: at speed the road behind is a moving field of light
   * and dark, and unbacked text on top of it is unreadable half the time.
   */
  _attract(g) {
    const ctx = this.ctx;
    dim(ctx, 0.30);

    const panel = (y, h, a = 0.78) => {
      ctx.fillStyle = `rgba(0,0,0,${a})`;
      ctx.fillRect(0, y, W, h);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(0, y, W, 1);
      ctx.fillRect(0, y + h - 1, W, 1);
    };

    // ---- title ----------------------------------------------------------
    const bob = Math.round(Math.sin(g.time * 1.6) * 2);
    panel(8, 56, 0.82);
    textCenteredShadow(ctx, 'HORRIBLE', W / 2, 13 + bob, UI.tan, 3);
    textCenteredShadow(ctx, 'CAR', W / 2, 38 + bob, UI.red, 3);

    // ---- strapline ------------------------------------------------------
    panel(66, 24);
    textCentered(ctx, '1994 DODGE CARAVAN', W / 2, 70, UI.tan, 1);
    textCentered(ctx, 'VS 50 STAGES OF TRAFFIC', W / 2, 80, UI.white, 1);

    // ---- rotating instruction card --------------------------------------
    panel(94, 24);
    const page = Math.floor(g.attractTimer / 4) % 3;
    if (page === 0) {
      textCentered(ctx, 'ARROWS STEER  UP GAS  DOWN BRAKE', W / 2, 98, UI.amber, 1);
      textCentered(ctx, 'SPACE FIRE  SHIFT MISSILE  C NITRO', W / 2, 108, UI.amber, 1);
    } else if (page === 1) {
      textCentered(ctx, 'FUEL IS YOUR ONLY LIFE', W / 2, 98, UI.cyan, 1);
      textCentered(ctx, 'GRAB GLOBES. REACH THE FINISH.', W / 2, 108, UI.cyan, 1);
    } else {
      textCentered(ctx, 'THE RESCUE CRUISER DROPS WEAPONS', W / 2, 98, UI.green, 1);
      textCentered(ctx, 'DRIVE OVER A POD TO ARM IT', W / 2, 108, UI.green, 1);
    }

    // The band from here to ~190 is left clear for the demo to drive through.

    // ---- start prompt ---------------------------------------------------
    panel(H - 46, 46, 0.82);
    if (Math.floor(g.time * 2) % 2 === 0) {
      textCenteredShadow(ctx, 'PRESS ENTER TO START', W / 2, H - 40, UI.white, 1);
    }
    textCentered(ctx, `HIGH SCORE  ${commas(g.highScore)}`, W / 2, H - 26, UI.yellow, 1);
    textCentered(ctx, 'AFTER ATARI ROAD BLASTERS, 1987', W / 2, H - 13, UI.dim, 1);
  }
}

function dim(ctx, a) {
  ctx.fillStyle = `rgba(0,0,0,${a})`;
  ctx.fillRect(0, 0, W, H);
}
