/*
 * Sprites.
 *
 * All artwork is generated at load time into offscreen canvases from
 * rectangle primitives, so the game ships as pure code with no asset
 * pipeline.  Everything is drawn at 1:1 with the render buffer and blitted
 * with smoothing disabled, which keeps edges crisp at any window size.
 *
 * Art is authored at the 640x480 buffer's scale -- roughly twice the density
 * of the original arcade raster -- so a car closing at 250 mph has enough
 * pixels to read as a car rather than as a coloured smudge.
 *
 * Colours come from palette.q(), i.e. every pixel is a colour the Atari
 * System 1 CRAM could actually hold.
 *
 * Sprites that carry lamps expose them as `lamps`: fractional rectangles in
 * sprite space that the renderer lights up additively after dark.
 */

import { q } from './palette.js';

const C = {
  // The van.  Tan.  Aggressively tan.
  tan: q('fca7'), tanLit: q('fdb8'), tanMid: q('dba7'), tanDark: q('bca7'),
  tanShadow: q('8ba6'),
  rust: q('e841'), rustDark: q('a731'), rustLit: q('fa62'),
  glass: q('a248'), glassLit: q('c46a'), glassDark: q('6135'), glassPale: q('e8bd'),
  tail: q('ff20'), tailLit: q('ff64'), tailDeep: q('b510'), tailAmber: q('fd82'),
  head: q('ffed'), headDim: q('cba7'),
  chrome: q('caaa'), chromeLit: q('eccc'), chromeDark: q('8777'),
  tyre: q('4333'), tyreLit: q('7555'), tyreDark: q('2222'),
  black: q('0000'), shadow: q('3111'),

  red: q('fe20'), redDark: q('a520'), redLit: q('ff75'),
  blue: q('f24e'), blueDark: q('a13a'), blueLit: q('f68f'),
  grey: q('9888'), greyDark: q('6555'), greyLit: q('ccbb'),
  green: q('e373'), greenDark: q('9251'), greenLit: q('f7a5'),
  brown: q('c741'), brownDark: q('8530'), brownLit: q('e963'),
  yellow: q('ffe3'), yellowDark: q('c941'), white: q('ffff'), cyan: q('f6ef'),
  orange: q('fd71'), orangeLit: q('ff94'),
  purple: q('e63c'), army: q('a562'), armyDark: q('7341'),
  snow: q('feee'), steel: q('b899'), steelDark: q('7666'), steelLit: q('deee'),
  sky: q('a8bf'),
};

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/**
 * Bake a sprite.
 * @param {number} w pixel width
 * @param {number} h pixel height
 * @param {number} worldW width as a fraction of the road half-width
 * @param {(ctx: CanvasRenderingContext2D) => void} draw
 * @param {Array<object>} [lamps] fractional lamp rects for night lighting
 */
function bake(w, h, worldW, draw, lamps = null, shadow = 0) {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  draw(ctx);
  return { canvas, w, h, worldW, aspect: h / w, lamps, shadow };
}

const r = (ctx, x, y, w, h, color) => {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(0, Math.round(w)), Math.max(0, Math.round(h)));
};

/** Horizontally symmetric rectangle pair. */
const rSym = (ctx, W, x, y, w, h, color) => {
  r(ctx, x, y, w, h, color);
  r(ctx, W - x - w, y, w, h, color);
};

/** Filled triangle, for spires, cones and noses. */
const tri = (ctx, x1, y1, x2, y2, x3, y3, color) => {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3);
  ctx.closePath();
  ctx.fill();
};

// ------------------------------------------------------------------ the van

/**
 * The Caravan's rear face, drawn flat.
 *
 * The shapes that identify a second-generation (1991-95) Caravan from this
 * angle, in rough order of how much they matter:
 *
 *   - Full-height vertical taillights at the extreme corners, running from
 *     the beltline all the way down to the bumper.  Nothing else on the road
 *     looks like this.
 *   - A wide, nearly vertical liftgate with a big rubber-framed window and a
 *     single centre wiper.
 *   - A recessed licence plate low and central, between the lights.
 *   - A deep, full-width body-coloured bumper with a dark valance under it.
 *   - Tyres that barely show: from directly behind you see the bottom corners
 *     of them and nothing else.  Drawing them as big blocks was what made the
 *     old sprite read as a safari truck.
 *
 * `lean` in [-1,1] shifts the body over its wheels so hard steering reads
 * visually even though the camera keeps the van centred.
 */
