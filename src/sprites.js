/*
 * Sprites.
 *
 * All artwork is generated at load time into offscreen canvases from
 * rectangle primitives, so the game ships as pure code with no asset
 * pipeline.  Everything is drawn at 1:1 pixel scale and then blitted with
 * smoothing disabled, which keeps the chunky arcade look at any window size.
 *
 * Colours come from palette.q(), i.e. every pixel is a colour the Atari
 * System 1 CRAM could actually hold.
 */

import { q } from './palette.js';

const C = {
  // The van.  Tan.  Aggressively tan.
  tan: q('fca7'), tanLit: q('fdb8'), tanDark: q('bca7'), tanShadow: q('8ba6'),
  rust: q('e841'), rustDark: q('a731'),
  glass: q('a248'), glassLit: q('c46a'), glassDark: q('6135'),
  tail: q('ff20'), tailLit: q('ff64'), tailAmber: q('fd82'),
  head: q('ffed'), headDim: q('cba7'),
  chrome: q('caaa'), chromeLit: q('eccc'), tyre: q('4333'), tyreLit: q('7555'),
  black: q('0000'), shadow: q('3111'),

  red: q('fe20'), redDark: q('a520'), redLit: q('ff75'),
  blue: q('f24e'), blueDark: q('a13a'), blueLit: q('f68f'),
  grey: q('9888'), greyDark: q('6555'), greyLit: q('ccbb'),
  green: q('e373'), greenDark: q('9251'), greenLit: q('f7a5'),
  brown: q('c741'), brownDark: q('8530'),
  yellow: q('ffe3'), white: q('ffff'), cyan: q('f6ef'), orange: q('fd71'),
  purple: q('e63c'), army: q('a562'), armyDark: q('7341'),
  snow: q('feee'), steel: q('b899'), steelDark: q('7666'), steelLit: q('deee'),
};

/** @returns {HTMLCanvasElement} */
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
 */
function bake(w, h, worldW, draw) {
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  draw(ctx);
  return { canvas, w, h, worldW, aspect: h / w };
}

/** Filled rectangle helper; all art is built from these. */
const r = (ctx, x, y, w, h, color) => {
  ctx.fillStyle = color;
  ctx.fillRect(x | 0, y | 0, Math.max(0, w | 0), Math.max(0, h | 0));
};

/** Horizontally symmetric rectangle pair (art is drawn as a half and mirrored). */
const rSym = (ctx, W, x, y, w, h, color) => {
  r(ctx, x, y, w, h, color);
  r(ctx, W - x - w, y, w, h, color);
};

// ------------------------------------------------------------------ the van

/**
 * A 1994 Dodge Caravan, rear three-quarter-ish view, as seen from the chase
 * camera.  `lean` in [-1,1] shifts the body over the wheels so hard steering
 * reads visually.
 */
