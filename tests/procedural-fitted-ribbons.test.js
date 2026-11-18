const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fittedRibbon } = require('..').load().KIT.procedural;

const inner = [[0, 0], [2, 0], [2, 1], [0, 1]];
const outer = [[-0.2, -0.2], [2.2, -0.2], [2.2, 1.2], [-0.2, 1.2]];

test('fitted ribbon follows paired rails across a corner without adding a joint', () => {
  const result = fittedRibbon({ inner: inner.slice(0, 3), outer: outer.slice(0, 3), pitch: 3 });
  assert.equal(result.cells.length, 1);
  const [first, second] = result.cells[0].fragments;
  assert.deepEqual(first.points[1], second.points[0]);
  assert.deepEqual(first.points[2], second.points[3]);
  assert.deepEqual([first.from, first.to, second.from, second.to], [0, 2, 2, 3]);
});

test('closed ribbon fits real gaps and retains a shared identity across the chart seam', () => {
  const result = fittedRibbon({ inner, outer, pitch: 1.5, gap: 0.2, closed: true, phase: 0.5 });
  assert.equal(result.unit, 1.5);
  assert.equal(result.cells.length, 4);
  const [start, end] = result.cells[0].fragments;
  assert.deepEqual(start.points[0], end.points[1]);
  assert.deepEqual(start.points[3], end.points[2]);
  assert.equal(start.from, 0);
  assert.equal(end.to, result.length);
  for (const cell of result.cells) {
    const length = cell.fragments.reduce((sum, { from, to }) => sum + to - from, 0);
    assert(Math.abs(length - 1.3) < 1e-8);
  }
  assert(Object.isFrozen(start.points[0]));
  assert(!Object.isFrozen(inner[0]));
});

test('fitted ribbons use spatial rail length, preserve open ends and enforce a work bound', () => {
  const spec = {
    inner: [[1, 2, 3], [1, 5, 7]],
    outer: [[2, 2, 3], [2, 5, 7]],
    pitch: 2.5,
    gap: 0.5
  };
  const result = fittedRibbon(spec);
  assert.equal(result.length, 5);
  assert.deepEqual(result.cells.map(cell => cell.fragments.map(({ from, to }) => [from, to])), [
    [[0, 2.25]], [[2.75, 5]]
  ]);
  assert.throws(() => fittedRibbon({ ...spec, budget: 1 }), /budget/);
  assert.throws(() => fittedRibbon({ ...spec, gap: 2.5 }), /joint/);
  assert.throws(() => fittedRibbon({ ...spec, outer: [[0, 0], [1, 0]] }), /rails/);
  assert.throws(() => fittedRibbon({ inner, outer, pitch: 10, closed: true, budget: 1 }), /fragment budget/);
});
