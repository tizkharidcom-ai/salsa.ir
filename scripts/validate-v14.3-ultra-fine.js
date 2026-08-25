'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'..');
const read=r=>fs.readFileSync(path.join(ROOT,r),'utf8');
const index=read('index.html');
const css=read('css/westo-v14.3-ultra-fine.css');
const critical=read('css/westo-critical.smart.css');
const build=read('scripts/build-smart-bundles.js');
const app=read('js/westo-app.smart.js');
const promo=read('js/entrance-promo-deck.js');
const entrance=read('js/westo-entrance.js');
const anim=read('js/animations.js');
const polish=read('js/westo-v14.3-ultra-fine.js');
const content=read('js/content-overrides.js');
const admin=read('js/admin.js');
const loader=read('js/westo-smart-loader.js');
const three=read('js/three-scene.js');
const server=read('server/server.js');
const db=JSON.parse(read('server/data/db.json'));
const release=(loader.match(/const VERSION = '([^']+)'/)||[])[1]||'';
let pass=0,fail=0; const failures=[];
const check=(name,ok)=>{if(ok)pass++;else{fail++;failures.push(name)}};

// Build / release coherence.
check('v14.3 CSS included in critical build',build.includes("'css/westo-v14.3-ultra-fine.css'"));
check('v14.3 JS included in app build',build.includes("'js/westo-v14.3-ultra-fine.js'"));
check('critical bundle contains Ultra Fine CSS',critical.includes('WESTO v14.3 — Ultra Fine'));
check('app bundle contains Ultra Fine JS',app.includes('WESTO v14.3 Ultra Fine'));
check('active release is Ultra Fine v1 family',release.startsWith('release14uf1'));
check('index release coherence',index.includes(`westo-critical.smart.css?v=${release}`)&&index.includes(`westo-smart-loader.js?v=${release}`)&&index.includes(`westo-app.smart.js?v=${release}`));
check('server Early Hints release coherence',server.includes(`westo-critical.smart.css?v=${release}`)&&server.includes(`westo-smart-loader.js?v=${release}`)&&server.includes(`westo-app.smart.js?v=${release}`));
check('Three postprocessing release coherence',three.includes(`westo-postprocessing.bundle.mjs?v=${release}`));

// Annotated entrance geometry + progress.
check('entrance card receives extra vertical room',css.includes('#westo-entrance.has-eg-promo .eg-card')&&css.includes('padding-block-start:clamp(1.25rem'));
check('promo uses taller approximately 2:1 mobile ratio',css.includes('--eg-promo-h:clamp(172px,46vw,212px)')&&css.includes('--eg-promo-h:clamp(168px,46vw,198px)'));
check('promo keeps short-landscape guard',css.includes('@media (max-height:720px) and (orientation:landscape)'));
check('mobile entrance can vertically recover instead of crop',css.includes('#westo-entrance { overflow-y:auto !important')&&css.includes('min-height:100svh'));
check('CTA percentage is inside button before label',index.indexOf('id="eg-progress-pct"')>index.indexOf('id="eg-enter"')&&index.indexOf('id="eg-progress-pct"')<index.indexOf('id="eg-cta-label"'));
check('old visible progress fill removed',!index.includes('id="eg-progress-fill"'));
check('semantic progressbar retained SR-only',index.includes('class="eg-progress eg-progress--sr" role="progressbar"'));
check('CTA owns progress width variable',entrance.includes("cta.style.setProperty('--eg-progress'")&&css.includes('width:var(--eg-progress)'));
check('CTA progress pseudo clears legacy mask',css.includes('-webkit-mask:none !important')&&css.includes('mask:none !important'));
check('CTA copy avoids separate preparing label',!anim.includes("tr('eg.preparing')")&&anim.includes('enterLabel.textContent = entranceCtaCopy()'));

