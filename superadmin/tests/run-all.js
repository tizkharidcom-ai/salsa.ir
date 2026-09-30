/**
 * superadmin/tests/run-all.js
 *
 * Unified test runner for all Super Admin / God Mode test suites.
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const suites = [
  { name: 'Regression Suite', file: 'test-godmode-refactor.js' },
  { name: 'Evolution Suite', file: 'test-godmode-evolution.js' },
  { name: 'Production Hardening Suite', file: 'test-production-hardening.js' }
];

console.log('====================================================');
console.log('    SALSA SUPER ADMIN / GOD MODE TEST HARNESS       ');
console.log('====================================================\n');

let allPassed = true;
let totalPassed = 0;
let totalFailed = 0;

for (const suite of suites) {
  console.log(`▶ Running ${suite.name}...`);
  const fullPath = path.join(__dirname, suite.file);
  const result = spawnSync(process.execPath, [fullPath], {
    stdio: ['inherit', 'pipe', 'pipe'],
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    cwd: __dirname,
    env: { ...process.env, NODE_ENV: 'test' }
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);

  const summary = `${result.stdout || ''}\n${result.stderr || ''}`
    .match(/(?:EVOLUTION\s+)?SUMMARY:\s*(\d+)\s+PASSED,\s*(\d+)\s+FAILED|HARDENING SUITE SUMMARY:\s*(\d+)\s+PASSED,\s*(\d+)\s+FAILED/i);
  if (summary) {
    const passed = Number(summary[1] || summary[3]);
    const failed = Number(summary[2] || summary[4]);
    totalPassed += passed;
    totalFailed += failed;
  } else {
    allPassed = false;
    console.error(`\n❌ ${suite.name} did not emit a parseable test summary.\n`);
  }

  if (result.status !== 0) {
    allPassed = false;
    console.error(`\n❌ ${suite.name} FAILED with status code ${result.status}\n`);
  } else {
    console.log(`\n✅ ${suite.name} PASSED\n`);
  }
}

console.log('====================================================');
if (allPassed) {
  console.log(`🎉 ALL SUPER ADMIN SUITES PASSED SUCCESSFULLY (${totalPassed} passed, ${totalFailed} failed)!`);
  console.log('====================================================');
  process.exit(0);
} else {
  console.error('❌ ONE OR MORE SUITES FAILED.');
  console.log('====================================================');
  process.exit(1);
}
