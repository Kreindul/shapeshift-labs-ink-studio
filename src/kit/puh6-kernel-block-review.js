/* Replay sample-indexed controls across block partitions and compare portable traces. */
(function (K) {
  const W=K.world, {check,id,equal,own,record,endpoint,copy}=W.data, {freeze}=K.procedural.data;
  const format='ink-studio/block-review', traceFormat='ink-studio/block-trace';
  const maxSamples=1000000, maxCapturedValues=2000000;
  const float=type=>type==='Float32Array'||type==='Float64Array';
  const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
  const fields=(value,names)=>record(value)&&Object.keys(value).every(key=>names.includes(key));

  function setup(model,path,onBlock) {
    check(model?.format===W.models.format && ['live','offline'].includes(path),'Block playback needs a model and a valid path');
    const {world,systems,ports}=W.runtime.modelInterface(model), [name]=Object.keys(systems);
    check(world.simulationModel.blockSize!==undefined && systems[name].kernel?.block,
      'Block playback needs a single block kernel model');
    const {kind,operatorRevision,config}=world.systems[name];
    const session=W.kernels.prepare(kind,operatorRevision,config,{id:name,dt:world.dt,seed:world.seed});
    const {processor}=session, live=path==='live';
    check(!live||processor,'Live block playback needs a prepared processor');
    const levels=live?processor.input:Object.fromEntries(Object.entries(ports.inputs)
      .map(([port,spec])=>[endpoint(port)[1],spec.default]));
    const commands=world.commands.map(({tick,args})=>({sample:tick-1,port:endpoint(args.port)[1],value:args.value}))
      .sort((a,b)=>a.sample-b.sample);
    const eventPorts=Object.entries(ports.outputs).filter(([,spec])=>spec.type==='event').map(([port])=>endpoint(port)[1]);
    const capacity=Math.min(world.simulationModel.blockSize,processor?.capacity.effectiveMaxSamples??W.kernels.maxBlockSize);
    let cursor=0,next=0,running=false;

    function process(count) {
      check(!running && integer(count,0,W.runtime.maxTick-cursor),'Invalid or reentrant block playback request');
      const target=cursor+count;
      running=true;
      try {
        while(cursor<target) {
          while(commands[next]?.sample===cursor) {
            const {port,value}=commands[next++];
            levels[port]=value;
          }
          const start=cursor, end=Math.min(target,cursor+capacity,commands[next]?.sample??Infinity);
          let outputs;
          if(live) {
            const status=processor.process(end-start);
            if (status!=='ok'&&status!=='deadline') throw Error('Live block playback stopped at sample '+start+' ('+status+')');
            outputs=processor.output;
          } else outputs=session.advanceBlock({start,end,input:levels});
          cursor=end;
          onBlock?.(start,end,outputs,processor?.buffers);
        }
        return cursor;
      } finally { running=false; }
    }

    return {
      process,snapshot:session.snapshot,buffers:processor?.buffers,eventPorts,capacity,
      bufferLayout:processor?.report().memory.buffers,
      identity:freeze({id:world.id,revision:world.simulationModel.revision,commands}),
      cursor:()=>cursor
    };
  }

  // Useful to a live host without the diagnostic capture or snapshot work on its process path.
  function playback(model,{path='live',onBlock}={}) {
    check(onBlock===undefined||typeof onBlock==='function','Block playback observer must be a function');
    const {process,snapshot,buffers,capacity,cursor}=setup(model,path,onBlock);
    return Object.freeze({process,snapshot,buffers,capacity,cursor});
  }

  function prepareCapture(model,{samples,blocks,path='offline',buffers=[]}={}) {
    check(integer(samples,1,maxSamples) && Array.isArray(blocks) && blocks.length>=1 && blocks.length<=64 &&
      Array.from(blocks).every(size=>integer(size,1,W.runtime.maxTick)),'Invalid block capture sample count or request pattern');
    check(Array.isArray(buffers) && buffers.length<=16 && Array.from(buffers).every(id) &&
      new Set(buffers).size===buffers.length && samples*buffers.length<=maxCapturedValues,'Invalid block capture buffers');
    const chosen=buffers.slice().sort(), pattern=blocks.slice();
    const play=setup(model,path,capture);
    const tracks=Object.fromEntries(chosen.map(name=>{
      const view=play.buffers?.[name];
      check(play.bufferLayout?.[name]?.role==='output' && ArrayBuffer.isView(view) &&
        view.length>=Math.min(samples,play.capacity,Math.max(...pattern)),
        'Capture needs a prepared sample buffer large enough for its blocks: '+name);
      return [name,{type:Object.prototype.toString.call(view).slice(8,-1),values:Array(samples)}];
    }));
    const events=Object.fromEntries(play.eventPorts.map(name=>[name,[]]));
    let requested=0, processed=0, largestBlock=0, saved;

    function capture(start,end,outputs,views) {
      for (const name of chosen) {
        const into=tracks[name].values, from=views[name];
        for(let i=start;i<end;i++) {
          const value=from[i-start];
          check(Number.isFinite(value),'Nonfinite sample in '+name+' at '+i);
          into[i]=value;
        }
      }
      for (const name of play.eventPorts) {
        check(events[name].length+outputs[name].length<=W.rates.maxEvents,'Block capture event budget exceeded');
        for (const row of outputs[name]) events[name].push(row);
      }
      processed++;
      largestBlock=Math.max(largestBlock,end-start);
    }
    function step() {
      if (play.cursor()===samples) return false;
      play.process(Math.min(pattern[requested%pattern.length],samples-play.cursor()));
      requested++;
      return true;
    }
    function trace() {
      check(play.cursor()===samples,'Block capture has not finished');
      return saved??=freeze({format:traceFormat,version:1,identity:play.identity,samples,
        request:{path,blocks:pattern,requested,processed,largestBlock},
        tracks,events,checkpoint:play.snapshot()});
    }
    return Object.freeze({step,trace,cursor:play.cursor});
  }

  function capture(model,options) {
    const result=prepareCapture(model,options);
    while(result.step()) { /* sample ranges are bounded by the prepared kernel */ }
    return result.trace();
  }

  function tolerances(raw={}) {
    check(fields(raw,['absolute','relative']),'Invalid block review tolerances');
    const {absolute=0,relative=0}=raw;
    check([absolute,relative].every(value=>Number.isFinite(value)&&value>=0) && relative<=1,
      'Block review tolerances must be finite, with relative tolerance between zero and one');
    return {absolute,relative};
  }

  function compare(reference,candidate,{tolerance,compareState=true}={}) {
    const {absolute,relative}=tolerances(tolerance);
    const inspect=trace=>check(trace?.format===traceFormat && trace.version===1 &&
      integer(trace.samples,1,maxSamples) && record(trace.identity) && record(trace.tracks) &&
      Object.keys(trace.tracks).length<=16 && record(trace.events) && record(trace.checkpoint),'Invalid block trace');
    inspect(reference);
    inspect(candidate);
    check(typeof compareState==='boolean','Invalid block state comparison policy');
    let firstDifference, firstFailure, numericValues=0, changedValues=0, maxAbsoluteError=0;
    function difference(path,expected,actual,sample,allowed=false) {
      if (firstDifference && (allowed || firstFailure)) return;
      const entry={path,sample:sample??null,expected:expected??null,actual:actual??null};
      firstDifference??=entry;
      if (!allowed) firstFailure??=entry;
    }
    function numeric(path,expected,actual,sample,allow,signed=false) {
      numericValues++;
      if (Number.isFinite(expected)&&Number.isFinite(actual)) {
        if (signed ? Object.is(expected,actual) : expected===actual) return;
        changedValues++;
        const delta=Math.abs(expected-actual), scale=Math.max(Math.abs(expected),Math.abs(actual));
        maxAbsoluteError=Math.max(maxAbsoluteError,delta);
        const limit=absolute+relative*scale;
        const within=Number.isFinite(delta) && Number.isFinite(limit) ? delta<=limit :
          Math.abs(expected/scale-actual/scale)<=absolute/scale+relative;
        difference(path,expected,actual,sample,allow&&within&&Boolean(absolute||relative));
      } else difference(path,expected,actual,sample);
    }
    function exact(path,expected,actual,sample=null) {
      if (!equal(expected,actual)) difference(path,expected,actual,sample);
    }
    const keys=value=>Object.keys(value).sort();
    const {commands:authored,...model}=reference.identity, {commands:received,...otherModel}=candidate.identity;
    exact('/identity',model,otherModel);
    if (!Array.isArray(authored) || !Array.isArray(received) || authored.length!==received.length) {
      difference('/identity/commands',authored?.length,received?.length);
    } else {
      for(let i=0;i<authored.length;i++) if(!equal(authored[i],received[i])) {
        difference('/identity/commands/'+i,authored[i],received[i],authored[i]?.sample);
        break;
      }
    }
    exact('/samples',reference.samples,candidate.samples);
    const channels=keys(reference.tracks);
    exact('/tracks',channels,keys(candidate.tracks));
    const matched=channels.filter(name=>{
      const a=reference.tracks[name], b=candidate.tracks[name];
      if (!record(a) || !record(b) || a.type!==b.type ||
        a.values?.length!==reference.samples || b.values?.length!==reference.samples ||
        !Array.isArray(a.values) || !Array.isArray(b.values)) {
        difference('/tracks/'+name,{type:a?.type,length:a?.values?.length},{type:b?.type,length:b?.values?.length});
        return false;
      }
      return true;
    });
    if (!firstFailure) for(let i=0;i<reference.samples;i++) for (const name of matched) {
      const a=reference.tracks[name], b=candidate.tracks[name];
      if (a.values[i]!==b.values[i] || !Number.isFinite(a.values[i]))
        numeric('/tracks/'+name,a.values[i],b.values[i],i,float(a.type));
      else numericValues++;
    }
    const eventPorts=keys(reference.events);
    exact('/events',eventPorts,keys(candidate.events));
    for (const port of eventPorts) {
      const a=reference.events[port], b=candidate.events[port];
      if (!Array.isArray(a)||!Array.isArray(b)||a.length>W.rates.maxEvents||b.length>W.rates.maxEvents) {
        exact('/events/'+port,'bounded event list',null);
        continue;
      }
      for(let i=0;i<Math.max(a.length,b.length);i++)
        exact('/events/'+port+'/'+i,a[i],b[i],a[i]?.timing?.sample??b[i]?.timing?.sample??null);
    }

    const a=reference.checkpoint, b=candidate.checkpoint;
    for (const field of ['format','version','kind','revision','settings','steps','data'])
      exact('/checkpoint/'+field,a[field],b[field]);
    exact('/checkpoint/outputs',keys(a.outputs??{}),keys(b.outputs??{}));
    for (const [name,value] of Object.entries(a.outputs??{})) {
      const other=b.outputs?.[name], at=reference.samples-1, path='/checkpoint/outputs/'+name;
      if (typeof value==='number') numeric(path,value,other,at,true);
      else if (!own(reference.events,name) && Array.isArray(value) && value.length===3 &&
        value.every(Number.isFinite) && Array.isArray(other) && other.length===3) {
        value.forEach((n,i)=>numeric(path+'/'+i,n,other[i],at,true));
      } else exact(path,value,other,at);
    }
    if (compareState) {
      const left=W.kernels.inspectBuffers(a), right=W.kernels.inspectBuffers(b);
      exact('/checkpoint/buffers',keys(left),keys(right));
      for (const [name,values] of Object.entries(left)) {
        const path='/checkpoint/buffers/'+name, before=a.buffers[name], after=b.buffers[name];
        if (before.type!==after?.type || before.length!==after?.length) {
          exact(path,{type:before.type,length:before.length},{type:after?.type,length:after?.length});
        } else if (before.base64!==after.base64) {
          const allow=float(before.type);
          values.forEach((value,i)=>numeric(path+'/'+i,value,right[name][i],null,allow,true));
        } else numericValues+=values.length;
      }
    }
    return freeze({status:firstFailure?'diverged':firstDifference?'within-tolerance':'exact',
      tolerance:{absolute,relative},compareState,numericValues,changedValues,
      maxAbsoluteError:Number.isFinite(maxAbsoluteError)?maxAbsoluteError:null,
      firstDifference:firstDifference??null,firstFailure:firstFailure??null});
  }

  function review(model,plan,candidate) {
    check(fields(plan,['format','version','samples','buffers','cases','tolerance','compareState']) &&
      plan.format===format && plan.version===1 && integer(plan.samples,1,maxSamples) &&
      Array.isArray(plan.cases) && plan.cases.length>=1 && plan.cases.length<=16 &&
      Array.from(plan.cases).every(row=>fields(row,['id','path','blocks']) && id(row.id)) &&
      new Set(plan.cases.map(row=>row.id)).size===plan.cases.length &&
      (plan.buffers===undefined||Array.isArray(plan.buffers)) &&
      plan.samples*(plan.buffers?.length??0)*plan.cases.length<=maxCapturedValues,
    'Invalid block review plan');
    check(plan.cases.length>=2 || candidate!==undefined,'Block review needs at least two traces');
    const options={tolerance:tolerances(plan.tolerance),compareState:plan.compareState===undefined?true:plan.compareState};
    check(typeof options.compareState==='boolean','Invalid block state comparison policy');
    const run=row=>capture(model,{samples:plan.samples,buffers:plan.buffers,path:row.path,blocks:row.blocks});
    const [base,...others]=plan.cases, reference=run(base);
    const cases=others.map(row=>{
      const trace=run(row);
      return {id:row.id,request:trace.request,...compare(reference,trace,options)};
    });
    if (candidate!==undefined) cases.push({id:'external',request:candidate.request,...compare(reference,candidate,options)});
    const status=cases.some(row=>row.status==='diverged')?'diverged':
      cases.some(row=>row.status==='within-tolerance')?'within-tolerance':'exact';
    return {reference,report:freeze({status,samples:plan.samples,tolerance:options.tolerance,
      compareState:options.compareState,reference:{id:base.id,request:reference.request},cases})};
  }

  W.blockReview=Object.freeze({format,traceFormat,playback,prepareCapture,capture,compare,review});
})(KIT);
