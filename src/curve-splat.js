/* Finite, round Gaussian strands carried by ordinary native splat rows. */
const CurveSplat = (() => {
  // Kind zero leaves the motion payload free. Preserve the tag through native row copies.
  const marker = -161291.375, minimum = 1e-5;
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const isRow = (data, at) => data[at + 15] === marker && (data[at + 11] & 15) === 0 &&
    data[at + 12] > 0 && data[at + 13] > 0;

  function dimensions(data, at, scale) {
    const radius = data[at + 12], half = data[at + 13];
    const xx = data[at + 4], xy = data[at + 5], xz = data[at + 6];
    const yy = data[at + 8], yz = data[at + 9], zz = data[at + 10];
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
    return { from, axis, radius, length, bounds, middle, tau: -Math.log1p(-Math.min(.999, opacity)) };
  }

  // Integrate over the finite axis after projecting the Gaussian orthogonal to the camera ray.
  function sample(strand, { origin, direction, axial }, near) {
    const { from, axis, radius, length, tau } = strand;
    const vx = from[0] - origin[0], vy = from[1] - origin[1], vz = from[2] - origin[2];
    const axialStart = vx * direction[0] + vy * direction[1] + vz * direction[2];
    const parallel = dot(axis, direction);
    const px = vx - axialStart * direction[0], py = vy - axialStart * direction[1], pz = vz - axialStart * direction[2];
    const dx = axis[0] - parallel * direction[0], dy = axis[1] - parallel * direction[1], dz = axis[2] - parallel * direction[2];
    const transverse = Math.hypot(dx, dy, dz), sigma = radius * Math.SQRT2;
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
    const alpha = -Math.expm1(-tau * integral * Math.exp(-offset * offset));
    return alpha >= minimum ? { alpha, depth: Math.max(near, axial * (axialStart + at * parallel)) } : null;
  }
  return Object.freeze({ marker, minimum, isRow, prepare, sample });
})();
if (typeof module !== 'undefined') module.exports = CurveSplat;
