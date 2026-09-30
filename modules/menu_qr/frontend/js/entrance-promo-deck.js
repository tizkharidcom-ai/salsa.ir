/* WESTO Entrance Promo Deck v14.4 — tactile fan, drag and circular stack. */
(function () {
  'use strict';

  const entrance = document.getElementById('westo-entrance');
  const experience = entrance?.querySelector('.eg-experience');
  if (!entrance || !experience) return;

  const allSlides = Array.isArray(window.__WESTO_CONTENT__?.promoSlides)
    ? window.__WESTO_CONTENT__.promoSlides
    : [];
  const branchId = Number(window.__WESTO_CONTENT__?.restaurantPayload?.branch?.id || 0) || null;
  const slides = allSlides
    .filter((slide) => slide && ['entrance','both'].includes(String(slide.placement || 'entrance')))
    .filter((slide) => slide.branchId == null || (branchId != null && Number(slide.branchId) === branchId))
    .sort((a,b) => (Number(a.sortOrder)||0) - (Number(b.sortOrder)||0) || Number(a.id)-Number(b.id));

  if (!slides.length) return;

  const scheduler = window.WestoResources || null;
  const P = scheduler?.priorities || { VISIBLE:92, NEAR:76, PREDICT:54 };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const impressionSent = new Set();

  const root = document.createElement('section');
  root.className = 'eg-promo eg-promo--experience';
  root.id = 'eg-promo';
  root.setAttribute('aria-label', 'پیشنهادها و رویدادهای وستو');

  const deck = document.createElement('div');
  deck.className = 'eg-promo__deck';
  deck.tabIndex = 0;
  deck.setAttribute('role','group');
  deck.setAttribute('aria-roledescription','card deck');
  deck.setAttribute('aria-label','اسلایدر تبلیغاتی؛ کارت را به هر جهت بکشید');
  deck.setAttribute('data-lenis-prevent','');
  deck.setAttribute('data-lenis-prevent-touch','');
  root.appendChild(deck);

  const hint = document.createElement('span');
  hint.className = 'eg-promo__hint';
  hint.textContent = 'بگیر و بکش';
  hint.setAttribute('aria-hidden','true');
  deck.appendChild(hint);

  const pagination = document.createElement('div');
  pagination.className = 'eg-promo__pagination';
  pagination.setAttribute('role','tablist');
  pagination.setAttribute('aria-label','انتخاب بنر');
  root.appendChild(pagination);

  function report(id, kind) {
    if (!id) return;
    try {
      const url = `/api/promo-slides/${encodeURIComponent(id)}/${kind}`;
      if (navigator.sendBeacon) navigator.sendBeacon(url, new Blob([], { type:'application/octet-stream' }));
      else fetch(url,{method:'POST',keepalive:true,credentials:'same-origin'}).catch(()=>{});
    } catch (_) {}
  }

  function runAction(slide) {
    const type = String(slide.actionType || 'none');
    const value = String(slide.actionValue || '').trim();
    if (type === 'none') return;
    report(slide.id,'click');
    if (type === 'category') {
      const categoryId = Number(value);
      if (Number.isFinite(categoryId)) window.westoOpenMenuTarget?.({ categoryId });
      return;
    }
    if (type === 'dish') {
      const dishId = Number(value);
      if (Number.isFinite(dishId)) window.westoOpenMenuTarget?.({ dishId });
      return;
    }
    if (type === 'internal') {
      if (value.startsWith('/')) location.href = value;
      return;
    }
    if ((type === 'instagram' || type === 'url') && /^https?:\/\//i.test(value)) {
      window.open(value,'_blank','noopener,noreferrer');
    }
  }

  function makeShare(slide) {
    if (slide.shareEnabled === false) return null;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'eg-promo__share';
    btn.setAttribute('aria-label','اشتراک‌گذاری');
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="18" cy="5" r="2.4"/><circle cx="6" cy="12" r="2.4"/><circle cx="18" cy="19" r="2.4"/><path d="M8.2 10.8 15.7 6.3M8.2 13.2l7.5 4.5"/></svg>';
    btn.addEventListener('pointerdown',(e)=>e.stopPropagation());
    btn.addEventListener('click',async(e)=>{
      e.stopPropagation();
      report(slide.id,'click');
      const title = String(slide.title || 'WESTO');
      const shareUrl = (() => {
        const type=String(slide.actionType||'none');
        const value=String(slide.actionValue||'').trim();
        if (['url','instagram'].includes(type) && /^https?:\/\//i.test(value)) return value;
        if (type==='internal' && value.startsWith('/')) return new URL(value,location.origin).href;
        return location.href;
      })();
      try {
        if (navigator.share) await navigator.share({title,url:shareUrl});
        else if (navigator.clipboard) await navigator.clipboard.writeText(shareUrl);
      } catch (_) {}
    });
    return btn;
  }

  slides.forEach((slide,index) => {
    const card = document.createElement('article');
    card.className = 'eg-promo__card';
    card.dataset.promoId = String(slide.id || '');
    card.dataset.seq = String(index);
    card.setAttribute('aria-label', String(slide.title || `بنر ${index+1}`));

    if (slide.image) {
      card.classList.add('is-media-pending');
      const placeholder = document.createElement('div');
      placeholder.className = 'eg-promo__placeholder';
      placeholder.setAttribute('aria-hidden','true');
      placeholder.innerHTML = `<span class="eg-promo__placeholder-mark">W</span><span class="eg-promo__placeholder-title">${String(slide.title || 'WESTO').replace(/[&<>"]/g,(ch)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]))}</span>`;
      card.appendChild(placeholder);

      const img = document.createElement('img');
      img.className='eg-promo__media';
      img.alt=String(slide.title || '');
      img.decoding='async';
      img.loading=index<=1?'eager':'lazy';
      if (index === 0) img.fetchPriority = 'high';
      const markReady = () => { card.classList.remove('is-media-pending','is-media-error'); card.classList.add('is-media-ready'); };
      const markError = () => { card.classList.remove('is-media-pending'); card.classList.add('is-media-error'); };
      img.addEventListener('load', markReady, { once:true });
      img.addEventListener('error', markError, { once:true });
      card.appendChild(img);
      const priority = index===0 ? P.VISIBLE : index===1 ? P.NEAR : P.PREDICT;
      if (index <= 1) scheduler?.requestImage?.(slide.image,{priority,group:'entrance-promo-prime'}).catch(()=>{});
      if (scheduler?.bindImage) {
        scheduler.bindImage(img,slide.image,{priority,group:'entrance-promo',loading:index<=1?'eager':'lazy',decode:true})
          .then(()=>{ if (img.complete && img.naturalWidth) markReady(); })
          .catch(()=>{ if (img.src !== slide.image) img.src=slide.image; });
      } else img.src=slide.image;
    } else {
      const fallback=document.createElement('div');
      fallback.className='eg-promo__fallback';
      fallback.textContent=String(slide.title||'WESTO');
      card.appendChild(fallback);
    }

    const share=makeShare(slide);
    if (share) card.appendChild(share);
    card.__westoPromoSlide = slide;
    deck.appendChild(card);

    const dot=document.createElement('button');
    dot.type='button';
    dot.className='eg-promo__dot';
    dot.setAttribute('role','tab');
    dot.setAttribute('aria-label',String(slide.title||`بنر ${index+1}`));
    dot.dataset.seq=String(index);
    pagination.appendChild(dot);
  });

  const steps = experience.querySelector('.eg-steps-row');
  if (steps) experience.insertBefore(root, steps);
  else experience.appendChild(root);
  entrance.classList.add('has-eg-promo');

  let cards=[...deck.querySelectorAll('.eg-promo__card')];
  const dots=[...pagination.querySelectorAll('.eg-promo__dot')];
  const STACK={
    active:{x:0,y:0,z:0,r:0,s:1},
  };
  const BASE_SHADOW='0 26px 40px rgba(0,0,0,.32), 0 8px 16px rgba(0,0,0,.24)';
  const DRAG_SHADOW='0 34px 50px rgba(0,0,0,.40), 0 0 0 3px color-mix(in srgb,var(--prod-cyan,#31dbe0) 82%,transparent), 0 0 26px color-mix(in srgb,var(--prod-cyan,#31dbe0) 58%,transparent)';
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const tString=(o)=>`translate3d(${o.x}px,${o.y}px,${o.z}px) rotate(${o.r}deg) scale(${o.s})`;
  const runningAnimations=new Set();
  const cssProperty=(name)=>name.replace(/[A-Z]/g,(letter)=>`-${letter.toLowerCase()}`);
  function animateCard(node,keyframes,options={}){
    if (typeof node?.animate==='function') {
      const nativeJob=node.animate(keyframes,options);
      runningAnimations.add(nativeJob);
      nativeJob.finished.then(()=>runningAnimations.delete(nativeJob),()=>runningAnimations.delete(nativeJob));
      return nativeJob;
    }
    const frames=Array.isArray(keyframes)?keyframes:[keyframes];
    const first=frames[0]||{},last=frames[frames.length-1]||{};
    const duration=Math.max(1,Number(options.duration)||1);
    const alternate=options.direction==='alternate'&&Number(options.iterations||1)>1;
    const timers=[];
    let raf=0,settled=false,resolveFinished,rejectFinished;
    const finished=new Promise((resolve,reject)=>{resolveFinished=resolve;rejectFinished=reject;});
    const applyFrame=(frame)=>Object.entries(frame).forEach(([name,value])=>{ node.style[name]=String(value); });
    const cleanup=()=>{ node.style.removeProperty('transition');runningAnimations.delete(job); };
    const finish=()=>{ if(settled)return;settled=true;cleanup();resolveFinished(); };
    const cancel=()=>{
      if(settled)return;
      settled=true;cancelAnimationFrame(raf);timers.forEach(clearTimeout);cleanup();rejectFinished(new Error('Animation cancelled'));
    };
    const job={finished,cancel};
    runningAnimations.add(job);
    applyFrame(first);
    void node.offsetWidth;
    raf=requestAnimationFrame(()=>{
      if(settled)return;
      const properties=Object.keys(last).map(name=>`${cssProperty(name)} ${duration}ms ${options.easing||'ease'}`);
      node.style.transition=properties.join(',');
      applyFrame(last);
      timers.push(setTimeout(()=>{
        if(settled)return;
        if(!alternate){finish();return;}
        applyFrame(first);
        timers.push(setTimeout(finish,duration+24));
      },duration+24));
    });
    return job;
  }
  const compactDeck=()=>matchMedia('(max-width:767px), (pointer:coarse) and (max-width:1024px), (max-width:1024px) and (min-height:800px) and (max-aspect-ratio:4/5)').matches;
  const shortDeck=()=>matchMedia('(max-width:430px) and (max-height:650px) and (orientation:portrait)').matches;
  const stackAt=(depth)=>{
    const t=Math.min(Math.max(depth,0),3);
    const profile=shortDeck()
      ? {x:4,y:-6,r:-1.5,s:.97}
      : compactDeck()
        ? {x:6,y:-10,r:-2,s:.965}
        : {x:8,y:-16,r:-3,s:.95};
    return {x:profile.x*t,y:profile.y*t,z:0,r:profile.r*t,s:1-(1-profile.s)*t};
  };
  const syncDeckDensity=()=>{
    const compact=compactDeck();
    const short=shortDeck();
    root.classList.toggle('eg-promo--compact',compact);
    root.classList.toggle('eg-promo--short',short);
    const experience=root.closest('.eg-experience');
    experience?.classList.toggle('eg-experience--promo-safe',compact);
    experience?.classList.toggle('eg-experience--promo-short',short);
  };

  let pointerId=null,dragging=false,animating=false,moved=false;
  let sx=0,sy=0,dx=0,dy=0,lastX=0,lastY=0,lastT=0,vx=0,vy=0;
  let autoplayTimer=0,idleTimer=0,introTimer=0,manualUntil=0,dragRaf=0,dragRect=null;
  let introComplete=false,isVisible=true,interactionScale=1;

  let densityFrame=0;
  window.addEventListener('resize',()=>{
    cancelAnimationFrame(densityFrame);
    densityFrame=requestAnimationFrame(()=>{
      densityFrame=0;
      syncDeckDensity();
      if (!dragging && !animating) applyRest();
    });
  },{passive:true});

  function activeSlide(){ return cards[0]?.__westoPromoSlide || null; }
  function reportActiveImpression(){
    const slide=activeSlide();
    if (!slide?.id || impressionSent.has(String(slide.id))) return;
    impressionSent.add(String(slide.id));
    report(slide.id,'impression');
  }
  function warmNext(){
    const image=cards[1]?.__westoPromoSlide?.image;
    if (image) scheduler?.requestImage?.(image,{priority:P.NEAR,group:'entrance-promo-intent'}).catch(()=>{});
  }
  function applyRest(){
    cards=[...deck.querySelectorAll('.eg-promo__card')];
    cards.forEach((card,i)=>{
      const layer=i===0?'0':i===1?'1':i===2?'2':'hidden';
      card.dataset.layer=layer;
      card.style.removeProperty('z-index');
      card.style.removeProperty('transform');
      card.style.removeProperty('opacity');
      card.style.removeProperty('box-shadow');
      card.style.pointerEvents=i===0?'auto':'none';
      card.setAttribute('aria-hidden',i===0?'false':'true');
      card.querySelectorAll('button,a,[tabindex]').forEach((control)=>{ control.tabIndex=i===0?0:-1; });
    });
    const seq=cards[0]?.dataset.seq;
    dots.forEach((dot)=>{
      const selected=dot.dataset.seq===seq;
      dot.setAttribute('aria-selected',String(selected));
      dot.tabIndex=selected?0:-1;
    });
    reportActiveImpression();
    warmNext();
    scheduleAutoplay();
    scheduleIdleNudge();
  }

  function dragFrame(){
    if (cards.length<2) return;
    const current=cards[0],next=cards[1],third=cards[2];
    const dist=Math.hypot(dx,dy);
    const p=clamp(dist/150,0,1);
    const rot=clamp(.08*dx,-20,20);
    const scale=Math.min(1.06,1+dist/1700);
    current.style.transform=`translate3d(${dx}px,${dy}px,0) rotate(${rot}deg) scale(${scale})`;
    current.style.opacity='1';
    current.style.boxShadow=dist>commitDistance(dragRect)?DRAG_SHADOW:BASE_SHADOW;
    if (next) {
      next.style.zIndex='25';
      next.style.transform=tString(stackAt(1-.6*p));
      next.style.opacity='1';
    }
    if (third) {
      third.style.zIndex='15';
      third.style.transform=tString(stackAt(2-.6*p));
      third.style.opacity='1';
    }
  }

  function commitDistance(rect){
    const box=rect || deck.getBoundingClientRect();
    return clamp(Math.min(box.width,box.height)*.34,58,88);
  }

  function clearAnimations(){
    [...runningAnimations].forEach(animation=>animation.cancel());
    cards.forEach(card=>card.getAnimations?.().forEach(animation=>animation.cancel()));
  }
  function snapBack(){
    clearAnimations();
    const duration=reduced?1:550;
    const current=cards[0],next=cards[1],third=cards[2];
    const jobs=[];
    if (current) jobs.push(animateCard(current,[
      {transform:current.style.transform||tString(STACK.active),boxShadow:current.style.boxShadow||BASE_SHADOW},
      {transform:tString(STACK.active),opacity:1,boxShadow:BASE_SHADOW}
    ],{duration,easing:'cubic-bezier(.18,1.3,.4,1)',fill:'forwards'}));
    if (next) jobs.push(animateCard(next,[
      {transform:next.style.transform||tString(stackAt(1)),opacity:1},
      {transform:tString(stackAt(1)),opacity:1}
    ],{duration,easing:'cubic-bezier(.18,1.3,.4,1)',fill:'forwards'}));
    if (third) jobs.push(animateCard(third,[
      {transform:third.style.transform||tString(stackAt(2)),opacity:1},
      {transform:tString(stackAt(2)),opacity:1}
    ],{duration,easing:'cubic-bezier(.18,1.3,.4,1)',fill:'forwards'}));
    Promise.allSettled(jobs.map(j=>j.finished)).finally(applyRest);
  }

  function throwCard(vector){
    if (animating || cards.length<2) return;
    animating=true;
    deck.classList.add('is-animating','has-interacted');
    clearTimeout(autoplayTimer);clearTimeout(idleTimer);
    const current=cards[0],next=cards[1],third=cards[2];
    let tx=vector?.x ?? dx, ty=vector?.y ?? dy;
    let velX=vector?.vx ?? vx, velY=vector?.vy ?? vy;
    let dist=Math.hypot(tx,ty);
    if (dist<1) { tx=-120;ty=-40;dist=Math.hypot(tx,ty); }
    const speed=Math.hypot(velX,velY);
    const angle=speed>3.5?Math.atan2(velY,velX):Math.atan2(ty,tx);
    const sign=tx>=0?1:-1;
    const outX=240*Math.cos(angle),outY=240*Math.sin(angle)-46;
    const flight=tString({x:outX,y:outY,z:0,r:26*sign,s:1.07});
    const flightDuration=reduced?1:200;
    const promoteDuration=reduced?1:500;
    const flightJob=animateCard(current,[
      {transform:current.style.transform||tString(STACK.active),opacity:1,boxShadow:current.style.boxShadow||BASE_SHADOW},
      {transform:flight,opacity:1,boxShadow:'0 48px 70px rgba(0,0,0,.45)'}
    ],{duration:flightDuration,easing:'cubic-bezier(.3,.8,.25,1)',fill:'forwards'});
    const promotions=[];
    if (next) promotions.push(animateCard(next,[
      {transform:next.style.transform||tString(stackAt(1)),opacity:1},
      {transform:tString(STACK.active),opacity:1}
    ],{duration:promoteDuration,easing:'cubic-bezier(.34,1.45,.5,1)',fill:'forwards'}));
    if (third) promotions.push(animateCard(third,[
      {transform:third.style.transform||tString(stackAt(2)),opacity:1},
      {transform:tString(stackAt(1)),opacity:1}
    ],{duration:promoteDuration,easing:'cubic-bezier(.34,1.45,.5,1)',fill:'forwards'}));

    flightJob.finished.then(()=>{
      current.style.transform=flight;
      current.style.opacity='1';
      current.style.boxShadow='0 48px 70px rgba(0,0,0,.45)';
      flightJob.cancel();
      deck.appendChild(current);
      cards=[...deck.querySelectorAll('.eg-promo__card')];
      const index=cards.indexOf(current);
      const target=stackAt(index);
      current.style.zIndex='1';
      current.style.pointerEvents='none';
      const returnJob=animateCard(current,[
        {transform:flight,opacity:1,boxShadow:'0 48px 70px rgba(0,0,0,.45)'},
        {transform:tString(target),opacity:index<=2?1:0,boxShadow:BASE_SHADOW}
      ],{duration:reduced?1:460,easing:'cubic-bezier(.34,1.4,.5,1)',fill:'forwards'});
      return Promise.allSettled([...promotions.map(job=>job.finished),returnJob.finished]);
    }).catch(()=>{}).finally(()=>{
      animating=false;
      deck.classList.remove('is-animating');
      applyRest();
    });
  }

  function fanDeck({intro=false}={}){
    if (animating || dragging || cards.length<2 || reduced || !isVisible) {
      if (intro) { introComplete=true;scheduleAutoplay();scheduleIdleNudge(); }
      return;
    }
    animating=true;
    deck.classList.add('is-animating','is-fanning');
    clearTimeout(autoplayTimer);clearTimeout(idleTimer);clearAnimations();
    const visibleCount=Math.min(7,cards.length);
    const compact=compactDeck();
    const deckRect=deck.getBoundingClientRect();
    const spread=compact
      ? clamp(deckRect.width*.075,22,34)
      : clamp(deckRect.width*.17,58,84);
    const rotation=compact
      ? clamp(deckRect.width*.012,3.5,5)
      : clamp(deckRect.width*.07,22,35);
    const lift=compact
      ? clamp(deckRect.height*.04,5,8)
      : clamp(deckRect.height*.12,16,26);
    const opening=cards.map((card,index)=>{
      if (index>=visibleCount) return null;
      const ratio=visibleCount>1?index/(visibleCount-1):.5;
      const arc=lift*(1-Math.abs(ratio-.5)*1.25)+(compact?2:4);
      const fan={x:(ratio-.5)*2*spread,y:-arc,z:0,r:(ratio-.5)*2*rotation,s:1};
      card.style.zIndex=String(cards.length+5-index);
      card.style.opacity='1';
      return animateCard(card,[
        {transform:getComputedStyle(card).transform,opacity:getComputedStyle(card).opacity},
        {transform:tString(fan),opacity:1}
      ],{duration:280,easing:'cubic-bezier(.34,1.5,.5,1)',fill:'forwards'});
    }).filter(Boolean);
    Promise.allSettled(opening.map(job=>job.finished)).then(()=>new Promise(resolve=>setTimeout(resolve,reduced?0:40))).then(()=>{
      if (!isVisible || document.hidden) return [];
      const closing=cards.map((card,index)=>{
        const target=index===0?STACK.active:stackAt(index);
        return animateCard(card,[
          {transform:getComputedStyle(card).transform,opacity:getComputedStyle(card).opacity},
          {transform:tString(target),opacity:index<=2?1:0}
        ],{duration:500,easing:'cubic-bezier(.34,1.45,.5,1)',fill:'forwards'});
      });
      return Promise.allSettled(closing.map(job=>job.finished));
    }).finally(()=>{
      if (intro) introComplete=true;
      animating=false;
      deck.classList.remove('is-animating','is-fanning');
      applyRest();
    });
  }

  function scheduleIdleNudge(){
    clearTimeout(idleTimer);
    if (!introComplete || reduced || document.hidden || !isVisible || dragging || animating || cards.length<2) return;
    idleTimer=setTimeout(()=>{
      if (dragging || animating || !isVisible) return scheduleIdleNudge();
      const current=cards[0];
      if (!current) return;
      const nudge=animateCard(current,[
        {transform:tString(STACK.active)},
        {transform:'translate3d(10px,0,0) rotate(2.5deg) scale(1)'}
      ],{duration:500,easing:'ease-in-out',direction:'alternate',iterations:2});
      nudge.finished.catch(()=>{}).finally(()=>{ current.style.removeProperty('transform');scheduleIdleNudge(); });
    },3000);
  }

  function scheduleAutoplay(){
    clearTimeout(autoplayTimer);
    const configured=Math.max(0,Number(activeSlide()?.autoplayMs)||0);
    const ms=configured||7000;
    if (!introComplete || cards.length<2 || reduced || document.hidden || !isVisible || Date.now()<manualUntil) return;
    autoplayTimer=setTimeout(()=>{
      if (Date.now()<manualUntil) return scheduleAutoplay();
      fanDeck();
    },Math.max(3000,ms*interactionScale));
  }

  deck.addEventListener('pointerdown',(e)=>{
    if (animating || e.target.closest('.eg-promo__share') || cards.length<2) return;
    clearTimeout(autoplayTimer);clearTimeout(idleTimer);clearTimeout(introTimer);manualUntil=Date.now()+8000;
    pointerId=e.pointerId;dragging=true;moved=false;
    sx=lastX=e.clientX;sy=lastY=e.clientY;dx=dy=vx=vy=0;lastT=performance.now();dragRect=deck.getBoundingClientRect();
    clearAnimations();deck.classList.add('is-dragging','has-interacted');
    deck.setPointerCapture?.(pointerId);
  });
  deck.addEventListener('pointermove',(e)=>{
    if (!dragging || e.pointerId!==pointerId) return;
    e.preventDefault();
    const now=performance.now(),dt=Math.max(8,now-lastT);
    dx=e.clientX-sx;dy=e.clientY-sy;vx=((e.clientX-lastX)/dt)*16;vy=((e.clientY-lastY)/dt)*16;
    lastX=e.clientX;lastY=e.clientY;lastT=now;
    if (Math.hypot(dx,dy)>4) moved=true;
    if (!dragRaf) dragRaf=requestAnimationFrame(()=>{ dragRaf=0; if (dragging) dragFrame(); });
  },{passive:false});
  function endPointer(e){
    if (!dragging || (e && e.pointerId!==pointerId)) return;
    dragging=false;deck.classList.remove('is-dragging');
    if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf=0; dragFrame(); }
    const rect=dragRect || deck.getBoundingClientRect();
    const threshold=commitDistance(rect);
    const distance=Math.hypot(dx,dy),speed=Math.hypot(vx,vy);
    if (e?.type!=='pointercancel' && (distance>threshold || speed>8.5)) {
      interactionScale=2;
      navigator.vibrate?.(14);
      throwCard();
    }
    else {
      const slide=activeSlide();
      snapBack();
      if (!moved && slide) runAction(slide);
    }
    pointerId=null;dx=dy=0;dragRect=null;
  }
  deck.addEventListener('pointerup',endPointer);
  deck.addEventListener('pointercancel',endPointer);

  deck.addEventListener('click',(e)=>{
    if (cards.length !== 1 || e.target.closest('.eg-promo__share')) return;
    const slide=activeSlide();
    if (slide) runAction(slide);
  });

  deck.addEventListener('keydown',(e)=>{
    if (animating) return;
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' '].includes(e.key)) {
      e.preventDefault();manualUntil=Date.now()+8000;interactionScale=2;
      const map={ArrowLeft:{x:-130,y:0},ArrowRight:{x:130,y:0},ArrowUp:{x:0,y:-110},ArrowDown:{x:0,y:110}};
      throwCard(map[e.key]||{x:-120,y:-40});
    }
  });

  function pauseDeck(){
    clearTimeout(autoplayTimer);clearTimeout(idleTimer);clearTimeout(introTimer);
    if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf=0; }
    if (animating) { clearAnimations();animating=false;deck.classList.remove('is-animating','is-fanning'); }
    if (dragging || deck.classList.contains('is-dragging')) { dragging=false;pointerId=null;dragRect=null;deck.classList.remove('is-dragging'); }
    applyRest();
  }

  document.addEventListener('visibilitychange',()=>{
    if (document.hidden) { pauseDeck(); return; }
    if (!introComplete && !reduced) introTimer=setTimeout(()=>fanDeck({intro:true}),500);
    else { introComplete=true;scheduleAutoplay();scheduleIdleNudge(); }
  });

  if ('IntersectionObserver' in window) {
    const visibilityObserver=new IntersectionObserver((entries)=>{
      isVisible=entries.some(entry=>entry.isIntersecting && entry.intersectionRatio>.1);
      if (!isVisible) { clearTimeout(autoplayTimer);clearTimeout(idleTimer); return; }
      scheduleAutoplay();scheduleIdleNudge();
    },{threshold:[0,.1,.35]});
    visibilityObserver.observe(root);
  }

  dots.forEach((dot)=>dot.addEventListener('click',()=>{
    const wanted=dot.dataset.seq;
    const targetIndex=cards.findIndex(card=>card.dataset.seq===wanted);
    if (targetIndex<=0 || animating) return;
    manualUntil=Date.now()+8000;interactionScale=2;
    // Preserve the physical deck model: advance one card per throw. For a distant dot,
    // reorder only after a short sequence so every promotion remains deterministic.
    const advance=()=>{
      const idx=[...deck.querySelectorAll('.eg-promo__card')].findIndex(card=>card.dataset.seq===wanted);
      if (idx<=0) return;
      throwCard({x:-deck.clientWidth*.24,y:-deck.clientHeight*.05,vx:0,vy:0});
      setTimeout(advance,reduced?20:720);
    };
    advance();
  }));

  syncDeckDensity();
  applyRest();
  if (reduced || cards.length<2) {
    introComplete=true;
    scheduleAutoplay();scheduleIdleNudge();
  } else {
    introTimer=setTimeout(()=>fanDeck({intro:true}),2000);
  }
})();
