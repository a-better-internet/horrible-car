// The layout and the parameter registry have to agree.
//
// A parameter that exists but appears in no panel is a feature with no way to
// reach it, which is exactly how a rebuild quietly loses things. This suite is
// the mechanical guarantee that nothing was dropped.

import { PARAMS, BY_ID, VOICES } from '../src/params.js';
import { TABS, laidOutParams } from '../src/ui/layout.js';

let fails = 0;
const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!c) fails++; };

const placed = laidOutParams();
const all = new Set(PARAMS.map((p) => p.id));

const missing = [...all].filter((id) => !placed.has(id));
ok(`every one of the ${all.size} parameters is reachable in the interface`,
  missing.length === 0, missing.length ? `unreachable: ${missing.join(', ')}` : `${TABS.length} tabs`);

const ghosts = [...placed].filter((id) => !all.has(id));
ok('the layout references no parameter that does not exist',
  ghosts.length === 0, ghosts.join(', '));

// A control placed twice in a plain row would be two sliders for one value
// with no indication they are the same; only masterVolume is deliberately
// duplicated, into the transport rail.
const seen = new Map();
for (const tab of TABS) {
  for (const panel of tab.panels) {
    for (const id of panel.controls || []) seen.set(id, (seen.get(id) || 0) + 1);
  }
}
const dupes = [...seen].filter(([, n]) => n > 1).map(([id]) => id);
ok('no parameter is placed in two panels', dupes.length === 0, dupes.join(', '));

// Everything the prototype had, by name, must still be present under some id.
// This is the list read straight out of the v28 file's markup.
const V28 = [
  'pulseWidth', 'waveMorph', 'crossMod', 'crossModRate',
  'reverb', 'distortion', 'distortion2', 'delayTime', 'delayFeedback', 'tremolo', 'filterFreq',
  'lfoSpeed', 'lfoDepth', 'ringModFreq', 'ringModDepth', 'randAmount', 'envFollow', 'envToFilter',
  'probGate', 'probRate',
  'seqStepTime', 'seqSmooth', 'seqAmtFilter', 'seqAmtRing',
  'seqStep0', 'seqStep1', 'seqStep2', 'seqStep3', 'seqStep4', 'seqStep5', 'seqStep6', 'seqStep7',
  'supersawVolume', 'shimmerVolume', 'harmonizerVolume', 'harmonizerPitch', 'chorusVolume',
  'wowFlutterVolume', 'granularDepth', 'granularRate',
  'radioVolume', 'radioTuning', 'noiseColor', 'hazeMix', 'hazeRate', 'subMix', 'subLPCutoff',
  'stereoWidth', 'autoEvolve', 'evolveRate',
  'harmonicDriftEnable', 'harmonicCycle', 'harmonicDepth',
  'timbralDriftEnable', 'timbralCycle', 'timbralSpeed',
  'spatialDriftEnable', 'spatialCycle', 'spatialRange',
  'memoryEnable', 'memoryInterval', 'memoryDepth', 'memoryMorphTime', 'memoryProbability',
  'macro1', 'macro2', 'macro3', 'macro4', 'xyParamX', 'xyParamY',
  ...VOICES.flatMap((v) => [`${v}Vol`, `${v}Pitch`, `${v}Pan`]),
];
const lost = V28.filter((id) => !BY_ID[id]);
ok(`all ${V28.length} v28 controls survive`, lost.length === 0, lost.join(', '));

const unreachable = V28.filter((id) => BY_ID[id] && !placed.has(id));
ok('and all of them are reachable', unreachable.length === 0, unreachable.join(', '));

// Panels that need AudioWorklet must say so, or they will look broken rather
// than unavailable in a browser without it.
const workletModules = ['shimmerVolume', 'harmonizerVolume', 'granularDepth', 'hazeMix', 'subMix'];
const flagged = [];
for (const tab of TABS) {
  for (const panel of tab.panels) {
    if ((panel.controls || []).some((id) => workletModules.includes(id))) {
      if (panel.requires === 'worklets') flagged.push(panel.title);
    }
  }
}
ok('every worklet-backed panel declares the requirement', flagged.length === 5, `${flagged.length}: ${flagged.join(', ')}`);

// Panels should carry a title and either controls or a widget; an empty one is
// a layout mistake that renders as a stray box.
const empty = [];
for (const tab of TABS) {
  for (const panel of tab.panels) {
    if (!panel.title) empty.push(`${tab.id}: untitled panel`);
    if (!(panel.controls || []).length && !(panel.extras || []).length) empty.push(`${tab.id}/${panel.title}: nothing in it`);
  }
}
ok('no empty or untitled panels', empty.length === 0, empty.join(' | '));

console.log(fails ? `\n${fails} FAILURE(S)` : '\nlayout tests passed');
process.exit(fails ? 1 : 0);