function drawCaravan(ctx, W, H, lean) {
  const bx = Math.round(lean * 2);          // body shift
  const rx = Math.round(lean * 1);          // roof leads the body a touch

  // No ground shadow baked in: the renderer draws the player's shadow
  // separately so it stays flat on the road while the van spins out.

  // Tyres stay planted; only the body leans.
  r(ctx, 2, H - 10, 8, 9, C.tyre);
  r(ctx, W - 10, H - 10, 8, 9, C.tyre);
  r(ctx, 3, H - 9, 6, 2, C.tyreLit);
  r(ctx, W - 9, H - 9, 6, 2, C.tyreLit);

  // Rocker and rear bumper.  1994 plastic, thoroughly scuffed.
  r(ctx, 3 + bx, H - 12, W - 6, 5, C.tanDark);
  r(ctx, 2 + bx, H - 15, W - 4, 4, C.chrome);
  r(ctx, 2 + bx, H - 15, W - 4, 1, C.chromeLit);
  r(ctx, 8 + bx, H - 13, 5, 2, C.greyDark);
  r(ctx, W - 14 + bx, H - 13, 6, 2, C.greyDark);

  // Body slab: tall and square, which is the entire point of a minivan.
  r(ctx, 3 + bx, 9, W - 6, H - 24, C.tan);
  r(ctx, 3 + bx, 9, W - 6, 2, C.tanLit);
  r(ctx, 3 + bx, H - 17, W - 6, 2, C.tanShadow);

  // Roof.
  r(ctx, 6 + rx, 4, W - 12, 6, C.tan);
  r(ctx, 6 + rx, 4, W - 12, 1, C.tanLit);

  // Roof rack.
  rSym(ctx, W, 8 + rx, 2, 3, 2, C.greyDark);
  r(ctx, 8 + rx, 1, W - 16, 1, C.grey);
  r(ctx, 7 + rx, 2, 1, 2, C.grey);
  r(ctx, W - 8 + rx, 2, 1, 2, C.grey);

  // Liftgate glass -- deep, because there is a lot of van under it.
  r(ctx, 8 + bx, 11, W - 16, 9, C.glass);
  r(ctx, 9 + bx, 12, W - 18, 3, C.glassLit);
  r(ctx, 9 + bx, 17, 6, 2, C.glassDark);
  r(ctx, 13 + bx, 19, 12, 1, C.greyDark);   // wiper
  r(ctx, 13 + bx, 18, 1, 2, C.greyDark);

  // Tall vertical taillights: the Caravan's one distinguishing feature.
  r(ctx, 4 + bx, 11, 4, 13, C.tail);
  r(ctx, W - 8 + bx, 11, 4, 13, C.tail);
  r(ctx, 4 + bx, 11, 4, 3, C.tailAmber);
  r(ctx, W - 8 + bx, 11, 4, 3, C.tailAmber);
  r(ctx, 5 + bx, 16, 2, 2, C.tailLit);
  r(ctx, W - 7 + bx, 16, 2, 2, C.tailLit);

  // Liftgate handle and licence plate.
  r(ctx, (W >> 1) - 8 + bx, 21, 16, 1, C.chrome);
  r(ctx, (W >> 1) - 5 + bx, 23, 10, 4, C.white);
  r(ctx, (W >> 1) - 4 + bx, 24, 8, 2, C.greyDark);

  // Rust.  Obviously.
  r(ctx, 4 + bx, H - 20, 4, 3, C.rust);
  r(ctx, W - 9 + bx, H - 19, 3, 2, C.rustDark);
  r(ctx, 5 + bx, H - 14, 2, 2, C.rustDark);

  // The roof-mounted cannon.  Not factory.
  r(ctx, (W >> 1) - 3 + rx, 1, 6, 4, C.steelDark);
  r(ctx, (W >> 1) - 1 + rx, 0, 2, 4, C.steel);
}

// ------------------------------------------------------------- generic cars

/**
 * @param {object} o
 * @param {string} o.body main colour
 * @param {string} o.dark shade colour
 * @param {string} o.lit highlight colour
 * @param {'rear'|'front'} o.facing which end you are looking at
 * @param {'sedan'|'coupe'|'truck'} o.shape
 */
