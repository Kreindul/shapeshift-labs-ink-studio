/* Adapt editable paths and sampled strand sources to finite Gaussian segments. */
(function (K) {
  const format = 'ink-studio/curve-splat-scene';
  const coordinateLimit = 1e5, segmentLimit = 60000;
  const array = value => Array.isArray(value) || ArrayBuffer.isView(value) && !(value instanceof DataView);
  const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
  const point = value => array(value) && value.length === 3 && Array.from(value).every(n => finite(n, -coordinateLimit, coordinateLimit));
  const label = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
  function check(condition, message) {
    if (!condition) throw new RangeError('Curve splats: ' + message);
  }
  function rgb(value) {
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value))
      return [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16));
    check(array(value) && value.length === 3 && Array.from(value).every(n => Number.isInteger(n) && n >= 0 && n <= 255),
      'expected an RGB colour');
    return Array.from(value);
  }
  function points(input) {
    check(Array.isArray(input) && input.length <= segmentLimit + 1, 'expected a bounded point array');
    return Array.from(input, value => {
      check(point(value), 'points need three finite world coordinates');
      return Array.from(value);
    });
  }
  function paths(source) {
    if (Array.isArray(source)) return [{ points: source }];
    check(source && typeof source === 'object', 'expected a path or source document');
    switch (source.kind ?? 'path') {
      case 'path':
        check(source.closed === undefined || typeof source.closed === 'boolean', 'invalid closure');
        return [{ points: source.points, closed: source.closed }];
      case 'spline': {
        const controls = points(source.points), per = source.samples ?? 6;
        check(controls.length >= 2 && Number.isSafeInteger(per) && per >= 1 && per <= 128 &&
          per * (controls.length - 1) <= segmentLimit, 'invalid spline controls or sample count');
        return [{ points: K.curve.spline(controls, per) }];
      }
      case 'family': return [{ points: K.curve.create(source.definition).points }];
      case 'textile': {
        const plan = source.plan;
        check(Array.isArray(plan?.threads ?? plan?.strands) && (plan.threads ?? plan.strands).length <= segmentLimit,
          'expected a textile or interlace plan');
        return (plan.threads ?? plan.strands).map(strand => ({
          id: strand.id, radius: strand.radius, family: strand.family, index: strand.index,
          points: strand.stations?.map(station => station.p) ?? strand.path?.points,
          uvs: strand.stations?.map(station => station.uv)
        }));
      }
      case 'routed': {
        const { link } = source;
        check(Array.isArray(link?.paths) && link.paths.length <= segmentLimit, 'expected a routed link sample');
        return link.paths.map((points, i) => ({ id: String(i), points, radius: link.radius }));
      }
      case 'trail': {
        check(Array.isArray(source.samples) && source.samples.length <= segmentLimit + 1, 'expected a bounded trail sample list');
        const spans = [{ points: [] }];
        for (const sample of source.samples) {
          if (sample === null) {
            if (spans.at(-1).points.length) spans.push({ points: [] });
          } else spans.at(-1).points.push(sample?.point ?? sample);
        }
        return spans.map((span, i) => ({ ...span, id: String(i) }));
      }
      default: throw new TypeError('Unknown curve splat source ' + source.kind);
    }
  }

  function channel(value, name, min, max) {
    const read = value => {
      check(finite(value, min, max), 'invalid ' + name + ' value');
      return value;
    };
    if (typeof value === 'number') {
      const constant = read(value);
      return { sample: () => constant };
    }
    if (typeof value === 'function') return { sample: at => read(value(at)), varying: true };
    let rows = Array.isArray(value) ? value : value?.keys;
    if (value?.samples !== undefined) {
      const samples = value.samples;
      check(rows === undefined && Array.isArray(samples) && samples.length >= 2 && samples.length <= 512,
        'expected two to 512 painted ' + name + ' samples');
      rows = Array.from(samples, (v, i) => [i / (samples.length - 1), v]);
    }
    check(Array.isArray(rows) && rows.length > 0 && rows.length <= 512, 'expected up to 512 ' + name + ' keys');
    const keys = Array.from(rows, (row, i) => {
      check(Array.isArray(row) && row.length === 2 && finite(row[0], 0, 1) &&
        (i === 0 || row[0] > rows[i - 1][0]), name + ' keys need increasing positions from zero to one');
      return [row[0], read(row[1])];
    });
    function sample({ u }) {
      if (u <= keys[0][0]) return keys[0][1];
      if (u >= keys.at(-1)[0]) return keys.at(-1)[1];
      let first = 0, last = keys.length - 1;
      while (last - first > 1) {
        const middle = (first + last) >> 1;
        if (keys[middle][0] > u) last = middle;
        else first = middle;
      }
      const [a, x] = keys[first], [b, y] = keys[last];
      return x + (y - x) * (u - a) / (b - a);
    }
    return { sample, keys, varying: keys.some(([, v]) => v !== keys[0][1]) };
  }

  function profileStops(channels, resolution) {
    if (!channels.some(p => p?.varying)) return [];
    const stops = new Set(Array.from({ length: resolution - 1 }, (_, i) => (i + 1) / resolution));
    for (const [i, profile] of channels.entries()) {
      if (!profile?.varying || !profile.keys) continue;
      for (const [j, [u, v]] of profile.keys.entries()) {
        if (u > 0 && u < 1) stops.add(u);
        if (!j) continue;
        const [from, previous] = profile.keys[j - 1];
        if (v === previous) continue;
        const steps = i === 2 ? Math.ceil(Math.abs(v - previous) / (Math.PI / 12)) : 8;
        for (let k = 1; k < steps; k++) stops.add(from + (u - from) * k / steps);
        check(stops.size <= segmentLimit, 'profile exceeds the segment budget');
      }
    }
    return [...stops].sort((a, b) => a - b);
  }

  function majorAxis(frames, index, axis, t, angle) {
    const direction = K.V.lerp(frames[index].N, frames[index + 1].N, t);
    const projected = K.V.mad(direction, axis, -K.V.dot(direction, axis));
    const reference = Math.abs(axis[1]) < .9 ? [0, 1, 0] : [1, 0, 0];
    const n = K.V.norm(K.V.len(projected) > 1e-7 ? projected : K.V.mad(reference, axis, -K.V.dot(reference, axis)));
    return K.V.mad(K.V.mul(n, Math.cos(angle)), K.V.cross(axis, n), Math.sin(angle));
  }

  function prepare(source, options = {}) {
    const link = source?.kind === 'routed' ? source.link : undefined;
    const { radius, width, taper = 1, twist = 0, aspect = options.twist === undefined ? 1 : .35,
      up = [0, 1, 0], profileSamples = 96, opacity = .94, color = '#eab876', object = link?.id ?? 'curve',
      material = link?.material ?? 'strand', target, maxSegments = segmentLimit } = options;
    check((radius === undefined || finite(radius, 1e-6, 100)) && finite(opacity, 0, 1) && label(object) && label(material) &&
      finite(aspect, .1, 1) && point(up) && K.V.len(up) > 1e-8 &&
      Number.isSafeInteger(profileSamples) && profileSamples >= 8 && profileSamples <= 1024 &&
      Number.isSafeInteger(maxSegments) && maxSegments >= 0 && maxSegments <= segmentLimit,
      'invalid strand appearance, profile resolution or segment budget');
    const profileWidth = width === undefined ? null : channel(width, 'width', 0, 200);
    const profileTaper = channel(taper, 'taper', 0, 1);
    const profileTwist = channel(twist, 'twist', -64 * Math.PI, 64 * Math.PI);
    const elliptical = aspect < .99999;
    const stops = profileStops([profileWidth, profileTaper, elliptical && profileTwist], profileSamples);
    const fixedColor = typeof color === 'function' ? null : rgb(color);
    let segments = 0, examined = 0, samples = 0;
    const strands = paths(source).map((strand, index) => {
      const baseRadius = radius ?? strand.radius ?? .03, id = strand.id ?? String(index);
      check(finite(baseRadius, 1e-6, 100) && label(id), 'invalid strand radius or ID');
      const knots = points(strand.points), rows = [];
      if (strand.closed && knots.length >= 2 && K.V.dist(knots[0], knots.at(-1)) > 1e-8) knots.push(knots[0]);
      samples += knots.length;
      check(samples <= 2 * segmentLimit, 'point budget exceeded');
      const lengths = knots.slice(1).map((to, i) => K.V.dist(knots[i], to));
      const total = lengths.reduce((sum, length) => length < 1e-7 ? sum : sum + length, 0);
      const frames = elliptical && total > 0 ? K.curve.frames(knots, Array.from(up)) : null;
      let distance = 0, stop = 0;
      for (let i = 0; i < lengths.length; i++) {
        const from = knots[i], to = knots[i + 1], length = lengths[i];
        if (length < 1e-7) continue;
        const axis = frames && K.V.mul(K.V.sub(to, from), 1 / length);
        const begin = distance / total, end = (distance + length) / total;
        const a = strand.uvs?.[i], b = strand.uvs?.[i + 1];
        let previous = 0;
        while (stop < stops.length && stops[stop] <= begin + 1e-12) stop++;
        do {
          check(++examined <= maxSegments, 'segment budget exceeded');
          const next = stop < stops.length && stops[stop] < end - 1e-12 ?
            (stops[stop++] * total - distance) / length : 1;
          const middle = (previous + next) / 2, arc = distance + length * middle;
          const sample = { id, family: strand.family, index: strand.index ?? index,
            point: K.V.lerp(from, to, middle), distance: arc, u: arc / total,
            ...(a && b && { uv: a.map((v, k) => v + (b[k] - v) * middle) }) };
          const size = (profileWidth ? profileWidth.sample(sample) / 2 : baseRadius) * profileTaper.sample(sample);
          if (size >= 1e-6 && (next - previous) * length >= 1e-7) {
            segments++;
            const shade = fixedColor ?? rgb(color(sample));
            const profile = frames ? { major: majorAxis(frames, i, axis, middle, profileTwist.sample(sample)), aspect } : undefined;
            rows.push({ from: previous === 0 ? from : K.V.lerp(from, to, previous),
              to: next === 1 ? to : K.V.lerp(from, to, next), shade, radius: size, profile });
          }
          previous = next;
        } while (previous < 1);
        distance += length;
      }
      return { id, rows };
    });
    return { object, material, target, opacity, strands, segments, examined };
  }

  function emit(builder, plan) {
    check(typeof builder?.curveSplat === 'function', 'expected a native splat builder');
    const first = builder.count(), threads = [];
    for (const { id, rows } of plan.strands) {
      const start = builder.count();
      for (const { from, to, shade, radius, profile } of rows)
        builder.curveSplat(from, to, radius, shade, plan.opacity, profile);
      const end = builder.count();
      builder.describeSplats?.(start, end, {
        object: plan.object, material: plan.material, target: { entity: plan.object, ...plan.target, surface: id }
      });
      threads.push({ id, first: start, end });
    }
    return { first, end: builder.count(), threads, segments: plan.segments };
  }

  function draw(builder, source, options) {
    return emit(builder, prepare(source, options));
  }

  function world(recipe) {
    check(recipe?.format === format && recipe.version === 1 && label(recipe.id) &&
      Array.isArray(recipe.strands) && recipe.strands.length > 0 && recipe.strands.length <= 1024,
      'expected a version 1 curve splat scene with named strands');
    const { seed = 1, background = '#172332', palette = [], camera = {}, look = {} } = recipe;
    check(Number.isSafeInteger(seed) && Array.isArray(palette) && palette.length <= 255, 'invalid seed or palette');
    const packed = color => rgb(color).reduce((sum, value) => sum * 256 + value, 0);
    let remaining = segmentLimit;
    const plans = recipe.strands.map(({ source, ...appearance }, i) => {
      const plan = prepare(source, { object: 'curve:' + i, ...appearance, maxSegments: remaining });
      remaining -= plan.examined;
      return plan;
    });
    const colors = new Set([packed(background), ...Array.from(palette, packed)]);
    if (!palette.length) {
      for (const plan of plans) for (const strand of plan.strands) for (const row of strand.rows)
        if (colors.size < 256) colors.add(packed(row.shade));
    }
    const builder = makeBuilder(seed, [...colors]);
    for (const plan of plans) emit(builder, plan);
    return builder.finish({
      id: recipe.id, curveSplatSource: recipe, cam: { target: [0, 0, 0], dist: 7, yaw: 0, pitch: 0, ...camera }, radius: 10,
      fog: { c: 0, start: 1, max: 0 }, dither: 0, look: { pixelSize: 1, ...look }
    });
  }

  K.curveSplats = Object.freeze({ format, segmentLimit, draw, world });
})(KIT);
