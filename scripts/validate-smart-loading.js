'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const errors = [];
const checks = [];
const pass = (name) => checks.push({ name, ok: true });
const fail = (name, detail) => { checks.push({ name, ok: false, detail }); errors.push(`${name}: ${detail}`); };
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const check = (name, cond, detail='failed') => cond ? pass(name) : fail(name, detail);

const index = read('index.html');
const loader = read('js/westo-smart-loader.js');
const table = read('js/table-cart.js');
const three = read('js/three-scene.js');
const liquid = read('js/westo-liquid-rail.js');
const sounds = read('js/sounds.js');
const server = read('server/server.js');
const pwa = read('js/pwa-bootstrap.js');
const webManifest = read('manifest.webmanifest');
const sw = read('sw.js');

const externalScripts = [...index.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]);
const stylesheets = [...index.matchAll(/<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]);
const hints = [...index.matchAll(/<link\b[^>]*\brel=["'](?:preload|modulepreload|prefetch)["'][^>]*\bhref=["']([^"']+)["'][^>]*>/gi)].map(m => m[1]);

check('root has bootstrap plus one app loader', externalScripts.length === 2 && externalScripts.some(x => x.includes('pwa-bootstrap.js')) && externalScripts.some(x => x.includes('westo-smart-loader.js')), JSON.stringify(externalScripts));
check('root has one external stylesheet', stylesheets.length === 1 && stylesheets[0].includes('westo-critical.smart.css'), JSON.stringify(stylesheets));
check('resource hints are budgeted', hints.length <= 3 && hints.some(x => x.includes('content-bootstrap.js')) && hints.some(x => x.includes('westo-app.smart.js')) && hints.some(x => x.includes('Vazirmatn-Variable.woff2')), JSON.stringify(hints));
check('PWA bootstrap owns service worker registration', /serviceWorker\s*\.\s*register\s*\(\s*['"]\/sw\.js/.test(pwa));
check('root links a standalone manifest', index.includes('manifest.webmanifest') && webManifest.includes('"display": "standalone"'));
check('service worker keeps navigation network-first', sw.includes('networkFirstNavigation') && sw.includes("request.mode === 'navigate'") && sw.includes("url.pathname.startsWith('/api/')"));
check('scheduler has explicit priority lanes', ['CRITICAL','INTENT','CURRENT','NEXT','VISIBLE','NEAR','PREDICT','BACKGROUND'].every(k => loader.includes(`${k}:`)));
check('scheduler has dedupe registry', loader.includes('const records = new Map()') && loader.includes('metrics.deduped'));
check('scheduler has preemption', loader.includes('preemptFor(priority)') && loader.includes("abort('westo-preempt')"));
check('scheduler reserves intent capacity', loader.includes('budget.reserve') && loader.includes('Keep one physical connection free'));
check('scheduler decodes before DOM commit', loader.includes('decodeObjectUrl') && loader.indexOf('await decodeObjectUrl(result.url)') < loader.indexOf('img.src = result.url'));
check('scheduler skips healthy same-source rebinds', loader.includes("img.dataset.westoManaged === '1'") && loader.includes('img.naturalWidth > 0'));
check('scheduler reacts to network quality', loader.includes('navigator.connection') && loader.includes("effectiveType === '3g'") && loader.includes('saveData'));
check('scheduler adapts to H2/H3 transport', loader.includes("detectedTransport === 'h2'") && loader.includes("detectedTransport === 'h3'"));
check('scheduler cancels old speculative category work', loader.includes("task.group.startsWith('cat:')") && loader.includes('task.priority < P.VISIBLE'));
check('scheduler predicts adjacent categories', loader.includes('lastDirection') && loader.includes("add(1, P.PREDICT)"));
check('audio routed through resource scheduler', sounds.includes('scheduler.requestAudio'));
check('dish boards routed through scheduler', table.includes('bindManagedImage(image, imageSrc') && table.includes('focusDish'));
check('dish rail is observer-managed', table.includes('observeManagedImage(img, srcImg'));
check('catbar images use lightweight managed/native strategy', (table.includes('applyCatChipThumb') && table.includes('bindManagedImage(img, src') && table.includes('pinned: true')) || (table.includes('categoryThumbFor') && table.includes('img.width = 128') && table.includes("track.dataset.loopCopies = '1'")));
check('category intent boosts before select', table.includes('intentCategory') && table.includes("reason: 'category-step'"));
check('category hover previews bytes', table.includes('previewCategory'));
check('Three image bytes use scheduler', three.includes('WestoResources') && three.includes('requestImage'));
check('Three postprocessing fanout bundled', three.includes('westo-postprocessing.bundle.mjs') && !three.includes("addons/postprocessing/EffectComposer.js'"));
check('Three uses one canonical core module', three.includes("from './vendor/three/three.module.js'") && !index.includes('type="importmap"'));
check('postprocessing is premium-only dynamic work', three.includes("const postFxCapable = initialPerfTier === 'premium' && !lowPower") && three.includes('await import('));
check('critical app runtime is collapsed', loader.includes('westo-app.smart.js') && !loader.includes('loadScript(`js/westo-foundation.smart.js'));
check('file protocol uses a public static bootstrap fallback', loader.includes('loadContentBootstrap') && loader.includes("location.protocol === 'file:'") && loader.includes('content-bootstrap.static.js') && exists('js/content-bootstrap.static.js'));
check('static bootstrap is built from the public server payload only', exists('scripts/build-static-content-bootstrap.js') && read('scripts/build-static-content-bootstrap.js').includes('publicContentPayload'));
check('background warming covers the full session', loader.includes('Session-prewarm policy') && loader.includes('for (const item of categoryItems(cid))') && loader.includes("group: 'fill:previews'") && !loader.includes('const maxDishWarm'));
check('dish media uses progressive preview binding', loader.includes('bindProgressiveImage') && table.includes('progressive: true'));
check('menu preview generator is available', exists('scripts/generate-menu-previews.js') && read('package.json').includes('images:previews'));
check('liquid shader barrel removed', liquid.includes('westo-liquid-shader.bundle.mjs') && !liquid.includes("import('@paper-design/shaders')"));
check('background runtime is deferred', loader.includes('setupBackground()') && loader.includes("fetchPriority: 'low'"));
check('Webflow is lower-page only', loader.includes("loadWebflow('near-lower-page')") && loader.includes("rootMargin: '1400px 0px'"));
check('server emits conservative early hints', server.includes('writeEarlyHints') && server.includes('westo-smart-loader.js') && !/writeEarlyHints[\s\S]{0,1200}assets\/menu\//.test(server));
check('versioned JS/CSS browser cache exists', server.includes('max-age=31536000, immutable'));

for (const rel of [
  'css/westo-critical.smart.css',
  'js/westo-foundation.smart.js',
  'js/westo-motion.smart.js',
  'js/westo-hero.smart.js',
  'js/westo-menu.smart.js',
  'js/westo-background.smart.js',
  'js/westo-app.smart.js',
  'js/vendor/three/westo-postprocessing.bundle.mjs',
  'js/vendor/westo-liquid-shader.bundle.mjs',
]) check(`generated asset exists: ${rel}`, exists(rel));

// Build reproducibility: bundle generator must reproduce byte-identical outputs.
const manifest = JSON.parse(read('smart-load-bundles.json'));
for (const bundle of manifest.bundles || []) {
  const buf = fs.readFileSync(path.join(ROOT, bundle.file));
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  check(`bundle hash matches manifest: ${bundle.file}`, sha === bundle.sha256, `${sha} != ${bundle.sha256}`);
}

// Local URL integrity for root references.
const refs = new Set();
for (const m of index.matchAll(/(?:src|href)=["']([^"'#?]+)(?:\?[^"']*)?["']/gi)) {
  const ref = m[1];
  if (!ref || /^(?:https?:|data:|mailto:|tel:|#)/i.test(ref) || ref.startsWith('/api/')) continue;
  refs.add(ref.replace(/^\//,''));
}
for (const ref of refs) {
  const ok = exists(ref) || (!path.extname(ref) && exists(`${ref}.html`));
  check(`root local ref exists: ${ref}`, ok, 'missing');
}

const report = {
  schema: 'westo-smart-loading-validation-v1',
  generatedAt: new Date().toISOString(),
  passed: checks.filter(c => c.ok).length,
  failed: checks.filter(c => !c.ok).length,
  checks,
};
fs.mkdirSync(path.join(ROOT, 'docs', 'smart-loading'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'smart-loading', 'VALIDATION.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`${report.passed}/${checks.length} checks PASS; ${report.failed} FAIL`);
if (errors.length) {
  for (const e of errors) console.error(`FAIL ${e}`);
  process.exit(1);
}
