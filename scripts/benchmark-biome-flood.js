// Run from a Node checkout. Both lanes realize the same post-cut frame.
const assert = require('node:assert/strict');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const floodValley = require('../examples/biome-flood');
const { KIT } = require('..').load();

const args = process.argv.slice(2);
const runs = Number(args.find(arg => arg.startsWith('--runs='))?.slice(7) ?? 9);
const json = args.includes('--json');
if (!Number.isSafeInteger(runs) || runs < 3 || runs > 100 ||
    args.some(arg => arg !== '--json' && !arg.startsWith('--runs='))) {
  console.error('Usage: node scripts/benchmark-biome-flood.js [--runs=9] [--json]');
  process.exit(1);
}
const clock = () => performance.now();
const stages = ['spans', 'fill', 'water', 'graph', 'chunks', 'assembly', 'total'];
const round = v => Number(v.toFixed(2));

async function measure(fixture, brush, previous) {
  const time = clock(), state = await fixture.build(brush, { clock, previous });
  return { ...state, timings: { ...state.timings, total: clock() - time } };
}
function counters(state) {
  return {
    spanTiles: state.spans.work.rebuilt.length,
    solidSamples: state.spans.work.samples,
    floodTopologyTiles: state.flood.work.topologyTiles.length,
    floodChecks: state.flood.work.checks,
    visitedWetIntervals: state.flood.work.visited,
    relabeledWetTiles: state.flood.work.waterTiles.length,
    traversalNodeTiles: state.graph.work.rebuilt.length,
    traversalLinkTiles: state.graph.work.relinked.length,
    traversalChecks: state.graph.work.checks,
    splatChunks: state.patch.replaced.length
  };
}
function summarize(samples) {
  const times = samples.slice().sort((a, b) => a - b);
  const i = times.length >>> 1;
  return { median: round(times.length % 2 ? times[i] : (times[i - 1] + times[i]) / 2),
    p95: round(times[Math.ceil(times.length * 0.95) - 1]) };
}

async function main() {
  const incremental = [], full = [];
  let context;
  for (let i = -1; i < runs; i++) {
    const local = floodValley(KIT), cold = floodValley(KIT);
    const start = await local.build();
    const localBrush = local.brush(), coldBrush = cold.brush();
    // Alternate order after a warmup pair to limit systematic heap/JIT effects.
    let a, b;
    if (i % 2 === 0) {
      a = await measure(local, localBrush, start);
      b = await measure(cold, coldBrush);
    } else {
      b = await measure(cold, coldBrush);
      a = await measure(local, localBrush, start);
    }
    assert.deepEqual(a.world.data, b.world.data);
    assert.deepEqual(a.world.splatIds, b.world.splatIds);
    assert.deepEqual(a.water.pack(), b.water.pack());
    assert.deepEqual(a.graph.edges, b.graph.edges);
    if (i === -1) {
      context = { tiles: local.indices.length, columns: a.spans.tiles.reduce((n, grid) => n + grid.resolution[0] * grid.resolution[1], 0),
        splats: a.world.count, graphNodes: a.graph.nodes.length, graphEdges: a.graph.edges.length,
        work: { incremental: counters(a), full: counters(b) } };
    } else {
      incremental.push(a.timings);
      full.push(b.timings);
    }
  }
  const timeMs = Object.fromEntries(stages.map(stage => [stage, {
    incremental: summarize(incremental.map(sample => sample[stage])),
    full: summarize(full.map(sample => sample[stage]))
  }]));
  const report = { runs, warmupPairs: 1, environment: {
    node: process.version, os: os.platform() + ' ' + os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model
  }, ...context, timeMs, samplesMs: { incremental, full } };
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(report.environment);
    console.log(runs + ' timed pairs · ' + context.tiles + ' tiles · ' + context.columns + ' columns · ' + context.splats + ' splats');
    console.table(Object.fromEntries(stages.map(stage => [stage, {
      'incremental median ms': timeMs[stage].incremental.median, 'incremental p95 ms': timeMs[stage].incremental.p95,
      'full median ms': timeMs[stage].full.median, 'full p95 ms': timeMs[stage].full.p95
    }])));
    console.table(context.work);
  }
}
main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
