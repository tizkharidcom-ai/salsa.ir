/* Shared, geometry-aware chair placement for floor editor and waiter views. */
(function (root) {
  'use strict';
  const sizes = { circle:[76,76], rectangle:[104,68], booth:[114,74], square:[58,58], oval:[104,64], bar_stool:[44,44], lounge_takht:[110,80], conference:[176,68], semi_circle:[110,68], wall_counter:[130,38], round_booth:[98,98], single_chair:[46,46] };
  const clamp = (n,min,max) => Math.min(max,Math.max(min,n));
  const fmt = n => Math.round((Number.isFinite(n)?n:0)*10)/10;
  function positions(count,start,end) { return count<2?[(start+end)/2]:Array.from({length:count},(_,i)=>start+(end-start)*i/(count-1)); }
  function row(count,side,dims,w,h) {
    if (!count) return [];
    const [tw,th]=dims, range=(side==='north'||side==='south')?[20,80]:[24,76], gap=6;
    return positions(count,...range).map(p=>{
      if(side==='north') return {x:p,y:-(h/2+gap)/th*100,angle:0,side};
      if(side==='south') return {x:p,y:100+(h/2+gap)/th*100,angle:180,side};
      if(side==='east') return {x:100+(h/2+gap)/tw*100,y:p,angle:90,side};
      return {x:-(h/2+gap)/tw*100,y:p,angle:-90,side:'west'};
    });
  }
  function ellipse(count,rx,ry,containerW,containerH,start=-Math.PI/2,sweep=Math.PI*2,gap=6,chairDepth=11) {
    const samples=Math.max(180,count*36), points=[]; let length=0, prev=null;
    for(let i=0;i<=samples;i++) { const a=start+sweep*i/samples,x=rx*Math.cos(a),y=ry*Math.sin(a); if(prev) length+=Math.hypot(x-prev.x,y-prev.y); points.push({a,x,y,d:length}); prev={x,y}; }
    const closed=Math.abs(Math.abs(sweep)-Math.PI*2)<.001;
    return Array.from({length:count},(_,i)=>{
      const target=length*(closed?i/count:(i+.5)/count); let j=points.findIndex(p=>p.d>=target); j=Math.max(1,j);
      const a=points[j-1],b=points[j],t=(target-a.d)/Math.max(.001,b.d-a.d),angle=a.a+(b.a-a.a)*t;
      const nx=Math.cos(angle)/rx,ny=Math.sin(angle)/ry,norm=Math.hypot(nx,ny)||1,ux=nx/norm,uy=ny/norm;
      const tx=-rx*Math.sin(angle),ty=ry*Math.cos(angle),depth=gap+chairDepth/2;
      return {x:50+(rx+depth)*ux/containerW*100,y:50+(ry+depth)*uy/containerH*100,angle:Math.atan2(ty,tx)*180/Math.PI,side:'round'};
    });
  }
  function layout(options={}) {
    const shape=Object.hasOwn(sizes,options.shape)?options.shape:'rectangle', dims=sizes[shape];
    const seats=clamp(Math.floor(Number(options.seats)||1),1,24), scale=clamp(Number(options.chairScale)||1,.55,1.5);
    const model=options.chairModel==='armchair'?'armchair':(options.chairModel==='bar_stool'||(!options.chairModel&&(shape==='bar_stool'||shape==='wall_counter')))?'stool':options.chairModel==='booth_bench'?'bench':options.chairModel==='bench'?'bench':(options.chairModel==='bolster'||(!options.chairModel&&shape==='lounge_takht'))?'bolster':'standard';
    const base=model==='stool'?[12,12]:model==='bench'?[18,11]:model==='bolster'?[17,9]:model==='armchair'?[17,13]:[16,11]; let chairs=[],decoration='';
    if(shape==='lounge_takht') decoration='<div class="plan-takht-rug"></div><div class="plan-takht-cushion plan-takht-cushion--n" title="پشتی سنتی"></div><div class="plan-takht-cushion plan-takht-cushion--s" title="پشتی سنتی"></div><div class="plan-takht-cushion plan-takht-cushion--e" title="پشتی سنتی"></div><div class="plan-takht-cushion plan-takht-cushion--w" title="پشتی سنتی"></div>';
    else if(shape==='booth') decoration='<div class="plan-booth-cushion plan-booth-cushion--top"></div><div class="plan-booth-cushion plan-booth-cushion--bottom"></div>';
    else if(shape==='round_booth') { decoration='<div class="plan-roundbooth-cushion"></div>'; chairs=ellipse(seats,34,34,98,98,135*Math.PI/180,270*Math.PI/180,-7,base[1]*scale); }
    else if(shape==='semi_circle') { decoration='<div class="plan-semicircle-cushion"></div>'; chairs=ellipse(seats,46,29,110,68,Math.PI,Math.PI,6,base[1]*scale); }
    else if(shape==='circle'||shape==='oval') chairs=ellipse(seats,dims[0]/2,dims[1]/2,dims[0],dims[1],shape==='circle'&&seats===2?0:undefined,undefined,6,base[1]*scale);
    else if(shape==='wall_counter'||shape==='bar_stool') chairs=row(seats,'south',dims,base[0]*scale,base[1]*scale);
    else if(shape==='square') { const counts={north:0,south:0,east:0,west:0},order=['north','south','east','west']; for(let i=0;i<seats;i++) counts[order[i%4]]++; order.forEach(side=>chairs.push(...row(counts[side],side,dims,base[0]*scale,base[1]*scale))); }
    else { const heads=(shape==='conference'&&seats>=4)||(shape==='rectangle'&&seats>=6)?2:0,rows=seats-heads,n=Math.ceil(rows/2); chairs.push(...row(n,'north',dims,base[0]*scale,base[1]*scale),...row(rows-n,'south',dims,base[0]*scale,base[1]*scale)); if(heads) chairs.push(...row(1,'west',dims,base[0]*scale,base[1]*scale),...row(1,'east',dims,base[0]*scale,base[1]*scale)); }
    const counts=chairs.reduce((all,c)=>(all[c.side]=(all[c.side]||0)+1,all),{});
    const chairData=chairs.map(c=>{
      const limit=c.side==='north'||c.side==='south'?4:3;
      const density=counts[c.side]>limit?Math.max(.52,limit/counts[c.side]):1;
      return {...c,width:fmt(base[0]*scale*density),height:fmt(base[1]*scale*density)};
    });
    const markup=decoration+chairData.map((c,i)=>{
      const style=`--chair-x:${fmt(c.x)}%;--chair-y:${fmt(c.y)}%;--chair-angle:${fmt(c.angle)}deg;--chair-w:${c.width}px;--chair-h:${c.height}px`;
      return `<div class="plan-chair plan-chair--auto plan-chair--${model} plan-chair--${c.side}" data-seat-index="${i+1}" data-seat-base-x="${fmt(c.x)}" data-seat-base-y="${fmt(c.y)}" data-seat-base-angle="${fmt(c.angle)}" style="${style}" aria-hidden="true"></div>`;
    }).join('');
    return {shape,seats,model,chairs:chairData,markup};
  }

  const rectOf = (element) => {
    const r=element.getBoundingClientRect();
    return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};
  };
  const overlapArea = (a,b) => Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))
    * Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
  const expandRect = (rect,padding=2) => ({
    left:rect.left-padding,top:rect.top-padding,right:rect.right+padding,bottom:rect.bottom+padding,
    width:rect.width+padding*2,height:rect.height+padding*2,
  });

  // Keep each seat outside nearby tables and seats. Stored table coordinates
  // are never changed; only the decorative seat nodes are moved in the view.
  function resolveCollisions(layer) {
    if(!layer?.querySelectorAll) return {moved:0,conflicts:0};
    const tables=[...layer.querySelectorAll('.plan-table')];
    const records=tables.map(table=>({table,surface:table.querySelector('.plan-table-surface'),chairs:[...table.querySelectorAll('.plan-chair--auto')]}));
    const seats=records.flatMap(record=>record.chairs.map(chair=>({record,chair})));
    if(!seats.length) return {moved:0,conflicts:0};

    for(const {chair} of seats) {
      const sideClasses=['north','east','south','west','round'];
      if(chair.dataset.seatBaseSide===undefined) {
        chair.dataset.seatBaseSide=sideClasses.find(side=>chair.classList.contains(`plan-chair--${side}`))||'round';
      }
      if(chair.dataset.seatBaseX===undefined) {
        chair.dataset.seatBaseX=chair.style.getPropertyValue('--chair-x').replace('%','');
        chair.dataset.seatBaseY=chair.style.getPropertyValue('--chair-y').replace('%','');
        chair.dataset.seatBaseAngle=chair.style.getPropertyValue('--chair-angle').replace('deg','');
      }
      sideClasses.forEach(side=>chair.classList.remove(`plan-chair--${side}`));
      if(chair.dataset.seatBaseSide!=='round') chair.classList.add(`plan-chair--${chair.dataset.seatBaseSide}`);
      chair.style.setProperty('--chair-x',`${chair.dataset.seatBaseX}%`);
      chair.style.setProperty('--chair-y',`${chair.dataset.seatBaseY}%`);
      chair.style.setProperty('--chair-angle',`${chair.dataset.seatBaseAngle}deg`);
      chair.style.setProperty('left',`${chair.dataset.seatBaseX}%`,'important');
      chair.style.setProperty('top',`${chair.dataset.seatBaseY}%`,'important');
      chair.style.setProperty('transition','none','important');
      delete chair.dataset.seatAdjusted;
      delete chair.dataset.seatCollision;
    }
    for(const {table} of records) {
      table.classList.remove('has-seat-collision','has-collision');
      delete table.dataset.layoutOverlapWith;
    }

    let tableCollisions=0;
    for(let i=0;i<records.length;i++) for(let j=i+1;j<records.length;j++) {
      const a=records[i],b=records[j];
      if(!a.surface||!b.surface||overlapArea(rectOf(a.surface),rectOf(b.surface))<=2) continue;
      a.table.classList.add('has-collision');b.table.classList.add('has-collision');
      a.table.dataset.layoutOverlapWith=[...(a.table.dataset.layoutOverlapWith||'').split(',').filter(Boolean),b.table.dataset.table].join(',');
      b.table.dataset.layoutOverlapWith=[...(b.table.dataset.layoutOverlapWith||'').split(',').filter(Boolean),a.table.dataset.table].join(',');
      tableCollisions++;
    }

    const stage=layer.closest('.architectural-canvas-wrap, .pos-plan-viewport, #floor-canvas-stage') || layer.parentElement;
    const bounds=stage?rectOf(stage):null;
    const slots=[12,26,40,60,74,88];
    const choicesFor=(chair,record)=>{
      const table=record.table,surface=record.surface;
      const tw=Math.max(1,table.offsetWidth),th=Math.max(1,table.offsetHeight);
      const sw=Math.max(1,surface?.offsetWidth||tw),sh=Math.max(1,surface?.offsetHeight||th);
      const sx=surface?.offsetLeft||0,sy=surface?.offsetTop||0;
      const w=parseFloat(chair.style.getPropertyValue('--chair-w'))||16;
      const h=parseFloat(chair.style.getPropertyValue('--chair-h'))||11;
      const gap=6,baseX=Number(chair.dataset.seatBaseX)||0,baseY=Number(chair.dataset.seatBaseY)||0;
      const baseAngle=Number(chair.dataset.seatBaseAngle)||0;
      const candidates=[{x:baseX,y:baseY,angle:baseAngle,preferred:true}];
      const sides=[
        {side:'north',angle:0,point:(p)=>({x:sx+sw*p/100,y:sy-gap-h/2})},
        {side:'east',angle:90,point:(p)=>({x:sx+sw+gap+h/2,y:sy+sh*p/100})},
        {side:'south',angle:180,point:(p)=>({x:sx+sw*p/100,y:sy+sh+gap+h/2})},
        {side:'west',angle:-90,point:(p)=>({x:sx-gap-h/2,y:sy+sh*p/100})},
      ];
      for(const item of sides) for(const p of slots) {
        const point=item.point(p),candidate={x:point.x/tw*100,y:point.y/th*100,angle:item.angle,side:item.side};
        if(!candidates.some(old=>Math.abs(old.x-candidate.x)<.1&&Math.abs(old.y-candidate.y)<.1&&old.angle===candidate.angle)) candidates.push(candidate);
      }
      return candidates;
    };
    const setCandidate=(chair,candidate)=>{
      chair.style.setProperty('--chair-x',`${fmt(candidate.x)}%`);
      chair.style.setProperty('--chair-y',`${fmt(candidate.y)}%`);
      chair.style.setProperty('--chair-angle',`${fmt(candidate.angle)}deg`);
      chair.style.setProperty('left',`${fmt(candidate.x)}%`,'important');
      chair.style.setProperty('top',`${fmt(candidate.y)}%`,'important');
    };
    const conflictCost=(chair,record,seatRect)=>{
      let cost=0;
      const seatWithClearance=expandRect(seatRect);
      for(const other of records) {
        if(other===record||!other.surface) continue;
        const area=overlapArea(seatWithClearance,rectOf(other.surface));
        if(area>0.25) cost+=1200+area*12;
      }
      for(const other of seats) {
        if(other.chair===chair) continue;
        const area=overlapArea(seatWithClearance,expandRect(rectOf(other.chair)));
        if(area>0.25) cost+=450+area*5;
      }
      if(bounds) {
        const overflow=Math.max(0,bounds.left+2-seatRect.left)+Math.max(0,bounds.top+2-seatRect.top)
          +Math.max(0,seatRect.right-(bounds.right-2))+Math.max(0,seatRect.bottom-(bounds.bottom-2));
        if(overflow>0) cost+=1800+overflow*30;
      }
      return cost;
    };

    const moved=new Set();
    for(let pass=0;pass<8;pass++) {
      const ordered=seats.map(item=>({...item,conflicts:conflictCost(item.chair,item.record,rectOf(item.chair))}))
        .filter(item=>item.conflicts>0).sort((a,b)=>b.conflicts-a.conflicts);
      if(!ordered.length) break;
      let changed=false;
      for(const item of ordered) {
        const {chair,record}=item,base={x:Number(chair.dataset.seatBaseX)||0,y:Number(chair.dataset.seatBaseY)||0,angle:Number(chair.dataset.seatBaseAngle)||0};
        const originalRect=rectOf(chair);
        const currentCost=conflictCost(chair,record,originalRect);
        let best={...base,side:chair.dataset.seatBaseSide,preferred:true,cost:currentCost,displacement:0};
        let bestScore=currentCost;
        for(const candidate of choicesFor(chair,record)) {
          setCandidate(chair,candidate);
          const candidateRect=rectOf(chair),cost=conflictCost(chair,record,candidateRect);
          const dx=candidateRect.left+candidateRect.width/2-(originalRect.left+originalRect.width/2);
          const dy=candidateRect.top+candidateRect.height/2-(originalRect.top+originalRect.height/2);
          const displacement=Math.hypot(dx,dy);
          const adjustedCost=cost+displacement*.04+(candidate.preferred?0:0.01);
          if(adjustedCost<bestScore) {best={...candidate,cost,displacement};bestScore=adjustedCost;}
        }
        setCandidate(chair,best);
        ['north','east','south','west','round'].forEach(side=>chair.classList.remove(`plan-chair--${side}`));
        if(best.side&&best.side!=='round') chair.classList.add(`plan-chair--${best.side}`);
        if(!best.preferred&&best.cost<currentCost) {
          chair.dataset.seatAdjusted='true';
          chair.classList.remove('plan-chair--north','plan-chair--east','plan-chair--south','plan-chair--west');
          chair.classList.add(`plan-chair--${best.side}`);
          changed=true;moved.add(chair);
        }
      }
      if(!changed) break;
    }
    let conflicts=0;
    for(const item of seats) {
      if(conflictCost(item.chair,item.record,rectOf(item.chair))>0.25) {
        item.chair.dataset.seatCollision='true';
        item.record.table.classList.add('has-seat-collision');
        conflicts++;
      }
    }
    return {moved:moved.size,conflicts,tableCollisions};
  }

  root.WestoFloorChairLayout=Object.freeze({layout,resolveCollisions});
  if(typeof root.addEventListener==='function'&&typeof root.requestAnimationFrame==='function') {
    let resizeFrame=0;
    root.addEventListener('resize',()=>{
      if(resizeFrame) root.cancelAnimationFrame?.(resizeFrame);
      resizeFrame=root.requestAnimationFrame(()=>{
        resizeFrame=0;
        for(const layer of root.document?.querySelectorAll?.('.plan-tables-layer')||[]) {
          if(layer.getClientRects().length) resolveCollisions(layer);
        }
      });
    },{passive:true});
  }
})(typeof window!=='undefined'?window:globalThis);
