// End-to-end suite. Drives the real instrument in Chromium: audio is measured
// through the analyser, controls are driven with a real pointer and real key
// presses, and the whole thing is run once more with AudioWorklet removed.
//
//   node --version   # 18+
//   npx http-server -p 8123 -s .    (from drone-synth/)
//   node test/browser.test.mjs
//
// Set SYNTH_URL to point it somewhere else, and CHROMIUM to a browser binary.

// Playwright is a dev dependency, not a runtime one; point PLAYWRIGHT_MODULE at
// a global install if it is not resolvable from here.
const playwright = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
  .catch(() => { throw new Error('Playwright not found. npm i -D playwright, or set PLAYWRIGHT_MODULE.'); });
const { chromium } = playwright;

const URL_BASE = process.env.SYNTH_URL || 'http://127.0.0.1:8123/index.html';
const EXECUTABLE = process.env.CHROMIUM || undefined;

const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  // The instrument only starts its AudioContext on a gesture; the flag lets
  // the suite drive it without one.
  args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--use-gl=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1560, height: 1200 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(URL_BASE, { waitUntil: 'networkidle' });
await page.click('#power');
await page.waitForTimeout(900);

// Shared helpers inside the page.
await page.evaluate(() => {
  const a = window.viceroy;
  window.T = {
    async rms(ms = 400) {
      const an = a.engine.nodes.analyser;
      const buf = new Float32Array(an.fftSize);
      let sum = 0, n = 0, peak = 0;
      const end = performance.now() + ms;
      while (performance.now() < end) {
        await new Promise((r) => setTimeout(r, 20));
        an.getFloatTimeDomainData(buf);
        for (const v of buf) { sum += v * v; n++; if (Math.abs(v) > peak) peak = Math.abs(v); }
      }
      return { rms: Math.sqrt(sum / n), peak };
    },
    reset() {
      const a = window.viceroy;
      a.systems.cancelMorphs();
      for (const id of ['harmonicDriftEnable', 'timbralDriftEnable', 'spatialDriftEnable',
                        'autoEvolve', 'memoryEnable', 'seqOn', 'morphEnable', 'tiltAuto']) a.setParam(id, false);
      for (const id of ['randAmount', 'envFollow', 'envToFilter', 'organicDrift', 'crossMod']) a.setParam(id, 0);
      a.setParam('probGate', 1);
      for (let i = 1; i <= 4; i++) a.setParam(`macro${i}`, 0);
    },
    solo(voice, opts = {}) {
      window.T.reset();
      for (const v of ['sine', 'square', 'triangle', 'sawtooth', 'pulse']) a.setParam(`${v}Vol`, v === voice ? 0.6 : 0);
      a.setParam('supersawVolume', 0); a.setParam('radioVolume', 0);
      a.setParam('reverb', 0); a.setParam('delayMix', 0); a.setParam('shimmerVolume', 0);
      a.setParam('harmonizerVolume', 0); a.setParam('chorusVolume', 0); a.setParam('wowFlutterVolume', 0);
      a.setParam('granularDepth', 0); a.setParam('hazeMix', 0); a.setParam('subMix', 0);
      a.setParam('organicDrift', 0); a.setParam('lfoDepth', 0); a.setParam('lfoToFilter', 0);
      a.setParam('filterFreq', 18000); a.setParam('distortion', 0); a.setParam('distortion2', 0);
      a.setParam('tremolo', 0); a.setParam('ringModDepth', opts.ring ?? 0);
      a.setParam('masterVolume', 0.5);
    },
  };
});

const results = [];
const check = async (name, fn) => {
  try {
    const [ok, detail] = await fn();
    results.push([ok, name, detail]);
  } catch (err) {
    results.push([false, name, `threw: ${err.message}`]);
  }
};

