const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const cli = path.resolve(__dirname, '../cli/ink-studio.js');
const look = (...args) => spawnSync(process.execPath, [cli, 'look', ...args], { encoding: 'utf8', timeout: 130000 });

test('look profile measures a baseline, global grade and scoped palette on the same workload', () => {
  const run = look('profile', '--frames', '3', '--warmup', '1', '--splats', '25', '--w', '60', '--h', '48');
  assert.equal(run.status, 0, run.stderr);
  const profile = JSON.parse(run.stdout);
  assert.equal(profile.format, 'ink-studio/look-profile');
  assert.deepEqual([profile.frames, profile.warmup, profile.splats, profile.width, profile.height], [3, 1, 25, 60, 48]);
  const { cases, batch, samples } = profile.results.headless;
  assert.deepEqual([batch, samples], [1, 3]);
  assert.deepEqual(cases.map(entry => entry.id), ['baseline', 'global-lut', 'scoped-palette']);
  for (const { splats, setupMs, frameMs } of cases) {
    assert.equal(splats, 25);
    assert.deepEqual(Object.keys(setupMs), ['fixture', 'renderer', 'firstFrame', 'lookPlan']);
    assert(Object.values(setupMs).every(ms => Number.isFinite(ms) && ms >= 0));
    assert(frameMs.min <= frameMs.p50 && frameMs.p50 <= frameMs.p95 && frameMs.p95 <= frameMs.max);
    assert(frameMs.min <= frameMs.mean && frameMs.mean <= frameMs.max);
  }
  assert.deepEqual(cases[0].deltaMs, { lookPlan: 0, p50Frame: 0, meanFrame: 0 });
  const invalid = look('profile', '--frames', '0');
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /--frames expects an integer/);
});

test('look parity compares actual WebGL output with the headless fixtures', { skip: !process.env.INK_TEST_CHROME }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-look-parity-test-'));
  try {
    const output = path.join(temp, 'parity.json');
    const run = look('parity', '--strict', '--out', output);
    assert.equal(run.error, undefined);
    assert.equal(run.stderr, '');
    const parity = JSON.parse(fs.readFileSync(output, 'utf8'));
    assert.equal(parity.format, 'ink-studio/look-parity');
    assert.match(parity.driver, /SwiftShader/i);
    assert.deepEqual(parity.summary, { passed: 6, knownGaps: 2, failed: 0 });
    assert.equal(parity.ok, false);
    assert.equal(run.status, 1);
    const cases = Object.fromEntries(parity.cases.map(entry => [entry.id, entry]));
    assert.deepEqual(cases.tetrahedral.samples.left.webgl, [96, 64, 128]);
    assert.deepEqual(cases.trilinear.samples.left.webgl, [48, 64, 128]);
    for (const id of ['linear-legal-range', 'scoped-palette', 'glass-control'])
      assert.equal(cases[id].status, 'passed');
    for (const id of ['spatial-mask', 'coverage-compositing']) {
      assert.equal(cases[id].status, 'known-gap');
      assert(cases[id].limitation.headlessChange > 0);
      assert.equal(cases[id].limitation.webglChange, 0);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
