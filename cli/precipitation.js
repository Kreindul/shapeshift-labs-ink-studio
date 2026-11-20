const Airflow = require('../src/airflow.js');
const LightSchedule = require('../src/light-schedule.js');
const SceneOptics = require('../src/scene-optics.js');

function settings(authored, override) {
  if (override === false || (authored === false && override === undefined)) return null;
  const record = value => {
    if (value === undefined || value === true || value === false) return {};
    if (!value || Object.getPrototypeOf(value) !== Object.prototype)
      throw new TypeError('World precipitation settings must be an object');
    return value;
  };
  const values = { ...record(authored), ...record(override) };
  if (Object.keys(values).some(key => !['rain', 'snow', 'occluder', 'occlusion', 'flightSegments', 'lightStrength'].includes(key)))
    throw new RangeError('Unknown world precipitation setting');
  const { rain = 1, snow = 1, occlusion = true, occluder, flightSegments = 8, lightStrength = .65 } = values;
  if ([rain, snow].some(value => !Number.isFinite(value) || value < 0 || value > 1) ||
      !Number.isFinite(lightStrength) || lightStrength < 0 || lightStrength > 8 ||
      typeof occlusion !== 'boolean' || (occluder !== undefined && typeof occluder !== 'function') ||
      !Number.isInteger(flightSegments) || flightSegments < 1 || flightSegments > 64)
    throw new RangeError('Invalid world precipitation rates, occlusion or light strength');
  return { rain, snow, occlusion, occluder, flightSegments, lightStrength };
}

function windPath(time, duration, wind, windAt) {
  if (!windAt) return age => [wind[0] * age, wind[1] * age];
  // Integrate a shared, linearly interpolated velocity history for the whole emitter set.
  const count = Math.min(256, Math.max(1, Math.ceil(duration * 24)));
  const step = duration / count, velocity = [wind], sums = [[0,0]];
  for (let i = 1; i <= count; i++) {
    velocity.push(Airflow.frame(windAt(time - i * step) ?? wind).velocity);
    sums.push(sums[i - 1].map((value, axis) => value + step * (velocity[i - 1][axis] + velocity[i][axis]) * .5));
  }
  return age => {
    if (age >= duration) return sums[count];
    const index = Math.min(count - 1, Math.floor(age / step)), dt = age - index * step;
    return sums[index].map((value, axis) => value + dt *
      (velocity[index][axis] + (velocity[index + 1][axis] - velocity[index][axis]) * .5 * dt / step));
  };
}

function blocks(occluder, from, to, time) {
  const delta = to.map((n, i) => n - from[i]), distance = Math.hypot(...delta);
  return distance > 1e-6 && occluder(...from, delta.map(n => n / distance), distance, time);
}

function frame(world, override, { time, wind, windAt, weather, lamps, localLighting }) {
  if (!world.precipitationRanges?.length) return null;
  const config = settings(world.precipitation, override);
  // Tag the authored rows even in the disabled view so they disappear together.
  const rows = new Uint8Array(world.count);
  let duration = 0;
  for (const { first, end, profile } of world.precipitationRanges) {
    rows.fill(profile ? 2 : 1, first, end);
    if (config && windAt) for (let row = first; row < end; row++) {
      const q = row * 16;
      duration = Math.max(duration, world.data[q + 14] / world.data[q + 13]);
    }
  }
  if (!config) return { rows };
  const { occlusion, occluder, flightSegments, lightStrength } = config;
  const drift = windPath(time, duration, wind, duration > 0 ? windAt : undefined);
  const fade = (a, b, value) => {
    const u = Math.max(0, Math.min(1, (value - a) / (b - a)));
    return u * u * (3 - 2 * u);
  };

  function pose(index, x, y, z, kind, phase, speed, height, sway, alpha) {
    const snow = kind === 15, profile = rows[index] === 2;
    const rate = snow ? config.snow * (profile ? weather?.snowGain ?? 0 : 1) :
      config.rain * (profile ? weather?.rainGain ?? 0 : 1);
    if (!rate || !alpha) return null;
    const cycle = time * speed / height + phase, fraction = cycle - Math.floor(cycle);
    const age = fraction * height / speed;
    const total = drift(age);
    function point(progress) {
      const flown = progress * fraction;
      const remaining = drift(age * (1 - progress));
      const wx = snow ? (Math.sin(flown * 11 + phase * 40) - Math.sin(phase * 40)) * sway : 0;
      const wz = snow ? (Math.cos(flown * 7 + phase * 23) - Math.cos(phase * 23)) * sway * .6 : 0;
      return [x + total[0] - remaining[0] + wx, y - flown * height, z + total[1] - remaining[1] + wz];
    }
    const position = point(1);
    if (occlusion && occluder) {
      const count = snow || windAt ? flightSegments : 1;
      let from = [x,y,z];
      for (let i = 1; i <= count; i++) {
        const to = i === count ? position : point(i / count);
        if (blocks(occluder, from, to, time - age * (1 - (i - .5) / count))) return null;
        from = to;
      }
    }
    const coverage = snow ? fade(0,.05,fraction) * (1 - fade(.92,1,fraction)) : 1 - fraction * fraction;
    return [...position, Math.min(.99, alpha * rate * coverage)];
  }

  const media = lightStrength && localLighting();
  const lighting = lightStrength && (media || lamps.length) ? (x, y, z) => {
    const out = [0,0,0];
    if (media) SceneOptics.addLocalLight(media, x, y, z, out);
    const from = [x,y,z];
    for (const lamp of lamps) {
      const amount = LightSchedule.contribution(lamp, x, y, z);
      if (!amount || (occluder && blocks(occluder, from, lamp.p, time))) continue;
      for (let i = 0; i < 3; i++) out[i] += lamp.color[i] * amount;
    }
    return out.map(value => value * lightStrength);
  } : null;
  return { rows, pose, lighting };
}

module.exports = { frame, settings };
