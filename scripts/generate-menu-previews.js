'use strict';

// Generates tiny, same-photo previews for every menu item. The runtime keeps
// menu data pointing at the original image and derives this sibling path only
// while it needs a no-blank-state transition.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CHECK_ONLY = process.argv.includes('--check');
const MENU_PATH = path.join(ROOT, 'server/data/menu-seed.json');
const PREVIEW_SIDE = 96;

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr || result.stdout || 'unknown conversion error';
    throw new Error(`${command} failed: ${detail.trim()}`);
  }
}

function menuImageFiles() {
  const seed = JSON.parse(fs.readFileSync(MENU_PATH, 'utf8'));
  const items = Array.isArray(seed.items) ? seed.items : (seed.menuItems || []);
  const images = new Set();
  for (const item of items) {
    const source = String(item?.img || item?.image || '').trim();
    if (!source || /^https?:\/\//i.test(source)) continue;
    if (!/\.(?:webp|avif)(?:$|[?#])/i.test(source)) continue;
    const pathname = source.split(/[?#]/, 1)[0].replace(/^\/+/, '');
    const absolute = path.resolve(ROOT, pathname);
    if (!absolute.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(absolute)) continue;
    images.add(absolute);
  }
  return [...images].sort();
}

function targetsFor(source) {
  const parent = path.join(path.dirname(source), 'previews');
  const basename = path.basename(source, path.extname(source));
  return {
    webp: path.join(parent, `${basename}.webp`),
    avif: path.join(parent, `${basename}.avif`),
  };
}

const sources = menuImageFiles();
const missing = sources.filter((source) => {
  const targets = targetsFor(source);
  return !fs.existsSync(targets.webp) || !fs.existsSync(targets.avif);
});

if (CHECK_ONLY) {
  console.log(JSON.stringify({ menuImages: sources.length, missingPreviewPairs: missing.length }, null, 2));
  process.exit(missing.length ? 1 : 0);
}

let generated = 0;
for (const source of missing) {
  const targets = targetsFor(source);
  fs.mkdirSync(path.dirname(targets.webp), { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'westo-preview-'));
  const png = path.join(tempDir, 'preview.png');
  const webpTemp = `${targets.webp}.tmp-${process.pid}`;
  const avifTemp = `${targets.avif}.tmp-${process.pid}`;
  try {
    run('ffmpeg', ['-y', '-v', 'error', '-i', source, '-frames:v', '1', '-vf', `scale=${PREVIEW_SIDE}:${PREVIEW_SIDE}:force_original_aspect_ratio=decrease`, png]);
    if (!fs.existsSync(targets.webp)) {
      run('cwebp', ['-quiet', '-q', '46', png, '-o', webpTemp]);
      fs.renameSync(webpTemp, targets.webp);
    }
    if (!fs.existsSync(targets.avif)) {
      run('avifenc', ['-q', '30', '--qalpha', '100', '--ignore-profile', png, avifTemp]);
      fs.renameSync(avifTemp, targets.avif);
    }
    generated += 1;
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
    try { fs.unlinkSync(webpTemp); } catch (_) {}
    try { fs.unlinkSync(avifTemp); } catch (_) {}
  }
}

console.log(JSON.stringify({ menuImages: sources.length, generated, skipped: sources.length - generated }, null, 2));
