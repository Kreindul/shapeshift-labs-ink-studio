const test=require('node:test');
const assert=require('node:assert/strict');
const {KIT:{world:W}}=require('..').load();
const bounds={min:[0,-1,0],max:[14,2,8]};
const nav=config=>({kind:'navigation',config:{bounds,cell:.5,tiles:{size:4},...config}});
const command=(tick,action,args)=>({tick,action,args});
const trace=(query,from,to,args={})=>query.trace('nav/route',from,{to,...args}).value;
const water=(origin,depth=0)=>({kind:'water',config:{width:1,height:1,cell:1,origin,
  accounts:{well:origin.map(n=>n+.5)},initial:depth?[{bounds:{min:origin,max:origin.map(n=>n+1)},value:depth}]:[]}});
const runsAt=(query,agent)=>query.probe('crew/agent',{agent}).value;
const json=value=>JSON.parse(JSON.stringify(value));

test('walking routes connect cached tile boundaries across sparse large worlds',()=>{
  const world={systems:{nav:nav({bounds:{min:[0,-2,0],max:[500,3,500]},cell:.5})}};
  const query=W.runtime.create(world).query(), from=[1,0,1], to=[14,0,1];
  const cold=trace(query,from,to), warm=trace(query,from,to);
  assert.equal(cold.status,'ok');
  assert(cold.tiles.length>3);
  assert.equal(cold.crossings.length,cold.tiles.length-1);
  assert(cold.work.built.length>3&&cold.work.built.length<30);
  assert.deepEqual(warm.points,cold.points);
  assert.deepEqual(warm.crossings,cold.crossings);
  assert.deepEqual(warm.work.built,[]);
  assert(warm.work.reused.length>=cold.tiles.length);
});

test('flooding reroutes a ford crossing and preserves a distant active route beyond its retry tick',()=>{
  const from=[1,0,1.5], to=[12,0,1.5], remote=[1,0,6.5], far=[12,0,6.5];
  const world={dt:.05,systems:{nav:nav({water:'ford/water'}),ford:water([6,1]),tank:water([20,1],1),
    crew:{kind:'agents',config:{navigation:'nav',replanTicks:1,
      species:{worker:{mode:'walk',speed:.5}},agents:{local:{species:'worker',position:from,goal:to},
        remote:{species:'worker',position:remote,goal:far}}}}
  }};
  const run=W.runtime.create(world);
  run.step();
  const oldQuery=run.query();
  const routeArgs={radius:.15,maxWade:.14}, old=trace(oldQuery,from,to,routeArgs);
  const oldRemote=runsAt(oldQuery,'remote'), oldLocal=runsAt(oldQuery,'local');
  assert.equal(old.status,'ok');
  assert(old.points.every(p=>p[2]===1.5));
  const flood=command(2,'world/transfer',{from:'tank/well',to:'ford/well',amount:.6});
  run.schedule([flood]);
  run.step();
  const now=run.query(), revised=runsAt(now,'local'), remoteStill=runsAt(now,'remote');
  assert.equal(now.probe('ford/water',[6.5,0,1.5]).value.depth,.6);
  assert.notDeepEqual(revised.route,oldLocal.route);
  assert.strictEqual(remoteStill.route,oldRemote.route);
  assert.equal(remoteStill.retry,oldRemote.retry);
  assert.deepEqual(run.dependencies().work.filter(row=>row.kind==='agent-route').map(row=>row.detail.entity),['local']);
  const detour=trace(now,from,to,routeArgs);
  assert.equal(detour.status,'ok');
  assert(detour.points.some(p=>p[2]!==1.5));
  assert(detour.work.invalidated.length>0);
  assert(detour.work.invalidated.every(key=>Number(key.split(',')[1])<=1));
  assert.deepEqual(trace(oldQuery,from,to,routeArgs).points,old.points);
  run.schedule([command(3,'world/transfer',{from:'ford/well',to:'tank/well',amount:.6})]);
  run.step();
  assert.deepEqual(trace(run.query(),from,to,routeArgs).points,old.points);
  const saved=json(run.checkpoint());
  const resumed=W.runtime.create(saved.world,{checkpoint:saved});
  resumed.advance(8);
  run.advance(8);
  assert.deepEqual(resumed.checkpoint(),run.checkpoint());
  assert.deepEqual(W.runtime.replay(json(run.recording())).checkpoint(),run.checkpoint());
});

test('reshaping and fracturing a wall changes seam connectivity in its own tiles',()=>{
  const from=[1,0,2],to=[13,0,2], side=[1,0,6.5], far=[5,0,6.5];
  const run=W.runtime.create({dt:.05,systems:{nav:nav({clearance:'rig/clearance'}),
    rig:{kind:'mechanics',config:{gravity:[0,0,0],bodies:{
      wall:{fixed:true,position:[6,0,2],half:[.3,.75,.15]}
    }}}
  }});
  const initial=run.query(), detour=trace(initial,from,to);
  assert.equal(detour.status,'ok');
  assert(detour.points.some(p=>p[2]!==2));
  const other=trace(initial,side,far);
  run.schedule([
    command(1,'rig/reshape',{body:'wall',half:[.3,.75,2]}),
    command(2,'rig/fracture',{body:'wall',axis:2,parts:2,omit:[0,1]})
  ]);
  run.step();
  const expanded=trace(run.query(),from,to);
  assert.equal(expanded.status,'ok');
  assert(expanded.cost>detour.cost);
  assert(expanded.work.invalidated.length>0);
  assert.deepEqual(trace(run.query(),side,far).points,other.points);
  run.step();
  const open=trace(run.query(),from,to);
  assert(open.cost<detour.cost);
  assert(open.points.every(p=>p[2]===2));
});

test('construction refits and live solid cuts reopen local passages',()=>{
  const from=[1,0,1],to=[13,0,1], narrow={min:[0,-1,0],max:[14,2,2]};
  const run=W.runtime.create({dt:.1,systems:{nav:nav({bounds:narrow,clearance:'work/clearance'}),
    work:{kind:'construction',config:{points:{barrier:{position:[6,0,1]}},
      constraints:[{id:'site',type:'pin',point:'barrier',position:[6,0,1]}],
      blocks:[{id:'wall',at:'barrier',half:[.3,.8,1.1]}]}}
  }});
  assert.equal(trace(run.query(),from,to).status,'unreachable');
  run.schedule([command(1,'work/refit',{pins:{site:[6,0,5]}})]);
  run.step();
  assert.equal(trace(run.query(),from,to).status,'ok');

  const cut=W.runtime.create({systems:{nav:nav({bounds:narrow,clearance:'rock/clearance'}),
    rock:{kind:'volume',config:{
      bounds:{min:[4,-1,0],max:[8,2,2]},cell:.5,materials:{stone:[1,2,3,4]},
      initial:[{op:'fill',material:'stone',shape:{kind:'box',at:[6,0,1],half:[.5,1,1.1]}}]
    }}
  }});
  assert.equal(trace(cut.query(),from,to).status,'unreachable');
  cut.schedule([command(1,'rock/cut',{shape:{kind:'box',at:[6,0,1],half:[.8,.75,.6]}})]);
  cut.step();
  const entrance=trace(cut.query(),from,to);
  assert.equal(entrance.status,'ok');
  assert(entrance.crossings.length>0);
});
