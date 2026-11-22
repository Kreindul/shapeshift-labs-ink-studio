/* Finite Gaussian strands carried by ordinary native splat rows. */
const CurveSplat = (() => {
  // Kind zero leaves the motion payload free. Preserve the tag through native row copies.
  const marker = -161291.375, profileMarker = -161292.375, flatMarker = -161293.375, minimum = 1e-5;
  // Seven-point Gaussian quadrature across the flat section, with rounded Gaussian edges.
  const flatBlur = .25, flatNormalization = 1 / (Math.sqrt(2 * Math.PI) * flatBlur);
  const ribbonSamples = [
    [-.949107912342759, .129484966168870], [-.741531185599394, .279705391489277],
    [-.405845151377397, .381830050505119], [0, .417959183673469],
    [.405845151377397, .381830050505119], [.741531185599394, .279705391489277],
    [.949107912342759, .129484966168870]
  ];
  const alongX = [1, 0, 0];
  // Keep the axial eigenvalue separate from the transverse values even for very short spans.
  const axialUnits = (radius, half) => Math.max(4, Math.min(64, 1 + (half / radius) ** 2 / 3));
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = a => {
    const length = Math.hypot(...a);
    return length > 0 ? a.map(v => v / length) : null;
  };
  const isRow = (data, at) => {
    const tag = data[at + 15];
    return (tag === marker || tag === profileMarker || tag === flatMarker) &&
      (data[at + 11] & 15) === 0 && data[at + 12] > 0 && data[at + 13] > 0;
  };

  function profiledDimensions(radius, half, aspect, scale, xx, xy, xz, yy, yz, zz) {
    const ratio = aspect * aspect, longitudinal = axialUnits(radius, half);
    const variance = (xx + yy + zz) / (longitudinal + 1 + ratio);
    const size = Math.sqrt(variance) * scale;
    if (!(size > 0) || !(aspect >= .1 && aspect < 1)) return null;
    const matrix = [[xx, xy, xz], [xy, yy, yz], [xz, yz, zz]].map(row => row.map(v => v / variance));
    const pivot = matrix[0][0] >= matrix[1][1] && matrix[0][0] >= matrix[2][2] ? 0 :
      matrix[1][1] >= matrix[2][2] ? 1 : 2;
    let axis = unit(matrix[pivot]);
    if (!axis) return null;
    for (let i = 0; i < 16; i++) axis = unit(matrix.map(row => dot(row, axis)));
    const across = matrix.map((row, i) => row.map((v, j) =>
      v - (i === j ? ratio : 0) - (longitudinal - ratio) * axis[i] * axis[j]));
    const transverse = across[0][0] >= across[1][1] && across[0][0] >= across[2][2] ? across[0] :
      across[1][1] >= across[2][2] ? across[1] : across[2];
    const along = dot(transverse, axis);
    const major = unit(transverse.map((v, i) => v - along * axis[i]));
    if (!major) return null;
    return {
      axis, major, minor: cross(axis, major).map(v => v / aspect), radius: size, half: half * size / radius
    };
  }

  function dimensions(data, at, scale) {
    const radius = data[at + 12], half = data[at + 13];
    const xx = data[at + 4], xy = data[at + 5], xz = data[at + 6];
    const yy = data[at + 8], yz = data[at + 9], zz = data[at + 10];
    if (data[at + 15] !== marker)
      return profiledDimensions(radius, half, data[at + 14], scale, xx, xy, xz, yy, yz, zz);
    // The carrier stores the covariance of a uniform segment convolved with a round Gaussian.
    // Its principal axis also follows native rigid transforms. Recover the uniform scale from the trace.
    const ratio = (xx + yy + zz) / (3 * radius * radius + half * half / 3);
    const variance = ratio * radius * radius;
    const axis = xx >= yy && xx >= zz ? [xx - variance, xy, xz] :
      yy >= zz ? [xy, yy - variance, yz] : [xz, yz, zz - variance];
    const norm = Math.hypot(...axis), size = Math.sqrt(ratio) * scale;
    if (!(size > 0)) return null;
    return { axis: norm > variance * 1e-7 ? axis.map(v => v / norm) : [1, 0, 0],
      radius: radius * size, half: half * size };
  }

  function erf(x) {
    const t = 1 / (1 + .3275911 * Math.abs(x));
    return Math.sign(x) * (1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t -
      .284496736) * t + .254829592) * t * Math.exp(-x * x));
  }

  function prepare(data, at, position, scale, opacity, { view, near, focal, width, height, ortho }) {
    const shape = dimensions(data, at, scale);
    if (!shape) return null;
    const { axis, radius, half } = shape;
    const cameraPoint = p => [0, 1, 2].map(i => p[0] * view[i] + p[1] * view[i + 4] + p[2] * view[i + 8] + view[i + 12]);
    const start = position.map((v, i) => v - half * axis[i]);
    const end = position.map((v, i) => v + half * axis[i]);
    const a = cameraPoint(start), b = cameraPoint(end);
    if (a[2] > -near && b[2] > -near) return null;
    const clip = (p, q) => (-near - p[2]) / (q[2] - p[2]);
    const first = a[2] > -near ? clip(a, b) : 0;
    const last = b[2] > -near ? 1 - clip(b, a) : 1;
    const length = (last - first) * 2 * half;
    if (!(length > 0)) return null;
    const from = start.map((v, i) => v + first * (end[i] - v));
    const bounds = [Infinity, Infinity, -Infinity, -Infinity], support = 5 * radius;
    for (const u of [first, last]) {
      const [x, y, z] = a.map((v, i) => v + u * (b[i] - v));
      const depth = Math.max(near, -z), magnification = ortho ? focal : focal / depth;
      const reach = ortho ? focal * support : focal * support / Math.max(near, depth - support);
      const ex = reach * (ortho ? 1 : 1 + Math.abs(x) / depth);
      const ey = reach * (ortho ? 1 : 1 + Math.abs(y) / depth);
      const sx = width / 2 + x * magnification, sy = height / 2 + y * magnification;
      bounds[0] = Math.min(bounds[0], sx - ex);
      bounds[1] = Math.min(bounds[1], sy - ey);
      bounds[2] = Math.max(bounds[2], sx + ex);
      bounds[3] = Math.max(bounds[3], sy + ey);
    }
    const middle = a.map((v, i) => v + (first + last) / 2 * (b[i] - v));
    const flattened = data[at + 15] === flatMarker;
    return { from, axis, radius, length, bounds, middle, major: shape.major, minor: shape.minor, flattened,
      tau: -Math.log1p(-Math.min(.999, opacity)) };
  }

  // The integral is optical depth per unit strength, with the nearest point on the sampled axis.
  function kernel(length, radius, transverse, dx, dy, dz, px, py, pz) {
    const sigma = radius * Math.SQRT2;
    let at, nearest, integral;
    if (transverse * length < 1e-4 * radius) {
      at = nearest = length / 2;
      integral = length / (radius * Math.sqrt(2 * Math.PI));
    } else {
      nearest = -(px * dx + py * dy + pz * dz) / (transverse * transverse);
      at = Math.max(0, Math.min(length, nearest));
      const lo = -nearest * transverse / sigma, hi = (length - nearest) * transverse / sigma;
      if (lo >= 4 || hi <= -4) return null;
      integral = (erf(hi) - erf(lo)) / (2 * transverse);
    }
    const offset = Math.hypot(px + nearest * dx, py + nearest * dy, pz + nearest * dz) / sigma;
    if (offset > 3.6) return null;
    return { at, amount: integral * Math.exp(-offset * offset) };
  }

  function sample(strand, { origin, direction, axial }, near) {
    const { from, axis, radius, length, major, minor, flattened } = strand;
    const offsetFromEye = [from[0] - origin[0], from[1] - origin[1], from[2] - origin[2]];
    const axialStart = dot(offsetFromEye, direction), axialSlope = dot(axis, direction);
    let start = offsetFromEye, ray = direction, along = axis, tau = strand.tau;
    if (major) {
      // Whiten the section and integrate the Gaussian along the transformed ray.
      const blur = flattened ? flatBlur : 1;
      start = [dot(axis, offsetFromEye), dot(major, offsetFromEye) / blur, dot(minor, offsetFromEye)];
      ray = [axialSlope, dot(major, direction) / blur, dot(minor, direction)];
      const rayScale = Math.hypot(...ray);
      ray = ray.map(v => v / rayScale);
      along = alongX;
      tau /= rayScale;
    }
    const rayStart = major ? dot(start, ray) : axialStart, parallel = major ? ray[0] : axialSlope;
    const px = start[0] - rayStart * ray[0], py = start[1] - rayStart * ray[1], pz = start[2] - rayStart * ray[2];
    const dx = along[0] - parallel * ray[0], dy = along[1] - parallel * ray[1], dz = along[2] - parallel * ray[2];
    const transverse = Math.hypot(dx, dy, dz);
    if (!flattened) {
      const hit = kernel(length, radius, transverse, dx, dy, dz, px, py, pz);
      const coverage = hit && -Math.expm1(-tau * hit.amount);
      return coverage >= minimum ? { alpha: coverage, depth: Math.max(near, axial * (axialStart + hit.at * axialSlope)) } : null;
    }

    // Integrate the parallel Gaussian strips before turning optical depth into a single fragment.
    let amount = 0, weightedDepth = 0;
    const lateral = dot(major, direction);
    for (const [offset, weight] of ribbonSamples) {
      const shift = offset * radius, whitened = shift / flatBlur, alongRay = whitened * ray[1];
      const hit = kernel(length, radius, transverse, dx, dy, dz,
        px - alongRay * ray[0], py + whitened - alongRay * ray[1], pz - alongRay * ray[2]);
      if (!hit) continue;
      const mass = weight * hit.amount;
      amount += mass;
      weightedDepth += mass * (axialStart + shift * lateral + hit.at * axialSlope);
    }
    const coverage = -Math.expm1(-tau * flatNormalization * amount);
    return coverage >= minimum ? { alpha: coverage, depth: Math.max(near, axial * weightedDepth / amount) } : null;
  }
  return Object.freeze({ marker, profileMarker, flatMarker, axialUnits, minimum, isRow, prepare, sample });
})();
if (typeof module !== 'undefined') module.exports = CurveSplat;
