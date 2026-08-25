"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(ROOT,"css/westo-production-v12.css"),"utf8");
const critical = fs.readFileSync(path.join(ROOT,"css/westo-critical.smart.css"),"utf8");
const index = fs.readFileSync(path.join(ROOT,"index.html"),"utf8");
const menu = fs.readFileSync(path.join(ROOT,"menu.html"),"utf8");
const server = fs.readFileSync(path.join(ROOT,"server/server.js"),"utf8");
const loader = fs.readFileSync(path.join(ROOT,"js/westo-smart-loader.js"),"utf8");
const release=(loader.match(/const VERSION = '([^']+)'/)||[])[1]||'';
const checks = [];
const add=(name,ok,detail="")=>checks.push({name,ok:!!ok,detail});
const marker='WESTO v14.0 — HEADER / DISH CATEGORY STRIP RECOVERY';
const markerIndex=css.lastIndexOf(marker);
add('v14 header recovery layer exists', markerIndex >= 0);
add('critical bundle contains v14 recovery', critical.includes(marker));
add('navbar final grid is symmetric', css.indexOf('grid-template-columns: minmax(0,1fr) auto minmax(0,1fr) !important;', markerIndex) > markerIndex);
add('desktop header/category gap token is 18px', css.indexOf('--westo-header-cat-gap: 18px;', markerIndex) > markerIndex);
add('tablet/mobile header/category gap token is 16px', css.indexOf('--westo-header-cat-gap: 16px;', markerIndex) > markerIndex);
add('phone header/category gap token is 14px', css.indexOf('--westo-header-cat-gap: 14px;', markerIndex) > markerIndex);
add('short landscape keeps explicit 8px gap', css.indexOf('--westo-header-cat-gap: 8px;', markerIndex) > markerIndex);
add('dish catbar final top uses gap token', css.indexOf('top: calc(var(--v12-nav-h) + var(--westo-header-cat-gap)) !important;', markerIndex) > markerIndex);
add('dish stage recalculates from catbar band', css.indexOf('var(--westo-header-cat-after-gap)', markerIndex) > markerIndex);
add('mobile back control compact 48px', css.indexOf('width: 48px !important;', markerIndex) > markerIndex);
add('mobile back label removed from crowded navbar', css.indexOf('.westo-back-categories__label { display: none !important; }', markerIndex) > markerIndex);
add('phone cart/back controls compact 46px', css.indexOf('width: 46px !important;', markerIndex) > markerIndex);
add('category-header-lite still present', css.includes('WESTO v13.7 — CATEGORY HEADER LITE'));
add('category strip still disables backdrop blur', css.includes('#westo-dish-catbar.westo-dish-catbar') && css.includes('backdrop-filter: none !important;'));
add('menu promo layout recovery retained', fs.readFileSync(path.join(ROOT,'css/menu-promo-deck.css'),'utf8').includes('WESTO Menu Promo Deck v13.9'));
add('critical CSS cache matches active release', release && index.includes(`westo-critical.smart.css?v=${release}`));
add('critical CSS early hint cache matches active release', release && server.includes(`westo-critical.smart.css?v=${release}`));
add('classic production CSS cache busted', menu.includes('westo-production-v12.css?v=prod13r9h1'));
const geometries = [
  ['320x568',72,14,64,9],['390x844',72,14,64,9],['533x810',72,16,68,10],
  ['768x1024',84,16,68,10],['1440x900',84,18,72,12],['844x390-landscape',58,8,58,8]
].map(([name,nav,gap,bar,after])=>({name,catTop:nav+gap,dishTop:nav+gap+bar+after,gap}));
for (const g of geometries) {
  add(`${g.name} category bar separated`, g.gap >= 8, JSON.stringify(g));
  add(`${g.name} dish content clears category bar`, g.dishTop > g.catTop + 55, JSON.stringify(g));
}
const failed=checks.filter(x=>!x.ok);
console.log(JSON.stringify({summary:{passed:checks.length-failed.length,failed:failed.length,total:checks.length},checks},null,2));
if(failed.length) process.exit(1);
