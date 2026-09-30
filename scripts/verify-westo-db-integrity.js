'use strict';

/**
 * Read-only integrity guard for the ignored WESTO JSON state file.
 *
 * The guard deliberately snapshots the current checkout instead of embedding
 * a historical checksum in CI. This catches an actual write during a test or
 * build while avoiding a false failure when the operational fixture has a
 * legitimate, owner-approved baseline change.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_DB_PATH = path.join(ROOT, 'server', 'data', 'db.json');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function snapshotFile(filePath = DEFAULT_DB_PATH) {
  const resolvedPath = path.resolve(filePath);
  const stat = fs.statSync(resolvedPath);
  return {
    path: resolvedPath,
    sha256: sha256File(resolvedPath),
    size: stat.size,
    mtimeMs: stat.mtimeMs
  };
}

function compareSnapshots(expected, actual) {
  const mismatches = [];
  for (const field of ['sha256', 'size', 'mtimeMs']) {
    if (expected?.[field] !== actual?.[field]) {
      mismatches.push({ field, expected: expected?.[field] ?? null, actual: actual?.[field] ?? null });
    }
  }
  return mismatches;
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === '--write' || item === '--verify') args.set(item.slice(2), true);
    else if (item === '--db' || item === '--snapshot') args.set(item.slice(2), argv[++index]);
  }
  return args;
}

function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const dbPath = args.get('db') || DEFAULT_DB_PATH;
  const snapshotPath = args.get('snapshot');
  const mode = args.get('write') ? 'write' : args.get('verify') ? 'verify' : null;

  if (!mode || !snapshotPath) {
    throw new Error('Usage: node scripts/verify-westo-db-integrity.js --write|--verify --snapshot <path> [--db <path>]');
  }

  const current = snapshotFile(dbPath);
  const resolvedSnapshotPath = path.resolve(snapshotPath);

  if (mode === 'write') {
    fs.mkdirSync(path.dirname(resolvedSnapshotPath), { recursive: true });
    fs.writeFileSync(resolvedSnapshotPath, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
    return { ok: true, mode, snapshot: current, snapshotPath: resolvedSnapshotPath };
  }

  const expected = JSON.parse(fs.readFileSync(resolvedSnapshotPath, 'utf8'));
  const mismatches = compareSnapshots(expected, current);
  return {
    ok: mismatches.length === 0,
    mode,
    snapshotPath: resolvedSnapshotPath,
    expected,
    actual: current,
    mismatches
  };
}

if (require.main === module) {
  try {
    const result = run();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.ok ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.message }, null, 2)}\n`);
    process.exitCode = 2;
  }
}

module.exports = { DEFAULT_DB_PATH, compareSnapshots, run, sha256File, snapshotFile };