// 1. Ring depth at zero must not mute the instrument (the prototype's default state).
await check('ring depth 0 leaves the instrument audible', async () => {
  const r = await page.evaluate(async () => {
    window.T.solo('sine');
    await new Promise((r) => setTimeout(r, 250));
    const off = await window.T.rms(300);
    window.viceroy.setParam('ringModDepth', 1);
    await new Promise((r) => setTimeout(r, 250));
    const on = await window.T.rms(300);
    return { off: off.rms, on: on.rms };
  });
  return [r.off > 0.02, `depth 0 rms=${r.off.toFixed(4)}, depth 1 rms=${r.on.toFixed(4)}`];
});

// 2. A voice level of zero must actually silence it (no hidden 0.02 floor).
await check('a voice at zero is silent', async () => {
  const r = await page.evaluate(async () => {
    const a = window.viceroy;
    window.T.solo('sine');
    a.setParam('ringModDepth', 0);
    a.setParam('reverbDecay', 0.3);
    await new Promise((r) => setTimeout(r, 400));
    const loud = await window.T.rms(250);
    for (const v of ['sine', 'square', 'triangle', 'sawtooth', 'pulse']) a.setParam(`${v}Vol`, 0);
    // Long enough for the reverb and shimmer tails to run out; the question is
    // whether the voice gain reaches zero, not whether the room does.
    await new Promise((r) => setTimeout(r, 2500));
    const quiet = await window.T.rms(300);
    return { loud: loud.rms, quiet: quiet.rms, gain: a.engine.voice.sine.gain.gain.value };
  });
  return [r.quiet < 0.002 && r.loud > 0.05 && r.gain < 1e-4,
    `on=${r.loud.toFixed(4)} off=${r.quiet.toExponential(2)}, voice gain node = ${r.gain.toExponential(2)}`];
});

// 3. Zero drive is unity, not a hidden attenuation.
await check('drive at zero is the identity curve', async () => {
  const r = await page.evaluate(() => {
    const c = window.viceroy.engine.nodes.dist1.curve;
    const n = c.length;
    let worst = 0;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / (n - 1) - 1;
      worst = Math.max(worst, Math.abs(c[i] - x));
    }
    return { worst, mid: c[Math.floor(n * 0.75)] };
  });
  return [r.worst < 1e-6, `max deviation from y=x is ${r.worst.toExponential(2)}`];
});

// 4. Reverb mix zero is dry; the impulse is not rebuilt per pointer event.
await check('reverb mix is a real wet/dry control', async () => {
  // Measured as a decay tail rather than a level: the send adds energy that
  // sums incoherently with the dry signal and then meets the limiter, so
  // comparing loudness proves nothing. A tail after the source stops does.
  const tail = await page.evaluate(async () => {
    const a = window.viceroy;
    const measure = async (mix) => {
      window.T.solo('sine');
      a.setParam('reverb', mix);
      a.setParam('reverbDecay', 6);
      a.setParam('masterVolume', 0.3);
      await new Promise((r) => setTimeout(r, 900));
      for (const v of ['sine', 'square', 'triangle', 'sawtooth', 'pulse']) a.setParam(`${v}Vol`, 0);
      await new Promise((r) => setTimeout(r, 350));
      return (await window.T.rms(250)).rms;
    };
    const dry = await measure(0);
    const wet = await measure(1);
    return { dry, wet };
  });
  return [tail.wet > tail.dry * 8 && tail.dry < 0.003,
    `tail 350 ms after the note stops: mix 0 = ${tail.dry.toExponential(2)}, mix 1 = ${tail.wet.toFixed(4)}`];
});

await check('dragging reverb decay rebuilds the impulse once, not per event', async () => {
  const r = await page.evaluate(async () => {
    const a = window.viceroy;
    let builds = 0;
    const before = a.engine.nodes.convolver.buffer;
    const proto = Object.getOwnPropertyDescriptor(ConvolverNode.prototype, 'buffer');
    Object.defineProperty(a.engine.nodes.convolver, 'buffer', {
      configurable: true,
      get() { return proto.get.call(this); },
      set(v) { builds++; proto.set.call(this, v); },
    });
    for (let i = 0; i < 60; i++) a.setParam('reverbDecay', 1 + i * 0.1);
    await new Promise((r) => setTimeout(r, 400));
    delete a.engine.nodes.convolver.buffer;
    return { builds, changed: a.engine.nodes.convolver.buffer !== before };
  });
  return [r.builds <= 2, `${r.builds} rebuild(s) for 60 knob events`];
});

