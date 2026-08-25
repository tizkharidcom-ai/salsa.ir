'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { performance } = require('perf_hooks');
const ROOT = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(ROOT, 'js/westo-smart-loader.js'), 'utf8');
const winListeners = new Map();
const docListeners = new Map();
const fetchCalls = [];
const revoked = [];
let blobSeq = 0;

class FakeImage {
  constructor() { this.dataset={}; this.decoding=''; this.loading=''; this.complete=false; this.naturalWidth=0; this._src=''; this.classList={ contains:(x)=>x==='westo-dish-catbar__thumb' }; }
  set src(v){ this._src=String(v||''); this.complete=Boolean(v); this.naturalWidth=v?128:0; }
  get src(){ return this._src; }
  decode(){ return Promise.resolve(); }
  removeAttribute(name){ if(name==='src') this.src=''; }
}
class FakeCustomEvent { constructor(type,init={}){this.type=type;this.detail=init.detail;} }
class FakeIO { observe(){} unobserve(){} disconnect(){} }

const managed=[];
const document={
  hidden:false, readyState:'loading', visibilityState:'visible',
  head:{appendChild(){}},
  addEventListener(type,cb){ docListeners.set(type,cb); },
  querySelector(){ return null; }, getElementById(){ return null; },
  querySelectorAll(sel){ return sel.includes('data-westo-managed') ? managed : []; },
  createElement(tag){ if(tag==='script'||tag==='link') return {dataset:{}}; return {dataset:{}}; },
};
const windowObj={
  __WESTO_SMART_TEST_NO_BOOT__:true,
  matchMedia:()=>({matches:false}),
  addEventListener(type,cb){ winListeners.set(type,cb); },
  dispatchEvent(){},
  requestIdleCallback(cb){ setTimeout(()=>cb({didTimeout:false,timeRemaining:()=>50}),0); },
};
windowObj.window=windowObj; windowObj.document=document;
const fakeURL=class extends URL {};
fakeURL.createObjectURL=()=>`blob:westo-${++blobSeq}`;
fakeURL.revokeObjectURL=(u)=>revoked.push(String(u));
const context={window:windowObj,document,navigator:{deviceMemory:8,connection:{effectiveType:'4g',saveData:false,addEventListener(){}}},location:{href:'http://westo.test/'},performance,URL:fakeURL,Blob,DOMException,AbortController,Image:FakeImage,CustomEvent:FakeCustomEvent,IntersectionObserver:FakeIO,requestAnimationFrame:(cb)=>setTimeout(()=>cb(performance.now()),0),setTimeout,clearTimeout,Promise,console,
 fetch(url,init={}){ fetchCalls.push(String(url)); return new Promise((resolve,reject)=>{const t=setTimeout(()=>resolve({ok:true,status:200,blob:async()=>new Blob([String(url)])}),5); init.signal?.addEventListener?.('abort',()=>{clearTimeout(t);reject(new DOMException('Aborted','AbortError'));},{once:true});}); }
}; context.globalThis=context;
vm.createContext(context); vm.runInContext(code,context,{filename:'westo-smart-loader.js'});
const r=context.window.WestoResources; if(!r) throw new Error('resources missing');

(async()=>{
  r.registerMenu({siteCategories:[{id:1,coverImg:'/c1.webp'},{id:2,coverImg:'/c2.webp'},{id:3,coverImg:'/c3.webp'}],menuItems:[{id:11,categoryId:1,img:'/1.webp',available:true},{id:21,categoryId:2,img:'/2.webp',available:true},{id:31,categoryId:3,img:'/3.webp',available:true}]});
  r.primeInitial();
  await new Promise(res=>setTimeout(res,40));
  await r.startBackgroundFill('test');
  await new Promise(res=>setTimeout(res,40));

  for(const cover of ['/c1.webp','/c2.webp','/c3.webp']){
    const n=fetchCalls.filter(u=>u.endsWith(cover)).length;
    if(n!==1) throw new Error(`${cover} fetched ${n} times`);
  }
  if(!r.metrics.backgroundFillComplete) throw new Error('background fill did not complete');

  const before=fetchCalls.length;
  const imgs=[new FakeImage(),new FakeImage(),new FakeImage()]; managed.push(...imgs);
  await Promise.all(imgs.map(img=>r.bindImage(img,'/c1.webp',{priority:r.priorities.VISIBLE,pinned:true,nonPreemptible:true,decode:true})));
  if(fetchCalls.length!==before) throw new Error('pinned clones performed duplicate network I/O');
  if(imgs.some(img=>!img.src || img.naturalWidth<=0)) throw new Error('a pinned clone did not bind');

  r.cancelWhere(()=>true);
  if(!r.getReadyUrl('/c1.webp')) throw new Error('pinned cover was evicted by cancellation');
  const beforeRefresh=fetchCalls.length;
  const old=r.getReadyUrl('/c1.webp'); const fresh=r.refreshReadyUrl('/c1.webp');
  if(!fresh || fresh!==old) throw new Error('ready image URL should stay stable');
  if(!/\/c1\.webp$/.test(fresh)) throw new Error('ready image URL is not canonical HTTP media');
  if(fetchCalls.length!==beforeRefresh) throw new Error('ready URL refresh hit network');
  if(blobSeq!==0) throw new Error('image scheduler created blob URLs');

  const onPagehide=winListeners.get('pagehide');
  if(!onPagehide) throw new Error('pagehide handler missing');
  onPagehide({persisted:true});
  if(revoked.length!==0) throw new Error('BFCache preserve revoked blob URLs');
  if(!r.getReadyUrl('/c1.webp')) throw new Error('BFCache preserve cleared records');
  onPagehide({persisted:false});
  if(revoked.length!==0) throw new Error('image-only session should have no blob URLs to revoke');

  console.log(JSON.stringify({pass:true,fetchCalls:fetchCalls.length,uniqueFetches:new Set(fetchCalls).size,revokedOnUnload:revoked.length,metrics:r.metrics},null,2));
})().catch(err=>{console.error(err.stack||err);process.exit(1)});