function drawCar(ctx, W, H, o) {
  const roofInset = o.shape === 'coupe' ? 9 : 7;
  const roofTop = o.shape === 'truck' ? 3 : 5;
  const bodyTop = o.shape === 'truck' ? 8 : 11;

  r(ctx, 2, H - 3, W - 4, 3, C.shadow);

  // Wheels.
  r(ctx, 1, H - 8, 7, 7, C.tyre);
  r(ctx, W - 8, H - 8, 7, 7, C.tyre);

  // Cabin.
  r(ctx, roofInset, roofTop, W - roofInset * 2, bodyTop - roofTop + 2, o.body);
  r(ctx, roofInset, roofTop, W - roofInset * 2, 1, o.lit);
  r(ctx, roofInset + 2, roofTop + 2, W - (roofInset + 2) * 2, bodyTop - roofTop - 1,
    o.facing === 'rear' ? C.glass : C.glassLit);

  // Body.
  r(ctx, 2, bodyTop, W - 4, H - bodyTop - 6, o.body);
  r(ctx, 2, bodyTop, W - 4, 1, o.lit);
  r(ctx, 2, H - 9, W - 4, 3, o.dark);

  if (o.shape === 'truck') {
    // Cargo bed rails and a payload of things that will hurt you.
    r(ctx, 3, bodyTop + 2, W - 6, 2, o.dark);
    rSym(ctx, W, 4, bodyTop + 4, 4, 4, C.armyDark);
  }

  // Bumper.
  r(ctx, 1, H - 7, W - 2, 3, C.greyDark);

  if (o.facing === 'rear') {
    rSym(ctx, W, 3, H - 14, 5, 4, C.tail);
    rSym(ctx, W, 4, H - 13, 3, 2, C.tailLit);
    r(ctx, (W >> 1) - 4, H - 12, 8, 3, C.white);
  } else {
    rSym(ctx, W, 3, H - 14, 5, 4, C.head);
    rSym(ctx, W, 4, H - 13, 3, 2, C.white);
    // Grille.
    r(ctx, (W >> 1) - 6, H - 13, 12, 4, C.greyDark);
    for (let x = 0; x < 5; x++) r(ctx, (W >> 1) - 5 + x * 3, H - 12, 1, 2, C.grey);
  }
}

function drawCycle(ctx, W, H) {
  r(ctx, 3, H - 2, W - 6, 2, C.shadow);
  r(ctx, (W >> 1) - 3, H - 10, 6, 10, C.tyre);      // rear wheel
  r(ctx, (W >> 1) - 5, H - 16, 10, 7, C.red);       // body
  r(ctx, (W >> 1) - 5, H - 16, 10, 1, C.redLit);
  r(ctx, (W >> 1) - 2, H - 8, 4, 3, C.tail);        // tail light
  r(ctx, (W >> 1) - 4, H - 23, 8, 8, C.army);       // rider
  r(ctx, (W >> 1) - 3, H - 28, 6, 6, C.greyDark);   // helmet
  r(ctx, (W >> 1) - 2, H - 27, 4, 2, C.glassLit);   // visor
  rSym(ctx, W, (W >> 1) - 8, H - 22, 3, 6, C.army); // arms
}

function drawTurret(ctx, W, H) {
  r(ctx, 2, H - 3, W - 4, 3, C.shadow);
  r(ctx, 3, H - 10, W - 6, 9, C.armyDark);          // base
  r(ctx, 3, H - 10, W - 6, 2, C.army);
  r(ctx, 6, H - 20, W - 12, 11, C.army);            // turret body
  r(ctx, 6, H - 20, W - 12, 2, C.greenLit);
  r(ctx, (W >> 1) - 2, H - 26, 4, 7, C.steelDark);  // barrel
  r(ctx, (W >> 1) - 1, H - 28, 2, 3, C.steel);
  r(ctx, (W >> 1) - 4, H - 16, 8, 3, C.red);        // sensor band
  r(ctx, (W >> 1) - 3, H - 15, 2, 1, C.tailLit);
}

// ------------------------------------------------------------------ scenery

function drawTree(ctx, W, H, dark) {
  const trunk = dark ? C.brownDark : C.brown;
  const leaf = dark ? C.greenDark : C.green;
  const leafLit = dark ? C.green : C.greenLit;
  r(ctx, (W >> 1) - 3, H - 12, 6, 12, trunk);
  r(ctx, (W >> 1) - 2, H - 12, 2, 12, C.brownDark);
  // Canopy as stacked slabs.
  const bands = [[10, 12], [7, 20], [4, 26], [2, 30], [0, 22]];
  let y = 2;
  for (const [inset, hh] of bands) {
    r(ctx, inset, y, W - inset * 2, Math.round(hh * 0.34), leaf);
    r(ctx, inset + 1, y, W - inset * 2 - 2, 2, leafLit);
    y += Math.round(hh * 0.30);
  }
}

