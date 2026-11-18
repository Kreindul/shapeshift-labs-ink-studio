/* Stable world-space candidates. Density reveals additional ranked slots rather
   than rerolling existing instances. A consumer supplies habitat/ownership data;
   this service knows nothing about vegetation, painting, terrain or rendering. */
(function (K) {
  const A = K.procedural;
  function parameters(raw = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Populations need configuration');
    const p = Object.assign(
      { spacing: 0.42, jitter: 0.9, slots: 4, seed: 0, maxCandidates: 160000, maxInstances: 16000 },
      A.data.clone(raw)
    );
    if (
      !Number.isFinite(p.spacing) ||
      p.spacing < 0.1 ||
      p.spacing > 8 ||
      !Number.isFinite(p.jitter) ||
      p.jitter < 0 ||
      p.jitter > 1 ||
      !Number.isSafeInteger(p.slots) ||
      p.slots < 1 ||
      p.slots > 8 ||
      !Number.isSafeInteger(p.seed) ||
      Math.abs(p.seed) > 4294967295 ||
      !Number.isSafeInteger(p.maxCandidates) ||
      p.maxCandidates < 1 ||
      p.maxCandidates > 500000 ||
      !Number.isSafeInteger(p.maxInstances) ||
      p.maxInstances < 1 ||
      p.maxInstances > 50000
    )
      throw new Error('Invalid population spacing, slots, seed or budgets');
    return A.data.freeze(p);
  }
  function bounds(b) {
    if (
      !b ||
      ![b.min, b.max].every(q => Array.isArray(q) && q.length === 3 && q.every(Number.isFinite)) ||
      b.min.some((v, i) => v > b.max[i]) ||
      [b.min[0], b.min[2], b.max[0], b.max[2]].some(v => Math.abs(v) > 1e6)
    )
      throw new Error('Populations need finite ordered bounds within the coordinate budget');
    return b;
  }
  function layout(regions, evaluate, raw = {}) {
    const p = parameters(raw);
    if (!Array.isArray(regions) || regions.length > 4096 || typeof evaluate !== 'function')
      throw new Error('Populations need bounded work regions and an evaluator');
    const cells = new Map(),
      instances = [];
    let candidates = 0;
    for (const region of regions) {
      const b = bounds(region),
        x0 = Math.floor(b.min[0] / p.spacing),
        x1 = Math.floor(b.max[0] / p.spacing),
        z0 = Math.floor(b.min[2] / p.spacing),
        z1 = Math.floor(b.max[2] / p.spacing);
      if ((x1 - x0 + 1) * (z1 - z0 + 1) * p.slots > p.maxCandidates)
        throw new Error('Population region exceeds its candidate budget');
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          cells.set(x + ':' + z, [x, z]);
          if (cells.size * p.slots > p.maxCandidates) throw new Error('Population exceeds its candidate budget');
        }
    }
    for (const [x, z] of [...cells.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]))
      for (let slot = 0; slot < p.slots; slot++) {
        const seed = p.seed + slot * 1291,
          point = [
            (x + 0.5 + (K.hash(x, z, seed + 17) - 0.5) * p.jitter) * p.spacing,
            (z + 0.5 + (K.hash(x, z, seed + 59) - 0.5) * p.jitter) * p.spacing
          ];
        if (
          !regions.some(
            b => point[0] >= b.min[0] && point[0] <= b.max[0] && point[1] >= b.min[2] && point[1] <= b.max[2]
          )
        )
          continue;
        candidates++;
        const candidate = A.data.freeze({
            key: x + ':' + z + ':' + slot,
            index: [x, z],
            slot,
            point,
            rank: (slot + K.hash(x, z, seed + 103)) / p.slots,
            seed: Math.floor(K.hash(x, z, seed + 137) * 2147483647),
            yaw: K.hash(x, z, seed + 173) * Math.PI * 2,
            scale: 0.8 + 0.4 * K.hash(x, z, seed + 211)
          }),
          sample = evaluate(...point, candidate);
        if (sample === null || sample === undefined) continue;
        if (
          !sample ||
          typeof sample !== 'object' ||
          Array.isArray(sample) ||
          !Number.isFinite(sample.density) ||
          sample.density < 0 ||
          sample.density > 1
        )
          throw new Error('Population samples need a density from zero to one');
        if (candidate.rank >= sample.density) continue;
        if (instances.length >= p.maxInstances) throw new Error('Population exceeds its instance budget');
        instances.push(A.data.freeze(Object.assign({}, candidate, { sample: A.data.clone(sample) })));
      }
    return A.data.freeze({ parameters: p, instances, sampling: { cells: cells.size, candidates } });
  }
  A.populations = { parameters, layout };
})(KIT);
