/* Directed, headless traversal over aligned columns of free space. */
(function (K) {
  const P = K.procedural, { freeze } = P.data, V = K.V;
  const finite = Number.isFinite, integer = Number.isSafeInteger;
  const modes = Object.freeze(['walk', 'swim', 'climb', 'drop']);
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  const name = (x, z) => x + '/' + z;
  const graphs = new WeakMap();

  function create({ tiles, radius = 0.18, height = 0.8, stepUp = 0.3, maxDrop = 1.5,
    maxClimb = 1.5, canClimb, swimStep, clearance, origin, maxNodes = 50000, maxChecks = 4000000 } = {}) {
    if (!Array.isArray(tiles) || !tiles.length || tiles.length > 4096 ||
        !Array.from(tiles).every(tile => P.verticalSpans.isGrid(tile) &&
          [...tile.bounds.min, ...tile.bounds.max].every(v => Math.abs(v) <= 1e6)) ||
        ![radius, height, stepUp, maxDrop, maxClimb].every(v => finite(v) && v >= 0 && v <= 1e4) ||
        radius < 1e-5 || height < 2 * radius || (clearance !== undefined && typeof clearance !== 'function') ||
        (canClimb !== undefined && typeof canClimb !== 'function') ||
        (origin !== undefined && (!Array.isArray(origin) || origin.length !== 2 ||
          !Array.from(origin).every(v => finite(v) && Math.abs(v) <= 1e6))) ||
        !integer(maxNodes) || maxNodes < 1 || maxNodes > 250000 ||
        !integer(maxChecks) || maxChecks < 1 || maxChecks > 30000000)
      throw new TypeError('Traversal needs span tiles, capsule dimensions and bounded graph options');
    const [dx, dz] = tiles[0].cell;
    const spacing = swimStep ?? Math.min(dx, dz, height);
    if (!finite(spacing) || spacing < 1e-5) throw new RangeError('Swim spacing must be positive and representable');
    // An explicit anchor keeps column IDs stable across floating-point tile revisions.
    const phase = origin ?? [0, 2].map((axis, i) => {
      const v = Math.min(...tiles.map(tile => tile.bounds.min[axis])), size = i === 0 ? dx : dz;
      const offset = v - Math.floor(v / size) * size;
      return Math.min(offset, size - offset) < size * 1e-6 ? 0 : offset;
    });
    const stride = Math.min(radius / 2, dx / 4, dz / 4), margin = stride / 2;
    const half = height / 2 - radius, stand = height / 2 + margin;
    const swimReach = Math.max(spacing * 1.55, height * 1.5, stepUp);
    const reach = Math.max(swimReach, stepUp, maxDrop, maxClimb);
    const columns = new Map(), nodes = new Map(), edges = new Map(), adjacent = new Map();
    let checks = 0;
    const check = () => {
      if (++checks > maxChecks) throw new RangeError('Traversal graph exceeds its work budget');
    };
    const aligned = (a, b, scale) => Math.abs(a - b) <= scale * 1e-5;
    for (const tile of tiles) {
      const [nx, nz] = tile.resolution, [x0, z0] = phase.map((v, i) => {
        const size = i === 0 ? dx : dz, min = tile.bounds.min[i * 2];
        const n = Math.round((min - v) / size);
        if (!integer(n) || !aligned(v + n * size, min, size) ||
            !aligned(min + tile.resolution[i] * size, tile.bounds.max[i * 2], size))
          throw new RangeError('Traversal tiles must share an aligned XZ lattice');
        return n;
      });
      if (!aligned(tile.cell[0], dx, dx) || !aligned(tile.cell[1], dz, dz))
        throw new RangeError('Traversal tiles must share the same cell size');
      for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
        check();
        const i = x0 + x, j = z0 + z, key = name(i, j);
        if (columns.has(key)) throw new RangeError('Traversal tiles cannot cover the same column');
        columns.set(key, { key, i, j, x: phase[0] + (i + 0.5) * dx, z: phase[1] + (j + 0.5) * dz,
          tile: name(x0, z0), rows: tile.column(x, z), nodes: [] });
      }
    }

    const columnAt = (x, z) => columns.get(name(Math.floor((x - phase[0]) / dx), Math.floor((z - phase[1]) / dz)));
    function mediumAt(x, y, z) {
      const rows = columnAt(x, z)?.rows;
      if (!rows || y < rows[0].min || y >= rows.at(-1).max) return null;
      let left = 0, right = rows.length - 1;
      while (left < right) {
        const i = (left + right) >>> 1;
        if (rows[i].max <= y) left = i + 1;
        else right = i;
      }
      return rows[left];
    }
    function pose(p, budget) {
      const [x, y, z] = p, a = y - half, b = y + half;
      if (clearance) {
        const steps = Math.max(1, Math.ceil(2 * half / stride));
        for (let i = 0; i <= steps; i++) {
          budget();
          const gap = clearance(x, a + (b - a) * i / steps, z);
          if (!finite(gap)) throw new TypeError('Traversal clearance must return finite signed distances');
          if (gap + 1e-8 < radius + margin) return false;
        }
        return true;
      }
      // With column occupancy alone, test an enclosing box. This stays
      // conservative at a ledge or seam where a circle straddles columns.
      const r = radius + margin, low = y - height / 2 - margin, high = y + height / 2 + margin;
      const i0 = Math.floor((x - r - phase[0]) / dx), i1 = Math.floor((x + r - phase[0]) / dx);
      const j0 = Math.floor((z - r - phase[1]) / dz), j1 = Math.floor((z + r - phase[1]) / dz);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        budget();
        const rows = columns.get(name(i, j))?.rows;
        if (!rows || low < rows[0].min || high >= rows.at(-1).max ||
            rows.some(row => row.kind === 'solid' && low < row.max && high > row.min)) return false;
      }
      return true;
    }

    function probePath(path, budget) {
      let wet = false, length = 0;
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i], direction = V.sub(b, a);
        const segment = distance(a, b), steps = Math.max(1, Math.ceil(segment / stride));
        length += segment;
        for (let j = i === 1 ? 0 : 1; j <= steps; j++) {
          budget();
          const p = V.mad(a, direction, j / steps), row = mediumAt(...p);
          if (!row || row.kind === 'solid' || !pose(p, budget)) return null;
          wet ||= row.kind === 'water';
        }
      }
      return { wet, length };
    }

    function addRoom(column, start, stop, chamber) {
      const { x, z, rows } = column, low = rows[start].min, high = rows[stop - 1].max;
      const min = low + stand, max = high - stand;
      if (min > max) return;
      const levels = new Map(), gap = stride * 0.25;
      function add(slot, y, supported, kind) {
        check();
        if (y < min || y > max) return;
        const point = [x, y, z], row = mediumAt(...point), level = Math.floor(y / gap);
        if (!row || row.kind === 'solid' || (kind && row.kind !== kind) ||
            [level - 1, level, level + 1].some(k => Math.abs((levels.get(k) ?? Infinity) - y) < gap) ||
            !pose(point, check)) return false;
        if (nodes.size >= maxNodes) throw new RangeError('Traversal graph exceeds its node budget');
        const id = column.key + '/' + chamber + '/' + slot;
        const node = freeze({ id, point, column: [column.i, column.j], tile: column.tile, supported,
          medium: row.kind, mediumId: row.id, span: [row.min, row.max] });
        nodes.set(id, node);
        adjacent.set(id, []);
        column.nodes.push(node);
        levels.set(level, y);
        return true;
      }
      if (start > 0) {
        for (const lift of [stride / 4, radius / 2, radius, radius * 1.5])
          if (add('floor', min + lift, true)) break;
      }
      let wet = 0, air = 0;
      for (let i = start; i < stop; i++) {
        const row = rows[i], low = Math.max(min, row.min), high = Math.min(max, row.max);
        if (row.kind === 'water') {
          const slot = wet++;
          if (low > high) continue;
          add('pool/' + slot, (low + high) / 2, false, 'water');
          for (let k = Math.ceil(low / spacing); k * spacing < high; k++)
            add('swim/' + k, k * spacing, false, 'water');
        } else if (rows[i - 1]?.kind === 'water') {
          const slot = air++;
          if (low <= high) add('surface/' + slot, (low + Math.min(high, low + height)) / 2, false, 'air');
        }
      }
    }
    const ordered = [...columns.values()].sort((a, b) => a.i - b.i || a.j - b.j);
    for (const column of ordered) {
      const { rows } = column;
      for (let start = 0, room = 0; start < rows.length;) {
        check();
        if (rows[start].kind === 'solid') {
          start++;
          continue;
        }
        let stop = start + 1;
        while (stop < rows.length && rows[stop].kind !== 'solid') stop++;
        addRoom(column, start, stop, room++);
        start = stop;
      }
      column.nodes.sort((a, b) => a.point[1] - b.point[1] || order(a.id, b.id));
    }

    function connect(from, to) {
      check();
      const wet = from.medium === 'water' || to.medium === 'water';
      const dy = to.point[1] - from.point[1], same = from.column[0] === to.column[0] && from.column[1] === to.column[1];
      let mode, scanned, points = [from.point, to.point];
      if (wet) {
        if (Math.abs(dy) > swimReach) return;
        mode = 'swim';
      } else {
        if (same || !from.supported || !to.supported) return;
        if (dy > stepUp + 1e-6) {
          if (dy > maxClimb || !canClimb?.(from, to)) return;
          mode = 'climb';
        } else if (-dy > stepUp + 1e-6) {
          if (-dy > maxDrop) return;
          mode = 'drop';
        } else mode = 'walk';
        // Lift on the lower side of a step. Try a continuous ramp first
        // for walks, then the raised path for a sharp ledge.
        if (mode === 'walk') scanned = probePath(points, check);
        if (!scanned) {
          const low = dy > 0 ? from.point : to.point;
          points = [from.point, [low[0], Math.max(from.point[1], to.point[1]), low[2]], to.point];
        }
      }
      scanned ??= probePath(points, check);
      if (!scanned || (mode === 'swim' && !scanned.wet) || (mode !== 'swim' && scanned.wet) || scanned.length === 0) return;
      const id = from.id + '>' + to.id;
      const edge = freeze({ id, from: from.id, to: to.id, mode, length: scanned.length, points,
        crossTile: from.tile !== to.tile });
      adjacent.get(from.id).push(edge);
      edges.set(id, edge);
    }
    for (const a of ordered) {
      for (let i = 1; i < a.nodes.length; i++) {
        connect(a.nodes[i - 1], a.nodes[i]);
        connect(a.nodes[i], a.nodes[i - 1]);
      }
      for (const b of [columns.get(name(a.i + 1, a.j)), columns.get(name(a.i, a.j + 1))]) {
        if (!b) continue;
        let begin = 0;
        for (const from of a.nodes) {
          while (begin < b.nodes.length && b.nodes[begin].point[1] < from.point[1] - reach) begin++;
          for (let i = begin; i < b.nodes.length && b.nodes[i].point[1] <= from.point[1] + reach; i++) {
            connect(from, b.nodes[i]);
            connect(b.nodes[i], from);
          }
        }
      }
    }

    function route(start, end, { allow = modes, maxSnap = Math.max(dx, dz, height), weights = {} } = {}) {
      if (!Array.isArray(allow) || !Array.from(allow).every(mode => modes.includes(mode)) ||
          !finite(maxSnap) || maxSnap < 0 || !weights || typeof weights !== 'object' ||
          Object.entries(weights).some(([mode, value]) => !modes.includes(mode) || !finite(value) || value <= 0))
        throw new TypeError('Traversal routes need movement modes, positive weights and finite snap distance');
      const allowed = new Set(allow);
      let routingChecks = 0;
      const step = () => {
        if (++routingChecks > maxChecks) throw new RangeError('Traversal route exceeds its work budget');
      };
      function endpoint(value) {
        const eligible = node => node && (allowed.has('swim') || node.medium !== 'water');
        if (typeof value === 'string') {
          const node = nodes.get(value);
          return eligible(node) ? node : null;
        }
        if (!Array.isArray(value) || value.length !== 3 || !Array.from(value).every(finite))
          throw new TypeError('Traversal endpoints need node IDs or finite XYZ agent centers');
        const candidates = [...nodes.values()].map(node => ({ node, distance: distance(value, node.point) }))
          .filter(row => row.distance <= maxSnap).sort((a, b) => a.distance - b.distance || order(a.node.id, b.node.id));
        return candidates.find(({ node, distance }) => {
          if (!eligible(node)) return false;
          if (distance === 0) return true;
          const path = probePath([value, node.point], step);
          return path && (allowed.has('swim') || !path.wet);
        })?.node;
      }
      const from = endpoint(start), to = endpoint(end);
      if (!from || !to) return freeze({ ok: false, reason: 'endpoint', from: from?.id ?? null, to: to?.id ?? null });
      const costs = new Map([[from.id, 0]]), previous = new Map();
      const queue = new ProceduralHeap((a, b) => a.cost < b.cost || a.cost === b.cost && a.id < b.id);
      queue.push({ id: from.id, cost: 0 });
      while (queue.size) {
        const { id, cost } = queue.pop();
        if (cost !== costs.get(id)) continue;
        if (id === to.id) break;
        for (const edge of adjacent.get(id)) {
          step();
          if (!allowed.has(edge.mode)) continue;
          const next = cost + edge.length * (weights[edge.mode] ?? 1);
          if (next >= (costs.get(edge.to) ?? Infinity)) continue;
          costs.set(edge.to, next);
          previous.set(edge.to, edge);
          queue.push({ id: edge.to, cost: next });
        }
      }
      if (!costs.has(to.id)) return freeze({ ok: false, reason: 'disconnected', from: from.id, to: to.id });
      const links = [];
      for (let id = to.id; id !== from.id;) {
        const edge = previous.get(id);
        links.push(edge);
        id = edge.from;
      }
      links.reverse();
      const points = [from.point, ...links.flatMap(edge => edge.points.slice(1))];
      return freeze({ ok: true, cost: costs.get(to.id), nodes: [from, ...links.map(edge => nodes.get(edge.to))],
        edges: links, points });
    }

    function changesFrom(previous) {
      const old = graphs.get(previous);
      if (!old) throw new TypeError('Expected a previous traversal graph');
      if (old.edges === edges) return Object.freeze([]);
      const samePoint = (a, b) => a.every((v, i) => v === b[i]);
      return freeze([...new Set([...old.edges.keys(), ...edges.keys()])].sort().flatMap(id => {
        const before = old.edges.get(id), after = edges.get(id);
        if (before && after && before.mode === after.mode && before.points.length === after.points.length &&
            before.points.every((p, i) => samePoint(p, after.points[i]))) return [];
        const { from, to } = before ?? after;
        const now = [nodes.get(from), nodes.get(to)], then = [old.nodes.get(from), old.nodes.get(to)];
        const flooded = now.some((node, i) => node?.medium === 'water' && then[i]?.medium === 'air') ||
          before && after && before.mode !== 'swim' && after.mode === 'swim';
        const drained = then.some((node, i) => node?.medium === 'water' && now[i]?.medium === 'air') ||
          before && after && before.mode === 'swim' && after.mode !== 'swim';
        const reason = flooded ? 'flooded' : drained ? 'drained' : before && after ? 'geometry' : after ? 'opened' : 'blocked';
        return [{ id, from, to, before: before?.mode ?? null, after: after?.mode ?? null, reason,
          mediaBefore: then.map(node => node?.medium ?? null), mediaAfter: now.map(node => node?.medium ?? null) }];
      }));
    }

    const result = freeze({ nodes: [...nodes.values()], edges: [...edges.values()], route, changesFrom, work: { checks } });
    graphs.set(result, { nodes, edges });
    return result;
  }

  P.traversalGraph = Object.freeze({ create });
})(KIT);
