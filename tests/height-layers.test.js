const test = require('node:test');
const assert = require('node:assert/strict');
const { heightLayers, procedural } = require('..').load().KIT;

function layer(id, operation, height, width, point = [0, 0]) {
  const shape = procedural.masks.stroke({ id, points:[point], width, softness:0 });
  const bounds = {
    min:[shape.bounds.min[0] - 1, 0, shape.bounds.min[2] - 1],
    max:[shape.bounds.max[0] + 1, 0, shape.bounds.max[2] + 1]
  };
  const feather = operation === 'erase' ? 0 : 1;
  return {
    entity:{ id }, parameters:{ operation, height }, bounds,
    weight:(x,z) => Math.max(0, 1 - Math.max(0, shape.distance([x,z]))),
    support:(x,z) => shape.distance([x,z]) - feather
  };
}

test('ordered height layers feather down to the base and permit a later contribution inside an erase', () => {
  const hill = layer('hill', 'add', 4, 10);
  const cut = layer('cut', 'min', -2, 10);
  const erase = layer('erase', 'erase', 0, 2);
  const layers = [hill, cut, erase];
  assert.deepEqual(heightLayers.sample(layers, 0, 0), { delta:0, owner:null, coverage:0 });
  assert.deepEqual(heightLayers.sample(layers, 1.5, 0), { delta:-1, owner:'cut', coverage:0.5 });
  assert.deepEqual(heightLayers.sample(layers, 4, 0), { delta:-2, owner:'cut', coverage:1 });
  assert(heightLayers.distance(layers, 0, 0) > 0);
  assert(heightLayers.distance(layers, 0, 0, 'cut') > 0);
  assert(heightLayers.distance(layers, 1.5, 0, 'cut') < 0);
  assert.equal(heightLayers.distance(layers, 0, 0, 'erase'), Infinity);
  layers.push(layer('paint', 'add', 1, 0.5));
  assert.deepEqual(heightLayers.sample(layers, 0, 0), { delta:1, owner:'paint', coverage:1 });
  assert(heightLayers.distance(layers, 0, 0) < 0);
  assert(heightLayers.distance(layers, 0, 0, 'paint') < 0);
  assert.equal(heightLayers.sample(layers, 5.5, 0).delta, -1);
});