function drawRock(ctx, W, H) {
  r(ctx, 2, H - 2, W - 4, 2, C.shadow);
  r(ctx, 3, H - 14, W - 6, 14, C.grey);
  r(ctx, 6, H - 20, W - 12, 8, C.grey);
  r(ctx, 6, H - 20, W - 13, 3, C.greyLit);
  r(ctx, 4, H - 8, 5, 5, C.greyDark);
  r(ctx, W - 10, H - 12, 6, 6, C.greyDark);
}

function drawSign(ctx, W, H) {
  const boardH = H - 15;
  r(ctx, (W >> 1) - 2, boardH - 2, 4, 17, C.greyDark);  // post
  r(ctx, (W >> 1) - 2, boardH - 2, 1, 17, C.grey);
  r(ctx, 1, 1, W - 2, boardH, C.green);                 // board
  r(ctx, 1, 1, W - 2, 1, C.greenLit);
  r(ctx, 2, 2, W - 4, boardH - 2, C.greenDark);
  r(ctx, 3, 3, W - 6, 1, C.white);                      // white border
  r(ctx, 3, boardH - 2, W - 6, 1, C.white);
  r(ctx, 3, 3, 1, boardH - 4, C.white);
  r(ctx, W - 4, 3, 1, boardH - 4, C.white);
  // Two lines of abstract lettering: reads as a sign at every distance.
  let x = 6;
  for (const wlen of [4, 3, 5]) { r(ctx, x, 6, wlen * 2, 3, C.white); x += wlen * 2 + 3; }
  x = 6;
  for (const wlen of [3, 6]) { r(ctx, x, 12, wlen * 2, 3, C.white); x += wlen * 2 + 3; }
}

function drawCone(ctx, W, H) {
  r(ctx, 1, H - 3, W - 2, 3, C.orange);
  r(ctx, 3, H - 9, W - 6, 6, C.orange);
  r(ctx, 4, H - 7, W - 8, 2, C.white);
  r(ctx, (W >> 1) - 2, 1, 4, H - 9, C.orange);
}

function drawBarrier(ctx, W, H) {
  r(ctx, 0, H - 8, W, 5, C.white);
  r(ctx, 0, H - 8, W, 2, C.greyLit);
  for (let x = 0; x < W; x += 8) r(ctx, x, H - 8, 4, 5, C.red);
  rSym(ctx, W, 2, H - 4, 3, 4, C.greyDark);
}

function drawBillboard(ctx, W, H) {
  r(ctx, 0, 0, W, H - 12, C.steelDark);
  r(ctx, 2, 2, W - 4, H - 16, C.yellow);
  r(ctx, 5, 5, W - 10, 5, C.red);
  r(ctx, 5, 12, W - 20, 4, C.black);
  r(ctx, 5, 18, W - 14, 4, C.black);
  // Legs last, so they read as legs rather than as edges of the board.
  rSym(ctx, W, 5, H - 13, 4, 13, C.brownDark);
  rSym(ctx, W, 5, H - 13, 1, 13, C.brown);
}

function drawPylon(ctx, W, H) {
  r(ctx, (W >> 1) - 2, 0, 4, H, C.steelDark);
  r(ctx, 2, 4, W - 4, 3, C.steelDark);
  r(ctx, 4, 12, W - 8, 3, C.steelDark);
  r(ctx, (W >> 1) - 1, 0, 2, H, C.steel);
}

// ------------------------------------------------------------------ pickups

/** Fuel globe: the thing standing between you and the shoulder of the road. */
function drawGlobe(ctx, W, H, phase) {
  const cx = W >> 1, cy = H >> 1;
  const rad = Math.round(Math.min(W, H) * 0.36 + Math.sin(phase * Math.PI * 2) * 1.2);
  // Chunky circle from horizontal spans -- stays crisp when scaled.
  for (let y = -rad; y <= rad; y++) {
    const halfw = Math.round(Math.sqrt(Math.max(0, rad * rad - y * y)));
    const t = (y + rad) / (2 * rad);
    const col = t < 0.3 ? C.white : t < 0.65 ? C.cyan : C.blue;
    r(ctx, cx - halfw, cy + y, halfw * 2, 1, col);
  }
  r(ctx, cx - 2, cy - rad + 2, 3, 3, C.white);
  // Stand.
  r(ctx, cx - 1, cy + rad, 2, H - (cy + rad), C.greyDark);
}

