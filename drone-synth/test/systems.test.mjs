// The evolving systems, driven by a fake clock. Everything they do is a
// function of audio time, so they can be run for simulated hours in
// milliseconds.
import { Store } from '../src/store.js';
import { ModRouter } from '../src/engine/modulation.js';
import { Systems } from '../src/systems.js';

let fails = 0;
const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!c) fails++; };

function harness() {
  const store = new Store();
  const router = new ModRouter(store);
  const sys = new Systems(store, router);
  const clock = { t: 0 };
  const ramps = [];
  const fakeEngine = {
    ctx: { get currentTime() { return clock.t; } },
    nodes: {
      envAnalyser: { frequencyBinCount: 64 },
      probGate: { gain: { value: 1 } },
    },
    ramp(param, v) { param.value = v; ramps.push(v); },
  };
  // Deterministic-ish stand-in for the analyser
  fakeEngine.nodes.envAnalyser.getByteTimeDomainData = (buf) => buf.fill(128 + 60);
  sys.attach(fakeEngine);
  // Mirror the app's binding: the store notifies the systems so timers can be
  // re-aimed, and marks the router dirty so offsets re-sum against the new base.
  store.subscribe((id, v) => { sys.onParamChanged(id, v); router.markBaseChanged(id); });
  const advance = (seconds, stepSeconds = 0.033) => {
    const end = clock.t + seconds;
    while (clock.t < end) {
      clock.t = Math.min(end, clock.t + stepSeconds);
      sys.tick();
    }
  };
  return { store, router, sys, clock, advance, ramps, engine: fakeEngine };
}

// ---- tectonic plates run on their own clocks ----
{
  const h = harness();
  h.store.set('harmonicDriftEnable', true);
  h.store.set('harmonicCycle', 20);      // minutes
  h.store.set('harmonicDepth', 3);
  h.advance(600, 0.033);                  // 10 simulated minutes
  const st = h.sys.plateState('harmonic');
  ok('harmonic plate phase tracks wall time', Math.abs(st.phase - 0.5) < 0.02, `phase=${st.phase.toFixed(4)} after 10 of 20 min`);
  ok('harmonic plate reports real remaining time', Math.abs(st.remainingSeconds - 600) < 30, `${st.remainingSeconds.toFixed(0)}s left`);
  ok('harmonic plate moves pitch', h.router.isModulated('sinePitch'));

  // Coarse ticks (background-tab throttling) must not change the cycle length.
  const h2 = harness();
  h2.store.set('harmonicDriftEnable', true);
  h2.store.set('harmonicCycle', 20);
  h2.advance(600, 1.0);                   // once a second, as a throttled tab
  ok('plate phase is identical when ticks are throttled',
     Math.abs(h2.sys.plateState('harmonic').phase - st.phase) < 0.005,
     `${h2.sys.plateState('harmonic').phase.toFixed(4)} once-per-second vs ${st.phase.toFixed(4)} at 30 Hz`);

  // Disabling clears its offsets rather than leaving the last value stuck.
  h.store.set('harmonicDriftEnable', false);
  h.advance(1);
  ok('disabling a plate releases its offsets', !h.router.isModulated('sinePitch'));
}

// ---- plates are independent of auto-evolve ----
{
  const h = harness();
  h.store.set('timbralDriftEnable', true);
  h.store.set('timbralCycle', 5);
  h.store.set('autoEvolve', false);       // the prototype needed this on
  h.advance(120, 0.5);
  ok('timbral plate runs with auto-evolve off', h.router.isModulated('filterFreq'),
     `filter effective=${h.router.valueFor('filterFreq').toFixed(0)} Hz`);
  const p = h.sys.plateState('timbral');
  ok('timbral plate reports a real phase', p.phase > 0.3 && p.phase < 0.5, `phase=${p.phase.toFixed(3)}`);
}