function drawCaravanRear(ctx, W, H) {
  const bx = 0;
  const rx = 0;
  const mid = W >> 1;

  // Explicit horizontal bands, top to bottom.  Deriving these from H made it
  // far too easy to land the licence plate on the bumper.
  const RACK = 2;
  const ROOF = 6;
  const BELT = 16;        // top of the taillights and the glass surround
  const GLASS_T = 19;
  const GLASS_B = 39;
  const SURROUND_B = 42;
  const HANDLE = 43;
  const PLATE_T = 46;
  const PLATE_B = 56;
  const BUMPER_T = 57;
  const BUMPER_B = 71;
  const VALANCE_B = 77;
  const LIGHT_B = BUMPER_T;

  // ---- tyres -----------------------------------------------------------
  // Only the outer bottom corners show past the bodywork.  Drawing these as
  // big blocks is what used to make the van read as a safari truck.
  for (const wx of [3, W - 13]) {
    r(ctx, wx + 1, 65, 8, 17, C.tyreDark);
    r(ctx, wx, 68, 10, 14, C.tyreDark);
    r(ctx, wx + 1, 69, 8, 12, C.tyre);
    r(ctx, wx + 2, 75, 6, 5, C.greyDark);
    r(ctx, wx + 3, 76, 4, 3, C.chromeDark);
  }

  // ---- valance and bumper ---------------------------------------------
  r(ctx, 8 + bx, BUMPER_B, W - 16, VALANCE_B - BUMPER_B, C.tanShadow);
  r(ctx, 54 + bx, BUMPER_B + 2, 11, 4, C.chromeDark);   // exhaust cutout
  r(ctx, 56 + bx, BUMPER_B + 3, 7, 2, C.black);

  r(ctx, 1 + bx, BUMPER_T, W - 2, BUMPER_B - BUMPER_T, C.tanDark);
  r(ctx, 1 + bx, BUMPER_T, W - 2, 3, C.tanMid);         // top face
  r(ctx, 1 + bx, BUMPER_B - 3, W - 2, 3, C.tanShadow);
  r(ctx, 4 + bx, BUMPER_T + 6, W - 8, 4, C.chromeDark); // rub strip
  r(ctx, 4 + bx, BUMPER_T + 6, W - 8, 1, C.chrome);
  rSym(ctx, W, 1 + bx, BUMPER_T, 4, BUMPER_B - BUMPER_T, C.tanShadow);

  // ---- body ------------------------------------------------------------
  r(ctx, 3 + bx, 13, W - 6, BUMPER_T - 13, C.tan);
  r(ctx, 3 + bx, 13, W - 6, 3, C.tanLit);
  rSym(ctx, W, 3 + bx, 13, 3, BUMPER_T - 13, C.tanMid);  // side radius
  r(ctx, 3 + bx, BUMPER_T - 3, W - 6, 3, C.tanMid);

  // ---- roof, spoiler and rack -----------------------------------------
  r(ctx, 8 + rx, ROOF, W - 16, 9, C.tan);
  r(ctx, 8 + rx, ROOF, W - 16, 2, C.tanLit);
  r(ctx, 6 + rx, 11, W - 12, 4, C.tanMid);               // spoiler lip
  r(ctx, mid - 8 + rx, ROOF + 2, 16, 3, C.tailDeep);     // third brake light
  r(ctx, mid - 7 + rx, ROOF + 3, 14, 1, C.tail);
  r(ctx, 18 + rx, RACK, W - 36, 2, C.grey);              // low-profile rails
  r(ctx, 18 + rx, RACK, W - 36, 1, C.greyLit);
  rSym(ctx, W, 17 + rx, RACK + 1, 4, 4, C.greyDark);

  // ---- liftgate glass --------------------------------------------------
  r(ctx, 14 + bx, BELT, W - 28, SURROUND_B - BELT, C.black);   // rubber surround
  r(ctx, 17 + bx, GLASS_T, W - 34, GLASS_B - GLASS_T, C.glass);
  r(ctx, 18 + bx, GLASS_T + 1, W - 36, 5, C.glassLit);         // sky reflection
  for (let i = 0; i < 5; i++) {
    r(ctx, 20 + bx, GLASS_T + 8 + i * 3, W - 40, 1, C.glassDark); // defroster
  }
  r(ctx, 19 + bx, GLASS_B - 6, 11, 5, C.glassPale);            // smear
  r(ctx, mid - 12 + bx, GLASS_B + 1, 24, 2, C.greyDark);       // wiper blade
  r(ctx, mid - 12 + bx, GLASS_B - 3, 2, 5, C.greyDark);        // wiper arm
  r(ctx, mid - 3 + bx, BELT - 2, 6, 3, C.greyDark);            // washer nozzle

  // ---- taillights ------------------------------------------------------
  // Corner to corner, beltline to bumper.  Amber turn on top, red brake
  // through the middle, clear reverse at the bottom.  Nothing else on the
  // road has lamps this tall.
  for (const lx of [3, W - 15]) {
    r(ctx, lx + bx, BELT, 12, LIGHT_B - BELT, C.tailDeep);
    r(ctx, lx + 1 + bx, BELT + 1, 10, LIGHT_B - BELT - 2, C.tail);
    r(ctx, lx + 1 + bx, BELT + 1, 10, 8, C.tailAmber);
    r(ctx, lx + 1 + bx, BELT + 9, 10, 1, C.tailDeep);
    r(ctx, lx + 1 + bx, LIGHT_B - 9, 10, 1, C.tailDeep);
    r(ctx, lx + 1 + bx, LIGHT_B - 8, 10, 7, C.white);          // reverse lamp
    r(ctx, lx + 3 + bx, BELT + 14, 3, 8, C.tailLit);           // lens highlight
    r(ctx, lx + 5 + bx, BELT + 12, 1, LIGHT_B - BELT - 25, C.tailLit);
  }

  // ---- liftgate furniture ---------------------------------------------
  r(ctx, mid - 19 + bx, HANDLE, 38, 3, C.chrome);              // handle bar
  r(ctx, mid - 19 + bx, HANDLE, 38, 1, C.chromeLit);
  r(ctx, mid + 15 + bx, HANDLE + 1, 4, 3, C.greyDark);         // keyhole
  r(ctx, mid - 6 + bx, PLATE_T - 2, 12, 2, C.greyLit);         // plate lamp
  r(ctx, mid - 13 + bx, PLATE_T, 26, PLATE_B - PLATE_T, C.chromeDark);
  r(ctx, mid - 12 + bx, PLATE_T + 1, 24, PLATE_B - PLATE_T - 2, C.white);
  r(ctx, mid - 10 + bx, PLATE_T + 3, 20, PLATE_B - PLATE_T - 6, C.greyDark);
  for (let i = 0; i < 4; i++) {
    r(ctx, mid - 8 + bx + i * 5, PLATE_T + 4, 3, PLATE_B - PLATE_T - 8, C.white);
  }

  // Badging: DODGE left of the plate, CARAVAN right.  Illegible, correct.
  for (let i = 0; i < 4; i++) r(ctx, 18 + bx + i * 3, PLATE_T + 3, 2, 3, C.chromeDark);
  for (let i = 0; i < 5; i++) r(ctx, W - 32 + bx + i * 3, PLATE_T + 3, 2, 3, C.chromeDark);

  // ---- rust ------------------------------------------------------------
  // Enough to date the thing; not so much that it reads as camouflage.
  r(ctx, 4 + bx, BUMPER_T - 10, 8, 6, C.rust);
  r(ctx, 5 + bx, BUMPER_T - 8, 5, 3, C.rustDark);
  r(ctx, W - 16 + bx, BUMPER_T - 9, 6, 4, C.rustDark);
  r(ctx, 10 + bx, BUMPER_B - 5, 5, 3, C.rustDark);
  r(ctx, W - 24 + bx, BUMPER_T + 2, 4, 3, C.rust);

  // ---- the roof-mounted cannon.  Not factory. --------------------------
  r(ctx, mid - 9 + rx, RACK, 18, 5, C.steelDark);              // mount plate
  rSym(ctx, W, mid - 9 + rx, RACK, 3, 5, C.chromeDark);        // bolts
  r(ctx, mid - 5 + rx, 0, 10, 4, C.steel);
  r(ctx, mid - 3 + rx, 0, 6, 3, C.steelDark);
  r(ctx, mid - 1 + rx, 0, 2, 2, C.chromeLit);
}

/**
 * The van's visible flank when it is yawed.
 *
 * `d` runs 0 at the edge touching the rear face to 1 at the far end, and the
 * body tapers over that range: the far end is further from the camera, so it
 * projects smaller.  That taper is the whole reason this reads as a car
 * turning rather than as a rectangle glued to the side.
 */
