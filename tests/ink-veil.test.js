const test = require('node:test');
const assert = require('node:assert/strict');
const { rank, footprint } = require('../src/ink-veil.js');
const studio = require('..');

test('ink coverage uses a stable ordered tile with sixteen distinct thresholds', () => {
  const cells = Array.from({ length:16 }, (_, i) => rank(i % 4, i >> 2));
  assert.equal(new Set(cells).size, 16);
  assert.equal(rank(-1, 0), rank(3, 0));
  assert.equal(rank(2, -3), rank(6, 1));
  assert.equal(cells.filter(value => value <= .25).length, 4);
  assert.equal(cells.filter(value => value <= .5).length, 8);
  assert.equal(typeof studio.load().InkVeil.glsl, 'string');
});

test('the projected footprint samples texel centers and feathers into black', () => {
  const bounds = [-1, -1, 1, 1];
  const projected = footprint(bounds, 4, (x, z) => .8 - Math.max(Math.abs(x), Math.abs(z)), .4);
  assert.equal(projected.data[0], 32);
  assert.equal(projected.data[5], 255);
  assert.equal(projected.data[15], 32);
  bounds[1] = -10;
  assert.equal(projected.bounds[1], -1);
  assert.throws(() => footprint([1,1,0,0], 32, () => 1), RangeError);
});

test('world-space reveal cues stay selectable, overlap, then settle to full coverage', () => {
  const { reveal } = require('../src/ink-veil.js');
  const track = reveal([
    { at:[-6,1,0], extent:[3,4,5], start:.5, end:1.5 },
    { at:[6,1,0], extent:[3,4,5], start:1.2, end:2.5 }
  ], [2.2,3.15]);
  assert.equal(track.duration, 3.15);
  assert.equal(track.sample(0).centers[3], 0);
  assert.equal(track.sample(0).settled, 0);
  assert.equal(track.sample(1.4).centers[3], 1);
  const next = track.sample(1.5);
  assert(next.centers[7] > 0 && next.centers[7] < 1);
  assert.deepEqual(Array.from(next.extents.slice(0,3)), [3,4,5]);
  assert.equal(track.sample(3.15).settled, 1);
  assert.equal(track.sample(0).settled, 0);
  assert.throws(() => reveal([], [0,1]), RangeError);
});