/** Weapon pod, as dropped by the Rescue Cruiser. */
function drawPod(ctx, W, H, kind) {
  const tint = kind === 'nitro' ? C.orange
    : kind === 'shield' ? C.cyan
      : kind === 'missile' ? C.red : C.yellow;
  r(ctx, 2, H - 3, W - 4, 3, C.shadow);
  r(ctx, 3, H - 16, W - 6, 14, C.steel);
  r(ctx, 3, H - 16, W - 6, 2, C.steelDark);
  r(ctx, 5, H - 13, W - 10, 8, tint);
  r(ctx, 6, H - 12, W - 12, 2, C.white);
  // Chute lines.
  r(ctx, 4, H - 22, 2, 6, C.greyLit);
  r(ctx, W - 6, H - 22, 2, 6, C.greyLit);
  r(ctx, 2, H - 24, W - 4, 3, tint);
}

function drawMine(ctx, W, H) {
  r(ctx, 2, H - 2, W - 4, 2, C.shadow);
  r(ctx, 3, H - 8, W - 6, 7, C.greyDark);
  r(ctx, 5, H - 11, W - 10, 4, C.grey);
  r(ctx, (W >> 1) - 2, H - 14, 4, 4, C.red);
  rSym(ctx, W, 1, H - 10, 3, 2, C.steelDark);
}

/** The X-1 Rescue Cruiser.  Brings guns.  Does not bring a tow. */
function drawPlane(ctx, W, H) {
  const cx = W >> 1;
  r(ctx, cx - 4, 4, 8, H - 8, C.steel);            // fuselage
  r(ctx, cx - 3, 4, 6, 3, C.steelLit);
  r(ctx, 2, (H >> 1) - 3, W - 4, 5, C.steel);      // main wing
  r(ctx, 2, (H >> 1) - 3, W - 4, 2, C.greyLit);
  r(ctx, cx - 10, H - 9, 20, 3, C.steelDark);      // tailplane
  r(ctx, cx - 2, 0, 4, 6, C.steelDark);            // fin
  r(ctx, cx - 3, 6, 6, 4, C.glassLit);             // canopy
  rSym(ctx, W, 8, (H >> 1) - 5, 5, 8, C.steelDark); // engines
  r(ctx, cx - 6, H - 6, 3, 2, C.tailLit);
  r(ctx, cx + 3, H - 6, 3, 2, C.greenLit);
}

// ---------------------------------------------------------------- finish line

/*
 * The finish gantry.
 *
 * Deliberately hollow in the middle: you drive *under* this, so as it fills
 * the screen the only thing left on either side is a leg, and the header
 * band slides off the top.  A solid banner would black out the whole road on
 * the run-in to the finish line.
 */