function drawVanFlank(ctx, x0, w, H, dir) {
  if (w <= 0) return;
  const TOP = 6, BELT = 16, GLASS_B = 38, BODY_B = 57, SILL = 71;
  const near = (i) => (dir > 0 ? x0 + i : x0 + w - 1 - i);

  for (let i = 0; i < w; i++) {
    const cx = near(i);
    const d = w <= 1 ? 0 : i / (w - 1);
    const shrink = d * 0.16;
    const mid = (TOP + SILL) / 2;
    const yTop = Math.round(TOP + (mid - TOP) * shrink);
    const yBelt = Math.round(BELT + (mid - BELT) * shrink);
    const yGlassB = Math.round(GLASS_B + (mid - GLASS_B) * shrink);
    const yBodyB = Math.round(BODY_B - (BODY_B - mid) * shrink);
    const ySill = Math.round(SILL - (SILL - mid) * shrink);

    // Roof rail and the shoulder line catching the light.
    r(ctx, cx, yTop, 1, 2, C.tanLit);
    r(ctx, cx, yTop + 2, 1, yBelt - yTop - 2, C.tanMid);

    // Side glass, in a dark rubber frame, with a reflection along the top.
    r(ctx, cx, yBelt, 1, yGlassB - yBelt, C.black);
    const gT = yBelt + 2;
    const gB = yGlassB - 2;
    r(ctx, cx, gT, 1, gB - gT, C.glass);
    r(ctx, cx, gT, 1, 3, C.glassLit);
    if (d > 0.45 && d < 0.60) r(ctx, cx, gT, 1, gB - gT, C.tanDark);  // B-pillar

    // Body panel, its crease, and the shaded rocker below.
    r(ctx, cx, yGlassB, 1, yBodyB - yGlassB, C.tanDark);
    r(ctx, cx, yGlassB + 1, 1, 2, C.tanMid);
    r(ctx, cx, yGlassB + 8, 1, 1, C.tanShadow);
    r(ctx, cx, yBodyB, 1, ySill - yBodyB, C.tanShadow);
  }

  // Rear side-marker lamp on the corner nearest the camera.
  r(ctx, near(0), 41, Math.min(2, w), 6, C.tailAmber);

  // Fuel filler flap, a couple of pixels along.
  if (w > 6) r(ctx, near(4), 44, 3, 5, C.tanMid);

  // Rear wheel under its arch, at the near end of the flank.
  const ww = Math.min(w, 10);
  const wx = dir > 0 ? x0 : x0 + w - ww;
  r(ctx, wx, 61, ww, 3, C.tanShadow);          // arch lip
  r(ctx, wx, 64, ww, 16, C.tyreDark);
  r(ctx, wx, 66, ww, 12, C.tyre);
  r(ctx, wx + (dir > 0 ? 0 : 1), 69, Math.max(1, ww - 2), 6, C.greyDark);
  r(ctx, wx + (dir > 0 ? 1 : 2), 70, Math.max(1, ww - 4), 4, C.chromeDark);
}

/**
 * Compose one steering frame.
 *
 * `turn` in [-1,1] is the wheel.  Turning right points the nose right, which
 * swings the tail you are looking at to the LEFT and brings the van's RIGHT
 * flank into view alongside it -- so the flank goes on the right of the rear
 * face and the face slides left.  (Check it with a toy car: nose east, you
 * standing south, and the side facing you is the right one.)
 *
 * The rear face is also squeezed horizontally as it yaws, which is the
 * foreshortening you would actually see.  Together those two cues are what
 * make it feel like you are steering the front of the van instead of dragging
 * it round by the back.
 */
function composeVanFrame(W, H, turn) {
  const face = makeCanvas(W, H);
  const fctx = face.getContext('2d');
  fctx.imageSmoothingEnabled = false;
  drawCaravanRear(fctx, W, H);

  const out = makeCanvas(W, H);
  const ctx = out.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const sideW = Math.round(Math.abs(turn) * 13);
  const faceW = W - sideW;
  const dir = turn > 0 ? 1 : -1;
  const faceX = turn > 0 ? 0 : sideW;

  if (sideW > 0) drawVanFlank(ctx, turn > 0 ? faceW : 0, sideW, H, dir);
  ctx.drawImage(face, 0, 0, W, H, faceX, 0, faceW, H);

  // Lamp rectangles follow the squeezed face, so the tail-light glow at night
  // stays on the tail-lights.
  const lamp = (lx, lw, ly, lh, c) => ({
    x: (faceX + (lx / W) * faceW) / W,
    y: ly / H,
    w: ((lw / W) * faceW) / W,
    h: lh / H,
    c,
  });
  const lamps = [
    lamp(3, 12, 16, 41, 'rgba(255,70,30,0.55)'),
    lamp(W - 15, 12, 16, 41, 'rgba(255,70,30,0.55)'),
    lamp(W * 0.41, W * 0.18, 8, 3, 'rgba(255,60,25,0.5)'),
  ];
  return { canvas: out, lamps };
}

// ------------------------------------------------------------- generic cars

/**
 * @param {object} o
 * @param {'rear'|'front'} o.facing which end you are looking at
 * @param {'sedan'|'coupe'|'truck'} o.shape
 */
function drawCar(ctx, W, H, o) {
  const roofInset = o.shape === 'coupe' ? 18 : 14;
  const roofTop = o.shape === 'truck' ? 6 : 10;
  const bodyTop = o.shape === 'truck' ? 16 : 22;

  // Wheels.
  for (const wx of [2, W - 16]) {
    r(ctx, wx, H - 16, 14, 15, C.tyreDark);
    r(ctx, wx + 1, H - 15, 12, 13, C.tyre);
    r(ctx, wx + 3, H - 12, 8, 7, C.greyDark);
    r(ctx, wx + 4, H - 11, 6, 4, C.chrome);
  }

  // Cabin.
  r(ctx, roofInset, roofTop, W - roofInset * 2, bodyTop - roofTop + 4, o.body);
  r(ctx, roofInset, roofTop, W - roofInset * 2, 2, o.lit);
  r(ctx, roofInset + 3, roofTop + 3, W - (roofInset + 3) * 2, bodyTop - roofTop - 1,
    o.facing === 'rear' ? C.glass : C.glassLit);
  r(ctx, roofInset + 4, roofTop + 4, W - (roofInset + 4) * 2, 3,
    o.facing === 'rear' ? C.glassLit : C.glassPale);
  // Pillars.
  rSym(ctx, W, roofInset, roofTop + 2, 3, bodyTop - roofTop, o.dark);

  // Body.
  r(ctx, 4, bodyTop, W - 8, H - bodyTop - 12, o.body);
  r(ctx, 4, bodyTop, W - 8, 2, o.lit);
  r(ctx, 4, H - 18, W - 8, 4, o.dark);
  r(ctx, 6, H - 26, W - 12, 2, o.dark);                 // body crease
  rSym(ctx, W, 2, H - 20, 10, 6, o.dark);               // arches

  if (o.shape === 'truck') {
    r(ctx, 5, bodyTop + 4, W - 10, 3, o.dark);
    rSym(ctx, W, 7, bodyTop + 8, 9, 9, C.armyDark);     // payload
    rSym(ctx, W, 9, bodyTop + 10, 5, 5, C.army);
    r(ctx, (W >> 1) - 6, bodyTop + 7, 12, 10, C.armyDark);
  }

  // Bumper.
  r(ctx, 2, H - 14, W - 4, 6, C.greyDark);
  r(ctx, 2, H - 14, W - 4, 2, C.grey);

  let lamps;
  if (o.facing === 'rear') {
    rSym(ctx, W, 6, H - 28, 12, 9, C.tailDeep);
    rSym(ctx, W, 7, H - 27, 10, 7, C.tail);
    rSym(ctx, W, 8, H - 25, 5, 3, C.tailLit);
    r(ctx, (W >> 1) - 9, H - 24, 18, 6, C.white);       // plate
    r(ctx, (W >> 1) - 7, H - 22, 14, 3, C.greyDark);
    lamps = [
      { x: 6 / W, y: (H - 28) / H, w: 12 / W, h: 9 / H, c: 'rgba(255,60,20,0.6)' },
      { x: (W - 18) / W, y: (H - 28) / H, w: 12 / W, h: 9 / H, c: 'rgba(255,60,20,0.6)' },
    ];
  } else {
    rSym(ctx, W, 6, H - 28, 12, 9, C.chromeDark);
    rSym(ctx, W, 7, H - 27, 10, 7, C.head);
    rSym(ctx, W, 8, H - 26, 6, 4, C.white);
    // Grille.
    r(ctx, (W >> 1) - 13, H - 27, 26, 9, C.greyDark);
    for (let x = 0; x < 5; x++) r(ctx, (W >> 1) - 11 + x * 5, H - 25, 2, 5, C.grey);
    lamps = [
      { x: 6 / W, y: (H - 28) / H, w: 12 / W, h: 9 / H, c: 'rgba(255,246,200,0.85)' },
      { x: (W - 18) / W, y: (H - 28) / H, w: 12 / W, h: 9 / H, c: 'rgba(255,246,200,0.85)' },
    ];
  }
  return lamps;
}

