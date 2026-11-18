/* A scene clock, height-dependent optical depth, and surface deposition. */
(function (K) {
  const P = K.procedural || K.authoring, V = K.V;
  const clamp = v => Math.max(0, Math.min(1, v)), TAU = 2 * Math.PI;
  const wrap = (v, span) => ((v % span) + span) % span;
  const within = (v, a, b) => Number.isFinite(v) && v >= a && v <= b;
  const vector = p => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
  const ease = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const fogDefaults = { density: .038, height: 2.2, floor: 0, cling: .65, color: [.67, .74, .73] };
  const defaults = P.data.freeze({ hour: 12, rate: 0, latitude: 39, declination: 18, north: 0,
    fog: fogDefaults, autumn: 0, snow: 0, wind: [.18, .10] });

  function medium(options = {}) {
    const f = { ...fogDefaults, ...options };
    if (!within(f.density, 0, 2) || !within(f.height, .03, 128) || !within(f.floor, -256, 256) ||
        !within(f.cling, 0, 1) || !vector(f.color) || !f.color.every(v => within(v, 0, 1)))
      throw Error('Invalid height-fog medium');
    return { density: f.density, height: f.height, floor: f.floor, cling: f.cling, color: f.color.slice() };
  }

  function evaluate(options = {}, elapsed = 0) {
    const p = { ...defaults, ...options };
    if (!within(p.hour, 0, 24) || !within(p.rate, -24, 24) || !within(p.latitude, -90, 90) ||
        !within(p.declination, -90, 90) || !Number.isFinite(p.north) || !Number.isFinite(elapsed) ||
        !within(p.autumn, 0, 1) || !within(p.snow, 0, 1) || !Array.isArray(p.wind) ||
        p.wind.length !== 2 || !p.wind.every(v => within(v, -20, 20))) throw Error('Invalid environment clock or surface settings');
    const period = p.rate ? 24 / Math.abs(p.rate) : Infinity;
    const advance = (Number.isFinite(period) ? elapsed % period : elapsed) * p.rate;
    const hour = wrap(p.hour + advance, 24),
      a = (hour - 12) * TAU / 24, lat = p.latitude * TAU / 360, dec = p.declination * TAU / 360,
      north = wrap(p.north, 360) * TAU / 360;
    const east = -Math.sin(a) * Math.cos(dec), up = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(a),
      south = Math.sin(lat) * Math.cos(dec) * Math.cos(a) - Math.cos(lat) * Math.sin(dec);
    const sun = [east * Math.cos(north) + south * Math.sin(north), up, -east * Math.sin(north) + south * Math.cos(north)];
    const daylight = ease(-.18, .31, up), twilight = (1 - ease(.02, .52, Math.abs(up))) * ease(-.24, -.05, up);
    const tint = [.67 + daylight * .33 + twilight * .2, .78 + daylight * .22 + twilight * .02, 1.08 - daylight * .08 - twilight * .16];
    return P.data.freeze({ hour, sun, daylight, twilight, ambient: .36 + .64 * daylight, tint,
      fog: medium(p.fog), autumn: p.autumn, snow: p.snow, wind: p.wind.slice() });
  }

  function opticalDepth(from, to, options) {
    if (!vector(from) || !vector(to)) throw Error('Fog segment needs finite XYZ endpoints');
    const f = medium(options), low = (Math.min(from[1], to[1]) - f.floor) / f.height,
      high = (Math.max(from[1], to[1]) - f.floor) / f.height, span = high - low;
    const below = Math.max(0, -low) - Math.max(0, -high);
    const mean = span < 1e-5 ? Math.exp(-Math.max(0, low)) :
      (below + Math.exp(-Math.max(0, low)) - Math.exp(-Math.max(0, high))) / span;
    return V.dist(from, to) * f.density * (1 - f.cling + f.cling * clamp(mean));
  }

  function deposition({ normal, load, exposure = 1, shelter = 0, texture = .5, slope = [.28, .88] }) {
    if (!vector(normal) || V.len(normal) < 1e-8 || ![load, exposure, shelter, texture].every(v => within(v, 0, 1)) ||
        !Array.isArray(slope) || slope.length !== 2 || !slope.every(v => within(v, -1, 1)) || slope[0] >= slope[1])
      throw Error('Deposition needs a surface normal and bounded coverage inputs');
    const angle = ease(slope[0], slope[1], normal[1] / V.len(normal));
    return clamp(load * angle * exposure * (.65 + .5 * texture + .26 * shelter));
  }

  function scatter(from, to, light, options) {
    if (!vector(from) || !vector(to) || !vector(light?.p) || !within(light.radius, .001, 1024) || !within(light.intensity, 0, 64))
      throw Error('Fog light needs finite endpoints, a position, radius and intensity');
    const f = medium(options), length = V.dist(from, to);
    if (!length || !f.density || !light.intensity) return 0;
    const ray = V.mul(V.sub(to, from), 1 / length), delta = V.sub(light.p, from),
      near = V.dot(delta, ray), perp2 = Math.max(0, V.dot(delta, delta) - near * near), rr = light.radius ** 2;
    if (perp2 >= rr) return 0;
    const chord = Math.sqrt(rr - perp2), enter = Math.max(0, near - chord), exit = Math.min(length, near + chord);
    if (exit <= enter) return 0;
    const y = from[1] + ray[1] * (enter + exit) * .5,
      density = f.density * (1 - f.cling + f.cling * Math.exp(-Math.max(0, y - f.floor) / f.height)),
      amount = (exit - enter) * density * (1 - perp2 / rr) * light.intensity;
    return -Math.expm1(-amount * .72) * Math.exp(-opticalDepth(from, to, f) * .38 * enter / Math.max(1, length));
  }

  P.environmentFields = Object.freeze({ defaults, evaluate, medium, opticalDepth, deposition, scatter });
})(KIT);
