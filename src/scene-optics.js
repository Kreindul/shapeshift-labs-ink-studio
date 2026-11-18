/* Core scene optics descriptors and samplers shared by browser hosts and the CLI. */
const SceneOptics = (() => {
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sub = (a, b) => a.map((v, i) => v - b[i]);
  const length = v => Math.hypot(...v);
  const point = (value, name) => {
    if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite))
      throw new TypeError(name + ' must be a finite XYZ vector');
    return value.slice();
  };
  function unit(value, name) {
    const v = point(value, name),
      size = length(v);
    if (!(size > 1e-9)) throw new RangeError(name + ' must be nonzero');
    return v.map(n => n / size);
  }
  const clamp = n => Math.max(0, Math.min(1, n));
  const smooth = n => {
    const t = clamp(n);
    return t * t * (3 - 2 * t);
  };
  const positive = (n, name) => {
    if (!(Number.isFinite(n) && n > 0)) throw new RangeError(name + ' must be positive');
    return n;
  };
  const nonnegative = (n, name) => {
    if (!(Number.isFinite(n) && n >= 0)) throw new RangeError(name + ' must be nonnegative');
    return n;
  };

  function plane({ id, at = [0, 0, 0], normal = [0, 1, 0], bias = 0.001, select } = {}) {
    if (typeof id !== 'string' || !id.trim()) throw new TypeError('A reflection plane needs an ID');
    if (select !== undefined && typeof select !== 'function')
      throw new TypeError('Reflection selection must be a function');
    return {
      id,
      at: point(at, 'Reflection origin'),
      normal: unit(normal, 'Reflection normal'),
      bias: nonnegative(bias, 'Reflection bias'),
      select
    };
  }

  function planeDistance(surface, x, y, z) {
    const { at, normal } = surface;
    return (x - at[0]) * normal[0] + (y - at[1]) * normal[1] + (z - at[2]) * normal[2];
  }

  // Multiply an orthogonal scene-to-view matrix by a world-space mirror.
  function reflectedView(matrix, surface) {
    const out = matrix.slice(),
      { at, normal } = surface;
    for (let row = 0; row < 3; row++) {
      const projection = matrix[row] * normal[0] + matrix[4 + row] * normal[1] + matrix[8 + row] * normal[2];
      for (let col = 0; col < 3; col++) out[col * 4 + row] -= 2 * projection * normal[col];
      out[12 + row] += 2 * projection * dot(at, normal);
    }
    return out;
  }

  function volumeColor(value, palette) {
    if (typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)) value = parseInt(value.slice(1), 16);
    else if (Number.isInteger(value)) value = palette[value];
    else if (Array.isArray(value)) return point(value, 'Volume colour').map(clamp);
    if (!Number.isInteger(value))
      throw new TypeError('Volume colour must be a palette index, hex colour or RGB triple');
    return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
  }

  const common = ({ density = 0.2, color = '#99b1c4', near = 0, far } = {}) => {
    nonnegative(near, 'Volume near distance');
    if (far !== undefined && (!Number.isFinite(far) || far <= near))
      throw new RangeError('Volume far distance must exceed near');
    return { density: nonnegative(density, 'Volume density'), color, near, far };
  };
  function fog(options = {}) {
    const { bottom, top } = options;
    if (
      (bottom !== undefined && !Number.isFinite(bottom)) ||
      (top !== undefined && !Number.isFinite(top)) ||
      (bottom !== undefined && top !== undefined && bottom >= top)
    )
      throw new RangeError('Invalid height-fog range');
    return { type: 'fog', ...common(options), bottom, top };
  }
  function sphere(options) {
    return {
      type: 'sphere',
      ...common(options),
      at: point(options.at, 'Mist centre'),
      radius: positive(options.radius, 'Mist radius')
    };
  }
  function box(options) {
    const min = point(options.min, 'Volume minimum'),
      max = point(options.max, 'Volume maximum');
    if (min.some((n, i) => n >= max[i])) throw new RangeError('Volume bounds must have positive extent');
    return { type: 'box', ...common(options), min, max };
  }
  function shaft(options) {
    const from = point(options.from, 'Shaft start'),
      to = point(options.to, 'Shaft end');
    unit(sub(to, from), 'Shaft direction');
    return { type: 'shaft', ...common(options), from, to, radius: positive(options.radius, 'Shaft radius') };
  }

  const volumeKinds = { fog, sphere, box, shaft };
  function prepareVolumes(list, palette = []) {
    if (!Array.isArray(list)) throw new TypeError('Atmosphere must be a list of volumes');
    return list
      .map(d => {
        if (!d || !Object.hasOwn(volumeKinds, d.type)) throw new TypeError('Unknown atmosphere volume');
        const volume = volumeKinds[d.type](d);
        volume.rgb = volumeColor(volume.color, palette);
        if (volume.type === 'shaft') {
          const span = sub(volume.to, volume.from);
          volume.height = length(span);
          volume.axis = span.map(n => n / volume.height);
        }
        return volume;
      })
      .filter(d => d.density > 0);
  }

  // Intersect one slab of a ray with a [min,max] interval along an axis.
  function slab(range, position, direction, low, high) {
    if (Math.abs(direction) < 1e-10) return position > low && position < high;
    const a = (low - position) / direction,
      b = (high - position) / direction;
    range[0] = Math.max(range[0], Math.min(a, b));
    range[1] = Math.min(range[1], Math.max(a, b));
    return range[1] > range[0];
  }
  function radial(range, a, b, c) {
    if (a < 1e-10) return c < 0;
    const d = b * b - a * c;
    if (d <= 0) return false;
    const width = Math.sqrt(d);
    range[0] = Math.max(range[0], (-b - width) / a);
    range[1] = Math.min(range[1], (-b + width) / a);
    return range[1] > range[0];
  }

  function interval(volume, from, dir, stop) {
    const range = [volume.near, Math.min(stop, volume.far ?? stop)];
    if (range[1] <= range[0]) return null;
    switch (volume.type) {
      case 'fog':
        return slab(range, from[1], dir[1], volume.bottom ?? -Infinity, volume.top ?? Infinity) ? range : null;
      case 'box':
        return [0, 1, 2].every(i => slab(range, from[i], dir[i], volume.min[i], volume.max[i])) ? range : null;
      case 'sphere': {
        const delta = sub(from, volume.at);
        return radial(range, 1, dot(delta, dir), dot(delta, delta) - volume.radius ** 2) ? range : null;
      }
      case 'shaft': {
        const delta = sub(from, volume.from);
        const p = dot(delta, volume.axis),
          d = dot(dir, volume.axis);
        if (!slab(range, p, d, 0, volume.height)) return null;
        return radial(range, 1 - d * d, dot(delta, dir) - p * d, dot(delta, delta) - p * p - volume.radius ** 2)
          ? range
          : null;
      }
    }
  }

  // Integrate overlapping constant-density media in front-to-back depth order.
  function trace(volumes, origin, direction, stop, result = [0, 0, 0, 1]) {
    const hits = [];
    for (const volume of volumes) {
      const range = interval(volume, origin, direction, stop);
      if (range) hits.push([range[0], volume, 1], [range[1], volume, -1]);
    }
    hits.sort((a, b) => a[0] - b[0]);
    result[0] = result[1] = result[2] = 0;
    result[3] = 1;
    const rgb = [0, 0, 0];
    let density = 0,
      last = 0;
    for (const [t, volume, sign] of hits) {
      if (density > 1e-10 && t > last) {
        const alpha = -Math.expm1(-density * (t - last));
        for (let i = 0; i < 3; i++) result[i] += (result[3] * alpha * rgb[i]) / density;
        result[3] *= 1 - alpha;
      }
      density += volume.density * sign;
      for (let i = 0; i < 3; i++) rgb[i] += volume.rgb[i] * volume.density * sign;
      last = t;
    }
    return result;
  }

  const axes = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  const axisVector = (v, fallback) => (typeof v === 'string' && Object.hasOwn(axes, v) ? axes[v] : (v ?? fallback));
  function dropOf({ at, start = 0, repeat, strength = 1 }) {
    if (!Number.isFinite(start) || !Number.isFinite(strength))
      throw new TypeError('Ripple start and strength must be finite');
    if (repeat !== undefined) positive(repeat, 'Ripple repeat');
    return { at: point(at, 'Ripple source'), start, repeat, strength };
  }

  function ringSampler(drops, { along, across, amplitude, scale, speed, width, damping }) {
    return function sample(position, time = 0, footprint = 0, out = [0, 0, 0]) {
      const amp = amplitude * (1 - smooth((footprint / scale - 0.35) / 0.5));
      let dx = 0,
        dz = 0;
      if (amp)
        for (const drop of drops()) {
          let age = time - (drop.start ?? 0);
          if (age < 0) continue;
          if (drop.repeat) age %= drop.repeat;
          const offset = sub(position, drop.at);
          const u = dot(offset, along),
            v = dot(offset, across),
            radius = Math.hypot(u, v);
          const travel = radius - speed * age;
          if (radius < 1e-8 || Math.abs(travel) >= width) continue;
          const envelope =
            (1 - smooth((Math.abs(travel) / width - 0.2) / 0.8)) *
            smooth((speed * age) / (scale * 0.25)) *
            Math.exp(-damping * radius);
          const k = (Math.sin((2 * Math.PI * travel) / scale) * envelope * (drop.strength ?? 1)) / radius;
          dx += u * k;
          dz += v * k;
        }
      for (let i = 0; i < 3; i++) out[i] = amp * (along[i] * dx + across[i] * dz);
      return out;
    };
  }
  function ripple({
    axis,
    cross,
    amplitude = 0.3,
    scale = 0.3,
    speed = 1,
    width = scale * 2.5,
    damping = 0.3,
    drops = []
  } = {}) {
    const along = unit(axisVector(axis, axes.x), 'Ripple axis');
    const across = unit(axisVector(cross, axes.z), 'Ripple cross axis');
    if (Math.abs(dot(along, across)) > 1e-5) throw new RangeError('Ripple axes must be perpendicular');
    nonnegative(amplitude, 'Ripple amplitude');
    nonnegative(damping, 'Ripple damping');
    positive(scale, 'Ripple wavelength');
    positive(speed, 'Ripple speed');
    positive(width, 'Ripple packet width');
    if (!Array.isArray(drops) || drops.length > 64) throw new TypeError('Ripple rings need a list of up to 64 drops');
    const active = new Map();
    let serial = 0;
    function add(drop) {
      if (active.size >= 64) throw new RangeError('A ripple field can have up to 64 sources');
      const id = ++serial;
      active.set(id, dropOf(drop));
      return id;
    }
    drops.forEach(add);
    const sample = ringSampler(() => active.values(), { along, across, amplitude, scale, speed, width, damping });
    function prune(time, reach) {
      if (!Number.isFinite(time)) throw new TypeError('Ripple time must be finite');
      nonnegative(reach, 'Ripple reach');
      let removed = 0;
      for (const [id, drop] of active) {
        if (!drop.repeat && (time - drop.start) * speed > reach + width) {
          active.delete(id);
          removed++;
        }
      }
      return removed;
    }
    return {
      add,
      remove: id => active.delete(id),
      clear: () => active.clear(),
      prune,
      sample,
      normal: { type: 'rings', sample }
    };
  }

  return { plane, planeDistance, reflectedView, fog, sphere, box, shaft, prepareVolumes, trace, ripple, ringSampler };
})();
if (typeof module !== 'undefined') module.exports = SceneOptics;
