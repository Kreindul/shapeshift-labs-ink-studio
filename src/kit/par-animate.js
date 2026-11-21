/* Headless stock simulation nodes keep their sessions between graph samples. */
(function (P) {
  const S = P.rasterSimulation, A = P.animationGraph, T = P.takeTime;
  function sample(session, time, take) {
    if (take === undefined) return session.seek(time);
    const timing = T.requireFrame(take);
    const tick = session.recipe.dt === timing.dt ? take.tick :
      T.index(T.roundDown(T.div(timing.start, T.period(session.recipe.dt))));
    return session.seekTick(tick);
  }
  const options = { type: 'record', default: {} };
  const outputs = { value: 'raster', field: 'raster', points: 'array<record>', checkpoint: 'record', report: 'record' };

  S.operations = Object.freeze({
    'sim.define': {
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
          return sample(current, selected, options.time === undefined ? take : undefined);
        };
      }
    },
    'anim.feedback': {
      inputs: { frames: 'array<raster>', options }, outputs, time: true,
      instantiate() {
        let current, priorFrames, priorOptions, priorSeed;
        return ({ frames, options }, { time, seed, take }) => {
          if (priorFrames !== frames || priorOptions !== options || priorSeed !== seed) {
            const { dt, every, cache, maxTicks, time: _time, ...settings } = options;
            current = S.session(S.define('feedback', { ...settings, frames },
              { seed, dt, maxTicks }), { every, cache });
            [priorFrames, priorOptions, priorSeed] = [frames, options, seed];
          }
          return sample(current, options.time ?? time, options.time === undefined ? take : undefined);
        };
      }
    }
  });
  A.operations = Object.freeze(A.operations);
  A.groupOperators = Object.freeze(['anim.retime']);
  delete P.rasterSimSupport;
})(KIT.procedural);