// Entrance admin ownership.
const entranceTextKeys=['entrance.tagline','entrance.subtitle','entrance.storyLead','entrance.quote','entrance.cta','entrance.step.digitalMenu','entrance.step.onlineOrder','entrance.step.reserveTable','entrance.step.quickEntry'];
check('all entrance text keys exposed in Admin',entranceTextKeys.every(k=>admin.includes(k)));
check('all entrance text keys have HTML admin hooks',entranceTextKeys.every(k=>index.includes(`data-admin-content="${k}"`)));
check('all entrance text defaults persisted',entranceTextKeys.every(k=>Object.prototype.hasOwnProperty.call(db.content||{},k)));
const entranceMediaKeys=['entrance.logo','entrance.wordmark.dark','entrance.wordmark.light'];
check('entrance media keys exposed in Admin',entranceMediaKeys.every(k=>admin.includes(k)));
check('entrance media defaults persisted',entranceMediaKeys.every(k=>Object.prototype.hasOwnProperty.call(db.content||{},k)));
check('content override applies entrance admin copy',content.includes('function applyEntranceContent()')&&content.includes("[data-admin-content]"));
check('content override applies custom entrance logo',content.includes("content['entrance.logo']"));
check('content override applies theme-specific entrance wordmarks',content.includes("content['entrance.wordmark.dark']")&&content.includes("content['entrance.wordmark.light']"));
check('custom entrance copy listens on the real document lang owner',content.includes("document.addEventListener('westo:langchange', applyEntranceContent)"));
check('animation/i18n pass reapplies Admin entrance copy',anim.includes('const applyGateAdminCopy = () =>')&&anim.includes('applyGateAdminCopy();'));
check('CTA ready/preparing respects Admin copy',anim.includes("const entranceCtaCopy = () => entranceAdminCopy('entrance.cta'")&&anim.includes('enterLabel.textContent = entranceCtaCopy()'));

// One-line footer / dark language shape.
check('mobile entrance footer is single-row grid',css.includes('grid-template-rows:52px !important')&&css.includes('grid-template-columns:44px minmax(156px,1fr) minmax(96px,112px)'));
check('dock four controls stay one row',css.includes('grid-template-columns:repeat(4,minmax(38px,1fr))'));
check('language segments stay one row',css.includes('grid-template-columns:1fr auto 1fr auto 1fr'));
check('dark language control has explicit shape',css.includes('border-radius:17px !important')&&css.includes("background:linear-gradient(145deg,rgba(255,255,255,.075)"));
check('light language variant retained',css.includes("html[data-theme='light'] #westo-entrance .eg-lang-switch"));

// Promo buffering + thermal drag fix.
check('promo has branded pending placeholder',promo.includes("is-media-pending")&&promo.includes('eg-promo__placeholder-mark'));
check('promo first images are primed by Resource Scheduler',promo.includes("entrance-promo-prime")&&promo.includes('scheduler?.requestImage'));
check('promo images still bind through Resource Scheduler',promo.includes('scheduler.bindImage'));
check('active/near priorities retained',promo.includes('P.VISIBLE')&&promo.includes('P.NEAR'));
check('promo image reveal waits for media ready',css.includes('.is-media-ready .eg-promo__media { opacity:1; }'));
check('promo drag caches geometry on pointerdown',promo.includes('dragRect=deck.getBoundingClientRect()'));
check('promo pointermove is rAF coalesced',promo.includes('if (!dragRaf) dragRaf=requestAnimationFrame'));
check('promo JS does not animate brightness/filter',!promo.includes('brightness(')&&!promo.includes('style.filter'));
check('promo keyboard/share/autoplay behavior retained',promo.includes("deck.addEventListener('keydown'")&&promo.includes("e.target.closest('.eg-promo__share')")&&promo.includes('autoplayMs'));

// Header geometry.
const authOccurrences=(index.match(/id="nav-auth-btn"/g)||[]).length;
check('auth control remains unique',authOccurrences===1);
check('auth moved into physical-left navbar cluster',/navbar_sound-wrapper[\s\S]{0,3000}id="nav-auth-btn"/.test(index));
check('auth is no longer hide-tablet',!/id="nav-auth-btn"[^>]*class="[^"]*hide-tablet/.test(index));
check('right navbar cluster no longer contains auth',!/navbar_menu-wrapper[\s\S]{0,600}id="nav-auth-btn"/.test(index));
check('brand lockup is optically centered',css.includes('left:50% !important')&&css.includes('transform:translateX(-50%) !important'));
check('narrow header still protects controls',css.includes('@media (max-width:360px)')&&css.includes('width:44px !important;min-width:44px !important;height:44px'));