// 5. Radio tuning must stay inside the audible band at every position.
await check('radio tuning never runs past Nyquist', async () => {
  const r = await page.evaluate(() => {
    const a = window.viceroy;
    const nyq = a.engine.ctx.sampleRate / 2;
    let worst = 0;
    for (let v = 0; v <= 100; v += 5) {
      a.setParam('radioTuning', v);
      worst = Math.max(worst, a.engine.nodes.radioFilter.frequency.value);
    }
    return { worst, nyq };
  });
  return [r.worst < r.nyq, `highest ${Math.round(r.worst)} Hz against Nyquist ${r.nyq}`];
});

// 6. The user's knob wins over running automation.
await check('a knob move is heard while three systems modulate it', async () => {
  const r = await page.evaluate(async () => {
    const a = window.viceroy;
    window.T.solo('sawtooth');
    a.setParam('organicDrift', 0.6);
    a.setParam('timbralDriftEnable', true);
    a.setParam('seqOn', true);
    a.setParam('seqAmtFilter', 1);
    a.setParam('filterFreq', 200);
    await new Promise((r) => setTimeout(r, 700));
    const low = a.engine.nodes.filter.frequency.value;
    a.setParam('filterFreq', 12000);
    await new Promise((r) => setTimeout(r, 700));
    const high = a.engine.nodes.filter.frequency.value;
    a.setParam('seqOn', false); a.setParam('timbralDriftEnable', false); a.setParam('organicDrift', 0);
    return { low, high, base: a.store.get('filterFreq') };
  });
  return [r.high > r.low * 3, `node went ${Math.round(r.low)} Hz -> ${Math.round(r.high)} Hz`];
});

// 7. Pointer drag on a real control.
await check('pointer drag changes the value', async () => {
  await page.evaluate(() => window.viceroy.showTab('effects'));
  await page.waitForTimeout(200);
  await page.evaluate(() => { window.T.reset(); window.viceroy.setParam('filterFreq', 60); });
  await page.waitForTimeout(150);
  const before = await page.evaluate(() => window.viceroy.store.get('filterFreq'));
  const box = await page.locator('.ctl[data-param="filterFreq"] .ctl__track').boundingBox();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  const after = await page.evaluate(() => window.viceroy.store.get('filterFreq'));
  // 80% along an exponential 40 Hz - 18 kHz track is about 5.4 kHz.
  return [after > 4000 && after < 7000, `${Math.round(before)} Hz -> ${Math.round(after)} Hz (80% of the track)`];
});

// 8. Keyboard.
await check('arrow keys and double-click reset work', async () => {
  const track = page.locator('.ctl[data-param="filterQ"] .ctl__track');
  await track.focus();
  const start = await page.evaluate(() => window.viceroy.store.get('filterQ'));
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const up = await page.evaluate(() => window.viceroy.store.get('filterQ'));
  await page.keyboard.press('Home');
  const min = await page.evaluate(() => window.viceroy.store.get('filterQ'));
  await track.dblclick();
  const reset = await page.evaluate(() => window.viceroy.store.get('filterQ'));
  return [up > start && min === 0.1 && Math.abs(reset - 0.7) < 1e-9, `start=${start} up=${up.toFixed(3)} home=${min} dblclick=${reset}`];
});

// 9. Freeze.
await check('freeze captures and unfreeze restores the live path', async () => {
  const r = await page.evaluate(async () => {
    const a = window.viceroy;
    window.T.solo('sine');
    await new Promise((r) => setTimeout(r, 200));
    await a.toggleFreeze();
    await new Promise((r) => setTimeout(r, 300));
    const frozen = { live: a.engine.nodes.live.gain.value, froz: a.engine.nodes.frozen.gain.value, active: a.freezer.active };
    const level = await window.T.rms(250);
    await a.toggleFreeze();
    await new Promise((r) => setTimeout(r, 400));
    const thawed = { live: a.engine.nodes.live.gain.value, froz: a.engine.nodes.frozen.gain.value, active: a.freezer.active };
    return { frozen, thawed, level: level.rms, master: a.store.get('masterVolume') };
  });
  return [
    r.frozen.active && r.frozen.froz > 0.9 && r.frozen.live < 0.1 && !r.thawed.active && r.thawed.live > 0.9 && r.level > 0.01,
    `frozen live=${r.frozen.live.toFixed(2)} frozen=${r.frozen.froz.toFixed(2)} rms=${r.level.toFixed(4)}; master untouched at ${r.master}`,
  ];
});

