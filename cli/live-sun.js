// An orthographic depth map in world space, rasterized from the posed opaque splats.
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = v => {
  const length = Math.hypot(...v);
  return v.map(n => n / length);
};
const cross = (a, b) => [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];
const range = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
const defaultDirection = [-.52, .64, .57];

function prepare(authored, override, time) {
  const enabled = override ?? authored;
  if (enabled === undefined || enabled === false) return null;
  const settings = value => {
    if (value === true || value === undefined || value === false) return {};
    if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError('liveSun needs a settings object or boolean');
    return value;
  };
  const { direction = defaultDirection, ambient = .32, intensity = .88,
    shadows = true, mapSize = 512, bias = .02, filter = 1 } = { ...settings(authored), ...settings(enabled) };
  const directionAt = typeof direction === 'function' ? direction(time) : direction;
  if (!Array.isArray(directionAt) || directionAt.length !== 3 || !Array.from(directionAt).every(Number.isFinite) ||
      !Number.isFinite(Math.hypot(...directionAt)) || Math.hypot(...directionAt) === 0)
    throw new TypeError('Live sun direction needs a finite nonzero XYZ vector');
  if (!range(ambient, 0, 4) || !range(intensity, 0, 4) || !range(bias, 0, 10) || !range(mapSize, 32, 2048) ||
      !Number.isInteger(mapSize) || !Number.isInteger(filter) || !range(filter, 0, 2) || typeof shadows !== 'boolean')
    throw new RangeError('Invalid live sun lighting or shadow map settings');
  return { direction: unit(directionAt), ambient, intensity, shadows, mapSize, bias, filter };
}

function covariance(data, i, a, b) {
  return a[0] * (data[i+4]*b[0] + data[i+5]*b[1] + data[i+6]*b[2]) +
    a[1] * (data[i+5]*b[0] + data[i+8]*b[1] + data[i+9]*b[2]) +
    a[2] * (data[i+6]*b[0] + data[i+9]*b[1] + data[i+10]*b[2]);
}