// ---- sequencer modes ----
{
  const modes = { forward: [1,2,3,0], reverse: [3,2,1,0], pingpong: [1,2,3,2] };
  for (const [mode, want] of Object.entries(modes)) {
    const h = harness();
    h.store.set('seqOn', true);
    h.store.set('seqLength', 4);
    h.store.set('seqMode', mode);
    h.store.set('seqStepTime', 1);
    h.sys.resetSequencer();
    const seen = [];
    for (let i = 0; i < 4; i++) { h.advance(1.05, 0.05); seen.push(h.sys.seq.index); }
    ok(`sequencer ${mode}`, JSON.stringify(seen) === JSON.stringify(want), `got ${seen.join(',')} want ${want.join(',')}`);
  }
  const h = harness();
  h.store.set('seqOn', true); h.store.set('seqLength', 4); h.store.set('seqMode', 'random');
  h.store.set('seqStepTime', 0.2);
  h.advance(20, 0.05);
  ok('sequencer random stays in range', h.sys.seq.index >= 0 && h.sys.seq.index < 4);

  // Sequencer amounts of zero must publish nothing at all.
  const h3 = harness();
  h3.store.set('seqOn', true);
  h3.store.set('seqAmtFilter', 0); h3.store.set('seqAmtRing', 0);
  h3.store.set('seqAmtPitch', 0); h3.store.set('seqAmtPW', 0);
  h3.advance(3, 0.1);
  // Checked per source: organic drift also touches the cutoff by default, and
  // this is asserting that the *sequencer* publishes nothing.
  ok('sequencer at zero depth touches nothing',
     !h3.router.hasSource('filterFreq', 'seq') && !h3.router.hasSource('ringModDepth', 'seq') && !h3.router.hasSource('sinePitch', 'seq'));

  // Stopping restores the base value.
  const h4 = harness();
  h4.store.set('organicDrift', 0);          // isolate the sequencer
  h4.store.set('filterFreq', 2000);
  h4.store.set('seqStepTime', 1);
  h4.store.set('seqStep1', 1);
  h4.store.set('seqOn', true); h4.store.set('seqAmtFilter', 2);
  h4.advance(1.5, 0.05);                    // now on step 1, value +1 -> +2 octaves
  const during = h4.router.valueFor('filterFreq');
  ok('sequencer raises the cutoff by its depth', Math.abs(during - 8000) < 1, `${during.toFixed(0)} Hz (2000 Hz +2 oct)`);
  h4.store.set('seqOn', false);
  h4.advance(0.2, 0.1);
  ok('stopping the sequencer restores the cutoff', h4.router.valueFor('filterFreq') === 2000,
     `during=${during.toFixed(0)} after=${h4.router.valueFor('filterFreq').toFixed(0)}`);
}

// ---- the user's knob wins while systems are running ----
{
  const h = harness();
  h.store.set('filterFreq', 1000);
  h.store.set('seqOn', true);
  h.store.set('seqAmtFilter', 1);
  h.store.set('timbralDriftEnable', true);
  h.store.set('organicDrift', 0.5);
  h.advance(5, 0.1);
  h.store.set('filterFreq', 6000);
  h.advance(0.2, 0.05);
  const eff = h.router.valueFor('filterFreq');
  ok('moving the cutoff moves the sound while three systems modulate it',
     eff > 3000, `effective=${eff.toFixed(0)} Hz with base 6000`);
  ok('base value is what the user set', h.store.get('filterFreq') === 6000);
}

// ---- probability gate leaves master level alone ----
{
  const h = harness();
  h.store.set('probGate', 0.5);
  h.store.set('probRate', 20);
  h.store.set('masterVolume', 0.8);
  h.advance(5, 0.05);
  ok('gate writes only its own node', h.engine.nodes.probGate.gain.value <= 1);
  ok('gate never touches master volume', h.store.get('masterVolume') === 0.8);
  const h2 = harness();
  h2.store.set('probGate', 1);
  h2.advance(2, 0.05);
  ok('gate fully open at chance 1', h2.engine.nodes.probGate.gain.value === 1);
}

// ---- morph engagement is reversible ----
{
  const h = harness();
  h.store.set('sineVol', 0.4); h.store.set('squareVol', 0.9);
  h.store.set('morphEnable', true); h.store.set('waveMorph', 0.5);
  h.advance(0.2, 0.05);
  const sq = h.router.valueFor('squareVol');
  ok('morph takes over the three voices', Math.abs(sq - 1) < 1e-6, `square effective=${sq}`);
  h.store.set('morphEnable', false);
  h.advance(0.2, 0.05);
  ok('disengaging morph restores the mixer', h.store.get('squareVol') === 0.9 && !h.router.isModulated('squareVol'));
}