// 10. Recording tears its tap down.
await check('recording connects and disconnects its tap', async () => {
  const r = await page.evaluate(async () => {
    const a = window.viceroy;
    const started = a.recorder.start();
    await new Promise((r) => setTimeout(r, 400));
    const during = { active: a.recorder.active, dest: !!a.recorder.dest };
    a.recorder.stop();
    await new Promise((r) => setTimeout(r, 500));
    return { started, during, after: { active: a.recorder.active, dest: !!a.recorder.dest } };
  });
  return [r.started && r.during.active && r.during.dest && !r.after.active && !r.after.dest,
    `started=${r.started} tap during=${r.during.dest} tap after=${r.after.dest}`];
});

// 11. Presets.
await check('loading a factory preset applies it', async () => {
  const r = await page.evaluate(async () => {
    const a = window.viceroy;
    document.getElementById('presetSelect').value = 'factory:Hollow Bell';
    a.loadSelectedPreset(0);
    await new Promise((r) => setTimeout(r, 200));
    return {
      shape: a.store.get('lfoShape'),
      type: a.store.get('filterType'),
      nodeType: a.engine.nodes.filter.type,
      tri: a.store.get('triangleVol'),
    };
  });
  return [r.shape === 'random' && r.type === 'bandpass' && r.nodeType === 'bandpass' && r.tri === 0.45,
    `lfo=${r.shape} filter=${r.type}/${r.nodeType} triangle=${r.tri}`];
});

await check('morphing into a preset travels rather than jumps', async () => {
  const r = await page.evaluate(async () => {
    const a = window.viceroy;
    a.systems.cancelMorphs();
    a.store.batch({ filterFreq: 400 });
    document.getElementById('presetSelect').value = 'factory:Grain Weather';
    a.loadSelectedPreset(4);
    await new Promise((r) => setTimeout(r, 900));
    const mid = a.store.get('filterFreq');
    await new Promise((r) => setTimeout(r, 4200));
    const end = a.store.get('filterFreq');
    return { mid, end };
  });
  return [r.mid > 400 && r.mid < 6700 && Math.abs(r.end - 6800) < 60, `mid=${Math.round(r.mid)} end=${Math.round(r.end)} (target 6800)`];
});

// 12. Macros are relative and reversible.
await check('a macro returns the patch exactly on the way back to zero', async () => {
  const r = await page.evaluate(async () => {
    const a = window.viceroy;
    a.systems.cancelMorphs();
    a.setParam('filterFreq', 2500);
    a.setParam('reverb', 0.3);
    a.setParam('macro1', 0.6);
    const up = { f: a.store.get('filterFreq'), r: a.store.get('reverb') };
    a.setParam('macro1', 0);
    return { up, back: { f: a.store.get('filterFreq'), r: a.store.get('reverb') } };
  });
  return [Math.abs(r.back.f - 2500) < 2 && Math.abs(r.back.r - 0.3) < 0.005,
    `up ${Math.round(r.up.f)}Hz/${r.up.r.toFixed(2)} -> back ${Math.round(r.back.f)}Hz/${r.back.r.toFixed(2)}`];
});

// 13. XY pad.
await check('the xy pad drives its assigned targets', async () => {
  await page.evaluate(() => window.viceroy.showTab('perform'));
  await page.waitForTimeout(250);
  const box = await page.locator('.xy__pad').boundingBox();
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.1, { steps: 2 });
  await page.mouse.up();
  const r = await page.evaluate(() => ({ f: window.viceroy.store.get('filterFreq'), ring: window.viceroy.store.get('ringModDepth') }));
  return [r.f > 8000 && r.ring > 0.8, `cutoff=${Math.round(r.f)} ring=${r.ring.toFixed(2)}`];
});

