// Presets, randomisation, and reading the prototype's saved patches.

import { PARAMS, BY_ID, VOICES, toNorm, fromNorm, clamp, defaults } from './params.js';

export const FORMAT = 'viceroy-drone-synth';
export const FORMAT_VERSION = 2;

// ---------------------------------------------------------------------------
// Factory presets
//
// Each is a sparse patch: only what differs from the defaults. Between them
// they exercise every module in the instrument, which also makes them the
// quickest way to hear whether something has broken.
// ---------------------------------------------------------------------------

export const FACTORY = [
  {
    name: 'Cathedral Bloom',
    note: 'Slow harmonic plate over a shimmering fifth. Leave it running.',
    values: {
      sineVol: 0.5, sinePitch: 82.4, triangleVol: 0.34, trianglePitch: 123.5, trianglePan: -0.3,
      sawtoothVol: 0.12, sawtoothPitch: 164.8, sawtoothPan: 0.35,
      filterFreq: 2400, filterQ: 1.4, reverb: 0.62, reverbDecay: 9, reverbPreDelay: 0.06,
      shimmerVolume: 0.4, shimmerPitch: 12, shimmerFeedback: 0.62, shimmerSize: 0.7,
      harmonizerVolume: 0.22, harmonizerPitch: 7,
      lfoSpeed: 0.09, lfoDepth: 11, stereoWidth: 1.35, masterVolume: 0.4,
      harmonicDriftEnable: true, harmonicCycle: 24, harmonicDepth: 2,
      spatialDriftEnable: true, spatialCycle: 17, spatialRange: 0.8,
      organicDrift: 0.5, breathRate: 0.028, breathDepth: 0.09,
    },
  },
  {
    name: 'Tectonic Floor',
    note: 'Sub-heavy and very slow. All three plates on different cycles.',
    values: {
      sineVol: 0.6, sinePitch: 41.2, sawtoothVol: 0.22, sawtoothPitch: 41.2, sawtoothDetune: -7,
      squareVol: 0.1, squarePitch: 61.7,
      filterFreq: 620, filterQ: 2.6, toneTilt: 3.5,
      subMix: 0.5, subLPCutoff: 120, subDivMix: 0.2,
      reverb: 0.4, reverbDecay: 7, delayMix: 0.2, delayTime: 2.4, delayFeedback: 0.55,
      stereoWidth: 0.85, masterVolume: 0.32,
      harmonicDriftEnable: true, harmonicCycle: 42, harmonicDepth: 5,
      timbralDriftEnable: true, timbralCycle: 27, timbralDepth: 1.8, timbralSpeed: 0.35,
      spatialDriftEnable: true, spatialCycle: 33, spatialRange: 1.2,
      organicDrift: 0.35,
    },
  },
  {
    name: 'Short Wave Vigil',
    note: 'Radio noise through a narrow band, drifting across the dial.',
    values: {
      sineVol: 0.22, sinePitch: 55, triangleVol: 0.18, trianglePitch: 110,
      radioVolume: 0.55, radioTuning: 34, radioQ: 18, radioDrift: 0.65, noiseColor: 0.42,
      filterFreq: 5200, hazeMix: 0.3, hazeRate: 6, hazeBits: 9,
      reverb: 0.45, reverbDecay: 5.5, delayMix: 0.3, delayTime: 0.9, delayFeedback: 0.62,
      wowFlutterVolume: 0.35, wowRate: 0.42, wowDepth: 0.5, flutterAmt: 0.45,
      stereoWidth: 1.5, masterVolume: 0.34,
      randAmount: 0.4, randRate: 9, organicDrift: 0.6,
      timbralDriftEnable: true, timbralCycle: 11, timbralDepth: 1.2,
    },
  },
  {
    name: 'Iron Lung',
    note: 'Ring modulation and hard drive, gated so it breathes in bursts.',
    values: {
      squareVol: 0.42, squarePitch: 73.4, pulseVol: 0.3, pulsePitch: 55, pulseWidth: 0.22,
      sawtoothVol: 0.2, sawtoothPitch: 36.7,
      distortion: 0.45, distortion2: 0.3, filterFreq: 1500, filterQ: 4.5,
      ringModFreq: 63, ringModDepth: 0.42,
      probGate: 0.55, probRate: 0.6, probDepth: 0.75, probSlew: 0.35,
      reverb: 0.28, reverbDecay: 3, stereoWidth: 1.1, masterVolume: 0.26,
      seqOn: true, seqStepTime: 6, seqSmooth: 3.5, seqAmtFilter: 1.4, seqAmtRing: 0.4,
      seqAmtPW: 0.2, seqMode: 'pingpong',
      organicDrift: 0.3,
    },
  },
  {
    name: 'Grain Weather',
    note: 'The granular cloud over a supersaw, scattered wide.',
    values: {
      supersawVolume: 0.4, supersawPitch: 98, supersawDetune: 34, supersawSpread: 0.85, supersawVoices: 9,
      sineVol: 0.28, sinePitch: 49,
      granularDepth: 0.55, granularRate: 26, granularSize: 0.09, granularSpread: 1.2, granularPitch: 7,
      filterFreq: 6800, reverb: 0.5, reverbDecay: 6,
      chorusVolume: 0.3, chorusRate: 0.14, chorusDepth: 0.6,
      stereoWidth: 1.6, masterVolume: 0.3,
      autoEvolve: true, evolveRate: 45, evolveDepth: 0.35,
      organicDrift: 0.55,
    },
  },
  {
    name: 'Hollow Bell',
    note: 'Sample-and-hold on the pitch, long decay, sparse and metallic.',
    values: {
      trianglePitch: 146.8, triangleVol: 0.45, sineVol: 0.3, sinePitch: 73.4,
      pulseVol: 0.16, pulsePitch: 293.7, pulseWidth: 0.14, pulsePan: 0.5,
      lfoShape: 'random', lfoSpeed: 0.22, lfoDepth: 340, lfoToFilter: 1400,
      filterFreq: 3400, filterQ: 8, filterType: 'bandpass',
      reverb: 0.7, reverbDecay: 12, reverbPreDelay: 0.11,
      delayMix: 0.35, delayTime: 1.6, delayFeedback: 0.6,
      stereoWidth: 1.4, masterVolume: 0.33,
      harmonicDriftEnable: true, harmonicCycle: 13, harmonicDepth: 7,
      organicDrift: 0.45,
    },
  },
  {
    name: 'Tape Chapel',
    note: 'Wow, flutter and a decimator: a drone left on a failing machine.',
    values: {
      sineVol: 0.42, sinePitch: 87.3, triangleVol: 0.3, trianglePitch: 130.8, triangleDetune: 9,
      sawtoothVol: 0.14, sawtoothPitch: 65.4, sawtoothDetune: -11,
      wowFlutterVolume: 0.5, wowRate: 0.31, wowDepth: 0.62, flutterAmt: 0.55,
      hazeMix: 0.24, hazeRate: 8.5, hazeBits: 11,
      filterFreq: 3100, toneTilt: -2.5, reverb: 0.44, reverbDecay: 6.5,
      chorusVolume: 0.24, chorusRate: 0.08,
      stereoWidth: 1.15, masterVolume: 0.36,
      memoryEnable: true, memoryInterval: 3, memoryDepth: 6, memoryMorphTime: 2.5, memoryProbability: 0.45,
      organicDrift: 0.65,
    },
  },
  {
    name: 'Zero',
    note: 'A single sine and nothing else. Somewhere to start from.',
    values: { ...defaults(), sineVol: 0.5, reverb: 0.2, organicDrift: 0.15 },
  },
];

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

