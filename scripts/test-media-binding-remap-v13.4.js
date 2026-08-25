'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { performance } = require('perf_hooks');
const ROOT = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(ROOT, 'js/westo-smart-loader.js'), 'utf8');
const fetchCalls = [];
const ioInstances = [];

class FakeImage {
  constructor() {
    this.dataset = {};
    this.decoding = 'async';
    this.loading = '';
    this.complete = false;
    this.naturalWidth = 0;
    this._src = '';
    this.classList = { contains: () => false };
  }
  set src(v) {
    this._src = String(v || '');
    this.complete = Boolean(v);
    this.naturalWidth = v ? 128 : 0;
    if (v && typeof this.onload === 'function') setTimeout(() => this.onload(), 0);
  }
  get src() { return this._src; }
  decode() { return Promise.resolve(); }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
}
class FakeCustomEvent { constructor(type, init={}) { this.type=type; this.detail=init.detail; } }
class FakeIO {
  constructor(cb) { this.cb = cb; this.targets = new Set(); ioInstances.push(this); }
  observe(el) { this.targets.add(el); }
  unobserve(el) { this.targets.delete(el); }
  disconnect() { this.targets.clear(); }
  trigger(el) { this.cb([{ target:el, isIntersecting:true }]); }
}
const document = {
  hidden:false, readyState:'loading', visibilityState:'visible',
  head:{appendChild(){}}, addEventListener(){}, querySelector(){return null;}, getElementById(){return null;},
  querySelectorAll(){return [];}, createElement(){return {dataset:{}};},
};
const windowObj = {
  __WESTO_SMART_TEST_NO_BOOT__:true,
  matchMedia:()=>({matches:false}), addEventListener(){}, dispatchEvent(){},
  requestIdleCallback(cb){ setTimeout(()=>cb({didTimeout:false,timeRemaining:()=>50}),0); },
};
windowObj.window=windowObj; windowObj.document=document; windowObj.IntersectionObserver=FakeIO;
const context={
  window:windowObj,document,navigator:{deviceMemory:8,connection:{effectiveType:'4g',saveData:false,addEventListener(){}}},
  location:{href:'http://westo.test/'},performance,URL,Blob,DOMException,AbortController,Image:FakeImage,
  CustomEvent:FakeCustomEvent,IntersectionObserver:FakeIO,requestAnimationFrame:(cb)=>setTimeout(()=>cb(performance.now()),0),
  setTimeout,clearTimeout,Promise,console,
  fetch(url,init={}){
    const u=String(url); fetchCalls.push(u);
    const delay=u.includes('old-slow')?35:8;
    return new Promise((resolve,reject)=>{
      const t=setTimeout(()=>resolve({ok:true,status:200,blob:async()=>new Blob([u])}),delay);
      init.signal?.addEventListener?.('abort',()=>{clearTimeout(t);reject(new DOMException('Aborted','AbortError'));},{once:true});
    });
  }
};
context.globalThis=context;
vm.createContext(context); vm.runInContext(code,context,{filename:'westo-smart-loader.js'});
const r=context.window.WestoResources;
if(!r) throw new Error('resources missing');

(async()=>{
  // Regression 1: pre-stamped logical source must NOT be treated as proof that
  // the visible pixels already belong to the new dish.
  const img1=new FakeImage();
  img1.src='http://westo.test/old.webp';
  img1.dataset.source='/new.webp'; // exact state that caused v13 stale cache hit
  img1.dataset.appliedSource='/old.webp';
  img1.dataset.expectedSource='/new.webp';
  img1.dataset.westoManaged='1';
  const before=fetchCalls.length;
  await r.bindImage(img1,'/new.webp',{decode:true});
  if(fetchCalls.length!==before+1) throw new Error('new logical dish was falsely treated as a cache hit');
  if(img1.dataset.appliedSource!=='/new.webp') throw new Error('new dish was not marked applied');
  if(!img1.src.includes('/new.webp')) throw new Error(`wrong visible src after remap: ${img1.src}`);

  // Regression 2: remapping a lazily observed rail slot must immediately
  // invalidate the old in-flight generation, before IntersectionObserver fires.
  const img2=new FakeImage();
  const oldPromise=r.bindImage(img2,'/old-slow.webp',{decode:true});
  r.observeImage(img2,'/new-lazy.webp',{decode:true,rootMargin:'10px'});
  await new Promise(res=>setTimeout(res,50));
  await oldPromise;
  if(img2.dataset.appliedSource==='/old-slow.webp' || img2.src.includes('old-slow')) {
    throw new Error('old in-flight request painted into a remapped lazy rail slot');
  }
  const io=ioInstances[ioInstances.length-1];
  if(!io) throw new Error('observer missing');
  io.trigger(img2);
  await new Promise(res=>setTimeout(res,30));
  if(img2.dataset.appliedSource!=='/new-lazy.webp') throw new Error('lazy remap did not apply new source');
  if(!img2.src.includes('/new-lazy.webp')) throw new Error(`lazy remap visible src wrong: ${img2.src}`);

  console.log(JSON.stringify({pass:true,fetchCalls,applied1:img1.dataset.appliedSource,applied2:img2.dataset.appliedSource},null,2));
})().catch(err=>{console.error(err.stack||err);process.exit(1);});
