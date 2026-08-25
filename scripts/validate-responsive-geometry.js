'use strict';
const viewports = [[320, 568], [360, 640], [390, 844], [430, 932], [449, 810], [495, 810], [737, 810], [768, 1024], [820, 1180], [991, 800], [992, 800], [1024, 768], [1366, 768], [1440, 900], [844, 390], [740, 360], [667, 375], [568, 320]];
const rem = 16;
const clamp=(lo,x,hi)=>Math.max(lo,Math.min(x,hi));
function geometry([w,h], promo){
  const landscape=w>h; const desktop=w>=992;
  let nav=(desktop?5:4.65)*rem; if(landscape&&h<=600) nav=3.8*rem;
  let catBase=w<=479?6.6*rem:8.1*rem, sub=w<=479?2.85*rem:2.9*rem, gap=w<=479?.55*rem:.75*rem;
  let promoH=0,promoGap=0;
  if(promo){
    if(desktop){ promoH=6*rem; promoGap=.42*rem; }
    else if(w<=479){ promoH=clamp(5*rem,.12*h,6.35*rem); promoGap=.3*rem; }
    else { promoH=clamp(5.3*rem,.115*h,7.15*rem); promoGap=.38*rem; }
    if(h<=650){ promoH=4.45*rem; promoGap=.22*rem; }
    if(!desktop&&h<=740){ catBase=5.4*rem; sub=2.2*rem; gap=.3*rem; }
    if(landscape&&h<=600){ promoH=3.2*rem; promoGap=.18*rem; catBase=4.2*rem; sub=2.2*rem; gap=.2*rem; }
  } else if(landscape&&h<=600){ catBase=4.8*rem; sub=2.75*rem; gap=.25*rem; }
  const chrome=nav+promoH+promoGap+gap+catBase+sub;
  const remaining=h-chrome;
  let info,media;
  if(landscape&&h<=600){
    // Authored CSS switches to a three-column layout: shared card, food, rail.
    // Card no longer consumes vertical stage height, so vertical safety is the
    // chrome remainder itself. Check horizontal food lane separately below.
    info=Math.min(.40*w,22*rem);
    media=remaining;
  } else if(!desktop){
    info=promo&&h<=740?clamp(11*rem,.34*h,13*rem):clamp(13.75*rem,.42*Math.max(0,remaining),16.5*rem);
    media=Math.max(0,remaining-info-.7*rem);
  }else{ info=clamp(16.5*rem,.381966*Math.max(0,remaining),21*rem); media=remaining; }
  const rail=w<=479?5.05*rem:5.5*rem;
  const horizontalFood=w-info-rail-3*rem;
  const passBudget=(landscape&&h<=600)?(remaining>=85&&horizontalFood>=120):(desktop?remaining>=190:media>=70);
  return {width:w,height:h,promo,remaining:+remaining.toFixed(1),info:+info.toFixed(1),media:+media.toFixed(1),passBudget};
}
const rows=viewports.flatMap(v=>[geometry(v,false),geometry(v,true)]); const failed=rows.filter(r=>!r.passBudget);
console.log(JSON.stringify({pass:!failed.length,rows,failed},null,2)); if(failed.length) process.exit(1);
