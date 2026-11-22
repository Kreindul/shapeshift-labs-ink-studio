/* Turn mix measurements into editable comparisons, then remember an explicit listening decision. */
(function (P) {
  const A=P.musicProduction, E=P.musicCritiqueEvidence, R=P.musicCritiqueReferences;
  const {fields,integer,finite,id,check,record}=P.musicInstruments;
  const planFormat='ink-studio/critique-plan', testFormat='ink-studio/blind-listening', keyFormat='ink-studio/blind-listening-key';
  const hookMoves=['mute-layer','move-register','mix-cut'], arrivalMoves=['delay-bass','empty-beat'];
  const criteria=['groove','identity','shape','replay'];
  const round=value=>Number(value.toFixed(8));
  const frozen=value=>P.data.freeze(P.data.clone(value));
  const active=(score,track,range)=>score.events[track].some(row=>row.velocity>0 &&
    row.time<range.end && row.time+row.gate>range.start);
  const pitched=role=>role==='pad' || role==='lead';

  function plan(source,brief,assets={}) {
    check(fields(brief,['section','goal','kind','lead','layer','bass','leadInBeats','focusBeats',
      'offsetBeats','withholdBeats','octave','cutDb','sampleRate','tags','references']) && id(brief.section) &&
      R.prose(brief.goal,640) && ['hook','arrival','both'].includes(brief.kind ?? 'both') &&
      finite(brief.leadInBeats ?? 2,0,16) && finite(brief.focusBeats ?? 4,.25,16) &&
      finite(brief.offsetBeats ?? 0,0,64) && finite(brief.withholdBeats ?? 1,.125,8) &&
      [-12,12].includes(brief.octave ?? -12) && finite(brief.cutDb ?? -3,-12,-.25) &&
      integer(brief.sampleRate ?? 24000,8000,48000),'Invalid mix critique brief');
    const {section:name,goal,kind='both',leadInBeats=2,focusBeats=4,offsetBeats=0,
      withholdBeats=1,octave=-12,cutDb=-3,sampleRate=24000}=brief;
    const tags=R.tags(brief.tags ?? []), score=A.compile(source,assets);
    const references=R.search(brief.references ?? [],{tags,limit:8})
      .map(({entry,kind})=>({id:entry.id,title:entry.title,kind,tags:entry.tags,
        note:entry.note ?? entry.reason,...(entry.move && {move:entry.move})}));
    const section=score.arrangement.sections.find(row=>row.id===name);
    check(section && section.beat+offsetBeats<section.end,'Critique needs a focus inside a named section');
    const fromBeat=round(section.beat+offsetBeats), toBeat=round(Math.min(section.end,fromBeat+focusBeats));
    const focus=E.address(score,sampleRate,fromBeat,toBeat);
    const context=E.address(score,sampleRate,round(Math.max(0,fromBeat-leadInBeats)),toBeat);
    check(context.end-context.start<=30 && focus.endSample-focus.firstSample>=8,
      'Critique needs a render context of up to thirty seconds');
    const names=Object.keys(score.tracks), role=name=>score.arrangement.parts[name]?.role;
    const lead=brief.lead ?? names.find(name=>role(name)==='lead' && active(score,name,focus));
    const bass=brief.bass ?? names.find(name=>role(name)==='bass' && active(score,name,context));
    check((lead===undefined || names.includes(lead) && pitched(role(lead))) &&
      (bass===undefined || names.includes(bass) && role(bass)==='bass') &&
      (brief.layer===undefined || names.includes(brief.layer) && pitched(role(brief.layer)) && brief.layer!==lead),
    'Choose distinct existing lead, competing pitched layer and bass tracks');
    const rivals=names.filter(name=>name!==lead && active(score,name,focus));
    const measurement=E.measure(score,context,focus,lead,rivals,sampleRate);
    const focusRows=measurement.report.windows.filter(row=>row.range.fromBeat>=fromBeat && row.range.toBeat<=toBeat);
    const competing=Object.fromEntries(rivals.filter(name=>pitched(role(name))).map(name=>[name,
      focusRows.reduce((total,row)=>total+(row.masking.find(candidate=>candidate.track===name)?.overlap ?? 0),0)]));
    const layer=brief.layer ?? Object.keys(competing).sort((a,b)=>competing[b]-competing[a] || a.localeCompare(b))[0];
    const moves=[...(kind==='arrival' ? [] : hookMoves),...(kind==='hook' ? [] : arrivalMoves)];
    const preferred=references.find(row=>moves.includes(row.move))?.move;
    if (preferred) moves.unshift(...moves.splice(moves.indexOf(preferred),1));
    const blocked=[], takes=[];
    const bounds={from:fromBeat,to:toBeat};
    const expect=(track,range)=>track && active(score,track,E.address(score,sampleRate,range.from,range.to));
    for (const move of moves) {
      let lane, row, hypothesis, track=layer;
      if (hookMoves.includes(move)) {
        if (!lead || !expect(lead,bounds) || !expect(layer,bounds)) {
          blocked.push({move,reason:'This comparison needs an active hook and competing track in the focus.'});
          continue;
        }
        if (move==='mute-layer') {
          lane='silence'; row={...bounds,parts:[layer],mode:'cut'};
          hypothesis='Cut '+layer+' in the focus to hear how exposed the hook can become.';
        } else if (move==='move-register') {
          lane='register'; row={...bounds,parts:[layer],semitones:octave};
          hypothesis='Move '+layer+' '+(octave<0 ? 'down' : 'up')+' an octave during the focus.';
          if (!score.events[layer].some(note=>note.beat>=fromBeat && note.beat<toBeat)) {
            blocked.push({move,reason:'Register edits require a note starting inside the focus.'});
            continue;
          }
        } else {
          lane='level'; row={...bounds,parts:[layer],gainDb:cutDb,fadeSeconds:.025};
          hypothesis='Reduce '+layer+' by '+Math.abs(cutDb)+' dB during the focus.';
        }
      } else if (move==='delay-bass') {
        track=bass;
        lane='silence'; row={from:context.fromBeat,to:round(Math.min(toBeat,fromBeat+withholdBeats)),parts:[bass],mode:'ring'};
        if (!expect(bass,row) || !score.events[bass].some(note=>note.time>=focus.start &&
            note.time<E.address(score,sampleRate,row.from,row.to).end)) {
          blocked.push({move,reason:'The bass needs an onset at the arrival for a delayed entry comparison.'});
          continue;
        }
        hypothesis='Withhold '+bass+' into the arrival and let the existing room ring.';
      } else {
        track=null;
        if (fromBeat-context.fromBeat<1-1e-8) {
          blocked.push({move,reason:'A full lead-in beat is needed for an empty-beat comparison.'});
          continue;
        }
        lane='silence'; row={from:round(fromBeat-1),to:fromBeat,mode:'cut'};
        const lastBeat=E.address(score,sampleRate,row.from,row.to);
        const first=(lastBeat.firstSample-context.firstSample)*2, end=(lastBeat.endSample-context.firstSample)*2;
        if (!measurement.value.samples.subarray(first,end).some(sample=>Math.abs(sample)>.0003)) {
          blocked.push({move,reason:'The final lead-in beat is already quiet in the rendered mix.'});
          continue;
        }
        hypothesis='Clear the final lead-in beat, including the room, before the full arrangement returns.';
      }
      const cueMap={...source.cueMap,[lane]:[...source.cueMap?.[lane] ?? [],row]};
      const revision={cueMap};
      try {
        A.revise(source,revision,assets);
        takes.push({id:move,hypothesis,components:[{id:move,summary:hypothesis,revision}]});
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        blocked.push({move,track,reason:error.message});
      }
    }
    const session=A.planProducer(source,{section:name,goal,strategies:[],takes},assets);
    return frozen({format:planFormat,version:1,session,tracks:{lead:lead ?? null,layer:layer ?? null,bass:bass ?? null,rivals},
      tags,references,blocked,evidence:measurement.report});
  }

  function shuffle(rows,seed) {
    const result=rows.slice();
    let state=seed>>>0;
    for (let i=result.length-1;i>0;i--) {
      state=(Math.imul(state,1664525)+1013904223)>>>0;
      const other=Math.floor(state/2**32*(i+1));
      [result[i],result[other]]=[result[other],result[i]];
    }
    return result;
  }

  function assetSignature(assets) {
    return Object.keys(assets).sort().map(name=>{
      const {samples,channels,sampleRate}=P.mediaGraph.audio(assets[name]);
      return [name,sampleRate,channels,samples.length,R.audioHash(samples)];
    });
  }

  function blind(source,planned,assets={},options={}) {
    check(planned?.format===planFormat && planned.version===1 && Array.isArray(planned.session?.takes) &&
      planned.session.takes.length>=2 && fields(options,['id','seed','target','ceiling']) &&
      id(options.id ?? 'listening-test') && Number.isSafeInteger(options.seed ?? 0),
    'Blind listening needs at least one editable alternative and a valid test ID and seed');
    const {id:name='listening-test',seed=0,target=-18,ceiling=-1.2}=options;
    const {sampleRate,context,focus}=planned.evidence ?? {};
    const score=A.compile(source,assets), {lead,layer,bass,rivals}=planned.tracks ?? {};
    const endBeat=score.arrangement.sections.at(-1).end;
    check(integer(sampleRate,8000,48000) && [context,focus].every(row=>record(row) &&
      finite(row.fromBeat,0,endBeat) && finite(row.toBeat,row.fromBeat,endBeat) && row.toBeat>row.fromBeat) &&
      Array.isArray(rivals) && rivals.length<=8,'Invalid planned listening ranges or tracks');
    for (const part of [lead,layer,bass,...rivals]) check(!part || Object.hasOwn(score.tracks,part),'Unknown evidence track');
    const range=E.address(score,sampleRate,context.fromBeat,context.toBeat);
    const observed=E.address(score,sampleRate,focus.fromBeat,focus.toBeat);
    const sameAddress=(a,b)=>Object.keys(b).every(name=>a[name]===b[name]);
    check(sameAddress(context,range) && sameAddress(focus,observed) &&
      focus.start>=context.start && focus.end<=context.end && focus.end>focus.start,
    'The listening ranges must match the original score');
    const {takes,report}=A.reviewProducer(source,planned.session,assets,{start:score.clock.timeAt({beat:context.fromBeat}),
      end:score.clock.timeAt({beat:context.toBeat}),sampleRate,target,ceiling,focus:[]});
    const order=shuffle(takes,seed), labels=Object.fromEntries(order.map((row,i)=>[String.fromCharCode(97+i),row.id]));
    const keys=Object.keys(labels), pairs=keys.flatMap((first,i)=>keys.slice(i+1).map(second=>[first,second]));
    const trials=shuffle(pairs,seed^0x44f9d9).map((pair,i)=>({id:'pair-'+(i+1),takes:shuffle(pair,seed+i*307+19)}));
    const signature=assetSignature(assets);
    const stamp=JSON.stringify([name,seed,planned.session,context,focus,sampleRate,target,ceiling,signature]);
    const token='test-'+P.data.hash(stamp).toString(36)+'-'+P.data.hash(stamp,0x9e3779b9).toString(36);
    const audio=Object.fromEntries(keys.map((label,i)=>[label,order[i].value]));
    const measured=E.measure(score,context,focus,lead,rivals,sampleRate);
    const evidence=E.snippets(measured,lead,layer,bass);
    const test=frozen({format:testFormat,version:1,id:name,token,range,focus:observed,sampleRate,
      lufs:report.target,criteria,trials,labels:keys});
    const key=frozen({format:keyFormat,version:1,test,labels,session:planned.session,tags:planned.tags,assets:signature});
    return {test,key,audio,evidence:{...evidence,report:measured.report}};
  }

  function keep(source,key,selection,assets={}) {
    check(fields(key,['format','version','test','labels','session','tags','assets']) && key.format===keyFormat &&
      key.version===1 && key.test?.format===testFormat && key.test.version===1 && record(key.labels) &&
      R.prose(key.session?.goal,640) && Array.isArray(key.session.takes) &&
      Array.isArray(key.test.trials) && key.test.trials.length<=28 && key.test.trials.every(row=>
        id(row.id) && row.takes?.length===2 && row.takes[0]!==row.takes[1] &&
        row.takes.every(label=>Object.hasOwn(key.labels,label))),
    'Open the private key from a blind listening test');
    const title=selection?.title ?? key.session.goal.slice(0,160);
    check(fields(selection,['token','take','reason','votes','tags','id','title']) && selection.token===key.test.token &&
      Object.hasOwn(key.labels,selection.take) && R.prose(selection.reason,2000) &&
      Array.isArray(selection.votes) && integer(selection.votes.length,1,256) &&
      id(selection.id ?? key.test.id) && R.prose(title,160),
    'Record the test token, chosen label, votes and a listening reason');
    check(JSON.stringify(key.assets)===JSON.stringify(assetSignature(assets)),'Recorded listening decision needs its original audio assets');
    const tags=R.tags(selection.tags ?? key.tags ?? []);
    const counts=Object.fromEntries(Object.keys(key.labels).map(label=>[label,Object.fromEntries(criteria.map(name=>[name,0]))]));
    const ballots=new Set();
    const votes=Array.from(selection.votes,row=>{
      check(fields(row,['trial','listener','preferences']) && id(row.trial) && id(row.listener) &&
        fields(row.preferences,criteria) && Object.keys(row.preferences).length,
      'A vote needs a trial, listener and at least one preference');
      const trial=key.test.trials.find(trial=>row.trial===trial.id);
      const mark=row.listener+':'+row.trial;
      check(trial && !ballots.has(mark),'Vote once per listener and trial');
      ballots.add(mark);
      for (const [criterion,label] of Object.entries(row.preferences)) {
        check(label==='tie' || trial.takes.includes(label),'Vote for either take in this pair or a tie');
        if (label!=='tie') counts[label][criterion]++;
      }
      return row;
    });
    check(Object.values(counts[selection.take]).some(value=>value>0),'The selected take needs at least one recorded preference');
    const move=key.labels[selection.take], chosen=key.session.takes.find(row=>row.id===move);
    check(chosen,'The chosen blind label has no producer take');
    const result=A.keepProducer(source,key.session,{keep:chosen.components.map(row=>({take:move,component:row.id})),
      reason:selection.reason,listened:[key.test.id]},assets);
    const reference=frozen({format:R.decisionFormat,version:1,id:selection.id ?? key.test.id,
      title,tags,reason:selection.reason,range:key.test.range,focus:key.test.focus,
      token:selection.token,move,take:selection.take,hypothesis:chosen.hypothesis,revision:result.revision,votes,counts});
    return {...result,producerReference:result.reference,reference};
  }

  P.musicProduction=Object.freeze({...A,critique:Object.freeze({plan,blind,keep,tagReference:R.tag,findReferences:R.search})});
})(KIT.procedural);
