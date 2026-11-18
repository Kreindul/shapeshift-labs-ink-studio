const assert = require('node:assert/strict');
const test = require('node:test');
const studio = require('../index.js');
const { makeBuilder, makeSculpt, ArtPasses } = studio.load();

const camera = { target: [0, 0, 0], dist: 5, yaw: 0, pitch: 0 };
const view = { w: 41, h: 41, px: 1, ortho: true };

test('art passes expose a consistent visible surface and composite only visible emission', () => {
  const builder = makeBuilder(1, [0, 0xff4000, 0x5080aa, 0xffffff]);
  builder.disc(0, 0, -1, [0, 0, 1], 0.4, 0.03, builder.P[1], 3, { em: true });
  builder.describeSplats(0, 1, { object: 'torch', material: 'fire' });
  builder.disc(0, 0, 0, [0, 0, 1], 0.18, 0.02, builder.P[2], 3);
  builder.describeSplats(1, 2, { object: 'wall', material: 'stone' });
  builder.disc(0, 0, 1, [0, 0, 1], 0.1, 0.02, builder.P[3], 0.2, { em: true, emission: false, nd: true });
  const world = builder.finish({ cam: camera });

  const original = studio.render(world, view);
  const frame = studio.render(world, { ...view, passes: true });
  const { coverage, depth, normal, objectId, materialId, emission, splatId, objects, materials } = frame.passes;
  const center = 20 * 41 + 20;
  assert.deepEqual(frame.rgb, original.rgb);
  assert(coverage[center] > 0.99);
  assert.equal(depth[center], 37);
  assert.deepEqual(Array.from(normal.subarray(center * 3, center * 3 + 3)), [0, 0, 1]);
  assert.equal(objects[objectId[center]], 'wall');
  assert.equal(materials[materialId[center]], 'stone');
  assert.equal(splatId[center], 2);
  assert(emission[center * 3] < 0.02);
  assert(emission.some(value => value > 0.9));
  assert.equal(depth[0], Infinity);
  assert.equal(coverage[0], 0);
  assert.equal(objectId[0], 0);
  assert.deepEqual(studio.render(world, { ...view, passes: ['coverage'] }).passes, { w: 41, h: 41, coverage });
  assert.throws(() => studio.render(world, { ...view, passes: ['light'] }), /Unknown art pass/);
  const colored = studio.render(world, { ...view, colored: true, passes: true });
  assert.deepEqual(colored.passes, frame.passes);
});

test('sculpt tags and material identities reach the public pass API', () => {
  const builder = makeBuilder(2, [0, 0x405060, 0xdcd0aa]);
  const sculpt = makeSculpt(builder);
  sculpt.ball([0, 0.5, 0], 0.3, { r: [1, 2], materialId: 'granite' }, { tag: 'crown', res: 0.055 });
  sculpt.bake();
  const world = builder.finish({ cam: camera });
  const { passes } = studio.render(world, { ...view, passes: true });
  const hit = 14 * view.w + 20;
  assert.equal(passes.objects[passes.objectId[hit]], 'crown');
  assert.equal(passes.materials[passes.materialId[hit]], 'granite');
  assert(passes.normal[hit * 3 + 2] > 0.7);
  assert(!passes.objectId.slice(23 * view.w).some(Boolean));
  assert.equal(ArtPasses.ownsSurface(.5, true, 1, Infinity), false);
  assert.equal(ArtPasses.ownsSurface(.51, true, 1, Infinity), true);
  assert.equal(ArtPasses.ownsSurface(.99, true, 2, 1), false);
});
