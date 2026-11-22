/* Curve detail settings and row-range remapping for native world assembly. */
const CurveLod = (() => {
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const number = (value, lo, hi) => Number.isFinite(value) && lo <= value && value <= hi;
  function check(ok, message) {
    if (!ok) throw new RangeError('Curve LOD: ' + message);
  }
  function range(value, name) {
    check(Array.isArray(value) && value.length === 2 && number(value[0], 0, 16) &&
      number(value[1], 0, 16) && value[0] < value[1], name + ' needs two increasing art-pixel thresholds in [0, 16]');
    return value.slice();
  }
  function prepare(value) {
    if (value === undefined || value === false) return;
    if (value === true) value = { simplify: [.16, .38] };
    check(record(value) && Object.keys(value).every(key => key === 'simplify' || key === 'aggregate'),
      'expected simplify or aggregate settings');
    const simplify = value.simplify === false || value.simplify === undefined ? undefined : range(value.simplify, 'simplification');
    const aggregate = value.aggregate;
    if (aggregate === undefined || aggregate === false) return simplify ? { simplify } : undefined;
    check(record(aggregate) && Object.keys(aggregate).every(key =>
      ['transition', 'pitch', 'width', 'color', 'opacity', 'samples'].includes(key)), 'invalid aggregate settings');
    const { pitch, width, color, opacity, samples = 24, transition = [.48, 1.35] } = aggregate;
    check((pitch === undefined || number(pitch, 1e-6, 1e5)) &&
      (width === undefined || number(width, 2e-6, 200)) &&
      (opacity === undefined || number(opacity, 0, 1)) && Number.isSafeInteger(samples) && samples >= 4 && samples <= 64,
    'invalid aggregate pitch, width, opacity or sample count');
    return { simplify, aggregate: { pitch, width, color, opacity, samples, transition: range(transition, 'aggregate transition') } };
  }

  function remap(records, indexAt) {
    if (!records?.length) return [];
    function span([first, end]) {
      const start = indexAt(first);
      if (start === undefined) return;
      for (let i = first + 1; i < end; i++) if (indexAt(i) !== start + i - first) return;
      return [start, start + end - first];
    }
    return records.flatMap(({ simplify, runs, aggregate }) => {
      const kept = runs.map(span).filter(Boolean);
      let coarse;
      if (aggregate) {
        const proxy = span(aggregate.proxy), detail = aggregate.detail.map(span);
        if (proxy && detail.every(Boolean)) coarse = { ...aggregate, proxy, detail };
      }
      return kept.length || coarse ? [{ simplify, runs: kept, aggregate: coarse }] : [];
    });
  }

  return Object.freeze({ prepare, remap });
})();
if (typeof module !== 'undefined') module.exports = CurveLod;