// 14. Memory.
await check('memory snapshot and recall round-trips the patch', async () => {
  const r = await page.evaluate(async () => {
    const a = window.viceroy;
    a.systems.cancelMorphs();
    a.setParam('filterFreq', 700);
    a.memorySnapshot();
    a.setParam('filterFreq', 15000);
    a.setParam('memoryMorphTime', 0.1);
    a.systems.recall(a.systems.memory.slots.length - 1);
    await new Promise((r) => setTimeout(r, 7000));
    return { f: a.store.get('filterFreq'), slots: a.systems.memory.slots.length };
  });
  return [Math.abs(r.f - 700) < 20, `returned to ${Math.round(r.f)} Hz from 15000 (${r.slots} snapshots)`];
});

// 15. Randomise, repeatedly, must never break the graph or clip hard.
await check('50 randomisations keep the output finite and bounded', async () => {
  const r = await page.evaluate(async () => {
    const a = window.viceroy;
    const { randomisePatch } = await import('/src/presets.js');
    let worstPeak = 0, bad = 0;
    for (let i = 0; i < 50; i++) {
      randomisePatch(a.store);
      await new Promise((r) => setTimeout(r, 40));
      const an = a.engine.nodes.analyser;
      const buf = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(buf);
      for (const v of buf) { if (!Number.isFinite(v)) bad++; if (Math.abs(v) > worstPeak) worstPeak = Math.abs(v); }
    }
    return { worstPeak, bad };
  });
  return [r.bad === 0 && r.worstPeak < 1.6, `peak ${r.worstPeak.toFixed(3)}, ${r.bad} non-finite samples`];
});

// 16. Legacy preset import through the real code path.
await check('a v28 prototype preset loads through the UI path', async () => {
  const r = await page.evaluate(async () => {
    const a = window.viceroy;
    const { importPreset } = await import('/src/presets.js');
    window.T.reset();
    const legacy = { sine_vol: '0.8', sine_pitch: '55', reverb: '0.7', delayTime: '0.5', waveMorph: '0.6', filterFreq: '2200' };
    const { values, warnings } = importPreset(JSON.stringify(legacy));
    a.store.batch(values);
    await new Promise((r) => setTimeout(r, 400));
    return {
      vol: a.store.get('sineVol'), pitch: a.store.get('sinePitch'),
      morph: a.store.get('morphEnable'), mix: a.store.get('delayMix'),
      nodeFreq: a.engine.nodes.voice ? 0 : 0,
      oscFreq: a.engine.voice.sine.osc.frequency.value,
      warnings: warnings.length,
    };
  });
  return [r.vol === 0.8 && r.pitch === 55 && r.morph === true && r.mix === 0.5 && Math.abs(r.oscFreq - 55) < 1.5,
    `sine ${r.vol} @ ${r.pitch}Hz (node ${r.oscFreq.toFixed(1)}Hz), morph on, ${r.warnings} notes`];
});

// 17. Power off leaves the patch alone.
await check('power off is silent and changes nothing', async () => {
  const r = await page.evaluate(async () => {
    const a = window.viceroy;
    a.setParam('masterVolume', 0.42);
    const before = JSON.stringify(a.store.snapshot());
    await a.togglePower();
    await new Promise((r) => setTimeout(r, 700));
    const level = await window.T.rms(300);
    const gate = a.engine.nodes.output.gain.value;
    const after = JSON.stringify(a.store.snapshot());
    await a.togglePower();
    await new Promise((r) => setTimeout(r, 400));
    return { level: level.rms, gate, same: before === after, master: a.store.get('masterVolume') };
  });
  return [r.level === 0 && r.gate === 0 && r.same,
    `output gate = ${r.gate}, rms while off = ${r.level.toExponential(2)}, patch unchanged = ${r.same}`];
});

