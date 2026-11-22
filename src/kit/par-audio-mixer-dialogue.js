/* Stereo-linked dynamic EQ for sibilance and dialogue-keyed masking. */
(function (P) {
  const S=P.mediaGraphSupport,{fields,finite,check}=P.musicInstruments;
  const pole=(rate,seconds)=>-Math.expm1(-1/(rate*seconds));
  function dynamicBand(raw,rate,time) {
    const {type}=raw, deesser=type==='deesser';
    const top=Math.min(24000,rate*.47);
    const {hz=Math.min(deesser ? 6400 : 2200,rate*.36),q=deesser ? .85 : 1.1,
      keyHz=deesser ? hz : undefined,keyQ=.8,attack=deesser ? .0013 : .012,release=deesser ? .075 : .18}=raw;
    check(fields(raw,['type','wet','hz','q','keyHz','keyQ','thresholdDb','ratio','rangeDb','attack','release']) &&
      finite(hz,20,top) && finite(q,.35,12) && (keyHz===undefined || finite(keyHz,20,top)) &&
      finite(keyQ,.35,12) && finite(attack,.0001,1) && finite(release,.001,4),
    'Invalid dynamic dialogue band, detector or envelope');
    const threshold=time.lane(raw.thresholdDb,deesser ? -26 : -34,-96,0,type+' threshold'),
      ratio=time.lane(raw.ratio,deesser ? 6 : 4,1,40,type+' ratio'),
      range=time.lane(raw.rangeDb,deesser ? 8 : 5,0,24,type+' range');
    const tail=range.max===0 ? 0 : Math.max(S.parametricTail('peak',rate,hz,q,0),
      S.parametricTail('peak',rate,hz,q,-range.max));
    return {cost:24+(keyHz===undefined ? 0 : 10),tail,sidechain:!deesser,make() {
      const trigger=threshold.reader(), curve=ratio.reader(), max=range.reader();
      const open=pole(rate,attack), close=pole(rate,release), peakFall=Math.exp(-1/(rate*.009)), key=[0,0];
      const detect=keyHz===undefined ? null : S.parametricBand('bandpass',rate,()=>keyHz,()=>keyQ,()=>0);
      let gain=0, reduction=0, envelope=0;
      const apply=S.parametricBand('peak',rate,()=>hz,()=>q,()=>gain);
      return (l,r,kl,kr,t,out)=>{
        if (detect) detect(kl,kr,t,key);
        else {key[0]=kl;key[1]=kr;}
        envelope=Math.max(envelope*peakFall,Math.abs(key[0]),Math.abs(key[1]));
        const level=20*Math.log10(Math.max(1e-10,envelope));
        const limit=max(t), goal=Math.min(limit,Math.max(0,level-trigger(t))*(1-1/curve(t)));
        reduction+=(goal-reduction)*(goal>reduction ? open : close);
        if (reduction<1e-8) reduction=0;
        gain=-Math.min(limit,reduction);
        apply(l,r,t,out);
      };
    }};
  }
  S.dialogueBand=dynamicBand;
})(KIT.procedural);
