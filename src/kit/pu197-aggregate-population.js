/* Cohort motion over a shared, immutable identity archive. */
(function(K){
  const W=K.world, Q=W.query, V=K.V, {check,own,record,vector}=W.data, freeze=K.procedural.data.freeze;

  function population(agents,species){
    const counts=Object.fromEntries(species.map(key=>[key,0]));
    let total=0;
    for(const row of Object.values(agents)){
      counts[row.species]++;
      total++;
    }
    return {total,counts};
  }
  function cohorts(settings,{initial,profiles,fit,bounds,contacts}){
    const {clamp}=W.fields;
    const {model,cell=12,goalCell=cell}=settings;
    check(model==='cohorts'&&Object.keys(settings).every(key=>['model','cell','goalCell'].includes(key))&&
      [cell,goalCell].every(n=>Number.isFinite(n)&&n>=.01&&n<=1e6),'Invalid cohort aggregation cells');
    const species=Object.keys(profiles).sort(), byEntity=new Map();
    const measuredSpecies=[...new Set(Object.values(initial).map(row=>row.species))].sort();
    for(const name of Object.keys(initial).sort()){
      const entity=initial[name].entity;
      if(!byEntity.has(entity))byEntity.set(entity,[]);
      byEntity.get(entity).push(name);
    }
    function reduce({agents,decisions}){
      const collections=new Map();
      for(const name of Object.keys(agents).sort()){
        const row=agents[name];
        const key=[row.species,...row.position.map(n=>Math.floor(n/cell)),...row.goal.map(n=>Math.floor(n/goalCell))].join('/');
        if(!collections.has(key))collections.set(key,{species:row.species,members:[],sum:[0,0,0],destination:[0,0,0]});
        const group=collections.get(key);
        group.members.push(name);
        for(let i=0;i<3;i++){group.sum[i]+=row.position[i];group.destination[i]+=row.goal[i];}
      }
      const memberGroup={}, groups=[];
      for(const {species,members,sum,destination} of collections.values()){
        const index=groups.length, origin=V.mul(sum,1/members.length);
        for(const id of members)memberGroup[id]=index;
        groups.push({species,members,origin,position:origin,goal:V.mul(destination,1/members.length),distance:0});
      }
      return freeze({agents,...(decisions&&{decisions}),groups,memberGroup});
    }
    function individual(state,name){
      const row=state.agents[name], group=state.groups[state.memberGroup[name]];
      if(!group.distance)return row;
      const position=row.position.map((n,i)=>clamp(n+group.position[i]-group.origin[i],bounds.min[i],bounds.max[i]));
      return {...row,position,direction:V.norm(V.sub(group.position,group.origin),row.direction),
        mode:profiles[row.species].mode,route:[],cursor:0,retry:0,limbs:[]};
    }
    function expand(state){
      const agents=Object.fromEntries(Object.keys(state.agents).map(name=>[name,individual(state,name)]));
      return freeze({agents,contacts:[],...(state.decisions&&{decisions:state.decisions})});
    }
    function totals(state,isAggregate){
      if(!isAggregate)return population(state.agents,species);
      const counts=Object.fromEntries(species.map(key=>[key,0]));
      let total=0;
      for(const row of state.groups){counts[row.species]+=row.members.length;total+=row.members.length;}
      return {total,counts};
    }
    return {
      quantities:{population:{units:'count',exact:true},species:{units:'count by species',exact:true}},
      measure(state,isAggregate){
        const {total,counts}=totals(state,isAggregate);
        return {population:total,species:measuredSpecies.map(key=>counts[key])};
      },
      reduce,expand,
      validate(state){
        check(record(state?.agents)&&record(state?.memberGroup)&&Array.isArray(state.groups)&&
          Object.keys(state.agents).length===Object.keys(initial).length&&Object.keys(state.memberGroup).length===Object.keys(initial).length&&
          Object.keys(state.agents).every(name=>own(initial,name)&&state.agents[name].entity===initial[name].entity&&
            state.agents[name].species===initial[name].species&&vector(state.agents[name].position)&&
            vector(state.agents[name].goal)&&vector(state.agents[name].direction)),
        'Invalid cohort identity archive');
        const seen=new Set();
        check(state.groups.length<=Object.keys(initial).length&&state.groups.every((row,index)=>
          record(row)&&own(profiles,row.species)&&vector(row.origin)&&vector(row.position)&&vector(row.goal)&&
          Number.isFinite(row.distance)&&row.distance>=0&&Array.isArray(row.members)&&row.members.length>0&&
          row.members.every(name=>{
            if(seen.has(name)||state.memberGroup[name]!==index||state.agents[name]?.species!==row.species)return false;
            seen.add(name);
            return true;
          }))&&seen.size===Object.keys(initial).length,'Invalid cohort membership or motion');
      },
      step(state,ctx){
        let changed=false;
        const groups=state.groups.map(row=>{
          const direction=V.sub(row.goal,row.position), length=V.len(direction), speed=profiles[row.species].speed??1;
          if(length<=1e-8||!speed)return row;
          const point=V.mad(row.position,direction,Math.min(1,ctx.dt*speed/length));
          const fitted=fit(ctx,{radius:.15,maxWade:.14,...profiles[row.species],
            entity:state.agents[row.members[0]].entity},point);
          if(!fitted||V.dist(row.position,fitted)<=1e-8)return row;
          changed=true;
          return {...row,position:fitted,distance:row.distance+V.dist(row.position,fitted)};
        });
        return changed?freeze({...state,groups}):state;
      },
      output:()=>contacts?{contacts:[]}:undefined,
      fields:{population:({state})=>Q.ok(totals(state,true)),
        contacts:()=>Q.ok([]),decisions:({state})=>Q.ok(state.decisions)},
      pose(state,entity){
        for(const name of byEntity.get(entity)??[]){
          const row=individual(state,name);
          if(row.mode!=='dormant')return row;
        }
      },
      *poseEntities(){yield* byEntity.keys();},
      describe:state=>({cohorts:state.groups.length,individuals:Object.keys(state.agents).length})
    };
  }
  W.aggregatePopulation=Object.freeze({population,cohorts});
})(KIT);
