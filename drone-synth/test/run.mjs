// Runs every suite. The unit suites need only Node; the browser suite needs
// Playwright and a static server on the port it expects.
//
//   node test/run.mjs            # unit suites
//   node test/run.mjs --browser  # unit suites plus the end-to-end suite

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const unit = ['dsp.test.mjs', 'state.test.mjs', 'systems.test.mjs', 'presets.test.mjs', 'layout.test.mjs'];
const suites = process.argv.includes('--browser') ? [...unit, 'browser.test.mjs'] : unit;

function run(file) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [join(here, file)], { stdio: 'inherit' });
    p.on('close', (code) => resolve(code === 0));
  });
}

const failed = [];
for (const file of suites) {
  console.log(`\n=== ${file} ===`);
  if (!(await run(file))) failed.push(file);
}

console.log('');
if (failed.length) {
  console.log(`${failed.length} suite(s) failed: ${failed.join(', ')}`);
  process.exit(1);
}
console.log(`All ${suites.length} suites passed.`);
