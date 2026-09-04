/*
 * The skyline.
 *
 * Pittsburgh, seen from a highway on the far bank.  The silhouette does most
 * of the work, so it is built from the shapes people actually recognise:
 *
 *   - US Steel Tower: a huge flat-topped slab, and famously rust-coloured
 *     (it is clad in Cor-Ten, which is meant to rust).
 *   - PPG Place: a cluster of glass gothic spires, tallest in the middle.
 *   - Gulf Tower: a stepped ziggurat cap.
 *   - Fifth Avenue Place: a thin tapered crown with a needle on top.
 *   - Mill stacks along the river, still smoking.
 *   - Gold truss bridges. Pittsburgh has more bridges than anywhere, and
 *     they are all painted the same yellow.
 *   - Hills behind everything, because the city sits in a bowl.
 *
 * The whole strip is baked once per theme into an offscreen canvas and then
 * blitted twice per frame with a scroll offset.  Rebuilding this from
 * rectangles every frame would be hundreds of fill calls for something that
 * only ever slides sideways.
 */

import { q, mix } from './palette.js';
import { RES } from './config.js';

/** Width of one seamless tile of skyline, in buffer pixels. */
export const TILE_W = 480 * RES;
/**
 * Height of the strip; its bottom edge sits on the horizon.  Kept to about a
 * third of the screen: a skyline seen from a highway across the river is a
 * band along the horizon, not a wall you drive into.
 */
export const TILE_H = 70 * RES;

const cache = new Map();

const r = (ctx, x, y, w, h, c) => {
  ctx.fillStyle = c;
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
};

/**
 * Lit windows.  Only drawn for dark themes -- a daylight skyline reads as a
 * flat silhouette, which is exactly right at that distance.
 */
function windows(ctx, x, y, w, h, seed, lit, colorA, colorB) {
  const step = 3 * RES;
  let n = seed;
  for (let wy = y + 2 * RES; wy < y + h - 2 * RES; wy += step) {
    for (let wx = x + 2 * RES; wx < x + w - 2 * RES; wx += step) {
      n = (n * 1103515245 + 12345) & 0x7fffffff;
      const on = (n >> 16) % 100;
      if (lit) {
        // After dark a scatter of windows is lit, a few of them brightly.
        if (on < 34) r(ctx, wx, wy, RES, RES * 1.5, on < 12 ? colorB : colorA);
      } else if (on < 40) {
        // In daylight the glazing reads as darker flecks against the
        // masonry.  Painting them the night colour lights the whole city up
        // at noon, which is exactly as odd as it sounds.
        r(ctx, wx, wy, RES, RES * 1.5, colorA);
      }
    }
  }
}

/**
 * Build one seamless tile for a theme.
 * @param {object} theme entry from palette.THEMES
 * @returns {HTMLCanvasElement}
 */
