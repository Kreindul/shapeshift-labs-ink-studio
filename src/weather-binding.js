/* Environment tracks drive both rendered weather and retained surface forcing. */
const WeatherBinding = (() => {
  const defaults = {
    rain: 'rain', snowfall: 'snowfall', air: 'airTemperature', humidity: 'humidity',
    windX: 'windX', windZ: 'windZ', fogDensity: 'fogDensity', wetness: 'surfaceWetness', light: 'daylight'
  };
  const ranges = {
    rain: [0,1000], snowfall: [0,1000], air: [-240,500], humidity: [0,1],
    windX: [-20,20], windZ: [-20,20], fogDensity: [0,64], wetness: [0,1], light: [0,1]
  };
  function record(value, name) {
    if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
      throw new TypeError(name + ' must be an object');
    return value;
  }
  function number(value, min, max, name) {
    if (!Number.isFinite(value) || value < min || value > max)
      throw new RangeError(name + ' must be in [' + min + ', ' + max + ']');
    return value;
  }

  function settings(value, override) {
    if (override === false || (override === undefined && (value === false || value === undefined))) return null;
    const read = raw => raw === undefined || raw === true || raw === false ? {} : record(raw, 'Weather binding');
    const base = read(value), edits = read(override);
    let surface = edits.surface === undefined ? base.surface : edits.surface;
    if (base.surface && edits.surface && typeof base.surface === 'object' && typeof edits.surface === 'object')
      surface = { ...record(base.surface, 'Weather surface'), ...record(edits.surface, 'Weather surface') };
    const { rainFull = 1, snowFull = 1, windDryingSpeed = 5, fogVolumes } = { ...base, ...edits };
    const channels = { ...base.channels, ...edits.channels };
    for (const raw of [base, edits]) {
      if (Object.keys(raw).some(key => !['channels', 'rainFull', 'snowFull', 'windDryingSpeed', 'fogVolumes', 'surface'].includes(key)))
        throw new RangeError('Unknown weather binding setting');
      if (raw.channels !== undefined) record(raw.channels, 'Weather channels');
    }
    for (const [key, channel] of Object.entries(channels)) {
      if (!Object.hasOwn(defaults, key) || (channel !== false && (typeof channel !== 'string' || !channel.trim())))
        throw new TypeError('Invalid weather channel binding for ' + key);
    }
    number(rainFull, 1e-6, 1000, 'Full visual rain rate');
    number(snowFull, 1e-6, 1000, 'Full visual snow rate');
    number(windDryingSpeed, 1e-6, 1000, 'Wind drying speed');
    if (fogVolumes !== undefined && (!Array.isArray(fogVolumes) ||
        !Array.from(fogVolumes).every(id => typeof id === 'string' && id.trim())))
      throw new TypeError('Weather fog volumes must be a list of volume IDs');
    let retained;
    if (surface !== undefined && surface !== false) {
      const { step = .125, forcing, ...options } = record(surface, 'Weather surface');
      number(step, .001, 3, 'Weather surface step');
      if (forcing !== undefined && typeof forcing !== 'function')
        throw new TypeError('Weather surface forcing must be a function');
      retained = { step, forcing, options };
    }
    return { channels, rainFull, snowFull, windDryingSpeed, fogVolumes: fogVolumes && new Set(fogVolumes), surface: retained };
  }

  function bind(environment, config, { profiles, createSurface } = {}) {
    if (!config) return null;
    if (!environment?.sample) throw new TypeError('Weather binding needs a sky environment');
    const pins = profiles === undefined ? undefined : Object.freeze({ ...profiles });
    const { channels, rainFull, snowFull, windDryingSpeed, fogVolumes, surface } = config;
    const keys = Object.keys(defaults);
    function read(parameters) {
      const signal = {};
      for (const key of keys) {
        const channel = channels[key] ?? defaults[key];
        if (channel === false) continue;
        if (Object.hasOwn(parameters, channel)) signal[key] = number(parameters[channel], ...ranges[key], 'Weather ' + channel);
        else if (Object.hasOwn(channels, key)) throw new RangeError('Missing weather channel ' + channel);
      }
      const { windX, windZ } = signal;
      return { ...signal, wind: windX === undefined && windZ === undefined ? undefined : [windX ?? 0, windZ ?? 0] };
    }
    const sample = time => read(environment.sample(time, pins));
    sample(0);

    function forcing(local) {
      if (local !== undefined && typeof local !== 'function') throw new TypeError('Weather forcing must be a function');
      let lastTime, signal, uniform;
      return (x, z, time, state) => {
        if (time !== lastTime) {
          signal = sample(time);
          lastTime = time;
          const { rain, snowfall, air, humidity, wind, light } = signal;
          uniform = { rain, snowfall, air, humidity, light,
            wind: wind && Math.min(1, Math.hypot(...wind) / windDryingSpeed) };
        }
        return local ? { ...uniform, ...local(x, z, time, state, signal) } : uniform;
      };
    }
    let solver, snapshot, tick = 0;
    const input = surface && forcing(surface.forcing);
    function surfaceAt(time) {
      if (!surface) return undefined;
      if (!Number.isFinite(time)) throw new RangeError('Weather time must be finite');
      // Anchor each integration to the same fixed ticks for sequential renders and random seeks.
      const target = Math.max(0, Math.floor(time / surface.step + 1e-9));
      if (!Number.isSafeInteger(target) || target - (target < tick ? 0 : tick) > 16384)
        throw new RangeError('Weather seek exceeds the surface integration budget');
      if (!solver || target < tick) {
        solver = createSurface(surface.options);
        snapshot = solver.snapshot();
        tick = 0;
      }
      while (tick < target) {
        snapshot = solver.step(surface.step, { forcing: input });
        tick++;
      }
      return snapshot;
    }
    function frame(time, parameters) {
      const signal = parameters ? read(parameters) : sample(time);
      const state = surfaceAt(time);
      const wetness = signal.wetness;
      return { ...signal, rainGain: Math.min(1, (signal.rain ?? 0) / rainFull),
        snowGain: Math.min(1, (signal.snowfall ?? 0) / snowFull),
        rainAt: at => Math.min(1, (sample(at).rain ?? 0) / rainFull),
        windAt: signal.wind && (at => sample(at).wind),
        fogGain: volume => !fogVolumes || fogVolumes.has(volume.id) ? signal.fogDensity ?? 1 : 1,
        surface: state || wetness !== undefined ? (x, z) => {
          const point = state?.sample(x, z);
          if (state && !point) return null;
          if (wetness === undefined) return point;
          return { ...point, wetness: Math.max(wetness, point?.wetness ?? 0) };
        } : undefined };
    }
    return Object.freeze({ sample, forcing, frame, surfaceAt });
  }

  return Object.freeze({ settings, bind });
})();
if (typeof module !== 'undefined') module.exports = WeatherBinding;
