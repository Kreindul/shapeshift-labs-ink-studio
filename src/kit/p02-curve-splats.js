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
  function pathSpec(path) {
    return { points: path.points, closed: path.closed, up: path.up,
      frame: typeof path.frame === 'function' ? distance => path.frame(distance).N : undefined };
  }

  function paths(source) {
    if (Array.isArray(source)) return [{ points: source }];
    check(source && typeof source === 'object', 'expected a path or source document');
    switch (source.kind ?? 'path') {
      case 'path':
        check(source.closed === undefined || typeof source.closed === 'boolean', 'invalid closure');
        return [pathSpec(source)];
      case 'spline': {
        const controls = points(source.points), per = source.samples ?? 6;
        check(controls.length >= 2 && Number.isSafeInteger(per) && per >= 1 && per <= 128 &&
          per * (controls.length - 1) <= segmentLimit, 'invalid spline controls or sample count');
        return [{ points: K.curve.spline(controls, per) }];
      }
      case 'family': return [pathSpec(K.curve.create(source.definition))];
      case 'surface': return [surfacePath(source)];
      case 'textile': {
        const plan = source.plan;
        check(Array.isArray(plan?.threads ?? plan?.strands) && (plan.threads ?? plan.strands).length <= segmentLimit,
          'expected a textile or interlace plan');
        return (plan.threads ?? plan.strands).map(strand => ({
          id: strand.id, radius: strand.radius, family: strand.family, index: strand.index,
          ...(strand.path && pathSpec(strand.path)),
          ...(strand.stations && { points: strand.stations.map(station => station.p),
            uvs: strand.stations.map(station => station.uv), normals: strand.stations.map(station => station.n) })
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

  const packed = color => rgb(color).reduce((sum, value) => sum * 256 + value, 0);
  const mix = (x, y, t) => x + (y - x) * t;
  const mixRgb = (x, y, t) => x.map((v, i) => mix(v, y[i], t));
  const sameValue = (a, b) => Array.isArray(a) ? a.every((value, i) => value === b[i]) : a === b;

  function track(value, name, read, isConstant, interpolate, mode = 'linear') {
    if (isConstant(value)) {
      const constant = read(value);
      return { sample: () => constant };
    }
    if (typeof value === 'function') return { sample: at => read(value(at)), varying: true };
    const step = (value?.interpolation ?? mode) === 'step';
    check(step || (value?.interpolation ?? mode) === 'linear', 'invalid ' + name + ' interpolation');
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
      return step ? x : interpolate(x, y, (u - a) / (b - a));
    }
    return { sample, keys, step, varying: keys.some(([, v]) => !sameValue(v, keys[0][1])) };
  }

  function channel(value, name, min, max) {
    return track(value, name, n => {
      check(finite(n, min, max), 'invalid ' + name + ' value');
      return n;
    }, n => typeof n === 'number', mix);
  }

  const colorTrack = (value, name) => track(value, name, rgb, value => typeof value === 'string' ||
    array(value) && value.length === 3 && Array.from(value).every(n => typeof n === 'number'), mixRgb);

  function materialTracks(along, palette, roles) {
    if (along === undefined) return {};
    check(along && Object.getPrototypeOf(along) === Object.prototype &&
      Object.keys(along).every(key => ['paletteRole', 'pigment', 'opacity', 'roughness', 'emission', 'emissionColor'].includes(key)),
      'invalid along-strand material');
    const result = {};
    if (along.paletteRole !== undefined) {
      const resolve = name => {
        check(label(name) && !name.startsWith('#'), 'expected a named palette role or ramp stop');
        const swatch = PixelLook.roleColor(name, palette, roles);
        return [swatch >> 16, (swatch >> 8) & 255, swatch & 255];
      };
      result.paletteRole = track(along.paletteRole, 'paletteRole', resolve, value => typeof value === 'string', mixRgb, 'step');
    }
    for (const key of ['pigment', 'emissionColor']) if (along[key] !== undefined)
      result[key] = colorTrack(along[key], key);
    for (const [key, max] of [['opacity', 1], ['roughness', 1], ['emission', 8]]) if (along[key] !== undefined)
      result[key] = channel(along[key], key, 0, max);
    return result;
  }

  const lightingPresets = Object.freeze({
    'matte-thread': Object.freeze({ roughness: .87, diffuse: .62, anisotropy: .48, sheen: .18, specular: .04, transmission: .03 }),
    'glossy-hair': Object.freeze({ roughness: .24, diffuse: .54, anisotropy: .94, sheen: .14, specular: .73, transmission: .13 }),
    'metal-wire': Object.freeze({ roughness: .12, diffuse: .8, anisotropy: .62, sheen: .06, specular: 1.1, transmission: 0 }),
    'backlit-fibre': Object.freeze({ roughness: .68, diffuse: .66, anisotropy: .8, sheen: .12, specular: .08, transmission: 1.12 })
  });
  const lightingChannels = { roughness: 1, diffuse: 1, anisotropy: 1, sheen: 4, specular: 4, transmission: 4 };
  const lightingColors = ['highlightColor', 'transmissionColor'];

  function lightingTracks(input) {
    if (input === undefined || input === false) return;
    const settings = typeof input === 'string' ? { preset: input } : input;
    check(settings && Object.getPrototypeOf(settings) === Object.prototype && Object.keys(settings).every(key =>
      key === 'preset' || Object.hasOwn(lightingChannels, key) || lightingColors.includes(key)),
    'invalid strand lighting settings');
    const name = settings.preset ?? 'matte-thread';
    check(label(name) && Object.hasOwn(lightingPresets, name), 'unknown strand lighting preset');
    const preset = lightingPresets[name], result = {};
    for (const [key, limit] of Object.entries(lightingChannels)) {
      const value = settings[key] === undefined ? preset[key] : settings[key];
      result[key] = channel(value, 'lighting.' + key, 0, limit);
    }
    for (const key of lightingColors) if (settings[key] !== undefined)
      result[key] = colorTrack(settings[key], 'lighting.' + key);
    return result;
  }

  function profileStops(channels, resolution) {
    if (!channels.some(p => p?.varying)) return [];
    const stops = new Set(channels.some(profile => profile?.varying && !profile.step) ?
      Array.from({ length: resolution - 1 }, (_, i) => (i + 1) / resolution) : []);
    for (const [i, profile] of channels.entries()) {
      if (!profile?.varying || !profile.keys) continue;
      for (const [j, [u, v]] of profile.keys.entries()) {
        if (u > 0 && u < 1) stops.add(u);
        if (!j || profile.step) continue;
        const [from, previous] = profile.keys[j - 1];
        if (sameValue(v, previous)) continue;
        const steps = i === 2 ? Math.ceil(Math.abs(v - previous) / (Math.PI / 12)) : 8;
        for (let k = 1; k < steps; k++) stops.add(from + (u - from) * k / steps);
        check(stops.size <= segmentLimit, 'profile exceeds the segment budget');
      }
    }
    return [...stops].sort((a, b) => a - b);
  }

  function surfaceChart(input, id = 'surface') {
    if (typeof input?.samplePointNormal === 'function' || typeof input?.sample === 'function') return input;
    const { kind, ...settings } = input ?? {};
    check(['plane', 'cylinder', 'mobius', 'kleinBottle', 'helicoid', 'catenoid'].includes(kind),
      'expected a surface chart sampler or native chart definition');
    return K.procedural.surface[kind]({ id, ...settings });
  }

  function surfacePath({ chart: input, points: controls, id, coordinates = 'canonical', closed = false,
    lift = 0, inset = 0, tolerance = .001, profileSamples = 64 } = {}) {
    const chart = surfaceChart(input);
    const stroke = id ?? chart.id ?? 'surface';
    check(label(stroke) && ['canonical', 'lifted'].includes(coordinates) && typeof closed === 'boolean' &&
      finite(tolerance, 1e-6, 100) && Number.isSafeInteger(profileSamples) && profileSamples >= 8 && profileSamples <= 1024 &&
      Array.isArray(controls) && controls.length >= 2 && controls.length <= segmentLimit + 1,
      'invalid surface stroke ID, coordinate mode or sampling settings');
    const topology = chart.topology ?? K.procedural.surface.topology({
      u: chart.periodicU ? 'periodic' : 'open', v: chart.periodicV ? 'periodic' : 'open'
    });
    const canonical = coordinates === 'canonical', route = [];
    for (const uv of controls) {
      check(topology.contains(uv) && (!canonical || uv.every(n => finite(n, 0, 1))),
        'surface stroke points must be finite UVs within the open chart axes');
      const previous = route.at(-1);
      const at = canonical && previous ? topology.liftNear(uv, previous) : uv.slice();
      if (!previous || at.some((value, i) => value !== previous[i])) route.push(at);
    }
    if (closed && route.length > 1) {
      const end = topology.liftNear(topology.canonical(route[0]).uv, route.at(-1));
      if (end.some((value, i) => value !== route.at(-1)[i])) route.push(end);
    }
    check(route.length >= 2, 'surface stroke must travel along the chart');

    const read = chart.samplePointNormal ?? chart.sample;
    let queries = 0;
    function station(uv) {
      check(++queries <= segmentLimit * 4, 'surface stroke exceeds the sampling budget');
      const { p, n } = read.call(chart, uv) ?? {};
      check(point(p) && point(n) && K.V.len(n) > 1e-8, 'surface chart must return a finite point and nonzero normal');
      return { uv, p: Array.from(p), n: K.V.norm(n) };
    }
    const stations = [station(route[0])];
    const between = (a, b, fraction) => station(a.uv.map((value, i) => mix(value, b.uv[i], fraction)));
    function follow(a, b, depth) {
      const m = between(a, b, .5);
      // The UV bound also prevents several laps from aliasing to a short XYZ chord.
      if (a.uv.some((value, i) => Math.abs(value - b.uv[i]) > 1 / 16) ||
        K.V.dist(m.p, K.V.lerp(a.p, b.p, .5)) > tolerance || K.V.dot(a.n, b.n) < .9848) {
        check(depth < 24, 'surface chart cannot resolve the stroke continuously');
        follow(a, m, depth + 1);
        follow(m, b, depth + 1);
        return;
      }
      check(stations.length <= segmentLimit, 'surface stroke exceeds the station budget');
      stations.push(b);
    }
    for (const uv of route.slice(1)) follow(stations.at(-1), station(uv), 0);

    const metric = [0];
    for (let i = 1; i < stations.length; i++) metric.push(metric.at(-1) + K.V.dist(stations[i - 1].p, stations[i].p));
    const total = metric.at(-1);
    check(total > 1e-7, 'surface stroke must have nonzero arc length');
    const rise = channel(lift, 'surface lift', 0, 100), recess = channel(inset, 'surface inset', 0, 100);
    const cuts = profileStops([rise, recess], profileSamples);
    const result = { id: stroke, points: [], uvs: [], normals: [], closed };
    function append({ uv, p, n }, distance) {
      check(result.points.length <= segmentLimit, 'surface stroke exceeds the station budget');
      const sample = { id: stroke, point: p.slice(), normal: n.slice(), uv: uv.slice(), distance, u: distance / total };
      const shifted = K.V.mad(p, n, rise.sample(sample) - recess.sample(sample));
      check(point(shifted), 'surface stroke exceeds the world coordinate budget');
      result.points.push(shifted);
      result.uvs.push(uv);
      result.normals.push(n);
    }
    append(stations[0], 0);
    for (let i = 1, k = 0; i < stations.length; i++) {
      const from = metric[i - 1] / total, to = metric[i] / total;
      while (cuts[k] <= from + 1e-12) k++;
      while (cuts[k] < to - 1e-12) {
        const u = cuts[k++];
        append(between(stations[i - 1], stations[i], (u - from) / (to - from)), u * total);
      }
      append(stations[i], metric[i]);
    }
    if (closed) {
      check(K.V.dist(result.points[0], result.points.at(-1)) <= 1e-6,
        'closed surface stroke must meet at the same offset and side of its chart');
      result.points[result.points.length - 1] = result.points[0].slice();
    }
    return result;
  }

  function carve(sculpt, host, grooves, options = {}) {
    check(typeof sculpt?.tube === 'function' && typeof sculpt?.join === 'function' && typeof host?.sd === 'function' &&
      Array.isArray(grooves) && grooves.length && grooves.length <= 1024,
      'grooves need a sculpt, a held host solid and a bounded list of strokes');
    let segments = 0;
    const plans = grooves.map(({ source, radius = .05 }) => {
      check(finite(radius, 1e-5, 100), 'invalid groove radius');
      const { points } = surfacePath(source);
      segments += points.length - 1;
      check(segments <= segmentLimit, 'grooves exceed the segment budget');
      return { points, radius };
    });
    const cutters = plans.map(({ points, radius }) => sculpt.tube(points, radius, radius, host.mat, { hold: true }));
    return sculpt.join('cut', host, cutters, {
      res: host.res, tag: host.tag, objectId: host.renderOwner, target: host.renderTarget, mask: true, r: 0, ...options
    });
  }

  function majorAxis(direction, axis, angle) {
    const projected = K.V.mad(direction, axis, -K.V.dot(direction, axis));
    const reference = Math.abs(axis[1]) < .9 ? [0, 1, 0] : [1, 0, 0];
    const n = K.V.norm(K.V.len(projected) > 1e-7 ? projected : K.V.mad(reference, axis, -K.V.dot(reference, axis)));
    return K.V.mad(K.V.mul(n, Math.cos(angle)), K.V.cross(axis, n), Math.sin(angle));
  }

  const capTypes = ['rounded', 'blunt', 'tapered', 'fading'];
  const smooth = x => {
    const u = Math.max(0, Math.min(1, x));
    return u * u * (3 - 2 * u);
  };
  function endStyle(value = 'rounded') {
    const type = typeof value === 'string' ? value : value?.type;
    const length = typeof value === 'string' ? .16 : value?.length ?? .16;
    check(capTypes.includes(type) && finite(length, 1e-5, 1), 'invalid cap style or length');
    return { type, length };
  }
  function capStyles(value) {
    if (value === undefined || typeof value === 'string') {
      const cap = endStyle(value);
      return { start: cap, end: cap };
    }
    check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => key === 'start' || key === 'end'), 'caps need start and end styles');
    return { start: endStyle(value.start), end: endStyle(value.end) };
  }

  function joinStyles(value) {
    check(Array.isArray(value) && value.length <= 128, 'expected up to 128 join edits');
    return Array.from(value, row => {
      const { type, at, length = type === 'break' ? .04 : .12, strength = 1, spread = .25, color } = row ?? {};
      check((type === 'break' || type === 'pool') && finite(at, 0, 1) && finite(length, 1e-5, 1),
        'invalid join type, position or length');
      if (type === 'break') return { type, at, length };
      check(finite(strength, 0, 8) && finite(spread, 0, 4), 'invalid pool strength or spread');
      return { type, at, length, strength, spread, color: color === undefined ? null : rgb(color) };
    });
  }

  function joinRanges(join, closed) {
    const half = join.length / 2;
    return (closed ? [-1, 0, 1] : [0]).map(shift =>
      [Math.max(0, join.at + shift - half), Math.min(1, join.at + shift + half)]).filter(([a, b]) => a < b);
  }

  function strandEnds(knots, lengths, total, caps, joins, closed, profileCuts) {
    const cuts = new Set(profileCuts);
    const add = (from, to) => {
      for (let i = 0; i <= 24; i++) cuts.add(from + (to - from) * i / 24);
    };
    const gaps = [];
    for (const join of joins) for (const [from, to] of joinRanges(join, closed)) {
      if (join.type === 'break') {
        gaps.push({ from, to });
        cuts.add(from);
        cuts.add(to);
      } else add(from, to);
    }
    gaps.sort((a, b) => a.from - b.from);
    const merged = [];
    for (const gap of gaps) {
      const last = merged.at(-1);
      if (last && last.to >= gap.from) last.to = Math.max(last.to, gap.to);
      else merged.push(gap);
    }
    const runs = [];
    let from = 0;
    for (const gap of merged) {
      if (gap.from > from) runs.push({ from, to: gap.from, bluntStart: from > 0, bluntEnd: true });
      from = gap.to;
    }
    if (from < 1) runs.push({ from, to: 1, bluntStart: from > 0, bluntEnd: false });
    if (!closed && runs[0]?.from === 0) {
      runs[0].bluntStart = caps.start.type === 'blunt';
      if (caps.start.type === 'fading' || caps.start.type === 'tapered') add(0, caps.start.length);
    }
    if (!closed && runs.at(-1)?.to === 1) {
      runs.at(-1).bluntEnd = caps.end.type === 'blunt';
      if (caps.end.type === 'fading' || caps.end.type === 'tapered') add(1 - caps.end.length, 1);
    }
    // The plane uses the tangent on the visible side of the authored boundary.
    function plane(u, sign) {
      const at = u * total, tolerance = total * 1e-12;
      let distance = 0;
      for (let i = 0; i < lengths.length; i++) {
        const length = lengths[i];
        if (length < 1e-7) continue;
        const end = distance + length;
        if (sign > 0 ? at < end - tolerance || end === total : at <= end + tolerance) {
          const blend = Math.max(0, Math.min(1, (at - distance) / length));
          return { point: K.V.lerp(knots[i], knots[i + 1], blend),
            normal: K.V.mul(K.V.sub(knots[i + 1], knots[i]), sign / length) };
        }
        distance = end;
      }
      return null;
    }
    for (const run of runs) {
      if (run.bluntStart) run.start = plane(run.from, 1);
      if (run.bluntEnd) run.end = plane(run.to, -1);
    }
    return { runs, stops: [...cuts].filter(u => u > 0 && u < 1).sort((a, b) => a - b) };
  }

  function endWeights(sample, run, caps, closed) {
    if (closed) return [1, 1];
    let width = 1, fade = 1;
    for (const [name, active, distance] of [['start', run.from === 0, sample.u], ['end', run.to === 1, 1 - sample.u]]) {
      const cap = caps[name];
      if (!active || distance >= cap.length) continue;
      if (cap.type === 'tapered') width *= smooth(distance / cap.length);
      if (cap.type === 'fading') fade *= smooth(distance / cap.length);
    }
    return [width, fade];
  }

  function poolAt(sample, pools, closed) {
    let spread = 1, density = 1, tint;
    for (const pool of pools) {
      const delta = Math.abs(sample.u - pool.at), distance = closed ? Math.min(delta, 1 - delta) : delta;
      const weight = smooth(1 - 2 * distance / pool.length);
      if (weight === 0) continue;
      spread += weight * pool.spread;
      density += weight * pool.strength;
      if (pool.color) tint = [...(tint ?? []), [pool.color, weight]];
    }
    return { spread, density, tint };
  }

  function styledOpacity(base, fade, density, edge) {
    if (fade === 1 && density === 1) return base;
    if (edge === 'hard') return fade * (1 - (1 - base) ** density);
    return -Math.expm1(Math.log1p(-Math.min(.999, base)) * fade * density);
  }

  function continuesFrom(plane, from, to) {
    return [from, to].every(point => {
      const offset = K.V.sub(point, plane.point);
      const epsilon = 1e-8 * Math.max(1, K.V.len(offset));
      return K.V.dot(plane.normal, offset) >= -epsilon && K.V.len(K.V.cross(plane.normal, offset)) <= epsilon;
    });
  }

  function prepare(source, options = {}, palette) {
    const link = source?.kind === 'routed' ? source.link : undefined;
    const { radius, width, taper = 1, twist = 0, section = source?.kind === 'surface' ? 'flattened' : undefined,
      edge = 'gaussian', caps: capInput, joins: joinInput = [], up, profileSamples = 96, opacity = edge === 'hard' ? 1 : .94, color = '#eab876', object = link?.id ?? 'curve',
      material = link?.material ?? 'strand', target, maxSegments = segmentLimit } = options;
    const defaultAspect = section === 'flattened' ? .16 : section === 'elliptical' ? .5 :
      section === 'round' || options.twist === undefined ? 1 : .35;
    const aspect = options.aspect === undefined ? defaultAspect : options.aspect;
    check(section === undefined || ['round', 'elliptical', 'flattened'].includes(section), 'expected a round, elliptical or flattened section');
    check(['gaussian', 'beta', 'hard'].includes(edge), 'expected a gaussian, beta or hard edge');
    check(section !== 'round' || aspect === 1, 'round sections use aspect 1');
    check(section !== 'flattened' || aspect <= .99, 'flattened sections need aspect at most .99');
    check((radius === undefined || finite(radius, 1e-6, 100)) && finite(opacity, 0, 1) && label(object) && label(material) &&
      finite(aspect, .1, 1) && (up === undefined || point(up) && K.V.len(up) > 1e-8) &&
      Number.isSafeInteger(profileSamples) && profileSamples >= 8 && profileSamples <= 1024 &&
      Number.isSafeInteger(maxSegments) && maxSegments >= 0 && maxSegments <= segmentLimit,
      'invalid strand appearance, profile resolution or segment budget');
    const profileWidth = width === undefined ? null : channel(width, 'width', 0, 200);
    const profileTaper = channel(taper, 'taper', 0, 1);
    const profileTwist = channel(twist, 'twist', -64 * Math.PI, 64 * Math.PI);
    const framed = aspect < .99999, flattened = section === 'flattened';
    const materials = materialTracks(options.along, palette, options.paletteRoles);
    const light = lightingTracks(options.lighting);
    const profileCuts = profileStops([profileWidth, profileTaper, framed && profileTwist, ...Object.values(materials),
      ...Object.values(light ?? {})], profileSamples);
    const caps = capStyles(capInput), joins = joinStyles(joinInput), pools = joins.filter(join => join.type === 'pool');
    const endEdits = joins.length || caps.start.type !== 'rounded' || caps.end.type !== 'rounded';
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
      if (total === 0) return { id, rows };
      const closed = strand.closed ?? (knots.length > 3 && K.V.dist(knots[0], knots.at(-1)) <= 1e-8);
      const ends = endEdits ? strandEnds(knots, lengths, total, caps, joins, closed, profileCuts) : null;
      const stops = ends?.stops ?? profileCuts;
      let runIndex = 0;
      const retainedFrame = framed && up === undefined && strand.frame;
      const chartNormals = framed && up === undefined && section !== undefined ? strand.normals : undefined;
      const initial = up ?? strand.up ?? [0, 1, 0];
      check(!framed || point(initial) && K.V.len(initial) > 1e-8, 'invalid path frame up vector');
      const frames = framed && total > 0 && !retainedFrame ? K.curve.frames(knots, Array.from(initial)) : null;
      let distance = 0, stop = 0;
      for (let i = 0; i < lengths.length; i++) {
        const from = knots[i], to = knots[i + 1], length = lengths[i];
        if (length < 1e-7) continue;
        const axis = framed && K.V.mul(K.V.sub(to, from), 1 / length);
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
          while (ends?.runs[runIndex] && sample.u > ends.runs[runIndex].to) runIndex++;
          const run = ends?.runs[runIndex];
          const active = !ends || run && sample.u >= run.from;
          if (active && (next - previous) * length >= 1e-7) {
            const [tip, fade] = ends ? endWeights(sample, run, caps, closed) : [1, 1];
            const pool = ends ? poolAt(sample, pools, closed) : { spread: 1, density: 1 };
            const size = Math.min(100, (profileWidth ? profileWidth.sample(sample) / 2 : baseRadius) *
              profileTaper.sample(sample) * tip * pool.spread);
            const rowOpacity = styledOpacity(materials.opacity?.sample(sample) ?? opacity, fade, pool.density, edge);
            if (size < 1e-6) {
              previous = next;
              continue;
            }
            segments++;
            const role = materials.paletteRole?.sample(sample), pigment = materials.pigment?.sample(sample);
            let shade = role && pigment ? role.map((value, k) => value * pigment[k] / 255) :
              role ?? pigment ?? fixedColor ?? rgb(color(sample));
            if (role || pigment) shade = shade.map(Math.round);
            for (const [pigment, weight] of pool.tint ?? [])
              shade = shade.map((value, k) => Math.round(value + weight * (pigment[k] - value)));
            const roughness = materials.roughness?.sample(sample) ?? light?.roughness.sample(sample);
            const emission = materials.emission?.sample(sample) ?? 0;
            const emissionColor = materials.emissionColor?.sample(sample) ?? shade;
            const finish = roughness !== undefined || emission > 0 ?
              [(roughness ?? -1) + 1, ...emissionColor.map(value => value * emission / 255)] : undefined;
            const lighting = light && [
              1 + light.anisotropy.sample(sample), light.diffuse.sample(sample), light.sheen.sample(sample),
              light.specular.sample(sample), light.transmission.sample(sample),
              light.highlightColor ? packed(light.highlightColor.sample(sample).map(Math.round)) : 0xffffff,
              packed((light.transmissionColor?.sample(sample) ?? shade).map(Math.round))
            ];
            let profile;
            if (framed) {
              const a = chartNormals?.[i], b = chartNormals?.[i + 1];
              const direction = retainedFrame ? retainedFrame(arc) : a && b ?
                K.V.cross(K.V.lerp(a, b, middle), axis) : K.V.lerp(frames[i].N, frames[i + 1].N, middle);
              check(point(direction), 'invalid strand frame');
              profile = { major: majorAxis(direction, axis, profileTwist.sample(sample)), aspect, flattened };
            }
            // Trim the kernel near an end without clipping distant sections that turn back past it.
            const reach = size * 6 / total;
            const start = previous === 0 ? from : K.V.lerp(from, to, previous);
            const end = next === 1 ? to : K.V.lerp(from, to, next);
            const left = run?.start && ((distance + previous * length) / total <= run.from + reach ||
              continuesFrom(run.start, start, end)) ? run.start : null;
            const right = run?.end && ((distance + next * length) / total >= run.to - reach ||
              continuesFrom(run.end, start, end)) ? run.end : null;
            rows.push({ from: start, to: end, shade, radius: size, opacity: rowOpacity, profile, finish, lighting,
              clips: left || right ? [left, right] : undefined });
          }
          previous = next;
        } while (previous < 1);
        distance += length;
      }
      return { id, rows };
    });
    return { object, material, target, edge, strands, segments, examined };
  }

  function emit(builder, plan) {
    check(typeof builder?.curveSplat === 'function', 'expected a native splat builder');
    const first = builder.count(), threads = [];
    const groups = plan.edge === 'hard' ? plan.strands.filter(strand => strand.rows.length).length : 0;
    let nextGroup = groups ? builder.reserveCurveGroups(groups) : 0;
    for (const { id, rows } of plan.strands) {
      const start = builder.count();
      const group = nextGroup && rows.length ? nextGroup++ : undefined;
      for (const { from, to, shade, radius, opacity, profile, clips, finish, lighting } of rows)
        builder.curveSplat(from, to, radius, shade, opacity, profile, plan.edge, group, clips, finish, lighting);
      const end = builder.count();
      builder.describeSplats?.(start, end, {
        object: plan.object, material: plan.material, target: { entity: plan.object, ...plan.target, surface: id }
      });
      threads.push({ id, first: start, end });
    }
    return { first, end: builder.count(), threads, segments: plan.segments };
  }

  function draw(builder, source, options) {
    const palette = options?.along?.paletteRole === undefined ? undefined : builder?.P?.map(packed);
    return emit(builder, prepare(source, options, palette));
  }

  function world(recipe) {
    check(recipe?.format === format && recipe.version === 1 && label(recipe.id) &&
      Array.isArray(recipe.strands) && recipe.strands.length > 0 && recipe.strands.length <= 1024,
      'expected a version 1 curve splat scene with named strands');
    const { seed = 1, background = '#172332', palette = [], paletteRoles, camera = {}, look = {}, liveSun, charts = {} } = recipe;
    check(Number.isSafeInteger(seed) && Array.isArray(palette) && palette.length <= 255, 'invalid seed or palette');
    const colors = [packed(background), ...Array.from(palette, packed)];
    check(charts && Object.getPrototypeOf(charts) === Object.prototype && Object.keys(charts).length <= 1024,
      'expected a bounded map of surface charts');
    const carriers = new Map(Object.entries(charts).map(([id, input]) => {
      check(label(id), 'invalid surface chart ID');
      return [id, surfaceChart(input, id)];
    }));
    let remaining = segmentLimit;
    const plans = recipe.strands.map(({ source, ...appearance }, i) => {
      if (source?.kind === 'surface' && typeof source.chart === 'string') {
        check(carriers.has(source.chart), 'unknown surface chart ' + source.chart);
        source = { ...source, chart: carriers.get(source.chart) };
      }
      const plan = prepare(source, { object: 'curve:' + i, paletteRoles, ...appearance, maxSegments: remaining }, colors);
      remaining -= plan.examined;
      return plan;
    });
    if (!palette.length) {
      const unique = new Set(colors);
      for (const plan of plans) for (const strand of plan.strands) for (const row of strand.rows)
        if (unique.size < 256) unique.add(packed(row.shade));
      colors.splice(0, colors.length, ...unique);
    }
    const builder = makeBuilder(seed, colors);
    for (const plan of plans) emit(builder, plan);
    return builder.finish({
      id: recipe.id, curveSplatSource: recipe, cam: { target: [0, 0, 0], dist: 7, yaw: 0, pitch: 0, ...camera }, radius: 10,
      ...(paletteRoles !== undefined && { paletteRoles }), ...(liveSun !== undefined && { liveSun }),
      fog: { c: 0, start: 1, max: 0 }, dither: 0, look: { pixelSize: 1, ...look }
    });
  }

  K.curveSplats = Object.freeze({ format, segmentLimit, lightingPresets, surfacePath, carve, draw, world });
})(KIT);
