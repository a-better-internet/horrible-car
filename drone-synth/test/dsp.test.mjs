// Harness: run each AudioWorklet processor off-thread with a shimmed global
// environment, so the DSP can be exercised without a browser.
import vm from 'node:vm';
import * as W from '../src/engine/worklets.js';

const SR = 48000;

function host(src) {
  const registry = {};
  const sandbox = {
    sampleRate: SR,
    currentTime: 0,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage(){}, onmessage: null }; } },
    registerProcessor: (name, cls) => { registry[name] = cls; },
    Math, Float32Array, console,
  };
  vm.createContext(sandbox);
  new vm.Script(src).runInContext(sandbox);
  return registry;
}

function blocks(n, fill) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const L = new Float32Array(128), R = new Float32Array(128);
    for (let j = 0; j < 128; j++) { const s = fill(i * 128 + j); L[j] = s; R[j] = s; }
    out.push([L, R]);
  }
  return out;
}
function run(proc, input, params, nBlocks) {
  const outAll = [];
  for (let b = 0; b < nBlocks; b++) {
    const oL = new Float32Array(128), oR = new Float32Array(128);
    proc.process([input[b] || [new Float32Array(128), new Float32Array(128)]], [[oL, oR]], params);
    outAll.push(oL);
  }
  return outAll;
}
function rms(arrs, from = 0) {
  let s = 0, n = 0;
  for (let i = from; i < arrs.length; i++) for (const v of arrs[i]) { s += v * v; n++; }
  return Math.sqrt(s / Math.max(1, n));
}
function fundamental(arrs, from) {
  // crude: count zero crossings over the tail
  const flat = [];
  for (let i = from; i < arrs.length; i++) flat.push(...arrs[i]);
  let cross = 0;
  for (let i = 1; i < flat.length; i++) if ((flat[i - 1] <= 0) !== (flat[i] <= 0)) cross++;
  return (cross / 2) * (SR / flat.length);
}

let fails = 0;
const ok = (name, cond, detail = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); if (!cond) fails++; };

// ---------- Downsample + bitcrush ----------
{
  const R = host(W.DOWNSAMPLE);
  const p = new R['downsample-processor']();
  p.port.onmessage({ data: { rate: 6000, bits: 16 } });
  // A ramp, not a sine: a sine's samples straddle its peak symmetrically, so
  // two adjacent holds can be bit-identical and read as one run of 16.
  const ramp = blocks(40, (i) => (i % 4096) / 4096);
  const out = run(p, ramp, {}, 40);
  // hold length should be SR/6000 = 8 samples: consecutive runs of equal values
  const flat = []; for (let i = 10; i < out.length; i++) flat.push(...out[i]);
  let maxRun = 1, run_ = 1;
  for (let i = 1; i < flat.length; i++) { if (flat[i] === flat[i - 1]) { run_++; maxRun = Math.max(maxRun, run_); } else run_ = 1; }
  ok('downsample holds SR/rate samples', maxRun === 8, `maxRun=${maxRun}`);
  p.port.onmessage({ data: { bits: 3 } });
  const sig = blocks(40, (i) => Math.sin(2 * Math.PI * 200 * i / SR));
  const out2 = run(p, sig, {}, 40);
  const vals = new Set(); for (let i = 20; i < out2.length; i++) for (const v of out2[i]) vals.add(v.toFixed(6));
  ok('bitcrush quantises to few levels', vals.size <= 9, `distinct=${vals.size}`);
  // silence in -> silence out
  const p2 = new R['downsample-processor']();
  const oL = new Float32Array(128), oR = new Float32Array(128);
  p2.process([[]], [[oL, oR]], {});
  ok('downsample survives empty input', oL.every((v) => v === 0));
}

// ---------- Sub divider ----------
{
  const R = host(W.SUB_DIVIDER);
  const p = new R['sub-divider-processor']();
  const F = 220;
  const sig = blocks(200, (i) => 0.8 * Math.sin(2 * Math.PI * F * i / SR));
  const out = run(p, sig, { blend: new Float32Array([0]) }, 200);
  const f = fundamental(out, 120);
  ok('sub /2 lands an octave down', Math.abs(f - F / 2) / (F / 2) < 0.12, `got ${f.toFixed(1)} Hz, want ${F / 2}`);
  // Noise-riding test: the prototype's version re-clocked on every crossing.
  const p2 = new R['sub-divider-processor']();
  const noisy = blocks(200, (i) => 0.8 * Math.sin(2 * Math.PI * F * i / SR) + 0.05 * (Math.random() * 2 - 1));
  const out2 = run(p2, noisy, { blend: new Float32Array([0]) }, 200);
  const f2 = fundamental(out2, 120);
  ok('sub is stable with noise on the input', Math.abs(f2 - F / 2) / (F / 2) < 0.2, `got ${f2.toFixed(1)} Hz`);
  // Silence gate
  const p3 = new R['sub-divider-processor']();
  const quiet = blocks(120, () => 0);
  const out3 = run(p3, quiet, { blend: new Float32Array([0.35]) }, 120);
  ok('sub gates to silence on no input', rms(out3, 60) < 1e-3, `rms=${rms(out3, 60).toExponential(2)}`);
}

