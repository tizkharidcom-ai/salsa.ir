/* WESTO Menu Promo Deck v13.9 — free 2D throw / circular stack, structurally anchored above the category hero. */
(function () {
  'use strict';

  const heroSection = document.querySelector('.section.is-gamme');
  if (!heroSection) return;

  const allSlides = Array.isArray(window.__WESTO_CONTENT__?.promoSlides)
    ? window.__WESTO_CONTENT__.promoSlides
    : [];
  const branchId = Number(window.__WESTO_CONTENT__?.restaurantPayload?.branch?.id || 0) || null;
  const slides = allSlides
    .filter((slide) => slide && ['menu','both'].includes(String(slide.placement || 'menu')))
    .filter((slide) => slide.branchId == null || (branchId != null && Number(slide.branchId) === branchId))
    .sort((a,b) => (Number(a.sortOrder)||0) - (Number(b.sortOrder)||0) || Number(a.id)-Number(b.id));

  if (!slides.length) return;

  const scheduler = window.WestoResources || null;
  const P = scheduler?.priorities || { VISIBLE:92, NEAR:76, PREDICT:54 };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const impressionSent = new Set();

  const root = document.createElement('section');
  root.className = 'westo-menu-promo-deck';
  root.id = 'westo-menu-promo-deck';
  root.setAttribute('aria-label', 'پیشنهادها و رویدادهای وستو');

  const deck = document.createElement('div');
  deck.className = 'westo-menu-promo-deck__deck';
  deck.tabIndex = 0;
  deck.setAttribute('role','group');
  deck.setAttribute('aria-roledescription','card deck');
  deck.setAttribute('aria-label','اسلایدر تبلیغاتی؛ کارت را به هر جهت بکشید');
  deck.setAttribute('data-lenis-prevent','');
  deck.setAttribute('data-lenis-prevent-touch','');
  root.appendChild(deck);

  const hint = document.createElement('span');
  hint.className = 'westo-menu-promo-deck__hint';
  hint.textContent = 'بگیر و بکش';
  hint.setAttribute('aria-hidden','true');
  deck.appendChild(hint);

  const pagination = document.createElement('div');
  pagination.className = 'westo-menu-promo-deck__pagination';
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
    btn.className = 'westo-menu-promo-deck__share';
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
    card.className = 'westo-menu-promo-deck__card';
    card.dataset.promoId = String(slide.id || '');
    card.dataset.seq = String(index);
    card.setAttribute('aria-label', String(slide.title || `بنر ${index+1}`));

    if (slide.image) {
      const img = document.createElement('img');
      img.className='westo-menu-promo-deck__media';
      img.alt=String(slide.title || '');
      img.decoding='async';
      img.loading=index===0?'eager':'lazy';
      card.appendChild(img);
      const priority = index===0 ? P.VISIBLE : index===1 ? P.NEAR : P.PREDICT;
      if (scheduler?.bindImage) {
        scheduler.bindImage(img,slide.image,{priority,group:'menu-promo-deck',loading:index===0?'eager':'lazy',decode:true})
          .catch(()=>{ img.src=slide.image; });
      } else img.src=slide.image;
    } else {
      const fallback=document.createElement('div');
      fallback.className='westo-menu-promo-deck__fallback';
      fallback.textContent=String(slide.title||'WESTO');
      card.appendChild(fallback);
    }

    const share=makeShare(slide);
    if (share) card.appendChild(share);
    card.__westoPromoSlide = slide;
    deck.appendChild(card);

    const dot=document.createElement('button');
    dot.type='button';
    dot.className='westo-menu-promo-deck__dot';
    dot.setAttribute('role','tab');
    dot.setAttribute('aria-label',String(slide.title||`بنر ${index+1}`));
    dot.dataset.seq=String(index);
    pagination.appendChild(dot);
  });

  // Keep DOM reading order aligned with the visual hierarchy: navbar → promo → category hero.
  // The deck is absolutely positioned inside the relative category section, so
  // inserting it first does not mutate the original WebGL/state-machine DOM.
  heroSection.insertBefore(root, heroSection.firstChild);
  document.documentElement.classList.add('has-westo-menu-promo-deck');

  let cards=[...deck.querySelectorAll('.westo-menu-promo-deck__card')];
  const dots=[...pagination.querySelectorAll('.westo-menu-promo-deck__dot')];
  const STACK={
    active:{x:0,y:0,z:0,r:0,s:1},
    one:{x:5,y:-9,z:-65,r:-1.65,s:.972},
    two:{x:11,y:-17,z:-124,r:-3.05,s:.946},
  };
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const lerp=(a,b,t)=>a+(b-a)*t;
  const tString=(o)=>`translate3d(${o.x}px,${o.y}px,${o.z}px) rotate(${o.r}deg) scale(${o.s})`;

  let pointerId=null,dragging=false,animating=false,moved=false;
  let sx=0,sy=0,dx=0,dy=0,lastX=0,lastY=0,lastT=0,vx=0,vy=0;
  let autoplayTimer=0,manualUntil=0;

  function activeSlide(){ return cards[0]?.__westoPromoSlide || null; }
  function reportActiveImpression(){
    const slide=activeSlide();
    if (!slide?.id || impressionSent.has(String(slide.id))) return;
    impressionSent.add(String(slide.id));
    report(slide.id,'impression');
  }
  function warmNext(){
    const image=cards[1]?.__westoPromoSlide?.image;
    if (image) scheduler?.requestImage?.(image,{priority:P.NEAR,group:'menu-promo-deck-intent'}).catch(()=>{});
  }
  function applyRest(){
    cards=[...deck.querySelectorAll('.westo-menu-promo-deck__card')];
    cards.forEach((card,i)=>{
      const layer=i===0?'0':i===1?'1':i===2?'2':'hidden';
      card.dataset.layer=layer;
      card.style.removeProperty('z-index');
      card.style.removeProperty('transform');
      card.style.removeProperty('opacity');
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
  }

  function dragFrame(){
    if (cards.length<2) return;
    const current=cards[0],next=cards[1],third=cards[2];
    const rect=deck.getBoundingClientRect();
    const threshold=Math.min(rect.width,rect.height)*.24;
    const dist=Math.hypot(dx,dy);
    const p=clamp(dist/Math.max(threshold,1),0,1);
    const rot=clamp((dx/Math.max(rect.width,1))*29,-13,13);
    current.style.transform=`translate3d(${dx}px,${dy}px,${28*p}px) rotate(${rot}deg) scale(${1+.045*p})`;
    current.style.opacity=String(1-.04*p);
    if (next) {
      next.style.zIndex='25';
      next.style.transform=tString({
        x:lerp(STACK.one.x,STACK.active.x,p),y:lerp(STACK.one.y,STACK.active.y,p),
        z:lerp(STACK.one.z,STACK.active.z,p),r:lerp(STACK.one.r,0,p),s:lerp(STACK.one.s,1,p)
      });
      next.style.opacity=String(lerp(.94,1,p));
    }
    if (third) {
      third.style.zIndex='15';
      third.style.transform=tString({
        x:lerp(STACK.two.x,STACK.one.x,p),y:lerp(STACK.two.y,STACK.one.y,p),
        z:lerp(STACK.two.z,STACK.one.z,p),r:lerp(STACK.two.r,STACK.one.r,p),s:lerp(STACK.two.s,STACK.one.s,p)
      });
      third.style.opacity=String(lerp(.78,.94,p));
    }
  }

  function clearAnimations(){ cards.forEach(c=>c.getAnimations().forEach(a=>a.cancel())); }
  function snapBack(){
    clearAnimations();
    const duration=reduced?1:300;
    const current=cards[0],next=cards[1],third=cards[2];
    const jobs=[];
    if (current) jobs.push(current.animate([{transform:current.style.transform||tString(STACK.active)},{transform:tString(STACK.active),opacity:1}],{duration,easing:'cubic-bezier(.2,.8,.2,1)',fill:'forwards'}));
    if (next) jobs.push(next.animate([{transform:next.style.transform||tString(STACK.one)},{transform:tString(STACK.one),opacity:.94}],{duration,easing:'cubic-bezier(.2,.8,.2,1)',fill:'forwards'}));
    if (third) jobs.push(third.animate([{transform:third.style.transform||tString(STACK.two)},{transform:tString(STACK.two),opacity:.78}],{duration,easing:'cubic-bezier(.2,.8,.2,1)',fill:'forwards'}));
    Promise.allSettled(jobs.map(j=>j.finished)).finally(applyRest);
  }

  function throwCard(vector){
    if (animating || cards.length<2) return;
    animating=true;
    clearTimeout(autoplayTimer);
    const current=cards[0],next=cards[1],third=cards[2];
    const rect=deck.getBoundingClientRect();
    let tx=vector?.x ?? dx, ty=vector?.y ?? dy;
    let velX=vector?.vx ?? vx, velY=vector?.vy ?? vy;
    let dist=Math.hypot(tx,ty);
    if (dist<1) { tx=-rect.width*.28;ty=-rect.height*.18;dist=Math.hypot(tx,ty); }
    let ux=tx/dist,uy=ty/dist;
    const vmag=Math.hypot(velX,velY);
    if (vmag>.32) {
      ux=lerp(ux,velX/vmag,.36);uy=lerp(uy,velY/vmag,.36);
      const n=Math.hypot(ux,uy)||1;ux/=n;uy/=n;
    }
    const exit=Math.hypot(innerWidth,innerHeight)*.72;
    const outX=tx+ux*exit+velX*72;
    const outY=ty+uy*exit+velY*72;
    const rot=clamp((outX/Math.max(rect.width,1))*17,-21,21);
    const duration=reduced?1:340;
    const jobs=[];
    jobs.push(current.animate([
      {transform:current.style.transform||tString(STACK.active),opacity:current.style.opacity||1},
      {transform:`translate3d(${outX}px,${outY}px,70px) rotate(${rot}deg) scale(1.05)`,opacity:0}
    ],{duration,easing:'cubic-bezier(.18,.74,.18,1)',fill:'forwards'}));
    if (next) jobs.push(next.animate([
      {transform:next.style.transform||tString(STACK.one),opacity:next.style.opacity||.94},
      {transform:tString(STACK.active),opacity:1}
    ],{duration:Math.max(1,duration-28),easing:'cubic-bezier(.16,.86,.16,1)',fill:'forwards'}));
    if (third) jobs.push(third.animate([
      {transform:third.style.transform||tString(STACK.two),opacity:third.style.opacity||.78},
      {transform:tString(STACK.one),opacity:.94}
    ],{duration:Math.max(1,duration-20),easing:'cubic-bezier(.16,.86,.16,1)',fill:'forwards'}));
    Promise.allSettled(jobs.map(j=>j.finished)).finally(()=>{
      deck.appendChild(current);
      cards=[...deck.querySelectorAll('.westo-menu-promo-deck__card')];
      animating=false;
      applyRest();
    });
  }

  function scheduleAutoplay(){
    clearTimeout(autoplayTimer);
    const ms=Math.max(0,Number(activeSlide()?.autoplayMs)||0);
    if (!ms || cards.length<2 || reduced || document.hidden || Date.now()<manualUntil) return;
    autoplayTimer=setTimeout(()=>{
      if (Date.now()<manualUntil) return scheduleAutoplay();
      throwCard({x:-deck.clientWidth*.24,y:-deck.clientHeight*.08,vx:0,vy:0});
    },Math.max(1800,ms));
  }

  deck.addEventListener('pointerdown',(e)=>{
    if (animating || e.target.closest('.westo-menu-promo-deck__share') || cards.length<2) return;
    clearTimeout(autoplayTimer);manualUntil=Date.now()+8000;
    pointerId=e.pointerId;dragging=true;moved=false;
    sx=lastX=e.clientX;sy=lastY=e.clientY;dx=dy=vx=vy=0;lastT=performance.now();
    clearAnimations();deck.classList.add('is-dragging','has-interacted');
    deck.setPointerCapture?.(pointerId);
  });
  deck.addEventListener('pointermove',(e)=>{
    if (!dragging || e.pointerId!==pointerId) return;
    e.preventDefault();
    const now=performance.now(),dt=Math.max(8,now-lastT);
    dx=e.clientX-sx;dy=e.clientY-sy;vx=(e.clientX-lastX)/dt;vy=(e.clientY-lastY)/dt;
    lastX=e.clientX;lastY=e.clientY;lastT=now;
    if (Math.hypot(dx,dy)>4) moved=true;
    dragFrame();
  },{passive:false});
  function endPointer(e){
    if (!dragging || (e && e.pointerId!==pointerId)) return;
    dragging=false;deck.classList.remove('is-dragging');
    const threshold=Math.min(deck.clientWidth,deck.clientHeight)*.16;
    const distance=Math.hypot(dx,dy),speed=Math.hypot(vx,vy);
    if (distance>threshold || (distance>22 && speed>.48)) throwCard();
    else {
      const slide=activeSlide();
      snapBack();
      if (!moved && slide) runAction(slide);
    }
    pointerId=null;dx=dy=0;
  }
  deck.addEventListener('pointerup',endPointer);
  deck.addEventListener('pointercancel',endPointer);

  deck.addEventListener('click',(e)=>{
    if (cards.length !== 1 || e.target.closest('.westo-menu-promo-deck__share')) return;
    const slide=activeSlide();
    if (slide) runAction(slide);
  });

  deck.addEventListener('keydown',(e)=>{
    if (animating) return;
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' '].includes(e.key)) {
      e.preventDefault();manualUntil=Date.now()+8000;
      const map={ArrowLeft:{x:-130,y:0},ArrowRight:{x:130,y:0},ArrowUp:{x:0,y:-110},ArrowDown:{x:0,y:110}};
      throwCard(map[e.key]||{x:-120,y:-40});
    }
  });

  dots.forEach((dot)=>dot.addEventListener('click',()=>{
    const wanted=dot.dataset.seq;
    const targetIndex=cards.findIndex(card=>card.dataset.seq===wanted);
    if (targetIndex<=0 || animating) return;
    manualUntil=Date.now()+8000;
    // Preserve the physical deck model: advance one card per throw. For a distant dot,
    // reorder only after a short sequence so every promotion remains deterministic.
    const advance=()=>{
      const idx=[...deck.querySelectorAll('.westo-menu-promo-deck__card')].findIndex(card=>card.dataset.seq===wanted);
      if (idx<=0) return;
      throwCard({x:-deck.clientWidth*.24,y:-deck.clientHeight*.05,vx:0,vy:0});
      setTimeout(advance,reduced?20:390);
    };
    advance();
  }));

  document.addEventListener('visibilitychange',scheduleAutoplay);
  window.addEventListener('pagehide',()=>{
    clearTimeout(autoplayTimer);
    document.documentElement.classList.remove('has-westo-menu-promo-deck');
  },{once:true});
  applyRest();
})();