function drawCycle(ctx, W, H) {
  r(ctx, (W >> 1) - 7, H - 22, 14, 22, C.tyreDark);      // rear wheel
  r(ctx, (W >> 1) - 6, H - 21, 12, 20, C.tyre);
  r(ctx, (W >> 1) - 3, H - 15, 6, 8, C.chrome);          // hub
  r(ctx, (W >> 1) - 11, H - 34, 22, 15, C.red);          // body
  r(ctx, (W >> 1) - 11, H - 34, 22, 2, C.redLit);
  r(ctx, (W >> 1) - 9, H - 25, 18, 4, C.redDark);
  r(ctx, (W >> 1) - 5, H - 20, 10, 7, C.tailDeep);       // tail light
  r(ctx, (W >> 1) - 4, H - 19, 8, 5, C.tail);
  r(ctx, (W >> 1) - 9, H - 50, 18, 17, C.army);          // rider torso
  r(ctx, (W >> 1) - 9, H - 50, 18, 3, C.armyDark);
  r(ctx, (W >> 1) - 4, H - 46, 8, 12, C.armyDark);       // jacket seam
  rSym(ctx, W, (W >> 1) - 17, H - 47, 7, 13, C.army);    // arms
  r(ctx, (W >> 1) - 7, H - 61, 14, 13, C.greyDark);      // helmet
  r(ctx, (W >> 1) - 6, H - 60, 12, 4, C.grey);
  r(ctx, (W >> 1) - 5, H - 56, 10, 5, C.glassLit);       // visor
  return [{ x: 0.34, y: (H - 20) / H, w: 0.32, h: 7 / H, c: 'rgba(255,60,20,0.6)' }];
}

function drawTurret(ctx, W, H) {
  // Sandbag base.
  r(ctx, 4, H - 20, W - 8, 19, C.armyDark);
  for (let i = 0; i < 4; i++) r(ctx, 5 + i * 12, H - 20, 10, 5, C.army);
  r(ctx, 4, H - 20, W - 8, 2, C.army);
  // Turret body.
  r(ctx, 12, H - 40, W - 24, 22, C.army);
  r(ctx, 12, H - 40, W - 24, 3, C.greenLit);
  r(ctx, 14, H - 36, W - 28, 3, C.armyDark);
  r(ctx, (W >> 1) - 9, H - 32, 18, 7, C.red);            // sensor band
  r(ctx, (W >> 1) - 7, H - 30, 5, 3, C.tailLit);
  // Barrel and muzzle.
  r(ctx, (W >> 1) - 5, H - 54, 10, 16, C.steelDark);
  r(ctx, (W >> 1) - 3, H - 58, 6, 8, C.steel);
  r(ctx, (W >> 1) - 4, H - 60, 8, 3, C.chromeDark);
  // Ammo box.
  r(ctx, W - 16, H - 34, 12, 10, C.armyDark);
  return [{ x: ((W >> 1) - 9) / W, y: (H - 32) / H, w: 18 / W, h: 7 / H,
    c: 'rgba(255,50,20,0.7)' }];
}

// ------------------------------------------------------------------ scenery

/**
 * Deciduous tree.
 *
 * The canopy is a stack of slabs whose total height depends on the band
 * table, so the trunk is drawn from wherever the canopy actually ends rather
 * than from a guessed offset -- getting that wrong leaves the canopy floating
 * a dozen pixels above its own trunk.
 */
function drawTree(ctx, W, H, dark) {
  const trunk = dark ? C.brownDark : C.brown;
  const trunkLit = dark ? C.brown : C.brownLit;
  const leaf = dark ? C.greenDark : C.green;
  const leafLit = dark ? C.green : C.greenLit;
  const leafDark = C.greenDark;

  // Measure the canopy first.
  const bands = [[19, 9], [14, 11], [9, 13], [5, 14], [2, 15], [7, 12]];
  let canopyBottom = 4;
  for (const [, hh] of bands) canopyBottom += hh - 3;
  canopyBottom += 3;

  // Trunk runs from inside the canopy down to the ground.
  const trunkTop = canopyBottom - 6;
  const trunkH = H - trunkTop;
  r(ctx, (W >> 1) - 6, trunkTop, 12, trunkH, trunk);
  r(ctx, (W >> 1) - 6, trunkTop, 4, trunkH, trunkLit);
  r(ctx, (W >> 1) + 2, trunkTop, 4, trunkH, C.brownDark);
  // Bark texture and a root flare so it meets the ground rather than stopping.
  for (let ty = trunkTop + 4; ty < H - 6; ty += 7) {
    r(ctx, (W >> 1) - 4, ty, 3, 2, C.brownDark);
  }
  r(ctx, (W >> 1) - 11, H - 5, 22, 5, trunk);
  r(ctx, (W >> 1) - 11, H - 5, 8, 3, trunkLit);
  r(ctx, (W >> 1) + 4, H - 4, 7, 4, C.brownDark);

  // Canopy over the top of it.
  let y = 4;
  for (const [inset, hh] of bands) {
    r(ctx, inset, y, W - inset * 2, hh, leaf);
    r(ctx, inset + 2, y, W - inset * 2 - 4, 3, leafLit);
    r(ctx, inset, y + hh - 3, W - inset * 2, 3, leafDark);
    y += hh - 3;
  }
  // A couple of gaps so the silhouette is not a perfect stack of rectangles.
  r(ctx, 6, 22, 5, 6, 'rgba(0,0,0,0)');
}

/**
 * Conifer.  Western Pennsylvania has a lot of these.
 *
 * The trunk top is derived from where the lowest skirt actually ends, for the
 * same reason as the deciduous tree: a hardcoded offset leaves the foliage
 * hovering above its own trunk.
 */
function drawPine(ctx, W, H, dark) {
  const trunk = dark ? C.brownDark : C.brown;
  const leaf = dark ? C.greenDark : C.green;
  const leafLit = dark ? C.green : C.greenLit;
  const leafDark = C.greenDark;
  const cx = W >> 1;

  const skirts = [[0.28, 10], [0.46, 22], [0.68, 34], [0.92, 46]];

  // Measure the foliage first.
  let y = 4;
  let foliageBottom = 0;
  for (const [, hh] of skirts) {
    foliageBottom = Math.max(foliageBottom, y + hh);
    y += Math.round(hh * 0.52);
  }

  // Trunk from inside the lowest skirt down to the ground.
  const trunkTop = foliageBottom - 8;
  r(ctx, cx - 4, trunkTop, 8, H - trunkTop, trunk);
  r(ctx, cx - 4, trunkTop, 3, H - trunkTop, C.brownDark);
  r(ctx, cx - 9, H - 5, 18, 5, trunk);
  r(ctx, cx + 2, H - 4, 7, 4, C.brownDark);

  // Then the skirts over it, widest at the bottom.
  y = 4;
  for (const [wf, hh] of skirts) {
    const half = Math.round((W * wf) / 2);
    tri(ctx, cx - half, y + hh, cx + half, y + hh, cx, y, leaf);
    tri(ctx, cx - half, y + hh, cx - half + 6, y + hh, cx, y + 4, leafLit);
    r(ctx, cx - half, y + hh - 2, half * 2, 2, leafDark);
    y += Math.round(hh * 0.52);
  }
}