// ---------- Pitch shifter ----------
{
  const R = host(W.PITCH_SHIFT);
  for (const [semi, want] of [[12, 2], [7, Math.pow(2, 7 / 12)], [-12, 0.5]]) {
    const p = new R['pitch-shift-processor']();
    const F = 300;
    const sig = blocks(400, (i) => 0.7 * Math.sin(2 * Math.PI * F * i / SR));
    const out = run(p, sig, { ratio: new Float32Array([want]), window: new Float32Array([0.08]) }, 400);
    const f = fundamental(out, 250);
    const target = F * want;
    ok(`pitch shift ${semi > 0 ? '+' : ''}${semi} st`, Math.abs(f - target) / target < 0.06, `got ${f.toFixed(1)} Hz, want ${target.toFixed(1)}`);
  }
  // Unity ratio must pass audio at roughly unity gain (equal-power windows).
  const p = new R['pitch-shift-processor']();
  const sig = blocks(300, (i) => 0.5 * Math.sin(2 * Math.PI * 300 * i / SR));
  const out = run(p, sig, { ratio: new Float32Array([1]), window: new Float32Array([0.08]) }, 300);
  const g = rms(out, 200) / 0.5 * Math.SQRT2;
  ok('pitch shift at ratio 1 is near unity gain', g > 0.7 && g < 1.35, `gain=${g.toFixed(3)}`);
}

// ---------- Granular ----------
{
  const R = host(W.GRANULAR);
  const p = new R['granular-processor']();
  const sig = blocks(600, (i) => 0.6 * Math.sin(2 * Math.PI * 220 * i / SR));
  const pr = { density: new Float32Array([20]), size: new Float32Array([0.1]), scatter: new Float32Array([0.4]), pitch: new Float32Array([1]), spread: new Float32Array([0.5]) };
  const out = run(p, sig, pr, 600);
  const level = rms(out, 400);
  ok('granular produces signal from the live buffer', level > 0.02, `rms=${level.toFixed(4)}`);
  ok('granular stays bounded', out.slice(400).every((b) => b.every((v) => Math.abs(v) < 2)), 'no sample beyond ±2');
  // density 0 -> silence
  const p2 = new R['granular-processor']();
  const out2 = run(p2, sig, { ...pr, density: new Float32Array([0]) }, 300);
  ok('granular at zero density is silent', rms(out2, 100) < 1e-6);
  // Grains must never read ahead of the write head (that would read stale
  // samples from four seconds ago and click).
  const p3 = new R['granular-processor']();
  const impulse = blocks(400, (i) => (i < 128 ? 0 : Math.sin(2 * Math.PI * 220 * i / SR)));
  const out3 = run(p3, impulse, pr, 400);
  ok('granular has no discontinuity spikes', out3.slice(300).every((b) => { for (let i = 1; i < b.length; i++) if (Math.abs(b[i] - b[i - 1]) > 0.4) return false; return true; }));
}

// ---------- Capture ----------
{
  const R = host(W.CAPTURE);
  const p = new R['capture-processor']();
  let posted = null;
  p.port.postMessage = (m) => { posted = m; };
  p.port.onmessage({ data: { cmd: 'record', seconds: 0.01 } });   // 480 samples
  const sig = blocks(10, (i) => i / 10000);
  for (let b = 0; b < 10; b++) p.process([sig[b]]);
  ok('capture posts a filled buffer', !!posted && posted.done && posted.L.length === 480, posted ? `len=${posted.L.length}` : 'nothing posted');
  ok('capture data matches the input', posted && Math.abs(posted.L[100] - 100 / 10000) < 1e-6);
}

console.log(fails ? `\n${fails} FAILURE(S)` : '\nall worklet DSP tests passed');
process.exit(fails ? 1 : 0);
