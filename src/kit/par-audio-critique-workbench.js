/* Inspect actual PCM, propose addressed repairs and audition editable candidates. */
(function (P) {
  const A=P.musicProduction, E=P.musicCritiqueEvidence, R=P.musicCritiqueReferences;
  const S=P.mediaGraphSupport, T=P.takeTime, I=P.musicInstruments;
  const {check,fields,finite,integer,id,db}=I;
  const keyFormat='ink-studio/audio-critique-comparison', eps=1e-8;
  const lanes={level:['gainDb','fadeSeconds'],eq:['hz','q','gainDb','fadeSeconds'],
    silence:['mode'],register:['semitones'],density:['value','keep'],room:['send'],
    tail:['seconds','fadeSeconds'],depth:['cutoffHz','send','fadeSeconds']};
  const scope=['range','context','lead','sampleRate'];
  const round=(n,digits=9)=>Number(n.toFixed(digits));
  const canon=value=>JSON.stringify(value,(_,entry)=>I.record(entry) ?
    Object.fromEntries(Object.keys(entry).sort().map(key=>[key,entry[key]])) : entry);
  const digest=value=>{
    const text=canon(value);
    return P.data.hash(text).toString(36)+'-'+P.data.hash(text,0x9e3779b9).toString(36);
  };

  function placement(score,rate,raw) {
    check(fields(raw,['from','to']) && I.record(raw.from) && I.record(raw.to),'Choose a listening range with two addresses');
    const map=score.arrangement.score.tempoMap, clock=S.mixerTime(rate,map);
    const read=position=>{
      const value=clock.position(position), time=T.seconds(value);
      check(finite(time,0,score.end+eps),'Listening address is outside the production');
      return {beat:round(score.clock.sample(Math.min(time,score.end)).beat),frame:clock.frame(value)};
    };
    const a=read(raw.from), b=read(raw.to);
    check(b.frame-a.frame>=8,'Listening range needs at least eight samples');
    return {fromBeat:a.beat,toBeat:b.beat,firstSample:a.frame,endSample:b.frame,start:a.frame/rate,end:b.frame/rate};
  }

  function requestRange(score,raw) {
    const {range,context={},sampleRate=24000,lead}=raw;
    check(integer(sampleRate,8000,48000) && fields(context,['beforeBeats','afterBeats']) &&
      finite(context.beforeBeats ?? 1,0,32) && finite(context.afterBeats ?? 1,0,32) &&
      (lead===undefined || id(lead) && Object.hasOwn(score.tracks,lead)),'Invalid critique preview context, clock or lead');
    const focus=placement(score,sampleRate,range), endBeat=score.arrangement.sections.at(-1).end;
    const fromBeat=round(Math.max(0,focus.fromBeat-(context.beforeBeats ?? 1)));
    const toBeat=round(Math.min(endBeat,focus.toBeat+(context.afterBeats ?? 1)));
    const around=E.address(score,sampleRate,fromBeat,toBeat);
    const firstSample=Math.min(around.firstSample,focus.firstSample), endSample=Math.max(around.endSample,focus.endSample);
    const span={...around,firstSample,endSample,start:firstSample/sampleRate,end:endSample/sampleRate};
    check(span.end-span.start<=30,'Critique context can span up to thirty seconds');
    const tracks=Object.keys(score.tracks);
    const hook=lead ?? tracks.find(name=>score.arrangement.parts[name].role==='lead' && score.events[name].some(note=>
      note.velocity>0 && note.time<focus.end && note.time+note.gate>focus.start));
    return {focus,span,rate:sampleRate,lead:hook,rivals:tracks.filter(name=>name!==hook)};
  }

  function render(score,{span,rate}) {
    const start=(span.firstSample+.25)/rate, end=Math.min(score.end,(span.endSample+.25)/rate);
    const rendered=A.renderCompiled(score,{start,end,sampleRate:rate,stems:true},false,score.end);
    check(rendered.report.firstSample===span.firstSample && rendered.report.endSample===span.endSample,
      'The production render must match the addressed sample range');
    return rendered;
  }

  function slice(input,span,part) {
    return E.segment(input,part.firstSample-span.firstSample,part.endSample-span.firstSample);
  }
  const stats=(audio,span)=> {
    const measured=E.stats(audio);
    return {...measured,peakSample:measured.peakOffset===null ? null : span.firstSample+measured.peakOffset};
  };
  const addressed=row=>({from:{beat:row.fromBeat},to:{beat:row.toBeat}});
  const clipScale=(pcm,gain)=>({...pcm,samples:pcm.samples.map(sample=>sample*gain)});

  function issues(report,lead) {
    const found=[];
    for (const {range,mix,masking} of report.windows) {
      if (range.firstSample<report.focus.firstSample || range.endSample>report.focus.endSample) continue;
      if ((mix.truePeakDbTP ?? -100)>=0) found.push({
        id:'peak-'+range.firstSample,kind:'peak',range,sample:mix.peakSample,truePeakDbTP:mix.truePeakDbTP,
        clippedFrames:mix.clippedFrames,priority:2+(mix.truePeakDbTP/12),
        suggestion:{op:'level',range:addressed(range),gainDb:round(Math.max(-18,-1.2-mix.truePeakDbTP),2)}
      });
      if (mix.monoNull || (mix.monoLossDb ?? 0)<-6) found.push({
        id:'mono-'+range.firstSample,kind:'mono-loss',range,correlation:mix.correlation,
        monoLossDb:mix.monoLossDb,priority:1.25
      });
      if (lead) for (const {track,overlap,coverage,bands} of masking) {
        if (overlap<.35 || coverage<.50) continue;
        const power=band=>Math.min(band.leadDbFS,band.otherDbFS ?? -200);
        const best=bands.reduce((a,b)=>power(a)>=power(b) ? a : b);
        found.push({id:'mask-'+digest([track,range.firstSample]),kind:'band-overlap',range,lead,track,
          centerHz:best.centerHz,overlap,coverage,otherOverLeadDb:best.otherOverLeadDb,priority:overlap,
          suggestion:{op:'eq',range:addressed(range),parts:[track],hz:best.centerHz,q:1.15,gainDb:-5,fadeSeconds:.024}});
      }
    }
    return found.sort((a,b)=>b.priority-a.priority || a.range.firstSample-b.range.firstSample || a.id.localeCompare(b.id))
      .slice(0,16).map(({priority,...row})=>row);
  }

  function noteAddresses(score,focus,rate) {
    return Object.fromEntries(Object.entries(score.events).flatMap(([part,events])=>{
      const seen=new Set(), rows=[];
      for (const {clip,voice,note,time,start,gate,midi,velocity,beat} of events) {
        if (!clip || !velocity || (start ?? time)>=focus.end || time+gate<=focus.start) continue;
        const key=JSON.stringify([clip,voice,note]);
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({clip,voice,note,beat,midi,velocity,startSample:Math.ceil((start ?? time)*rate-eps),
          endSample:Math.ceil((time+gate)*rate-eps)});
        if (rows.length===64) break;
      }
      return rows.length ? [[part,rows]] : [];
    }));
  }

  function view(rendered,row,range,trackNames) {
    check(fields(row,['id','mode','tracks','span']) && id(row.id) &&
      ['mix','mono','solo','without'].includes(row.mode) && ['focus','context'].includes(row.span ?? 'focus'),
    'Invalid critique monitoring view');
    const {mode,tracks}=row, pick=row.span==='context' ? range.span : range.focus;
    const synth=mode==='solo' || mode==='without';
    check(synth ? Array.isArray(tracks) && integer(tracks.length,1,trackNames.length) &&
      new Set(tracks).size===tracks.length && Array.from(tracks).every(name=>trackNames.includes(name)) :
      tracks===undefined,'Choose known stems for a solo or mix-minus view');
    if (mode==='solo' && tracks.length===1) return slice(rendered.stems[tracks[0]],range.span,pick);
    const mix=slice(rendered.value,range.span,pick);
    if (mode==='mix') return mix;
    if (mode==='mono') return {...mix,channels:1,samples:Float32Array.from({length:mix.samples.length/2},
      (_,i)=>(mix.samples[i*2]+mix.samples[i*2+1])*.5)};
    const offset=(pick.firstSample-range.span.firstSample)*2;
    const samples=mode==='solo' ? new Float32Array(mix.samples.length) : mix.samples;
    for (const track of tracks) {
      const stem=rendered.stems[track].samples;
      for (let i=0;i<samples.length;i++) samples[i]+=(mode==='solo' ? 1 : -1)*stem[i+offset];
    }
    return {...mix,samples};
  }

  function revision(source,score,raw,review) {
    check(fields(raw,['id','label','edits']) && id(raw.id) && raw.id!=='reference' &&
      R.prose(raw.label ?? raw.id,160) && Array.isArray(raw.edits) && integer(raw.edits.length,1,16),
    'A critique candidate needs a label and one to sixteen edits');
    const tracks={}, cueMap={...source.cueMap};
    let changedCue=false;
    for (const edit of raw.edits) {
      const {op,range,parts}=edit ?? {};
      if (op==='note') {
        check(fields(edit,['op','part','clip','voice','note','set']) && id(edit.part) &&
          Object.hasOwn(score.tracks,edit.part) && fields(edit.set,['beat','duration','midi','velocity','play','tie']) &&
          Object.keys(edit.set).length,'Invalid critique note edit');
        const {part,clip,voice,note,set}=edit;
        check(score.events[part].some(row=>row.clip===clip && row.voice===voice && row.note===note &&
          row.time<review.span.end && row.time+row.gate>review.span.start),'The note must sound inside the audition context');
        const clips=P.musicNoteClips.edit(tracks[part]?.clips ?? source.tracks[part].clips,{clip,voice,note},set);
        tracks[part]={clips};
        continue;
      }
      check(typeof op==='string' && Object.hasOwn(lanes,op) && fields(edit,['op','range','parts',...lanes[op]]),
        'Use an addressed level, EQ, silence, register, density, room, tail, depth or note edit');
      const where=range===undefined ? review.focus : placement(score,review.rate,range);
      check(where.firstSample>=review.span.firstSample && where.endSample<=review.span.endSample,
        'A critique edit must stay inside the audition context');
      const values=Object.fromEntries(lanes[op].filter(key=>Object.hasOwn(edit,key)).map(key=>[key,edit[key]]));
      const row={from:where.fromBeat,to:where.toBeat,...(parts!==undefined && {parts}),...values};
      cueMap[op]=[...cueMap[op] ?? [],row];
      changedCue=true;
    }
    return {id:raw.id,...(changedCue && {cueMap}),...(Object.keys(tracks).length && {tracks})};
  }

  function targets(raw,score,review) {
    check(Array.isArray(raw) && raw.length<=8,'Compare up to eight foreground moments');
    const known=Object.keys(score.tracks), seen=new Set();
    const parts=list=>Array.isArray(list) && list.length<=known.length &&
      new Set(list).size===list.length && Array.from(list).every(part=>known.includes(part));
    return Array.from(raw,row=>{
      check(fields(row,['id','range','parts','rivals']) && id(row.id) && !seen.has(row.id) && parts(row.parts) &&
        row.parts.length>0 && parts(row.rivals ?? []) && (row.rivals ?? []).every(part=>!row.parts.includes(part)),
      'A comparison moment needs distinct named foreground and rival tracks');
      seen.add(row.id);
      const range=placement(score,review.rate,row.range);
      check(range.firstSample>=review.span.firstSample && range.endSample<=review.span.endSample,
        'A comparison moment must fit the audition context');
      return {id:row.id,range,parts:row.parts,rivals:row.rivals ?? []};
    });
  }

  function momentMeters(rendered,span,moments) {
    const dbfs=power=>power>0 ? round(10*Math.log10(power),3) : null;
    return moments.map(({id,range,parts,rivals})=>{
      const from=2*(range.firstSample-span.firstSample), to=2*(range.endSample-span.firstSample);
      const power=names=>names.reduce((sum,name)=>{
        const {samples}=rendered.stems[name];
        let energy=0;
        for (let i=from;i<to;i++) energy+=samples[i]**2;
        return sum+energy/(to-from);
      },0);
      const foreground=power(parts), competing=power(rivals);
      return {id,range,parts,rivals,foregroundDbFS:dbfs(foreground),rivalDbFS:dbfs(competing),
        foregroundOverRivalsDb:foreground>0 && competing>0 ? dbfs(foreground/competing) : null,
        roomDbFS:dbfs(power(['room']))};
    });
  }

  const sourceStamp=(source,assets)=>digest([source,Object.keys(source.tracks ?? {}),R.assetSignature(assets)]);

  function open(input,assets={}) {
    const source=P.data.clone(input), score=A.compile(source,assets);
    let last;
    function baseline(review) {
      const key=JSON.stringify([review.rate,review.span.firstSample,review.span.endSample]);
      if (last?.key!==key) last={key,rendered:render(score,review)};
      return last.rendered;
    }
    const evidence=(compiled,review,rendered)=>E.measure(compiled,review.span,review.focus,review.lead,review.rivals,review.rate,rendered).report;
    function inspect(raw) {
      check(fields(raw,[...scope,'views','ceiling']) && finite(raw.ceiling ?? -1,-12,-.1),'Invalid audio critique probe');
      const review=requestRange(score,raw), rendered=baseline(review), measured=evidence(score,review,rendered);
      const views=raw.views ?? [{id:'focus',mode:'mix'},{id:'context',mode:'mix',span:'context'},
        {id:'mono',mode:'mono'},...(review.lead ? [{id:'lead',mode:'solo',tracks:[review.lead]}] : [])];
      check(Array.isArray(views) && integer(views.length,1,16) &&
        new Set(Array.from(views,row=>row?.id)).size===views.length,'Monitor up to sixteen distinct listening views');
      const audio=Object.fromEntries(Array.from(views,row=>[row?.id,view(rendered,row,review,Object.keys(rendered.stems))]));
      const peak=Math.max(...Object.values(audio).map(pcm=>S.mixerPeak.peak(pcm.samples,pcm.channels)));
      const gain=Math.min(1,db(raw.ceiling ?? -1)/Math.max(peak,1e-10));
      return {audio:Object.fromEntries(Object.entries(audio).map(([key,pcm])=>[key,clipScale(pcm,gain)])),
        report:{...measured,previewGain:gain,lead:review.lead ?? null,issues:issues(measured,review.lead),
          notes:noteAddresses(score,review.focus,review.rate),clips:views.map(row=>({...row,
            range:row.span==='context' ? review.span : review.focus}))}};
    }

    function compare(raw) {
      check(fields(raw,[...scope,'candidates','level','target','ceiling','targets']) &&
        ['matched','fixed'].includes(raw.level ?? 'matched') && finite(raw.target ?? -18,-35,-9) &&
        finite(raw.ceiling ?? -1,-12,-.1) && Array.isArray(raw.candidates) && integer(raw.candidates.length,0,6) &&
        new Set(Array.from(raw.candidates,row=>row?.id)).size===raw.candidates.length,'Invalid audio critique comparison');
      const review=requestRange(score,raw);
      check((review.span.endSample-review.span.firstSample)*(raw.candidates.length+1)*(review.rivals.length+3)*2<=48e6,
        'Critique comparison exceeds the combined listening sample budget');
      const rows=[], blocked=[], moments=targets(raw.targets ?? [],score,review);
      function analyze(compiled,rendered,entry) {
        const measured=evidence(compiled,review,rendered);
        const clip=slice(rendered.value,review.span,review.focus);
        const focusWindows=measured.windows.filter(({range})=>
          range.firstSample>=review.focus.firstSample && range.endSample<=review.focus.endSample);
        return {...entry,pcm:rendered.value,mix:measured.mix,focus:stats(clip,review.focus),focusWindows,
          issues:issues(measured,review.lead),...(moments.length && {moments:momentMeters(rendered,review.span,moments)})};
      }
      const original=baseline(review);
      rows.push(analyze(score,original,{id:'reference',label:'Original'}));
      for (const candidate of raw.candidates) {
        try {
          const change=revision(source,score,candidate,review), production=A.revise(source,change,assets);
          const compiled=A.compile(production,assets), rendered=render(compiled,review);
          let power=0;
          for (let i=0;i<rendered.value.samples.length;i++)
            power+=(rendered.value.samples[i]-original.value.samples[i])**2;
          rows.push(analyze(compiled,rendered,{id:change.id,label:candidate.label ?? change.id,revision:change,
            differenceRms:round(Math.sqrt(power/rendered.value.samples.length))}));
        } catch (error) {
          if (!(error instanceof RangeError)) throw error;
          blocked.push({id:candidate?.id ?? null,reason:error.message});
        }
      }
      const level=raw.level ?? 'matched', ceiling=raw.ceiling ?? -1;
      const peaks=rows.map(row=>row.mix.truePeakDbTP ?? -200);
      const target=level==='matched' ? Math.min(raw.target ?? -18,...rows.map((row,i)=>row.mix.integratedLufs===null ?
        raw.target ?? -18 : row.mix.integratedLufs+ceiling-peaks[i])) : null;
      const shared=Math.min(0,ceiling-Math.max(...peaks));
      const audio={}, takes=rows.map(({pcm,revision,...row})=>{
        const gainDb=target!==null && row.mix.integratedLufs!==null ? target-row.mix.integratedLufs : shared;
        audio[row.id]=clipScale(pcm,db(gainDb));
        return {...row,previewGainDb:round(gainDb,6),previewLufs:row.mix.integratedLufs===null ? null :
          round(row.mix.integratedLufs+gainDb,3)};
      });
      const report={sampleRate:review.rate,context:review.span,focus:review.focus,lead:review.lead ?? null,level,target,takes,blocked};
      const content={format:keyFormat,version:1,source:sourceStamp(source,assets),report,
        candidates:rows.filter(row=>row.revision).map(({id,label,revision})=>({id,label,revision}))};
      return {audio,report,key:{...content,token:'edit-'+digest(content)}};
    }
    return Object.freeze({inspect,compare});
  }

  function apply(source,key,decision,assets={}) {
    check(fields(key,['format','version','source','report','candidates','token']) && key.format===keyFormat && key.version===1 &&
      Array.isArray(key.candidates) && integer(key.candidates.length,1,6),'Open a critique comparison with auditioned edits');
    const {token,...content}=key;
    check(token==='edit-'+digest(content) && key.source===sourceStamp(source,assets),
      'The comparison needs its original production and audio assets');
    check(fields(decision,['token','take','reason','id','title','tags']) && decision.token===token && id(decision.take) &&
      id(decision.id ?? decision.take) && R.prose(decision.reason,2000),'Choose an auditioned take and record a reason');
    const choice=key.candidates.find(row=>row.id===decision.take);
    check(choice && R.prose(decision.title ?? choice.label,160),'Choose a valid comparison take and title');
    const production=A.revise(source,choice.revision,assets);
    return {production,revision:choice.revision,reference:{format:R.decisionFormat,version:1,
      id:decision.id ?? choice.id,title:decision.title ?? choice.label,tags:R.tags(decision.tags ?? []),
      reason:decision.reason,range:key.report.context,focus:key.report.focus,token,move:choice.id,take:choice.id,
      revision:choice.revision}};
  }

  P.musicCritiqueWorkbench=Object.freeze({open,apply});
})(KIT.procedural);