/** Bare tree, for the rust and winter stages. */
function drawDeadTree(ctx, W, H) {
  const wood = C.brownDark;
  const woodLit = C.brown;
  const cx = W >> 1;

  // One continuous trunk from the crown to the ground, tapering as it rises.
  for (let y = 6; y < H; y++) {
    const t = (y - 6) / (H - 6);
    const half = Math.max(2, Math.round(2 + t * 4));
    r(ctx, cx - half, y, half * 2, 1, wood);
    r(ctx, cx - half, y, Math.max(1, half - 1), 1, woodLit);
  }
  r(ctx, cx - 11, H - 5, 22, 5, wood);
  r(ctx, cx + 3, H - 4, 8, 4, C.brownDark);

  // Branches: forks alternating up the trunk, thinning as they go.
  const limbs = [[-1, 46, 20, 12], [1, 38, 18, 11], [-1, 26, 13, 8], [1, 19, 11, 7],
    [-1, 12, 7, 5]];
  for (const [dir, at, len, rise] of limbs) {
    for (let i = 0; i < len; i++) {
      const th = i < len * 0.6 ? 3 : 2;
      r(ctx, cx + dir * (2 + i), H - at - Math.round((i / len) * rise * 2), th, th, wood);
    }
  }
}

/**
 * Low round shrub.
 *
 * Rows run top to bottom and widen as they go: parametrising the other way
 * round builds an upside-down dome, which reads as a flat green pad rather
 * than a bush.
 */
function drawBush(ctx, W, H, dark) {
  const leaf = dark ? C.greenDark : C.green;
  const leafLit = dark ? C.green : C.greenLit;
  const leafDark = C.greenDark;
  const cx = W >> 1;
  const rad = Math.round(Math.min(W * 0.5, H * 0.78));
  const base = H - 3;

  for (let i = 0; i <= rad; i++) {
    const yy = base - rad + i;
    const t = 1 - i / rad;                       // 1 at the crown, 0 at the base
    const halfw = Math.round(rad * Math.sqrt(Math.max(0, 1 - t * t)) * 1.15);
    if (halfw <= 0) continue;
    const shade = i < rad * 0.30 ? leafLit : i > rad * 0.80 ? leafDark : leaf;
    r(ctx, cx - halfw, yy, halfw * 2, 1, shade);
  }

  // Two smaller lobes so the silhouette is not a single clean dome.
  for (const [ox, oy, orad] of [[-rad * 0.72, -rad * 0.30, rad * 0.46],
    [rad * 0.66, -rad * 0.20, rad * 0.40]]) {
    for (let i = 0; i <= orad; i++) {
      const t = 1 - i / orad;
      const halfw = Math.round(orad * Math.sqrt(Math.max(0, 1 - t * t)) * 1.1);
      if (halfw <= 0) continue;
      r(ctx, cx + ox - halfw, base + oy - orad + i, halfw * 2, 1,
        i < orad * 0.35 ? leaf : leafDark);
    }
  }

  r(ctx, cx - rad, base, rad * 2, 3, leafDark);   // shaded underside
}

/** Tall grass / weeds, for the very edge of the shoulder. */
function drawGrass(ctx, W, H, dark) {
  const a = dark ? C.greenDark : C.green;
  const b = dark ? C.green : C.greenLit;
  const blades = [[2, 9], [5, 14], [8, 11], [11, 16], [14, 10], [17, 13], [20, 8]];
  for (const [x, h] of blades) {
    if (x >= W - 1) continue;
    r(ctx, x, H - h, 2, h, x % 3 === 0 ? b : a);
    r(ctx, x + (x % 2 ? 1 : -1), H - h - 3, 1, 4, a);
  }
  r(ctx, 0, H - 3, W, 3, C.greenDark);
}

function drawRock(ctx, W, H) {
  r(ctx, 6, H - 30, W - 12, 30, C.grey);
  r(ctx, 12, H - 42, W - 26, 14, C.grey);
  r(ctx, 13, H - 42, W - 30, 5, C.greyLit);
  r(ctx, 8, H - 28, 10, 8, C.greyLit);
  r(ctx, 8, H - 16, 12, 12, C.greyDark);
  r(ctx, W - 22, H - 24, 14, 14, C.greyDark);
  r(ctx, W - 14, H - 36, 7, 9, C.greyLit);
  r(ctx, 20, H - 20, 6, 5, C.greyDark);
}

function drawSign(ctx, W, H) {
  const boardH = H - 30;
  rSym(ctx, W, (W >> 1) - 4, boardH - 4, 8, 34, C.greyDark);
  r(ctx, (W >> 1) - 4, boardH - 4, 3, 34, C.grey);
  r(ctx, 2, 2, W - 4, boardH, C.green);
  r(ctx, 2, 2, W - 4, 3, C.greenLit);
  r(ctx, 4, 5, W - 8, boardH - 6, C.greenDark);
  // White border.
  r(ctx, 7, 8, W - 14, 2, C.white);
  r(ctx, 7, boardH - 6, W - 14, 2, C.white);
  r(ctx, 7, 8, 2, boardH - 16, C.white);
  r(ctx, W - 9, 8, 2, boardH - 16, C.white);
  // Two lines of abstract lettering plus an exit arrow.
  let x = 13;
  for (const wl of [4, 3, 5]) { r(ctx, x, 14, wl * 4, 5, C.white); x += wl * 4 + 5; }
  x = 13;
  for (const wl of [3, 6]) { r(ctx, x, 24, wl * 4, 5, C.white); x += wl * 4 + 5; }
  r(ctx, W - 22, 22, 12, 3, C.white);
  tri(ctx, W - 12, 18, W - 12, 29, W - 5, 23.5, C.white);
}

function drawCone(ctx, W, H) {
  r(ctx, 1, H - 6, W - 2, 6, C.orange);
  r(ctx, 1, H - 6, W - 2, 2, C.orangeLit);
  r(ctx, 5, H - 18, W - 10, 12, C.orange);
  r(ctx, 6, H - 15, W - 12, 4, C.white);
  tri(ctx, (W >> 1) - 4, H - 18, (W >> 1) + 4, H - 18, (W >> 1), 2, C.orange);
  r(ctx, (W >> 1) - 2, H - 26, 4, 5, C.white);
}

function drawBarrier(ctx, W, H) {
  r(ctx, 0, H - 16, W, 10, C.white);
  r(ctx, 0, H - 16, W, 3, C.greyLit);
  for (let x = 0; x < W; x += 16) r(ctx, x, H - 16, 8, 10, C.red);
  rSym(ctx, W, 4, H - 8, 6, 8, C.greyDark);
}

