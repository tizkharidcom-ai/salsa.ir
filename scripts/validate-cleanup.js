'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const failures = [];
const pass = [];
function check(name, ok, detail='') { (ok ? pass : failures).push({name, detail}); }
function exists(rel){ return fs.existsSync(path.join(ROOT, rel)); }
const forbiddenFiles = [
  'capture-errors.js','test.html','serve.json','css/performance.css','css/westo-progress.css',
  'js/menu-overlay.js','js/performance-profile.js','js/vendor/Flip.min.js','js/vendor/umami.js',
  'assets/webgl','skills/westo-motion-qa'
];
for (const rel of forbiddenFiles) check(`removed ${rel}`, !exists(rel));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8'));
for (const dep of ['@paper-design/shaders','puppeteer','serve']) {
  check(`removed dependency ${dep}`, !(pkg.dependencies?.[dep] || pkg.devDependencies?.[dep]));
}
const table = fs.readFileSync(path.join(ROOT,'js/table-cart.js'),'utf8');
for (const name of ['dbgLog','scrubCatBarByDelta','catBarChipPitch','stepCatBarTrack','heroCarouselCenter','flockClusterSeat','playCatFlyToBar','playCatFlyFromBar','nearestCenteredCatChip','ensureFlockSeats','tweenCatFlyRelocate','finishReverseFlyHandoff','captureActiveDishBridgeSeat','makeCatFlyJoin','sampleCatFlyPath','fadeInHeroChromeAfterReverse','refreshSeatsAfterReverseLand']) {
  check(`dead symbol absent ${name}`, !new RegExp(`\\b${name}\\b`).test(table));
}
const critical = fs.readFileSync(path.join(ROOT,'css/westo-critical.smart.css'),'utf8');
check('legacy menu overlay CSS absent', !/(?:#menu-overlay|\.menu-overlay__|\.menu-detail__|\.menu-card__|\.menu-lang)/.test(critical));
check('PWA-only CSS absent from critical', !/\.is-pwa\b/.test(critical));
const routes = fs.readFileSync(path.join(ROOT,'server/server.js'),'utf8');
check('anime demo route removed', !/['\"]\/test['\"]\s*:\s*['\"]test\.html/.test(routes));
console.log(JSON.stringify({pass:pass.length, fail:failures.length, failures}, null, 2));
if (failures.length) process.exit(1);
