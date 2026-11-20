const WeatherBinding = require('../src/weather-binding.js');

const sessions = new WeakMap();
function weatherFrame(world, options, source, environment, parameters, time) {
  const authored = world.weatherBinding, override = options.weatherBinding;
  if (override === false || source === false || (override === undefined && (authored === undefined || authored === false))) return null;
  const pins = JSON.stringify(Object.entries(options.skyProfiles ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  const track = source === environment ? source : JSON.stringify(source);
  let cached = sessions.get(world);
  if (!cached || cached.authored !== authored || cached.override !== override || cached.track !== track || cached.pins !== pins) {
    const config = WeatherBinding.settings(authored, override);
    const binding = WeatherBinding.bind(environment, config, {
      profiles: options.skyProfiles,
      createSurface: settings => require('../index.js').load().KIT.procedural.motion.surfaceWeather(settings)
    });
    cached = { authored, override, track, pins, binding };
    sessions.set(world, cached);
  }
  return cached.binding?.frame(time, parameters);
}
module.exports = weatherFrame;
