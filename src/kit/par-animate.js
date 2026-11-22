/* Headless stock simulation nodes keep their sessions between graph samples. */
(function (K) {
  const P = K.procedural;
  const S = P.rasterSimulation, A = P.animationGraph, T = P.takeTime;
  function tickAt(time, dt, take) {
    if (take === undefined) return S.tickAt(time, dt);
    const timing = T.requireFrame(take);
    if (dt === timing.dt) return take.tick;
    if (dt === timing.frameDt) return take.frame;
    return T.index(T.roundDown(T.div(timing.start, T.period(dt))));
  }
  const options = { type: 'record', default: {} };
  const outputs = { value: 'raster', field: 'raster', points: 'array<record>', checkpoint: 'record', report: 'record' };

  S.operations = Object.freeze({
    'sim.define': {
      seed: 'clock',
      inputs: { kind: 'string', settings: options, clock: options }, outputs: { value: 'record' },
      run({ kind, settings, clock }, { seed }) { return { value: S.define(kind, settings, { seed, ...clock }) }; }
    },
    'sim.run': {
      inputs: { recipe: options, checkpoint: options, options }, outputs, time: true,
      instantiate() {
        let current, priorRecipe, priorCheckpoint, priorEvery, priorCache;
        return ({ recipe, checkpoint, options }, { time, take }) => {
          const { time: selected = time, every, cache } = options;
          if (priorRecipe !== recipe || priorCheckpoint !== checkpoint || priorEvery !== every || priorCache !== cache) {
            current = S.session(Object.keys(recipe).length ? recipe : undefined,
              { checkpoint: Object.keys(checkpoint).length ? checkpoint : undefined, every, cache });
            [priorRecipe, priorCheckpoint, priorEvery, priorCache] = [recipe, checkpoint, every, cache];
          }
          return current.seekTick(tickAt(selected, current.recipe.dt, options.time === undefined ? take : undefined));
        };
      }
    },
    'sim.model': {
      description: 'Sample a versioned simulation model and its named outputs and probes on the graph clock.',
      inputs: {
        model: {type:'record', description:'An ink-studio/simulation-model, such as a JSON graph asset.'},
        commands: {type:'array<record>', default:[], description:'Named input commands at absolute model ticks.'},
        checkpoint: {...options, description:'Resume from a checkpoint of this model.'},
        options: {...options, properties:{
          tick:{type:'number', unit:'model tick', constraints:{integer:true,min:0}},
          checkpointEvery:{type:'number', unit:'model ticks', constraints:{integer:true,min:1}},
          checkpointCache:{type:'number', unit:'checkpoints', constraints:{integer:true,min:0,max:128}}
        }}
      },
      outputs: {value:'record', outputs:'record', probes:'record', checkpoint:'record'}, time: true,
      instantiate() {
        let current, prior;
        return ({model, commands, checkpoint, options}, {time, take}) => {
          const {tick, checkpointEvery, checkpointCache} = options;
          if (Object.keys(options).some(key => !['tick','checkpointEvery','checkpointCache'].includes(key)))
            throw new TypeError('Unknown simulation model graph option');
          const settings = [model, commands, checkpoint, checkpointEvery, checkpointCache];
          if (!prior || settings.some((value, i) => value !== prior[i])) {
            current = K.world.models.session(model, {
              commands, checkpoint: Object.keys(checkpoint).length ? checkpoint : undefined, checkpointEvery, checkpointCache
            });
            prior = settings;
          }
          current.seek(tick === undefined ? tickAt(time, current.view().world.dt, take) : tick);
          const value = K.world.models.sample(current);
          return {value, outputs:value.outputs, probes:value.probes, checkpoint:current.checkpoint()};
        };
      }
    },
    'anim.feedback': {
      seed: true,
      inputs: { frames: 'array<raster>', flow: { type: 'array<raster>', default: [] }, options }, outputs, time: true,
      instantiate() {
        let current, priorFrames, priorFlow, priorOptions, priorSeed, priorSequence, previousTick, firstTick = 0;
        return ({ frames, flow, options }, { time, seed, take, sequence }) => {
          const { dt, every, cache, maxTicks, time: localTime, ...settings } = options;
          const at = tickAt(localTime ?? time, dt ?? 1 / 48, localTime === undefined ? take : undefined);
          const changed = priorFrames !== frames || priorFlow !== flow || priorOptions !== options || priorSeed !== seed;
          const reset = priorSequence !== sequence || sequence !== undefined && at < previousTick;
          if (reset) firstTick = sequence === undefined ? 0 : at;
          if (changed || reset) {
            current = S.session(S.define('feedback', { ...settings, frames, ...(flow.length && { flow }) }, { seed, dt, maxTicks }),
              { every, cache, firstTick });
            [priorFrames, priorFlow, priorOptions, priorSeed, priorSequence] = [frames, flow, options, seed, sequence];
          }
          const result = current.seekTick(at);
          previousTick = at;
          return result;
        };
      }
    }
  });
  A.operations = Object.freeze(A.operations);
  A.groupOperators = Object.freeze(['anim.retime']);
  delete P.rasterSimSupport;
})(KIT);
