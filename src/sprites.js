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
function bake(w, h, worldW, draw, lamps = null) {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  draw(ctx);
  return { canvas, w, h, worldW, aspect: h / w, lamps };
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
 * A 1994 Dodge Caravan from behind, at 100x78.
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
function drawCaravan(ctx, W, H, lean) {
  const bx = Math.round(lean * 4);
  const rx = Math.round(lean * 2);
  const mid = W >> 1;

  // Explicit horizontal bands, top to bottom.  Deriving these from H made it
  // far too easy to land the licence plate on the bumper.
  const RACK = 2;
  const ROOF = 5;
  const BELT = 14;        // top of the taillights and the glass surround
  const GLASS_T = 17;
  const GLASS_B = 35;
  const SURROUND_B = 38;
  const HANDLE = 39;
  const PLATE_T = 42;
  const PLATE_B = 51;
  const BUMPER_T = 52;
  const BUMPER_B = 66;
  const VALANCE_B = 72;
  const LIGHT_B = BUMPER_T;

  // ---- tyres -----------------------------------------------------------
  // Only the outer bottom corners show past the bodywork.  Drawing these as
  // big blocks is what used to make the van read as a safari truck.
  for (const wx of [3, W - 15]) {
    r(ctx, wx + 1, 60, 10, 17, C.tyreDark);
    r(ctx, wx, 63, 12, 14, C.tyreDark);
    r(ctx, wx + 1, 64, 10, 12, C.tyre);
    r(ctx, wx + 2, 70, 8, 5, C.greyDark);
    r(ctx, wx + 3, 71, 6, 3, C.chromeDark);
  }

  // ---- valance and bumper ---------------------------------------------
  r(ctx, 8 + bx, BUMPER_B, W - 16, VALANCE_B - BUMPER_B, C.tanShadow);
  r(ctx, 62 + bx, BUMPER_B + 2, 12, 4, C.chromeDark);   // exhaust cutout
  r(ctx, 64 + bx, BUMPER_B + 3, 8, 2, C.black);

  r(ctx, 1 + bx, BUMPER_T, W - 2, BUMPER_B - BUMPER_T, C.tanDark);
  r(ctx, 1 + bx, BUMPER_T, W - 2, 3, C.tanMid);         // top face
  r(ctx, 1 + bx, BUMPER_B - 3, W - 2, 3, C.tanShadow);
  r(ctx, 4 + bx, BUMPER_T + 6, W - 8, 4, C.chromeDark); // rub strip
  r(ctx, 4 + bx, BUMPER_T + 6, W - 8, 1, C.chrome);
  rSym(ctx, W, 1 + bx, BUMPER_T, 5, BUMPER_B - BUMPER_T, C.tanShadow);

  // ---- body ------------------------------------------------------------
  r(ctx, 3 + bx, 12, W - 6, BUMPER_T - 12, C.tan);
  r(ctx, 3 + bx, 12, W - 6, 3, C.tanLit);
  rSym(ctx, W, 3 + bx, 12, 3, BUMPER_T - 12, C.tanMid);  // side radius
  r(ctx, 3 + bx, BUMPER_T - 3, W - 6, 3, C.tanMid);

  // ---- roof, spoiler and rack -----------------------------------------
  r(ctx, 9 + rx, ROOF, W - 18, 8, C.tan);
  r(ctx, 9 + rx, ROOF, W - 18, 2, C.tanLit);
  r(ctx, 7 + rx, 10, W - 14, 4, C.tanMid);               // spoiler lip
  r(ctx, mid - 9 + rx, ROOF + 2, 18, 3, C.tailDeep);     // third brake light
  r(ctx, mid - 8 + rx, ROOF + 3, 16, 1, C.tail);
  r(ctx, 20 + rx, RACK, W - 40, 2, C.grey);              // low-profile rails
  r(ctx, 20 + rx, RACK, W - 40, 1, C.greyLit);
  rSym(ctx, W, 19 + rx, RACK + 1, 4, 3, C.greyDark);

  // ---- liftgate glass --------------------------------------------------
  r(ctx, 15 + bx, BELT, W - 30, SURROUND_B - BELT, C.black);   // rubber surround
  r(ctx, 18 + bx, GLASS_T, W - 36, GLASS_B - GLASS_T, C.glass);
  r(ctx, 19 + bx, GLASS_T + 1, W - 38, 5, C.glassLit);         // sky reflection
  for (let i = 0; i < 5; i++) {
    r(ctx, 21 + bx, GLASS_T + 8 + i * 3, W - 42, 1, C.glassDark); // defroster
  }
  r(ctx, 20 + bx, GLASS_B - 6, 12, 5, C.glassPale);            // smear
  r(ctx, mid - 14 + bx, GLASS_B + 1, 28, 2, C.greyDark);       // wiper blade
  r(ctx, mid - 14 + bx, GLASS_B - 3, 2, 5, C.greyDark);        // wiper arm
  r(ctx, mid - 3 + bx, BELT - 2, 6, 3, C.greyDark);            // washer nozzle

  // ---- taillights ------------------------------------------------------
  // Corner to corner, beltline to bumper.  Amber turn on top, red brake
  // through the middle, clear reverse at the bottom.  Nothing else on the
  // road has lamps this tall.
  for (const lx of [3, W - 17]) {
    r(ctx, lx + bx, BELT, 14, LIGHT_B - BELT, C.tailDeep);
    r(ctx, lx + 1 + bx, BELT + 1, 12, LIGHT_B - BELT - 2, C.tail);
    r(ctx, lx + 1 + bx, BELT + 1, 12, 8, C.tailAmber);
    r(ctx, lx + 1 + bx, BELT + 9, 12, 1, C.tailDeep);
    r(ctx, lx + 1 + bx, LIGHT_B - 8, 12, 1, C.tailDeep);
    r(ctx, lx + 1 + bx, LIGHT_B - 7, 12, 6, C.white);          // reverse lamp
    r(ctx, lx + 3 + bx, BELT + 14, 4, 8, C.tailLit);           // lens highlight
    r(ctx, lx + 6 + bx, BELT + 12, 1, LIGHT_B - BELT - 24, C.tailLit);
  }

  // ---- liftgate furniture ---------------------------------------------
  r(ctx, mid - 22 + bx, HANDLE, 44, 3, C.chrome);              // handle bar
  r(ctx, mid - 22 + bx, HANDLE, 44, 1, C.chromeLit);
  r(ctx, mid + 18 + bx, HANDLE + 1, 4, 3, C.greyDark);         // keyhole
  r(ctx, mid - 6 + bx, PLATE_T - 2, 12, 2, C.greyLit);         // plate lamp
  r(ctx, mid - 14 + bx, PLATE_T, 28, PLATE_B - PLATE_T, C.chromeDark);
  r(ctx, mid - 13 + bx, PLATE_T + 1, 26, PLATE_B - PLATE_T - 2, C.white);
  r(ctx, mid - 11 + bx, PLATE_T + 3, 22, PLATE_B - PLATE_T - 6, C.greyDark);
  for (let i = 0; i < 4; i++) {
    r(ctx, mid - 9 + bx + i * 5, PLATE_T + 4, 3, PLATE_B - PLATE_T - 8, C.white);
  }

  // Badging: DODGE left of the plate, CARAVAN right.  Illegible, correct.
  for (let i = 0; i < 4; i++) r(ctx, 21 + bx + i * 3, PLATE_T + 3, 2, 3, C.chromeDark);
  for (let i = 0; i < 5; i++) r(ctx, W - 36 + bx + i * 3, PLATE_T + 3, 2, 3, C.chromeDark);

  // ---- rust ------------------------------------------------------------
  // Enough to date the thing; not so much that it reads as camouflage.
  r(ctx, 5 + bx, BUMPER_T - 10, 9, 6, C.rust);
  r(ctx, 6 + bx, BUMPER_T - 8, 5, 3, C.rustDark);
  r(ctx, W - 18 + bx, BUMPER_T - 9, 6, 4, C.rustDark);
  r(ctx, 11 + bx, BUMPER_B - 5, 5, 3, C.rustDark);
  r(ctx, W - 26 + bx, BUMPER_T + 2, 4, 3, C.rust);

  // ---- the roof-mounted cannon.  Not factory. --------------------------
  r(ctx, mid - 10 + rx, RACK, 20, 5, C.steelDark);             // mount plate
  rSym(ctx, W, mid - 10 + rx, RACK, 3, 5, C.chromeDark);       // bolts
  r(ctx, mid - 5 + rx, 0, 10, 4, C.steel);
  r(ctx, mid - 3 + rx, 0, 6, 3, C.steelDark);
  r(ctx, mid - 1 + rx, 0, 2, 2, C.chromeLit);
}

/** Where the van's lamps sit, for the night-lighting pass. */
const VAN_LAMPS = [
  { x: 0.03, y: 0.18, w: 0.14, h: 0.49, c: 'rgba(255,70,30,0.55)' },
  { x: 0.83, y: 0.18, w: 0.14, h: 0.49, c: 'rgba(255,70,30,0.55)' },
  { x: 0.41, y: 0.09, w: 0.18, h: 0.04, c: 'rgba(255,60,25,0.5)' },
];

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

function drawTree(ctx, W, H, dark) {
  const trunk = dark ? C.brownDark : C.brown;
  const trunkLit = dark ? C.brown : C.brownLit;
  const leaf = dark ? C.greenDark : C.green;
  const leafLit = dark ? C.green : C.greenLit;
  const leafDark = C.greenDark;

  r(ctx, (W >> 1) - 6, H - 26, 12, 26, trunk);
  r(ctx, (W >> 1) - 6, H - 26, 4, 26, trunkLit);
  r(ctx, (W >> 1) + 2, H - 26, 4, 26, C.brownDark);
  r(ctx, (W >> 1) - 12, H - 4, 24, 4, trunk);            // root flare

  // Canopy as stacked slabs, lighter at the top.
  const bands = [[19, 9], [14, 11], [9, 13], [5, 14], [2, 15], [7, 12]];
  let y = 4;
  for (let i = 0; i < bands.length; i++) {
    const [inset, hh] = bands[i];
    r(ctx, inset, y, W - inset * 2, hh, leaf);
    r(ctx, inset + 2, y, W - inset * 2 - 4, 3, leafLit);
    r(ctx, inset, y + hh - 3, W - inset * 2, 3, leafDark);
    y += hh - 3;
  }
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
  SPR.van = [];
  for (let i = 0; i < 5; i++) {
    const lean = (i - 2) / 2;
    SPR.van.push(bake(100, 78, 0.44, (ctx) => drawCaravan(ctx, 100, 78, lean), VAN_LAMPS));
  }

  const car = (w, h, worldW, opts) => {
    let lamps = null;
    const s = bake(w, h, worldW, (c) => { lamps = drawCar(c, w, h, opts); });
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
  SPR.cycle = bake(44, 62, 0.18, (c) => { lamps = drawCycle(c, 44, 62); });
  SPR.cycle.lamps = lamps;
  SPR.turret = bake(56, 62, 0.30, (c) => { lamps = drawTurret(c, 56, 62); });
  SPR.turret.lamps = lamps;

  SPR.tree = bake(80, 104, 0.62, (c) => drawTree(c, 80, 104, false));
  SPR.treeDark = bake(80, 104, 0.62, (c) => drawTree(c, 80, 104, true));
  SPR.rock = bake(56, 48, 0.34, (c) => drawRock(c, 56, 48));
  SPR.sign = bake(68, 68, 0.40, (c) => drawSign(c, 68, 68));
  SPR.cone = bake(24, 32, 0.12, (c) => drawCone(c, 24, 32));
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

  SPR.mine = bake(40, 32, 0.20, (c) => { lamps = drawMine(c, 40, 32); });
  SPR.mine.lamps = lamps;
  SPR.plane = bake(128, 68, 1.30, (c) => { lamps = drawPlane(c, 128, 68); });
  SPR.plane.lamps = lamps;
  SPR.banner = bake(192, 88, 2.10, (c) => drawBanner(c, 192, 88));
  SPR.gantry = bake(208, 96, 2.35, (c) => { lamps = drawGantry(c, 208, 96); });
  SPR.gantry.lamps = lamps;

  return SPR;
}

export { C as SPRITE_COLORS };
