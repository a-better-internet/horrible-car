import { Store } from '../src/store.js';
import { BY_ID, PARAMS, VOICES, toNorm } from '../src/params.js';
import { FACTORY, exportPreset, importPreset, randomisePatch } from '../src/presets.js';
import { MacroMatrix, applyXY } from '../src/macros.js';

let fails = 0;
const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!c) fails++; };

// ---- factory presets only reference real parameters, in range ----
{
  let bad = [];
  for (const preset of FACTORY) {
    for (const [id, v] of Object.entries(preset.values)) {
      const p = BY_ID[id];
      if (!p) { bad.push(`${preset.name}: unknown "${id}"`); continue; }
      if (p.type === 'num' && (v < p.min || v > p.max)) bad.push(`${preset.name}: ${id}=${v} outside ${p.min}..${p.max}`);
      if (p.type === 'enum' && !p.options.some((o) => o.value === v)) bad.push(`${preset.name}: ${id}="${v}" not an option`);
      if (p.type === 'bool' && typeof v !== 'boolean') bad.push(`${preset.name}: ${id} not boolean`);
    }
  }
  ok(`${FACTORY.length} factory presets are valid`, bad.length === 0, bad.slice(0, 4).join(' | '));

  // Every preset should make a sound: at least one voice above silence.
  const silent = FACTORY.filter((p) => {
    const v = { ...p.values };
    const anyVoice = VOICES.some((w) => (v[`${w}Vol`] ?? BY_ID[`${w}Vol`].def) > 0.01);
    return !anyVoice && !(v.supersawVolume > 0.01) && !(v.radioVolume > 0.01);
  });
  ok('every factory preset has an audible source', silent.length === 0, silent.map((p) => p.name).join(', '));
}

// ---- round trip ----
{
  const s = new Store();
  s.set('filterFreq', 3333); s.set('filterType', 'bandpass'); s.set('autoEvolve', true);
  const json = JSON.stringify(exportPreset(s, { name: 'Test' }));
  const s2 = new Store();
  const { values, warnings } = importPreset(json);
  s2.batch(values);
  ok('native round trip preserves everything',
     s2.get('filterFreq') === 3333 && s2.get('filterType') === 'bandpass' && s2.get('autoEvolve') === true);
  ok('native round trip warns about nothing', warnings.length === 0, warnings.join(' | '));
}

// ---- prototype preset import ----
{
  // Exactly the shape the v28 prototype's Save Preset button wrote: every
  // value a string, oscillator controls keyed by dataset.
  const legacy = {
    sine_vol: '0.72', sine_pitch: '87', sine_pan: '-0.4',
    square_vol: '0', square_pitch: '110', square_pan: '0',
    triangle_vol: '0.3', triangle_pitch: '164', triangle_pan: '0.5',
    sawtooth_vol: '0', sawtooth_pitch: '110', sawtooth_pan: '0',
    pulse_vol: '0.1', pulse_pitch: '55', pulse_pan: '0',
    pulseWidth: '0.35', waveMorph: '0.4', crossMod: '0.2', crossModRate: '3',
    reverb: '0.6', distortion: '0.25', distortion2: '0', delayTime: '0.4',
    delayFeedback: '0.5', tremolo: '2', filterFreq: '3000',
    lfoSpeed: '0.8', lfoDepth: '25', ringModFreq: '120', ringModDepth: '0.3',
    randAmount: '0.2', envFollow: '0.4', envToFilter: '0.6',
    probGate: '0.8', probRate: '3', seqStepTime: '12', seqSmooth: '4',
    seqAmtFilter: '1.2', seqAmtRing: '0.3', seqStep0: '0.5', seqStep7: '-0.7',
    supersawVolume: '0.2', shimmerVolume: '0.35', harmonizerVolume: '0.15',
    harmonizerPitch: '7', chorusVolume: '0.2', wowFlutterVolume: '0.1',
    granularDepth: '0.3', granularRate: '18', radioVolume: '0.25',
    radioTuning: '30', noiseColor: '0.5', hazeMix: '0.2', hazeRate: '8',
    subMix: '0.4', subLPCutoff: '180', stereoWidth: '1.3',
    autoEvolve: true, evolveRate: '60',
    harmonicDriftEnable: true, harmonicCycle: '25', harmonicDepth: '4',
    timbralDriftEnable: false, timbralCycle: '15', timbralSpeed: '0.5',
    spatialDriftEnable: true, spatialCycle: '30', spatialRange: '1.5',
    memoryEnable: true, memoryInterval: '4', memoryDepth: '6',
    memoryMorphTime: '2', memoryProbability: '0.7',
    macro1: '0', macro2: '0', macro3: '0', macro4: '0',
  };
  const { values, warnings } = importPreset(JSON.stringify(legacy));
  const s = new Store();
  s.batch(values);
  ok('legacy oscillator keys map across', s.get('sineVol') === 0.72 && s.get('sinePitch') === 87 && s.get('sinePan') === -0.4);
  ok('legacy booleans survive', s.get('autoEvolve') === true && s.get('harmonicDriftEnable') === true && s.get('timbralDriftEnable') === false);
  ok('legacy sequencer steps survive', s.get('seqStep0') === 0.5 && s.get('seqStep7') === -0.7);
  ok('legacy reverb becomes mix + decay', s.get('reverbDecay') > 3 && s.get('reverb') > 0.25 && s.get('reverb') < 1,
     `decay=${s.get('reverbDecay')} mix=${s.get('reverb')}`);
  ok('legacy delay gets a usable mix', s.get('delayMix') === 0.5);
  ok('legacy wave morph is engaged', s.get('morphEnable') === true);
  ok('legacy import explains what changed', warnings.length >= 4, `${warnings.length} notes`);
  const unknown = warnings.filter((w) => w.includes('Ignored unknown'));
  ok('no legacy control silently dropped', unknown.length === 0, unknown.join(' | '));
}

