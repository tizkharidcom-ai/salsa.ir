'use strict';

// Generates sibling AVIF files while preserving every original WebP as the
// runtime fallback. The script is intentionally idempotent: it never replaces
// an existing AVIF and writes through a temporary file before renaming.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CHECK_ONLY = process.argv.includes('--check');
const roots = ['assets', 'uploads'].map((part) => path.join(ROOT, part));
const webps = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.isFile() && /\.webp$/i.test(entry.name)) webps.push(file);
  }
}

for (const dir of roots) walk(dir);

const missing = webps.filter((source) => !fs.existsSync(source.replace(/\.webp$/i, '.avif')));
if (CHECK_ONLY) {
  console.log(JSON.stringify({ webp: webps.length, missingAvif: missing.length }, null, 2));
  process.exit(missing.length ? 1 : 0);
}

if (!missing.length) {
  console.log(JSON.stringify({ webp: webps.length, generated: 0, skipped: webps.length }, null, 2));
  process.exit(0);
}

let generated = 0;
for (const source of missing) {
  const target = source.replace(/\.webp$/i, '.avif');
  const temporaryPng = `${target}.tmp-${process.pid}.png`;
  const temporaryAvif = `${target}.tmp-${process.pid}.avif`;
  const decode = spawnSync('ffmpeg', ['-y', '-v', 'error', '-i', source, '-frames:v', '1', temporaryPng], { encoding: 'utf8' });
  const encode = !decode.error && decode.status === 0
    ? spawnSync('avifenc', ['-q', '52', temporaryPng, temporaryAvif], { encoding: 'utf8' })
    : null;
  if (decode.error || decode.status !== 0 || !encode || encode.error || encode.status !== 0 || !fs.existsSync(temporaryAvif)) {
    try { fs.unlinkSync(temporaryPng); } catch (_) {}
    try { fs.unlinkSync(temporaryAvif); } catch (_) {}
    const failed = encode || decode;
    const detail = failed?.error?.message || failed?.stderr || failed?.stdout || 'unknown image conversion failure';
    throw new Error(`Unable to create ${path.relative(ROOT, target)}: ${detail.trim()}`);
  }
  fs.unlinkSync(temporaryPng);
  fs.renameSync(temporaryAvif, target);
  generated += 1;
}

console.log(JSON.stringify({ webp: webps.length, generated, skipped: webps.length - generated }, null, 2));
