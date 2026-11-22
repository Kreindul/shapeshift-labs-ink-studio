/* Indexed tile walls, sliding panels and directional sprite columns on a native art grid. */
(function (K) {
  const finite = Number.isFinite, sides = ['north','east','south','west'];
  const unit = n => finite(n) && n>=0 && n<=1;
  const tuple = (a,n) => Array.isArray(a) && a.length===n && Array.from(a).every(finite);
  const fract = n => n-Math.floor(n);
  const texel = (n, size) => Math.min(size-1,Math.max(0,Math.floor(n*size)));
  const opaque = index => index>=0;
  const index = (n,length) => Number.isInteger(n) && n>=0 && n<length;
  const record = value => value && [Object.prototype,null].includes(Object.getPrototypeOf(value));

  function check(condition, message) {
    if (!condition) throw new RangeError('Tile raycaster: ' + message);
  }

  function swatch(color) {
    return typeof color==='string' && /^#[\da-f]{6}$/i.test(color) ? parseInt(color.slice(1),16) : color;
  }

  function lights(definition,palette) {
    const { distances = [], ramps = {}, sideBias = {} } = definition;
    check(Array.isArray(distances) && distances.length<=15 && Array.from(distances).every((d,i) =>
      finite(d) && d>0 && (!i || d>distances[i-1])) && record(ramps) && record(sideBias) &&
      Object.keys(sideBias).every(key => ['x','z'].includes(key) && index(sideBias[key],distances.length+1)),
      'shade needs increasing positive distances and a nonnegative wall side bias');
    const keys = distances.slice();
    const table = palette.map((_,color) => {
      const ramp = Object.hasOwn(ramps,color) ? ramps[color] : undefined;
      if (ramp===undefined) return keys.map(() => color).concat(color);
      check(Array.isArray(ramp) && ramp.length===keys.length+1 && Array.from(ramp).every(n=>index(n,palette.length)),
        'each shade ramp needs one palette index per distance band');
      return ramp.slice();
    });
    check(Object.keys(ramps).every(key => /^(0|[1-9]\d*)$/.test(key) && index(+key,palette.length)), 'shade ramp index is outside the palette');
    const bias = { x:sideBias.x??0,z:sideBias.z??0 };
    return { table,bias,band(depth) {
      let band=0;
      while (band<keys.length && depth>=keys[band]) band++;
      return band;
    } };
  }

  function create({ map, palette, tiles = {}, doors = [], sprites = [], floor, ceiling, background = null,
    wallHeight = 1, shade = {} } = {}) {
    const columns = map?.[0]?.length, rows = map?.length;
    check(Array.isArray(map) && index(columns-1,128) && index(rows-1,128) &&
      Array.from(map).every(row => typeof row==='string' && row.length===columns && /^[\x21-\x7e]+$/.test(row)),
      'use a rectangular map of 1–128 printable cells per side');
    check(Array.isArray(palette) && index(palette.length-1,256) &&
      Array.from(palette).every(value => index(swatch(value),0x1000000)), 'supply 1–256 RGB palette swatches');
    check(finite(wallHeight) && wallHeight>0 && (background===null || index(background,palette.length)) &&
      record(tiles) && Array.isArray(doors) && doors.length<=1024 && Array.isArray(sprites) && sprites.length<=512,
      'invalid wall height, background, tiles, doors or sprites');
    const swatches = palette.map(swatch), shading = lights(shade,swatches);
    const images = new WeakMap(), owners=[null], names=new Set();
    const cells = new Array(columns*rows).fill(null);
    let artPixels=0;
    function owner(id,kind) {
      check(typeof id==='string' && id.trim() && !names.has(id), 'surface IDs must be distinct names');
      names.add(id);
      owners.push({id,kind});
      return owners.length-1;
    }

    function picture(source, solid) {
      check(record(source), 'provide an indexed stamp for each texture');
      if (!images.has(source)) {
        const {width,height,entries,at,palette:colors} = K.pixelStamps.prepare(source);
        artPixels += width*height*entries.length;
        check(artPixels<=8*1024*1024,'textures exceed the art-pixel budget');
        const remap = colors?.map(color => {
          const target=typeof color==='string'?swatches.indexOf(swatch(color)):color;
          check(index(target,swatches.length),'texture palette colors must reference the scene palette');
          return target;
        });
        const frames=entries.map(({slots}) => Int16Array.from(slots,slot => {
          if (slot===null) return -1;
          const value=remap?remap[slot]:slot;
          check(index(value,swatches.length),'texture has a slot outside the scene palette');
          return value;
        }));
        images.set(source,{width,height,frames,at,solid:frames.every(pixels=>pixels.every(opaque))});
      }
      const texture=images.get(source);
      check(!solid || texture.solid,'wall, door and plane paint must cover every texel');
      return texture;
    }

    const legend = new Map(Object.entries(tiles).map(([key, tile]) => {
      check(key.length===1 && key!=='.' && record(tile) &&
        (tile.faces===undefined || record(tile.faces) && Object.keys(tile.faces).every(face=>sides.includes(face))),
        'wall tiles need a single non-dot key and optional named faces');
      const base=picture(tile.paint,true);
      return [key,Object.fromEntries(sides.map(face=>[face,tile.faces?.[face]?picture(tile.faces[face],true):base]))];
    }));
    for (let z=0;z<rows;z++) for (let x=0;x<columns;x++) {
      const key=map[z][x];
      if (key==='.') continue;
      const faces=legend.get(key);
      check(faces,'map uses an undefined tile: '+key);
      cells[z*columns+x]={id:owner('wall-'+x+'-'+z,'wall'),faces};
    }
    const doorList=Array.from(doors, ({id,at,axis='z',slide='positive',open=0,paint}={},order) => {
      check(tuple(at,2) && index(at[0],columns) && index(at[1],rows) && !cells[at[1]*columns+at[0]] &&
        ['x','z'].includes(axis) && ['positive','negative'].includes(slide) && (unit(open) || typeof open==='function'),
        'door needs a free cell, an axis, a slide direction and openness in [0, 1]');
      const door={id:owner(id,'door'),name:id,axis,slide,open,texture:picture(paint,true),order};
      cells[at[1]*columns+at[0]]=door;
      return door;
    });
    function pose(value,what) {
      check(typeof value==='function' || (what==='position'?tuple(value,3):finite(value)), 'invalid sprite '+what);
      return Array.isArray(value)?value.slice():value;
    }
    const actors=Array.from(sprites, ({id,at,yaw=0,height=1,views}={}) => {
      check(finite(height) && height>0 && Array.isArray(views) && index(views.length-1,32),
        'sprites need a positive height and 1–32 directional views');
      const directions=Array.from(views, ({yaw=0,paint,pivot}={}) => {
        const texture=picture(paint,false);
        const pin=pivot??[texture.width/2,texture.height];
        check(finite(yaw) && tuple(pin,2),'sprite view needs a finite yaw and pixel pivot');
        return {yaw,texture,pivot:pin.slice()};
      });
      return {id:owner(id,'sprite'),at:pose(at,'position'),yaw:pose(yaw,'yaw'),height,directions};
    });
    const planes = [floor,ceiling].map((paint,i) => paint==null?null:
      { id:owner(i?'ceiling':'floor',i?'ceiling':'floor'),texture:picture(paint,true) });
    const inside = (x,z) => x>=0 && x<columns && z>=0 && z<rows;

    function openings(time, overrides) {
      check(finite(time) && record(overrides) && Object.keys(overrides).every(name=>doorList.some(door=>door.name===name)),
        'door overrides must name doors in the tilemap');
      return doorList.map(door => {
        const value=Object.hasOwn(overrides,door.name)?overrides[door.name]:
          typeof door.open==='function'?door.open(time):door.open;
        check(unit(value),'door openness must be in [0, 1]');
        return value;
      });
    }

    function hitGrid(ox,oz,dx,dz,far,opens) {
      let x=Math.floor(ox),z=Math.floor(oz), entry=0, side='z';
      const sx=dx>0?1:-1, sz=dz>0?1:-1, ax=Math.abs(1/dx), az=Math.abs(1/dz);
      let nextX=dx===0?Infinity:((sx>0?x+1:x)-ox)/dx;
      let nextZ=dz===0?Infinity:((sz>0?z+1:z)-oz)/dz;
      // DDA advances to the next cell boundary. Door planes are tested inside their cell.
      function surface(cell, axis, depth, across) {
        const towardPositive=axis==='x'?dx>0:dz>0;
        const face=axis==='x'?(towardPositive?'west':'east'):(towardPositive?'north':'south');
        const reverse=axis==='x'?towardPositive:!towardPositive;
        return {cell,axis,face,depth,u:reverse?1-across:across,x,z,texture:cell.faces?.[face]??cell.texture};
      }
      while (inside(x,z) && entry<=far) {
        const cell=cells[z*columns+x];
        if (cell?.faces) {
          const across=side==='x'?oz+entry*dz-z:ox+entry*dx-x;
          return surface(cell,side,Math.max(0,entry),Math.min(1,Math.max(0,across)));
        }
        if (cell && opens[cell.order]<1) {
          const alongX=cell.axis==='x', component=alongX?dx:dz;
          const distance=((alongX?x-ox:z-oz)+.5)/component;
          if (component!==0 && distance>=entry && distance<=Math.min(nextX,nextZ,far)) {
            const across=alongX?oz+distance*dz-z:ox+distance*dx-x;
            const position=across+(cell.slide==='positive'?-opens[cell.order]:opens[cell.order]);
            if (position>=0 && position<1) return surface(cell,cell.axis,distance,position);
          }
        }
        if (nextX<=nextZ) {
          x+=sx; entry=nextX; nextX+=ax; side='x';
        } else {
          z+=sz; entry=nextZ; nextZ+=az; side='z';
        }
      }
      return null;
    }

    function origin(x,z) {
      const gx=Math.floor(x),gz=Math.floor(z);
      check(inside(gx,gz) && !cells[gz*columns+gx]?.faces,'view origin must lie in an empty or door cell');
    }

    function cast({at,direction,far=128,time=0,doors={}}={}) {
      check(tuple(at,2) && tuple(direction,2) && finite(far) && far>0,'cast needs XZ origin and direction and a positive distance');
      const length=Math.hypot(...direction);
      check(finite(length) && length>0,'cast direction must have finite nonzero length');
      const [x,z]=at,dx=direction[0]/length,dz=direction[1]/length;
      origin(x,z);
      const hit=hitGrid(x,z,dx,dz,far,openings(time,doors));
      return hit?{owner:{...owners[hit.cell.id]},cell:[hit.x,hit.z],face:hit.face,depth:hit.depth,u:hit.u,
        point:[x+dx*hit.depth,z+dz*hit.depth]}:null;
    }

    function render({width,height,camera,time=0,doors={}}={}) {
      const {at,yaw=0,fov=Math.PI/3,horizon=height/2,near=.02,far=128}=camera??{};
      check(index(width-1,2048) && index(height-1,2048) && width*height<=K.renderOutputs.maxPixels &&
        tuple(at,3) && at[1]>0 && at[1]<wallHeight && finite(yaw) && finite(horizon) &&
        finite(fov) && fov>=.03 && fov<Math.PI-.03 && finite(near) && near>=1e-5 && finite(far) && far>near,
        'invalid native canvas, camera height, field of view or clipping range');
      const [ox,oy,oz]=at;
      origin(ox,oz);
      const opens=openings(time,doors);
      const focal=height/2/Math.tan(fov/2), center=width/2;
      const forward=[Math.sin(yaw),0,Math.cos(yaw)],right=[forward[2],0,-forward[0]];
      const pixels=width*height, data=new Uint8Array(pixels*4), depth=new Float64Array(pixels).fill(Infinity);
      const ids=new Uint16Array(pixels), uv=new Float64Array(pixels*2), placements=[];
      const exposed=new Map();
      function paint(texture) {
        if (!exposed.has(texture)) exposed.set(texture,texture.frames[texture.at(time)]);
        return exposed.get(texture);
      }
      function color(p,slot) {
        const packed=swatches[slot], i=p*4;
        data[i]=packed>>16; data[i+1]=packed>>8&255; data[i+2]=packed&255; data[i+3]=255;
      }
      function write(p,z,id,u,v,texture,art,band) {
        if (z>=depth[p]) return false;
        const slot=art[texel(v,texture.height)*texture.width+texel(u,texture.width)];
        if (slot<0) return false;
        color(p,shading.table[slot][band]);
        depth[p]=z; ids[p]=id; uv[p*2]=u; uv[p*2+1]=v;
        return true;
      }
      if (background!==null) for (let p=0;p<pixels;p++) color(p,background);
      const rowPlanes=Array.from({length:height},(_,y) => {
        const line=y+.5-horizon, plane=planes[line>0?0:1];
        if (!plane || line===0) return null;
        const z=(line>0?oy:oy-wallHeight)*focal/line;
        return z>=near && z<=far ? {z,plane,band:shading.band(z),art:paint(plane.texture)}:null;
      });
      for (let x=0;x<width;x++) {
        const offset=(x+.5-center)/focal, dx=forward[0]+right[0]*offset, dz=forward[2]+right[2]*offset;
        const wall=hitGrid(ox,oz,dx,dz,far,opens);
        // The ray's forward component is one, so its parameter is already camera depth.
        const distance=wall?(wall.depth||near):Infinity;
        for (let y=0;y<height;y++) {
          const row=rowPlanes[y];
          if (!row || row.z>distance) continue;
          const px=ox+row.z*dx,pz=oz+row.z*dz;
          if (inside(px,pz)) write(y*width+x,row.z,row.plane.id,fract(px),fract(pz),row.plane.texture,row.art,row.band);
        }
        if (!wall) continue;
        const top=horizon-(wallHeight-oy)*focal/distance, bottom=horizon+oy*focal/distance;
        const band=Math.min(shading.table[0].length-1,shading.band(wall.depth)+shading.bias[wall.axis]);
        const art=paint(wall.texture);
        // Cover the shared pixel center even if plane and wall math round to opposite sides of the seam.
        const edgeTolerance=1e-8;
        const y0=Math.max(0,Math.ceil(top-.5-edgeTolerance));
        const y1=Math.min(height,Math.floor(bottom-.5+edgeTolerance)+1);
        for (let y=y0;y<y1;y++) {
          const v=(y+.5-horizon)*distance/focal+(wallHeight-oy);
          write(y*width+x,wall.depth,wall.cell.id,wall.u,Math.min(1,Math.max(0,v/wallHeight)),wall.texture,art,band);
        }
      }

      let work=0;
      const sprites=actors.map(actor => {
        const point=typeof actor.at==='function'?actor.at(time):actor.at;
        check(tuple(point,3),'sprite position callback must return XYZ');
        const x=point[0]-ox,z=point[2]-oz;
        return {actor,point,x,z,distance:x*forward[0]+z*forward[2]};
      }).sort((a,b)=>a.distance-b.distance);
      for (const {actor,point,x,z,distance} of sprites) {
        if (distance<near || distance>far) continue;
        const heading=typeof actor.yaw==='function'?actor.yaw(time):actor.yaw;
        check(finite(heading),'sprite yaw callback must return a finite angle');
        const angle=Math.atan2(-x,-z)-heading;
        const view=actor.directions.reduce((best,cel)=>
          Math.cos(cel.yaw-angle)>Math.cos(best.yaw-angle)+1e-12?cel:best);
        const {texture,pivot}=view;
        const scale=actor.height*focal/distance/texture.height;
        if (!(scale*texture.height>=.5)) continue;
        const h=Math.max(1,Math.round(texture.height*scale)),w=Math.max(1,Math.round(texture.width*scale));
        const left=Math.round(center+(x*right[0]+z*right[2])*focal/distance-pivot[0]*w/texture.width);
        const top=Math.round(horizon-(point[1]-oy)*focal/distance-pivot[1]*h/texture.height);
        check([left,top,w,h].every(finite),'sprite exceeds the finite screen range');
        const x0=Math.max(0,left),x1=Math.min(width,left+w),y0=Math.max(0,top),y1=Math.min(height,top+h);
        if (x0>=x1 || y0>=y1) continue;
        work+=(x1-x0)*(y1-y0);
        check(work<=32*1024*1024,'sprites exceed the frame work budget');
        const art=paint(texture), band=shading.band(distance);
        let visiblePixels=0;
        for (let col=x0;col<x1;col++) for (let row=y0;row<y1;row++) {
          if (write(row*width+col,distance,actor.id,(col+.5-left)/w,(row+.5-top)/h,texture,art,band)) visiblePixels++;
        }
        placements.push({id:owners[actor.id].id,yaw:view.yaw,rect:[left,top,w,h],visiblePixels});
      }
      return K.renderOutputs.create({width,height,data,depth,ids,uv,owners,placements,
        camera:{origin:at,right,up:[0,1,0],forward,center:[center,horizon],scale:[focal,focal]}});
    }
    return Object.freeze({columns,rows,wallHeight,cast,render});
  }

  K.tileRaycaster = Object.freeze({create});
})(KIT);
