'use strict';
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const read=(p)=>fs.readFileSync(path.join(ROOT,p),'utf8');
const exists=(p)=>fs.existsSync(path.join(ROOT,p));
const loader=read('js/westo-smart-loader.js');
const cart=read('js/table-cart.js');
const prod=read('js/westo-production-v12.js');
const css=read('css/westo-production-v12.css');
const bundle=read('js/westo-app.smart.js');
const index=read('index.html');
const server=read('server/server.js');
const three=read('js/three-scene.js');
const menuSeed=JSON.parse(read('server/data/menu-seed.json'));
const db=JSON.parse(read('server/data/db.json'));
const checks=[];
const check=(name,pass,detail='')=>checks.push({name,pass:Boolean(pass),detail});

check('release13r7 root cache key',/release13r7/.test(index));
check('release13r7 loader version',/VERSION\s*=\s*['"]release13r7['"]/.test(loader));
check('release13r7 early hints',/release13r7/.test(server));
check('release13r7 postprocessing key',/release13r7/.test(three));
check('guest production CSS cache bumped', ['about.html','feedback.html','login.html','menu.html','order.html','profile.html','reserve.html'].every((f)=>read(f).includes('westo-production-v12.css?v=prod13r7')));
check('classic menu cart source cache bumped', read('menu.html').includes('table-cart.js?v=logic13r5'));
check('smart bundle rebuilt with v13.7 media model',bundle.includes('appliedSource')&&bundle.includes('expectedSource'));

check('image fast-hit uses appliedSource',/dataset\.appliedSource\s*===\s*original/.test(loader));
check('image fast-hit does not trust dataset.source',!/dataset\.source\s*===\s*original\s*&&[\s\S]{0,160}complete/.test(loader));
check('lazy observe invalidates older generation immediately',loader.includes(':observe:${expected}')&&loader.includes('imageBindings.set(img, pendingToken)'));
check('board binding stamps expected not fake applied',/image\.dataset\.expectedSource\s*=\s*imageSrc/.test(cart));
check('active media healer detects mismatched pixels',cart.includes('const mismatched = Boolean(img) && img.dataset.appliedSource !== src'));
check('rail binding compares appliedSource',cart.includes('if (img.dataset.appliedSource !== srcImg)'));

check('dish category pointerup capture exists',cart.includes("document.addEventListener('pointerup'")&&cart.includes('directChip(e, { fromPointer: true })'));
check('dish category stale fly flags auto-heal',cart.includes('recoverStableDishInteractionState()'));
check('dish category pointerdown recovers stable state',/pointerdown[\s\S]{0,260}recoverStableDishInteractionState\(\)/.test(cart));
check('dish category direct click uses authoritative selector',cart.includes('#westo-dish-catbar .westo-dish-catbar__chip[data-category-id]'));
check('hero category pointerup capture exists',prod.includes("document.addEventListener('pointerup'")&&prod.includes('activateFromEvent(e, true)'));
check('hero progress rail pointer events restored',/\.westo-v12-hero-rail[\s\S]{0,100}pointer-events:\s*auto\s*!important/.test(css));
check('hero progress whole line remains scrub target',prod.includes('The whole progress line is a scrub target'));

check('liquid shader rail is not loaded',loader.includes('function loadLiquid()') && loader.includes('liquidPromise = Promise.resolve(null)'));
check('legacy liquid rail DOM is removed',cart.includes("querySelectorAll(':scope > .benefits_rail-border, :scope > .benefits_rail-border--liquid')"));
check('active dish thumbnail cyan ring CSS suppressed',css.includes('clean food thumbnails: no cyan contour'));

check('directional dish transition exits upward forward',cart.includes('const outY = forward ? -11 : 11'));
check('directional dish transition enters from below forward',cart.includes('const inY = forward ? 11 : -11'));
check('directional transition preserves reduced motion',cart.includes('dishReducedMotion')&&cart.includes('if (reduced)'));
check('transition cleans inline transform after completion',cart.includes("style.removeProperty('transform')"));

check('light liquid glass tokens exist',css.includes('--westo-liquid-light-bg')&&css.includes('--westo-liquid-light-shadow'));
check('light entrance controls use backdrop blur',/html\[data-theme='light'\][\s\S]{0,2200}backdrop-filter:\s*blur\(22px\)/.test(css));
check('light active dock avoids square tile',css.includes('light entrance segmented controls keep liquid depth on active state')&&css.includes('border-radius: 999px !important'));
check('language inactive contrast explicitly controlled',css.includes("#westo-entrance .eg-lang-seg")&&css.includes('rgba(17,23,22,.50)'));
check('rounded focus treatment exists',css.includes('Rounded focus treatment'));
check('mobile dish rail keeps approved physical right edge in RTL', !css.includes("html[dir='rtl'].is-dish-boards .benefits_nav.is-menu-rail"));

function dataChecks(label,data,catKey,itemKey){
  const cats=data[catKey]||[]; const items=data[itemKey]||[];
  const catIds=new Set(cats.map(c=>String(c.id)));
  const idCounts=new Map(); const imageCats=new Map(); const missing=[]; const badCat=[];
  for(const item of items){
    const id=String(item.id); idCounts.set(id,(idCounts.get(id)||0)+1);
    if(!catIds.has(String(item.categoryId))) badCat.push(id);
    const img=String(item.img||item.image||'').trim();
    if(img){
      if(!imageCats.has(img)) imageCats.set(img,new Set()); imageCats.get(img).add(String(item.categoryId));
      const rel=img.split('?')[0].replace(/^\/+/, ''); if(!exists(rel)) missing.push(`${id}:${img}`);
    }
  }
  const dup=[...idCounts].filter(([,n])=>n>1);
  const cross=[...imageCats].filter(([,s])=>s.size>1);
  check(`${label}: 16 categories`,cats.length===16,`categories=${cats.length}`);
  check(`${label}: 146 menu items`,items.length===146,`items=${items.length}`);
  check(`${label}: no duplicate item ids`,dup.length===0,`duplicates=${dup.length}`);
  check(`${label}: every item belongs to a real category`,badCat.length===0,`bad=${badCat.length}`);
  check(`${label}: no image reused across categories`,cross.length===0,`cross=${cross.length}`);
  check(`${label}: every referenced menu image exists`,missing.length===0,`missing=${missing.length}`);
}
dataChecks('menu-seed',menuSeed,'categories','items');
dataChecks('db',db,'menuCategories','menuItems');

const pass=checks.filter(x=>x.pass).length, fail=checks.length-pass;
console.log(JSON.stringify({pass,fail,checks},null,2));
if(fail) process.exit(1);
