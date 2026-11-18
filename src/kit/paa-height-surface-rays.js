/* Ray queries on a bounded graph y = height(x, z). */
(function (K) {
  const P = K.procedural || K.authoring, EPS = 1e-8;
  const vector = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);

  function raycast(surface, origin, direction, { maxDistance = 10000, slopeBound } = {}) {
    if (!vector(origin) || !vector(direction) || K.V.len(direction) < EPS ||
        !Number.isFinite(maxDistance) || maxDistance <= 0 ||
        slopeBound !== undefined && (!Number.isFinite(slopeBound) || slopeBound < 0))
      throw new Error('Height surface rays need finite vectors, positive distance and optional nonnegative slope');
    const { bounds, height, inside, normal } = surface;
    const dir = K.V.norm(direction);
    let low = 0, high = maxDistance;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(dir[i]) < EPS) {
        if (origin[i] < bounds.min[i] || origin[i] > bounds.max[i]) return null;
      } else {
        const a = (bounds.min[i] - origin[i]) / dir[i], b = (bounds.max[i] - origin[i]) / dir[i];
        low = Math.max(low, Math.min(a, b));
        high = Math.min(high, Math.max(a, b));
      }
    }
    if (low > high) return null;

    const at = t => K.V.mad(origin, dir, t);
    const value = t => origin[1] + dir[1] * t -
      height(origin[0] + dir[0] * t, origin[2] + dir[2] * t);
    function hit(distance, knownHeight) {
      const p = at(distance);
      if (inside && !inside(p[0], p[2])) return null;
      p[1] = knownHeight ?? height(p[0], p[2]);
      const n = normal && normal(p[0], p[2]);
      return { p, n, distance };
    }
    if (dir[0] === 0 && dir[2] === 0) {
      const y = height(origin[0], origin[2]), t = (y - origin[1]) / dir[1];
      return t >= low - EPS && t <= high + EPS ? hit(Math.max(0, t), y) : null;
    }

    function refine(a, b, fa) {
      const sign = fa > 0;
      for (let i = 0; i < 44 && b - a > 1e-7; i++) {
        const mid = a + (b - a) / 2;
        if ((value(mid) > 0) === sign) a = mid;
        else b = mid;
      }
      return hit(a + (b - a) / 2);
    }
    let previous = low, a = value(low);
    if (Math.abs(a) < EPS) {
      const start = hit(low);
      if (start) return start;
    }
    if (high === low) return null;

    const lateral = Math.hypot(dir[0], dir[2]);
    const alongSlope = slopeBound === undefined ? Infinity : slopeBound * lateral;
    if (Math.abs(dir[1]) > alongSlope) {
      // A ray steeper than the terrain can cross its graph at most once.
      const b = value(high);
      if (Math.abs(b) < EPS) return hit(high);
      return (a > 0) !== (b > 0) ? refine(low, high, a) : null;
    }
    const speed = Math.abs(dir[1]) + alongSlope;
    const step = Math.max(.025, (high - low) / 1200);
    while (previous < high) {
      // A certified bound lets the scan skip intervals that cannot contain a hit.
      const advance = speed > 0 ? Math.max(step, .9 * Math.abs(a) / speed) : step;
      const t = Math.min(high, previous + advance);
      if (t <= previous) break;
      const b = value(t);
      const found = Math.abs(b) < EPS ? hit(t) : (a > 0) !== (b > 0) ? refine(previous, t, a) : null;
      if (found) return found;
      previous = t;
      a = b;
    }
    return null;
  }

  P.heightSurface = { raycast };
})(KIT);
