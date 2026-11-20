const assert = require('node:assert/strict');
const test = require('node:test');
const studio = require('../index.js');
const { KIT: K, RenderStages, makeBuilder, makeSculpt } = studio.load();

const camera = { target: [0, 0, 0], dist: 4, yaw: 0, pitch: 0 };
const options = { w: 64, h: 64, px: 1, ortho: true };
const center = (32 * 64 + 32) * 3;
const paint = { name: 'Blue paint', steps: [{ type: 'channelMix', matrix: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], offset: [0, 0, 1] }] };
const white = { name: 'White', steps: [{ type: 'channelMix', matrix: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], offset: [1, 1, 1] }] };

function disc(renderStages, { opacity = 3, surface, reference = '#cccccc', ink } = {}) {
  const builder = makeBuilder(5, [0x503020, 0x606060, 0xcccccc]);
  if (surface) builder.surfaceNext(surface, 0, 0, 1, [0, 1, 0]);
  builder.disc(0, 0, 0, [0, 0, 1], .7, .025, builder.P[1], opacity);
  builder.describeAlbedo(0, 1, reference);
  builder.describeSplats(0, 1, { object: 'steel', material: 'paint' });
  return builder.finish({ cam: camera, look: { renderStages, ink } });
}

test('base paint retains baked attenuation while lit grading changes the lit value', () => {
  const select = { entity: 'steel', material: 'paint' };
  const material = studio.render(disc([{ stage: 'material', stack: paint, select }]), options);
  const lit = studio.render(disc([{ stage: 'lit', stack: paint, select }]), options);
  assert(material.rgb[center] <= 1);
  assert(lit.rgb[center] <= 1);
  assert(material.rgb[center + 2] > 100 && material.rgb[center + 2] < 140);
  assert(lit.rgb[center + 2] >= 252);
  assert.deepEqual(Array.from(material.rgb.slice(0, 3)), [80, 48, 32]);
  assert(lit.rgb.slice(0, 3).every((value, i) => Math.abs(value - [80, 48, 32][i]) <= 3));
  assert.deepEqual(studio.render(disc([{ stage: 'lit', stack: paint }]), { ...options, raw: true }).rgb,
    studio.render(disc(undefined), { ...options, raw: true }).rgb);
});

test('lit grading precedes alpha composition and resolved-frame grading reaches the background', () => {
  const glass = { opacity: .5 };
  const lit = studio.render(disc([{ stage: 'lit', stack: white }], glass), options);
  const frame = studio.render(disc([{ stage: 'frame', stack: white }], glass), options);
  assert(lit.rgb[center] > 80 && lit.rgb[center] < 255);
  assert(lit.rgb.slice(0, 3).every((value, i) => Math.abs(value - [80, 48, 32][i]) <= 3));
  assert.deepEqual(Array.from(frame.rgb.slice(0, 3)), [255, 255, 255]);
  assert.deepEqual(Array.from(frame.rgb.slice(center, center + 3)), [255, 255, 255]);
});

test('resolved-frame masks share target ownership and final palette remains discrete after ink and grading', () => {
  const mask = { type: 'axis', axis: 'y', range: [-.6, .6], space: 'world', interpolation: 'linear' };
  const select = { object: 'steel' };
  const frameRule = { stage: 'frame', stack: white, select, mask };
  const world = disc([frameRule]);
  const masked = studio.render(world, options);
  const disabled = studio.render(world, { ...options, lookMasks: false });
  assert.equal(disabled.rgb[center], 96);
  const query = K.world.query.fromScene(world);
  const { value } = query.probe('look/output', select, { stage: 'frame', at: [0, 0, 0], rgb: [0, 0, 0] });
  assert.equal(value.targets[0].stages.frame[0].maskWeight, .5);
  assert.deepEqual(value.targets[0].rgb, [.5, .5, .5]);
  assert(masked.rgb[center] > 150 && masked.rgb[center] < 205);
  assert.deepEqual(Array.from(masked.rgb.slice(0, 3)), [80, 48, 32]);

  const palette = { stage: 'palette', palette: { palette: ['#010101', '#eef8ff'] } };
  const rules = [palette, { stage: 'frame', stack: white, select }];
  const ink = { default: { silhouette: { color: '#ef5350' } } };
  const frame = studio.render(disc(rules, { ink }), options);
  assert.deepEqual(frame.palette, [0x010101, 0xeef8ff]);
  assert.deepEqual(Array.from(frame.rgb.slice(center, center + 3)), [238, 248, 255]);
  assert.equal(frame.use[0] + frame.use[1], 64 * 64);
  assert(frame.use.every(n => n > 0));
});

test('staged assets survive revisions, material binding, sculpt capture and diorama validation', () => {
  const A = K.authoring;
  const id = 'stages/paint';
  const pack = { format: 'ink-studio/asset-pack', id: 'stages', title: 'Stages', version: 1, revision: 1,
    looks: [{ id, label: 'Paint', stage: 'lit', stack: paint, palette: { palette: ['#000022', '#aacfff'] } }] };
  const manifest = A.assetPacks.reviseLook(pack, id, { stage: 'material' });
  const catalog = A.assetPacks.create({ packs: [manifest] });
  const look = A.looks.scene({ targets: [{ asset: id, stage: 'frame', select: { object: 'steel' } }] }, catalog);
  assert.deepEqual(look.renderStages.map(rule => rule.stage), ['frame', 'palette']);

  const B = makeBuilder(1, [0x171920, 0x505050, 0xcccccc], { initialCapacity: 8 });
  const S = makeSculpt(B);
  const material = A.looks.material({ r: [1, 2], albedo: 2 }, { asset: id, palette: false }, catalog);
  S.ball([0, 0, 0], .6, material, { res: .11 });
  S.bake();
  const world = B.finish({ cam: camera });
  assert(world.count > 8 && world.materialAlbedo.every(n => n === 0xcccccd));
  assert(RenderStages.plan(world).at(0).material?.length);
  assert(studio.render(world, options).rgb.some((n, i, rgb) => i % 3 === 2 && n > rgb[i - 2]));

  assert.throws(() => RenderStages.prepare([{ stage: 'frame', palette: { palette: ['#112233'] } }]), /color stack/);
  const invalid = { id: 'bad-stage', finish: { look: { renderStages: [{ stage: 'finish', stack: paint }] } },
    solids: [{ kind: 'ball', at: [0, 0, 0], r: 1, mat: 'stone' }] };
  assert.throws(() => K.diorama.build(invalid), /finish\.look\.renderStages/);
});
