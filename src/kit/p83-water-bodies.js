/* A water frame shared by world queries and the WebGL ray integrator. */
(function (K) {
  const P = K.procedural;
  const maxAxis = 64, maxBodies = 8;
  const states = new WeakMap(), sceneStates = new WeakMap();
  const number = value => Number.isFinite(value) && Number.isFinite(Math.fround(value));
  const pair = value => Array.isArray(value) && value.length === 2 && number(value[0]) && number(value[1]);
  const unit = value => number(value) && value >= 0 && value <= 1;
  const name = value => typeof value === 'string' && value.trim().length > 0;
  const compare = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

  function optics({
    tint = [0.05, 0.25, 0.31], extinction = [0.8, 0.32, 0.18],
    surfaceColor = [0.46, 0.75, 0.79], surface = 0.22,
    refraction = 1.5, foam = 0.45, caustics = 0.26
  } = {}) {
    const rgb = values => Array.isArray(values) && values.length === 3 && Array.from(values).every(unit);
    if (!rgb(tint) || !rgb(surfaceColor) || !Array.isArray(extinction) || extinction.length !== 3 ||
        !Array.from(extinction).every(v => number(v) && v >= 0 && v <= 32) ||
        ![surface, foam, caustics].every(unit) || !number(refraction) || refraction < 0 || refraction > 4)
      throw new RangeError('Invalid water optics');
    return { tint: tint.slice(), extinction: extinction.slice(), surfaceColor: surfaceColor.slice(),
      surface, refraction, foam, caustics };
  }

  function create({ id, bounds, resolution = [1, 1], sample, optics: look } = {}) {
    if (!name(id) || !pair(bounds?.min) || !pair(bounds?.max) || !Array.isArray(resolution) ||
        resolution.length !== 2 || !Array.from(resolution).every(n => Number.isInteger(n) && n >= 1 && n <= maxAxis) ||
        typeof sample !== 'function')
      throw new TypeError('Water needs an ID, finite XZ bounds, a column sampler and a grid up to 64 × 64');
    const min = bounds.min.map(Math.fround), max = bounds.max.map(Math.fround);
    const [nx, nz] = resolution;
    const width = max[0] - min[0], length = max[1] - min[1];
    const dx = Math.fround(width / nx), dz = Math.fround(length / nz);
    if (!number(width) || !number(length) || !(dx > 0) || !(dz > 0))
      throw new RangeError('Water bounds need a positive extent representable on the GPU');
    const style = optics(look), data = new Float32Array(nx * nz * 4), wet = [];
    let low = Infinity, high = -Infinity;
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      const result = sample(min[0] + (x + 0.5) * dx, min[1] + (z + 0.5) * dz);
      if (result == null) continue;
      const { bed, surface, current = [0, 0] } = result;
      if (!number(bed) || !number(surface) || !pair(current) || !number(surface - bed))
        throw new RangeError('Water columns need finite bed, surface and XZ current');
      const bottom = Math.fround(bed), top = Math.fround(surface);
      if (top <= bottom) continue;
      const i = z * nx + x;
      data.set([bottom, top, ...current], i * 4);
      wet.push(i);
      low = Math.min(low, bottom);
      high = Math.max(high, top);
    }
    const extent = P.data.freeze({
      min: [min[0], wet.length ? low : 0, min[1]], max: [max[0], wet.length ? high : 0, max[1]]
    });
    function offsetAt(x, z) {
      if (!Number.isFinite(x) || !Number.isFinite(z) || x < min[0] || x >= max[0] || z < min[1] || z >= max[1]) return -1;
      return (Math.min(nz - 1, Math.floor((z - min[1]) / dz)) * nx +
        Math.min(nx - 1, Math.floor((x - min[0]) / dx))) * 4;
    }
    function columnAt(x, z) {
      const o = offsetAt(x, z);
      return o >= 0 && data[o + 1] > data[o] ? {
        bed: data[o], surface: data[o + 1], depth: data[o + 1] - data[o], current: [data[o + 2], 0, data[o + 3]]
      } : null;
    }
    const medium = Object.freeze({
      id, kind: 'water', bounds: extent,
      surface: (x, z) => data[offsetAt(x, z) + 1],
      sdf(x, y, z) {
        const o = offsetAt(x, z);
        return o >= 0 && data[o + 1] > data[o] ? Math.max(data[o] - y, y - data[o + 1]) : 1;
      },
      current(x, y, z) {
        const o = offsetAt(x, z);
        return [data[o + 2], 0, data[o + 3]];
      }
    });
    function shoreline() {
      const edges = [];
      const edge = (x0, z0, x1, z1, y) => [
        [Math.min(max[0], min[0] + x0 * dx), y, Math.min(max[1], min[1] + z0 * dz)],
        [Math.min(max[0], min[0] + x1 * dx), y, Math.min(max[1], min[1] + z1 * dz)]
      ];
      const hasWater = (x, z) => {
        const o = (z * nx + x) * 4;
        return x >= 0 && x < nx && z >= 0 && z < nz && data[o + 1] > data[o];
      };
      for (const i of wet) {
        const x = i % nx, z = Math.floor(i / nx), y = data[i * 4 + 1];
        if (!hasWater(x - 1, z)) edges.push(edge(x, z + 1, x, z, y));
        if (!hasWater(x + 1, z)) edges.push(edge(x + 1, z, x + 1, z + 1, y));
        if (!hasWater(x, z - 1)) edges.push(edge(x, z, x + 1, z, y));
        if (!hasWater(x, z + 1)) edges.push(edge(x + 1, z + 1, x, z + 1, y));
      }
      return edges;
    }
    // Use the same immutable wet cells for art emission and medium queries.
    function particles({ count = 64, seed = 0 } = {}) {
      if (!Number.isInteger(count) || count < 0 || count > 10000 || !Number.isSafeInteger(seed))
        throw new RangeError('Water particles need a count from 0 to 10000 and an integer seed');
      const dice = K.grow.dice(P.data.hash(id, seed));
      return Array.from({ length: wet.length ? count : 0 }, () => {
        const i = wet[Math.floor(dice() * wet.length)], o = i * 4;
        const x = min[0] + (i % nx + 0.1 + 0.8 * dice()) * dx;
        const z = min[1] + (Math.floor(i / nx) + 0.1 + 0.8 * dice()) * dz;
        const y = data[o] + (data[o + 1] - data[o]) * (0.1 + 0.8 * dice());
        return { position: [x, y, z], current: [data[o + 2], 0, data[o + 3]] };
      });
    }
    const body = Object.freeze({ id, bounds: extent, columnAt, medium, shoreline, particles });
    states.set(body, { nx, nz, dx, dz, data, style, empty: !wet.length });
    return body;
  }

  function fromShallowWater(snapshot, { id, resolution = [snapshot?.width, snapshot?.height], optics } = {}) {
    if (typeof snapshot?.sample !== 'function') throw new TypeError('Expected a shallow-water snapshot');
    return create({
      id, bounds: snapshot.bounds, resolution, optics,
      sample(x, z) {
        const local = snapshot.sample(x, z);
        return local?.depth > 0 ? { bed: local.bed, surface: local.level, current: local.velocity } : null;
      }
    });
  }

  function fromSpans(grid, { id, optics: look } = {}) {
    if (!name(id) || !P.verticalSpans.isGrid(grid) || grid.resolution.some(n => n > maxAxis))
      throw new TypeError('Layered water needs an ID and a span grid up to 64 × 64');
    const [nx, nz] = grid.resolution, [dx, dz] = grid.cell, { min, max } = grid.bounds;
    const data = new Float32Array(nx * nz * 4), spans = [], labels = new Map();
    let low = Infinity, high = -Infinity;
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      const column = grid.column(x, z), start = spans.length / 4;
      let count = 0, lower = 0, upper = 0;
      column.forEach((row, i) => {
        if (row.kind === 'solid' || (row.kind === 'air' && row.id === null)) return;
        const key = row.id ?? id;
        if (labels.has(key) && labels.get(key) !== row.kind)
          throw new TypeError('Each span medium ID must refer to one kind');
        labels.set(key, row.kind);
        if (row.kind !== 'water') return;
        if (count >= 32) throw new RangeError('Layered water supports up to 32 wet spans per column');
        if (!column[i + 1] || column[i + 1].kind === 'air') {
          if (count < 16) lower |= 1 << count;
          else upper |= 1 << (count - 16);
        }
        count++;
        low = Math.min(low, row.min);
        high = Math.max(high, row.max);
        spans.push(row.min, row.max, row.current[0], row.current[2]);
      });
      data.set([start, count, lower, upper], (z * nx + x) * 4);
    }
    const bounds = P.data.freeze({
      min: [min[0], spans.length ? low : min[1], min[2]], max: [max[0], spans.length ? high : min[1], max[2]]
    });
    const media = Object.freeze(Array.from(labels, ([key, kind]) => {
      const medium = { id: key, kind, bounds: grid.bounds, sdf(x, y, z) {
        const row = grid.at(x, y, z);
        return row?.kind === kind && (row.id ?? (kind === 'water' ? id : null)) === key ? -1 : 1;
      } };
      if (kind === 'air') return Object.freeze({ ...medium, priority: 1 });
      return Object.freeze({ ...medium, surfaceAt(x, y, z) {
        let row = grid.at(x, y, z);
        do {
          y = row.max;
          row = grid.at(x, y, z);
        } while (row?.kind === 'water');
        return y;
      },
        current: (x, y, z) => grid.at(x, y, z).current });
    }));
    const body = Object.freeze({ id, bounds, grid, media });
    states.set(body, { nx, nz, dx, dz, data, style: optics(look), empty: !spans.length, spans: Float32Array.from(spans) });
    return body;
  }

  function pocket({ id, bounds: source } = {}) {
    const triplet = v => Array.isArray(v) && v.length === 3 && Array.from(v).every(number);
    if (!name(id) || !triplet(source?.min) || !triplet(source?.max)) throw new TypeError('An air pocket needs an ID and finite XYZ bounds');
    const bounds = P.data.freeze({ min: source.min.map(Math.fround), max: source.max.map(Math.fround) });
    if (bounds.min.some((v, i) => v >= bounds.max[i])) throw new RangeError('An air pocket needs positive XYZ extents');
    const { min, max } = bounds;
    return Object.freeze({ id, kind: 'air', priority: 1, bounds, sdf: (x, y, z) =>
      Math.max(min[0] - x, x - max[0], min[1] - y, y - max[1], min[2] - z, z - max[2]) });
  }

  const equalVector = (a, b) => a.every((v, i) => v === b[i]);
  const equalBounds = (a, b) => equalVector(a.min, b.min) && equalVector(a.max, b.max);
  function changedBody(before, after) {
    if (!before || !after) {
      const body = before ?? after;
      return body.grid?.bounds ?? body.bounds;
    }
    if (before === after) return null;
    const a = states.get(before), b = states.get(after), old = before.grid?.bounds ?? before.bounds,
      next = after.grid?.bounds ?? after.bounds;
    if (before.grid || after.grid) {
      if (before.grid === after.grid) return null;
      if (!before.grid || !after.grid || !equalBounds(old, next) || a.nx !== b.nx || a.nz !== b.nz)
        return P.spatial.boxOf([old.min, old.max, next.min, next.max]);
      const equalColumn = (x, z) => {
        const left = before.grid.column(x, z), right = after.grid.column(x, z);
        return left.length === right.length && left.every((row, i) => {
          const other = right[i];
          return row.min === other.min && row.max === other.max && row.kind === other.kind &&
            row.id === other.id && row.material === other.material && equalVector(row.current, other.current);
        });
      };
      const boxes = [];
      for (let z = 0; z < a.nz; z++) {
        let start = -1;
        for (let x = 0; x <= a.nx; x++) {
          if (x < a.nx && !equalColumn(x, z)) {
            if (start === -1) start = x;
          } else if (start !== -1) {
            boxes.push({ min: [old.min[0] + start * a.dx, old.min[1], old.min[2] + z * a.dz],
              max: [x === a.nx ? old.max[0] : old.min[0] + x * a.dx, old.max[1],
                z === a.nz - 1 ? old.max[2] : old.min[2] + (z + 1) * a.dz] });
            start = -1;
          }
        }
      }
      return boxes;
    }
    if (a.nx !== b.nx || a.nz !== b.nz || a.dx !== b.dx || a.dz !== b.dz ||
        [0, 2].some(i => old.min[i] !== next.min[i] || old.max[i] !== next.max[i]))
      return P.spatial.boxOf([old.min, old.max, next.min, next.max]);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < a.data.length; i += 4) {
      if (a.data[i] === b.data[i] && a.data[i + 1] === b.data[i + 1] &&
          a.data[i + 2] === b.data[i + 2] && a.data[i + 3] === b.data[i + 3]) continue;
      const x = i / 4 % a.nx, z = Math.floor(i / 4 / a.nx);
      lo[0] = Math.min(lo[0], next.min[0] + x * a.dx);
      lo[2] = Math.min(lo[2], next.min[2] + z * a.dz);
      hi[0] = Math.max(hi[0], x === a.nx - 1 ? next.max[0] : next.min[0] + (x + 1) * a.dx);
      hi[2] = Math.max(hi[2], z === a.nz - 1 ? next.max[2] : next.min[2] + (z + 1) * a.dz);
      if (a.data[i] < a.data[i + 1]) {
        lo[1] = Math.min(lo[1], a.data[i]);
        hi[1] = Math.max(hi[1], a.data[i + 1]);
      }
      if (b.data[i] < b.data[i + 1]) {
        lo[1] = Math.min(lo[1], b.data[i]);
        hi[1] = Math.max(hi[1], b.data[i + 1]);
      }
    }
    return lo[0] === Infinity ? null : { min: lo, max: hi };
  }

  function scene(bodies, { airPockets = [] } = {}) {
    if (!Array.isArray(bodies) || bodies.length > maxBodies || !Array.from(bodies).every(body => states.has(body)) ||
        new Set(bodies.map(body => body.id)).size !== bodies.length)
      throw new TypeError('A water scene holds up to eight water bodies with distinct IDs');
    if (!Array.isArray(airPockets) || airPockets.length > 8) throw new TypeError('A water scene holds up to eight air pockets');
    const pockets = Array.from(airPockets, pocket).sort(compare);
    if (new Set([...pockets, ...bodies].map(item => item.id)).size !== pockets.length + bodies.length)
      throw new TypeError('Water bodies and air pockets need distinct IDs');
    const sorted = bodies.slice().sort(compare), active = sorted.filter(body => !states.get(body).empty);
    const physical = sorted.filter(body => body.grid || !states.get(body).empty);
    for (let i = 0; i < physical.length; i++) for (let j = i + 1; j < physical.length; j++) {
      const first = physical[i], second = physical[j], a = first.grid?.bounds ?? first.bounds, b = second.grid?.bounds ?? second.bounds;
      if (a.min.every((v, axis) => v < b.max[axis] && a.max[axis] > b.min[axis]))
        throw new RangeError('Water body bounds overlap: ' + first.id + ' and ' + second.id);
    }
    const labels = new Map();
    for (const body of sorted) for (const row of body.media ?? [body.medium]) {
      if (!labels.has(row.id)) labels.set(row.id, []);
      labels.get(row.id).push({ row, layered: Boolean(body.grid) });
    }
    const media = Object.freeze([...Array.from(labels.values(), group => {
      const { row: first } = group[0];
      if (group.length === 1) return first;
      if (group.some(({ row, layered }) => !layered || row.kind !== first.kind))
        throw new TypeError('Repeated span IDs must refer to the same kind across layered tiles');
      const sample = (x, y, z) => group.find(({ row }) => row.sdf(x, y, z) < 0)?.row;
      const combined = { id: first.id, kind: first.kind, priority: first.priority,
        bounds: P.data.freeze(P.spatial.boxOf(group.flatMap(({ row }) => [row.bounds.min, row.bounds.max]))),
        sdf: (x, y, z) => sample(x, y, z) ? -1 : 1 };
      if (first.kind === 'air') return Object.freeze(combined);
      return Object.freeze({ ...combined, surfaceAt: (x, y, z) => sample(x, y, z).surfaceAt(x, y, z),
        current: (x, y, z) => sample(x, y, z).current(x, y, z) });
    }), ...pockets]);
    const layered = active.some(body => body.grid);
    const { mediumAt } = P.biomes.create({ media });
    function pack() {
      const rows = active.reduce((sum, body) => sum + states.get(body).nz, 0);
      const intervals = active.reduce((sum, body) => sum + (states.get(body).spans?.length ?? 0) / 4, 0);
      const width = Math.max(maxAxis, Math.ceil(intervals / (2048 - rows)));
      const height = Math.max(1, rows + Math.ceil(intervals / width));
      const data = new Float32Array(width * height * 4), modes = new Int32Array(maxBodies);
      const boxesMin = new Float32Array(maxBodies * 4), boxesMax = new Float32Array(maxBodies * 4);
      const grids = new Float32Array(maxBodies * 4), tint = new Float32Array(maxBodies * 4);
      const extinction = new Float32Array(maxBodies * 4), highlights = new Float32Array(maxBodies * 4);
      const airMin = new Float32Array(32), airMax = new Float32Array(32);
      pockets.forEach(({ bounds }, i) => {
        airMin.set(bounds.min, i * 4);
        airMax.set(bounds.max, i * 4);
      });
      let row = 0, tail = rows * width;
      active.forEach((body, i) => {
        const { nx, nz, dx, dz, data: grid, spans, style } = states.get(body), o = i * 4;
        boxesMin.set([...body.bounds.min, row], o);
        boxesMax.set([...body.bounds.max, style.refraction], o);
        grids.set([dx, dz, nx, nz], o);
        tint.set([...style.tint, style.foam], o);
        extinction.set([...style.extinction, style.caustics], o);
        highlights.set([...style.surfaceColor, style.surface], o);
        for (let z = 0; z < nz; z++) {
          const offset = (row + z) * width * 4;
          data.set(grid.subarray(z * nx * 4, (z + 1) * nx * 4), offset);
          if (spans) for (let x = 0; x < nx; x++) data[offset + x * 4] += tail;
        }
        if (spans) {
          modes[i] = 1;
          data.set(spans, tail * 4);
          tail += spans.length / 4;
        }
        row += nz;
      });
      const uniforms = { u_waterCount: active.length, u_waterMin: boxesMin, u_waterMax: boxesMax,
        u_waterGrid: grids, u_waterTint: tint, u_waterLoss: extinction, u_waterHighlight: highlights,
        u_waterAirCount: pockets.length, u_waterAirMin: airMin, u_waterAirMax: airMax,
        u_waterLayered: +layered, u_waterSpanMode: modes };
      return { width, height, data, uniforms };
    }
    function changesFrom(previous) {
      if (previous === result) return [];
      const old = previous == null ? { physical: [], pockets: [] } : sceneStates.get(previous);
      if (!old) throw new TypeError('Expected a previous water scene');
      const changed = [];
      function compareRows(before, after, difference) {
        const a = new Map(before.map(row => [row.id, row])), b = new Map(after.map(row => [row.id, row]));
        for (const id of new Set([...a.keys(), ...b.keys()])) {
          const bounds = difference(a.get(id), b.get(id));
          if (Array.isArray(bounds)) changed.push(...bounds);
          else if (bounds) changed.push(bounds);
        }
      }
      compareRows(old.physical, physical, changedBody);
      compareRows(old.pockets, pockets, (a, b) => {
        if (!a || !b) return (a ?? b).bounds;
        return equalBounds(a.bounds, b.bounds) ? null :
          P.spatial.boxOf([a.bounds.min, a.bounds.max, b.bounds.min, b.bounds.max]);
      });
      return P.data.freeze(changed);
    }
    const result = Object.freeze({ media, mediumAt, count: active.length, layered, pack, changesFrom });
    sceneStates.set(result, { physical, pockets });
    return result;
  }

  P.waterBodies = Object.freeze({ create, fromShallowWater, fromSpans, scene });
})(KIT);
