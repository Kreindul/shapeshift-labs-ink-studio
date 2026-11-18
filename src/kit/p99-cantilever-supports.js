/* Fit bearing sites to a convex footprint and build closed support profiles. */
(function(K){
  const P=K.procedural||K.authoring,{V}=K,EPS=1e-7;
  const vector=(p,size)=>Array.isArray(p)&&p.length===size&&Array.from(p).every(Number.isFinite);
  const positive=n=>Number.isFinite(n)&&n>EPS;
  const profileDefault=[[-1,1],[1,1],[1,-.20],[.08,-1],[-1,-1]];

  function footprint(outline){
    if(!Array.isArray(outline)||outline.length<3||outline.length>256||!Array.from(outline).every(p=>vector(p,2)))
      throw Error('Cantilever fitting needs a finite convex XZ outline');
    const area=outline.reduce((sum,a,i)=>{
      const b=outline[(i+1)%outline.length];
      return sum+a[0]*b[1]-b[0]*a[1];
    },0);
    const direction=Math.sign(area);
    if(!Number.isFinite(area)||Math.abs(area)<EPS)throw Error('The bearing footprint needs area');
    return outline.map((a,i)=>{
      const b=outline[(i+1)%outline.length],x=b[0]-a[0],z=b[1]-a[1],length=Math.hypot(x,z);
      if(length<EPS)throw Error('The bearing footprint has a repeated edge');
      const normal=[direction*z/length,0,-direction*x/length],offset=normal[0]*a[0]+normal[2]*a[1];
      if(outline.some(p=>p[0]*normal[0]+p[1]*normal[2]>offset+EPS))
        throw Error('The bearing footprint must be convex');
      return {normal,offset};
    });
  }

  function exit(planes,point,out,seat){
    let low=-Infinity,high=Infinity;
    for(const {normal,offset} of planes){
      const remaining=offset-V.dot(point,normal),slope=V.dot(out,normal);
      if(Math.abs(slope)<EPS){if(remaining<-EPS)return 0;continue;}
      if(slope>0)high=Math.min(high,remaining/slope);
      else low=Math.max(low,remaining/slope);
    }
    return low<=-seat+EPS&&high>=0?high:0;
  }

  function sites({path,outline,spacing=.85,width=.18,seat=.075,minReach=.24,maxReach=1.6,
    outward=1,maxSites=512}={}){
    if(!Array.isArray(path)||path.length<2||path.length>257||!Array.from(path).every(p=>vector(p,3))||
        ![spacing,width,seat,minReach,maxReach].every(positive)||maxReach<minReach||
        ![1,-1].includes(outward)||!Number.isInteger(maxSites)||maxSites<1||maxSites>4096)
      throw Error('Support sites need a finite wall run and positive spacing, seat, width and reach');
    const planes=footprint(outline),segments=[];
    let length=0;
    for(let i=1;i<path.length;i++){
      const a=path[i-1],delta=V.sub(path[i],a),run=Math.hypot(delta[0],delta[2]);
      if(run<EPS)throw Error('Each bearing segment needs a horizontal run');
      const tangent=[delta[0]/run,0,delta[2]/run];
      segments.push({a,delta,run,end:length+run,tangent,out:[outward*tangent[2],0,-outward*tangent[0]]});
      length+=run;
    }
    const count=Math.ceil(length/spacing);
    if(count>maxSites)throw Error('Bearing run exceeds its site budget');
    if(length<width)return [];
    const result=[];
    for(let i=0,segment=0;i<count;i++){
      const distance=width/2+(length-width)*(i+.5)/count;
      while(distance>segments[segment].end)segment++;
      const {a,delta,run,end,tangent,out}=segments[segment],point=V.mad(a,delta,1+(distance-end)/run);
      const reach=Math.min(maxReach,exit(planes,V.mad(point,tangent,-width/2),out,seat),
        exit(planes,V.mad(point,tangent,width/2),out,seat));
      if(reach>=minReach)result.push({index:i,point,tangent,out,reach});
    }
    return result;
  }

  function bracket(site,{width=.18,drop=.62,embed=.07,overlap=.06,profile=profileDefault}={},meta={}){
    if(!vector(site?.point,3)||!vector(site?.tangent,3)||!vector(site?.out,3)||
      ![site.reach,width,drop,embed,overlap].every(positive)||!Array.isArray(profile)||
      profile.length<3||profile.length>32||!Array.from(profile).every(p=>vector(p,2)))
      throw Error('A support bracket needs a bearing site and finite positive profile dimensions');
    const vertices=[];
    for(const side of [-1,1])for(const [x,y] of profile){
      const p=V.mad(V.mad(site.point,site.out,x*(x<0?embed:site.reach)),site.tangent,side*width/2);
      p[1]+=y*(y<0?drop:overlap);
      vertices.push(p);
    }
    const face=profile.map((_,i)=>i),n=face.length;
    const faces=[face,face.map(i=>i+n),...face.map(i=>[i,(i+1)%n,(i+1)%n+n,i+n])];
    return P.pieces.convex(vertices,faces,meta);
  }

  function intersects(piece,planes){
    return P.geometry.clipConvex(piece.mesh,planes).positions.length>0;
  }

  P.cantileverSupports=Object.freeze({sites,bracket,intersects});
})(KIT);
