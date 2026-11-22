/* Creator kernels own typed working memory. World state holds portable snapshots. */
(function (K) {
  const W = K.world, R = W.runtime, P = K.procedural;
  const {check, id, own, record, equal} = W.data, {clone, freeze} = P.data;
  const format = 'ink-studio/kernel-state', version = 1;
  const maxBytes = 8 * 1024 * 1024;
  const types = {number:'number', bool:'boolean', vec3:'vec3', record:'record', event:'array'};
  const defaults = {number:0, bool:false, vec3:[0,0,0], record:{}, event:[]};
  const arrays = {Int8Array,Uint8Array,Uint8ClampedArray,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array};
  const littleEndian = new Uint8Array(Uint16Array.of(1).buffer)[0] === 1;
  const kernels = new Map(), operations = new Map();
  const storageType = value => ArrayBuffer.isView(value) && Object.prototype.toString.call(value).slice(8,-1);
  const isFloat = type => type === 'Float32Array' || type === 'Float64Array';
  const positiveRevision = value => Number.isSafeInteger(value) && value > 0;
  const keys = (value, allowed) => record(value) && Object.keys(value).every(key => allowed.includes(key));

  function layout(buffers) {
    check(record(buffers) && Object.keys(buffers).length <= 64, 'Kernel snapshot needs named typed buffers');
    let bytes = 0;
    const result = Object.fromEntries(Object.entries(buffers).map(([name, value]) => {
      const type = storageType(value);
      check(id(name) && own(arrays,type), 'Invalid typed kernel buffer ' + name);
      bytes += value.byteLength;
      return [name,{type,length:value.length}];
    }));
    check(bytes <= maxBytes, 'Kernel snapshot exceeds its typed buffer budget');
    return result;
  }

  function swap(bytes, stride) {
    if (!littleEndian && stride > 1) {
      for (let i=0; i<bytes.length; i+=stride) bytes.subarray(i,i+stride).reverse();
    }
    return bytes;
  }

  function pack(array, type) {
    check(!isFloat(type) || array.every(Number.isFinite), 'Kernel float buffers must be finite');
    const view = new Uint8Array(array.buffer,array.byteOffset,array.byteLength);
    const bytes = littleEndian ? view : swap(view.slice(),array.BYTES_PER_ELEMENT);
    let binary = '';
    for (let i=0; i<bytes.length; i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
    return btoa(binary);
  }

  function unpack(encoded, {type,length}, name) {
    const Type = arrays[type], size = length*Type.BYTES_PER_ELEMENT;
    check(typeof encoded === 'string' && encoded.length === Math.ceil(size/3)*4 &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(encoded), 'Invalid encoded kernel buffer ' + name);
    const binary = atob(encoded);
    check(binary.length === size && btoa(binary) === encoded, 'Invalid encoded kernel buffer ' + name);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const value = new Type(swap(bytes,Type.BYTES_PER_ELEMENT).buffer);
    check(!isFloat(type) || value.every(Number.isFinite), 'Kernel float buffers must be finite');
    return value;
  }

  function ports(source = {}) {
    check(record(source), 'Expected named kernel ports');
    return Object.fromEntries(Object.entries(source).map(([name, raw]) => {
      const spec = typeof raw === 'string' ? {type:raw} : raw;
      check(id(name) && keys(spec,['type','default','quantity','description']) && own(types,spec.type) &&
        (spec.description === undefined || typeof spec.description === 'string'), 'Invalid kernel port ' + name);
      const valid = P.graphTypes.validator(types[spec.type]);
      const value = spec.default ?? defaults[spec.type];
      check(valid(value), 'Invalid default for kernel port ' + name);
      const quantity = K.quantities.normalize(spec.quantity,'Kernel port '+name);
      check(quantity === undefined || ['number','vec3'].includes(spec.type), 'Physical kernel ports need number or vec3');
      return [name,{...clone(spec),default:clone(value),...(quantity && {quantity})}];
    }));
  }

  function values(schema, source, requireAll) {
    check(record(source) && Object.keys(source).every(key => own(schema,key)), 'Unknown or malformed kernel port value');
    return freeze(Object.fromEntries(Object.entries(schema).map(([name, spec]) => {
      const present = own(source,name), value = present ? source[name] : spec.default;
      check((!requireAll || present) && P.graphTypes.validator(types[spec.type])(value),
        'Invalid or missing kernel port value ' + name);
      return [name,clone(value)];
    })));
  }

  function definition(kind, revision) {
    const spec = kernels.get(kind)?.get(revision);
    check(spec, 'Unregistered simulation kernel ' + kind + ' revision ' + revision);
    return spec;
  }

  function prepare(kind, revision, config = {}, {id:instance = 'solver', seed = 1, dt = 1/60} = {}) {
    const spec = definition(kind,revision);
    check(record(config) && id(instance) && Number.isSafeInteger(seed) && Number.isFinite(dt) && dt > 0 && dt <= 1,
      'Invalid kernel configuration or fixed timestep');
    const settings = freeze({config:clone(config),id:instance,seed,dt});
    const kernel = spec.prepare(settings.config,{id:instance,seed,dt});
    check(record(kernel) && ['advance','reset','snapshot','restore'].every(key => typeof kernel[key] === 'function'),
      'Kernel prepare must return advance, reset, snapshot and restore');
    let current, shape;

    function state(outputs, steps) {
      const snap = kernel.snapshot();
      check(keys(snap,['buffers','data']), 'Kernel snapshot needs buffers and optional JSON data');
      const actual = layout(snap.buffers);
      check(shape === undefined || equal(shape,actual), 'Kernel snapshot changed its typed buffer layout');
      shape ??= freeze(actual);
      const buffers = Object.fromEntries(Object.entries(shape).map(([name,{type,length}]) =>
        [name,{type,length,base64:pack(snap.buffers[name],type)}]));
      return freeze({format,version,kind,revision,settings,steps,outputs,buffers,
        ...(snap.data !== undefined && {data:clone(snap.data)})});
    }

    function decode(saved) {
      check(saved?.format === format && saved.version === version && saved.kind === kind &&
        saved.revision === revision && equal(saved.settings,settings) &&
        Number.isSafeInteger(saved.steps) && saved.steps >= 0 && record(saved.buffers) &&
        equal(Object.keys(saved.buffers).sort(),Object.keys(shape).sort()), 'Snapshot does not match this prepared kernel');
      const outputs = values(spec.outputs,saved.outputs,true);
      const buffers = Object.fromEntries(Object.entries(shape).map(([name, expected]) => {
        const row = saved.buffers[name];
        check(keys(row,['type','length','base64']) && row.type === expected.type && row.length === expected.length,
          'Invalid kernel buffer layout for ' + name);
        return [name,unpack(row.base64,expected,name)];
      }));
      return {outputs, payload:{buffers,...(saved.data !== undefined && {data:clone(saved.data)})}};
    }

    function transact(action) {
      const before = current;
      try { return action(); }
      catch (error) {
        if (before) {
          try { kernel.restore(decode(before).payload); }
          catch (cause) { throw Error('Kernel rollback failed after: ' + error.message,{cause}); }
        }
        throw error;
      }
    }

    function reset() {
      return transact(() => current = state(values(spec.outputs,kernel.reset(),true),0));
    }
    function advance(context = {}) {
      const steps = current.steps+1, {tick = steps, time = tick*dt, dt:step = dt} = context;
      check(Number.isSafeInteger(steps) && Number.isSafeInteger(tick) && tick > 0 &&
        Number.isFinite(time) && time >= 0 && Number.isFinite(step) && step > 0, 'Invalid kernel advance time');
      const input = values(spec.inputs,context.input ?? {},false);
      const random = context.random ?? (key => P.data.hash(instance+'/'+tick+'/'+String(key),seed)/4294967296);
      return transact(() => {
        const outputs = values(spec.outputs,kernel.advance({...context,tick,time,dt:step,input,random}),true);
        current = state(outputs,steps);
        return outputs;
      });
    }
    function restore(saved) {
      if (saved === current) return current;
      const {outputs,payload} = decode(saved);
      return transact(() => {
        kernel.restore(payload);
        const after = state(outputs,saved.steps);
        check(equal(after.buffers,saved.buffers) && equal(after.data,saved.data), 'Kernel restore did not reproduce its snapshot');
        return current = after;
      });
    }
    reset();
    return Object.freeze({advance,reset,snapshot:()=>current,restore});
  }

  function worldProvider(spec) {
    return (config,{id,world}) => {
      let session;
      const open = () => session ??= prepare(spec.kind,spec.revision,config,{id,seed:world.seed,dt:world.dt});
      return {
        inputs:spec.inputs, outputs:spec.outputs, shareCheckpoint:true,
        kernel:{kind:spec.kind,revision:spec.revision,description:spec.description},
        initial:() => open().snapshot(),
        validateState:saved => { open().restore(saved); },
        step(saved,context) {
          const run = open();
          run.restore(saved);
          run.advance(context);
          return run.snapshot();
        },
        output:saved => saved.outputs
      };
    };
  }

  function graphOperation(spec, name) {
    const {kind,revision,description} = spec, T = P.takeTime;
    const outputPorts = Object.fromEntries(Object.entries(spec.outputs).map(([key, {type,quantity,description}]) =>
      [key,{type:types[type],...(quantity && {quantity}),...(description !== undefined && {description})}]));
    const opts = {type:'record',default:{}};
    const operation = {
      description,cacheVersion:revision,time:true,
      inputs:{config:opts, commands:{type:'array<record>',default:[],
        description:'Model input commands with tick, input, and value.',
        properties:Object.fromEntries(Object.entries(spec.inputs).map(([key,{type,...details}])=>
          [key,{type:types[type],...details}]))},
      clock:{...opts,properties:{tick:{type:'number',unit:'model tick'},dt:{type:'number',unit:'s'},seed:{type:'number'}}},
      checkpoint:{...opts,description:'Portable world checkpoint from the same kernel configuration and input schedule.'}},
      outputs:{...outputPorts,checkpoint:'record'},
      instantiate() {
        let run, prior;
        return ({config,commands,clock,checkpoint},{time,take}) => {
          const {tick,dt=1/60,seed=1} = clock;
          check(keys(clock,['tick','dt','seed']), 'Kernel graph clock accepts tick, dt and seed');
          const request = [config,commands,dt,seed,checkpoint];
          if (!prior || request.some((value,i)=>value!==prior[i])) {
            const alias = table => Object.fromEntries(Object.keys(table).map(key=>[key,'solver/'+key]));
            const model = {format:W.models.format,version:1,id:kind,revision,seed,numerics:{dt},
              domain:{},parameters:{},initial:{},boundaries:{},operators:{solver:{kind,revision,config}},
              inputs:alias(spec.inputs),outputs:alias(spec.outputs),commands,probes:{}};
            run = W.models.session(model,{...(Object.keys(checkpoint).length && {checkpoint})});
            prior = request;
          }
          const at = tick === undefined ? (take === undefined ? Math.floor(time/dt + 1e-10) :
            T.index(T.roundDown(T.div(T.requireFrame(take).start,T.period(dt))))) : tick;
          run.seek(at);
          const {outputs} = W.models.sample(run);
          return {...outputs,checkpoint:run.checkpoint()};
        };
      }
    };
    if (spec.example) {
      const output = Object.keys(spec.outputs)[0] ?? 'checkpoint';
      operation.example = freeze({kind:'graph',project:{format:'ink-studio/graph-project',version:1,
        nodes:{example:{op:name,inputs:spec.example}},outputs:{value:{node:'example',port:output}}}});
    }
    return Object.freeze(operation);
  }

  function register(kind, spec) {
    const {revision = 1, description = 'Creator simulation kernel.', example} = spec ?? {};
    const name = 'kernel.' + kind + '.v' + revision;
    check(id(kind) && name.length <= 100 && positiveRevision(revision) && typeof description === 'string' &&
      keys(spec,['revision','description','inputs','outputs','prepare','example']) && typeof spec.prepare === 'function' &&
      (example === undefined || keys(example,['config','commands','clock'])), 'Invalid simulation kernel registration ' + name);
    const versions = kernels.get(kind) ?? new Map();
    check(!versions.has(revision), 'Duplicate simulation kernel ' + name);
    const inputs = ports(spec.inputs), outputs = ports(spec.outputs);
    check(!own(outputs,'checkpoint'),'Kernel output checkpoint is reserved for the graph snapshot');
    const def = freeze({kind,revision,description,inputs,outputs,prepare:spec.prepare,...(example && {example:clone(example)})});
    R.register(kind,worldProvider(def),{revision});
    versions.set(revision,def);
    kernels.set(kind,versions);
    operations.set(name,graphOperation(def,name));
    return name;
  }

  W.kernels = Object.freeze({register,prepare,format,operation:name => operations.get(name),
    graphOperations:() => Object.fromEntries(operations)});
})(KIT);
