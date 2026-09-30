'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { evaluateProductionReadiness } = require('../server/salsa/control-plane/operational/production-readiness-gate');

function manifestPathFromArgs() {
  const index = process.argv.indexOf('--manifest');
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return process.env.NEEM_PRODUCTION_GATE_MANIFEST || null;
}

async function main() {
  const inputPath = manifestPathFromArgs();
  let manifest = null;
  let inputError = null;
  if (inputPath) {
    try {
      manifest = JSON.parse(await fs.readFile(path.resolve(inputPath), 'utf8'));
    } catch (error) {
      inputError = { code: 'MANIFEST_READ_FAILED', message: error.message };
    }
  }
  const report = evaluateProductionReadiness(manifest);
  if (inputError) report.blockers.unshift(inputError.code);
  if (inputError) report.inputError = inputError;
  report.manifestPath = inputPath ? path.resolve(inputPath) : null;
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : (inputError ? 2 : 3);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, status: 'NO_GO', error: { code: 'PRODUCTION_GATE_FAILED', message: error.message } }, null, 2)}\n`);
  process.exitCode = 2;
});