// 17b. A knob move must be heard promptly even while a slow plate is running.
await check('a knob move is prompt while a four-second plate glide is active', async () => {
  const r = await page.evaluate(async () => {
    const a = window.viceroy;
    window.T.reset();
    a.setParam('harmonicDriftEnable', true);
    a.setParam('harmonicDepth', 7);
    a.setParam('sinePitch', 220);
    await new Promise((r) => setTimeout(r, 1200));
    a.setParam('sinePitch', 55);
    await new Promise((r) => setTimeout(r, 150));
    const quick = a.engine.voice.sine.osc.frequency.value;
    const target = a.router.valueFor('sinePitch');
    a.setParam('harmonicDriftEnable', false);
    return { quick, target };
  });
  return [Math.abs(r.quick - r.target) < 3,
    `node at ${r.quick.toFixed(1)} Hz 150 ms after the move, target ${r.target.toFixed(1)} Hz`];
});

// 18. Node count must not grow while the systems run.
await check('running for a while does not grow the graph', async () => {
  const r = await page.evaluate(async () => {
    const a = window.viceroy;
    a.setParam('autoEvolve', true); a.setParam('evolveRate', 5);
    a.setParam('seqOn', true); a.setParam('seqStepTime', 0.5);
    a.setParam('granularRate', 40); a.setParam('granularDepth', 0.3);
    a.setParam('memoryEnable', true); a.setParam('memoryInterval', 0.25);
    const count = () => performance.memory ? performance.memory.usedJSHeapSize : 0;
    const before = count();
    await new Promise((r) => setTimeout(r, 6000));
    const after = count();
    a.setParam('autoEvolve', false); a.setParam('seqOn', false); a.setParam('memoryEnable', false);
    return { before, after, slots: a.systems.memory.slots.length, morphs: a.systems.morphs.length };
  });
  const growthMb = (r.after - r.before) / 1048576;
  return [r.slots <= 16 && growthMb < 25, `heap +${growthMb.toFixed(1)} MB over 6 s, memory capped at ${r.slots} slots`];
});

