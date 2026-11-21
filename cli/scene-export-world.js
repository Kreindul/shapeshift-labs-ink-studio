/* Native world and take sources share the picture clock used by soundtrack export. */
const fs = require('node:fs');
const path = require('node:path');
const { embed } = require('./data-inputs.js');

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function readExportWorld(file, kit) {
  if (!/\.json$/i.test(file)) return;
  let location = path.resolve(file), source = read(location), settings = source?.takeClock;
  const { KIT: K } = kit, T = K.procedural.takeTime;
  if (source?.format === 'ink-studio/take') {
    if (source.version !== 1 || typeof source.world !== 'string' || !source.world)
      throw new TypeError('Scene export needs a take with a native world');
    const { clock, world } = source;
    settings = clock ?? {};
    location = path.resolve(path.dirname(location), world);
    source = { ...read(location), takeClock: settings };
    source.dt ??= K.timeDomains.take(settings).dt;
  } else if (source?.format !== K.world.format) return;
  if (source.dataInputs !== undefined)
    source.dataInputs = embed(K.dataInputs, source.dataInputs, location);
  const create = () => K.world.runtime.create(source);
  return {
    fps: settings?.fps,
    capture({ width, height, options, render }) {
      const run = create(), original = run.view(), { dt } = original.world;
      const period = settings?.simulationRate === undefined ? T.period(dt) : T.div(T.read(1), T.read(settings.simulationRate));
      const clock = settings && K.timeDomains.take(settings);
      const cuts = (settings?.cuts ?? []).map(row => row.frame).sort((a, b) => a - b);
      let nextCut = 0;
      return { scene: original.world.id, title: original.world.visual?.name ?? original.world.id,
        duration: run.timeline?.duration ?? 0, timeline: run.timeline, runtime: create,
        sample(time, _lastTime, coordinate) {
          const point = coordinate?.point ?? T.read(time);
          const tick = T.index(T.roundDown(T.div(point, period)));
          const view = run.advance(tick);
          const picture = clock && T.locate(clock, point).frame;
          const sample = clock && clock.at(picture);
          const cut = cuts[nextCut] <= picture;
          while (cuts[nextCut] <= picture) nextCut++;
          const take = sample && T.compare(T.requireFrame(sample).start, point) === 0 ? sample : undefined;
          const world = K.world.visual(kit, view, run.query(), { time, take });
          return render(world, { ...options, w: width, h: height, time, take, renderHistoryKey: run, ...(cut && { resetRenderHistory: true }) });
        }
      };
    }
  };
}

module.exports = { readExportWorld };
