// The parameter registry: the single source of truth for every knob in the
// instrument. Everything else — the UI, presets, randomisation, the memory
// system, the macro matrix — is generated from this table, so a parameter
// added here is immediately savable, randomisable, morphable and drawable.
//
// A parameter is pure data. It knows its range and how to print itself; it
// does not know which audio node it drives. That mapping lives in
// engine/graph.js, which keeps this file readable as a spec sheet.

export const VOICES = ['sine', 'square', 'triangle', 'sawtooth', 'pulse'];

export const VOICE_LABEL = {
  sine: 'Sine',
  square: 'Square',
  triangle: 'Triangle',
  sawtooth: 'Sawtooth',
  pulse: 'Pulse',
};

// ---------------------------------------------------------------------------
// Value <-> slider-position mapping.
//
// A linear Hz slider is the classic synth UI mistake: with 40..18000 linear,
// everything below 1 kHz — which is most of what you actually want on a drone
// — lives in the first 5% of travel. Frequencies get an exponential curve so
// each octave occupies equal width.
// ---------------------------------------------------------------------------

export function toNorm(p, value) {
  const v = clamp(value, p.min, p.max);
  if (p.curve === 'exp') {
    return Math.log(v / p.min) / Math.log(p.max / p.min);
  }
  if (p.curve === 'pow') {
    return Math.pow((v - p.min) / (p.max - p.min), 1 / (p.power || 2));
  }
  return (v - p.min) / (p.max - p.min);
}

export function fromNorm(p, t) {
  const n = clamp(t, 0, 1);
  if (p.curve === 'exp') {
    return p.min * Math.pow(p.max / p.min, n);
  }
  if (p.curve === 'pow') {
    return p.min + Math.pow(n, p.power || 2) * (p.max - p.min);
  }
  return p.min + n * (p.max - p.min);
}

export function clamp(x, lo, hi) {
  return x < lo ? lo : x > hi ? hi : x;
}

export function quantise(p, value) {
  let v = clamp(value, p.min, p.max);
  if (p.step) v = Math.round(v / p.step) * p.step;
  return clamp(v, p.min, p.max);
}

// ---------------------------------------------------------------------------
// Display formatting. Values are read while dragging, so they must not change
// width as they change magnitude — every formatter below yields a stable
// number of glyphs within its own range, and the UI renders them tabular.
// ---------------------------------------------------------------------------

