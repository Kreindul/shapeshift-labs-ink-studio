const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT } = require('..').load();
const fit = KIT.stripCourses;
const section = (s, lower, upper) => ({ s, lower, upper });
const close = (a, b) => assert(Math.abs(a - b) < 1e-7);

test('stock clips to both edges of a sloped strip and continues across sections', () => {
  const sections = [section(0, .33, 1.6), section(.62, .64, 1.38), section(2, .33, 1.6)];
  const { pieces } = fit({ sections, unit: [1, .4], joint: .04 });
  assert(pieces.length > 8);
  for (const { segment, polygon } of pieces) {
    const a = sections[segment], b = sections[segment + 1];
    for (const [s, y] of polygon) {
      const t = (s - a.s) / (b.s - a.s);
      assert(t >= -1e-8 && t <= 1 + 1e-8);
      assert(y >= a.lower + t * (b.lower - a.lower) - 1e-8);
      assert(y <= a.upper + t * (b.upper - a.upper) + 1e-8);
    }
  }
  const parts = pieces.filter(p => p.id === '2/0');
  assert.equal(parts.length, 2);
  for (const piece of parts) assert(piece.polygon.some(([s]) => Math.abs(s - .62) < 1e-7));
  for (const piece of pieces.filter(p => p.row === 2))
    for (const [, y] of piece.polygon) assert(y >= .82 - 1e-8 && y <= 1.18 + 1e-8);
});

test('a closed strip fits whole pitches, with one staggered cell across its seam', () => {
  const { unit, pieces } = fit({ sections: [section(0, 0, 2), section(2.8, 0, 2)],
    unit: [1, 1], closed: true, joint: .1 });
  close(unit[0], 2.8 / 3);
  const joined = pieces.filter(p => p.id === '1/2');
  assert.equal(joined.length, 2);
  assert(joined[0].polygon.some(([s]) => s === 0));
  assert(joined[1].polygon.some(([s]) => s === 2.8));
  assert.equal(new Set(pieces.filter(p => p.row === 1).map(p => p.id)).size, 3);
});

test('datum stays fixed across edits to a strip floor, including negative rows', () => {
  const make = lower => fit({ sections: [section(0, lower, 3), section(2, lower, 3)],
    unit: [1, .5], datum: .18 });
  const low = make(-.35), high = make(.35);
  assert(low.pieces.some(p => p.row === -1 && p.column === 0));
  assert.deepEqual(low.pieces.filter(p => p.row >= 1), high.pieces.filter(p => p.row >= 1));
  assert.throws(() => fit({ sections: [section(0, -1e9, 3), section(2, 0, 3)],
    unit: [1, .5], budget: 20 }), RangeError);
  assert.throws(() => fit({ sections: [section(0, 0, 2), section(1, 0, 2), section(1, 0, 1)],
    unit: [1, 1] }), /ordered sections/);
});

test('stock offset retains grid joints and logical identities on a cut fragment', () => {
  const options = { unit: [1, .5], joint: .06, columnPeriod: 3 };
  const original = fit({ ...options, sections: [section(0, 0, 2), section(7, 0, 2)] });
  const shifted = fit({ ...options, offset: 3.36, sections: [section(0, 0, 2), section(3.64, 0, 2)] });
  const compare = entry => [entry.id, entry.stockColumn, ...entry.polygon.map(([x]) => x.toFixed(7))];
  const comparable = shifted.pieces.filter(p => p.polygon.every(([x]) => x > 0))
    .map(p => compare({ ...p, polygon: p.polygon.map(([x, y]) => [x + 3.36, y]) }));
  assert.deepEqual(comparable, original.pieces.filter(p => p.polygon.every(([x]) => x > 3.36))
    .map(compare));
  assert.equal(fit({ sections: [section(0, 1, 1), section(2, 1, 1)], unit: [1, .5] }).pieces.length, 0);
});
