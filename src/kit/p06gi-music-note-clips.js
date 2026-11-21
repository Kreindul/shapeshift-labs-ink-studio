/* Independent, editable note lines within a production track. */
(function (P) {
  const {fields,finite,id,check}=P.musicInstruments;
  const M=P.musicMotif, H=P.musicHarmony;
  const epsilon=1e-8, round=n=>Number(n.toFixed(9));

  function clip(raw) {
    check(fields(raw,['id','beat','length','voices']) && id(raw.id) && finite(raw.beat,0,65536) &&
      finite(raw.length,.0625,256) && Array.isArray(raw.voices) && raw.voices.length>=1 && raw.voices.length<=8,
    'A note clip needs a name, beat range and one to eight named voices');
    const voices=Array.from(raw.voices,voice=>{
      check(fields(voice,['id','notes']) && id(voice.id) && Array.isArray(voice.notes) && voice.notes.length<=512,
        'A clip voice needs a name and editable notes');
      const ties=new Set();
      const events=Array.from(voice.notes,row=>{
        check(fields(row,['id','beat','duration','midi','velocity','play','tie']) && id(row.id) &&
          (row.tie===undefined || typeof row.tie==='boolean') && (!row.tie || row.play===undefined),
        'A clip note needs an ID, timing and MIDI pitch. A tie inherits its attack expression');
        const {tie,...note}=row;
        if (tie) ties.add(note.id);
        return {...note,midi:H.midi(note.midi)};
      });
      return {id:voice.id,notes:M.motif({length:raw.length,events}).events.map(({degree,...note})=>
        ({...note,...(ties.has(note.id) && {tie:true})}))};
    });
    check(new Set(voices.map(voice=>voice.id)).size===voices.length,'Note clip voice IDs must be unique');
    return P.data.freeze({id:raw.id,beat:raw.beat,length:raw.length,voices});
  }

  function rows(raw,clock,program,end) {
    check(Array.isArray(raw) && raw.length<=32,'A track can place up to 32 note clips');
    const spans=Array.from(raw,clip).sort((a,b)=>a.beat-b.beat);
    check(new Set(spans.map(row=>row.id)).size===spans.length &&
      spans.every((row,i)=>row.beat+row.length<=end+epsilon &&
        (!i || row.beat>=spans[i-1].beat+spans[i-1].length-epsilon)),
      'Note clip placements need unique IDs and nonoverlapping ranges inside the cue');
    const windows=[], notes=[], active=new Map();
    let count=0;
    for (const span of spans) {
      const from=clock.timeAt({beat:round(span.beat)}), to=clock.timeAt({beat:round(span.beat+span.length)});
      check(from>=0 && from<to,'Note clips need a positive range on the cue clock');
      windows.push({from,to});
      for (const voice of span.voices) for (const note of voice.notes) {
        check(++count<=4096,'The track exceeds its note-clip budget');
        const beat=round(span.beat+note.beat), time=clock.timeAt({beat});
        const stop=clock.timeAt({beat:round(beat+note.duration)});
        const previous=active.get(voice.id);
        if (note.tie) {
          check(previous && Math.abs(previous.end-time)<epsilon && previous.midi===note.midi && previous.velocity>0,
            'A clip tie needs an audible adjacent note with the same voice and pitch');
          check((previous.play.gate ?? 1)===1 && (previous.play.retrigger ?? 1)===1,
            'A tied clip attack needs a full gate and a single trigger');
          previous.end=stop;
          (previous.ties ??= []).push({clip:span.id,note:note.id});
          continue;
        }
        const entry={beat,time,end:stop,midi:note.midi,frequency:program.chordPitch(note.midi,time),
          velocity:note.velocity,voice:voice.id,clip:span.id,note:note.id,play:note.play ?? {}};
        notes.push(entry);
        active.set(voice.id,entry);
      }
    }
    return {windows,notes};
  }

  function overlay(base,compiled,clock) {
    if (!compiled) return base;
    const retained=[];
    for (const row of base) {
      let time=row.time;
      for (const {from,to} of compiled.windows) {
        if (to<=time+epsilon) continue;
        if (from>=row.end-epsilon) break;
        if (from>time+epsilon) retained.push({...row,time,beat:clock.sample(time).beat,end:from});
        time=Math.max(time,to);
      }
      if (time<row.end-epsilon) retained.push(time===row.time ? row : {...row,time,beat:clock.sample(time).beat});
    }
    return retained.concat(compiled.notes).sort((a,b)=>a.time-b.time);
  }
  P.musicNoteClips=Object.freeze({clip,rows,overlay});
})(KIT.procedural);
