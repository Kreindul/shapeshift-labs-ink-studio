/* Portable declarative asset packs and per-scene replacement stacks. */
(function (K) {
  const A = K.authoring, { clone, freeze } = A.data;
  const format = 'ink-studio/asset-pack';
  const identifier = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(value);
  const object = value => value && typeof value === 'object' && !Array.isArray(value);

  function manifest(input) {
    const value = clone(typeof input === 'string' ? JSON.parse(input) : input);
    if (!object(value) || value.format !== format || value.version !== 1 || !identifier(value.id) ||
        !Number.isSafeInteger(value.revision) || value.revision < 1 ||
        typeof value.title !== 'string' || !value.title.trim() || value.title.length > 100 ||
        !Array.isArray(value.families) || !value.families.length)
      throw Error('Invalid versioned asset pack');
    const registry = A.assets();
    registry.load({ format: 'ink-studio/asset-families', version: 1, families: value.families });
    const families = registry.list();
    for (const family of families) {
      if (!family.id.startsWith(value.id + '/') || !identifier(family.id.slice(value.id.length + 1)))
        throw Error('Asset family must be namespaced by its pack: ' + family.id);
    }
    const replacements = value.replacements ?? {};
    if (!object(replacements)) throw Error('Pack replacements must be a map');
    for (const [from, to] of Object.entries(replacements)) {
      if (!from.trim() || !registry.get(to)) throw Error('Replacement must name a family in its own pack');
    }
    return freeze({ format, version: 1, id: value.id, revision: value.revision, title: value.title.trim(),
      families, replacements });
  }

  // Live imports can update the contents of a family while scenes retain its ID.
  function reviseFamily(input, id, changes) {
    const pack = manifest(input), index = pack.families.findIndex(f => f.id === id);
    if (index === -1) throw Error('Unknown asset family: ' + id);
    const fields = ['label','tags','bounds','sockets','variants'];
    if (!object(changes) || Object.keys(changes).some(key => !fields.includes(key)))
      throw Error('Asset revision needs editable family fields');

    const previous = pack.families[index], families = pack.families.slice();
    families[index] = { ...previous, ...changes };
    const staged = manifest({ ...pack, families });
    const compare = value => JSON.stringify(value, (_, node) => object(node)
      ? Object.fromEntries(Object.keys(node).sort().map(key => [key,node[key]]))
      : node);
    if (compare(previous) === compare(staged.families[index])) return pack;

    families[index] = { ...staged.families[index], version: previous.version + 1 };
    return manifest({ ...pack, revision: pack.revision + 1, families });
  }

  function create({ families = [], packs = [] } = {}) {
    if (!Array.isArray(families) || !Array.isArray(packs)) throw Error('Asset catalog needs family and pack arrays');
    const registry = A.assets();
    registry.load({ format: 'ink-studio/asset-families', version: 1, families });
    const extensions = new Map(), owners = new Map();
    for (const raw of packs) {
      const pack = manifest(raw);
      if (extensions.has(pack.id)) throw Error('Duplicate asset pack: ' + pack.id);
      for (const family of pack.families) {
        if (registry.get(family.id)) throw Error('Duplicate asset family: ' + family.id);
        registry.register(family);
        owners.set(family.id, pack.id);
      }
      extensions.set(pack.id, pack);
    }
    const listed = registry.list(), byId = new Map(listed.map(family => [family.id, family]));
    for (const pack of extensions.values()) {
      for (const [from, to] of Object.entries(pack.replacements)) {
        if (!registry.compatible(from, to)) throw Error('Incompatible asset replacement: ' + from + ' → ' + to);
      }
      compile([pack.id]);
    }

    function compile(enabled = []) {
      if (!Array.isArray(enabled) || !Array.from(enabled).every(identifier) || new Set(enabled).size !== enabled.length)
        throw Error('Asset pack selection needs unique IDs');
      const missing = [], replacements = Object.create(null);
      for (const id of enabled) {
        const pack = extensions.get(id);
        if (!pack) missing.push(id);
        else Object.assign(replacements, pack.replacements);
      }
      const scene = { environment: { assetReplacements: replacements } }, resolved = new Map();
      for (const id of Object.keys(replacements)) resolved.set(id, registry.resolve(scene, id));
      const resolve = id => resolved.get(id) ?? byId.get(id) ?? null;
      return Object.freeze({
        missing: Object.freeze(missing),
        replacements: Object.freeze({ ...replacements }),
        resolve,
        choose(id, key, seed, variant) {
          const family = resolve(id);
          if (!family) return null;
          const requested = family.variants.some(item => item.id === variant) ? variant : undefined;
          return registry.choose(family.id, key, seed, requested);
        }
      });
    }
    return Object.freeze({
      packs: Object.freeze([...extensions.values()]),
      families: listed,
      get: id => byId.get(id) ?? null,
      owner: id => owners.get(id) ?? null,
      compile
    });
  }
  A.assetPacks = Object.freeze({ create, manifest, reviseFamily });
})(KIT);
