const test = require('node:test');
const assert = require('node:assert/strict');
const { traversal } = require('..').load().KIT.procedural;

const up = [0, 1, 0];
const floor = () => [{ y: 0, normal: up, id: 'ground' }];
const clear = () => Infinity;
const near = (a, b) => assert(Math.abs(a - b) < 1e-6);

test('traversal uses actual stair heights and stops at large drops and steep ground', () => {
  const body = traversal.create({
    supports(x) {
      if (x > 2) return [{ y: -1, normal: up }];
      if (x > 1.7) return [{ y: .75, normal: [-1, .25, 0] }];
      return [{ y: Math.max(0, Math.floor(x / .5) * .25), normal: up, id: 'stairs' }];
    },
    clearance: clear
  });
  const climb = body.move([.1, 0, 0], [1.45, 0]);
  assert.equal(climb.support, 'stairs');
  near(climb.foot[1], .75);
  const steep = body.move(climb.foot, [1, 0]);
  assert(steep.blocked);
  assert(steep.foot[0] <= 1.7);
  const cliff = traversal.create({ supports: x => [{ y: x < 1 ? 0 : -1, normal: up }], clearance: clear });
  assert(cliff.move([.8, 0, 0], [.5, 0]).blocked);
  assert.equal(cliff.stand([1.1, 0, 0]), null);
  near(cliff.stand([1.1, 0, 0], { drop: 1.1 }).foot[1], -1);
});

test('traversal sweeps through an aperture, rejects low headroom and slides along walls', () => {
  function gate(height) {
    return traversal.create({ supports: floor, clearance: ([x, y, z]) => {
      const wall = Math.abs(z) - .005;
      const opening = Math.max(Math.abs(x) - .65, y - height);
      return Math.max(wall, -opening);
    } });
  }
  const open = gate(1.9).move([0, 0, -2], [0, 4]);
  assert.equal(open.blocked, false);
  near(open.foot[2], 2);
  const low = gate(1.45).move([0, 0, -2], [0, 4]);
  assert(low.blocked);
  assert(low.foot[2] < -.18);
  const slide = gate(1.9).move([1, 0, -.3], [1, 1]);
  assert(slide.blocked);
  near(slide.foot[0], 2);
  assert(slide.foot[2] < -.18);
});

test('queries try overlapping supports, validate callbacks and bound work', () => {
  const supports = () => [{ y: .3, normal: up, id: 'top' }, ...floor()];
  const body = traversal.create({ supports, clearance: ([, y]) => 1.8 - y, budget: 2 });
  assert.equal(body.stand([0, 0, 0]).support, 'ground');
  assert.throws(() => body.move([0, 0, 0], [1, 0]), /budget/);
  assert.throws(() => traversal.create({ supports: floor, clearance: () => NaN }).stand([0, 0, 0]), /signed distance/);
  assert(traversal.create({ supports: floor, clearance: clear, radius: .04 }).stand([0, 0, 0]));
});