export function exportPreset(store, extras = {}) {
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    savedAt: new Date().toISOString(),
    name: extras.name || 'Untitled',
    values: store.snapshot(),
    macros: extras.macros || null,
  };
}

/**
 * Read a preset. Accepts this instrument's own format and the flat
 * `{id: "value"}` object the prototype wrote, so patches saved from it still
 * load. Returns `{ values, macros, warnings }` rather than applying anything,
 * so the caller decides whether to jump or morph.
 */
export function importPreset(raw) {
  const warnings = [];
  let data = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch (err) {
      return { values: null, macros: null, warnings: [`Not valid JSON: ${err.message}`] };
    }
  }
  if (!data || typeof data !== 'object') {
    return { values: null, macros: null, warnings: ['Preset is not an object.'] };
  }

  const isNative = data.format === FORMAT && data.values;
  const source = isNative ? data.values : data;
  if (!isNative) warnings.push('Read as a v28 prototype preset.');

  const values = {};
  for (const [key, rawValue] of Object.entries(source)) {
    const mapped = LEGACY_KEYS[key] || key;
    const p = BY_ID[mapped];
    if (!p) {
      if (!isNative) warnings.push(`Ignored unknown control "${key}".`);
      continue;
    }
    if (p.type === 'bool') {
      values[mapped] = rawValue === true || rawValue === 'true' || rawValue === 1 || rawValue === '1';
    } else if (p.type === 'enum') {
      if (p.options.some((o) => o.value === rawValue)) values[mapped] = rawValue;
    } else {
      const n = Number(rawValue);
      if (Number.isFinite(n)) values[mapped] = clamp(n, p.min, p.max);
    }
  }

  if (!isNative) applyLegacySemantics(source, values, warnings);

  return {
    values,
    macros: isNative ? data.macros || null : null,
    name: data.name || null,
    warnings,
  };
}

// The prototype keyed its oscillator controls off dataset attributes rather
// than element ids, producing `sine_vol`, `sine_pitch`, `sine_pan` and so on.
const LEGACY_KEYS = {};
for (const v of VOICES) {
  LEGACY_KEYS[`${v}_vol`] = `${v}Vol`;
  LEGACY_KEYS[`${v}_pitch`] = `${v}Pitch`;
  LEGACY_KEYS[`${v}_pan`] = `${v}Pan`;
}

