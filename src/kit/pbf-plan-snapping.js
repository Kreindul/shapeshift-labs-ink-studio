/* Translation-only contact constraints between convex planar profiles. */
(function(K){
  const P=K.procedural||K.authoring,EPS=1e-8,plans=new WeakSet();
  const point=value=>Array.isArray(value)&&value.length===2&&Array.from(value).every(Number.isFinite);

  function compile(outline){
    const vertices=P.geometry.intersectConvexPlans(outline,outline);
    if(vertices.length<3)throw new Error('Snap profiles need a convex area');
    const edges=vertices.map((from,i)=>{
      const to=vertices[(i+1)%vertices.length],dx=to[0]-from[0],dy=to[1]-from[1],length=Math.hypot(dx,dy);
      const tangent=[dx/length,dy/length],normal=[tangent[1],-tangent[0]];
      return {from,length,tangent,normal};
    });
    const bounds={
      min:[0,1].map(axis=>Math.min(...vertices.map(p=>p[axis]))),
      max:[0,1].map(axis=>Math.max(...vertices.map(p=>p[axis])))
    };
    const plan=P.data.freeze({vertices,edges,bounds});
    plans.add(plan);
    return plan;
  }

  function contact(edge,other,x,y,limit){
    const [tx,ty]=edge.tangent,[nx,ny]=edge.normal;
    const u=x-edge.from[0],v=y-edge.from[1];
    let gap=Infinity,lo=Infinity,hi=-Infinity;
    for(const [px,py] of other.vertices){
      const dx=px+u,dy=py+v,d=dx*nx+dy*ny,s=dx*tx+dy*ty;
      if(d<gap-EPS){gap=d;lo=hi=s;}
      else if(d<=gap+EPS){gap=Math.min(d,gap);lo=Math.min(lo,s);hi=Math.max(hi,s);}
    }
    const along=hi<0?-hi:lo>edge.length?edge.length-lo:0;
    const distance=Math.hypot(gap,along);
    if(distance>limit||!Number.isFinite(distance))return null;
    return {distance,correction:[along*tx-gap*nx,along*ty-gap*ny],
      start:Math.max(0,lo+along),end:Math.min(edge.length,hi+along)};
  }

  function align(moving,position,targets,{capture=.22,release=capture*1.5,latch}={}){
    if(!plans.has(moving)||!point(position)||!Array.isArray(targets)||targets.length>4096||
      !Number.isFinite(capture)||capture<0||!Number.isFinite(release)||release<capture)
      throw new Error('Plan snapping needs compiled shapes, a finite translation and ordered tolerances');
    const ids=new Set();
    let best=null,retained=null;
    for(const target of targets){
      const {id,plan}=target||{};
      if(typeof id!=='string'||!id||ids.has(id)||!plans.has(plan))
        throw new Error('Snap targets need unique IDs and compiled plans');
      ids.add(id);
      const limit=latch?.id===id?release:capture;
      if(position.some((v,i)=>moving.bounds.min[i]+v>plan.bounds.max[i]+limit||
        moving.bounds.max[i]+v<plan.bounds.min[i]-limit))continue;
      function consider(reference,other,side,sign,x,y){
        for(const [index,edge] of reference.edges.entries()){
          const keep=latch?.id===id&&latch.side===side&&latch.edge===index;
          const hit=contact(edge,other,x,y,keep?release:capture);
          if(!hit)continue;
          const offset=hit.correction.map(v=>v*sign),next=position.map((v,i)=>v+offset[i]);
          const base=side==='target'?edge.from:edge.from.map((v,i)=>v+next[i]);
          const guide=[hit.start,hit.end].map(s=>base.map((v,i)=>v+s*edge.tangent[i]));
          const candidate={id,position:next,offset,guide,distance:hit.distance,
            span:Math.max(0,hit.end-hit.start),latch:{id,side,edge:index}};
          if(keep)retained=candidate;
          if(!best||candidate.distance<best.distance-EPS||Math.abs(candidate.distance-best.distance)<=EPS&&
            (candidate.span>best.span+EPS||Math.abs(candidate.span-best.span)<=EPS&&id<best.id))best=candidate;
        }
      }
      consider(plan,moving,'target',1,...position);
      consider(moving,plan,'moving',-1,-position[0],-position[1]);
    }
    return retained||best;
  }

  P.planSnapping=Object.freeze({compile,align});
})(KIT);
