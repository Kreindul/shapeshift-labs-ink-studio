/* Fit repeated pieces along paired profile edges. Sampling both rails at the
   same edge fractions keeps corners and wrapped seams continuous. */
(function (K) {
  const P = K.procedural || K.authoring;
  const { freeze } = P.data;
  const EPS = 1e-9;
  const mix = (a, b, t) => {
    if (t <= 0) return a;
    if (t >= 1) return b;
    return a.map((v, i) => v + (b[i] - v) * t);
  };

  function fittedRibbon({ inner, outer, pitch, gap = 0, closed = false, phase = 0, budget = 8192 } = {}) {
    const dimension = inner?.[0]?.length;
    if (
      ![2, 3].includes(dimension) ||
      !Array.isArray(inner) ||
      !Array.isArray(outer) ||
      inner.length !== outer.length ||
      inner.length < (closed ? 3 : 2) ||
      inner.length > 4096 ||
      ![inner, outer].every(rail =>
        Array.from(rail).every(
          point => Array.isArray(point) && point.length === dimension && Array.from(point).every(Number.isFinite)
        )
      ) ||
      !Number.isFinite(pitch) ||
      pitch <= 0 ||
      !Number.isFinite(gap) ||
      gap < 0 ||
      typeof closed !== 'boolean' ||
      !Number.isFinite(phase) ||
      phase < 0 ||
      phase >= 1 ||
      (!closed && phase !== 0) ||
      !Number.isSafeInteger(budget) ||
      budget < 1 ||
      budget > 65536
    )
      throw new Error('Fitted ribbons need matching finite rails, positive pitch and a bounded budget');
    const a = inner.map(point => point.slice());
    const b = outer.map(point => point.slice());
    const edges = [];
    let length = 0;
    for (let edge = 0; edge < a.length - (closed ? 0 : 1); edge++) {
      const next = (edge + 1) % a.length;
      const size = Math.hypot(...a[edge].map((v, axis) => a[next][axis] - v));
      if (size <= EPS || !Number.isFinite(length + size) || length + size === length)
        throw new Error('Fitted ribbons need distinct consecutive inner vertices');
      edges.push({ edge, next, start: length, size });
      length += size;
    }
    const count = Math.max(1, Math.round(length / pitch));
    const unit = length / count;
    if (count > budget || gap >= unit || unit <= EPS)
      throw new Error('Fitted ribbon exceeds its piece budget or joint width');
    const cells = Array.from({ length: count }, (_, index) => ({ key: String(index), index, fragments: [] }));
    const shift = phase * unit;
    let fragments = 0;
    for (const { edge, next, start, size } of edges) {
      const end = start + size;
      for (let i = Math.floor((start + shift) / unit); i * unit - shift < end - EPS; i++) {
        if (!closed && i >= count) break;
        const from = Math.max(start, i * unit - shift + (closed || i > 0 ? gap / 2 : 0));
        const to = Math.min(end, (i + 1) * unit - shift - (closed || i < count - 1 ? gap / 2 : 0));
        if (to - from <= EPS) continue;
        if (++fragments > budget) throw new Error('Fitted ribbon exceeds its fragment budget');
        const t0 = from === start ? 0 : (from - start) / size;
        const t1 = to === end ? 1 : (to - start) / size;
        const points = [
          mix(a[edge], a[next], t0),
          mix(a[edge], a[next], t1),
          mix(b[edge], b[next], t1),
          mix(b[edge], b[next], t0)
        ];
        cells[i % count].fragments.push({ edge, from, to, points });
      }
    }
    return freeze({ length, unit, cells, fragmentCount: fragments });
  }

  P.fittedRibbon = fittedRibbon;
})(KIT);
