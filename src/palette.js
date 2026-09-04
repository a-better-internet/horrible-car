/*
 * Atari System 1 colour model.
 *
 * The board stores 1024 palette entries in CRAM as a 16-bit word laid out as
 * INT:RED:GRN:BLU, four bits each (see VIDEO.vhd, slv_CRAM slicing).  The
 * RGBI PROM then turns each (intensity, channel) pair into the final 4-bit
 * DAC value.  The comment in RGBI.vhd calls it "(Intensity * Color) / 16",
 * but the actual table contents are round(I * C / 15) -- e.g. row I=15 is the
 * identity 0..F, which /16 could never produce.  We reproduce the table
 * exactly so every colour in the game is a colour the real hardware could
 * have shown.
 */

/** 16x16 lookup: RGBI_LUT[intensity][channel] -> 4-bit DAC value. */
const RGBI_LUT = (() => {
  const t = [];
  for (let i = 0; i < 16; i++) {
    const row = new Uint8Array(16);
    for (let c = 0; c < 16; c++) row[c] = Math.round((i * c) / 15);
    t.push(row);
  }
  return t;
})();

/** Expand a 4-bit DAC value to 8 bits the way a full-scale DAC would. */
const expand4 = (v) => v * 17;

/**
 * Resolve one CRAM-style colour to 8-bit RGB.
 * @param {number} i intensity nibble 0..15
 * @param {number} r red nibble 0..15
 * @param {number} g green nibble 0..15
 * @param {number} b blue nibble 0..15
 * @returns {[number, number, number]}
 */
export function rgbi(i, r, g, b) {
  const L = RGBI_LUT[i & 15];
  return [expand4(L[r & 15]), expand4(L[g & 15]), expand4(L[b & 15])];
}

/** Same as rgbi() but returns a CSS colour string. */
export function css(i, r, g, b) {
  const [R, G, B] = rgbi(i, r, g, b);
  return `rgb(${R},${G},${B})`;
}

/** CSS colour with alpha, still snapped to the hardware palette. */
export function cssa(i, r, g, b, a) {
  const [R, G, B] = rgbi(i, r, g, b);
  return `rgba(${R},${G},${B},${a})`;
}

/**
 * Parse a compact "IRGB" hex quad ("f8a4" = intensity F, red 8, green A,
 * blue 4) into a CSS colour.  Palettes below are written in this form because
 * it is how the colour would actually be poked into CRAM.
 */
export function q(quad) {
  const n = parseInt(quad, 16);
  return css((n >> 12) & 15, (n >> 8) & 15, (n >> 4) & 15, n & 15);
}

/** Blend two CSS rgb() strings.  Used for fog and headlight falloff. */
export function mix(a, b, t) {
  const pa = parseRGB(a), pb = parseRGB(b);
  const k = Math.max(0, Math.min(1, t));
  return `rgb(${Math.round(pa[0] + (pb[0] - pa[0]) * k)},${
    Math.round(pa[1] + (pb[1] - pa[1]) * k)},${
    Math.round(pa[2] + (pb[2] - pa[2]) * k)})`;
}

/**
 * Re-express an rgb() string as rgba() with the given alpha.  Needed wherever
 * a gradient has to fade to nothing rather than to a specific colour: fading
 * to a flat sky colour over a *banded* sky leaves a visible square.
 */
export function withAlpha(cssRgb, a) {
  const p = parseRGB(cssRgb);
  return `rgba(${p[0]},${p[1]},${p[2]},${a})`;
}

const rgbCache = new Map();
function parseRGB(s) {
  let v = rgbCache.get(s);
  if (v) return v;
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(s);
  v = m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
  rgbCache.set(s, v);
  return v;
}

/**
 * Per-stage environment palettes.  Road Blasters cycled through day, dusk,
 * night, fog and "red planet" looks as the rally went on; each entry here is
 * one of those moods expressed in hardware-legal colours.
 */
export const THEMES = {
  day: {
    name: 'DAY',
    sky: q('faae'), skyLow: q('fcdf'),
    ground: [q('c485'), q('b375')],
    road: [q('7333'), q('8444')],
    rumble: [q('ff88'), q('faaa')],
    lane: q('fddc'),
    haze: q('fbce'), fogDensity: 3.2,
    dark: 0,
    orb: { x: 0.78, y: 0.15, r: 13, core: q('ffff'), halo: q('fffb') },
    clouds: 5,
  },
  dusk: {
    name: 'DUSK',
    sky: q('c714'), skyLow: q('ff85'),
    ground: [q('8353'), q('7242')],
    road: [q('6322'), q('7433')],
    rumble: [q('fd55'), q('f988')],
    lane: q('fdb8'),
    haze: q('c855'), fogDensity: 4.0,
    dark: 0.22,
    orb: { x: 0.31, y: 0.34, r: 19, core: q('ffb5'), halo: q('fd51') },
    clouds: 6,
  },
  night: {
    name: 'NIGHT',
    sky: q('3113'), skyLow: q('4225'),
    ground: [q('4223'), q('3112')],
    road: [q('4222'), q('5333')],
    rumble: [q('c944'), q('b667')],
    lane: q('e999'),
    haze: q('2112'), fogDensity: 6.5,
    dark: 0.52,
    orb: { x: 0.17, y: 0.13, r: 10, core: q('feee'), halo: q('787a') },
    clouds: 2,
  },
  fog: {
    name: 'FOG',
    sky: q('caaa'), skyLow: q('cccc'),
    ground: [q('9787'), q('8676')],
    road: [q('7555'), q('8666')],
    rumble: [q('daaa'), q('c999')],
    lane: q('feee'),
    haze: q('cbbb'), fogDensity: 11.0,
    dark: 0.10,
    orb: null,
    clouds: 0,
  },
  rust: {
    name: 'RUST',
    sky: q('a611'), skyLow: q('d941'),
    ground: [q('9631'), q('8520')],
    road: [q('6322'), q('7433')],
    rumble: [q('fc41'), q('e884')],
    lane: q('fdc9'),
    haze: q('a731'), fogDensity: 5.0,
    dark: 0.18,
    orb: { x: 0.64, y: 0.21, r: 15, core: q('ffc5'), halo: q('e841') },
    clouds: 4,
  },
  snow: {
    name: 'SNOW',
    sky: q('bacf'), skyLow: q('deee'),
    ground: [q('deef'), q('cdde')],
    road: [q('7444'), q('8555')],
    rumble: [q('f99b'), q('feee')],
    lane: q('feee'),
    haze: q('deee'), fogDensity: 8.0,
    dark: 0.06,
    orb: { x: 0.72, y: 0.17, r: 12, core: q('feee'), halo: q('cdde') },
    clouds: 7,
  },
};

/** Shared UI colours, also hardware-legal. */
export const UI = {
  white: q('ffff'), amber: q('fda3'), red: q('ff32'), green: q('f4f5'),
  cyan: q('f6ef'), blue: q('f45f'), yellow: q('ffe4'), grey: q('a888'),
  dim: q('6666'), black: q('0000'), magenta: q('ff5c'), tan: q('fca7'),
};