function drawBanner(ctx, W, H) {
  // Legs.
  rSym(ctx, W, 2, 10, 6, H - 10, C.steelDark);
  rSym(ctx, W, 2, 10, 2, H - 10, C.steel);
  rSym(ctx, W, 1, H - 3, 8, 3, C.greyDark);
  // Checkered header.
  r(ctx, 0, 0, W, 9, C.red);
  for (let x = 0; x < W; x += 12) r(ctx, x, 0, 6, 9, C.white);
  // Sign board slung under the header.
  r(ctx, 14, 9, W - 28, 7, C.black);
  r(ctx, 17, 11, W - 34, 3, C.yellow);
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
    SPR.van.push(bake(44, 40, 0.40, (ctx) => drawCaravan(ctx, 44, 40, lean)));
  }

  SPR.sedanRear = bake(36, 26, 0.36, (c) => drawCar(c, 36, 26,
    { body: C.red, dark: C.redDark, lit: C.redLit, facing: 'rear', shape: 'sedan' }));
  SPR.sedanFront = bake(36, 26, 0.36, (c) => drawCar(c, 36, 26,
    { body: C.red, dark: C.redDark, lit: C.redLit, facing: 'front', shape: 'sedan' }));
  SPR.coupeRear = bake(34, 24, 0.34, (c) => drawCar(c, 34, 24,
    { body: C.blue, dark: C.blueDark, lit: C.blueLit, facing: 'rear', shape: 'coupe' }));
  SPR.coupeFront = bake(34, 24, 0.34, (c) => drawCar(c, 34, 24,
    { body: C.blue, dark: C.blueDark, lit: C.blueLit, facing: 'front', shape: 'coupe' }));
  SPR.commandRear = bake(44, 30, 0.46, (c) => drawCar(c, 44, 30,
    { body: C.army, dark: C.armyDark, lit: C.greenLit, facing: 'rear', shape: 'truck' }));
  SPR.commandFront = bake(44, 30, 0.46, (c) => drawCar(c, 44, 30,
    { body: C.army, dark: C.armyDark, lit: C.greenLit, facing: 'front', shape: 'truck' }));
  SPR.civicRear = bake(34, 25, 0.35, (c) => drawCar(c, 34, 25,
    { body: C.grey, dark: C.greyDark, lit: C.greyLit, facing: 'rear', shape: 'sedan' }));
  SPR.civicFront = bake(34, 25, 0.35, (c) => drawCar(c, 34, 25,
    { body: C.grey, dark: C.greyDark, lit: C.greyLit, facing: 'front', shape: 'sedan' }));

  SPR.cycle = bake(22, 30, 0.18, (c) => drawCycle(c, 22, 30));
  SPR.turret = bake(28, 30, 0.30, (c) => drawTurret(c, 28, 30));

  SPR.tree = bake(40, 52, 0.62, (c) => drawTree(c, 40, 52, false));
  SPR.treeDark = bake(40, 52, 0.62, (c) => drawTree(c, 40, 52, true));
  SPR.rock = bake(28, 24, 0.34, (c) => drawRock(c, 28, 24));
  SPR.sign = bake(34, 34, 0.40, (c) => drawSign(c, 34, 34));
  SPR.cone = bake(12, 16, 0.12, (c) => drawCone(c, 12, 16));
  SPR.barrier = bake(40, 14, 0.44, (c) => drawBarrier(c, 40, 14));
  SPR.billboard = bake(52, 40, 0.70, (c) => drawBillboard(c, 52, 40));
  SPR.pylon = bake(24, 64, 0.34, (c) => drawPylon(c, 24, 64));

  SPR.globe = [];
  for (let i = 0; i < 4; i++) {
    SPR.globe.push(bake(22, 26, 0.24, (c) => drawGlobe(c, 22, 26, i / 4)));
  }
  SPR.podUz = bake(26, 28, 0.28, (c) => drawPod(c, 26, 28, 'uz'));
  SPR.podSpread = bake(26, 28, 0.28, (c) => drawPod(c, 26, 28, 'spread'));
  SPR.podMissile = bake(26, 28, 0.28, (c) => drawPod(c, 26, 28, 'missile'));
  SPR.podNitro = bake(26, 28, 0.28, (c) => drawPod(c, 26, 28, 'nitro'));
  SPR.podShield = bake(26, 28, 0.28, (c) => drawPod(c, 26, 28, 'shield'));

  SPR.mine = bake(20, 16, 0.20, (c) => drawMine(c, 20, 16));
  SPR.plane = bake(64, 34, 1.30, (c) => drawPlane(c, 64, 34));
  SPR.banner = bake(96, 44, 2.10, (c) => drawBanner(c, 96, 44));

  return SPR;
}

export { C as SPRITE_COLORS };
