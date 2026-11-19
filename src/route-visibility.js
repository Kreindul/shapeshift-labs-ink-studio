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

  function find(start, end, obstacles, { maxVertices = 600, maxTests = 2500000, links = [] } = {}) {
    if (
      !point(start, 3) || !point(end, 3) || Math.hypot(...start.map((v, i) => end[i] - v)) <= EPS ||
      !Array.isArray(obstacles) || obstacles.length > 500 || !Array.isArray(links) || links.length > 64 ||
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
      const signedArea = loop.reduce((sum, p, i) => sum + area2(loop[0], p, loop[(i + 1) % loop.length]), 0);
      if (loop.length < 3 || loop.some((p, i) => dist2(p, loop[(i + 1) % loop.length]) <= EPS ** 2) ||
        Math.abs(signedArea) <= EPS)
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
      const sign = Math.sign(signedArea);
      // For a convex ring, its interior is the intersection of the signed
      // edge half-planes. Keep the original edge origin for stable distances.
      const convex = loop.every((p, i) => area2(p, loop[(i + 1) % loop.length],
        loop[(i + 2) % loop.length]) * sign >= 0);
      const edges = convex ? loop.map(([x, z], i) => {
        const next = loop[(i + 1) % loop.length], dx = next[0] - x, dz = next[1] - z,
          scale = sign / Math.hypot(dx, dz);
        return [x, z, -dz * scale, dx * scale];
      }) : null;
      polygons.push({ loop, box, edges });
    }
    const linksByVertex = new Map();
    let linkPoints = vertices.length;
    for (const [index, link] of links.entries()) {
      const through = Array.isArray(link?.through) ? Array.from(link.through) : [link?.through];
      if (!point(link?.start, 2) || !point(link?.end, 2) || dist2(link.start, link.end) <= EPS ** 2 ||
          !through.length || through.length > polygons.length || new Set(through).size !== through.length ||
          through.some(id => !Number.isInteger(id) || id < 0 || id >= polygons.length))
        throw new Error('Visibility links need two distinct XZ points and valid obstacle indices');
      const via = link.via === undefined ? [] : link.via;
      if (!Array.isArray(via) || via.length > 16 || !Array.from(via).every(p => point(p, 2)))
        throw new Error('Visibility link waypoints need at most sixteen finite XZ points');
      const path = [link.start, ...via, link.end];
      let length = 0;
      for (let i = 1; i < path.length; i++) {
        const step = Math.sqrt(dist2(path[i-1], path[i]));
        if (step <= EPS) throw new Error('Visibility link waypoints must define nonzero spans');
        length += step;
      }
      linkPoints += path.length;
      if (linkPoints > maxVertices) throw new Error('Visibility graph exceeds its vertex budget');
      const a = vertices.push(link.start) - 1, b = vertices.push(link.end) - 1,
        bypass = new Set(through.map(id => polygons[id]));
      linksByVertex.set(a, { next: b, index, bypass, path, length });
      linksByVertex.set(b, { next: a, index, bypass, path: path.slice().reverse(), length });
    }
    function check() {
      if (++work.tests > maxTests) throw exhausted;
    }
    function inside(p, { loop, box, edges }) {
      if (!overlap(bounds(p, p), box)) return false;
      if (edges) {
        for (const [x, z, nx, nz] of edges) {
          check();
          if (nx * (p[0] - x) + nz * (p[1] - z) <= EPS) return false;
        }
        return true;
      }
      let odd = false;
      for (let i = 0; i < loop.length; i++) {
        check();
        const a = loop[i], b = loop[(i + 1) % loop.length];
        if (Math.abs(area2(a, b, p)) <= EPS * Math.sqrt(dist2(a, b)) && overlap(bounds(a, b), bounds(p, p))) return false;
        if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < a[0] + (p[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) odd = !odd;
      }
      return odd;
    }
    function crossesConvex(a, b, edges) {
      let low = 0, high = 1;
      const ax = a[0], az = a[1], bx = b[0], bz = b[1];
      for (const [x, z, nx, nz] of edges) {
        check();
        const first = nx * (ax - x) + nz * (az - z) - EPS,
          last = nx * (bx - x) + nz * (bz - z) - EPS;
        if (first <= 0 && last <= 0) return false;
        if (first <= 0) low = Math.max(low, first / (first - last));
        else if (last <= 0) high = Math.min(high, first / (first - last));
        if (high - low <= EPS) return false;
      }
      return true;
    }
    function clear(a, b, bypass) {
      work.pairs++;
      const box = bounds(a, b),
        dx = b[0] - a[0], dz = b[1] - a[1],
        sq = dx * dx + dz * dz;
      if (sq <= EPS * EPS) return !polygons.some(polygon => inside(a, polygon));
      for (const polygon of polygons) {
        if (bypass?.has(polygon) || !overlap(box, polygon.box)) continue;
        if (polygon.edges) {
          if (crossesConvex(a, b, polygon.edges)) return false;
          continue;
        }
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
        parent = new Int32Array(size).fill(-1), used = new Map(), visited = new Uint8Array(size);
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
          const points = [start], traversed = [];
          for (let i = 1; i < path.length; i++) {
            const a = vertices[path[i - 1]], b = vertices[path[i]], link = used.get(path[i]);
            const terminal = i === path.length - 1;
            if (!link && dist2(a, b) <= EPS * EPS) {
              if (terminal) points[points.length - 1] = end;
              continue;
            }
            const from = points.length - 1, leg = link?.path || [a,b];
            for (let j = 1; j < leg.length; j++) {
              const q = leg[j];
              travelled += Math.sqrt(dist2(leg[j-1],q));
              points.push(terminal && j === leg.length - 1
                ? end : [q[0], start[1] + (end[1] - start[1]) * travelled / cost, q[1]]);
            }
            if (link) traversed.push({ link: link.index, from, to: points.length - 1 });
          }
          return result('ok', { points: frozenPoints(points),
            ...(traversed.length && { links: Object.freeze(traversed.map(Object.freeze)) }) });
        }
        const tunnel = linksByVertex.get(id);
        for (let i = 1; i < size; i++) {
          if (visited[i]) continue;
          const a = vertices[id], b = vertices[i], direct = cost + Math.sqrt(dist2(a,b));
          if (direct >= costs[i]) continue;
          let link = tunnel?.next === i ? tunnel : null;
          let next = direct;
          if (!link) {
            if (!clear(a,b)) continue;
          } else if (link.path.length > 2 && clear(a,b)) {
            link = null;
          } else {
            next = cost + link.length;
            if (next >= costs[i]) continue;
            let open = true;
            for (let j = 1; j < link.path.length && open; j++)
              open = clear(link.path[j-1],link.path[j],link.bypass);
            if (!open) continue;
          }
          if (link) used.set(i, link); else used.delete(i);
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


  function sweep(start, end, { halfWidth, below, above, spacing = 0.12, minClearance = 0,
    clearance, maxSamples = 10000 } = {}) {
    if (!point(start, 3) || !point(end, 3) || ![halfWidth, below, above, minClearance].every(v => Number.isFinite(v) && v >= 0) ||
        !(spacing > EPS) || !Number.isFinite(spacing) || typeof clearance !== 'function' ||
        !limit(maxSamples, 1, 1000000)) throw new Error('A swept route needs a finite section, spacing and a clearance field');
    const dx = end[0] - start[0], dy = end[1] - start[1], dz = end[2] - start[2], run = Math.hypot(dx, dz);
    if (run <= EPS) throw new Error('Swept routes need a nonzero horizontal run');
    const nx = -dz / run, nz = dx / run, lengths = [Math.hypot(run, dy), halfWidth * 2, below + above];
    const [rows, columns, layers] = lengths.map(length => Math.ceil(length / spacing));
    if ((rows + 1) * (columns + 1) * (layers + 1) > maxSamples) return { status: 'budget', samples: 0 };
    let samples = 0;
    for (let i = 0; i <= rows; i++) {
      const t = i / rows;
      for (let j = 0; j <= columns; j++) {
        const u = columns ? halfWidth * (2 * j / columns - 1) : 0;
        for (let k = 0; k <= layers; k++) {
          const h = layers ? -below + (below + above) * k / layers : 0;
          const q = [start[0] + dx * t + nx * u, start[1] + dy * t + h, start[2] + dz * t + nz * u];
          const d = clearance(q);
          samples++;
          if (typeof d !== 'number' || Number.isNaN(d)) throw new Error('A clearance field must return a signed distance');
          if (d < minClearance) return { status: 'blocked', samples, point: q, clearance: d };
        }
      }
    }
    return { status: 'ok', samples };
  }

  function sweepPath(points, options = {}) {
    if (!Array.isArray(points) || points.length < 2 || points.length > 4097 ||
        !Array.from(points).every(p => point(p,3)))
      throw new Error('A swept path needs 2 to 4097 finite points');
    if (points.length === 2) return sweep(points[0],points[1],options);
    for (let i=1;i<points.length;i++)
      if (Math.hypot(points[i][0]-points[i-1][0],points[i][2]-points[i-1][2]) <= EPS)
        throw new Error('Swept routes need a nonzero horizontal run');
    const {halfWidth,below,above,spacing=.12,minClearance=0,clearance,maxSamples=10000}=options;
    let samples=0;
    for (let i=1;i<points.length;i++) {
      if (i>1&&samples===maxSamples) return {status:'budget',samples};
      const span=sweep(points[i-1],points[i],{...options,maxSamples:maxSamples-samples});
      samples+=span.samples;
      if (span.status!=='ok') return {...span,samples};
      if (i===points.length-1||!halfWidth) continue;
      const [a,b,c]=[points[i-1],points[i],points[i+1]],dx=b[0]-a[0],dz=b[2]-a[2],
        ex=c[0]-b[0],ez=c[2]-b[2];
      if (Math.abs(dx*ez-dz*ex)<=EPS*Math.hypot(dx,dz)*Math.hypot(ex,ez)&&dx*ex+dz*ez>0) continue;
      // A rounded join includes the sector between the two leg cross-sections.
      // Probe the full disk, including its boundary, at each join.
      const rings=Math.ceil(halfWidth/spacing),layers=Math.ceil((below+above)/spacing);
      for (let ring=0;ring<=rings;ring++) {
        const radius=halfWidth*ring/rings,steps=ring?Math.ceil(2*Math.PI*radius/spacing):1;
        if(steps*(layers+1)>maxSamples-samples) return {status:'budget',samples};
        for(let j=0;j<steps;j++){
          const angle=2*Math.PI*j/steps,x=b[0]+radius*Math.cos(angle),z=b[2]+radius*Math.sin(angle);
          for(let k=0;k<=layers;k++){
            const q=[x,b[1]+(layers?-below+(below+above)*k/layers:0),z],d=clearance(q);
            samples++;
            if(typeof d!=='number'||Number.isNaN(d)) throw new Error('A clearance field must return a signed distance');
            if(d<minClearance) return {status:'blocked',samples,point:q,clearance:d};
          }
        }
      }
    }
    return {status:'ok',samples};
  }

  return Object.freeze({ find, convexFootprint, sweep, sweepPath });
})();
if (typeof module !== 'undefined') module.exports = RouteVisibility;
