/* Deterministic, layered sample instruments on the shared audio sample clock. */
(function (P) {
  const A=P.mediaGraph, T=P.takeTime, M=P.mediaGraphSupport.sampleKitMix;
  const {fields,record,check,finite,integer,id,clamp,db}=P.musicInstruments;
  const {midi}=P.musicHarmony;
  const budget=16e6, empty=[];
  const own=(object,key)=>Object.hasOwn(object,key) ? object[key] : undefined;
  const number=(row,key,fallback,lo,hi)=>{
    const value=row[key] ?? fallback;
    check(finite(value,lo,hi),'Invalid kit parameter '+key);
    return value;
  };
  function table(raw,min,max,label) {
    check(record(raw),'Expected named '+label);
    const rows=Object.entries(raw);
    check(integer(rows.length,min,max) && rows.every(([name])=>id(name)),'Invalid '+label+' names or count');
    return rows;
  }
  function take(row,asset,mayLoop) {
    check(fields(row,['asset','root','gain','tune','loop']) && id(row.asset),'Invalid sample take');
    const audio=asset(row.asset), frames=audio.samples.length/audio.channels;
    const {loop}=row;
    check(loop===undefined || mayLoop && fields(loop,['from','to','crossfade']) &&
      integer(loop.from,0,frames-2) && integer(loop.to,loop.from+2,frames) &&
      integer(loop.crossfade,1,Math.floor((loop.to-loop.from)/2)),
    'A sustain loop needs a gated take, an in-bounds frame range and a crossfade');
    return {name:row.asset,audio,frames,loop,root:row.root===undefined ? null : midi(row.root),
      gain:db(number(row,'gain',0,-60,18)),tune:number(row,'tune',0,-1200,1200)};
  }
  function layer(row,asset,gated) {
    check(fields(row,['id','takes','releases','velocity','gain']) && id(row.id) &&
      Array.isArray(row.takes) && integer(row.takes.length,1,16) &&
      (row.releases===undefined || gated && Array.isArray(row.releases) && integer(row.releases.length,1,16)),
    'A kit layer needs an ID and takes. Release takes need a gated pad');
    const velocity=row.velocity ?? [0,0,1,1];
    check(Array.isArray(velocity) && velocity.length===4 &&
      Array.from(velocity).every((part,i)=>finite(part,i ? velocity[i-1] : 0,1)) &&
      velocity[3]>velocity[0],'Kit velocity fades need four ordered values in [0,1]');
    return {id:row.id,velocity,gain:db(number(row,'gain',0,-60,18)),
      takes:Array.from(row.takes,t=>take(t,asset,gated)),
      releases:row.releases ? Array.from(row.releases,t=>take(t,asset,false)) : empty};
  }
  function compile(raw,assets) {
    check(fields(raw,['id','pads','buses']) && id(raw.id) && record(assets),'Expected a named sample kit and audio assets');
    const loaded=new Map(), keys=Array(128);
    let takeCount=0;
    function asset(name) {
      check(++takeCount<=8192,'Kit exceeds its take budget');
      if (!loaded.has(name)) {
        check(loaded.size<512 && Object.hasOwn(assets,name),'Unknown kit audio asset '+name);
        const audio=A.audio(assets[name]);
        check(audio.samples.length && audio.channels<=2,'Kit takes need nonempty mono or stereo PCM');
        loaded.set(name,audio);
      }
      return loaded.get(name);
    }
    function strip(row,sends=empty) {
      return {gain:db(number(row,'gain',0,-60,18)),pan:number(row,'pan',0,-1,1),sends,
        inserts:M.inserts(row.inserts)};
    }
    const buses=Object.fromEntries(table(raw.buses ?? {},0,12,'kit buses').map(([name,row])=>{
      check(fields(row,['gain','pan','inserts']),'Invalid kit bus '+name);
      return [name,strip(row)];
    }));
    const pads=Object.fromEntries(table(raw.pads,1,64,'kit pads').map(([name,row])=>{
      check(fields(row,['notes','choke','gated','attack','release','gain','pan','inserts','sends','articulations']) &&
        !Object.hasOwn(buses,name) && (row.choke===undefined || id(row.choke)) &&
        (row.gated===undefined || typeof row.gated==='boolean'),'Invalid kit pad '+name);
      if (row.notes!==undefined) {
        const range=row.notes;
        check(Array.isArray(range) && range.length===2 && integer(range[0],0,127) &&
          integer(range[1],range[0],127),'Kit pitch maps need a MIDI range');
        for (let pitch=range[0];pitch<=range[1];pitch++) {
          check(keys[pitch]===undefined,'A MIDI pitch can route to only one pad');
          keys[pitch]=name;
        }
      }
      const articulations=Object.fromEntries(table(row.articulations,1,16,'pad articulations').map(([art,layers])=>{
        check(Array.isArray(layers) && integer(layers.length,1,12),'An articulation needs one to twelve kit layers');
        const compiled=Array.from(layers,item=>layer(item,asset,row.gated));
        check(new Set(compiled.map(item=>item.id)).size===compiled.length,'Duplicate kit layer ID');
        return [art,compiled];
      }));
      const sends=table(row.sends ?? {},0,12,'pad sends');
      check(sends.every(([bus,level])=>Object.hasOwn(buses,bus) && finite(level,0,1)),'Pad sends need a named bus and a level in [0,1]');
      return [name,{...strip(row,sends.filter(([,gain])=>gain>0)),articulations,
        attack:number(row,'attack',.001,0,1),release:number(row,'release',.045,.001,2),
        choke:row.choke,gated:row.gated ?? false}];
    }));
    return {id:raw.id,pads,buses,keys};
  }
  function frame(point,rate,maximum) {
    check(finite(T.seconds(point),0,maximum),'Invalid kit event time or duration');
    return T.index(T.roundDown(T.mul(point,[BigInt(rate),1n])));
  }
  function schedule(kit,events,rate,stop,clock) {
    check(Array.isArray(events) && events.length<=24576,'Expected a bounded list of kit events');
    const point=time=>P.musicTiming.isPosition(time) ? clock.resolve(time) : T.read(time);
    const rows=Array.from(events,(row,index)=>{
      check(fields(row,['time','duration','until','pad','note','velocity','articulation']) &&
        (row.note!==undefined || id(row.pad)) && (row.pad===undefined || id(row.pad)) &&
        (row.articulation===undefined || id(row.articulation)) &&
        (row.duration===undefined || row.until===undefined),'Invalid kit event or gate at index '+index);
      const pitch=row.note===undefined ? null : midi(row.note), name=row.pad ?? kit.keys[pitch];
      const pad=own(kit.pads,name), articulation=row.articulation ?? 'default';
      check(pad && own(pad.articulations,articulation),'Unknown kit pad or articulation at event '+index);
      const start=point(row.time), at=frame(start,rate,3600), hasGate=row.duration!==undefined || row.until!==undefined;
      check(!pad.gated || hasGate,'Gated pad '+name+' needs a duration or until');
      const end=row.until!==undefined ? point(row.until) : hasGate ? T.add(start,T.read(row.duration)) : start;
      const off=frame(end,rate,3720);
      check(!hasGate || off>at && finite(T.seconds(T.sub(end,start)),0,120),'A kit gate must last between one sample and 120 seconds');
      const velocity=number(row,'velocity',.8,0,1);
      const layers=pad.articulations[articulation].map(layer=>({layer,weight:velocityGain(velocity,layer.velocity)}))
        .filter(({weight})=>weight>0);
      return {index,pad,name,articulation,pitch,at,off,velocity,layers};
    }).filter(row=>row.at<stop && row.velocity>0 && row.layers.length).sort((a,b)=>a.at-b.at);
    const next=new Map();
    for (let i=rows.length-1;i>=0;i--) {
      const row=rows[i], group=row.pad.choke;
      row.choke=Infinity;
      if (!group) continue;
      const following=next.get(group);
      row.choke=following?.at===row.at ? following.choke : following?.at ?? Infinity;
      next.set(group,row);
    }
    return rows;
  }
  function velocityGain(velocity,[from,fullFrom,fullTo,to]) {
    if (velocity<from || velocity>to) return 0;
    if (velocity<fullFrom) return (velocity-from)/(fullFrom-from);
    if (velocity>fullTo) return (to-velocity)/(to-fullTo);
    return 1;
  }
  function reader(take,rate,pitch) {
    const {audio:{samples,channels,sampleRate},frames:end,root,tune}=take;
    const step=sampleRate/rate*2**(((root===null || pitch===null ? 0 : pitch-root)+tune/100)/12);
    check(finite(step,1/128,16),'Sample pitch or rate conversion exceeds the kit resampling range');
    const cutoff=step>1 ? .94/step : 1;
    const radius=Math.min(48,Math.ceil(8/cutoff));
    const sinc=x=>Math.abs(x)<1e-10 ? 1 : Math.sin(Math.PI*x)/(Math.PI*x);
    function read(pos,out) {
      const base=Math.floor(pos);
      if (cutoff===1 && base===pos) {
        out[0]=samples[base*channels] ?? 0;
        out[1]=channels===1 ? out[0] : samples[base*2+1] ?? 0;
        return;
      }
      let left=0,right=0,total=0;
      for (let i=Math.max(0,base-radius+1);i<Math.min(end,base+radius+1);i++) {
        const x=i-pos, w=sinc(x*cutoff)*sinc(x/radius);
        left+=w*samples[i*channels];
        if (channels===2) right+=w*samples[i*2+1];
        total+=w;
      }
      out[0]=left/total;
      out[1]=channels===1 ? out[0] : right/total;
    }
    return {step,read,cost:step===1 ? 2 : radius*4};
  }
  function voice(take,row,rate,start,end,amplitude,release) {
    const {step,read,cost}=reader(take,rate,row.pitch), loop=take.loop;
    const loopLength=loop && loop.to-loop.from-loop.crossfade;
    const last=loop ? end : Math.min(end,start+Math.ceil(take.frames/step));
    const attack=release ? 0 : row.pad.attack*rate;
    const chokeFade=Math.max(1,Math.round(rate*.004));
    const naturalEnd=start+take.frames/step, releaseFrames=row.pad.release*rate;
    function render(data,stop) {
      const out=[0,0], next=[0,0];
      for (let i=start;i<Math.min(last,stop);i++) {
        let pos=(i-start)*step;
        if (loop && pos>=loop.to) pos=loop.from+loop.crossfade+(pos-loop.to)%loopLength;
        read(pos,out);
        if (loop && pos>=loop.to-loop.crossfade) {
          const into=pos-(loop.to-loop.crossfade), mix=into/loop.crossfade;
          read(loop.from+into,next);
          out[0]+=(next[0]-out[0])*mix;
          out[1]+=(next[1]-out[1])*mix;
        }
        let env=attack ? clamp((i-start)/attack) : 1;
        if (!loop) env*=clamp((naturalEnd-i)/Math.max(1,rate*.003));
        if (!release && row.pad.gated) env*=clamp(1-(i-row.off)/releaseFrames);
        env*=clamp(1-(i-row.choke)/chokeFade);
        data[2*i]+=out[0]*env*amplitude*take.gain;
        data[2*i+1]+=out[1]*env*amplitude*take.gain;
      }
    }
    return {start,last,cost:cost*(loop ? 2 : 1),render};
  }
  function perform(kit,events,rate,stop,clock) {
    const counters=new Map(), result=Object.fromEntries(Object.keys(kit.pads).map(name=>[name,[]]));
    let work=0, count=0, end=0;
    const report=[];
    for (const row of schedule(kit,events,rate,stop,clock)) {
      const {pad,name,articulation,index,at,off,choke,pitch,velocity}=row;
      const key=name+':'+articulation, layers=[];
      const turn=counters.get(key) ?? 0;
      const stopChoke=choke+Math.max(1,Math.round(rate*.004));
      function add(sound) {
        if (sound.last<=sound.start || sound.start>=stop) return;
        result[name].push(sound);
        work+=(Math.min(sound.last,stop)-sound.start)*sound.cost;
        check(work<=2.6e8 && ++count<=65536,'Kit performance exceeds its voice resampling budget');
        end=Math.max(end,Math.min(stop,sound.last));
      }
      for (const {layer,weight} of row.layers) {
        const gain=weight*layer.gain*velocity**.65;
        const hit=layer.takes[turn%layer.takes.length];
        const release=layer.releases.length && off<choke && off<stop ?
          layer.releases[turn%layer.releases.length] : undefined;
        const bodyEnd=Math.min(stopChoke,pad.gated ? off+Math.ceil(pad.release*rate) : Infinity);
        add(voice(hit,row,rate,at,bodyEnd,gain,false));
        if (release) add(voice(release,row,rate,off,stopChoke,gain,true));
        layers.push({id:layer.id,weight,take:hit.name,...(release && {release:release.name})});
      }
      counters.set(key,turn+1);
      report.push({index,pad:name,articulation,pitch,at,velocity,roundRobin:turn,layers,
        ...(pad.gated && {noteOff:off}),...(choke<stop && {chokeAt:choke})});
    }
    return {voices:result,end,events:report};
  }
  function render(raw,assets,events,options={}) {
    check(fields(options,['sampleRate','duration','stems','map']) &&
      (options.stems===undefined || typeof options.stems==='boolean'),'Invalid kit render options');
    const {sampleRate=48000,stems=true}=options;
    check(integer(sampleRate,8000,96000),'Kit output needs a rate from 8000 to 96000 Hz');
    const kit=compile(raw,assets), pads=Object.entries(kit.pads), buses=Object.entries(kit.buses);
    const count=2*(buses.length+(stems ? pads.length : 1)+1);
    const capacity=Math.floor(budget/count);
    const exact=options.duration===undefined ? undefined : frame(T.read(options.duration),sampleRate,3600);
    check(exact===undefined || integer(exact,1,capacity),'Kit output duration exceeds its PCM budget');
    const clock=P.musicTiming.compile(options.map);
    const {voices,end,events:played}=perform(kit,events,sampleRate,exact ?? Infinity,clock);
    let tail=0;
    for (const [name,pad] of pads) if (voices[name].length) {
      const sendTail=Math.max(0,...pad.sends.map(([name])=>M.tail(kit.buses[name].inserts)));
      tail=Math.max(tail,M.tail(pad.inserts)+sendTail);
    }
    const length=exact ?? Math.max(1,end+Math.ceil(tail*sampleRate));
    const effort=[...pads,...buses].reduce((total,[,strip])=>total+strip.inserts.length+strip.sends.length+1,0);
    check(length<=capacity && length*effort<=64e6,'Kit output exceeds its mixer budget');
    const mix=new Float64Array(2*length), tracks={};
    const returns=Object.fromEntries(buses.map(([name])=>[name,new Float64Array(mix.length)]));
    let peak=1;
    function retain(name,data) {
      for (const sample of data) peak=Math.max(peak,Math.abs(sample));
      if (stems) tracks[name]=data;
    }
    for (const [name,pad] of pads) {
      const data=new Float64Array(mix.length);
      for (const sound of voices[name]) sound.render(data,length);
      M.process(data,sampleRate,pad.inserts);
      M.route(data,mix,returns,pad);
      retain(name,data);
    }
    for (const [name,bus] of buses) {
      const data=returns[name];
      M.process(data,sampleRate,bus.inserts);
      M.route(data,mix,returns,bus);
      retain(name,data);
    }
    for (const sample of mix) peak=Math.max(peak,Math.abs(sample));
    const audio=samples=>{
      if (peak>1) for (let i=0;i<samples.length;i++) samples[i]/=peak;
      return {sampleRate,channels:2,samples};
    };
    return {value:audio(mix),stems:Object.fromEntries(Object.entries(tracks).map(([name,data])=>[name,audio(data)])),
      report:{id:kit.id,sampleRate,frames:length,gain:1/peak,events:played}};
  }
  function route(tracks,routes) {
    check(record(tracks),'Expected performed note tracks');
    const events=[];
    for (const [name,route] of table(routes,1,64,'kit track routes')) {
      const rows=own(tracks,name);
      check(Array.isArray(rows) && rows.length+events.length<=24576 && fields(route,['pad','articulation']) &&
        (route.pad===undefined || id(route.pad)) && (route.articulation===undefined || id(route.articulation)),
      'A route needs an existing performed track and optional pad and articulation names');
      for (const row of rows) {
        check(record(row) && finite(row.time,0,3600) && finite(row.gate,0,120) && row.gate>0 &&
          integer(row.midi,0,127) && finite(row.velocity,0,1),'Invalid performed note in '+name);
        const articulation=route.articulation ?? row.play?.articulation;
        check(articulation===undefined || id(articulation),'Invalid performed note articulation');
        events.push({time:row.time,note:row.midi,duration:row.gate,velocity:row.velocity,
          ...(route.pad!==undefined && {pad:route.pad}),...(articulation!==undefined && {articulation})});
      }
    }
    return events.sort((a,b)=>a.time-b.time);
  }
  A.sampleKit=Object.freeze({render,route});
})(KIT.procedural);