// ---- malformed input ----
{
  ok('garbage JSON is reported, not thrown', importPreset('{oops').values === null);
  ok('non-object is reported', importPreset('42').values === null);
  const r = importPreset(JSON.stringify({ filterFreq: 'NaN', bogusControl: 5, filterType: 'wrong' }));
  ok('bad values are skipped rather than poisoning the patch',
     r.values.filterFreq === undefined && r.values.filterType === undefined && r.values.bogusControl === undefined);
}

// ---- randomisation lands on drones ----
{
  for (let trial = 0; trial < 60; trial++) {
    const s = new Store();
    s.set('masterVolume', 0.7);
    randomisePatch(s);
    const voices = VOICES.filter((v) => s.get(`${v}Vol`) > 0.01);
    if (voices.length > 3) { ok('randomise keeps the voice count small', false, `${voices.length} voices on trial ${trial}`); break; }
    if (s.get('masterVolume') !== 0.7) { ok('randomise never touches master volume', false, `trial ${trial}`); break; }
    const total = VOICES.reduce((a, v) => a + s.get(`${v}Vol`), 0);
    if (total > 2.0) { ok('randomise keeps total level sane', false, `sum=${total.toFixed(2)}`); break; }
    if (trial === 59) {
      ok('randomise keeps the voice count small', true, 'over 60 trials');
      ok('randomise never touches master volume', true);
      ok('randomise keeps total level sane', true);
    }
  }
  const s = new Store();
  randomisePatch(s);
  let bad = [];
  for (const [id, v] of Object.entries(s.snapshot())) {
    const p = BY_ID[id];
    if (p.type === 'num' && (v < p.min - 1e-9 || v > p.max + 1e-9)) bad.push(id);
  }
  ok('randomise stays in range', bad.length === 0, bad.join(', '));
}

// ---- macros ----
{
  const s = new Store();
  s.set('filterFreq', 2000);
  s.set('reverb', 0.2);
  const m = new MacroMatrix(s);
  m.apply('macro1', 0.5);
  const up = s.get('filterFreq');
  ok('macro moves its targets', up > 2000 && s.get('reverb') > 0.2, `filter ${up.toFixed(0)}, reverb ${s.get('reverb').toFixed(2)}`);
  m.apply('macro1', 0);
  ok('returning a macro to zero restores the patch exactly',
     Math.abs(s.get('filterFreq') - 2000) < 1 && Math.abs(s.get('reverb') - 0.2) < 0.005,
     `filter ${s.get('filterFreq').toFixed(1)}, reverb ${s.get('reverb').toFixed(3)}`);

  // A macro must not be able to drive a target out of range.
  m.apply('macro1', 1);
  ok('macro clamps at the top', s.get('filterFreq') <= BY_ID.filterFreq.max && s.get('reverb') <= 1);
  m.apply('macro1', 0);

  // Negative depth inverts.
  m.assign('macro2', 0, 'filterFreq', -0.5);
  m.apply('macro2', 1);
  ok('negative macro depth inverts direction', s.get('filterFreq') < 2000, `${s.get('filterFreq').toFixed(0)}`);
  m.apply('macro2', 0);

  ok('macro description is human readable', m.describe('macro1').includes('Filter Cutoff'), m.describe('macro1'));

  // Assignments survive a round trip through a preset.
  const m2 = new MacroMatrix(new Store());
  m2.setAssignments(m.toJSON());
  ok('macro assignments serialise', JSON.stringify(m2.toJSON()) === JSON.stringify(m.toJSON()));
  m2.setAssignments({ macro1: [{ id: 'notAParam', depth: 1 }] });
  ok('unknown macro targets are rejected', m2.assignments.macro1.length === 0);
}

// ---- XY pad ----
{
  const s = new Store();
  s.set('xyParamX', 'filterFreq');
  s.set('xyParamY', 'reverb');
  applyXY(s, 1, 0);
  ok('XY writes absolute values', s.get('filterFreq') === BY_ID.filterFreq.max && s.get('reverb') === 0);
  applyXY(s, 0, 1);
  ok('XY spans the full range', s.get('filterFreq') === BY_ID.filterFreq.min && s.get('reverb') === 1);
  applyXY(s, 0.5, 0.5);
  const mid = toNorm(BY_ID.filterFreq, s.get('filterFreq'));
  ok('XY centre is the middle of the slider, not of the Hz range', Math.abs(mid - 0.5) < 0.01, `norm=${mid.toFixed(3)}`);
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\npreset + macro tests passed');
process.exit(fails ? 1 : 0);
