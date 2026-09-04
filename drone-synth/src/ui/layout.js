// The layout: which panel each control lives in, and in what order.
//
// Kept declarative and separate from the parameter table so the two can be
// checked against each other. A parameter that exists but appears in no panel
// is a feature with no way to reach it, and the build test fails on it.
//
// Two things moved out of the prototype's Master tab, which had grown to hold
// the evolution engine, the tectonic plates, the memory system, the macros and
// the XY pad all at once. The self-evolving systems now have a tab of their
// own — they are the point of the instrument — and the performance surfaces
// have another. Nothing was removed.

import { VOICES, VOICE_LABEL } from '../params.js';

const voicePanel = (v) => ({
  title: VOICE_LABEL[v],
  led: `voice:${v}`,
  controls: [`${v}Vol`, `${v}Pitch`, `${v}Detune`, `${v}Pan`, ...(v === 'pulse' ? ['pulseWidth'] : [])],
});

export const TABS = [
  {
    id: 'oscillators',
    label: 'Oscillators',
    hint: 'Five voices, a morph crossfader and cross-modulation.',
    panels: [
      ...VOICES.map(voicePanel),
      {
        title: 'Wave Morph',
        note: 'Crossfades sine → square → sawtooth. While engaged it owns those three levels; disengage and the mixer returns untouched.',
        controls: ['morphEnable', 'waveMorph'],
      },
      {
        title: 'Cross-Modulation',
        note: 'An audio-rate oscillator on the target voice’s tuning.',
        controls: ['crossMod', 'crossModRate', 'crossModTarget'],
      },
    ],
  },
  {
    id: 'effects',
    label: 'Effects',
    hint: 'Inserts and sends. Reverb, delay, shimmer and the rest run in parallel, not in a chain.',
    panels: [
      { title: 'Reverb', controls: ['reverb', 'reverbDecay', 'reverbPreDelay'] },
      { title: 'Delay', controls: ['delayMix', 'delayTime', 'delayFeedback'] },
      { title: 'Drive', note: 'Two shapes: arctan is the softer knee, tanh the harder. Both are unity at zero.', controls: ['distortion', 'distortion2'] },
      { title: 'Master Filter', controls: ['filterType', 'filterFreq', 'filterQ'] },
      { title: 'Tremolo', controls: ['tremolo', 'tremoloDepth'] },
      { title: 'Tone', note: 'Low-shelf tilt across the whole instrument.', controls: ['toneTilt'] },
    ],
  },
  {
    id: 'modulation',
    label: 'Modulation',
    hint: 'Everything here publishes through the modulation router, so several systems can share a destination without fighting over it.',
    panels: [
      { title: 'Global LFO', led: 'lfo', controls: ['lfoShape', 'lfoSpeed', 'lfoDepth', 'lfoToFilter'] },
      { title: 'Ring Modulator', controls: ['ringModFreq', 'ringModDepth'] },
      { title: 'Random Drift', led: 'random', controls: ['randAmount', 'randRate'] },
      { title: 'Envelope Follower', led: 'env', meter: 'env', controls: ['envFollow', 'envToFilter', 'envSmooth'] },
      { title: 'Probability Gate', led: 'gate', controls: ['probGate', 'probRate', 'probDepth', 'probSlew'] },
      {
        title: 'Step Sequencer',
        led: 'seq',
        span: 2,
        controls: ['seqOn', 'seqMode', 'seqLength', 'seqStepTime', 'seqSmooth'],
        extras: ['seq-depths', 'seq-steps'],
      },
    ],
  },
  {
    id: 'layers',
    label: 'Layers',
    hint: 'Parallel voices and pitched effects.',
    panels: [
      { title: 'SuperSaw Stack', controls: ['supersawVolume', 'supersawPitch', 'supersawDetune', 'supersawSpread', 'supersawVoices'] },
      { title: 'Shimmer', requires: 'worklets', note: 'A pitch shifter inside a feedback loop: each repeat climbs by the interval.', controls: ['shimmerVolume', 'shimmerPitch', 'shimmerFeedback', 'shimmerSize'] },
      { title: 'Harmonizer', requires: 'worklets', note: 'A real pitch shift that holds its interval.', controls: ['harmonizerVolume', 'harmonizerPitch', 'harmonizerFine'] },
      { title: 'Chorus', controls: ['chorusVolume', 'chorusRate', 'chorusDepth'] },
      { title: 'Wow & Flutter', note: 'Two rates: the slow tape wander and the fast one.', controls: ['wowFlutterVolume', 'wowRate', 'wowDepth', 'flutterAmt'] },
      { title: 'Granular', requires: 'worklets', note: 'Grains scattered across a rolling capture of the live signal.', controls: ['granularDepth', 'granularRate', 'granularSize', 'granularSpread', 'granularPitch'] },
    ],
  },
  {
    id: 'texture',
    label: 'Texture',
    hint: 'Noise, decimation and sub-octaves.',
    panels: [
      { title: 'Radio / Noise', controls: ['radioVolume', 'radioTuning', 'radioQ', 'radioDrift', 'noiseColor'] },
      { title: 'Haze', requires: 'worklets', note: 'Sample-rate and bit-depth reduction.', controls: ['hazeMix', 'hazeRate', 'hazeBits'] },
      { title: 'Sub Harmonics', requires: 'worklets', note: 'Frequency division an octave and a twelfth below.', controls: ['subMix', 'subLPCutoff', 'subDivMix'] },
    ],
  },
  {
    id: 'evolve',
    label: 'Evolve',
    hint: 'The systems that move the instrument without you. Plates and drift add reversible offsets; evolution and memory rewrite the patch itself.',
    panels: [
      {
        title: 'Auto-Evolve',
        led: 'evolve',
        note: 'Periodically nudges a handful of controls, orbiting the patch it started from rather than wandering off it.',
        controls: ['autoEvolve', 'evolveRate', 'evolveDepth'],
        extras: ['evolve-actions'],
      },
      { title: 'Harmonic Plate', led: 'plate:harmonic', note: 'The whole instrument drifts through an interval and back.', controls: ['harmonicDriftEnable', 'harmonicCycle', 'harmonicDepth'] },
      { title: 'Timbral Plate', led: 'plate:timbral', note: 'Cutoff, pulse width and tilt travelling together.', controls: ['timbralDriftEnable', 'timbralCycle', 'timbralDepth', 'timbralSpeed'] },
      { title: 'Spatial Plate', led: 'plate:spatial', note: 'Width breathes and the voices orbit at different phases.', controls: ['spatialDriftEnable', 'spatialCycle', 'spatialRange'] },
      { title: 'Tectonic Timeline', span: 2, extras: ['plate-timeline'] },
      {
        title: 'State Memory',
        led: 'memory',
        note: 'Captures the patch periodically and morphs back into an earlier one, so a long session circles instead of drifting away.',
        controls: ['memoryEnable', 'memoryInterval', 'memoryDepth', 'memoryMorphTime', 'memoryProbability'],
        extras: ['memory-actions'],
      },
      { title: 'Ambient Motion', note: 'Always-on life: a bounded random walk on tuning and image, plus the amplitude breath.', controls: ['organicDrift', 'breathRate', 'breathDepth', 'tiltAuto'] },
    ],
  },
  {
    id: 'perform',
    label: 'Perform',
    hint: 'Hands-on surfaces. Macros are relative — return one to zero and the patch is exactly as it was.',
    panels: [
      { title: 'Macros', span: 2, extras: ['macro-bank'] },
      { title: 'XY Pad', span: 2, controls: ['xyParamX', 'xyParamY'], extras: ['xy-pad'] },
    ],
  },
  {
    id: 'master',
    label: 'Master',
    hint: 'Output stage.',
    panels: [
      { title: 'Output', controls: ['masterVolume', 'stereoWidth'] },
      { title: 'Limiter', note: 'The last thing before the output gate.', controls: ['limiterThreshold', 'limiterRelease'] },
      { title: 'Signal Path', span: 2, extras: ['signal-path'] },
    ],
  },
];

/** Every parameter the layout places, for the coverage check. */
export function laidOutParams() {
  const out = new Set();
  for (const tab of TABS) {
    for (const panel of tab.panels) {
      for (const id of panel.controls || []) out.add(id);
    }
  }
  // Placed by custom widgets rather than by a plain control row.
  for (let i = 0; i < 8; i++) out.add(`seqStep${i}`);
  for (const id of ['seqAmtFilter', 'seqAmtRing', 'seqAmtPitch', 'seqAmtPW']) out.add(id);
  for (let i = 1; i <= 4; i++) out.add(`macro${i}`);
  out.add('xyX');
  out.add('xyY');
  return out;
}