function shadowMap(sun, data, { x, y, z, alpha, scale }, normalAt) {
  if (!sun.shadows || !sun.intensity) return null;
  const light = sun.direction;
  const right = unit(cross(Math.abs(light[1]) > .94 ? [0,0,1] : [0,1,0], light));
  const up = cross(light, right);
  const casters = [];
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
  for (let i = 0; i < alpha.length; i++) {
    const q = i * 16;
    // Opaque surface samples cast. Glass, backdrop art and outline-free particles are excluded.
    if (!Number.isFinite(alpha[i]) || alpha[i] < 1 || y[i] < -30 || (Math.round(data[q + 11]) & (16 | 64 | 256))) continue;
    const point = [x[i], y[i], z[i]], u = dot(right, point), v = dot(up, point), depth = dot(light, point);
    const s2 = scale[i] ** 2;
    const a = s2 * covariance(data, q, right, right), b = s2 * covariance(data, q, right, up),
      c = s2 * covariance(data, q, up, up);
    if (![u,v,depth,a,b,c].every(Number.isFinite) || a < 0 || c < 0) continue;
    const extent = 2 * Math.log(alpha[i] / .5);
    const du = Math.sqrt(a * extent), dv = Math.sqrt(c * extent);
    minU = Math.min(minU, u - du);
    maxU = Math.max(maxU, u + du);
    minV = Math.min(minV, v - dv);
    maxV = Math.max(maxV, v + dv);
    casters.push({ i, u, v, depth, a, b, c, extent, reach: 2*Math.sqrt(Math.max(0, s2 * covariance(data, q, light, light))) });
  }
  if (!casters.length) return null;
  const guard = sun.filter + 2;
  const texel = Math.max(maxU - minU, maxV - minV, 1e-6) / (sun.mapSize - 2 * guard - 1);
  const width = Math.ceil((maxU - minU) / texel) + 2 * guard;
  const height = Math.ceil((maxV - minV) / texel) + 2 * guard;
  minU -= guard * texel;
  minV -= guard * texel;
  const map = new Float64Array(width * height).fill(-Infinity);
  const minimumVariance = .15 * texel ** 2;

  for (const { i, u, v, depth, a, b, c, extent, reach } of casters) {
    const A = a + minimumVariance, C = c + minimumVariance;
    const det = A * C - b * b;
    if (!(det > 0)) continue;
    const radiusU = Math.sqrt(A * extent), radiusV = Math.sqrt(C * extent);
    const x0 = Math.max(0, Math.ceil((u - radiusU - minU) / texel - .5)),
      x1 = Math.min(width - 1, Math.floor((u + radiusU - minU) / texel - .5)),
      y0 = Math.max(0, Math.ceil((v - radiusV - minV) / texel - .5)),
      y1 = Math.min(height - 1, Math.floor((v + radiusV - minV) / texel - .5));
    const normal = normalAt(i), facing = normal && dot(normal, light);
    const slopeU = Math.abs(facing) >= .09 ? -dot(normal, right) / facing : 0;
    const slopeV = Math.abs(facing) >= .09 ? -dot(normal, up) / facing : 0;
    for (let j = y0; j <= y1; j++) {
      const dv = minV + (j + .5) * texel - v;
      for (let k = x0; k <= x1; k++) {
        const du = minU + (k + .5) * texel - u;
        if ((C*du*du - 2*b*du*dv + A*dv*dv) / det > extent) continue;
        const offset = Math.max(-reach, Math.min(reach, slopeU * du + slopeV * dv));
        const index = j * width + k;
        map[index] = Math.max(map[index], depth + offset);
      }
    }
  }

  return (x, y, z, normal, facing) => {
    const u = (x*right[0] + y*right[1] + z*right[2] - minU) / texel;
    const v = (x*up[0] + y*up[1] + z*up[2] - minV) / texel;
    const depth = x*light[0] + y*light[1] + z*light[2];
    const i = Math.floor(u), j = Math.floor(v), denominator = Math.max(.10, facing);
    const slopeU = -dot(normal, right) * texel / denominator;
    const slopeV = -dot(normal, up) * texel / denominator;
    const bias = sun.bias + texel * .25;
    let clear = 0, count = 0;
    for (let dy = -sun.filter; dy <= sun.filter; dy++) {
      const row = j + dy;
      for (let dx = -sun.filter; dx <= sun.filter; dx++) {
        const col = i + dx;
        const expected = depth + (col + .5 - u)*slopeU + (row + .5 - v)*slopeV;
        if (row < 0 || row >= height || col < 0 || col >= width || map[row*width+col] <= expected + bias) clear++;
        count++;
      }
    }
    return clear / count;
  };
}

function create(sun, world, pose, normalAt) {
  // Albedo exists on opted-in sculpt bakes and explicitly described builder rows.
  // Older pixel-material bakes still carry the original material ramps.
  const fill = new Int32Array(pose.alpha.length).fill(-1);
  const normals = [];
  for (let i = 0; i < fill.length; i++) {
    if (!pose.alpha[i] || (Math.round(world.data[i*16+11]) & (32 | 64 | 256))) continue;
    const reference = world.materialAlbedo?.[i], palette = world.pix?.[i*8];
    const rgb = reference ? reference - 1 : palette ? world.pal[world.ramps?.[palette - 1]?.at(-1)] : undefined;
    if (rgb === undefined) continue;
    const normal = normalAt(i);
    if (!normal) continue;
    normals[i] = normal;
    fill[i] = rgb;
  }
  const shadow = shadowMap(sun, world.data, pose, normalAt);
  const facing = new Float32Array(fill.length);
  for (let i = 0; i < normals.length; i++) if (normals[i]) facing[i] = Math.max(0, dot(normals[i], sun.direction));
  const visibility = (i, x, y, z) => {
    if (!normals[i]) return undefined;
    return shadow && facing[i] > 0 ? shadow(x, y, z, normals[i], facing[i]) : 1;
  };
  const level = (i, x, y, z) => sun.ambient + sun.intensity * facing[i] * visibility(i, x, y, z);
  const albedo = i => {
    const n = fill[i];
    return n >= 0 ? [(n >> 16)/255, (n >> 8 & 255)/255, (n & 255)/255] : null;
  };
  return { albedo, normal: i => normals[i], level, visibility };
}

module.exports = { prepare, create };
