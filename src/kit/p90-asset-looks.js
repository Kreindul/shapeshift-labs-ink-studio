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
    if (!fields(value, ['id', 'label', 'params', 'stack', 'palette', 'mask']) || typeof value.id !== 'string' ||
        !assetId.test(value.id) || !value.id.startsWith(packId + '/') ||
        typeof value.label !== 'string' || !value.label.trim() || value.label.length > 100 ||
        (value.stack === undefined && value.palette === undefined))
      throw Error('A look needs a namespaced ID, label and color stack or palette');
    const { id, label, params = {}, stack, palette, mask } = value;
    if (!record(params) || Object.keys(params).length > 64 || !Object.keys(params).every(name => parameter.test(name)))
      throw Error('Look parameters need named JSON defaults');
    if (stack !== undefined) {
      const resolved = substitute(stack, params);
      if (!record(resolved)) throw Error('A look color stack must be an object');
      ColorStack.normalize(resolved);
    }
    if (palette !== undefined && !fields(substitute(palette, params), ['palette', 'reserved', 'dither']))
      throw Error('A look palette needs palette constraint settings');
    SplatEffects.prepareMask(substitute(mask, params), undefined, { validateOnly: true });
    return freeze({ id, label: label.trim(), params, ...(stack !== undefined && { stack }),
      ...(palette !== undefined && { palette }), ...(mask !== undefined && { mask }) });
  }

  function bind(binding, catalog) {
    if (binding === undefined || binding === false) return null;
    const value = typeof binding === 'string' ? { asset: binding } : binding;
    if (!fields(value, ['asset', 'revision', 'strength', 'palette', 'params', 'mask']) || typeof value.asset !== 'string' ||
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
    const mask = value.mask === undefined ? substitute(look.mask, values) : clone(value.mask);
    SplatEffects.prepareMask(mask, undefined, { validateOnly: true });
    return freeze({ id: look.id, revision, strength,
      ...(stack && { stack: { ...stack, amount: strength * (stack.amount ?? 1) } }),
      ...(policy && { palette: policy }), ...(mask && { mask }) });
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
    if (!look || (!Object.hasOwn(look, 'asset') && !Object.hasOwn(look, 'targets'))) return look;
    const { asset, targets = [], ...inline } = look, bound = bind(asset, catalog);
    if (inline.paletteConstraints !== undefined && inline.paletteConstraints !== false && !record(inline.paletteConstraints))
      throw Error('Scene palette constraints must be an object or false');
    if (!Array.isArray(targets) || targets.length > 63) throw Error('Expected up to 63 look targets');
    const rules = [];
    for (const rule of targets) {
      if (!fields(rule, ['select', 'asset', 'mask']) || !Object.hasOwn(rule, 'asset')) throw Error('A look target needs select and asset');
      const binding = rule.mask === undefined || rule.asset === false ? rule.asset : override(rule.asset, { mask: rule.mask });
      const select = TargetSelectors.prepare(rule.select), target = bind(binding, catalog);
      if (target?.strength && (target.stack || target.palette))
        rules.push({ ...target.palette, select, stack: target.stack, assetId: target.id, ...(target.mask && { mask: target.mask }) });
    }
    const constraints = inline.paletteConstraints;
    const fallback = bound?.strength && (bound.palette || bound.mask) && !Object.hasOwn(constraints || {}, 'default')
      ? { default: bound.mask ? { ...bound.palette, stack: bound.stack, mask: bound.mask, assetId: bound.id } :
        bound.stack ? { ...bound.palette, source: 'graded' } : bound.palette } : {};
    return {
      ...(bound?.strength && bound.stack && !bound.mask && { colorStack: bound.stack }),
      ...inline,
      ...(constraints !== false && (rules.length || fallback.default) && {
        paletteConstraints: { ...constraints, ...fallback, ...(rules.length && { targets: [...(constraints?.targets ?? []), ...rules] }) }
      })
    };
  }

  function material(base, binding, catalog) {
    const bound = bind(binding, catalog);
    if (!bound?.strength || (!bound.stack && !bound.palette)) return base;
    return SurfaceLook.material(base, {
      lookAssetId: bound.id,
      ...(bound.stack && !bound.mask && { layers: { lookAsset: { type: 'colorStack', stack: bound.stack } } }),
      ...(bound.mask ? { paletteConstraint: { ...bound.palette, ...(bound.stack && { stack: bound.stack }), mask: bound.mask } } :
        bound.palette && { paletteConstraint: bound.palette })
    });
  }

  A.looks = Object.freeze({ definition, bind, override, scene, material });
})(KIT);
