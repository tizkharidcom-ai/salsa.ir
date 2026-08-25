'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const size = (p) => fs.statSync(path.join(ROOT, p)).size;
const checks = [];
function check(name, ok, note='') { checks.push({name, ok:!!ok, note}); }

const css = read('css/westo-production-v11.css');
const js = read('js/westo-production-v11.js');
const critical = read('css/westo-critical.smart.css');
const app = read('js/westo-app.smart.js');
const build = read('scripts/build-smart-bundles.js');
const index = read('index.html');
const menu = read('menu.html');

check('production stylesheet exists', exists('css/westo-production-v11.css'));
check('production enhancer exists', exists('js/westo-production-v11.js'));
check('approved 10px micro-pattern asset exists', exists('assets/images/entrance/westo-micro-pattern-v8.png'));
check('approved CTA pattern crop exists', exists('assets/images/entrance/westo-cta-pattern-v8.webp'));
check('CSS owns production design-system marker', /WESTO Production Design System v11/.test(css));
check('JS is presentation-only bridge', /Presentation-only bridge/.test(js));
check('CSS is last smart critical source', /westo-production-v11\.css/.test(build));
check('JS is last smart app source', /westo-production-v11\.js/.test(build));
check('built critical bundle includes production CSS', critical.includes('WESTO Production Design System v11'));
check('built app bundle includes production JS', app.includes('WESTO Production UI enhancer v11'));
check('home does not double-load production CSS', !/href=["'][^"']*westo-production-v11\.css/.test(index));
check('home does not double-load production JS', !/src=["'][^"']*westo-production-v11\.js/.test(index));
check('classic menu loads production CSS', /westo-production-v11\.css/.test(menu));
check('classic menu loads production enhancer', /westo-production-v11\.js/.test(menu));
check('micro-pattern is authored at 10px', /background-size:\s*10px\s+10px/.test(css));
check('entrance large decorative pattern is disabled', /\.eg-pattern\s*\{[^}]*display:\s*none/s.test(css));
check('entrance CTA uses production pattern asset', /--prod-cta-pattern/.test(css) && /\.eg-cta::before/.test(css));
check('category hero preserves existing carousel API', /window\.carousel/.test(js));
check('production enhancer listens to category theme', /westo:category-theme/.test(js));
check('production enhancer listens to menu ready', /westo:menu-ready/.test(js));
check('production enhancer preserves admin pattern setting', /entrance\.pattern/.test(js));
check('production enhancer retry timer is bounded and cleared', /setInterval\s*\(/.test(js) && /tries > 80\) clearInterval\(timer\)/.test(js));
check('production CSS gzip stays modest', zlib.gzipSync(Buffer.from(css)).length < 12000, `${zlib.gzipSync(Buffer.from(css)).length} bytes gzip`);
check('production JS gzip stays modest', zlib.gzipSync(Buffer.from(js)).length < 9000, `${zlib.gzipSync(Buffer.from(js)).length} bytes gzip`);
check('production source assets are lightweight', size('assets/images/entrance/westo-cta-pattern-v8.webp') < 80000 && size('assets/images/entrance/westo-micro-pattern-v8.png') < 2048);

const pass = checks.filter(x=>x.ok).length;
checks.forEach((x,i)=>console.log(`${x.ok?'PASS':'FAIL'} ${String(i+1).padStart(2,'0')} ${x.name}${x.note?` — ${x.note}`:''}`));
console.log(`\nProduction v11 validation: ${pass}/${checks.length} passed`);
if (pass !== checks.length) process.exit(1);