/**
 * Three prototype controls no longer mean what they used to, because what
 * they used to mean was a bug. Translated rather than dropped.
 */
function applyLegacySemantics(source, values, warnings) {
  if (source.reverb !== undefined) {
    // "Amount" set the impulse decay (value × 5 s) and there was no wet/dry
    // control at all — the reverb was permanently fully wet.
    const v = clamp(Number(source.reverb) || 0, 0, 1);
    values.reverbDecay = clamp(0.4 + v * 5, BY_ID.reverbDecay.min, BY_ID.reverbDecay.max);
    values.reverb = clamp(0.25 + v * 0.5, 0, 1);
    warnings.push('Reverb split into Mix and Decay; the old value set decay only.');
  }
  if (source.delayTime !== undefined && Number(source.delayTime) > 0) {
    // The delay was in series, so any delay time at all was fully wet.
    values.delayMix = 0.5;
    warnings.push('Delay is now a parallel send; Mix set to 50%.');
  }
  if (source.waveMorph !== undefined && Number(source.waveMorph) > 0) {
    values.morphEnable = true;
    warnings.push('Wave Morph engaged (it is now a toggle so it can be undone).');
  }
  if (source.lfoDepth !== undefined) {
    // The old depth was divided by 1000 before reaching detune, so its maximum
    // was 0.05 cents — inaudible across the whole range of the knob.
    warnings.push('LFO depth is now in cents and audible; it was scaled to 0.05¢ maximum.');
  }
  if (source.radioTuning !== undefined) {
    warnings.push('Radio tuning now spans 90 Hz–12 kHz; it used to run past Nyquist.');
  }
}

// ---------------------------------------------------------------------------
// Randomisation
//
// The prototype randomised five oscillator volumes to independent uniform
// values and threw four effects across their full ranges, which reliably
// produced a loud, muddy chord. Bias classes make it land on drones.
// ---------------------------------------------------------------------------

const HARMONIC_RATIOS = [0.25, 0.5, 0.5, 0.75, 1, 1, 1.5, 2, 2, 3, 4];

export function randomisePatch(store, { amount = 1, root = null } = {}) {
  const changed = {};
  const rootHz = root || 32.7 * Math.pow(2, Math.floor(Math.random() * 3)) * (Math.random() < 0.5 ? 1 : 1.5);

  // Two or three voices, not five: a drone is an interval, not a cluster.
  const voiceCount = 2 + Math.floor(Math.random() * 2);
  const chosen = [...VOICES].sort(() => Math.random() - 0.5).slice(0, voiceCount);

  for (const p of PARAMS) {
    if (!p.rand || p.type !== 'num') continue;
    const id = p.id;
    const voice = VOICES.find((v) => id.startsWith(v));

    if (voice && id.endsWith('Vol')) {
      changed[id] = chosen.includes(voice) ? 0.18 + Math.random() * 0.45 : 0;
      continue;
    }
    if (voice && id.endsWith('Pitch')) {
      const ratio = HARMONIC_RATIOS[Math.floor(Math.random() * HARMONIC_RATIOS.length)];
      changed[id] = clamp(rootHz * ratio, p.min, p.max);
      continue;
    }
    switch (p.randBias) {
      case 'sparse':
        // Most optional modules stay off; the ones that come on come on properly.
        changed[id] = Math.random() < 0.28 ? fromNorm(p, 0.2 + Math.random() * 0.6 * amount) : p.min;
        break;
      case 'narrow':
        changed[id] = fromNorm(p, clamp(toNorm(p, p.def) + (Math.random() * 2 - 1) * 0.22 * amount, 0, 1));
        break;
      case 'open':
        changed[id] = fromNorm(p, 0.35 + Math.random() * 0.6);
        break;
      case 'harmonic':
        changed[id] = clamp(rootHz * HARMONIC_RATIOS[Math.floor(Math.random() * HARMONIC_RATIOS.length)], p.min, p.max);
        break;
      default:
        changed[id] = fromNorm(p, Math.random());
        break;
    }
  }

  // Randomisation must never be able to hurt: the master level and the
  // limiter ceiling are left exactly where the user put them.
  delete changed.masterVolume;
  delete changed.limiterThreshold;
  store.batch(changed);
  return changed;
}

// ---------------------------------------------------------------------------
// Browser-local preset shelf
// ---------------------------------------------------------------------------

const LS_KEY = 'viceroy.presets.v2';

function safeParse(text, fallback) {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : fallback;
  } catch {
    return fallback;
  }
}

export function loadUserPresets() {
  try {
    return safeParse(localStorage.getItem(LS_KEY) || '[]', []);
  } catch {
    // Private browsing throws on access rather than returning null.
    return [];
  }
}

export function saveUserPreset(preset) {
  const all = loadUserPresets().filter((p) => p.name !== preset.name);
  all.push(preset);
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(all.slice(-40)));
    return true;
  } catch {
    return false;
  }
}

export function deleteUserPreset(name) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(loadUserPresets().filter((p) => p.name !== name)));
    return true;
  } catch {
    return false;
  }
}
