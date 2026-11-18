/* A swept, ground-following body over caller-supplied supports and solids. */
(function (K) {
  const P = K.procedural || K.authoring, V = K.V;
  const vector = (p, n) => Array.isArray(p) && p.length === n && p.every(Number.isFinite);
  const range = (v, a, b) => Number.isFinite(v) && v >= a && v <= b;

  function create({ supports, clearance, radius = .18, height = 1.64, stepUp = .34,
    stepDown = .48, minimumNormal = .63, stride = Math.min(.085, radius * .6), budget = 128 } = {}) {
    if (typeof supports !== 'function' || typeof clearance !== 'function' || !range(radius, .03, 4) ||
        !range(height, radius * 2 + .05, 12) || !range(stepUp, 0, height - radius * 2 - .025) ||
        !range(stepDown, 0, 16) || !range(minimumNormal, .01, 1) || !range(stride, .005, radius) ||
        !Number.isSafeInteger(budget) || budget < 1 || budget > 2048) throw Error('Invalid traversal query or body');
    const lower = stepUp + radius + .005, upper = height - radius,
      sections = Math.max(1, Math.ceil((upper - lower) / (radius * .65)));

    function fits(p) {
      for (let i = 0; i <= sections; i++) {
        const y = p[1] + lower + (upper - lower) * i / sections;
        const distance = clearance([p[0], y, p[2]], radius);
        if (!Number.isFinite(distance) && distance !== Infinity) throw Error('Traversal clearance must be a finite signed distance or positive infinity');
        if (distance < radius - .0005) return false;
      }
      return true;
    }

    function seat(x, z, floor, ceiling) {
      const list = supports(x, z, floor, ceiling);
      if (!Array.isArray(list) || list.length > 256) throw Error('Traversal supports must return a bounded array');
      let best = null;
      for (const s of list) {
        if (!s || !Number.isFinite(s.y) || !vector(s.normal, 3) || V.len(s.normal) < 1e-8 ||
            (s.id !== undefined && typeof s.id !== 'string')) throw Error('Traversal support needs height and normal');
        if (s.y < floor - .00001 || s.y > ceiling + .00001 || best && s.y <= best.foot[1] ||
            s.normal[1] / V.len(s.normal) + .00001 < minimumNormal) continue;
        const foot = [x, s.y, z];
        if (fits(foot)) best = { foot, support: s.id ?? null, normal: V.norm(s.normal) };
      }
      return best;
    }

    function stand(point, { rise = stepUp, drop = stepDown } = {}) {
      if (!vector(point, 3) || !range(rise, 0, 1000) || !range(drop, 0, 1000))
        throw Error('Standing needs an XYZ point and bounded search height');
      return seat(point[0], point[2], point[1] - drop, point[1] + rise);
    }

    function move(foot, delta) {
      if (!vector(foot, 3) || !vector(delta, 2)) throw Error('Traversal needs an XYZ foot and XZ displacement');
      const steps = Math.ceil(Math.hypot(...delta) / stride);
      if (steps > budget) throw Error('Traversal exceeds its step budget');
      if (!steps) return { foot: foot.slice(), support: null, steps, blocked: false, progress: 0 };
      const dx = delta[0] / steps, dz = delta[1] / steps;
      let current = { foot: foot.slice(), support: null }, blocked = false, progress = 0;
      for (let i = 0; i < steps; i++) {
        const [x, y, z] = current.foot, lo = y - stepDown, hi = y + stepUp;
        let next = seat(x + dx, z + dz, lo, hi);
        if (!next) {
          blocked = true;
          if (dx && dz) {
            const firstX = Math.abs(dx) >= Math.abs(dz);
            next = firstX ? seat(x + dx, z, lo, hi) || seat(x, z + dz, lo, hi)
              : seat(x, z + dz, lo, hi) || seat(x + dx, z, lo, hi);
          }
        }
        if (!next) break;
        progress += Math.hypot(next.foot[0] - x, next.foot[2] - z);
        current = next;
      }
      return { ...current, steps, blocked, progress };
    }
    return Object.freeze({ stand, move, radius, height, stepUp, stepDown });
  }
  P.traversal = Object.freeze({ create });
})(KIT);