// Category header + dish ambient.
check('active chip neon is local static full line',css.includes('#westo-dish-catbar .westo-dish-catbar__chip.is-active::after')&&css.includes('width:2rem !important')&&css.includes('transform:translateX(-50%) !important')&&css.includes('animation:none !important'));
check('active chip neon is not clipped by paint containment',css.includes('contain:layout style !important')&&css.includes('overflow:visible !important'));
check('legacy full-bar indicator stays disabled',css.includes('#westo-dish-catbar::before { display:none !important;content:none !important; }'));
check('dish ambient assigned without scroll rAF',polish.includes('section.dataset.westoLightSlot')&&!polish.includes('requestAnimationFrame'));
check('dish ambient uses static radial gradient',css.includes('benefits_container::before')&&css.includes('background:radial-gradient'));
check('dish ambient has four deterministic destinations',css.includes("data-westo-light-slot='1'")&&css.includes("data-westo-light-slot='2'")&&css.includes("data-westo-light-slot='3'"));
const ambientBlock=(css.match(/benefits_container::before \{([\s\S]*?)\n\}/)||[])[1]||'';
check('dish ambient avoids blur/filter',ambientBlock&&!/(?:^|[;\s])(?:filter|backdrop-filter)\s*:/.test(ambientBlock));

// Table / classic category UX.
check('table close is 50px red glass control',css.includes('.table-drawer__close')&&css.includes('width:50px !important')&&css.includes('color:#ff8b94 !important'));
check('table close explicitly avoids backdrop blur',/\.table-drawer__close \{[\s\S]{0,1000}backdrop-filter:none !important/.test(css));
check('classic hero category labels enlarged',css.includes('.westo-prod-hero-cat span')&&css.includes('font-size:11px !important')&&css.includes('font-size:10px !important'));
check('category rail enables native horizontal scroll and snap',css.includes('overflow-x:auto !important')&&css.includes('scroll-snap-type:x proximity')&&css.includes('touch-action:pan-x !important'));
check('category rail prevents Lenis conflict',polish.includes("data-lenis-prevent")&&polish.includes("data-lenis-prevent-touch"));
check('category rail wheel only intercepts horizontal intent',polish.includes('horizontalIntent')&&polish.includes('Math.abs(event.deltaX) > Math.abs(event.deltaY) * 0.45'));

// Thermal root-cause guards / preserved architecture.
check('thermal governor has no frame loop',polish.includes('dataset.thermalIdle')&&!polish.includes('requestAnimationFrame'));
check('thermal idle pauses decorative CSS loops',css.includes("html[data-thermal-idle='true'] #westo-entrance *")&&css.includes('animation-play-state:paused !important'));
check('mobile/coarse entrance removes live backdrop sampling',css.includes('@media (max-width:767px), (pointer:coarse)')&&css.includes('#westo-entrance .eg-card')&&css.includes('backdrop-filter:none !important'));
check('balanced/economy shimmer disabled',css.includes("html[data-perf-tier='economy'] .scroll_discover")&&css.includes("html[data-perf-tier='balanced'] .scroll_discover")&&css.includes('animation:none !important'));
check('entrance particles sleep on thermal idle',entrance.includes("westo:thermal-idle")&&entrance.includes('onThermalIdle = () => stopParticles()'));
check('entrance particles wake safely',entrance.includes("westo:thermal-wake")&&entrance.includes('onThermalWake'));
check('hero repeating scroll icon sleeps on thermal idle',anim.includes("document.documentElement.dataset.thermalIdle === 'true'")&&anim.includes("westo:thermal-idle', syncScrollIconPlay"));
check('menu orb drift sleeps on thermal idle',anim.includes("westo:thermal-idle', stopOrbDrift")&&anim.includes("dataset.thermalIdle === 'true'"));
check('Three true idle sleep preserved',three.includes('True idle sleep')&&three.includes('renderCtl.idleMs > 520'));
check('Three dish WebGL suspension preserved',three.includes('suspend WebGL sim + GPU presents')&&three.includes('renderCtl.idleMs > 480'));
check('Three page visibility guard preserved',three.includes("document.visibilityState !== 'hidden'"));
check('Resource Scheduler constrained budget preserved',loader.includes("max: 2, reserve: 1")&&loader.includes("document.addEventListener('visibilitychange'"));
check('reduced motion guard retained',css.includes('@media (prefers-reduced-motion:reduce)'));

console.log(JSON.stringify({pass,fail,failures,release},null,2));
if(fail) process.exit(1);
