/* Planar visibility paths and conservative clearance footprints, shared by authoring hosts. */
const RouteVisibility = (() => {
  const EPS = 1e-9,
    point = (p, n) => Array.isArray(p) && p.length === n && p.every(x => Number.isFinite(x) && Math.abs(x) <= 1e6),
    limit = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max,
    clamp = t => Math.max(0, Math.min(1, t)),
    plan = p => [p[0], p[2]],
    area2 = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
    dist2 = (a, b) => (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2,
    interpolate = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
    bounds = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])],
    overlap = (a, b) => a[0] <= b[2] + EPS && b[0] <= a[2] + EPS && a[1] <= b[3] + EPS && b[1] <= a[3] + EPS;

  function find(start, end, obstacles, { maxVertices = 600, maxTests = 2500000 } = {}) {
    if (
      !point(start, 3) || !point(end, 3) || Math.hypot(...start.map((v, i) => end[i] - v)) <= EPS ||
      !Array.isArray(obstacles) || obstacles.length > 500 ||
      !limit(maxVertices, 2, 3000) || !limit(maxTests, 1, 30000000)
    ) throw new Error('Visibility paths need distinct finite pins, polygons, and work limits');
    const first = plan(start), last = plan(end), vertices = [first, last],
      polygons = [], work = { pairs: 0, tests: 0 },
      exhausted = Symbol('visibility budget');
    for (const polygon of obstacles) {
      if (!Array.isArray(polygon) || polygon.length < 3 || polygon.length > maxVertices + 1 || !polygon.every(p => point(p, 2)))
        throw new Error('Visibility obstacles must be simple polygons with at least three XZ points');
      const loop = polygon.slice();
      if (dist2(loop[0], loop.at(-1)) <= EPS ** 2) loop.pop();
      if (loop.length < 3 || loop.some((p, i) => dist2(p, loop[(i + 1) % loop.length]) <= EPS ** 2) ||
        Math.abs(loop.reduce((sum, p, i) => sum + area2(loop[0], p, loop[(i + 1) % loop.length]), 0)) <= EPS)
        throw new Error('Visibility obstacles need a nondegenerate boundary');
      if (vertices.length + loop.length > maxVertices) throw new Error('Visibility graph exceeds its vertex budget');
      vertices.push(...loop);
      const box = [Infinity, Infinity, -Infinity, -Infinity];
      for (const p of loop) {
        box[0] = Math.min(box[0], p[0]);
        box[1] = Math.min(box[1], p[1]);
        box[2] = Math.max(box[2], p[0]);
        box[3] = Math.max(box[3], p[1]);
      }
      polygons.push({ loop, box });
    }
    function check() {
      if (++work.tests > maxTests) throw exhausted;
    }
    function inside(p, { loop, box }) {
      if (!overlap(bounds(p, p), box)) return false;
      let odd = false;
      for (let i = 0; i < loop.length; i++) {
        check();
        const a = loop[i], b = loop[(i + 1) % loop.length];
        if (Math.abs(area2(a, b, p)) <= EPS * Math.sqrt(dist2(a, b)) && overlap(bounds(a, b), bounds(p, p))) return false;
        if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) odd = !odd;
      }
      return odd;
    }
    function clear(a, b) {
      work.pairs++;
      const box = bounds(a, b),
        dx = b[0] - a[0], dz = b[1] - a[1],
        sq = dx * dx + dz * dz;
      if (sq <= EPS * EPS) return !polygons.some(polygon => inside(a, polygon));
      for (const polygon of polygons) {
        if (!overlap(box, polygon.box)) continue;
        const parameters = [0, 1], { loop } = polygon;
        for (let i = 0; i < loop.length; i++) {
          check();
          const c = loop[i], d = loop[(i + 1) % loop.length],
            ex = d[0] - c[0], ez = d[1] - c[1], rx = c[0] - a[0], rz = c[1] - a[1],
            determinant = dx * ez - dz * ex;
          if (Math.abs(determinant) > EPS * Math.sqrt(sq * (ex * ex + ez * ez))) {
            const t = (rx * ez - rz * ex) / determinant, u = (rx * dz - rz * dx) / determinant;
            if (t > 0 && t < 1 && u >= -EPS && u <= 1 + EPS) parameters.push(t);
          } else if (Math.abs(dx * rz - dz * rx) <= EPS * Math.sqrt(sq)) {
            parameters.push(clamp((rx * dx + rz * dz) / sq), clamp(((d[0] - a[0]) * dx + (d[1] - a[1]) * dz) / sq));
          }
        }
        parameters.sort((a, b) => a - b);
        for (let i = 1; i < parameters.length; i++) {
          if (parameters[i] - parameters[i - 1] <= EPS) continue;
          if (inside(interpolate(a, b, (parameters[i] + parameters[i - 1]) / 2), polygon)) return false;
        }
      }
      return true;
    }
    const result = (status, data = {}) => Object.freeze({ status, ...data, work: Object.freeze({ ...work }) });
    try {
      if ([first, last].some(p => polygons.some(polygon => inside(p, polygon)))) return result('blocked-pin');
      if (clear(first, last)) return result('ok', { points: frozenPoints([start, end]) });
      const size = vertices.length,
        costs = new Float64Array(size).fill(Infinity), estimates = new Float64Array(size).fill(Infinity),
        parent = new Int32Array(size).fill(-1), visited = new Uint8Array(size);
      const toEnd = vertices.map(p => Math.sqrt(dist2(p, last)));
      costs[0] = 0;
      estimates[0] = toEnd[0];
      for (;;) {
        // This visibility graph can be dense, so scan the bounded frontier.
        let id = -1, best = Infinity;
        for (let i = 0; i < size; i++) {
          if (!visited[i] && estimates[i] < best) {
            id = i;
            best = estimates[i];
          }
        }
        if (id === -1) break;
        const cost = costs[id];
        visited[id] = 1;
        if (id === 1) {
          const path = [1];
          for (let i = parent[1]; i >= 0; i = parent[i]) path.push(i);
          path.reverse();
          let travelled = 0;
          const points = [start];
          for (let i = 1; i < path.length - 1; i++) {
            const a = vertices[path[i - 1]], b = vertices[path[i]],
              step = Math.sqrt(dist2(a, b));
            travelled += step;
            if (step <= EPS || dist2(b, last) <= EPS ** 2) continue;
            points.push([b[0], start[1] + (end[1] - start[1]) * travelled / cost, b[1]]);
          }
          points.push(end);
          return result('ok', { points: frozenPoints(points) });
        }
        for (let i = 1; i < size; i++) {
          if (visited[i]) continue;
          const next = cost + Math.sqrt(dist2(vertices[i], vertices[id]));
          if (next >= costs[i] || !clear(vertices[id], vertices[i])) continue;
          costs[i] = next;
          parent[i] = id;
          estimates[i] = next + toEnd[i];
        }
      }
      return result('unreachable');
    } catch (error) {
      if (error === exhausted) return result('budget');
      throw error;
    }
  }

  function frozenPoints(points) {
    return Object.freeze(points.map(p => Object.freeze(p.slice())));
  }

  function hull(points) {
    const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const distinct = sorted.filter((p, i) => i === 0 || dist2(p, sorted[i - 1]) > EPS ** 2);
    function chain(input) {
      const edge = [];
      for (const p of input) {
        while (edge.length >= 2 && area2(edge.at(-2), edge.at(-1), p) <= 0) edge.pop();
        edge.push(p);
      }
      return edge.slice(0, -1);
    }
    return [...chain(distinct), ...chain(distinct.reverse())];
  }

  function convexFootprint(points, { margin = 0 } = {}) {
    if (!Array.isArray(points) || points.length < 3 || points.length > 4096 ||
        !points.every(p => point(p, 2)) || !Number.isFinite(margin) || margin < 0 || margin > 1e4)
      throw new Error('A clearance footprint needs finite XZ samples and a nonnegative margin');
    const outline = hull(points);
    if (outline.length < 3) throw new Error('A clearance footprint needs noncollinear samples');
    if (!margin) return frozenPoints(outline);
    // The octagon circumscribes a circle of radius margin. Its Minkowski sum
    // with the hull bounds the swept clearance, including at sharp tips.
    const diagonal = margin * (Math.SQRT2 - 1);
    const offsets = [[-margin, -diagonal], [-margin, diagonal], [-diagonal, -margin], [-diagonal, margin],
      [margin, -diagonal], [margin, diagonal], [diagonal, -margin], [diagonal, margin]];
    return frozenPoints(hull(outline.flatMap(p => offsets.map(q => [p[0] + q[0], p[1] + q[1]]))));
  }

  return Object.freeze({ find, convexFootprint });
})();
if (typeof module !== 'undefined') module.exports = RouteVisibility;