// Show every tab so all controls are in the accessibility tree.
const audit = await page.evaluate(async () => {
  const app = window.viceroy;
  const { TABS } = await import('/src/ui/layout.js');
  const problems = [];
  const nameOf = (el) => {
    const byId = el.getAttribute('aria-labelledby');
    if (byId) { const l = document.getElementById(byId); if (l && l.textContent.trim()) return l.textContent.trim(); }
    const label = el.getAttribute('aria-label');
    if (label) return label;
    return '';
  };
  let sliders = 0, switches = 0, radios = 0;
  for (const tab of TABS) {
    app.showTab(tab.id);
    const panel = document.getElementById(`tab-${tab.id}`);
    for (const el of panel.querySelectorAll('[role="slider"]')) {
      sliders++;
      if (!nameOf(el)) problems.push(`slider without a name in ${tab.id}`);
      for (const attr of ['aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'aria-valuetext']) {
        if (!el.hasAttribute(attr)) problems.push(`slider missing ${attr} in ${tab.id} (${nameOf(el)})`);
      }
      if (el.tabIndex < 0) problems.push(`slider not focusable in ${tab.id} (${nameOf(el)})`);
    }
    for (const el of panel.querySelectorAll('[role="switch"]')) {
      switches++;
      if (!nameOf(el)) problems.push(`switch without a name in ${tab.id}`);
      if (!el.hasAttribute('aria-checked')) problems.push(`switch missing aria-checked in ${tab.id}`);
    }
    for (const el of panel.querySelectorAll('[role="radio"]')) {
      radios++;
      if (!el.textContent.trim()) problems.push(`radio without a label in ${tab.id}`);
      if (!el.hasAttribute('aria-checked')) problems.push(`radio missing aria-checked in ${tab.id}`);
    }
    for (const el of panel.querySelectorAll('select')) {
      if (!nameOf(el) && !el.labels?.length) problems.push(`select without a name in ${tab.id}`);
    }
    for (const el of panel.querySelectorAll('button:not([role])')) {
      if (!el.textContent.trim() && !nameOf(el)) problems.push(`button without a name in ${tab.id}`);
    }
  }
  // Tabs themselves
  for (const b of document.querySelectorAll('[role="tab"]')) {
    if (!b.hasAttribute('aria-selected')) problems.push('tab missing aria-selected');
    if (!b.hasAttribute('aria-controls')) problems.push('tab missing aria-controls');
  }
  for (const b of document.querySelectorAll('.rail__transport button')) {
    if (!b.textContent.trim()) problems.push('transport button without a name');
  }
  const live = document.getElementById('log').getAttribute('aria-live');
  if (live !== 'polite') problems.push('status region is not a live region');
  return { problems, sliders, switches, radios };
});
results.push([audit.problems.length === 0, 'every control has an accessible name and value',
  audit.problems.length
    ? audit.problems.slice(0, 5).join(' | ')
    : `${audit.sliders} sliders, ${audit.switches} switches, ${audit.radios} radio buttons`]);

// Keyboard: tab into the page and drive a control without a mouse.
await page.evaluate(() => window.viceroy.showTab('effects'));
await page.waitForTimeout(200);
const kb = await page.evaluate(async () => {
  const track = document.querySelector('.ctl[data-param="reverb"] .ctl__track');
  track.focus();
  const focused = document.activeElement === track;
  const style = getComputedStyle(track, ':focus-visible');
  return { focused, before: window.viceroy.store.get('reverb') };
});
await page.keyboard.press('End');
// Pressed back to back, faster than the render loop: each must count.
for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft');
const kbAfter = await page.evaluate(() => window.viceroy.store.get('reverb'));
results.push([kb.focused && Math.abs(kbAfter - 0.9) < 0.001, 'a control is operable from the keyboard alone',
  `focusable=${kb.focused}, End then five rapid ArrowLefts: ${kb.before} -> ${kbAfter.toFixed(2)} (want 0.90)`]);

// Graceful degradation: no AudioWorklet at all.
const page2 = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const errors2 = [];
page2.on('pageerror', (e) => errors2.push(e.message));
page2.on('console', (m) => { if (m.type() === 'error') errors2.push(m.text()); });
await page2.addInitScript(() => {
  const strip = (C) => { if (C) Object.defineProperty(C.prototype, 'audioWorklet', { get() { return undefined; }, configurable: true }); };
  strip(window.AudioContext);
  strip(window.webkitAudioContext);
});
await page2.goto(URL_BASE, { waitUntil: 'networkidle' });
await page2.click('#power');
await page2.waitForTimeout(1200);
const degraded = await page2.evaluate(async () => {
  const a = window.viceroy;
  const an = a.engine.nodes.analyser;
  const buf = new Float32Array(an.fftSize);
  let peak = 0;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 25));
    an.getFloatTimeDomainData(buf);
    for (const v of buf) peak = Math.max(peak, Math.abs(v));
  }
  // Touching a worklet-backed control must be a no-op, not a crash.
  let threw = null;
  try {
    a.setParam('granularDepth', 0.5);
    a.setParam('shimmerVolume', 0.5);
    a.setParam('hazeMix', 0.3);
    a.setParam('subMix', 0.4);
    a.setParam('harmonizerVolume', 0.4);
    await a.toggleFreeze();
  } catch (e) { threw = e.message; }
  return {
    worklets: a.hasWorklets,
    peak,
    unavailablePanels: document.querySelectorAll('.panel.is-unavailable').length,
    log: document.getElementById('log').textContent,
    threw,
  };
});
results.push([!degraded.worklets && degraded.peak > 0.05 && degraded.unavailablePanels === 5 && !degraded.threw && errors2.length === 0,
  'without AudioWorklet the instrument still runs and says what is missing',
  `peak ${degraded.peak.toFixed(3)}, ${degraded.unavailablePanels} panels marked unavailable, ${errors2.length} errors`]);

console.log('');
let fails = 0;
for (const [ok, name, detail] of results) {
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
console.log('');
console.log('CONSOLE ERRORS:', errors.length ? errors : 'none');
await browser.close();
process.exit(fails || errors.length ? 1 : 0);
