/* Atomic headless publication of the physical and rendered sides of a biome world. */
(function (K) {
  const P = K.procedural, { freeze } = P.data;
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const inputs = ['view', 'bricks', 'time', 'tiles', 'indices', 'sources', 'optics', 'meta'];
  const initialInputs = { bricks: null, time: 0, sources: [], meta: {} };

  function capture(change) {
    if (!change || typeof change !== 'object' || Array.isArray(change) ||
        Object.keys(change).some(key => !inputs.includes(key)))
      throw new TypeError('A biome revision needs an authored input patch');
    const input = { ...change };
    for (const key of ['tiles', 'indices', 'sources', 'meta']) {
      if (own(input, key) && input[key] !== undefined) input[key] = freeze(P.data.clone(input[key]));
    }
    if (input.optics && typeof input.optics !== 'function') input.optics = freeze(P.data.clone(input.optics));
    return input;
  }

  function create({ compiler, tiles, indices, sources = [], optics, meta = {}, span = {}, flood = {},
    agent = {}, brushGrid = {}, historyLimit = 16, derive } = {}) {
    if (typeof compiler?.realize !== 'function' || typeof compiler?.prepare !== 'function' ||
        typeof compiler?.makeWorld !== 'function' ||
        !Number.isSafeInteger(historyLimit) || historyLimit < 0 || historyLimit > 128 ||
        (derive !== undefined && typeof derive !== 'function'))
      throw new TypeError('Biome revisions need a compiler, bounded history, and an optional derivation callback');
    const defaults = capture({ tiles, indices, sources, optics, meta });
    const spanOptions = Object.freeze({ ...span, volumes: span.volumes?.map(row => Object.freeze({ ...row,
      current: Array.isArray(row.current) ? Object.freeze(row.current.slice()) : row.current
    })) });
    const floodOptions = freeze(P.data.clone(flood));
    const traversal = agent === false ? false : Object.freeze({ ...agent, origin: agent.origin?.slice() });
    const brickOptions = freeze(P.data.clone(brushGrid));
    const revisions = new WeakMap(), undoStack = [], redoStack = [];
    let current = null, number = 0, queue = Promise.resolve();

    function enqueue(task) {
      const pending = queue.then(task);
      queue = pending.catch(() => {});
      return pending;
    }

    function commit(change, { clock } = {}) {
      if (clock !== undefined && typeof clock !== 'function') throw new TypeError('Expected a revision clock');
      const edit = typeof change === 'function' ? change : capture(change);
      return enqueue(async () => {
        const timings = {};
        async function stage(name, run) {
          const start = clock?.(), result = await run();
          if (clock) timings[name] = clock() - start;
          return result;
        }
        const before = current, old = revisions.get(before);
        const patch = typeof edit === 'function' ? capture(await stage('edit', () => edit(before))) : edit;
        const input = { ...initialInputs, ...defaults, ...old?.input, ...patch };
        if (!Array.isArray(input.tiles) || !input.tiles.length || !Array.isArray(input.indices))
          throw new TypeError('A biome revision needs span tile descriptions and chunk indices');
        const dry = compiler.prepare(input.view, { bricks: input.bricks, time: input.time });
        const intent = old && dry.view.changesFrom(old.dry.view);
        let dirtyBounds;
        if (old && !intent.global && input.time === old.input.time) {
          const brickChanges = input.bricks?.changesFrom(old.input.bricks) ?? old.input.bricks?.changesFrom(null) ?? [];
          const yMin = Math.min(...input.tiles.map(tile => tile.bounds.min[1]));
          const yMax = Math.max(...input.tiles.map(tile => tile.bounds.max[1]));
          dirtyBounds = [...brickChanges, ...intent.regions.map(({ min, max }) => ({
            min: [min[0], yMin, min[2]], max: [max[0], yMax, max[2]]
          }))];
        }
        const spans = await stage('spans', () => dry.bakeSpanTiles({ ...spanOptions, tiles: input.tiles,
          previous: before?.spans, dirtyBounds }));
        const filled = await stage('fill', () => P.spanFlood.create({ ...floodOptions,
          tiles: spans.tiles, sources: input.sources, previous: before?.flood }));
        const water = await stage('water', () => P.waterBodies.sceneFromSpans(filled.tiles, {
          optics: input.optics, previous: before?.water
        }));
        const frame = compiler.prepare(input.view, { water, bricks: input.bricks, time: input.time, geometryFrom: dry });
        const graph = traversal && await stage('graph', () => frame.traversalGraph({ ...traversal,
          tiles: filled.tiles, previous: before?.graph || undefined, dirtyBounds }));
        const chunks = await stage('chunks', () => compiler.realize(frame, input.indices, { previous: old?.chunks }));
        const world = await stage('assembly', () => {
          const value = compiler.makeWorld(frame, chunks.chunks, { ...input.meta, traversalGraph: graph || undefined });
          return Object.freeze(value);
        });
        const snapshot = { id: number + 1, bricks: input.bricks, frame, spans, flood: filled, water,
          graph: graph || null, patch: chunks, chunks: chunks.chunks, world };
        const extra = derive && await stage('derive', () =>
          derive(Object.freeze({ ...snapshot, timings: Object.freeze({ ...timings }) }), before));
        const result = Object.freeze({ ...snapshot, extra, timings: Object.freeze(timings) });
        revisions.set(result, { input, dry, chunks });
        if (before && historyLimit) {
          undoStack.push(before);
          if (undoStack.length > historyLimit) undoStack.shift();
        }
        redoStack.length = 0;
        number++;
        current = result;
        return result;
      });
    }

    function sculpt(brush, options) {
      if (!brush || typeof brush !== 'object') throw new TypeError('Expected sparse brush options');
      const stroke = { ...brush, bounds: freeze(P.data.clone(brush.bounds)) };
      return commit(before => {
        if (!before) throw new Error('Publish an initial biome revision before sculpting');
        const bricks = before.bricks ?? P.sparseBricks.create({ ...brickOptions, base: revisions.get(before).dry.distance });
        return { bricks: bricks.edit(stroke) };
      }, options);
    }

    const history = (source, target) => enqueue(() => {
      if (!source.length) return null;
      target.push(current);
      current = source.pop();
      return current;
    });
    return Object.freeze({ current: () => current, commit, sculpt,
      undo: () => history(undoStack, redoStack), redo: () => history(redoStack, undoStack) });
  }

  P.biomeRevisions = Object.freeze({ create });
})(KIT);
