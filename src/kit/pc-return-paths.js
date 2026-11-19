/* Route a finite-width return around a reserved approach with pinned ends. */
(function(K){
  const P=K.procedural||K.authoring,EPS=1e-8;
  const vector=p=>Array.isArray(p)&&p.length===2&&Array.from(p).every(v=>Number.isFinite(v)&&Math.abs(v)<=1e6);
  const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]];
  const dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
  const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  const lift=([x,z])=>[x,0,z],plan=([x,,z])=>[x,z];
  const rectangle=(lo,hi)=>[lo,[hi[0],lo[1]],hi,[lo[0],hi[1]]];

  function fitReturn(approach,destination,{
    occupiedHalfWidth,halfWidth,toeExtension=0,clearance=.025,maxLength=300,obstacles=[]
  }={}){
    if(!Array.isArray(approach)||approach.length<2||approach.length>256||
      !Array.from(approach).every(vector)||!vector(destination)||
      ![occupiedHalfWidth,halfWidth,clearance,toeExtension,maxLength].every(Number.isFinite)||
      occupiedHalfWidth<=0||halfWidth<=0||clearance<0||toeExtension<0||maxLength<=0||
      !Array.isArray(obstacles)||!obstacles.every(ring=>Array.isArray(ring)&&ring.length>=3&&
        ring.length<=256&&Array.from(ring).every(vector)))
      throw new Error('Return paths need bounded planar geometry, positive widths and ordered clearances');
    const {stripFootprint}=P.routes,head=approach[0],first=sub(approach[1],head),
      reach=halfWidth+clearance,length=Math.hypot(...first);
    if(length<=EPS||approach.some((p,i)=>i&&distance(p,approach[i-1])<=EPS))
      throw new Error('A return approach needs nonzero spans');
    if(distance(head,destination)<=EPS)return Object.freeze({status:'blocked-pin'});
    if(obstacles.length>32)return Object.freeze({status:'budget'});
    const along=first.map(v=>v/length),side=[-along[1],along[0]];
    const project=p=>{
      const delta=sub(p,head);
      return [dot(delta,along),dot(delta,side)];
    };
    const unproject=([s,v])=>head.map((x,i)=>x+s*along[i]+v*side[i]);
    const guide=approach.map(project),last=guide.at(-1),toe=sub(last,guide.at(-2)),
      ratio=toeExtension/Math.hypot(...toe);
    guide[guide.length-1]=last.map((v,i)=>v+toe[i]*ratio);
    const occupied=guide.slice(1).map((p,i)=>stripFootprint(guide[i],p,occupiedHalfWidth));
    const corners=occupied.flat(),lo=[0,1].map(i=>Math.min(...corners.map(p=>p[i]))),
      hi=[0,1].map(i=>Math.max(...corners.map(p=>p[i])));
    const outerLo=lo.map(v=>v-reach),outerHi=hi.map(v=>v+reach);
    const outer=rectangle(outerLo,outerHi),entry=[outerLo[0],0],pin=project(destination),
      ends=[];
    for(const i of [0,1]){
      if(pin[i]<=lo[i]-clearance+EPS){
        const point=pin.slice();
        if(pin[i]>outerLo[i]+EPS)point[i]=pin[i]-reach;
        ends.push({point,axis:i,near:point[i]!==pin[i],direction:-1});
      }
      if(pin[i]>=hi[i]+clearance-EPS){
        const point=pin.slice();
        if(pin[i]<outerHi[i]-EPS)point[i]=pin[i]+reach;
        ends.push({point,axis:i,near:point[i]!==pin[i],direction:1});
      }
    }
    if(!ends.length)return Object.freeze({status:'blocked-pin'});
    const blockers=obstacles.map(ring=>RouteVisibility.convexFootprint(ring.map(project),{margin:reach,maxSides:12})),
      masks=blockers.map(ring=>P.edgeClearance.footprint(ring)),
      blocked=(a,b)=>P.edgeClearance.ranges(lift(a),lift(b),masks).removed.length>0,
      entrance=stripFootprint([0,0],entry,halfWidth),
      reserveClips=occupied.some(boundary=>P.surfaceCells.clip([{key:'entry',polygon:entrance}],{boundary}).fragmentCount>0);
    if(reserveClips||blocked([0,0],entry))return Object.freeze({status:'blocked-pin'});
    const budget={maxVertices:420,maxTests:200000};
    if(blockers.reduce((sum,ring)=>sum+ring.length,outer.length+2)>budget.maxVertices)
      return Object.freeze({status:'budget'});
    let best=null,exhausted=false,pinClear=false;
    for(const {point:exit,axis,near,direction} of ends){
      if(blocked(exit,pin))continue;
      pinClear=true;
      // Continue along a side all the way to the last cross section. A
      // shortcut to a short return lead can reverse the offset inner rail.
      const lower=outerLo.slice(),upper=outerHi.slice();
      if(near)(direction<0?lower:upper)[axis]=exit[axis];
      const barrier=near?rectangle(lower,upper):outer;
      const middle=distance(entry,exit)<=EPS?{status:'ok',points:[lift(entry)]}:
        RouteVisibility.find(lift(entry),lift(exit),[barrier,...blockers],budget);
      if(middle.status!=='ok'){
        exhausted||=middle.status==='budget';
        continue;
      }
      const path=[[0,0],...middle.points.map(plan),pin],points=[];
      for(const point of path)if(!points.length||distance(point,points.at(-1))>EPS)points.push(point);
      const length=points.slice(1).reduce((sum,p,i)=>sum+distance(p,points[i]),0);
      if(length<=maxLength&&(!best||length<best.length-EPS))
        best={status:'ok',length,points:[head.slice(),...points.slice(1,-1).map(unproject),destination.slice()]};
    }
    return P.data.freeze(best||{status:exhausted?'budget':pinClear?'unreachable':'blocked-pin'});
  }

  P.routes.fitReturn=fitReturn;
})(KIT);