/**
 * Billboards.  Six designs, because one repeated board every few hundred feet
 * is the fastest way to make a highway look fake.
 */
function drawBillboard(ctx, W, H, variant) {
  const boardH = H - 26;
  // Frame and face.
  r(ctx, 0, 0, W, boardH, C.steelDark);
  r(ctx, 3, 3, W - 6, boardH - 6, C.greyLit);

  const face = (bg) => r(ctx, 3, 3, W - 6, boardH - 6, bg);
  const band = (y, h, c, inset = 8) => r(ctx, inset, y, W - inset * 2, h, c);

  switch (variant) {
    case 0:   // Big yellow special, red banner.
      face(C.yellow);
      band(8, 12, C.red);
      band(26, 8, C.black, 10);
      band(40, 8, C.black, 10);
      r(ctx, W - 30, 26, 20, 22, C.redDark);
      break;
    case 1:   // Blue with a white disc logo.
      face(C.blue);
      r(ctx, 12, 12, 30, 30, C.white);
      r(ctx, 18, 18, 18, 18, C.blueDark);
      band(14, 7, C.white, 50);
      band(26, 7, C.white, 50);
      band(38, 7, C.white, 50);
      break;
    case 2:   // Green, split panel, pierogi-adjacent.
      face(C.greenDark);
      r(ctx, 6, 6, (W - 12) / 2, boardH - 12, C.green);
      band(12, 9, C.white, 12);
      band(26, 6, C.white, 12);
      r(ctx, W / 2 + 6, 12, W / 2 - 18, boardH - 24, C.yellow);
      r(ctx, W / 2 + 12, 20, W / 2 - 30, 10, C.brownDark);
      break;
    case 3:   // Black board, white type, minimal.
      face(C.black);
      band(10, 10, C.white, 10);
      band(26, 6, C.grey, 10);
      band(36, 6, C.grey, 10);
      r(ctx, W - 26, 10, 16, 16, C.orange);
      break;
    case 4:   // Diagonal stripes, tyre-shop energy.
      face(C.white);
      for (let x = -boardH; x < W; x += 18) {
        ctx.fillStyle = C.red;
        ctx.beginPath();
        ctx.moveTo(x, boardH - 4);
        ctx.lineTo(x + 9, boardH - 4);
        ctx.lineTo(x + 9 + boardH, 4);
        ctx.lineTo(x + boardH, 4);
        ctx.closePath();
        ctx.fill();
      }
      r(ctx, 10, 18, W - 20, 16, C.black);
      r(ctx, 14, 22, W - 28, 8, C.yellow);
      break;
    default:  // See the incline: gold on dark, a diagonal cable.
      face(C.steelDark);
      r(ctx, 6, 6, W - 12, boardH - 12, C.brownDark);
      ctx.strokeStyle = C.yellow;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(10, boardH - 10);
      ctx.lineTo(W - 12, 12);
      ctx.stroke();
      r(ctx, W / 2 - 6, boardH / 2 - 6, 14, 12, C.red);
      band(boardH - 18, 7, C.yellow, 12);
      break;
  }

  // Catwalk and lamps along the bottom of the face.
  r(ctx, 2, boardH - 4, W - 4, 3, C.steelDark);
  for (let x = 8; x < W - 8; x += 18) r(ctx, x, boardH - 6, 5, 3, C.yellow);

  // Legs last, so they read as legs rather than as edges of the board.
  rSym(ctx, W, 10, boardH - 2, 8, 28, C.brownDark);
  rSym(ctx, W, 10, boardH - 2, 3, 28, C.brown);
  r(ctx, 14, boardH + 12, W - 28, 4, C.brownDark);   // cross brace

  const lamps = [];
  for (let x = 8; x < W - 8; x += 18) {
    lamps.push({ x: x / W, y: (boardH - 8) / H, w: 6 / W, h: 5 / H,
      c: 'rgba(255,238,150,0.55)' });
  }
  return lamps;
}

function drawPylon(ctx, W, H) {
  r(ctx, (W >> 1) - 4, 0, 8, H, C.steelDark);
  r(ctx, (W >> 1) - 4, 0, 3, H, C.steel);
  for (const [y, w] of [[8, 0], [26, 4], [46, 8]]) {
    r(ctx, 4 + w, y, W - 8 - w * 2, 5, C.steelDark);
    rSym(ctx, W, 4 + w, y - 5, 4, 6, C.steelDark);
  }
  // Insulators.
  rSym(ctx, W, 6, 13, 4, 6, C.greyLit);
  rSym(ctx, W, 10, 31, 4, 6, C.greyLit);
}

/**
 * Roadside delineator post.
 *
 * The little white posts with a reflector band that line every real highway
 * shoulder.  They are the single cheapest way to make a road read as a road:
 * regularly spaced, they give the eye a metronome for speed, and after dark
 * their reflectors are the first thing the headlights pick out.
 */
function drawDelineator(ctx, W, H, amber) {
  r(ctx, (W >> 1) - 3, 4, 6, H - 4, C.white);
  r(ctx, (W >> 1) - 3, 4, 2, H - 4, C.greyLit);
  r(ctx, (W >> 1) + 1, 4, 2, H - 4, C.grey);
  r(ctx, (W >> 1) - 4, H - 4, 8, 4, C.greyDark);
  const lens = amber ? C.tailAmber : C.tail;
  r(ctx, (W >> 1) - 4, 9, 8, 9, C.greyDark);
  r(ctx, (W >> 1) - 3, 10, 6, 7, lens);
  r(ctx, (W >> 1) - 2, 11, 3, 3, C.white);
  return [{ x: ((W >> 1) - 3) / W, y: 10 / H, w: 6 / W, h: 7 / H,
    c: amber ? 'rgba(255,190,60,0.95)' : 'rgba(255,70,40,0.95)' }];
}

/** Cobra-head streetlight, for stages after dark. */
function drawStreetlight(ctx, W, H, flip) {
  const px = flip ? W - 12 : 4;
  const dir = flip ? -1 : 1;
  r(ctx, px, 14, 8, H - 14, C.steelDark);
  r(ctx, px + (flip ? 5 : 0), 14, 3, H - 14, C.steel);
  // Arm curving over the road.
  for (let i = 0; i < 7; i++) {
    r(ctx, px + dir * (i * 5), 14 - Math.round(Math.sin((i / 7) * 1.4) * 9), 6, 5, C.steelDark);
  }
  const hx = px + dir * 32;
  r(ctx, hx - 8, 3, 18, 8, C.steelDark);
  r(ctx, hx - 7, 9, 16, 4, C.yellow);
  return [{ x: (hx - 7) / W, y: 9 / H, w: 16 / W, h: 5 / H, c: 'rgba(255,236,160,0.9)' }];
}

// ------------------------------------------------------------------ pickups

