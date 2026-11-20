/* Camera-independent sky profiles and their directional radiance sampler. */
const SkyEnvironment = (() => {
  let color;
  try {
    color = ColorSpace;
  } catch {
    color = require('./color-space.js');
  }
  const decode = color.prepare('srgb', 'srgb-linear'), encode = color.prepare('srgb-linear', 'srgb');
  const TAU = Math.PI * 2;
  const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
  const mix = (a, b, t) => a + (b - a) * t;
  const mod = (n, period) => {
    const remainder = n % period;
    return remainder < 0 ? remainder + period : remainder;
  };
  const own = (value, key) => Object.hasOwn(value, key);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const record = (value, name) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError(name + ' needs an object');
    return value;
  };
  const list = (value, size, name) => {
    if (!Array.isArray(value) || value.length > size) throw new TypeError(name + ' needs an array of at most ' + size);
    return value;
  };
  const text = (value, name) => {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(name + ' needs a name');
    return value;
  };
  const bounded = (v, lo, hi, name) => {
    if (!Number.isFinite(v) || v < lo || v > hi) throw new RangeError(name + ' is out of range');
    return v;
  };
  const vector = (value, size, name) => {
    if (!Array.isArray(value) || value.length !== size || !Array.from(value).every(Number.isFinite))
      throw new TypeError(name + ' needs ' + size + ' finite numbers');
    return value.slice();
  };
  const rgb = value => {
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new TypeError('Expected #rrggbb');
    return [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255);
  };
  const direction = (azimuth, elevation) => [
    Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation)
  ];
  const colorChannels = ['zenith', 'horizon', 'ground', 'sunColor', 'overcastColor'];
  const ranges = { daylight: [0, 1], sunAzimuth: [-1e6, 1e6], sunAltitude: [-Math.PI/2, Math.PI/2],
    sunSize: [.001, .3], sunStrength: [0, 8], overcast: [0, 1],
    aerialStart: [0, 1e6], aerialDensity: [0, 64], aerialContrast: [0, 1],
    cloudShadowStrength: [0, 1], cloudShadowSoftness: [0, 1000] };
  const base = Object.freeze({
    zenith: '#234a80', horizon: '#aec5cc', ground: '#263442', sunColor: '#ffe7be',
    sunAzimuth: 2.8, sunAltitude: .36, sunSize: .022, sunStrength: .6, orthoFov: 38
  });
  const easings = Object.freeze({ linear: t => t, smooth: t => t * t * (3 - 2 * t), hold: () => 0 });
  const compiled = Symbol.for('ink-studio.sky-environment');

  function parameters(value, name) {
    return Object.fromEntries(Object.entries(record(value, name)).map(([key, v]) => {
      if (typeof v === 'string' && !own(ranges, key)) return [key, decode(rgb(v))];
      if (colorChannels.includes(key)) throw new TypeError(key + ' needs a hex colour');
      const [lo, hi] = own(ranges, key) ? ranges[key] : [-1e6, 1e6];
      return [key, bounded(v, lo, hi, key)];
    }));
  }
  function compatible(a, b) {
    return Object.keys(a).length === Object.keys(b).length &&
      Object.keys(a).every(key => own(b, key) && typeof a[key] === typeof b[key]);
  }
  function blend(a, b, t) {
    return Object.fromEntries(Object.entries(a).map(([key, v]) => {
      const w = b[key];
      if (Array.isArray(v)) return [key, v.map((c, i) => mix(c, w[i], t))];
      const target = key === 'sunAzimuth' && t > 0 && t < 1 ? v + mod(w - v + Math.PI, TAU) - Math.PI : w;
      return [key, mix(v, target, t)];
    }));
  }
  function sequence(value, profiles, id) {
    const { keys, duration, loop = true } = record(value, 'Sequence ' + id);
    bounded(duration, Number.MIN_VALUE, 1e9, 'Sequence duration');
    if (typeof loop !== 'boolean') throw new TypeError('Sequence loop must be boolean');
    const entries = list(keys, 2048, 'Sequence keys').map((key, i) => {
      const { at, profile, ease = 'smooth' } = record(key, 'Sequence key');
      if (!Number.isFinite(at) || (i === 0 ? at !== 0 : at <= keys[i - 1].at) || at >= duration)
        throw new RangeError('Sequence keys must start at zero and increase before the duration');
      if (!profiles.has(profile) || !own(easings, ease)) throw new RangeError('Unknown profile or easing in ' + id);
      return { at, profile: profiles.get(profile), ease: easings[ease] };
    });
    if (!entries.length || entries.some(key => !compatible(key.profile, entries[0].profile)))
      throw new TypeError('Profiles in ' + id + ' must define the same parameter names and types');
    const start = entries[0].profile;
    if (loop) entries.push({ at: duration, profile: start });
    function sample(seconds) {
      const t = loop ? mod(seconds, duration) : clamp(seconds, 0, duration);
      let lo = 0, hi = entries.length - 1;
      if (t >= entries[hi].at) return entries[hi].profile;
      while (hi - lo > 1) {
        const i = (lo + hi) >>> 1;
        if (t < entries[i].at) hi = i;
        else lo = i;
      }
      const a = entries[lo], b = entries[hi];
      return blend(a.profile, b.profile, a.ease((t - a.at) / (b.at - a.at)));
    }
    return { start, sample };
  }

  function compile(value = {}) {
    if (value?.[compiled] === true) return value;
    const { defaults = {}, profiles = {}, sequences = {}, tracks = [], sky = {} } = record(value, 'Sky environment');
    const initial = parameters(defaults, 'Defaults');
    const looks = new Map(Object.entries(record(profiles, 'Profiles')).map(([id, params]) => [id, parameters(params, id)]));
    const clips = new Map(Object.entries(record(sequences, 'Sequences')).map(([id, clip]) => [id, sequence(clip, looks, id)]));
    const ids = new Set(), channelTypes = Object.assign(Object.create(null), initial);
    const schedule = list(tracks, 128, 'Tracks').map(value => {
      const { id, sequence: name, offset = 0, speed = 1 } = record(value, 'Track');
      text(id, 'Track ID');
      if (ids.has(id) || !clips.has(name)) throw new RangeError('Duplicate track or missing sequence: ' + id);
      ids.add(id);
      const clip = clips.get(name);
      for (const [key, channel] of Object.entries(clip.start)) {
        if (own(channelTypes, key) && typeof channelTypes[key] !== typeof channel)
          throw new TypeError(key + ' changes type across tracks');
        channelTypes[key] = channel;
      }
      return { id, clip, offset: bounded(offset, -1e9, 1e9, 'Track offset'), speed: bounded(speed, -1e6, 1e6, 'Track speed') };
    });
    function binding(name, type) {
      if (name === undefined) return;
      if (typeof name !== 'string' || !own(channelTypes, name) || typeof channelTypes[name] !== type)
        throw new TypeError('Missing ' + type + ' parameter ' + name);
      return name;
    }
    function gainBinding(name) {
      const key = binding(name, 'number');
      if (key !== undefined && [initial, ...looks.values()].some(p => own(p, key) && p[key] < 0))
        throw new RangeError('Gain parameter ' + key + ' must be nonnegative');
      return key;
    }
    const common = raw => ({ id: text(raw.id, 'Layer ID'), opacity: bounded(raw.opacity ?? 1, 0, 1, 'Layer opacity'),
      gain: gainBinding(raw.gain), tint: binding(raw.tint, 'object') });
    const layerIds = new Set();
    function unique(raw) {
      const layer = common(raw);
      if (layerIds.has(layer.id)) throw new RangeError('Duplicate environment layer: ' + layer.id);
      layerIds.add(layer.id);
      return layer;
    }
    function widths(raw, limit) {
      const size = vector(raw.size, 2, 'Layer size');
      return size.map(n => bounded(n, 1e-5, limit, 'Layer size'));
    }
    let backdrop = null;
    if (sky !== false) {
      const { orthoFov = base.orthoFov, splats = [] } = record(sky, 'Sky');
      backdrop = { orthoFov: bounded(orthoFov, 1, 160, 'Orthographic sky FOV'),
        splats: list(splats, 4096, 'Angular splats').map(raw => {
          record(raw, 'Angular splat');
          const [az, el] = vector(raw.at, 2, 'Splat azimuth and elevation');
          bounded(el, -Math.PI/2, Math.PI/2, 'Splat elevation');
          return { ...unique(raw), direction: direction(az, el),
            right: [Math.cos(az), 0, -Math.sin(az)], up: direction(az, el + Math.PI/2),
            size: widths(raw, .45), color: rgb(raw.color ?? '#ffffff') };
        }) };
    }
    function sample(seconds, overrides = {}) {
      if (!Number.isFinite(seconds)) throw new TypeError('Sky time must be finite seconds');
      const pins = new Map(Object.entries(record(overrides, 'Profile overrides')));
      for (const id of pins.keys()) if (!ids.has(id)) throw new RangeError('Unknown profile track ' + id);
      const params = Object.assign(Object.create(null), initial);
      for (const { id, clip, offset, speed } of schedule) {
        const time = seconds * speed - offset;
        if (!Number.isFinite(time)) throw new RangeError('Track time is out of range');
        const pin = pins.get(id), profile = pins.has(id) ? looks.get(pin) : clip.sample(time);
        if (!profile || pins.has(id) && !compatible(profile, clip.start))
          throw new RangeError('Incompatible profile ' + pin + ' for ' + id);
        Object.assign(params, profile);
      }
      return Object.fromEntries(Object.entries(params).map(([key, v]) => [key, Array.isArray(v) ? encode(v) : v]));
    }

    function frame(seconds, overrides) {
      const p = Object.assign(Object.create(null), sample(seconds, overrides));
      const sun = direction(mod(p.sunAzimuth ?? base.sunAzimuth, TAU), p.sunAltitude ?? base.sunAltitude);
      function style(layer) {
        const tint = layer.tint === undefined ? [1, 1, 1] : p[layer.tint];
        return { ...layer, opacity: clamp(layer.opacity * (layer.gain === undefined ? 1 : p[layer.gain])),
          color: layer.color.map((v, i) => v * tint[i]) };
      }
      const overcast = p.overcast ?? 0, veil = p.overcastColor ?? rgb('#788897');
      const sunStrength = (p.sunStrength ?? base.sunStrength) * (1 - overcast);
      const backdropColor = (key, weight) => (p[key] ?? rgb(base[key])).map((c, i) => mix(c, veil[i], overcast * weight));
      const sky = backdrop && {
        orthoFov: backdrop.orthoFov * Math.PI / 180, sun,
        zenith: backdropColor('zenith', .82), horizon: backdropColor('horizon', .68), ground: backdropColor('ground', .35),
        sunColor: p.sunColor ?? rgb(base.sunColor), sunStrength,
        sunEdge: Math.cos(p.sunSize ?? base.sunSize), sunCore: Math.cos(.86 * (p.sunSize ?? base.sunSize)),
        splats: backdrop.splats.map(style).filter(layer => layer.opacity > 0)
      };
      return { parameters: p, sky };
    }
    return Object.freeze({ [compiled]: true, sample, frame });
  }

  function aerial(authored, override, profile = {}) {
    const enabled = override ?? authored;
    if (enabled === false || enabled === undefined) return null;
    function settings(value) {
      if (value === true || value === false || value === undefined) return {};
      const result = record(value, 'Aerial perspective');
      if (Object.keys(result).some(key => !['start', 'density', 'contrast'].includes(key)))
        throw new TypeError('Aerial perspective needs start, density and contrast settings');
      return result;
    }
    const { start = profile.aerialStart ?? 8, density = profile.aerialDensity ?? .065,
      contrast = profile.aerialContrast ?? .15 } = { ...settings(authored), ...settings(override ?? undefined) };
    bounded(start, ...ranges.aerialStart, 'Aerial start distance');
    bounded(density, ...ranges.aerialDensity, 'Aerial density');
    bounded(contrast, ...ranges.aerialContrast, 'Aerial contrast');
    return density > 0 && contrast < 1 ? { start, density, contrast } : null;
  }

  const airTransmission = (settings, distance) =>
    settings.contrast + (1 - settings.contrast) * Math.exp(-settings.density * Math.max(0, distance));

  function atmosphere(sky, ray, output, diskVisible) {
    const height = ray[1], horizon = height > 0 ? sky.zenith : sky.ground;
    const fade = height > 0 ? Math.sqrt(height) : clamp(-height * 3);
    const angle = dot(ray, sky.sun);
    const disk = diskVisible && height >= 0 ? .92 * clamp((angle - sky.sunEdge) / (sky.sunCore - sky.sunEdge)) : 0;
    const glow = angle > 0 && height >= 0 ? .22 * Math.exp(-19 * (1 - angle)) : 0;
    const sunlight = clamp((disk + glow) * sky.sunStrength);
    for (let c = 0; c < 3; c++) output[c] = mix(mix(sky.horizon[c], horizon[c], fade), sky.sunColor[c], sunlight);
    return output;
  }

  // The glow is scattered light. The solar disk and directional accents are background light sources.
  function scattering(sky, direction, output = [0, 0, 0]) {
    if (direction[1] >= 0) return atmosphere(sky, direction, output, false);
    // Distant surfaces below the horizon take the air colour along their azimuth.
    const span = Math.hypot(direction[0], direction[2]);
    const alongHorizon = span > 0 ? [direction[0] / span, 0, direction[2] / span] : [0, 0, 0];
    return atmosphere(sky, alongHorizon, output, false);
  }

  function shade(sky, ray, output = [0, 0, 0]) {
    atmosphere(sky, ray, output, true);
    for (const splat of sky.splats) {
      const forward = dot(ray, splat.direction);
      if (forward <= 0) continue;
      const x = dot(ray, splat.right) / (splat.size[0] * forward);
      if (Math.abs(x) > 3) continue;
      const y = dot(ray, splat.up) / (splat.size[1] * forward), radius = x*x + y*y;
      if (radius >= 9) continue;
      const alpha = splat.opacity * Math.exp(-radius / 2);
      for (let c = 0; c < 3; c++) output[c] = mix(output[c], splat.color[c], alpha);
    }
    return output;
  }
  return Object.freeze({ compile, shade, aerial, airTransmission, scattering });
})();
if (typeof module !== 'undefined') module.exports = SkyEnvironment;
