// Buffer and curve generation, with caches.
//
// Every one of these was being rebuilt on each `input` event in the prototype
// — a 14-second stereo impulse response and two 44,100-point waveshaper
// curves, regenerated for every pixel of every knob drag. Dragging the reverb
// knob allocated ~11 MB per pointer move. They are all pure functions of one
// number, so they are cached, quantised into buckets, and rebuilt only when
// the bucket changes.

const impulseCache = new Map();
const curveCache = new Map();
const pulseCache = new Map();

const IMPULSE_BUCKETS = 48;
const CURVE_BUCKETS = 96;
const PULSE_BUCKETS = 128;
const CURVE_POINTS = 2048;   // a smooth monotone curve needs nothing like 44k

function bucket(t, n) {
  return Math.round(t * n) / n;
}

function evict(map, limit) {
  while (map.size > limit) map.delete(map.keys().next().value);
}

/**
 * Exponentially decaying stereo noise burst. The two channels are generated
 * independently, which is what gives the tail its stereo spread; a mono
 * impulse convolved into both channels collapses the reverb to the centre.
 */
export function makeImpulse(ctx, decaySeconds) {
  const d = bucket(Math.max(0.05, decaySeconds) / 16, IMPULSE_BUCKETS) * 16;
  const key = `${ctx.sampleRate}:${d.toFixed(4)}`;
  const hit = impulseCache.get(key);
  if (hit) return hit;
  const length = Math.max(64, Math.floor(ctx.sampleRate * d));
  const buf = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < length; i++) {
      // A power-law envelope: 2.6 reads as a room rather than the near-linear
      // fade a low exponent gives.
      ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.6);
    }
  }
  impulseCache.set(key, buf);
  evict(impulseCache, 24);
  return buf;
}

/**
 * Soft-clip curves, normalised so amount 0 is the identity.
 *
 * The prototype's arctan curve evaluated to 0.333·x at zero drive — a fixed
 * 9.5 dB of attenuation you could not switch off, applied to the whole
 * instrument, and no amount of turning the knob down restored unity.
 */
export function makeCurve(ctx, kind, amount) {
  const a = bucket(Math.max(0, Math.min(1, amount)), CURVE_BUCKETS);
  const key = `${kind}:${a}`;
  const hit = curveCache.get(key);
  if (hit) return hit;
  const curve = new Float32Array(CURVE_POINTS);
  if (a <= 0) {
    for (let i = 0; i < CURVE_POINTS; i++) curve[i] = (i * 2) / (CURVE_POINTS - 1) - 1;
  } else if (kind === 'atan') {
    const k = 0.02 + a * a * 60;
    const norm = Math.atan(k);
    for (let i = 0; i < CURVE_POINTS; i++) {
      const x = (i * 2) / (CURVE_POINTS - 1) - 1;
      curve[i] = Math.atan(k * x) / norm;
    }
  } else {
    const k = 0.02 + a * a * 40;
    const norm = Math.tanh(k);
    for (let i = 0; i < CURVE_POINTS; i++) {
      const x = (i * 2) / (CURVE_POINTS - 1) - 1;
      curve[i] = Math.tanh(k * x) / norm;
    }
  }
  curveCache.set(key, curve);
  evict(curveCache, 64);
  return curve;
}

/**
 * A band-limited pulse of a given duty cycle, as a Fourier series. Building it
 * from harmonics rather than a sampled square is what keeps it from aliasing
 * into a metallic ring as the width is swept.
 */
export function makePulseWave(ctx, duty, harmonics = 64) {
  const d = Math.min(0.95, Math.max(0.05, duty));
  const q = bucket(d, PULSE_BUCKETS);
  const key = `${q}:${harmonics}`;
  const hit = pulseCache.get(key);
  if (hit) return hit;
  const size = harmonics + 1;
  const real = new Float32Array(size);
  const imag = new Float32Array(size);
  for (let n = 1; n <= harmonics; n++) {
    imag[n] = (2 / (n * Math.PI)) * (1 - Math.cos(2 * Math.PI * n * q));
  }
  const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  pulseCache.set(key, wave);
  evict(pulseCache, 160);
  return wave;
}

/**
 * A narrow pulse concentrates its energy into a short spike, so sweeping the
 * width changes loudness as much as timbre. This compensates, capped so an
 * extreme setting cannot boost by more than 6 dB.
 */
export function pulseCompensation(duty) {
  const d = Math.min(0.95, Math.max(0.05, duty));
  return Math.min(2, 1 / Math.sqrt(d * (1 - d)) / 2);
}

export function makeWhiteNoise(ctx, seconds) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/**
 * Pink noise by Paul Kellett's filter bank — a genuine -3 dB/octave slope.
 * The prototype's "pink" was a single one-pole lowpass, which rolls off at
 * -6 dB/octave, so its pink and brown settings were the same colour at
 * different volumes.
 */
export function makePinkNoise(ctx, seconds) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.0168980;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return buf;
}

/** Brown noise: integrated white, with a leak so it cannot wander into DC. */
export function makeBrownNoise(ctx, seconds) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let y = 0;
  for (let i = 0; i < n; i++) {
    y = 0.998 * y + 0.02 * (Math.random() * 2 - 1);
    d[i] = Math.max(-1, Math.min(1, y * 3.5));
  }
  return buf;
}

/** Test seam: the caches are module-level and would otherwise leak into runs. */
export function _clearCaches() {
  impulseCache.clear();
  curveCache.clear();
  pulseCache.clear();
}
