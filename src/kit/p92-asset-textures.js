/* Portable base-color maps for imported triangle assets. Texels are stored as
   sRGB RGB bytes and sampled in linear light before material and vertex tints. */
(function (K) {
  const A=K.authoring, maxEdge=64, maxPixels=16384, maxMaps=16;
  const inRange=(v,lo,hi)=>Number.isFinite(v)&&v>=lo&&v<=hi;
  const integer=(v,lo,hi)=>Number.isInteger(v)&&inRange(v,lo,hi);
  const vector=(v,n,lo,hi)=>Array.isArray(v)&&v.length===n&&Array.from(v).every(x=>inRange(x,lo,hi));
  const wraps=new Map([[33071,'clamp'],[33648,'mirror'],[10497,'repeat']]);
  const linear=q=>q<=.04045?q/12.92:((q+.055)/1.055)**2.4;
  const srgb=q=>q<=.0031308?q*12.92:1.055*q**(1/2.4)-.055;
  const linearByte=Array.from({length:256},(_,i)=>linear(i/255));
  const bytes=(s,n)=>typeof s==='string'&&s.length===4*Math.ceil(n/3)&&
    s.endsWith('='.repeat((3-n%3)%3))&&/^[A-Za-z0-9+/]*={0,2}$/.test(s)&&
    (s.replace(/=+$/,'').length*6>>3)===n;
  const unpack=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  const pack=v=>btoa(String.fromCharCode(...v));

  function validate(texture,vertices,faces) {
    const {uv, tints, maps, images, faces:bindings}=texture||{};
    if (!vector(uv,vertices*2,-1e6,1e6)||tints!==undefined&&!bytes(tints,vertices*3)||
        !Array.isArray(images)||images.length<1||images.length>maxMaps||
        !Array.isArray(maps)||maps.length<1||maps.length>maxMaps||
        !Array.isArray(bindings)||bindings.length!==faces||!Array.from(bindings).every(v=>integer(v,-1,maps.length-1)))
      throw Error('Invalid asset base-color texture');
    let sum=0;
    for(const image of images) {
      const {width,height,rgb}=image||{};
      if(!integer(width,1,maxEdge)||!integer(height,1,maxEdge)||!bytes(rgb,width*height*3))
        throw Error('Invalid asset base-color image');
      sum+=width*height;
    }
    if(sum>maxPixels) throw Error('Asset base-color images exceed the texel budget');
    for(const map of maps) {
      const {image,wrap,filter,factor}=map||{};
      if(!integer(image,0,images.length-1)||!Array.isArray(wrap)||wrap.length!==2||
         !Array.from(wrap).every(w=>['clamp','mirror','repeat'].includes(w))||
         !['nearest','linear'].includes(filter)||!vector(factor,3,0,1)) throw Error('Invalid asset base-color sampler');
    }
  }

  function binding(json,part) {
    const material=json.materials?.[part.material]?.pbrMetallicRoughness;
    const info=material?.baseColorTexture;
    if(info===undefined) return null;
    if(!info||!integer(info.index,0,(json.textures?.length??0)-1)) throw Error('Invalid GLB base-color binding');
    const transform=info.extensions?.KHR_texture_transform||{};
    const source=transform.texCoord??info.texCoord??0,
      scale=transform.scale??[1,1],offset=transform.offset??[0,0],rotation=transform.rotation??0,
      factor=material.baseColorFactor??[1,1,1,1];
    if(!integer(source,0,0x7fffffff)||!vector(scale,2,-1e6,1e6)||!vector(offset,2,-1e6,1e6)||
       !Number.isFinite(rotation)||!vector(factor,4,0,1)) throw Error('Invalid GLB base-color coordinates or factor');
    const index=part.attributes['TEXCOORD_'+source];
    const texture=json.textures[info.index], sampler=texture&&json.samplers?.[texture.sampler];
    if(!texture||!integer(texture.source,0,(json.images?.length??0)-1)||
       texture.sampler!==undefined&&!sampler) throw Error('GLB base color needs an embedded PNG or JPEG image');
    const wrap=[wraps.get(sampler?.wrapS??10497),wraps.get(sampler?.wrapT??10497)],
      filter=sampler?.magFilter??9729;
    if(wrap.includes(undefined)||![9728,9729].includes(filter)) throw Error('Unsupported GLB base-color sampler');
    return {index,scale,offset,rotation,factor:factor.slice(0,3),source:texture.source,
      wrap,filter:filter===9728?'nearest':'linear'};
  }

  function checkPrimitive(json,part,count,accessor) {
    const spec=binding(json,part);
    if(!spec) return;
    const a=json.accessors[spec.index];
    if(!a||!(a.componentType===5126&&!a.normalized||[5121,5123].includes(a.componentType)&&a.normalized)||
       accessor(spec.index,[2])!==count) throw Error('Textured GLB primitives need valid texture coordinates');
    if(part.attributes.COLOR_0!==undefined) {
      const color=json.accessors[part.attributes.COLOR_0];
      if(!(color.componentType===5126&&!color.normalized||[5121,5123].includes(color.componentType)&&color.normalized))
        throw Error('Textured GLB vertex colors need normalized channels');
    }
  }

  function embedded(glb,index) {
    const image=glb.json.images[index], uri=image?.uri;
    if(typeof uri==='string') {
      const match=/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/.exec(uri);
      if(match&&image.bufferView===undefined) return {mime:match[1],pixels:unpack(match[2])};
      throw Error('GLB base-color images must be embedded');
    }
    const mime=image?.mimeType, view=image&&glb.json.bufferViews[image.bufferView];
    const start=view?.byteOffset??0, length=view?.byteLength;
    if(!['image/png','image/jpeg'].includes(mime)||view?.buffer!==0||!integer(length,1,glb.bin.length)||
       !integer(start,0,glb.bin.length-length)) throw Error('GLB base color needs an embedded PNG or JPEG image');
    return {mime,pixels:glb.bin.subarray(start,start+length)};
  }

  function reduceImage(decoded) {
    const {width,height,pixels}=decoded||{};
    const pixelsType=Object.prototype.toString.call(pixels);
    if(!integer(width,1,4096)||!integer(height,1,4096)||
       !['[object Uint8Array]','[object Uint8ClampedArray]'].includes(pixelsType)||pixels.length!==4*width*height)
      throw Error('GLB image decoder must return bounded RGBA bytes');
    const scale=Math.min(1,maxEdge/Math.max(width,height)), w=Math.max(1,Math.round(width*scale)), h=Math.max(1,Math.round(height*scale));
    const rgb=new Uint8Array(w*h*3);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
      const dx=Math.min(width-1,Math.floor((x+.5)*width/w)), dy=Math.min(height-1,Math.floor((y+.5)*height/h));
      rgb.set(pixels.subarray((dy*width+dx)*4,(dy*width+dx)*4+3),(y*w+x)*3);
    }
    return {width:w,height:h,rgb:pack(rgb)};
  }
  function dimensions(pixels,mime) {
    const bytes=new DataView(pixels.buffer,pixels.byteOffset,pixels.byteLength);
    if(mime==='image/png'&&pixels.length>=24&&bytes.getUint32(0)===0x89504e47&&
       bytes.getUint32(4)===0x0d0a1a0a&&bytes.getUint32(12)===0x49484452) {
      return [bytes.getUint32(16),bytes.getUint32(20)];
    }
    if(mime==='image/jpeg'&&pixels.length>=4&&bytes.getUint16(0)===0xffd8) {
      for(let i=2;i+3<pixels.length;) {
        if(pixels[i++]!==255) break;
        while(pixels[i]===255) i++;
        const marker=pixels[i++];
        if(marker===0xda||marker===0xd9||i+2>pixels.length) break;
        const size=bytes.getUint16(i);
        if(size<2||i+size>pixels.length) break;
        if(marker>=0xc0&&marker<=0xcf&&![0xc4,0xc8,0xcc].includes(marker)&&size>=8)
          return [bytes.getUint16(i+5),bytes.getUint16(i+3)];
        i+=size;
      }
    }
    throw Error('Invalid embedded GLB image header');
  }

  function read(glb) {
    const {json,vertices,triangles}=glb, uv=new Array(vertices*2).fill(0),
      tints=new Uint8Array(vertices*3).fill(255), faces=new Array(triangles).fill(-1);
    const images=[], maps=[], imageIds=new Map(), materialIds=new Map();
    let tinted=false;
    return {
      visit(part,{firstVertex,vertexCount,firstFace,faceCount,accessor}) {
        const spec=binding(json,part);
        if(!spec) return;
        if(!imageIds.has(spec.source)) {
          imageIds.set(spec.source,images.length);
          images.push(embedded(glb,spec.source));
        }
        if(!materialIds.has(part.material)) {
          materialIds.set(part.material,maps.length);
          maps.push({image:imageIds.get(spec.source),factor:spec.factor,wrap:spec.wrap,filter:spec.filter});
          if(maps.length>maxMaps) throw Error('Asset exceeds the base-color material budget');
        }
        faces.fill(materialIds.get(part.material),firstFace,firstFace+faceCount);
        const src=accessor(spec.index), color=part.attributes.COLOR_0===undefined?null:accessor(part.attributes.COLOR_0);
        const c=Math.cos(spec.rotation),s=Math.sin(spec.rotation);
        for(let i=0;i<vertexCount;i++) {
          const u=src.get(i,0)*spec.scale[0],v=src.get(i,1)*spec.scale[1],slot=firstVertex+i;
          uv[slot*2]=Math.round((spec.offset[0]+c*u-s*v)*1e5)/1e5;
          uv[slot*2+1]=Math.round((spec.offset[1]+s*u+c*v)*1e5)/1e5;
          if(color) for(let k=0;k<3;k++) {
            const q=color.get(i,k);
            if(!inRange(q,0,1)) throw Error('GLB vertex colors must be normalized');
            tints[slot*3+k]=Math.round(q*255);
            tinted ||= q<1;
          }
        }
      },
      async finish(decodeImage) {
        if(!maps.length) return null;
        if(typeof decodeImage!=='function') throw Error('Embedded GLB colors need an image decoder');
        const decoded=[];
        for(const {mime,pixels} of images) {
          const [width,height]=dimensions(pixels,mime);
          if(![width,height].every(n=>integer(n,1,4096)))
            throw Error('Embedded GLB image dimensions exceed the decoder budget');
          decoded.push(reduceImage(await decodeImage(pixels,mime,{width,height,maxEdge})));
        }
        return {uv,faces,maps,images:decoded,...(tinted&&{tints:pack(tints)})};
      }
    };
  }

  function edge(i,size,mode) {
    if(mode==='clamp') return Math.min(size-1,Math.max(0,i));
    const span=mode==='mirror'?2*size:size, q=((i%span)+span)%span;
    return q>=size?span-1-q:q;
  }
  const compiled=new WeakMap();
  function sampler(recipe) {
    if(compiled.has(recipe)) return compiled.get(recipe);
    const {texture,positions,triangles,colors,faceColors}=recipe, fallback=t=>colors[faceColors[t]];
    const images=texture?.images.map(({width,height,rgb})=>({width,height,data:unpack(rgb)}));
    const tints=texture?.tints&&unpack(texture.tints), projection=new Map();
    function at(t,u,v) {
      const map=texture?.maps[texture.faces[t]];
      if(!map) return fallback(t);
      const i=triangles[3*t],j=triangles[3*t+1],k=triangles[3*t+2],a=1-u-v, uv=texture.uv;
      const {width,height,data}=images[map.image], nearest=map.filter==='nearest';
      const x=(a*uv[2*i]+u*uv[2*j]+v*uv[2*k])*width-(nearest?0:.5),
        y=(a*uv[2*i+1]+u*uv[2*j+1]+v*uv[2*k+1])*height-(nearest?0:.5);
      const ix=Math.floor(x),iy=Math.floor(y),fx=nearest?0:x-ix,fy=nearest?0:y-iy;
      const cols=[edge(ix,width,map.wrap[0]),edge(ix+1,width,map.wrap[0])],
        rows=[edge(iy,height,map.wrap[1]),edge(iy+1,height,map.wrap[1])];
      const a0=(rows[0]*width+cols[0])*3,b0=(rows[0]*width+cols[1])*3,
        c0=(rows[1]*width+cols[0])*3,d0=(rows[1]*width+cols[1])*3;
      return map.factor.map((factor,c)=>{
        const tinted=tints?(a*tints[3*i+c]+u*tints[3*j+c]+v*tints[3*k+c])/255:1;
        const upper=linearByte[data[a0+c]]*(1-fx)+linearByte[data[b0+c]]*fx,
          lower=linearByte[data[c0+c]]*(1-fx)+linearByte[data[d0+c]]*fx;
        return srgb((upper*(1-fy)+lower*fy)*tinted*factor);
      });
    }
    function atPoint(t,x,y,z) {
      if(!(texture?.faces[t]>=0)) return fallback(t);
      const {V}=K;
      if(!projection.has(t)) {
        const i=triangles[3*t]*3,j=triangles[3*t+1]*3,k=triangles[3*t+2]*3;
        const a=positions.slice(i,i+3), b=V.sub(positions.slice(j,j+3),a), c=V.sub(positions.slice(k,k+3),a);
        const bb=V.dot(b,b),bc=V.dot(b,c),cc=V.dot(c,c),den=bb*cc-bc*bc;
        const u=V.mul(V.sub(V.mul(b,cc),V.mul(c,bc)),1/(den||1));
        const v=V.mul(V.sub(V.mul(c,bb),V.mul(b,bc)),1/(den||1));
        projection.set(t,den>1e-16?{u,v,originU:V.dot(a,u),originV:V.dot(a,v)}:null);
      }
      const row=projection.get(t);
      if(!row) return at(t,0,0);
      const {u:a,v:b,originU,originV}=row;
      const u=x*a[0]+y*a[1]+z*a[2]-originU,v=x*b[0]+y*b[1]+z*b[2]-originV;
      const wb=Math.max(0,u),wc=Math.max(0,v),sum=Math.max(0,1-u-v)+wb+wc;
      return at(t,wb/sum,wc/sum);
    }
    const result=Object.freeze({at,atPoint});
    compiled.set(recipe,result);
    return result;
  }
  A.assetTextures=Object.freeze({validate,checkPrimitive,read,sampler});
})(KIT);
