import { Store } from '../src/store.js';
import { ModRouter } from '../src/engine/modulation.js';
import { BY_ID } from '../src/params.js';

let fails = 0;
const ok = (n, c, d = '') => { console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${d ? '  — ' + d : ''}`); if (!c) fails++; };

const s = new Store();
ok('defaults load', s.get('filterFreq') === 4200);
s.set('filterFreq', 999999);
ok('set clamps to max', s.get('filterFreq') === BY_ID.filterFreq.max, String(s.get('filterFreq')));
s.set('filterFreq', 'nonsense');
ok('non-numeric falls back to default', s.get('filterFreq') === BY_ID.filterFreq.def);
s.set('seqLength', 3.7);
ok('step quantisation', s.get('seqLength') === 4, String(s.get('seqLength')));
s.set('filterType', 'bogus');
ok('enum rejects unknown value', s.get('filterType') === 'lowpass');
s.set('autoEvolve', 1);
ok('bool coerces', s.get('autoEvolve') === true);

let seen = [];
const un = s.subscribe((id, v) => seen.push(id));
s.set('reverb', 0.5);
s.set('reverb', 0.5);
ok('no notification when value is unchanged', seen.length === 1, `n=${seen.length}`);
un();

// ---- router ----
const r = new ModRouter(s);
const applied = [];
r.onApply = (id, v) => applied.push([id, v]);

s.set('filterFreq', 1000);
r.offset('filterFreq', 'seq', 500);
r.offset('filterFreq', 'evolve', -200);
r.flush();
ok('offsets sum onto the base', r.valueFor('filterFreq') === 1300, String(r.valueFor('filterFreq')));

r.offset('filterFreq', 'seq', 0);
r.flush();
ok('zero offset removes a source', r.valueFor('filterFreq') === 800, String(r.valueFor('filterFreq')));

r.clearSource('evolve');
r.flush();
ok('clearSource returns to base', r.valueFor('filterFreq') === 1000, String(r.valueFor('filterFreq')));
ok('untouched param reports its base', r.valueFor('reverb') === 0.5);
ok('isModulated is false once cleared', r.isModulated('filterFreq') === false);

r.offset('filterFreq', 'plate', 1e9);
r.flush();
ok('effective value is clamped to range', r.valueFor('filterFreq') === BY_ID.filterFreq.max);

// Base moves while a system holds an offset: the sum must follow, which is the
// case the prototype got wrong (the user's knob was overwritten).
r.offset('filterFreq', 'plate', 100);
r.flush();
s.set('filterFreq', 2000);
r.markBaseChanged('filterFreq');
r.flush();
ok('base change re-sums with live offsets', r.valueFor('filterFreq') === 2100, String(r.valueFor('filterFreq')));

// One write per parameter per flush no matter how many sources moved.
applied.length = 0;
r.offset('reverb', 'a', 0.1);
r.offset('reverb', 'b', 0.1);
r.offset('reverb', 'c', 0.1);
r.flush();
ok('many sources produce a single write', applied.filter(([id]) => id === 'reverb').length === 1, `writes=${applied.length}`);

// Smoothing belongs to the change, not to the parameter: a slow system's
// glide must not make the user's own knob move feel laggy.
{
  const s3 = new Store();
  const r3 = new ModRouter(s3);
  const seen = [];
  r3.onApply = (id, v, smooth) => seen.push(smooth);
  r3.offset('filterFreq', 'plate', 100, 4);   // a plate asks for a 4 s glide
  r3.flush();
  ok('a slow system gets its slow glide', seen[seen.length - 1] === 4, `smooth=${seen[seen.length - 1]}`);
  s3.set('filterFreq', 900);
  r3.markBaseChanged('filterFreq', 0.02);
  r3.flush();
  ok('a knob move against that system is applied quickly', seen[seen.length - 1] === 0.02, `smooth=${seen[seen.length - 1]}`);
  r3.offset('filterFreq', 'plate', 150, 4);
  r3.flush();
  ok('the slow glide returns for the system\'s own next move', seen[seen.length - 1] === 4, `smooth=${seen[seen.length - 1]}`);
}

// Idle flush must be free — this runs 30x a second.
applied.length = 0;
r.flush(); r.flush();
ok('idle flush does no work', applied.length === 0);

console.log(fails ? `\n${fails} FAILURE(S)` : '\nstore + router tests passed');
process.exit(fails ? 1 : 0);
