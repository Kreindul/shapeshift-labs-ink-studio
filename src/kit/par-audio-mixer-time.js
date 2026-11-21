/* Project automation points onto the same sample grid as edited clips. */
(function (P) {
  const T=P.takeTime, {fields,integer,finite,check}=P.musicInstruments;
  const units=['beats','seconds','samples'], zero=T.read(0);
  function mixerTime(rate,map) {
    const clock=P.musicTiming.compile(map), sampleRate=T.read(rate);
    const frame=time=>T.index(T.roundDown(T.mul(time,sampleRate)));
    function seconds(raw) {
      const time=T.read(raw);
      check(finite(T.seconds(time),0,3600),'Mixer position is outside the seconds range');
      return time;
    }
    function samples(raw) {
      check(integer(raw,0,rate*3600),'Mixer position needs an integer sample address');
      return T.div(T.read(raw),sampleRate);
    }
    function position(raw) {
      if (P.musicTiming.isPosition(raw)) return clock.resolve(raw);
      check(fields(raw,['samples','seconds']) && Object.keys(raw).length===1,
        'A mixer position needs samples, seconds, or a musical address');
      return raw.samples===undefined ? seconds(raw.seconds) : samples(raw.samples);
    }
    function lane(raw,fallback,low,high,label,origin) {
      if (raw===undefined || finite(raw,low,high)) {
        const value=raw ?? fallback;
        return {min:value,max:value,reader:()=>()=>value};
      }
      check(fields(raw,['unit','curve','points']) && units.includes(raw.unit) &&
        ['linear','hold'].includes(raw.curve ?? 'linear') && Array.isArray(raw.points) &&
        integer(raw.points.length,1,2048),'Invalid '+label+' value or automation lane');
      const knots=[];
      let prior=null, min=Infinity, max=-Infinity;
      for (const knot of raw.points) {
        check(fields(knot,['at','value']) && finite(knot.value,low,high),'Invalid '+label+' automation point');
        const at=T.read(knot.at);
        check(T.compare(at,zero)>=0 && (!prior || T.compare(prior,at)<0),'Automation points need increasing nonnegative positions');
        const absolute=raw.unit==='beats' ?
          (origin ? clock.offsetBeats(origin,knot.at) : clock.resolve({beat:knot.at})) :
          T.add(origin ?? zero,raw.unit==='samples' ? samples(knot.at) : seconds(knot.at));
        const sample=frame(absolute), row={sample,value:knot.value};
        check(integer(sample,-rate*3600,rate*3600),'Automation sample position exceeds the mixer range');
        if (knots.at(-1)?.sample===sample) knots[knots.length-1]=row;
        else knots.push(row);
        min=Math.min(min,knot.value);
        max=Math.max(max,knot.value);
        prior=at;
      }
      return {min,max,reader() {
        let index=0;
        return sample=>{
          while (index+1<knots.length && knots[index+1].sample<=sample) index++;
          const a=knots[index], b=knots[index+1];
          if (raw.curve==='hold' || !b || sample<=a.sample) return a.value;
          return a.value+(b.value-a.value)*(sample-a.sample)/(b.sample-a.sample);
        };
      }};
    }
    return {frame,position,lane};
  }
  P.mediaGraphSupport.mixerTime=mixerTime;
})(KIT.procedural);
