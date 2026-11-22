/* Versioned simulation definitions compile to the ordinary world runtime. */
(function (K) {
  const W = K.world;
  const {check, copy, endpoint, id, own, read, record, selector, vector} = W.data;
  const {freeze} = K.procedural.data;
  const format = 'ink-studio/simulation-model';
  const version = 1;
  const sections = ['domain', 'parameters', 'initial', 'boundaries'];
  const revision = value => Number.isSafeInteger(value) && value > 0;
  const fields = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key));

  function entries(value, label) {
    check(record(value) && Object.keys(value).every(id), 'Invalid model ' + label + ' names');
    return Object.entries(value);
  }

  function bindings(value, source) {
    if (Array.isArray(value)) return value.map(item => bindings(item, source));
    if (!record(value) || value.format === format) return value;
    if (own(value, '$model')) {
      check(Object.keys(value).length === 1 && typeof value.$model === 'string',
        'Expected a single $model JSON Pointer');
      const path = selector(value.$model);
      check(sections.includes(path[0]), 'Unknown model binding section: ' + path[0]);
      const result = read(source, path);
      check(result !== undefined, 'Unresolved model binding: ' + value.$model);
      return result;
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, bindings(item, source)]));
  }

  function probeTarget(at) {
    return at === undefined || vector(at) || fields(at, ['point', 'entity', 'socket']) &&
      (at.entity !== undefined ? id(at.entity) && at.point === undefined &&
        (at.socket === undefined || id(at.socket)) : vector(at.point) && at.socket === undefined);
  }

  function compile(raw) {
    const source = copy(raw);
    check(fields(source, ['format', 'version', 'id', 'revision', 'seed', 'numerics', ...sections,
      'operators', 'inputs', 'outputs', 'probes', 'connections', 'commands', 'world']) &&
      source.format === format && source.version === version && id(source.id) && revision(source.revision) &&
      Number.isSafeInteger(source.seed), 'Expected an Ink Studio simulation model with a supported version, ID, revision and integer seed');
    check(sections.every(key => record(source[key])), 'Model needs domain, parameters, initial and boundaries records');
    const {numerics} = source;
    check(fields(numerics, ['dt']) && Number.isFinite(numerics.dt) && numerics.dt > 0 && numerics.dt <= 1,
      'Model numerics needs an explicit timestep in (0, 1]');
    check(source.world === undefined || fields(source.world, ['entities', 'visual', 'assetPacks', 'metadata']),
      'Model world may supply entities, visual settings, asset packs and metadata');

    const systems = Object.fromEntries(entries(source.operators, 'operator').map(([name, spec]) => {
      check(fields(spec, ['kind', 'revision', 'config', 'schedule', 'contract']) && id(spec.kind) &&
        revision(spec.revision) && record(spec.config ?? {}), 'Model operator ' + name + ' needs a kind and pinned revision');
      const {revision: operatorRevision, ...settings} = bindings(spec, source);
      return [name, {...settings, operatorRevision}];
    }));
    check(Object.keys(systems).length > 0, 'A model needs at least one operator');

    for (const key of ['inputs', 'outputs'])
      for (const [, port] of entries(source[key], key)) endpoint(port);
    for (const [name, probe] of entries(source.probes, 'probe'))
      check(fields(probe, ['field', 'at', 'args']) && typeof probe.field === 'string' && probe.field.length > 0 &&
        probeTarget(probe.at) && (probe.args === undefined || record(probe.args)), 'Invalid model probe ' + name);
    check(Array.isArray(source.commands ?? []), 'Model commands must be an array');
    const commands = (source.commands ?? []).map(command => {
      check(fields(command, ['tick', 'input', 'value', 'id']) && own(command, 'value') &&
        id(command.input) && own(source.inputs, command.input), 'Model command needs a named input and value');
      const {input, value, ...timing} = command;
      return {...timing, action: 'world/input', args: {port: source.inputs[input], value: bindings(value, source)}};
    });

    const {id: name, revision: assetRevision, inputs, outputs, probes} = source;
    return W.manifest({
      ...bindings(source.world ?? {}, source), id: name, seed: source.seed, dt: numerics.dt,
      systems, connections: source.connections ?? [], commands,
      simulationModel: {id: name, version, revision: assetRevision, inputs, outputs, probes}
    });
  }

  function checkInterface(world, ports, incoming, systems) {
    const model = world.simulationModel;
    for (const [name, port] of entries(model.inputs, 'input'))
      check(own(ports.inputs, port) && !incoming.has(port), 'Model input ' + name + ' needs an unconnected input port: ' + port);
    for (const [name, port] of entries(model.outputs, 'output'))
      check(own(ports.outputs, port), 'Unknown port for model output ' + name + ': ' + port);
    const query = W.query.create({world}, systems);
    for (const [name, probe] of entries(model.probes, 'probe'))
      check(query.field(probe.field), 'Unknown field for model probe ' + name + ': ' + probe.field);
  }

  function sample(run) {
    const {world, tick, time, signals} = run.view(), model = world.simulationModel;
    check(model, 'This run has no simulation model interface');
    const outputs = Object.fromEntries(Object.entries(model.outputs).map(([name, port]) => [name, signals[port]]));
    return freeze({id: model.id, revision: model.revision, tick, time, outputs, probes: sampleProbes(model, run.query())});
  }

  function sampleProbes(model, query) {
    return Object.fromEntries(Object.entries(model.probes).map(([name, spec]) =>
      [name, query.probe(spec.field, spec.at, spec.args)]));
  }

  function command(world, input, value, tick) {
    const port = world.simulationModel?.inputs;
    check(id(input) && own(port, input), 'Unknown model input ' + input);
    return {tick, action: 'world/input', args: {port: port[input], value: copy(value)}};
  }

  function session(model, {checkpoint, commands = [], checkpointEvery, checkpointCache} = {}) {
    const world = compile(model);
    check(checkpoint === undefined || checkpoint.format === W.runtime.checkpointFormat &&
      W.data.equal(checkpoint.world, world), 'Checkpoint does not match this simulation model');
    check(Array.isArray(commands), 'Expected model input commands');
    const scheduled = commands.map(row => {
      check(fields(row, ['tick', 'input', 'value', 'id']) && own(row, 'value'), 'Invalid model input command');
      return {...command(world, row.input, row.value, row.tick), ...(row.id !== undefined && {id:row.id})};
    });
    return W.scrub.create(checkpoint ?? world, {commands:scheduled, checkpointEvery, checkpointCache});
  }

  function system(model, {drive = []} = {}) {
    check(model?.format === format, 'A simulation-model system needs an embedded model definition');
    return {kind: 'simulation-model', config: {model, drive}};
  }

  W.models = Object.freeze({format, compile, checkInterface, sample, command, session, system});
})(KIT);