/** Fuel globe: the thing standing between you and the shoulder of the road. */
function drawGlobe(ctx, W, H, phase) {
  const cx = W >> 1;
  const cy = Math.round(H * 0.42);
  const rad = Math.round(Math.min(W, H) * 0.34 + Math.sin(phase * Math.PI * 2) * 2);
  for (let y = -rad; y <= rad; y++) {
    const halfw = Math.round(Math.sqrt(Math.max(0, rad * rad - y * y)));
    const t = (y + rad) / (2 * rad);
    const col = t < 0.22 ? C.white : t < 0.45 ? C.cyan : t < 0.78 ? C.blue : C.blueDark;
    r(ctx, cx - halfw, cy + y, halfw * 2, 1, col);
  }
  r(ctx, cx - 5, cy - rad + 4, 6, 6, C.white);            // specular
  r(ctx, cx - 7, cy + 2, 14, 3, C.glassPale);             // equator band
  // Stand.
  r(ctx, cx - 3, cy + rad - 2, 6, H - (cy + rad) + 2, C.greyDark);
  r(ctx, cx - 8, H - 4, 16, 4, C.grey);
  return [{ x: (cx - rad) / W, y: (cy - rad) / H, w: (rad * 2) / W, h: (rad * 2) / H,
    c: 'rgba(120,220,255,0.55)' }];
}

/** Weapon pod, as dropped by the Rescue Cruiser. */
function drawPod(ctx, W, H, kind) {
  const tint = kind === 'nitro' ? C.orange
    : kind === 'shield' ? C.cyan
      : kind === 'missile' ? C.red : C.yellow;
  // Chute.
  r(ctx, 4, 2, W - 8, 6, tint);
  r(ctx, 8, 0, W - 16, 3, C.white);
  r(ctx, 6, 8, 3, 12, C.greyLit);
  r(ctx, W - 9, 8, 3, 12, C.greyLit);
  r(ctx, W / 2 - 1, 8, 2, 12, C.greyLit);
  // Canister.
  r(ctx, 6, H - 32, W - 12, 30, C.steel);
  r(ctx, 6, H - 32, W - 12, 4, C.steelLit);
  r(ctx, 6, H - 8, W - 12, 6, C.steelDark);
  r(ctx, 10, H - 26, W - 20, 16, tint);
  r(ctx, 12, H - 24, W - 24, 4, C.white);
  r(ctx, 12, H - 16, W - 24, 3, C.black);
  rSym(ctx, W, 2, H - 24, 5, 12, C.steelDark);
  return [{ x: 10 / W, y: (H - 26) / H, w: (W - 20) / W, h: 16 / H,
    c: 'rgba(255,255,200,0.4)' }];
}

function drawMine(ctx, W, H) {
  r(ctx, 6, H - 16, W - 12, 15, C.greyDark);
  r(ctx, 6, H - 16, W - 12, 3, C.grey);
  r(ctx, 10, H - 22, W - 20, 8, C.grey);
  r(ctx, 12, H - 21, W - 24, 3, C.greyLit);
  r(ctx, (W >> 1) - 4, H - 28, 8, 8, C.red);
  r(ctx, (W >> 1) - 3, H - 27, 4, 3, C.tailLit);
  rSym(ctx, W, 1, H - 20, 6, 4, C.steelDark);
  rSym(ctx, W, 2, H - 6, 5, 5, C.steelDark);
  return [{ x: 0.4, y: (H - 28) / H, w: 0.2, h: 8 / H, c: 'rgba(255,40,20,0.8)' }];
}

/** The X-1 Rescue Cruiser.  Brings guns.  Does not bring a tow. */
function drawPlane(ctx, W, H) {
  const cx = W >> 1;
  r(ctx, cx - 9, 8, 18, H - 18, C.steel);               // fuselage
  r(ctx, cx - 7, 8, 6, H - 18, C.steelLit);
  r(ctx, cx + 4, 8, 5, H - 18, C.steelDark);
  tri(ctx, cx - 9, 10, cx + 9, 10, cx, 0, C.steel);     // nose
  r(ctx, 4, (H >> 1) - 6, W - 8, 11, C.steel);          // main wing
  r(ctx, 4, (H >> 1) - 6, W - 8, 4, C.steelLit);
  r(ctx, 4, (H >> 1) + 2, W - 8, 3, C.steelDark);
  r(ctx, cx - 22, H - 18, 44, 6, C.steelDark);          // tailplane
  r(ctx, cx - 22, H - 18, 44, 2, C.steel);
  r(ctx, cx - 4, H - 14, 8, 14, C.steelDark);           // fin
  r(ctx, cx - 7, 12, 14, 8, C.glassLit);                // canopy
  r(ctx, cx - 6, 13, 12, 3, C.glassPale);
  rSym(ctx, W, 16, (H >> 1) - 10, 11, 18, C.steelDark); // engines
  rSym(ctx, W, 18, (H >> 1) - 8, 7, 5, C.chromeDark);
  r(ctx, 6, (H >> 1) - 2, 6, 4, C.tail);                // nav lights
  r(ctx, W - 12, (H >> 1) - 2, 6, 4, C.greenLit);
  r(ctx, cx - 2, H - 4, 4, 4, C.white);
  return [
    { x: 6 / W, y: ((H >> 1) - 2) / H, w: 6 / W, h: 4 / H, c: 'rgba(255,50,30,0.9)' },
    { x: (W - 12) / W, y: ((H >> 1) - 2) / H, w: 6 / W, h: 4 / H, c: 'rgba(80,255,120,0.9)' },
  ];
}

/**
 * Overhead sign gantry.
 *
 * Hollow through the middle like the finish banner, for the same reason: you
 * drive under it, and a solid one would black out the road on approach.
 */
function drawGantry(ctx, W, H) {
  // Legs.
  rSym(ctx, W, 3, 26, 10, H - 26, C.steelDark);
  rSym(ctx, W, 3, 26, 4, H - 26, C.steel);
  rSym(ctx, W, 1, H - 4, 14, 4, C.greyDark);
  for (let y = 34; y < H - 6; y += 14) rSym(ctx, W, 3, y, 10, 3, C.chromeDark);
  // Truss beam across the top.
  r(ctx, 0, 4, W, 5, C.steelDark);
  r(ctx, 0, 20, W, 5, C.steelDark);
  for (let x = 4; x < W - 4; x += 14) {
    r(ctx, x, 9, 3, 11, C.steelDark);
    r(ctx, x + 7, 9, 3, 11, C.chromeDark);
  }
  // Two green sign boards hanging off it.
  for (const [bx, bw] of [[16, 62], [W - 78, 62]]) {
    r(ctx, bx, 8, bw, 22, C.greenDark);
    r(ctx, bx, 8, bw, 2, C.green);
    r(ctx, bx + 3, 11, bw - 6, 2, C.white);
    r(ctx, bx + 3, 25, bw - 6, 2, C.white);
    let tx = bx + 7;
    for (const wl of [4, 3, 5]) { r(ctx, tx, 15, wl * 3, 4, C.white); tx += wl * 3 + 4; }
  }
  return [
    { x: 20 / W, y: 30 / H, w: 8 / W, h: 3 / H, c: 'rgba(255,238,150,0.6)' },
    { x: (W - 30) / W, y: 30 / H, w: 8 / W, h: 3 / H, c: 'rgba(255,238,150,0.6)' },
  ];
}

// ---------------------------------------------------------------- finish line

