'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const read=r=>fs.readFileSync(path.join(ROOT,r),'utf8');
const index=read('index.html');
const css=read('css/westo-v14.3-ultra-fine.css');
const critical=read('css/westo-critical.smart.css');
const rescue=read('js/language-switch-rescue.js');
const build=read('scripts/build-smart-bundles.js');
const loader=read('js/westo-smart-loader.js');
const server=read('server/server.js');
const three=read('js/three-scene.js');
const v12=read('css/westo-production-v12.css');
const release=(loader.match(/const VERSION = '([^']+)'/)||[])[1]||'';
let pass=0,fail=0;const failures=[];
const check=(n,ok)=>{if(ok)pass++;else{fail++;failures.push(n)}};

check('release key is Ultra Fine v1 family',release.startsWith('release14uf1'));
check('index release coherence',index.includes(`westo-critical.smart.css?v=${release}`)&&index.includes(`westo-smart-loader.js?v=${release}`)&&index.includes(`westo-app.smart.js?v=${release}`));
check('server Early Hints coherence',server.includes(`westo-critical.smart.css?v=${release}`)&&server.includes(`westo-smart-loader.js?v=${release}`)&&server.includes(`westo-app.smart.js?v=${release}`));
check('Three postprocessing coherence',three.includes(`westo-postprocessing.bundle.mjs?v=${release}`));

check('header uses approved Persian wordmark asset',index.includes('assets/images/brand/westo-fa-wordmark.png?v=ultrafine1'));
check('header image intrinsic ratio matches asset',/navbar_logo navbar_logo--dark" width="768" height="224"/.test(index)&&/navbar_logo navbar_logo--light" width="768" height="224"/.test(index));
check('header container is real grid',/\.navbar_container \{[\s\S]*?display:grid !important;[\s\S]*?grid-template-columns:minmax\(0,1fr\) auto minmax\(0,1fr\) !important;/.test(css));
check('header logo is center grid track not absolute',/\.navbar_logo-link \{[\s\S]*?position:relative !important;[\s\S]*?left:auto !important;[\s\S]*?transform:none !important;[\s\S]*?grid-column:2 !important;[\s\S]*?justify-self:center !important;/.test(css));
check('dark header uses ivory wordmark',index.includes('westo-fa-wordmark.png?v=ultrafine1')&&css.includes('.navbar_logo--light { display:none !important; }'));
check('light header uses charcoal wordmark',index.includes('westo-fa-wordmark-dark.png?v=ultrafine1')&&css.includes("html[data-theme='light'] .navbar_logo--light { display:block !important; }"));
check('left and right controls keep grid tracks',css.includes('.navbar_sound-wrapper { grid-column:1 !important;justify-self:start !important; }')&&css.includes('.navbar_menu-wrapper { grid-column:3 !important;justify-self:end !important; }'));
check('mobile logo remains bounded',css.includes('width:clamp(78px,22vw,112px) !important'));

check('desktop entrance gets explicit five-row budget',/@media \(min-width:768px\)[\s\S]*?#westo-entrance\.has-eg-promo \.eg-card \{[\s\S]*?grid-template-rows:auto auto auto minmax\(0,1fr\) auto !important;/.test(css));
check('desktop promo bounded separately from mobile',/@media \(min-width:768px\)[\s\S]*?#westo-entrance \.eg-promo--experience \{[\s\S]*?width:min\(500px,62vw\) !important;[\s\S]*?--eg-promo-h:clamp\(185px,23vh,220px\)/.test(css));
check('short desktop promo has tighter budget',/@media \(min-width:768px\) and \(max-height:850px\)[\s\S]*?--eg-promo-h:clamp\(140px,18vh,158px\)/.test(css));
check('existing mobile promo geometry retained',css.includes('--eg-promo-h:clamp(172px,46vw,212px)')&&css.includes('--eg-promo-h:clamp(168px,46vw,198px)'));
check('desktop CTA compacted to fit without overlap',/@media \(min-width:768px\)[\s\S]*?#westo-entrance\.has-eg-promo \.eg-cta \{[\s\S]*?height:56px !important/.test(css));

check('all language segments share flex centering',/#westo-entrance \.eg-lang-seg,[\s\S]*?\.eg-lang-seg--ar \{[\s\S]*?display:flex !important;[\s\S]*?align-items:center !important;[\s\S]*?line-height:1 !important;/.test(css));
check('AR rescue no longer forces inline-flex baseline',!rescue.includes("setProperty('display', 'inline-flex'"));
check('AR rescue enforces flex center',rescue.includes("setProperty('display', 'flex', 'important')")&&rescue.includes("setProperty('align-items', 'center', 'important')")&&rescue.includes("setProperty('line-height', '1', 'important')"));

check('top dish underline uses classic proportional inset',/#westo-dish-catbar \.westo-dish-catbar__chip\.is-active::after \{[\s\S]*?inset-inline:28% !important;[\s\S]*?width:auto !important;[\s\S]*?transform:none !important;/.test(css));
check('top dish underline remains static/compositor-light',/#westo-dish-catbar \.westo-dish-catbar__chip\.is-active::after \{[\s\S]*?animation:none !important;[\s\S]*?filter:none !important;/.test(css));
check('active chip paint containment relaxation retained',css.includes('contain:layout style !important')&&css.includes('overflow:visible !important'));
check('legacy full-bar indicator remains disabled',css.includes('#westo-dish-catbar::before { display:none !important;content:none !important; }'));
check('classic lower underline reference unchanged',/\.westo-prod-hero-cat\.is-active::after,[\s\S]*?\.westo-dish-catbar__chip\.is-active::after \{[\s\S]*?inset-inline:28%;[\s\S]*?bottom:3px;[\s\S]*?height:2px;/.test(v12));

check('Resource Scheduler source still present',fs.existsSync(path.join(ROOT,'js/westo-smart-loader.js'))&&loader.includes('Central resource scheduler / browser download manager.')&&loader.includes('async function requestImage')&&loader.includes('supportsAvif'));
check('v14.3 thermal governor preserved',read('js/westo-v14.3-ultra-fine.js').includes('dataset.thermalIdle'));
check('promo state machine source preserved',read('js/entrance-promo-deck.js').includes('throwCard')&&read('js/entrance-promo-deck.js').includes('snapBack'));
check('category header lite source preserved',read('js/table-cart.js').includes('westo-dish-catbar'));
check('critical bundle contains Ultra Fine v1 corrections',critical.includes('WESTO Ultra Fine v1 — verified screenshot corrections'));
check('build still includes late Ultra Fine CSS',build.includes("'css/westo-v14.3-ultra-fine.css'"));

console.log(JSON.stringify({pass,fail,failures,release},null,2));
if(fail)process.exit(1);
