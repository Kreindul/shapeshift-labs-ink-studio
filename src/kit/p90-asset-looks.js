/* Resolve portable look templates at their use site. */
(function (K) {
  const A = K.authoring, { clone, freeze } = A.data;
  const assetId = /^[a-z][a-z0-9-]{0,47}\/[a-z][a-z0-9-]{0,47}$/;
  const parameter = /^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/;
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const fields = (value, allowed) => record(value) && Object.keys(value).every(key => allowed.includes(key));
  const fraction = value => Number.isFinite(value) && value >= 0 && value <= 1;
  const type = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;

  function substitute(value, params) {
    if (Array.isArray(value)) {
      let output;
      for (let i = 0; i < value.length; i++) {
        const next = substitute(value[i], params);
        if (next !== value[i]) (output ??= value.slice())[i] = next;
      }
      return output ?? value;
    }
    if (!record(value)) return value;
    if (Object.hasOwn(value, '$param')) {
      const name = value.$param;
      if (Object.keys(value).length !== 1 || typeof name !== 'string' || !Object.hasOwn(params, name))
        throw Error('Unknown or invalid look parameter: ' + name);
      return params[name];
    }
    let output;
    for (const [key, item] of Object.entries(value)) {
      const next = substitute(item, params);
      if (next !== item) (output ??= { ...value })[key] = next;
    }
    return output ?? value;
  }

  function definition(value, packId) {
    if (!fields(value, ['id', 'label', 'params', 'stack', 'palette']) || typeof value.id !== 'string' ||
        !assetId.test(value.id) || !value.id.startsWith(packId + '/') ||
        typeof value.label !== 'string' || !value.label.trim() || value.label.length > 100 ||
        (value.stack === undefined && value.palette === undefined))
      throw Error('A look needs a namespaced ID, label and color stack or palette');
    const { id, label, params = {}, stack, palette } = value;
    if (!record(params) || Object.keys(params).length > 64 || !Object.keys(params).every(name => parameter.test(name)))
      throw Error('Look parameters need named JSON defaults');
    if (stack !== undefined) {
      const resolved = substitute(stack, params);
      if (!record(resolved)) throw Error('A look color stack must be an object');
      ColorStack.normalize(resolved);
    }
    if (palette !== undefined && !fields(substitute(palette, params), ['palette', 'reserved', 'dither']))
      throw Error('A look palette needs palette constraint settings');
    return freeze({ id, label: label.trim(), params, ...(stack !== undefined && { stack }),
      ...(palette !== undefined && { palette }) });
  }

  function bind(binding, catalog) {
    if (binding === undefined || binding === false) return null;
    const value = typeof binding === 'string' ? { asset: binding } : binding;
    if (!fields(value, ['asset', 'revision', 'strength', 'palette', 'params']) || typeof value.asset !== 'string' ||
        !assetId.test(value.asset) || (value.revision !== undefined &&
          (!Number.isSafeInteger(value.revision) || value.revision < 1)))
      throw Error('Expected a look asset ID and optional positive pack revision');
    const entry = catalog?.getLook(value.asset);
    if (!entry) throw Error('Unknown look asset: ' + value.asset);
    const { look, revision } = entry;
    if (value.revision !== undefined && revision !== value.revision)
      throw Error('Look asset ' + value.asset + ' requires pack revision ' + value.revision + ', installed ' + revision);
    const { strength = 1, params = {}, palette } = value;
    if (!fraction(strength) || !record(params) || (palette !== undefined && palette !== false && !Array.isArray(palette)))
      throw Error('Look overrides need strength in [0, 1], a palette swatch list or false, and named parameters');
    for (const [name, item] of Object.entries(params)) {
      if (!Object.hasOwn(look.params, name)) throw Error('Unknown look parameter: ' + name);
      if (type(item) !== type(look.params[name])) throw Error('Look parameter ' + name + ' must be ' + type(look.params[name]));
    }
    const values = { ...look.params, ...clone(params) };
    const stack = look.stack === undefined ? undefined : ColorStack.normalize(substitute(look.stack, values));
    const policy = palette !== false && (look.palette !== undefined || palette !== undefined)
      ? { ...substitute(look.palette, values), ...(palette !== undefined && { palette: clone(palette) }) } : undefined;
    return freeze({ id: look.id, revision, strength,
      ...(stack && { stack: { ...stack, amount: strength * (stack.amount ?? 1) } }),
      ...(policy && { palette: policy }) });
  }

  function override(base, changes) {
    if (changes === undefined) return base;
    if (typeof changes === 'string' || changes === false || base === undefined || base === false) return changes;
    if (!record(changes)) throw Error('Expected a look binding override');
    const prior = typeof base === 'string' ? { asset: base } : base;
    if (changes.asset !== undefined && changes.asset !== prior.asset) return changes;
    return { ...prior, ...changes, ...(changes.params !== undefined && record(changes.params) &&
      { params: { ...prior.params, ...changes.params } }) };
  }

  function scene(look, catalog) {
    if (!look || !Object.hasOwn(look, 'asset')) return look;
    const { asset, ...inline } = look, bound = bind(asset, catalog);
    if (!bound?.strength) return inline;
    if (inline.paletteConstraints !== undefined && inline.paletteConstraints !== false && !record(inline.paletteConstraints))
      throw Error('Scene palette constraints must be an object or false');
    return {
      ...(bound.stack && { colorStack: bound.stack }),
      ...inline,
      ...(bound.palette && inline.paletteConstraints !== false && !Object.hasOwn(inline.paletteConstraints ?? {}, 'default') &&
        { paletteConstraints: { ...inline.paletteConstraints,
          default: bound.stack ? { ...bound.palette, source: 'graded' } : bound.palette } })
    };
  }

  function material(base, binding, catalog) {
    const bound = bind(binding, catalog);
    if (!bound?.strength || (!bound.stack && !bound.palette)) return base;
    return SurfaceLook.material(base, {
      ...(bound.stack && { layers: { lookAsset: { type: 'colorStack', stack: bound.stack } } }),
      ...(bound.palette && { paletteConstraint: bound.palette })
    });
  }

  A.looks = Object.freeze({ definition, bind, override, scene, material });
})(KIT);