function drawBanner(ctx, W, H) {
  // Legs, hollow middle: you drive under this, so the centre must stay clear.
  rSym(ctx, W, 4, 22, 13, H - 22, C.steelDark);
  rSym(ctx, W, 4, 22, 5, H - 22, C.steel);
  rSym(ctx, W, 2, H - 6, 17, 6, C.greyDark);
  // Lattice bracing on the legs.
  for (let y = 30; y < H - 8; y += 12) {
    rSym(ctx, W, 4, y, 13, 3, C.chromeDark);
  }
  // Checkered header.
  r(ctx, 0, 0, W, 20, C.red);
  for (let x = 0; x < W; x += 24) r(ctx, x, 0, 12, 20, C.white);
  r(ctx, 0, 0, W, 3, C.chromeDark);
  // Sign board slung under the header.
  r(ctx, 30, 20, W - 60, 14, C.black);
  r(ctx, 34, 23, W - 68, 7, C.yellow);
}

// -------------------------------------------------------------------- export

/** Populated by buildSprites(); consumed by the renderer. */
export const SPR = {};

let built = false;

/** Bake every sprite.  Idempotent. */
export function buildSprites() {
  if (built) return SPR;
  built = true;

  // Player: five lean frames so hard steering reads on screen.
  // Five yaw frames from full left lock to full right lock.
  SPR.van = [];
  for (let i = 0; i < 5; i++) {
    const turn = (i - 2) / 2;
    const f = composeVanFrame(88, 82, turn);
    SPR.van.push({
      canvas: f.canvas, w: 88, h: 82, worldW: 0.38, aspect: 82 / 88,
      lamps: f.lamps, shadow: 0,
    });
  }

  const car = (w, h, worldW, opts) => {
    let lamps = null;
    const s = bake(w, h, worldW, (c) => { lamps = drawCar(c, w, h, opts); }, null, 0.82);
    s.lamps = lamps;
    return s;
  };

  const RED = { body: C.red, dark: C.redDark, lit: C.redLit };
  const BLUE = { body: C.blue, dark: C.blueDark, lit: C.blueLit };
  const ARMY = { body: C.army, dark: C.armyDark, lit: C.greenLit };
  const GREY = { body: C.grey, dark: C.greyDark, lit: C.greyLit };

  SPR.sedanRear = car(72, 52, 0.36, { ...RED, facing: 'rear', shape: 'sedan' });
  SPR.sedanFront = car(72, 52, 0.36, { ...RED, facing: 'front', shape: 'sedan' });
  SPR.coupeRear = car(68, 48, 0.34, { ...BLUE, facing: 'rear', shape: 'coupe' });
  SPR.coupeFront = car(68, 48, 0.34, { ...BLUE, facing: 'front', shape: 'coupe' });
  SPR.commandRear = car(88, 60, 0.46, { ...ARMY, facing: 'rear', shape: 'truck' });
  SPR.commandFront = car(88, 60, 0.46, { ...ARMY, facing: 'front', shape: 'truck' });
  SPR.civicRear = car(68, 50, 0.35, { ...GREY, facing: 'rear', shape: 'sedan' });
  SPR.civicFront = car(68, 50, 0.35, { ...GREY, facing: 'front', shape: 'sedan' });

  let lamps = null;
  SPR.cycle = bake(44, 62, 0.18, (c) => { lamps = drawCycle(c, 44, 62); }, null, 0.52);
  SPR.cycle.lamps = lamps;
  SPR.turret = bake(56, 62, 0.30, (c) => { lamps = drawTurret(c, 56, 62); }, null, 0.86);
  SPR.turret.lamps = lamps;

  SPR.tree = bake(80, 104, 0.62, (c) => drawTree(c, 80, 104, false), null, 0.40);
  SPR.treeDark = bake(80, 104, 0.62, (c) => drawTree(c, 80, 104, true), null, 0.40);
  SPR.pine = bake(64, 116, 0.52, (c) => drawPine(c, 64, 116, false), null, 0.42);
  SPR.pineDark = bake(64, 116, 0.52, (c) => drawPine(c, 64, 116, true), null, 0.42);
  SPR.deadTree = bake(72, 96, 0.56, (c) => drawDeadTree(c, 72, 96));
  SPR.bush = bake(48, 32, 0.36, (c) => drawBush(c, 48, 32, false), null, 0.78);
  SPR.bushDark = bake(48, 32, 0.36, (c) => drawBush(c, 48, 32, true), null, 0.78);
  SPR.grass = bake(24, 22, 0.18, (c) => drawGrass(c, 24, 22, false));
  SPR.grassDark = bake(24, 22, 0.18, (c) => drawGrass(c, 24, 22, true));
  SPR.rock = bake(56, 48, 0.34, (c) => drawRock(c, 56, 48), null, 0.84);
  SPR.sign = bake(68, 68, 0.40, (c) => drawSign(c, 68, 68));
  SPR.cone = bake(24, 32, 0.12, (c) => drawCone(c, 24, 32), null, 0.75);
  SPR.barrier = bake(80, 28, 0.44, (c) => drawBarrier(c, 80, 28));
  SPR.pylon = bake(48, 128, 0.34, (c) => drawPylon(c, 48, 128));

  // Six billboard designs.
  SPR.billboards = [];
  for (let v = 0; v < 6; v++) {
    let bl = null;
    const s = bake(104, 80, 0.70, (c) => { bl = drawBillboard(c, 104, 80, v); });
    s.lamps = bl;
    SPR.billboards.push(s);
    SPR[`billboard${v}`] = s;
  }

  let dl = null;
  SPR.postL = bake(16, 46, 0.13, (c) => { dl = drawDelineator(c, 16, 46, false); });
  SPR.postL.lamps = dl;
  SPR.postR = bake(16, 46, 0.13, (c) => { dl = drawDelineator(c, 16, 46, true); });
  SPR.postR.lamps = dl;

  SPR.streetlight = bake(96, 128, 1.05, (c) => { lamps = drawStreetlight(c, 96, 128, false); });
  SPR.streetlight.lamps = lamps;
  SPR.streetlightR = bake(96, 128, 1.05, (c) => { lamps = drawStreetlight(c, 96, 128, true); });
  SPR.streetlightR.lamps = lamps;

  SPR.globe = [];
  for (let i = 0; i < 4; i++) {
    let gl = null;
    const s = bake(44, 52, 0.24, (c) => { gl = drawGlobe(c, 44, 52, i / 4); });
    s.lamps = gl;
    SPR.globe.push(s);
  }

  for (const [key, kind] of [['podUz', 'uz'], ['podSpread', 'spread'],
    ['podMissile', 'missile'], ['podNitro', 'nitro'], ['podShield', 'shield']]) {
    let pl = null;
    SPR[key] = bake(52, 56, 0.28, (c) => { pl = drawPod(c, 52, 56, kind); });
    SPR[key].lamps = pl;
  }

  SPR.mine = bake(40, 32, 0.20, (c) => { lamps = drawMine(c, 40, 32); }, null, 0.85);
  SPR.mine.lamps = lamps;
  SPR.plane = bake(128, 68, 1.30, (c) => { lamps = drawPlane(c, 128, 68); });
  SPR.plane.lamps = lamps;
  SPR.banner = bake(192, 88, 2.10, (c) => drawBanner(c, 192, 88));
  SPR.gantry = bake(208, 96, 2.35, (c) => { lamps = drawGantry(c, 208, 96); });
  SPR.gantry.lamps = lamps;

  return SPR;
}

export { C as SPRITE_COLORS };