function build(theme) {
  const c = document.createElement('canvas');
  c.width = TILE_W;
  c.height = TILE_H;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const dark = theme.dark > 0.25;
  // Distance haze: the further back the layer, the more it washes toward the
  // sky colour, which is what actually sells depth in a flat silhouette.
  const far = mix(theme.haze, theme.sky, 0.42);
  const mid = mix(theme.haze, theme.ground[1], 0.34);
  const near = mix(theme.haze, theme.ground[1], 0.60);
  const accent = dark ? q('4225') : mix(near, theme.sky, 0.18);
  const rust = dark ? mix(q('7420'), near, 0.45) : mix(q('c741'), near, 0.30);
  const glass = dark ? mix(q('5348'), near, 0.35) : mix(q('9acd'), near, 0.30);
  const gold = dark ? mix(q('a961'), near, 0.30) : q('fdb2');
  // At night these are lamps; by day the same routine paints darker glazing.
  const winA = dark ? q('fec6') : mix(mid, q('0000'), 0.30);
  const winB = dark ? q('fdf9') : mix(near, q('0000'), 0.25);
  const smoke = mix(theme.haze, theme.sky, 0.25);

  const B = TILE_H;              // baseline (bottom of the strip)
  const S = RES;

  // ---- hills behind the city -----------------------------------------
  ctx.fillStyle = far;
  for (let i = 0; i < 9; i++) {
    const hx = i * 58 * S - 20 * S;
    const hw = 96 * S;
    const hh = (13 + ((i * 37) % 9)) * S;
    ctx.beginPath();
    ctx.moveTo(hx, B);
    ctx.lineTo(hx + hw * 0.30, B - hh);
    ctx.lineTo(hx + hw * 0.62, B - hh * 0.82);
    ctx.lineTo(hx + hw, B);
    ctx.closePath();
    ctx.fill();
  }

  // ---- background filler blocks ---------------------------------------
  let n = 12345;
  for (let x = -12 * S; x < TILE_W + 12 * S; x += 9 * S) {
    n = (n * 1103515245 + 12345) & 0x7fffffff;
    const h = (8 + ((n >> 18) % 17)) * S;
    const w = (6 + ((n >> 12) % 5)) * S;
    r(ctx, x, B - h, w, h, mid);
    if (dark) windows(ctx, x, B - h, w, h, n, true, winA, winB);
  }

  // ---- the landmarks ---------------------------------------------------

  // US Steel Tower: tall rust slab, flat top, notched corners.
  const us = { x: 200 * S, w: 22 * S, h: 56 * S };
  r(ctx, us.x, B - us.h, us.w, us.h, rust);
  r(ctx, us.x - 3 * S, B - us.h * 0.92, 3 * S, us.h * 0.92, mix(rust, near, 0.4));
  r(ctx, us.x + us.w, B - us.h * 0.92, 3 * S, us.h * 0.92, mix(rust, near, 0.4));
  r(ctx, us.x + 4 * S, B - us.h - 2 * S, us.w - 8 * S, 2 * S, mix(rust, near, 0.5));
  windows(ctx, us.x, B - us.h, us.w, us.h, 991, dark, winA, winB);
  // Aircraft warning lights.
  if (dark) {
    r(ctx, us.x + us.w / 2 - S, B - us.h - 4 * S, 2 * S, 2 * S, q('ff30'));
  }

  // PPG Place: a cluster of gothic glass spires, tallest in the middle.
  const ppgX = 130 * S;
  const spires = [[0, 23], [8, 30], [17, 43], [26, 31], [34, 24]];
  for (const [dx, hh] of spires) {
    const x = ppgX + dx * S;
    const w = 8 * S;
    const h = hh * S;
    r(ctx, x, B - h, w, h, glass);
    // Pointed cap.
    ctx.fillStyle = glass;
    ctx.beginPath();
    ctx.moveTo(x, B - h);
    ctx.lineTo(x + w / 2, B - h - 7 * S);
    ctx.lineTo(x + w, B - h);
    ctx.closePath();
    ctx.fill();
    r(ctx, x + w / 2 - S / 2, B - h - 10 * S, S, 4 * S, glass);
    windows(ctx, x, B - h, w, h, 313 + dx, dark, winB, winA);
  }

  // Gulf Tower: stepped ziggurat cap, lit green or blue for the weather.
  const gx = 258 * S;
  r(ctx, gx, B - 40 * S, 18 * S, 40 * S, near);
  windows(ctx, gx, B - 40 * S, 18 * S, 40 * S, 77, dark, winA, winB);
  const steps = [[2, 4], [4, 3], [6, 3], [8, 2]];
  let sy = B - 40 * S;
  for (const [inset, sh] of steps) {
    r(ctx, gx + inset * S, sy - sh * S, 18 * S - inset * 2 * S, sh * S, accent);
    sy -= sh * S;
  }
  r(ctx, gx + 8 * S, sy - 4 * S, 2 * S, 4 * S, dark ? q('f5fa') : accent);

  // Fifth Avenue Place: tapered crown with a needle.
  const fx = 300 * S;
  r(ctx, fx, B - 36 * S, 14 * S, 36 * S, mid);
  windows(ctx, fx, B - 36 * S, 14 * S, 36 * S, 451, dark, winA, winB);
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(fx + 1 * S, B - 36 * S);
  ctx.lineTo(fx + 7 * S, B - 48 * S);
  ctx.lineTo(fx + 13 * S, B - 36 * S);
  ctx.closePath();
  ctx.fill();
  r(ctx, fx + 6 * S, B - 55 * S, 2 * S, 8 * S, accent);

  // A couple of mid-rise blocks to fill the downtown wedge.
  r(ctx, 236 * S, B - 29 * S, 14 * S, 29 * S, near);
  windows(ctx, 236 * S, B - 29 * S, 14 * S, 29 * S, 17, dark, winA, winB);
  r(ctx, 178 * S, B - 24 * S, 16 * S, 24 * S, mid);
  windows(ctx, 178 * S, B - 24 * S, 16 * S, 24 * S, 29, dark, winA, winB);
  r(ctx, 280 * S, B - 21 * S, 13 * S, 21 * S, near);
  windows(ctx, 280 * S, B - 21 * S, 13 * S, 21 * S, 63, dark, winA, winB);

  // ---- mill stacks, still going ---------------------------------------
  for (const [sx2, sh] of [[30, 31], [40, 36], [49, 27], [396, 33], [408, 25]]) {
    const x = sx2 * S;
    r(ctx, x, B - sh * S, 4 * S, sh * S, near);
    r(ctx, x - S, B - sh * S - 2 * S, 6 * S, 2 * S, mix(near, theme.sky, 0.2));
    if (dark) r(ctx, x + S, B - sh * S - 4 * S, 2 * S, 2 * S, q('ff40'));
    // Smoke plume, drifting the same way for all of them.
    ctx.globalAlpha = 0.30;
    ctx.fillStyle = smoke;
    for (let k = 0; k < 4; k++) {
      const py = B - sh * S - (5 + k * 5) * S;
      const pw = (6 + k * 3) * S;
      ctx.fillRect(x - S + k * 2 * S, py, pw, 4 * S);
    }
    ctx.globalAlpha = 1;
  }

  // Squirrel Hill / Mount Washington mass on the right, with an incline.
  ctx.fillStyle = near;
  ctx.beginPath();
  ctx.moveTo(428 * S, B);
  ctx.lineTo(450 * S, B - 22 * S);
  ctx.lineTo(TILE_W, B - 19 * S);
  ctx.lineTo(TILE_W, B);
  ctx.closePath();
  ctx.fill();
  r(ctx, 452 * S, B - 21 * S, 26 * S, 2 * S, accent);   // incline track
  r(ctx, 458 * S, B - 23 * S, 4 * S, 3 * S, dark ? winA : accent);

  // ---- the bridges -----------------------------------------------------
  // Gold, because in this city they all are.
  const bridge = (bx, bw) => {
    const deckY = B - 7 * S;
    r(ctx, bx, deckY, bw, 2 * S, gold);
    // Truss: an arc of verticals rising from the deck.
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      const arc = Math.sin(t * Math.PI) * 6 * S;
      r(ctx, bx + t * bw, deckY - arc, S, arc + S, gold);
    }
    r(ctx, bx, deckY - 6 * S, bw, S, gold);
    // Piers.
    r(ctx, bx, deckY + 2 * S, 2 * S, 7 * S, mix(gold, near, 0.55));
    r(ctx, bx + bw - 2 * S, deckY + 2 * S, 2 * S, 7 * S, mix(gold, near, 0.55));
  };
  bridge(70 * S, 44 * S);
  bridge(330 * S, 40 * S);

  // ---- the river -------------------------------------------------------
  r(ctx, 0, B - 3 * S, TILE_W, 3 * S, mix(theme.haze, dark ? q('2114') : q('a68c'), 0.5));

  return c;
}

/** Get (building on first use) the baked skyline tile for a theme. */
export function skylineFor(themeName, theme) {
  let tile = cache.get(themeName);
  if (!tile) {
    tile = build(theme);
    cache.set(themeName, tile);
  }
  return tile;
}
