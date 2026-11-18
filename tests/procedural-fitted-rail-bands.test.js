const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fittedRailBand, pieces } = require('..').load().KIT.procedural;

const spec = {
  inner: [[0, 0, 0], [2, 0, 0]],
  outer: [[0, 1, 0], [2, 1, 0]],
  pitch: 1,
  gap: 0.2,
  depth: [-0.1, 0.2],
  direction: () => [0, 0, 1]
};

test('fitted bands leave a real joint and make closed solids with stable cell ownership', () => {
  const band = fittedRailBand(spec);
  const parts = band.pieces({ owner: 'run', key: 'courses', material: 'trim' });
  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map(p => p.cell), band.layout.cells.map(c => c.key));
  assert.deepEqual(parts.map(p => p.key), band.pieces({ key: 'courses' }).map(p => p.key));
  assert(parts.every(p => p.owner === 'run' && p.mesh.groups.every(g => g.material === 'trim')));
  const solid = pieces.union(parts);
  assert(solid.distance([0.4, 0.5, 0]) < 0);
  assert(solid.distance([1, 0.5, 0]) > 0);
  assert.equal(solid.raycast([1, 0.5, 1], [0, 0, -1]), null);
  assert(Math.abs(solid.raycast([0.4, 0.5, 1], [0, 0, -1]).distance - 0.8) < 1e-6);
});

test('warped paired rails produce finite prisms with a shared cell key', () => {
  const band = fittedRailBand({ ...spec, outer: [[0, 1, 0], [2, 1, 0.4]], pitch: 2 });
  const parts = band.pieces();
  assert.equal(parts.length, 2);
  assert.equal(parts[0].cell, parts[1].cell);
  assert.notEqual(parts[0].key, parts[1].key);
  assert(parts.every(p => p.mesh.positions.every(Number.isFinite)));
  assert.throws(() => fittedRailBand({ ...spec, direction: () => [0, 0, 0] }).pieces(), /direction/);
});
