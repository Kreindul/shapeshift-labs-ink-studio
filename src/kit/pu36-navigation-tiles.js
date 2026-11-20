/* Lazy walking tiles with cached local edges and explicit boundary crossings. */
(function(K){
  const W=K.world,P=K.procedural,V=K.V,{check,record,id}=W.data;
  const directions=[[1,0],[0,1],[-1,0],[0,-1],[1,1],[-1,1],[-1,-1],[1,-1]];
  const eps=1e-8;
  const horizontal=(a,b)=>Math.hypot(a[0]-b[0],a[2]-b[2]);
  const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
  const overlap=P.spatialDependencies.overlaps;

  function appended(before,after,area){
    let shared=0;
    while(shared<Math.min(before.length,after.length)&&before[shared]===after[shared])shared++;
    return [...before.slice(shared),...after.slice(shared)].map(area).filter(Boolean);
  }

  function create(config,optionsFor){
    const {bounds,cell=.25,tiles}=config;
    const {size=16,maxTiles=512,maxProfiles=16,maxVisits=100000}=tiles;
    check(record(tiles)&&Object.keys(tiles).every(key=>['size','maxTiles','maxProfiles','maxVisits'].includes(key))&&
      integer(size,4,64)&&integer(maxTiles,4,4096)&&integer(maxProfiles,1,64)&&integer(maxVisits,1,500000),
    'Invalid navigation tile settings');
    const [x0,,z0]=bounds.min,[x1,,z1]=bounds.max;
    const nx=Math.ceil((x1-x0)/cell)+1,nz=Math.ceil((z1-z0)/cell)+1,dx=(x1-x0)/(nx-1),dz=(z1-z0)/(nz-1);
    check(Number.isSafeInteger(nx*nz)&&nx>1&&nz>1&&dx>eps&&dz>eps&&
      [...bounds.min,...bounds.max].every(n=>Math.abs(n)<=1e6),'Invalid tiled navigation lattice');
    const sourceNames=[...new Set(['bed','support','clearance','water','wear'].map(key=>config[key]).filter(name=>typeof name==='string'))];
    const profiles=new Map(), proofs=new WeakMap(), keyOf=(i,j)=>j*nx+i;
    const xAt=i=>i===nx-1?x1:x0+i*dx, zAt=j=>j===nz-1?z1:z0+j*dz;
    const inDomain=p=>W.fields.zone(p,bounds);
    const nearLimit=2*Math.hypot(dx,dz);
    let current,sources,invalidated=[],serial=0,frame;

    function bind(query){
      if(query===current)return frame;
      const resolved=sourceNames.map(name=>query.navigationSource(name));
      const dirty=[];
      let global=false;
      if(sources)for(let i=0;i<resolved.length;i++){
        const source=resolved[i], old=sources[i];
        if(source.key===old.key)continue;
        const changes=source.changes?.(old.key);
        if(!changes){global=true;break;}
        dirty.push(...changes);
      }
      if(global||dirty.length){
        invalidated=[];
        for(const [key,profile] of profiles)for(const [name,tile] of profile.tiles)
          if(global||dirty.some(area=>overlap(area,tile.area))){
            profile.tiles.delete(name);
            invalidated.push({tile:name,profile:key});
          }
      }
      current=query;
      sources=resolved;
      frame=Object.freeze({route:(from,to,spec)=>route(query,from,to,spec),
        valid:(from,points,cursor,goal,spec)=>valid(query,from,points,cursor,goal,spec),
        report:()=>{
          bind(query);
          return {tileCells:size,cached:[...profiles.values()].reduce((n,row)=>n+row.tiles.size,0),invalidated};
        }});
      return frame;
    }
    function profileFor({radius=.13,maxWade=.16,maxSlope=.9,exclude}={}){
      check(Number.isFinite(radius)&&radius>0&&radius<=1e4&&Number.isFinite(maxWade)&&maxWade>=0&&
        (maxSlope===Infinity||Number.isFinite(maxSlope)&&maxSlope>=0)&&(exclude===undefined||id(exclude)),
      'Invalid tiled navigation profile');
      const key=JSON.stringify([radius,maxWade,maxSlope,exclude]);
      let profile=profiles.get(key);
      profiles.delete(key);
      if(!profile)profile={id:++serial,spec:{radius,maxWade,maxSlope,exclude},tiles:new Map()};
      profiles.set(key,profile);
      if(profiles.size>maxProfiles)profiles.delete(profiles.keys().next().value);
      return profile;
    }
    function access(query,spec){
      bind(query);
      const profile=profileFor(spec), options=optionsFor(query,profile.spec);
      const sampler=P.routes.terrainSampler({...options,sampleStep:Math.min(dx,dz)/3,
        keepOut:(x,z,y)=>y<bounds.min[1]||y>bounds.max[1]});
      const touched=new Set(),built=new Set();
      function node(index){
        const i=index%nx,j=Math.floor(index/nx),u=Math.floor(i/size),v=Math.floor(j/size),name=u+','+v;
        const saved=profile.tiles.get(name);
        let tile=saved;
        profile.tiles.delete(name);
        if(!tile){
          const pad=profile.spec.radius+Math.max(dx,dz);
          tile={name,revision:++serial,points:new Map(),edges:new Map(),
            area:{axes:'xz',min:[xAt(u*size)-pad,zAt(v*size)-pad],
              max:[xAt(Math.min(nx-1,(u+1)*size-1))+pad,zAt(Math.min(nz-1,(v+1)*size-1))+pad]}};
          built.add(name);
        }
        profile.tiles.set(name,tile);
        touched.add(name);
        if(profile.tiles.size>maxTiles)profile.tiles.delete(profile.tiles.keys().next().value);
        if(!tile.points.has(index)){
          const x=xAt(i),z=zAt(j);
          tile.points.set(index,{index,i,j,p:[x,options.height(x,z),z],tile});
        }
        return tile.points.get(index);
      }
      function edge(a,b){
        if(a.index>b.index)[a,b]=[b,a];
        const key=a.index+'/'+b.index, memo=a.tile.edges.get(key);
        if(memo?.revision===b.tile.revision)return memo.cost;
        const cost=sampler.edge(a.p,b.p);
        a.tile.edges.set(key,{revision:b.tile.revision,cost});
        return cost;
      }
      function near(p){
        const i=Math.round((p[0]-x0)/dx),j=Math.round((p[2]-z0)/dz),indices=[];
        for(let z=Math.max(0,j-1);z<=Math.min(nz-1,j+1);z++)
          for(let x=Math.max(0,i-1);x<=Math.min(nx-1,i+1);x++)indices.push(keyOf(x,z));
        return indices;
      }
      function lattice(p){
        const i=Math.round((p[0]-x0)/dx),j=Math.round((p[2]-z0)/dz);
        if(i<0||i>=nx||j<0||j>=nz||Math.abs(xAt(i)-p[0])>eps||Math.abs(zAt(j)-p[2])>eps)return null;
        return node(keyOf(i,j));
      }
      const pin=p=>[p[0],options.height(p[0],p[2]),p[2]];
      return {node,edge,near,lattice,pin,sampler,options,touched,built,profile};
    }
    function valid(query,from,points,cursor,goal,spec){
      if(!points[cursor]||horizontal(points.at(-1),goal)>eps||!inDomain(from))return false;
      const map=access(query,spec), start=map.pin(from), last=points.length-1;
      let latticeOnly=true;
      function pass(a,b){
        if(!inDomain(a)||!inDomain(b)||horizontal(a,b)>nearLimit+eps)return false;
        const grid=map.lattice(a), next=map.lattice(b);
        if(Math.abs((grid?.p[1]??map.options.height(a[0],a[2]))-a[1])>eps||
          Math.abs((next?.p[1]??map.options.height(b[0],b[2]))-b[1])>eps)return false;
        if(grid&&next&&Math.abs(grid.i-next.i)<=1&&Math.abs(grid.j-next.j)<=1)
          return Number.isFinite(map.edge(grid,next));
        latticeOnly=false;
        return Number.isFinite(map.sampler.edge(a,b));
      }
      if(!Number.isFinite(map.sampler.pin(start))||!pass(start,points[cursor]))return false;
      if(cursor===last)return true;
      if(!pass(points[last-1],points[last]))return false;
      const proof=proofs.get(points), cache=map.profile.tiles;
      if(proof?.profile===map.profile.id&&cursor>=proof.cursor&&
        proof.tiles.every(([name,version])=>cache.get(name)?.revision===version))return true;
      latticeOnly=true;
      for(let i=cursor+1;i<last;i++)if(!pass(points[i-1],points[i]))return false;
      const tiles=[...map.touched].map(name=>[name,cache.get(name)?.revision]);
      if(latticeOnly&&tiles.every(([,version])=>version!==undefined))
        proofs.set(points,{profile:map.profile.id,cursor,tiles});
      return true;
    }
    function route(query,from,to,spec){
      if(!inDomain(from)||!inDomain(to))return {status:'outside',points:[]};
      const map=access(query,spec), start=map.pin(from), end=map.pin(to), source=-1, target=-2;
      const best=new Map(), parent=new Map(), positions=new Map([[source,start],[target,end]]);
      const owner=p=>Math.floor(Math.round((p[0]-x0)/dx)/size)+','+Math.floor(Math.round((p[2]-z0)/dz)/size);
      let visits=0;
      const outcome=(status,extra={})=>({status,points:[],...extra,
        work:{visits,built:[...map.built].sort(),reused:[...map.touched].filter(name=>!map.built.has(name)).sort(),
          invalidated:[...new Set(invalidated.map(row=>row.tile))].sort()}});
      if(![start,end].every(p=>Number.isFinite(map.sampler.pin(p))))return outcome('blocked-pin');
      if(horizontal(start,end)<=eps)return outcome('ok',{points:[start],cost:0,length:0,tiles:[owner(start)],crossings:[]});
      const endNodes=new Map(map.near(end).map(index=>[index,map.sampler.edge(map.node(index).p,end)]));
      const open=new ProceduralHeap((a,b)=>a.priority<b.priority||a.priority===b.priority&&a.index<b.index);
      function push(index,p,prev,cost){
        if(!Number.isFinite(cost)||cost>=(best.get(index)??Infinity))return;
        best.set(index,cost); parent.set(index,prev); positions.set(index,p);
        open.push({index,cost,priority:cost+horizontal(p,end)});
      }
      push(source,start,null,0);
      while(open.size){
        const {index,cost}=open.pop();
        if(best.get(index)!==cost)continue;
        if(index===target){
          const path=[];
          for(let i=index;i!==null;i=parent.get(i))path.push(i);
          if(path.length>4097)return outcome('budget',{reason:'points'});
          path.reverse();
          const points=[], tiles=[], crossings=[];
          let prev=null,length=0;
          for(const key of path){
            const p=positions.get(key);
            if(!points.length||horizontal(points.at(-1),p)>eps){
              if(points.length)length+=V.dist(points.at(-1),p);
              points.push(p);
            }
            const name=key<0?owner(p):map.node(key).tile.name;
            if(!prev||prev.name!==name){
              tiles.push(name);
              if(prev)crossings.push({from:prev.name,to:name,points:[prev.p,p]});
            }
            prev={name,p};
          }
          return outcome('ok',{points,cost,length,tiles,crossings});
        }
        if(visits>=maxVisits)return outcome('budget',{reason:'visits'});
        visits++;
        if(index===source){
          if(owner(start)===owner(end)&&horizontal(start,end)<=nearLimit)
            push(target,end,index,map.sampler.edge(start,end));
          for(const next of map.near(start)){
            const row=map.node(next);
            push(next,row.p,index,map.sampler.edge(start,row.p));
          }
          continue;
        }
        const row=map.node(index);
        if(endNodes.has(index))push(target,end,index,cost+endNodes.get(index));
        for(const [di,dj] of directions){
          const i=row.i+di,j=row.j+dj;
          if(i<0||i>=nx||j<0||j>=nz)continue;
          const next=map.node(keyOf(i,j));
          push(next.index,next.p,index,cost+map.edge(row,next));
        }
      }
      return outcome('unreachable');
    }
    return Object.freeze({bind});
  }
  W.navigationTiles=Object.freeze({create,appended});
})(KIT);
