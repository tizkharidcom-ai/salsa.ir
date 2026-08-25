'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(root, rel));
const checks = [];
const check = (name, pass, detail='') => checks.push({name, pass:!!pass, detail});

const index = read('index.html');
const anim = read('js/animations.js');
const app = read('js/westo-app.smart.js');
const hero = read('js/westo-hero.smart.js');
const css = read('css/westo-production-v12.css');
const logicCss = read('css/design-logic-v13.css');
const loader = read('js/westo-smart-loader.js');
const server = read('server/server.js');
const three = read('js/three-scene.js');

check('tiktok helper defined before use in source', /const tiktokUrl\s*=/.test(anim) && anim.indexOf('const tiktokUrl') < anim.indexOf("syncSocial('tiktok'"));
check('tiktok helper bundled in app', /const tiktokUrl\s*=/.test(app));
check('tiktok helper bundled in hero', /const tiktokUrl\s*=/.test(hero));
check('restaurant hydration cannot synchronously abort binding', /Promise\.resolve\(\)\.then\(loadRestaurant\)\.catch/.test(anim));
check('enter pre-reveal wait capped to <=2200ms', /waitForEnter\((\d+)\)/.test(anim) && Number(anim.match(/waitForEnter\((\d+)\)/)[1]) <= 2200);
check('3D hard fallback <=8s', /\},\s*8000\);/.test(anim));
check('degraded boot state is explicit', /dataset\.westoBootFallback\s*=\s*['"]1['"]/.test(anim));

check('navbar trigger preserves approved non-native geometry', /<div class="navbar_menu-button westo-menu-trigger" role="button" tabindex="0"/.test(index));
check('navbar trigger remains keyboard-operable', /button\.addEventListener\('keydown'/.test(anim));
check('navbar trigger exposes menu ownership', /aria-controls="westo-navbar-menu"/.test(index) && /aria-haspopup="dialog"/.test(index));
check('fullscreen navbar modal semantics retained', /id="westo-navbar-menu" role="dialog" aria-modal="true"/.test(index));
check('entrance close affordance retained', /data-eg-sheet-close/.test(index) && /\.eg-sheet-close\s*\{/.test(css));
check('entrance tabpanel duplicate role removed', !/role="tabpanel"[^>]*role="tabpanel"/.test(index));
check('navbar dialog not mislabeled by unrelated i18n key', !/id="westo-navbar-menu"[^>]*data-i18n-aria="cm\.experience"/.test(index));

check('production CSS keeps v12.9 rules before recovery guards', css.includes('WESTO v12.9') && css.indexOf('WESTO v12.9') < css.indexOf('WESTO Design Logic v13.1'));
check('no global disabled opacity override', !/button:disabled[^\{]*\{[^}]*opacity\s*:/s.test(logicCss));
check('no global aria-current text-decoration override', !/:where\(\[aria-current[^\{]*\{[^}]*text-decoration/s.test(logicCss));
check('no global media max-width override', !/img,svg,video,canvas\s*\{\s*max-width/s.test(logicCss));
check('no global hidden!important override', !/\[hidden\]\s*\{\s*display\s*:\s*none\s*!important/s.test(logicCss));
check('no global color-scheme override', !/color-scheme\s*:/s.test(logicCss));
check('coarse-pointer logic uses hit-area expansion, not layout resizing', /::after\s*\{[^}]*width:max\(100%,44px\)/s.test(logicCss) && !/@media \(pointer:coarse\)[\s\S]*min-block-size:var\(--dl-touch-min\)/.test(logicCss));
check('hidden semantic helper defined', /\.visually-hidden,\.sr-only\s*\{/.test(logicCss));
check('login semantic buttons keep link-like styling', /body\.panel-body \.auth-link-btn\s*\{/.test(logicCss));
check('golden-ratio tokens are advisory', /--dl-phi\s*:\s*1\.618/.test(logicCss));
check('reduced-motion guard retained', /prefers-reduced-motion:reduce/.test(logicCss));
check('forced-colors guard retained', /forced-colors:active/.test(logicCss));
check('short landscape guard retained', /max-height:560px/.test(logicCss));
check('320px reflow guard retained', /max-width:360px/.test(logicCss));

check('release generation root', /release13r3/.test(index));
check('release generation loader', /VERSION = ['"]release13r3['"]/.test(loader));
check('release generation server hints', /release13r3/.test(server));
check('release generation postFX', /release13r3/.test(three));
check('direct CSS cache generation bumped', [...fs.readdirSync(root).filter(f=>f.endsWith('.html'))].every(f => {
  const s=read(f); return !s.includes('westo-production-v12.css') || s.includes('westo-production-v12.css?v=prod13r1');
}));

const htmlFiles = fs.readdirSync(root).filter(f => f.endsWith('.html'));
let missingType = 0, hashLinks = 0, dupRole = 0;
for (const f of htmlFiles) {
  const s=read(f);
  missingType += (s.match(/<button\b(?![^>]*\btype=)[^>]*>/gi)||[]).length;
  hashLinks += (s.match(/<a\b[^>]*href=["']#["'][^>]*>/gi)||[]).length;
  dupRole += (s.match(/<[^>]+\brole=["'][^"']+["'][^>]+\brole=["'][^"']+["'][^>]*>/gi)||[]).length;
}
check('all buttons have explicit type', missingType===0, `missing=${missingType}`);
check('no href=# action controls', hashLinks===0, `hashLinks=${hashLinks}`);
check('no duplicate role attributes', dupRole===0, `duplicateRole=${dupRole}`);
check('13 top-level pages retained', htmlFiles.length===13, `pages=${htmlFiles.length}`);
check('approved v8 pattern retained', /westo-entrance-pattern-final-v8/.test(index) || /eg-pattern/.test(index));
check('glass language retained', /westo-glass\.css/.test(index) || /navbar_menu-atmosphere/.test(index));
check('carousel authoritative API retained', /carousel\.goTo/.test(app));
check('resource scheduler retained', /WestoResources/.test(loader));

const passed=checks.filter(x=>x.pass).length, failed=checks.filter(x=>!x.pass);
console.log(JSON.stringify({pass:passed, fail:failed.length, failures:failed.map(x=>x.name), checks},null,2));
if (failed.length) process.exit(1);
