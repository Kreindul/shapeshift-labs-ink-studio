/* Run deterministic wave blocks with portable pressure, flow and delay memory. */
(function(K){
  const W=K.world, T=W.waveTopology, {check,record,equal,own}=W.data;
  const {integer,array,finite}=T, {freeze}=K.procedural.data;
  const runFormat='ink-studio/wave-run', traceFormat='ink-studio/wave-trace', checkpointFormat='ink-studio/wave-checkpoint';
  function numbers(value,count){
    if(!array(value)||value.length!==count)return false;
    for(let i=0;i<count;i++)if(!finite(value[i]))return false;
    return true;
  }

  function prepare(domain,settings={}){
    const spec=T.compile(domain,settings), {sources,probes,sampleRate,method,maxWork,identity}=spec;
    const engine=method==='distributed'?W.waveDistributed(spec):W.waveDelay(spec);
    const probePressure=new Float64Array(probes.length), probeFlow=new Float64Array(probes.length);
    const buffers={...engine.buffers,probePressure,probeFlow};
    const views=Object.entries(buffers).map(([name,value])=>({name,value,saved:new Float64Array(value.length)}));
    const keys=new Set(sources.map(row=>row.name)), level=new Float64Array(sources.length);
    const info=freeze({method,sampleRate,soundSpeed:spec.soundSpeed,density:spec.density,domain:identity,
      nodes:spec.named,tubes:spec.tubeCount,sections:spec.segments.length,workPerSample:engine.workPerSample,maxWork,
      sources:sources.map(({name,kind})=>({name,kind})),probes:probes.map(({name})=>name),...engine.info});
    let sample=0;

    function process(count,{inputs={},collect=true}={}){
      check(integer(count,0,65536)&&sample+count<=Number.MAX_SAFE_INTEGER&&typeof collect==='boolean',
        'Wave block needs a bounded sample count');
      check(count*engine.workPerSample<=maxWork,'Wave block exceeded the work limit; split it into smaller blocks');
      check(!collect||count*probes.length<=1000000,'Wave block exceeded its collected sample budget');
      check(record(inputs)&&Object.keys(inputs).every(name=>keys.has(name)),'Invalid wave input channels');
      const supplied=sources.map(({name})=>{
        const value=own(inputs,name)?inputs[name]:0;
        check(finite(value)||numbers(value,count),'Wave input '+name+' needs a finite level or one value per sample');
        return value;
      });
      const pressure=collect?probes.map(()=>new Float64Array(count)):null;
      const flow=collect?probes.map(()=>new Float64Array(count)):null;
      if(count){
        for(const {value,saved} of views)saved.set(value);
        try{
          for(let i=0;i<count;i++){
            for(let j=0;j<level.length;j++)level[j]=finite(supplied[j])?supplied[j]:supplied[j][i];
            engine.advance(sample+i,level,probePressure,probeFlow);
            for(let j=0;j<probes.length;j++){
              check(finite(probePressure[j])&&finite(probeFlow[j]),'Wave probe exceeded the finite numeric range');
              if(collect){pressure[j][i]=probePressure[j];flow[j][i]=probeFlow[j];}
            }
          }
          check(views.every(({value})=>value.every(finite)),'Wave state exceeded the finite numeric range');
        }catch(error){
          for(const {value,saved} of views)value.set(saved);
          throw error;
        }
      }
      const start=sample;
      sample+=count;
      return {start,end:sample,...(collect&&{
        pressure:Object.fromEntries(probes.map(({name},i)=>[name,pressure[i]])),
        flow:Object.fromEntries(probes.map(({name},i)=>[name,flow[i]]))
      })};
    }

    function view(){
      return {sample,time:sample/sampleRate,probes:Object.fromEntries(probes.map(({name},i)=>
        [name,{pressure:probePressure[i],flow:probeFlow[i]}]))};
    }
    function snapshot({typed=false}={}){
      return {format:checkpointFormat,version:1,method,domain:identity,sample,
        buffers:Object.fromEntries(views.map(({name,value})=>[name,typed?value.slice():Array.from(value)]))};
    }
    function restore(row){
      check(row?.format===checkpointFormat&&row.version===1&&row.method===method&&equal(row.domain,identity)&&
        integer(row.sample,0,Number.MAX_SAFE_INTEGER)&&record(row.buffers)&&Object.keys(row.buffers).length===views.length&&
        views.every(({name,value})=>numbers(row.buffers[name],value.length)),'Incompatible wave checkpoint');
      for(const {name,value} of views)value.set(row.buffers[name]);
      sample=row.sample;
    }
    function reset(){for(const {value} of views)value.fill(0);sample=0;}
    return Object.freeze({info,process,view,snapshot,restore,reset});
  }

  W.waveNetworks=Object.freeze({format:T.format,runFormat,traceFormat,checkpointFormat,prepare});
})(KIT);
