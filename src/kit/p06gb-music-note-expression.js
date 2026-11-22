/* Per-voice automation on the performed gate, with integrated pitch travel. */
(function (P) {
  const {fields,finite,check}=P.musicInstruments;
  const controls=Object.freeze({pressure:.5,breath:0,damping:.25,contact:.5});
  const names=Object.keys(controls);
  const limits={gainDb:[-60,12],pitchCents:[-1200,1200],cutoffHz:[40,24000],amplitude:[0,1],roughness:[0,1],brightness:[0,1],
    ...Object.fromEntries(names.map(name=>[name,[0,1]]))};

  function validate(raw) {
    check(fields(raw,Object.keys(limits)) && Object.keys(raw).length>0,'Use named per-note expression curves');
    return Object.fromEntries(Object.entries(raw).map(([name,points])=>{
      let prior=-1;
      check(Array.isArray(points) && points.length>=1 && points.length<=32,'Note curves need up to 32 points');
      return [name,Array.from(points,row=>{
        check(Array.isArray(row) && row.length===2 && finite(row[0],0,1) && row[0]>prior &&
          finite(row[1],...limits[name]),'Invalid note curve point on '+name);
        prior=row[0];
        return row.slice();
      })];
    }));
  }

  function curve(raw,gate,convert) {
    const points=raw.map(([time,value])=>[time*gate,convert(value)]);
    if (points[0][0]>0) points.unshift([0,points[0][1]]);
    let area=0;
    for (let i=0;i<points.length;i++) {
      const row=points[i], before=points[i-1];
      if (before) area+=(row[0]-before[0])*(row[1]+before[1])/2;
      row.push(area);
    }
    function value(time,integral) {
      let index=1;
      while (index<points.length && points[index][0]<=time) index++;
      const [start,first,sum]=points[index-1], stop=points[index], offset=Math.max(0,time-start);
      const current=stop ? first+(stop[1]-first)*offset/(stop[0]-start) : first;
      return integral ? sum+offset*(first+current)/2 : current;
    }
    return {value,max:Math.max(...points.map(row=>row[1]))};
  }
  function compile(raw,gate,rate) {
    if (!raw) return null;
    const pitch=raw.pitchCents && curve(raw.pitchCents,gate,n=>2**(n/1200));
    const amp=raw.gainDb && curve(raw.gainDb,gate,n=>n);
    const amplitude=raw.amplitude && curve(raw.amplitude,gate,n=>n);
    const roughness=raw.roughness && curve(raw.roughness,gate,n=>n);
    const filter=raw.cutoffHz && curve(raw.cutoffHz,gate,n=>Math.log(Math.min(n,rate*.47)));
    const motion=Object.fromEntries(names.filter(name=>raw[name]).map(name=>{
      const lane=curve(raw[name],gate,n=>n);
      return [name,t=>lane.value(t)];
    }));
    return {controls:motion,gain:(amp || amplitude) && (t=>(amplitude?.value(t) ?? 1)*10**((amp?.value(t) ?? 0)/20)),
      roughness:roughness && (t=>roughness.value(t)),
      pitchTime:pitch && (t=>pitch.value(t,true)),
      pitchRatio:pitch && (t=>pitch.value(t)),
      pitchMax:pitch?.max ?? 1,
      filter:filter && (t=>1-Math.exp(-2*Math.PI*Math.exp(filter.value(t))/rate))};
  }
  function duration(travel,span) {
    if (!travel || span===0) return span;
    let lo=0,hi=span*2;
    for (let i=0;i<38;i++) {
      const middle=(lo+hi)*.5;
      if (travel(middle)<span) lo=middle;
      else hi=middle;
    }
    return (lo+hi)*.5;
  }
  P.musicNoteExpression=Object.freeze({validate,compile,duration,controls,names});
})(KIT.procedural);
