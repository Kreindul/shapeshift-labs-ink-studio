const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT } = require('..').load();
const P = KIT.procedural;

test('ordered swept masks taper, retain ownership, and support erasing and repainting', () => {
  const base = {
    id: 'base',
    points: [
      [-2, 0],
      [2, 0]
    ],
    radii: [0.3, 1.1],
    softness: 0
  };
  const erase = { id: 'erase', points: [[0, 0]], width: 0.9, operation: 'erase', order: 1 };
  const restore = { id: 'restore', points: [[0, 0]], width: 0.35, order: 2 };
  const field = P.masks.compose([erase, base]);
  assert(field.distance([0, 0]) > 0);
  assert.equal(field.owner([0, 0]), null);
  assert(field.distance([1.7, 0.6]) < 0);
  assert(field.distance([-1.7, 0.6]) > 0);
  assert.equal(field.sample([1.7, 0.6]).owner, 'base');
  assert.equal(P.masks.compose([erase, restore, base]).owner([0, 0]), 'restore');
  assert.throws(() => P.masks.compose([base, base]), /unique/);
  base.points[0][0] = 2;
  assert(field.distance([-1.8, 0]) < 0);
});

test('concave extrusions cut along an affine profile and line only the retained host', () => {
  const profile = [
    [-1, -1],
    [1, -1],
    [1, 0],
    [0, 0],
    [0, 1],
    [-1, 1]
  ];
  const frame = P.transforms.local({ position: [3, 1, -2], rotation: 0.4, scale: [1.2, 1, 0.8] });
  const cut = P.profileCut({ profile, span: [-2, 2], frame });
  const host = world => Math.abs(cut.project(world)[2]) - 0.6;
  const liner = cut.lining(0.2, host);
  assert(cut.subtract(host)(cut.sample([-0.5, 0.5, 0])) > 0);
  assert(cut.subtract(host)(cut.sample([0.5, 0.5, 0])) < 0);
  assert(liner(cut.sample([0.07, 0.5, 0])) < 0);
  assert(liner(cut.sample([0.07, 0.5, 0.8])) > 0);
  assert(cut.distance(cut.sample([-0.5, 0.5, 2.01])) > 0);
});

test('clearance finds only participating fields and rejects excessive total work', () => {
  const block = P.pieces.beam([0, 0, 0], [2, 0, 0], 0.6, 0.6);
  const fields = P.clearance.field([
    { ...block, id: 'beam' },
    {
      id: 'remote',
      bounds: { min: [8, 8, 8], max: [9, 9, 9] },
      distance: () => assert.fail('A distant solid must not be probed')
    }
  ]);
  const box = { min: [0.8, -0.1, -0.1], max: [1.2, 0.1, 0.1] };
  assert.equal(fields.probe(box).contacts[0].id, 'beam');
  assert(fields.probe(box, { exclude: ['beam'] }).clear);
  assert.throws(() => fields.probe(box, { budget: 1 }), /budget/);
  assert.equal(fields.probe({ min: [1, 0, 0], max: [1, 0, 0] }).tested, 1);
});

test('compiled emitters cycle in a caller supplied direction and stay finite at large times', () => {
  const spec = {
    id: 'flow',
    p: [1, 2, 3],
    color: [1, 0.6, 0.2],
    count: 5,
    height: 2,
    seed: 18,
    speed: 1,
    direction: [0, -1, 0],
    drift: [0, 0, 0],
    spread: 0
  };
  const emitter = P.emitters.compile(spec);
  const samples = emitter.samples(0.31);
  assert.deepEqual(samples, P.emitters.compile(spec).samples(0.31));
  for (let i = 0; i < samples.length; i++) {
    const { p, opacity } = samples[i];
    assert.equal(p[0], 1);
    assert.equal(p[2], 3);
    assert(p[1] >= 0 && p[1] <= 2 && opacity >= 0);
    assert(Math.abs(emitter.sample(i, 0.31 + emitter.period).p[1] - p[1]) < 1e-10);
    assert(emitter.sample(i, Number.MAX_VALUE).p.every(Number.isFinite));
  }
});
