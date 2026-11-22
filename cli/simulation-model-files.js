/* Resolve pinned model references before a world is compiled or bundled. */
const fs = require('node:fs');
const path = require('node:path');

const format = 'ink-studio/simulation-model';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isModel = value => value?.format === format;

function reference(value) {
  if (!record(value) || !Object.hasOwn(value, 'file')) return;
  if (Object.keys(value).some(key => key !== 'file' && key !== 'revision') ||
      typeof value.file !== 'string' || !value.file.trim() || path.isAbsolute(value.file) ||
      path.win32.isAbsolute(value.file) || !Number.isSafeInteger(value.revision) || value.revision < 1)
    throw new TypeError('Simulation model references need a relative file and a pinned revision');
  return value;
}

function requireRevision(ref, model, file) {
  if (!isModel(model) || model.revision !== ref.revision)
    throw new Error('Expected simulation model revision ' + ref.revision + ' at ' + file);
}

function mapModels(document, resolve) {
  if (!record(document)) return document;

  function mapSection(owner, key, transform) {
    const section = owner[key];
    if (!record(section)) return owner;
    const entries = Object.entries(section).map(([name, value]) => [name, transform(value)]);
    return entries.some(([name, value]) => value !== section[name]) ? {...owner, [key]:Object.fromEntries(entries)} : owner;
  }

  function system(spec) {
    if (spec?.kind !== 'simulation-model') return spec;
    const before = spec.config?.model, ref = reference(before);
    const model = ref ? resolve(ref) : isModel(before) ? mapModels(before, resolve) : before;
    return model === before ? spec : {...spec, config:{...spec.config, model}};
  }

  if (isModel(document)) return mapSection(document, 'operators', system);
  return mapSection(mapSection(document, 'systems', system), 'prefabs',
    prefab => record(prefab) ? mapSection(prefab, 'systems', system) : prefab);
}

function embedModels(source, file, dependency = () => {}) {
  const active = new Set([fs.realpathSync(file)]), loaded = new Map();
  function visit(document, owner) {
    return mapModels(document, ref => {
      const location = path.resolve(path.dirname(owner), ref.file);
      dependency(location);
      const identity = fs.realpathSync(location);
      if (active.has(identity)) throw new Error('Simulation model file cycle at ' + location);
      let model = loaded.get(location);
      if (!model) {
        const raw = JSON.parse(fs.readFileSync(location,'utf8'));
        requireRevision(ref, raw, location);
        active.add(identity);
        model = visit(raw, location);
        active.delete(identity);
        loaded.set(location, model);
      } else requireRevision(ref, model, location);
      return model;
    });
  }
  return visit(source, path.resolve(file));
}

module.exports = {embedModels, mapModels, requireRevision, isModel};
