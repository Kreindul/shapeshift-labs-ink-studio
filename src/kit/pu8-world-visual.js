/* Headless splat view of a world revision. */
(function (K) {
  const W = K.world, V = K.V, M = K.M;
  const palette = [
    0x141b28,0x292e3a,0x424657,0x626575,0x8a8994,0xb2a9a8,0xd9c9b4,
    0x263e3f,0x355953,0x4d7360,0x6a8a68,0x98a678,0xc4bb8a,
    0x173047,0x1c475b,0x226a78,0x329393,0x64b8aa,0xa9ded2,
    0x4e302a,0x815032,0xab6e3b,0xd29f55,0xf0cb7b,0xf8edd0
  ];
  function visualLooks(world, catalog) {
    const config = world.visual ?? {}, entities = world.entities;
    const assets = K.authoring.looks, paletteOptions = { palette: config.palette ?? palette,
      roles: config.paletteRoles, blueNoise: K.procedural.materials.blueNoise,
      context: config.surfaceEffects && K.splatEffects.context(config.surfaceEffects), validateOnly: true };
    const look = assets.scene(config.look, catalog), inherited = new Map(), surfaces = new Map();
    function surface(binding) {
      if (!surfaces.has(binding)) {
        const { surface: settings } = assets.material({}, binding, catalog);
        surfaces.set(binding, settings);
      }
      return surfaces.get(binding);
    }
    function material(base, binding) {
      const settings = surface(binding);
      return settings ? SurfaceLook.material(base, settings) : base;
    }
    function forEntity(id) {
      if (id == null || !Object.hasOwn(entities, id)) return undefined;
      const explicit = entities[id].visual?.lookAsset;
      if (explicit !== undefined) return explicit;
      let current = id, binding;
      const path = [];
      while (current != null && Object.hasOwn(entities, current) && !inherited.has(current)) {
        const entity = entities[current];
        path.push(current);
        if (entity.lookAsset !== undefined) {
          binding = entity.lookAsset;
          break;
        }
        current = entity.anchor?.entity ?? entity.parent;
      }
      if (inherited.has(current)) binding = inherited.get(current);
      for (const key of path) inherited.set(key, binding);
      return binding;
    }
    function validate() {
      W.data.check(look?.coverageAware === undefined || typeof look.coverageAware === 'boolean', 'coverageAware must be a boolean');
      RenderStages.prepare(look?.renderStages, paletteOptions);
      RenderStages.optics(look?.optics, paletteOptions);
      if (look?.paletteConstraints || Object.hasOwn(config.look ?? {}, 'asset') || Object.hasOwn(config.look ?? {}, 'targets')) {
        PixelLook.prepareColorStack(look.colorStack, paletteOptions.palette, paletteOptions.roles);
        PixelLook.preparePaletteConstraints(look.paletteConstraints, paletteOptions);
      }
      const checked = new Set();
      function check(binding) {
        if (binding === undefined || checked.has(binding)) return;
        const settings = surface(binding);
        if (settings) SurfaceLook.prepare(settings, paletteOptions.palette, undefined, paletteOptions.context,
          { paletteRoles: paletteOptions.roles, blueNoise: paletteOptions.blueNoise, validateOnly: true });
        checked.add(binding);
      }
      check(config.terrainLookAsset);
      for (const entity of Object.values(entities)) {
        check(entity.lookAsset);
        check(entity.visual?.lookAsset);
      }
    }
    return { look, material, forEntity, validate };
  }

  function visual({makeBuilder,makeSculpt},view,query) {
    const config=view.world.visual ?? {}, volume=config.volume&&query.renderVolume(config.volume);
    const region=W.fields.bounds(config.bounds ?? volume?.bounds ?? {min:[-5,-1,-5],max:[5,5,5]});
    const {min,max}=region, span=Math.max(max[0]-min[0],max[2]-min[2],1), resolution=config.resolution??Math.max(.08,span/100);
    W.data.check(Number.isFinite(resolution)&&resolution>=.02&&resolution<=10&&span/resolution<=256,'Render grid exceeds its sample budget');
    const B=makeBuilder(view.world.seed,config.palette??palette), S=K.sculpt(makeSculpt(B));
    const catalog = W.materials.catalog(view.world);
    const looks = visualLooks(view.world, catalog);
    const entities = view.world.entities, targets = new Map();
    function targetFor(id) {
      if (targets.has(id)) return targets.get(id);
      const entity = entities[id], prefabs = [];
      for (let current = id; current != null && Object.hasOwn(entities, current);) {
        const row = entities[current];
        if (row.kind === 'assembly' && row.prefab) prefabs.push(current);
        current = row.anchor?.entity ?? row.parent;
      }
      const target = { ...(id != null && { entity: id }), ...(entity?.visual?.surfaceId && { surface: entity.visual.surfaceId }),
        ...(entity?.tags?.length && { tags: entity.tags }), ...(prefabs.length && { prefabs }) };
      targets.set(id, target);
      return target;
    }
    if(looks.look?.pixel)S.pixel=true;
    S.captureAlbedo = Array.isArray(looks.look?.renderStages) &&
      looks.look.renderStages.some(rule => rule.stage === 'material');
    const mid=min.map((n,i)=>(n+max[i])/2);
    const fields=config.fields??{}, terrain=fields.bed, water=fields.water, wear=fields.wear;
    const ramps=new Map();
    function finishFor(base,profile) {
      if (!profile) return base;
      const {id,appearance}=profile;
      if (!appearance) return {...base,materialId:id};
      const dry=appearance.dry, wet=appearance.wet??dry, weight=wet===dry?0:Math.round(profile.wetness*32);
      const key=id+'/'+weight;
      if (!ramps.has(key)) {
        const rgb=swatch=>{
          const packed=parseInt(swatch.slice(1),16);
          return [(packed>>16)&255,(packed>>8)&255,packed&255];
        };
        ramps.set(key,dry.map((color,i)=>PixelLook.nearest(V.lerp(rgb(color),rgb(wet[i]),weight/32),B.P,true)));
      }
      return {...base,materialId:id,r:ramps.get(key)};
    }
    const earth=looks.material({r:[7,8,9,10,11],materialId:'terrain',surface:config.terrainSurface,rf(x,y,z,ny) {
      if (ny<.4) return [19,20,21,22];
      const result=wear&&query.probe(wear,[x,y,z]);
      return result?.status==='ok'&&result.value>.18?[19,20,21,22,23]:null;
    }}, config.terrainLookAsset);
    if (fields.surface!==undefined) {
      const materialViews=new Map();
      earth.materialAt=(x,y,z)=>{
        const profile=W.materials.probe(query,fields.surface,[x,y,z]);
        if (!profile) return null;
        const key=profile.id+'/'+Math.round(profile.wetness*32);
        if (!materialViews.has(key)) {
          const sampled=finishFor(earth,profile);
          if (profile.appearance) sampled.rf=undefined;
          materialViews.set(key,sampled);
        }
        return materialViews.get(key);
      };
    }
    let hasSurface=Boolean(earth.surface);
    const height=(x,z)=>{
      const result=terrain&&query.probe(terrain,[x,0,z]);
      return result?.status==='ok'?result.value:config.ground??0;
    };
    function groundDistance(x,y,z) {
      return Math.max(y-height(x,z), min[1]-y, min[0]-x, x-max[0], min[2]-z, z-max[2]);
    }
    if(!volume)S.implicitForm({bounds:{min,max},sd:groundDistance},earth,{res:resolution,target:{surface:'terrain'}});
    let bodies=[];
    if (fields.bodies) {
      const reading=query.probe(fields.bodies);
      if (reading.status==='ok') bodies=Object.values(reading.value);
    }
    let surfaceAtlas;
    if(bodies.some(body=>body.surfaceState)){
      const field=query.field(fields.bodies)?.name;
      if(field)surfaceAtlas=query.probe(field.slice(0,field.lastIndexOf('/'))+'/surface-charts').value;
    }
    for (const entry of bodies) {
      if (!entry.half || !entry.position) continue;
      const ramp=entry.look??[1,2,3,4,5,6];
      const rotation=entry.rotation??M.id();
      const axis=[0,1,2].map(i=>[rotation[i],rotation[i+3],rotation[i+6]]);
      const entityId=entry.entity??entry.id, visual=entities[entityId]?.visual;
      const physical=W.materials.forBody(catalog,view.world,entry);
      let finish=looks.material(finishFor({r:ramp,materialId:visual?.materialId??visual?.material??entry.material??'body'},physical),
        looks.forEntity(entityId));
      const sample=W.surfaceState.materialSampler(entry,surfaceAtlas,finish,B.P);
      const target=targetFor(entityId);
      if(sample)finish={...finish,materialAt:sample};
      hasSurface ||= Boolean(finish.surface);
      S.box(entry.position,entry.half,finish,{ax:axis,res:resolution*.72,
        rd:Math.min(.055,...entry.half)*.4,tag:entry.id,target:sample?{...target,surface:undefined}:target});
    }
    for (const [id,entity] of Object.entries(view.world.entities)) {
      if (!entity.visual?.half) continue;
      const pose=query.target({entity:id}), point=pose?.point;
      if (!point) continue;
      const {half,ramp,surface}=entity.visual;
      const physical=W.materials.forBody(catalog,view.world,{entity:id});
      const finish=looks.material(finishFor({r:ramp??[19,20,21,22,23],surface,albedo:entity.visual.albedo,
        materialId:entity.visual.materialId??entity.visual.material??'entity'},physical),looks.forEntity(id));
      hasSurface ||= Boolean(finish.surface);
      S.box(point,half,finish,{res:resolution*.72,tag:id,target:targetFor(id)});
    }
    for (const field of fields.agents??[]) {
      const reading=query.probe(field);
      if (reading.status!=='ok') continue;
      for (const [id,agent] of Object.entries(reading.value)) {
        if (!agent.position || agent.mode==='dormant') continue;
        const r=agent.radius??.16, p=agent.position, face=agent.direction??[1,0,0];
        const binding=looks.forEntity(agent.entity??id);
        const body=looks.material({r:agent.look??[4,5,6,24],materialId:'agent'},binding);
        const head=looks.material({r:[19,20,23],materialId:'agent'},binding);
        hasSurface ||= Boolean(body.surface);
        const target=targetFor(agent.entity??id);
        S.ball(V.add(p,[0,r*.7,0]),[r*1.27,r*.78,r*.76],body,{objectId:id,target,res:resolution*.64});
        S.ball(V.mad(V.add(p,[0,r,0]),face,r),r*.48,head,{objectId:id,target,res:resolution*.64});
        const toes=looks.material({r:[19,20,21,22],materialId:'agent'},binding);
        for(const limb of agent.limbs??[]){
          const top=V.add(limb.point,[0,r*.42,0]);
          S.tube([limb.point,top],r*.18,r*.18,toes,{objectId:id,target,res:resolution*.6});
        }
      }
    }
    S.bake();
    const waterTarget = TargetSelectors.medium(water, 'water');
    const nativeWater = water && (config.waterOptics || looks.look?.optics?.some(rule => TargetSelectors.matches(rule.select, waterTarget)));
    const waterBodies = K.procedural.waterBodies;
    const waterScene = volume?.water ?? (nativeWater ? waterBodies.scene([waterBodies.create({
      id: water, bounds: { min: [min[0], min[2]], max: [max[0], max[2]] }, optics: config.waterOptics,
      resolution: [0, 2].map(axis => Math.min(64, Math.ceil((max[axis] - min[axis]) / resolution))),
      sample(x, z) {
        const read = query.probe(water, [x, 0, z]);
        if (read.status !== 'ok' || !(read.value?.depth > 0)) return null;
        const { surface, depth, velocity } = read.value;
        return { bed: surface - depth, surface, current: velocity };
      }
    })]) : undefined);
    if (water && !nativeWater && !volume?.water) {
      const first=B.count();
      const wobble=(x,z)=>((Math.sin(x*9.1+z*13.7)*43758.58)%1+1)%1;
      for (let z=min[2]+resolution/2; z<max[2]; z+=resolution) for (let x=min[0]+resolution/2; x<max[0]; x+=resolution) {
        const read=query.probe(water,[x,0,z]);
        if (read.status!=='ok' || !read.value || read.value.depth < .018) continue;
        const {surface,depth,velocity}=read.value, speed=Math.hypot(...velocity);
        const glow=wobble(x,z), tint=depth>.58?14:depth>.23?15:16, color=tint+(glow<.28?1:0);
        B.disc(x,surface+.013,z,[0,1,0],resolution*.66,resolution*.16,B.P[color],1);
        if (speed>.12 && glow<.063) B.disc(x,surface+.032,z,[0,1,0],resolution*.4,resolution*.14,B.P[18],1);
      }
      B.describeSplats?.(first,B.count(),{material:'water',target:{medium:water,mediumKind:'water',surface:'water'}});
    }
    const surfaceEffects = (hasSurface || config.surfaceEffects || looks.look?.paletteConstraints || looks.look?.renderStages) &&
      { ...config.surfaceEffects, query };
    const baked=B.finish({lookSnapshot: { time: view.time ?? view.tick * view.world.dt, tick: view.tick, query }, cam:config.camera??{target:[mid[0],.05,mid[2]],dist:span*1.48,yaw:.62,pitch:.8},
      radius:span,detail:30,dither:.22,look:looks.look,paletteRoles:config.paletteRoles,
      ...(waterScene && { water: waterScene }), ...(config.atmosphere && { atmosphere: config.atmosphere }),
      ...(config.reflections && { reflections: config.reflections }), ...(surfaceEffects&&{surfaceEffects})});
    return volume?SplatProvenance.join([...volume.parts,baked],baked):baked;
  }
  W.visual = visual;
  W.validateLooks = (world, catalog) => visualLooks(world, catalog).validate();
})(KIT);