// ---- auto-evolve rewrites the patch, and can be undone ----
{
  const h = harness();
  h.store.set('evolveRate', 10);
  h.store.set('evolveDepth', 0.8);
  h.store.set('autoEvolve', true);         // enabling re-aims the timer
  const before = h.store.snapshot();
  h.advance(65, 0.2);
  const after = h.store.snapshot();
  const moved = Object.keys(before).filter((k) => before[k] !== after[k]);
  ok('auto-evolve changes the patch', moved.length >= 2, `${moved.length} parameters moved`);
  ok('auto-evolve fires on its interval', h.sys.evolve.count >= 5, `count=${h.sys.evolve.count} in 65s at 10s`);

  // Shortening the interval must take effect now, not after the old one expires.
  const hr = harness();
  hr.store.set('evolveRate', 600);
  hr.store.set('autoEvolve', true);
  hr.advance(5, 1);
  ok('long interval has not fired yet', hr.sys.evolve.count === 0);
  hr.store.set('evolveRate', 10);
  hr.advance(12, 0.5);
  ok('shortening the interval re-aims the pending fire', hr.sys.evolve.count >= 1, `count=${hr.sys.evolve.count}`);

  // Undo restores the state from immediately before the most recent evolve.
  const hu = harness();
  hu.store.set('organicDrift', 0);
  hu.store.set('evolveDepth', 1);
  hu.advance(1, 0.5);
  const pre = hu.store.get('filterFreq');
  hu.sys.triggerEvolve(1);
  hu.advance(60, 0.2);
  ok('undo restores the pre-evolve patch', hu.sys.undoEvolve() === true);
  hu.advance(4, 0.1);
  ok('undo actually lands', Math.abs(hu.store.get('filterFreq') - pre) < Math.max(1, pre * 0.02),
     `${hu.store.get('filterFreq').toFixed(0)} vs ${pre.toFixed(0)}`);
}

// ---- evolve stays in range, and stays musical ----
{
  const { BY_ID } = await import('../src/params.js');
  const h = harness();
  h.store.set('organicDrift', 0);
  h.store.set('evolveDepth', 1);
  h.sys.setEvolveHome();
  for (let i = 0; i < 400; i++) { h.sys.triggerEvolve(1); h.advance(3, 0.5); }
  const final = h.store.snapshot();
  let bad = [];
  for (const [id, v] of Object.entries(final)) {
    const p = BY_ID[id];
    if (p.type === 'num' && (v < p.min - 1e-9 || v > p.max + 1e-9)) bad.push(`${id}=${v}`);
  }
  ok('400 evolutions keep every value in range', bad.length === 0, bad.slice(0, 3).join(' '));

  // A clamped random walk is an absorbing process: without mean reversion,
  // everything ends up pinned to an end stop and the drone dies flat.
  const pool = ['filterFreq','reverb','stereoWidth','sineVol','ringModFreq','lfoSpeed','pulseWidth','toneTilt'];
  const pinned = pool.filter((id) => {
    const p = BY_ID[id]; const v = final[id];
    const t = (v - p.min) / (p.max - p.min);
    return t < 0.005 || t > 0.995;
  });
  ok('400 evolutions do not pin parameters to their end stops',
     pinned.length <= 1, pinned.length ? `pinned: ${pinned.join(', ')}` : 'none pinned');
}

// ---- memory ----
{
  const h = harness();
  h.store.set('memoryEnable', true);
  h.store.set('memoryInterval', 1);        // minutes
  h.store.set('memoryDepth', 3);
  h.store.set('memoryProbability', 0);     // capture only, no recall yet
  h.advance(60 * 10, 1);
  ok('memory captures on its interval', h.sys.memory.slots.length === 3, `slots=${h.sys.memory.slots.length} (capped at depth 3)`);
  h.store.set('filterFreq', 300);
  h.sys.takeSnapshot(true);
  h.store.set('filterFreq', 9000);
  h.store.set('memoryMorphTime', 0.1);     // 6 s
  ok('recall starts a morph', h.sys.recall(h.sys.memory.slots.length - 1) === true);
  h.advance(8, 0.1);
  ok('recall morphs the patch back', Math.abs(h.store.get('filterFreq') - 300) < 10, `${h.store.get('filterFreq').toFixed(1)}`);
  h.sys.clearMemory();
  ok('clear empties memory', h.sys.memory.slots.length === 0);
  ok('recall with empty memory is a no-op', h.sys.recall() === false);
}

// ---- organic drift is bounded ----
{
  const h = harness();
  h.store.set('organicDrift', 1);
  h.store.set('sinePan', 0);
  let maxPan = 0, maxDet = 0;
  for (let i = 0; i < 3000; i++) {
    h.advance(0.5, 0.5);
    maxPan = Math.max(maxPan, Math.abs(h.router.valueFor('sinePan')));
    maxDet = Math.max(maxDet, Math.abs(h.router.valueFor('sineDetune')));
  }
  ok('organic pan drift stays small', maxPan <= 0.19, `max |pan| = ${maxPan.toFixed(3)}`);
  ok('organic detune drift stays small', maxDet <= 6.01, `max |detune| = ${maxDet.toFixed(2)} cents`);
  h.store.set('organicDrift', 0);
  h.advance(0.2, 0.1);
  ok('organic drift at zero releases everything', !h.router.isModulated('sinePan'));
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall systems tests passed');
process.exit(fails ? 1 : 0);
