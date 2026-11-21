/* Drive a native world and a graph from the same take frame. */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { readGraphProject } = require('./graph-project.js');
const { embed } = require('./data-inputs.js');
const files = require('./asset-files.js');

const format = 'ink-studio/take', checkpointFormat = 'ink-studio/take-checkpoint';
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function createTake({ clock: definition = {}, world, graph } = {}, {
  kit = require('../index.js').load(), checkpoint, maxSeekTicks = 36000
} = {}) {
  if (!Number.isSafeInteger(maxSeekTicks) || maxSeekTicks < 1 ||
      graph !== undefined && (typeof graph?.run !== 'function' || typeof graph?.plan !== 'function'))
    throw new TypeError('Expected a compiled take graph and a positive tick budget');
  const { KIT: K } = kit, W = K.world, runtime = W.runtime;
  const settings = K.procedural.data.freeze(K.procedural.data.clone(definition));
  const clock = K.timeDomains.take(settings);
  if (world !== undefined && !W.data.record(world)) throw new TypeError('Expected an Ink Studio world manifest');
  const source = world === undefined ? undefined :
    W.manifest({ ...world, dt: world.dt ?? clock.dt, takeClock: settings });
  if (source && source.dt !== clock.dt) throw new RangeError('Take simulation rate must match the world timestep');
  const identity = createHash('sha256').update(JSON.stringify([settings, source, graph?.plan().projectHash])).digest('hex');
  const restore = saved => runtime.create(saved.world, { checkpoint: saved });
  let run, lastFrame;
  if (checkpoint !== undefined) {
    if (checkpoint?.format !== checkpointFormat || checkpoint.version !== 1 || checkpoint.identity !== identity ||
        Boolean(checkpoint.world) !== Boolean(source))
      throw new TypeError('Checkpoint does not match this take');
    const at = clock.at(checkpoint.frame);
    if (source) {
      if (checkpoint.world.tick !== at.tick || !W.data.equal(checkpoint.world.world?.takeClock, settings) ||
          checkpoint.world.world.dt !== source.dt)
        throw new RangeError('Take checkpoint does not match its simulation tick or rate');
      run = restore(checkpoint.world);
    }
  } else if (source) run = runtime.create(source);
  const start = run?.checkpoint();

  function seek(index, { inputs, seed } = {}) {
    const frame = clock.at(index);
    let active = run;
    if (source && frame.tick < run.view().tick) {
      active = start.tick <= frame.tick ? restore(start) : runtime.create(source);
    }
    if (active && frame.tick - active.view().tick > maxSeekTicks)
      throw new RangeError('Take seek exceeds the simulation tick budget');
    const result = graph?.run({ take: frame, ...(inputs !== undefined && { inputs }), ...(seed !== undefined && { seed }) });
    const previous = active?.checkpoint();
    let view, timeline;
    try {
      view = active?.advance(frame.tick);
      timeline = active?.timeline?.forTake(frame);
    } catch (error) {
      if (active === run && run.view().tick !== previous.tick) run = restore(previous);
      throw error;
    }
    const discontinuity = frame.cut || lastFrame === undefined || !(index === lastFrame || index === lastFrame + 1);
    lastFrame = index;
    run = active;
    return { frame, timeline, world: view, events: active?.events, query: active?.query(), graph: result,
      render: { take: frame, resetRenderHistory: discontinuity } };
  }
  return Object.freeze({
    clock, seek,
    checkpoint() {
      if (lastFrame === undefined) throw new Error('Sample a take frame before saving a checkpoint');
      return { format: checkpointFormat, version: 1, identity, frame: lastFrame, ...(run && { world: run.checkpoint() }) };
    }
  });
}

function readTake(file, { kit = require('../index.js').load(), checkpoint, ...options } = {}) {
  const source = path.resolve(file), root = path.dirname(source), spec = read(source);
  if (spec?.format !== format || spec.version !== 1 ||
      Object.keys(spec).some(key => !['format', 'version', 'clock', 'world', 'graph'].includes(key)))
    throw new TypeError('Expected ink-studio/take version 1');
  const paths = [source];
  const resolve = name => {
    if (typeof name !== 'string' || !name) throw new TypeError('Take paths must name JSON files');
    const resolved = path.resolve(root, name);
    paths.push(resolved);
    return resolved;
  };
  let world, graph;
  if (spec.world !== undefined) {
    const worldFile = resolve(spec.world);
    world = read(worldFile);
    if (world.dataInputs !== undefined)
      world.dataInputs = embed(kit.KIT.dataInputs, world.dataInputs, worldFile, file => paths.push(file));
  }
  if (spec.graph !== undefined) {
    graph = readGraphProject(resolve(spec.graph), { kit, ...options });
    paths.push(...graph.sourceFiles());
  }
  return { take: createTake({ clock: spec.clock, world, graph }, { kit, checkpoint }), paths };
}

function command(pos, opt, settings) {
  const usage = 'Use take sample <take.json> --frame N [--resume checkpoint.json --checkpoint file.json --out report.json]';
  if (pos.length !== 2 || pos[0] !== 'sample' ||
      Object.entries(opt).some(([key, value]) => !['frame', 'resume', 'checkpoint', 'out'].includes(key) ||
        typeof value !== 'string' || !value.trim()) || !/^\d+$/.test(opt.frame ?? '')) throw new TypeError(usage);
  const checkpoint = opt.resume === undefined ? undefined : read(opt.resume);
  const { take, paths } = readTake(pos[1], { ...settings, checkpoint });
  if (opt.resume !== undefined) paths.push(path.resolve(opt.resume));
  const destinations = [opt.checkpoint, opt.out].filter(Boolean).map(file => path.resolve(file));
  const existing = [...paths, ...destinations].map(file => fs.statSync(file, { throwIfNoEntry: false }));
  if (new Set(destinations).size !== destinations.length || destinations.some((file, i) =>
    paths.includes(file) || existing[paths.length + i] && existing.slice(0, paths.length + i).some(other =>
      other?.ino === existing[paths.length + i].ino && other.dev === existing[paths.length + i].dev)))
    throw new Error('Take outputs must use separate files from each other and their sources');
  const sample = take.seek(Number(opt.frame));
  const { frame, timeline, world, events, graph } = sample;
  const report = { format: 'ink-studio/take-frame', version: 1, frame, timeline,
    ...(world && { world: { tick: world.tick, time: frame.simulationTime, events } }),
    ...(graph && { graph: graph.report }) };
  if (opt.checkpoint !== undefined) files.json(path.resolve(opt.checkpoint), take.checkpoint());
  if (opt.out !== undefined) files.json(path.resolve(opt.out), report);
  else process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (graph?.report.passed === false) process.exitCode = 2;
}

module.exports = { createTake, readTake, command };
