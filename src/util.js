/* Small numeric helpers shared by the simulation and the renderer. */

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);
export const TAU = Math.PI * 2;

/** Ease a value toward a target at `rate` units/second, framerate-independent. */
export function approach(current, target, rate, dt) {
  const d = target - current;
  const step = rate * dt;
  if (d > step) return current + step;
  if (d < -step) return current - step;
  return target;
}

/**
 * Exponential fog, matching the classic pseudo-3D racer formulation.
 * @param {number} d 0..1 distance through the draw range
 * @param {number} density larger = thicker
 * @returns {number} 1 = clear, 0 = fully fogged
 */
export const exponentialFog = (d, density) => 1 / Math.pow(Math.E, d * d * density);

/**
 * 1-D overlap test used for every collision in the game.  `percent` shrinks
 * the boxes so that a near-miss reads as a near-miss instead of a hit.
 */
export function overlap(x1, w1, x2, w2, percent = 1) {
  const half = percent / 2;
  const min1 = x1 - w1 * half, max1 = x1 + w1 * half;
  const min2 = x2 - w2 * half, max2 = x2 + w2 * half;
  return !(max1 < min2 || min1 > max2);
}

/**
 * Deterministic 32-bit PRNG (mulberry32).  Every stage is generated from a
 * seed derived from its number, so stage 17 is always the same stage 17 --
 * important for a game where you are expected to learn the route.
 */
export function makeRNG(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** Uniform float in [lo, hi). */
    range: (lo, hi) => lo + next() * (hi - lo),
    /** Uniform integer in [lo, hi]. */
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    /** True with probability p. */
    chance: (p) => next() < p,
    /** Pick one element of an array. */
    pick: (arr) => arr[Math.floor(next() * arr.length) % arr.length],
  };
}

/** localStorage that never throws (private mode, disabled storage, quota). */
export const storage = {
  get(key, fallback) {
    try {
      const v = window.localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
};

/** Zero-padded integer, for score/timer readouts. */
export const pad = (n, len) => String(Math.max(0, Math.floor(n))).padStart(len, '0');

/** Group an integer with commas, e.g. 1234567 -> "1,234,567". */
export const commas = (n) => Math.floor(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
