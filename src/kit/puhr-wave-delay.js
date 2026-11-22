/* Bidirectional delay guides with pressure/flow scattering at area changes and branches. */
(function(K){
  const W=K.world, {check}=W.data, finite=Number.isFinite;
  function create(spec){
    const {nodes,segments,probes,soundSpeed,sampleRate}=spec;
    const pressure=new Float64Array(nodes.length), outward=new Float64Array(nodes.length), inputSum=new Float64Array(nodes.length);
    let entries=0, fractional=0, clamped=0, travelError=0;
    const links=segments.map(link=>{
      const desired=link.length/soundSpeed*sampleRate;
      const nearest=Math.round(desired);
      const effective=Math.max(1,Math.abs(desired-nearest)<1e-9?nearest:desired);
      const delay=Math.floor(effective), fraction=effective-delay;
      const at=entries;
      entries+=delay*2;
      check(Number.isSafeInteger(delay)&&entries<=1000000,'Wave delay lines exceed their sample storage budget');
      if(fraction)fractional++;
      if(desired<1-1e-9)clamped++;
      travelError=Math.max(travelError,Math.abs(desired-effective));
      return {...link,at,delay,slot:0,a:(1-fraction)/(1+fraction),fraction,
        transmission:Math.exp(-link.loss*link.length)};
    });
    const ring=new Float64Array(entries), allpass=new Float64Array(links.length*4);
    const received=new Float64Array(links.length*2);
    const sites=probes.map(site=>{
      if(site.node!==undefined)return site;
      const {section,ratio}=site, link=links[section];
      return {...site,link,arrivalAge:ratio*link.delay,returnAge:(1-ratio)*link.delay,
        forwardLoss:Math.exp(-link.loss*link.length*ratio),returnLoss:Math.exp(-link.loss*link.length*(1-ratio))};
    });

    function receive(link,index,offset){
      const value=ring[link.at+offset*link.delay+link.slot];
      if(!link.fraction)return value*link.transmission;
      const i=index*4+offset*2;
      const next=link.a*value+allpass[i]-link.a*allpass[i+1];
      allpass[i]=value;allpass[i+1]=next;
      return next*link.transmission;
    }

    function tap(link,offset,age,loss,atEnd){
      const at=link.at+offset*link.delay, lo=Math.floor(age);
      if(lo===link.delay)return atEnd;
      const first=ring[at+(link.slot+link.delay-lo)%link.delay]*loss;
      const fraction=age-lo;
      if(fraction===0)return first;
      const next=lo+1===link.delay?atEnd:ring[at+(link.slot+link.delay-lo-1)%link.delay]*loss;
      return first+(next-first)*fraction;
    }

    function step(sample,input,probePressure,probeFlow){
      inputSum.fill(0);
      outward.fill(0);
      for(const [i,link] of links.entries()){
        link.slot=sample%link.delay;
        const f=receive(link,i,0), b=receive(link,i,1);
        received[2*i]=f;received[2*i+1]=b;
        inputSum[link.from]+=link.y*b;
        inputSum[link.to]+=link.y*f;
      }
      for(const [i,node] of nodes.entries()){
        const level=node.source<0?0:input[node.source];
        pressure[i]=node.pressureSource?level:node.released?0:(level+2*inputSum[i])/(node.admittance+node.outside);
      }
      for(const [i,link] of links.entries()){
        const {from,to,at,slot,delay,y}=link;
        const f=received[2*i],b=received[2*i+1];
        ring[at+slot]=pressure[from]-b;
        ring[at+delay+slot]=pressure[to]-f;
        outward[from]+=y*(pressure[from]-2*b);
        outward[to]+=y*(pressure[to]-2*f);
      }
      for(const [i,site] of sites.entries()){
        if(site.node!==undefined){
          probePressure[i]=pressure[site.node];
          probeFlow[i]=outward[site.node];
          continue;
        }
        const {section,link,arrivalAge,returnAge,forwardLoss,returnLoss}=site;
        const f=tap(link,0,arrivalAge,forwardLoss,received[2*section]);
        const b=tap(link,1,returnAge,returnLoss,received[2*section+1]);
        probePressure[i]=f+b;
        probeFlow[i]=(f-b)*link.y;
      }
    }
    check(finite(travelError),'Wave delay timing exceeds range');
    return {advance:step,buffers:{rings:ring,allpass},workPerSample:3*links.length+nodes.length+sites.length,
      info:{ringSamples:entries,fractionalSegments:fractional,clampedSegments:clamped,maxSegmentTravelErrorSamples:travelError}};
  }
  W.waveDelay=create;
})(KIT);
