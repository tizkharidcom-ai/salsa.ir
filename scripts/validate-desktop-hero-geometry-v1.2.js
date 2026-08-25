'use strict';
const screens=[[992,768],[1024,768],[1366,768],[1440,900],[1514,900],[1680,901],[1920,1080]];
const aspects=[0.65,0.85,1,1.25,1.5,1.85,2.2];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const lerp=(a,b,t)=>a+(b-a)*t;
const fov=34, camZ=14.2, plateH=3.35, stageZ=0.34;
let pass=0,fail=0; const failures=[], rows=[];
for(const [w,h] of screens){
  const compact=clamp((960-h)/260,0,1);
  const y=lerp(0.48,0.66,compact);
  const authoredScale=lerp(1.10,0.98,compact);
  const distance=Math.abs(camZ-stageZ);
  const visibleH=2*Math.tan((fov*Math.PI/180)*0.5)*distance;
  const visibleW=visibleH*(w/h);
  for(const aspect of aspects){
    const plateW=plateH*aspect;
    const fit=Math.min((visibleW*0.36)/plateW,(visibleH*0.43)/plateH);
    const scale=Math.min(authoredScale,clamp(fit,0.52,1.12));
    const pxW=(plateW*scale/visibleW)*w;
    const pxH=(plateH*scale/visibleH)*h;
    const centerY=h/2-(y/visibleH)*h;
    const bottom=centerY+pxH/2;
    const widthOk=pxW<=w*0.365+1;
    const heightOk=pxH<=h*0.435+1;
    // Conservative editorial copy begins around lower 69% of the viewport.
    const bandOk=bottom<=h*0.69;
    const ok=widthOk&&heightOk&&bandOk;
    rows.push({w,h,aspect:Number(aspect.toFixed(2)),scale:Number(scale.toFixed(3)),pxW:Number(pxW.toFixed(1)),pxH:Number(pxH.toFixed(1)),bottom:Number(bottom.toFixed(1)),ok});
    if(ok) pass++; else { fail++; failures.push(rows[rows.length-1]); }
  }
}
console.log(JSON.stringify({pass,fail,failures,rows},null,2));
if(fail) process.exit(1);
