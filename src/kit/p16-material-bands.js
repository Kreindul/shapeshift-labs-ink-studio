/* Ordered material intervals in one coordinate axis. Geometry and renderers may
   share this selector; materials/patterns are JSON descriptors, not game assets. */
(function (K) {
  const A = K.procedural,
    { clone, freeze } = A.data,
    name = s => typeof s === 'string' && s.length > 0 && !['__proto__', 'prototype', 'constructor'].includes(s);
  A.materialBands = spec => {
    if (
      !spec ||
      typeof spec !== 'object' ||
      !Array.isArray(spec.layers) ||
      spec.layers.length > 128 ||
      !Number.isInteger(spec.axis ?? 1) ||
      (spec.axis ?? 1) < 0 ||
      (spec.axis ?? 1) > 2
    )
      throw new Error('Material bands need an axis and at most 128 intervals');
    const axis = spec.axis ?? 1,
      descriptor = raw => {
        const d = clone(raw);
        if (d && d.pattern === undefined) d.pattern = 'flat';
        if (!d || !name(d.material) || !name(d.pattern) || (d.id !== undefined && !name(d.id)))
          throw new Error('Material bands need named material/pattern descriptors');
        return d;
      },
      fallback = freeze(descriptor(spec.fallback));
    const layers = spec.layers
      .map((raw, i) => {
        const d = descriptor(raw);
        if (
          !Number.isFinite(d.min) ||
          !Number.isFinite(d.max) ||
          d.min >= d.max ||
          Math.abs(d.min) > 1e6 ||
          Math.abs(d.max) > 1e6
        )
          throw new Error('Material intervals need finite ordered bounds within 1e6');
        d.id = d.id === undefined ? 'band-' + i : d.id;
        if (!name(d.id)) throw new Error('Material interval needs a valid id');
        return freeze(d);
      })
      .sort((a, b) => a.min - b.min);
    if (new Set(layers.map(d => d.id)).size !== layers.length || layers.some((d, i) => i && d.min < layers[i - 1].max))
      throw new Error('Material intervals must not overlap or repeat ids');
    function at(point) {
      const value = typeof point === 'number' ? point : point?.[axis];
      if (!Number.isFinite(value)) throw new Error('Material lookup needs a finite coordinate');
      return layers.find(d => value >= d.min && value < d.max) || fallback;
    }
    function segments(min, max) {
      if (!Number.isFinite(min) || !Number.isFinite(max) || min > max)
        throw new Error('Material segment range must be finite and ordered');
      const cuts = [min, max, ...layers.flatMap(d => [d.min, d.max]).filter(v => v > min && v < max)].sort(
          (a, b) => a - b
        ),
        out = [];
      for (let i = 0; i < cuts.length - 1; i++)
        if (cuts[i + 1] > cuts[i])
          out.push(freeze(Object.assign({}, at((cuts[i] + cuts[i + 1]) / 2), { min: cuts[i], max: cuts[i + 1] })));
      return freeze(out);
    }
    return Object.freeze({ axis, layers: freeze(layers), fallback, at, segments });
  };
})(KIT);
