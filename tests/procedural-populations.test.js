const test = require('node:test'),
  assert = require('node:assert/strict'),
  P = require('..').load().KIT.procedural.populations;
const box = r => ({ min: [-r, 0, -r], max: [r, 1, r] });
test('ranked world candidates retain identity, pose and seed through density and domain extension', () => {
  const a = P.layout([box(1)], () => ({ density: 0.25 })),
    b = P.layout([box(2)], () => ({ density: 0.7 })),
    byKey = new Map(b.instances.map(p => [p.key, p]));
  assert(a.instances.length > 5);
  for (const p of a.instances) {
    const q = byKey.get(p.key);
    assert(q);
    assert.deepEqual([q.point, q.seed, q.yaw, q.scale], [p.point, p.seed, p.yaw, p.scale]);
  }
  assert.deepEqual(
    P.layout([box(1)], () => ({ density: 0.25 })),
    a
  );
});
test('work regions deduplicate, samples carry arbitrary consumer data, and caller data remains mutable', () => {
  const data = { density: 1, habitat: { name: 'rock' } };
  const a = P.layout([box(1)], () => data),
    b = P.layout([box(1), box(1)], () => data);
  assert.deepEqual(a, b);
  assert(!Object.isFrozen(data.habitat));
  data.habitat.name = 'changed';
  assert.equal(a.instances[0].sample.habitat.name, 'rock');
  assert(Object.isFrozen(a.instances[0].point));
});
test('masks remove candidates without rerolling survivors and reject bad inputs or unbounded work', () => {
  const a = P.layout([box(1)], () => ({ density: 1 })),
    b = P.layout([box(1)], (x, z) => (x < 0 ? null : { density: 1 }));
  assert.deepEqual(
    b.instances,
    a.instances.filter(p => p.point[0] >= 0)
  );
  for (const raw of [{ spacing: 0 }, { slots: 9 }, { jitter: 2 }, { maxCandidates: 0 }, { seed: NaN }])
    assert.throws(() => P.layout([box(1)], () => null, raw));
  assert.throws(() => P.layout([box(1)], () => ({ density: 2 })));
  assert.throws(() => P.layout([box(1)], () => ({ density: 1 }), { maxInstances: 1 }), /budget/);
  assert.throws(() => P.layout([box(30)], () => null, { maxCandidates: 10 }), /budget/);
});