const FORMATTERS = {
  pct: (v) => `${Math.round(v * 100)}%`,
  ratio: (v) => v.toFixed(2),
  int: (v) => String(Math.round(v)),
  hz: (v) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)}k` : v >= 100 ? v.toFixed(0) : v.toFixed(2)) + ' Hz',
  khz: (v) => `${v.toFixed(1)} kHz`,
  sec: (v) => (v >= 10 ? `${v.toFixed(1)} s` : v >= 1 ? `${v.toFixed(2)} s` : `${Math.round(v * 1000)} ms`),
  min: (v) => (v >= 10 ? `${v.toFixed(0)} min` : `${v.toFixed(2)} min`),
  db: (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`,
  semi: (v) => `${v > 0 ? '+' : ''}${v.toFixed(v % 1 ? 1 : 0)} st`,
  cents: (v) => `${v > 0 ? '+' : ''}${Math.round(v)} ¢`,
  bipolar: (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`,
  oct: (v) => `${v.toFixed(2)} oct`,
  bits: (v) => `${Math.round(v)} bit`,
};

export function format(p, value) {
  if (p.type === 'bool') return value ? 'ON' : 'OFF';
  if (p.type === 'enum') {
    const opt = p.options.find((o) => o.value === value);
    return opt ? (opt.full || opt.label) : String(value);
  }
  const f = FORMATTERS[p.fmt] || FORMATTERS.ratio;
  return f(Number(value));
}

// ---------------------------------------------------------------------------
// The table.
//
// `mod` marks a parameter that automated systems (evolve, plates, sequencer,
// macros, memory) are allowed to move. `rand` marks one the Randomise button
// may touch, with an optional bias so randomisation lands on musical patches
// rather than on noise.
// ---------------------------------------------------------------------------

// Human labels for cross-module references. The XY pad and the macro matrix
// name parameters that live in other panels, where a bare "Level" means
// nothing on its own.
const QUALIFIED = {
  filterFreq: 'Filter Cutoff', filterQ: 'Filter Resonance', ringModDepth: 'Ring Depth',
  ringModFreq: 'Ring Frequency', reverb: 'Reverb Mix', delayMix: 'Delay Mix',
  delayFeedback: 'Delay Feedback', stereoWidth: 'Stereo Width', distortion: 'Arctan Drive',
  distortion2: 'Tanh Drive', lfoDepth: 'LFO Pitch Depth', lfoSpeed: 'LFO Rate',
  toneTilt: 'Tone Tilt', granularDepth: 'Granular Mix', hazeMix: 'Haze Mix',
  subMix: 'Sub Mix', shimmerVolume: 'Shimmer Level', harmonizerVolume: 'Harmonizer Level',
  radioVolume: 'Radio Level', pulseWidth: 'Pulse Width', waveMorph: 'Wave Morph',
  supersawVolume: 'SuperSaw Level', tremolo: 'Tremolo Rate', chorusVolume: 'Chorus Level',
  wowFlutterVolume: 'Wow & Flutter Level', reverbDecay: 'Reverb Decay',
  noiseColor: 'Noise Colour', evolveDepth: 'Evolve Depth', organicDrift: 'Organic Drift',
};

export function xyLabel(id) {
  return QUALIFIED[id] || (BY_ID_LATE[id] ? BY_ID_LATE[id].label : id);
}

const BY_ID_LATE = {};

const P = [];

function def(entry) {
  const e = {
    type: 'num',
    curve: 'lin',
    fmt: 'ratio',
    mod: true,
    rand: false,
    ...entry,
  };
  P.push(e);
  BY_ID_LATE[e.id] = e;
}

// ---- Oscillators ----------------------------------------------------------

for (const v of VOICES) {
  const isSine = v === 'sine';
  def({ id: `${v}Vol`, label: 'Level', min: 0, max: 1, def: isSine ? 0.55 : 0, fmt: 'pct', rand: true, randBias: 'sparse' });
  def({ id: `${v}Pitch`, label: 'Pitch', min: 20, max: 400, def: 110, curve: 'exp', fmt: 'hz', rand: true, randBias: 'harmonic' });
  def({ id: `${v}Detune`, label: 'Detune', min: -50, max: 50, def: 0, fmt: 'cents', rand: true, randBias: 'narrow' });
  def({ id: `${v}Pan`, label: 'Pan', min: -1, max: 1, def: 0, fmt: 'bipolar', rand: true, randBias: 'narrow' });
}

def({ id: 'pulseWidth', label: 'Pulse Width', min: 0.05, max: 0.95, def: 0.5, fmt: 'pct', rand: true, randBias: 'narrow' });
// Morph is a crossfader across the sine/square/sawtooth voices. It is a
// toggle rather than a bare knob because it has to *own* those three levels
// while engaged: in the prototype, dragging Morph silently overwrote the
// mixer and there was no way back to the levels you had set. Engaged, it
// publishes offsets through the modulation router; disengaged, the mixer
// rules again and nothing was lost.
def({ id: 'morphEnable', label: 'Engage', type: 'bool', def: false });
def({ id: 'waveMorph', label: 'Morph', min: 0, max: 1, def: 0, fmt: 'pct' });
def({ id: 'crossMod', label: 'X-Mod Depth', min: 0, max: 1, def: 0, fmt: 'pct', rand: true, randBias: 'sparse' });
def({ id: 'crossModRate', label: 'X-Mod Rate', min: 0.05, max: 40, def: 5, curve: 'exp', fmt: 'hz' });
def({
  id: 'crossModTarget', label: 'X-Mod Target', type: 'enum', def: 'square', fmt: 'ratio',
  options: [
    { value: 'square', label: 'Square', full: 'Square voice' },
    { value: 'sawtooth', label: 'Saw', full: 'Sawtooth voice' },
    { value: 'pulse', label: 'Pulse', full: 'Pulse voice' },
    { value: 'triangle', label: 'Tri', full: 'Triangle voice' },
    { value: 'all', label: 'All', full: 'All five voices' },
  ],
});

// ---- Effects --------------------------------------------------------------

def({ id: 'reverb', label: 'Mix', min: 0, max: 1, def: 0.32, fmt: 'pct', rand: true });
def({ id: 'reverbDecay', label: 'Decay', min: 0.2, max: 14, def: 4.5, curve: 'exp', fmt: 'sec', rand: true });
def({ id: 'reverbPreDelay', label: 'Pre-Delay', min: 0, max: 0.25, def: 0.02, fmt: 'sec' });

def({ id: 'distortion', label: 'Arctan', min: 0, max: 1, def: 0, fmt: 'pct', rand: true, randBias: 'sparse' });
def({ id: 'distortion2', label: 'Tanh', min: 0, max: 1, def: 0, fmt: 'pct', rand: true, randBias: 'sparse' });

def({ id: 'delayTime', label: 'Time', min: 0.01, max: 4, def: 0.6, curve: 'exp', fmt: 'sec', rand: true });
def({ id: 'delayFeedback', label: 'Feedback', min: 0, max: 0.95, def: 0.35, fmt: 'pct', rand: true });
def({ id: 'delayMix', label: 'Mix', min: 0, max: 1, def: 0, fmt: 'pct', rand: true, randBias: 'sparse' });

def({ id: 'tremolo', label: 'Rate', min: 0, max: 12, def: 0, curve: 'pow', power: 2, fmt: 'hz', rand: true, randBias: 'sparse' });
def({ id: 'tremoloDepth', label: 'Depth', min: 0, max: 1, def: 0.35, fmt: 'pct' });

def({ id: 'filterFreq', label: 'Cutoff', min: 40, max: 18000, def: 4200, curve: 'exp', fmt: 'hz', rand: true, randBias: 'open' });
def({ id: 'filterQ', label: 'Resonance', min: 0.1, max: 24, def: 0.7, curve: 'exp', fmt: 'ratio', rand: true, randBias: 'narrow' });
def({
  id: 'filterType', label: 'Type', type: 'enum', def: 'lowpass',
  options: [
    { value: 'lowpass', label: 'Low', full: 'Low pass' },
    { value: 'highpass', label: 'High', full: 'High pass' },
    { value: 'bandpass', label: 'Band', full: 'Band pass' },
    { value: 'notch', label: 'Notch', full: 'Notch' },
    { value: 'peaking', label: 'Peak', full: 'Peaking' },
  ],
});
def({ id: 'toneTilt', label: 'Tilt', min: -12, max: 12, def: 0, fmt: 'db', rand: true, randBias: 'narrow' });

// ---- Modulation -----------------------------------------------------------

def({ id: 'lfoSpeed', label: 'Rate', min: 0.005, max: 20, def: 0.35, curve: 'exp', fmt: 'hz', rand: true });
def({ id: 'lfoDepth', label: 'Pitch Depth', min: 0, max: 1200, def: 8, curve: 'pow', power: 2, fmt: 'cents', rand: true });
def({ id: 'lfoToFilter', label: 'Filter Depth', min: 0, max: 4800, def: 0, curve: 'pow', power: 2, fmt: 'cents', rand: true, randBias: 'sparse' });
def({
  id: 'lfoShape', label: 'Shape', type: 'enum', def: 'sine',
  options: [
    { value: 'sine', label: 'Sine', full: 'Sine' },
    { value: 'triangle', label: 'Tri', full: 'Triangle' },
    { value: 'sawtooth', label: 'Ramp', full: 'Ramp / sawtooth' },
    { value: 'square', label: 'Square', full: 'Square' },
    { value: 'random', label: 'S&H', full: 'Sample and hold — stepped random' },
  ],
});

def({ id: 'ringModFreq', label: 'Frequency', min: 0.1, max: 2000, def: 30, curve: 'exp', fmt: 'hz', rand: true });
def({ id: 'ringModDepth', label: 'Depth', min: 0, max: 1, def: 0, fmt: 'pct', rand: true, randBias: 'sparse' });

def({ id: 'randAmount', label: 'Amount', min: 0, max: 1, def: 0, fmt: 'pct', rand: true });
def({ id: 'randRate', label: 'Interval', min: 0.5, max: 120, def: 5, curve: 'exp', fmt: 'sec' });

def({ id: 'envFollow', label: 'Sensitivity', min: 0, max: 1, def: 0, fmt: 'pct', rand: true, randBias: 'sparse' });
def({ id: 'envToFilter', label: 'To Filter', min: 0, max: 1, def: 0, fmt: 'pct', rand: true, randBias: 'sparse' });
def({ id: 'envSmooth', label: 'Smoothing', min: 0.005, max: 2, def: 0.08, curve: 'exp', fmt: 'sec' });

def({ id: 'probGate', label: 'Chance', min: 0, max: 1, def: 1, fmt: 'pct' });
def({ id: 'probRate', label: 'Rate', min: 0.05, max: 20, def: 2, curve: 'exp', fmt: 'hz' });
def({ id: 'probDepth', label: 'Depth', min: 0, max: 1, def: 1, fmt: 'pct' });
def({ id: 'probSlew', label: 'Slew', min: 0.002, max: 2, def: 0.05, curve: 'exp', fmt: 'sec' });

def({ id: 'seqOn', label: 'Run', type: 'bool', def: false });
def({ id: 'seqStepTime', label: 'Step Time', min: 0.1, max: 60, def: 8, curve: 'exp', fmt: 'sec' });
def({ id: 'seqSmooth', label: 'Glide', min: 0, max: 20, def: 2, curve: 'pow', power: 2, fmt: 'sec' });
def({ id: 'seqLength', label: 'Length', min: 1, max: 8, def: 8, step: 1, fmt: 'int' });
def({
  id: 'seqMode', label: 'Direction', type: 'enum', def: 'forward',
  options: [
    { value: 'forward', label: 'Fwd', full: 'Forward' },
    { value: 'reverse', label: 'Rev', full: 'Reverse' },
    { value: 'pingpong', label: 'Ping', full: 'Ping-pong' },
    { value: 'random', label: 'Rand', full: 'Random' },
  ],
});
def({ id: 'seqAmtFilter', label: '→ Filter', min: 0, max: 4, def: 0.5, fmt: 'oct' });
def({ id: 'seqAmtRing', label: '→ Ring', min: 0, max: 1, def: 0.5, fmt: 'pct' });
def({ id: 'seqAmtPitch', label: '→ Pitch', min: 0, max: 24, def: 0, fmt: 'semi' });
def({ id: 'seqAmtPW', label: '→ Width', min: 0, max: 0.45, def: 0, fmt: 'pct' });
for (let i = 0; i < 8; i++) {
  def({ id: `seqStep${i}`, label: `${i + 1}`, min: -1, max: 1, def: [0, 0.3, -0.2, 0.6, -0.4, 0.1, 0, -0.1][i], fmt: 'bipolar' });
}

// ---- Layers ---------------------------------------------------------------

def({ id: 'supersawVolume', label: 'Level', min: 0, max: 1, def: 0, fmt: 'pct', rand: true, randBias: 'sparse' });
def({ id: 'supersawPitch', label: 'Pitch', min: 20, max: 400, def: 110, curve: 'exp', fmt: 'hz', rand: true, randBias: 'harmonic' });
def({ id: 'supersawDetune', label: 'Detune', min: 0, max: 100, def: 22, fmt: 'cents', rand: true });
def({ id: 'supersawSpread', label: 'Spread', min: 0, max: 1, def: 0.7, fmt: 'pct' });
def({ id: 'supersawVoices', label: 'Voices', min: 3, max: 9, def: 7, step: 2, fmt: 'int', mod: false });

def({ id: 'shimmerVolume', label: 'Level', min: 0, max: 1, def: 0, fmt: 'pct', rand: true, randBias: 'sparse' });
def({ id: 'shimmerPitch', label: 'Pitch', min: -12, max: 24, def: 12, step: 1, fmt: 'semi' });
def({ id: 'shimmerFeedback', label: 'Feedback', min: 0, max: 0.95, def: 0.55, fmt: 'pct', rand: true });
def({ id: 'shimmerSize', label: 'Size', min: 0.05, max: 3, def: 0.45, curve: 'exp', fmt: 'sec' });

def({ id: 'harmonizerVolume', label: 'Level', min: 0, max: 1, def: 0, fmt: 'pct', rand: true, randBias: 'sparse' });
def({ id: 'harmonizerPitch', label: 'Interval', min: -24, max: 24, def: 7, step: 1, fmt: 'semi', rand: true, randBias: 'harmonic' });
def({ id: 'harmonizerFine', label: 'Fine', min: -50, max: 50, def: 0, fmt: 'cents' });

def({ id: 'chorusVolume', label: 'Level', min: 0, max: 1, def: 0, fmt: 'pct', rand: true, randBias: 'sparse' });
def({ id: 'chorusRate', label: 'Rate', min: 0.01, max: 6, def: 0.25, curve: 'exp', fmt: 'hz' });
def({ id: 'chorusDepth', label: 'Depth', min: 0, max: 1, def: 0.4, fmt: 'pct' });

def({ id: 'wowFlutterVolume', label: 'Level', min: 0, max: 1, def: 0, fmt: 'pct', rand: true, randBias: 'sparse' });
def({ id: 'wowRate', label: 'Wow Rate', min: 0.05, max: 3, def: 0.5, curve: 'exp', fmt: 'hz' });
def({ id: 'wowDepth', label: 'Wow Depth', min: 0, max: 1, def: 0.35, fmt: 'pct' });
def({ id: 'flutterAmt', label: 'Flutter', min: 0, max: 1, def: 0.2, fmt: 'pct' });

def({ id: 'granularDepth', label: 'Mix', min: 0, max: 1, def: 0, fmt: 'pct', rand: true, randBias: 'sparse' });
def({ id: 'granularRate', label: 'Density', min: 0, max: 80, def: 12, curve: 'pow', power: 2, fmt: 'hz' });
def({ id: 'granularSize', label: 'Grain Size', min: 0.01, max: 0.6, def: 0.12, curve: 'exp', fmt: 'sec' });
def({ id: 'granularSpread', label: 'Scatter', min: 0, max: 2, def: 0.5, fmt: 'sec' });
def({ id: 'granularPitch', label: 'Grain Pitch', min: -24, max: 24, def: 0, fmt: 'semi' });

// ---- Texture --------------------------------------------------------------

def({ id: 'radioVolume', label: 'Level', min: 0, max: 1, def: 0, fmt: 'pct', rand: true, randBias: 'sparse' });
def({ id: 'radioTuning', label: 'Tuning', min: 0, max: 100, def: 50, fmt: 'int', rand: true });
def({ id: 'radioQ', label: 'Bandwidth', min: 0.5, max: 40, def: 5, curve: 'exp', fmt: 'ratio' });
def({ id: 'radioDrift', label: 'Drift', min: 0, max: 1, def: 0.3, fmt: 'pct' });
def({ id: 'noiseColor', label: 'Colour', min: 0, max: 1, def: 0, fmt: 'pct', rand: true });

def({ id: 'hazeMix', label: 'Mix', min: 0, max: 1, def: 0, fmt: 'pct', rand: true, randBias: 'sparse' });
def({ id: 'hazeRate', label: 'Sample Rate', min: 1, max: 24, def: 12, curve: 'exp', fmt: 'khz' });
def({ id: 'hazeBits', label: 'Bit Depth', min: 2, max: 16, def: 16, step: 1, fmt: 'bits' });

def({ id: 'subMix', label: 'Mix', min: 0, max: 1, def: 0, fmt: 'pct', rand: true, randBias: 'sparse' });
def({ id: 'subLPCutoff', label: 'Low Pass', min: 40, max: 1200, def: 220, curve: 'exp', fmt: 'hz' });
def({ id: 'subDivMix', label: 'Octave ↔ Fifth', min: 0, max: 1, def: 0.35, fmt: 'pct' });

// ---- Evolve ---------------------------------------------------------------

def({ id: 'autoEvolve', label: 'Enable', type: 'bool', def: false });
def({ id: 'evolveRate', label: 'Interval', min: 5, max: 600, def: 30, curve: 'exp', fmt: 'sec' });
def({ id: 'evolveDepth', label: 'Depth', min: 0, max: 1, def: 0.5, fmt: 'pct' });

def({ id: 'harmonicDriftEnable', label: 'Enable', type: 'bool', def: false });
def({ id: 'harmonicCycle', label: 'Cycle', min: 0.5, max: 90, def: 20, curve: 'exp', fmt: 'min' });
def({ id: 'harmonicDepth', label: 'Depth', min: 0, max: 12, def: 3, fmt: 'semi' });

def({ id: 'timbralDriftEnable', label: 'Enable', type: 'bool', def: false });
def({ id: 'timbralCycle', label: 'Cycle', min: 0.5, max: 90, def: 15, curve: 'exp', fmt: 'min' });
def({ id: 'timbralDepth', label: 'Depth', min: 0, max: 4, def: 1.5, fmt: 'oct' });
def({ id: 'timbralSpeed', label: 'Morph Skew', min: 0, max: 1, def: 0.5, fmt: 'pct' });

def({ id: 'spatialDriftEnable', label: 'Enable', type: 'bool', def: false });
def({ id: 'spatialCycle', label: 'Cycle', min: 0.5, max: 90, def: 25, curve: 'exp', fmt: 'min' });
def({ id: 'spatialRange', label: 'Range', min: 0, max: 2, def: 1, fmt: 'ratio' });

def({ id: 'memoryEnable', label: 'Enable', type: 'bool', def: false });
def({ id: 'memoryInterval', label: 'Interval', min: 0.25, max: 30, def: 5, curve: 'exp', fmt: 'min' });
def({ id: 'memoryDepth', label: 'Recall Depth', min: 1, max: 16, def: 5, step: 1, fmt: 'int' });
def({ id: 'memoryMorphTime', label: 'Morph Time', min: 0.1, max: 15, def: 3, curve: 'exp', fmt: 'min' });
def({ id: 'memoryProbability', label: 'Probability', min: 0, max: 1, def: 0.5, fmt: 'pct' });

def({ id: 'organicDrift', label: 'Organic Drift', min: 0, max: 1, def: 0.4, fmt: 'pct' });
def({ id: 'breathRate', label: 'Breath Rate', min: 0.005, max: 1, def: 0.05, curve: 'exp', fmt: 'hz' });
def({ id: 'breathDepth', label: 'Breath Depth', min: 0, max: 0.5, def: 0.05, fmt: 'pct' });
def({ id: 'tiltAuto', label: 'Auto Tilt', type: 'bool', def: true });

// ---- Perform --------------------------------------------------------------

for (let i = 1; i <= 4; i++) {
  def({ id: `macro${i}`, label: `Macro ${i}`, min: 0, max: 1, def: 0, fmt: 'pct', mod: false });
}
def({ id: 'xyX', label: 'X', min: 0, max: 1, def: 0.5, fmt: 'pct', mod: false });
def({ id: 'xyY', label: 'Y', min: 0, max: 1, def: 0.5, fmt: 'pct', mod: false });

// The XY pad's destinations. The prototype offered four fixed choices per
// axis; these are the parameters that are actually worth playing by hand.
export const XY_TARGETS = [
  'filterFreq', 'filterQ', 'ringModDepth', 'ringModFreq', 'reverb', 'delayMix',
  'stereoWidth', 'distortion', 'distortion2', 'lfoDepth', 'lfoSpeed', 'toneTilt',
  'granularDepth', 'hazeMix', 'subMix', 'shimmerVolume', 'harmonizerVolume',
  'radioVolume', 'pulseWidth', 'waveMorph', 'supersawVolume', 'tremolo',
];

const xyOptions = () => XY_TARGETS.map((id) => ({ value: id, label: xyLabel(id) }));

def({ id: 'xyParamX', label: 'X Target', type: 'enum', def: 'filterFreq', mod: false, options: xyOptions() });
def({ id: 'xyParamY', label: 'Y Target', type: 'enum', def: 'ringModDepth', mod: false, options: xyOptions() });

// ---- Master ---------------------------------------------------------------

def({ id: 'masterVolume', label: 'Master', min: 0, max: 1, def: 0.35, fmt: 'pct', mod: false });
def({ id: 'stereoWidth', label: 'Width', min: 0, max: 2, def: 1, fmt: 'ratio', rand: true });
def({ id: 'limiterThreshold', label: 'Ceiling', min: -24, max: 0, def: -1, fmt: 'db', mod: false });
def({ id: 'limiterRelease', label: 'Release', min: 0.02, max: 1, def: 0.25, curve: 'exp', fmt: 'sec', mod: false });

export const PARAMS = P;
export const BY_ID = Object.fromEntries(P.map((p) => [p.id, p]));

export function defaults() {
  const out = {};
  for (const p of P) out[p.id] = p.def;
  return out;
}

// Parameters an automated system is allowed to write. Master volume, macro
// positions and voice counts are excluded: an evolving drone that quietly
// turns itself down, or rebuilds its oscillator bank mid-note, is a bug.
export const MODULATABLE = P.filter((p) => p.mod && p.type === 'num').map((p) => p.id);
