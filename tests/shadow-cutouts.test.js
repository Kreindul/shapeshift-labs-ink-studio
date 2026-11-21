const test = require('node:test');
const assert = require('node:assert/strict');
const { KIT: K, SpriteSurface, makeBuilder } = require('..').load();
const { render } = require('../cli/render');
const webgl = require('../cli/look-webgl');

test('two-sided cutout rays use the visible texel, threshold, UV slip, and updated alpha', () => {
  const builder = SpriteSurface.make(8);
  const region = builder.reserve(2, 2, x => x === 0 ? 0x556688 : null);
  builder.faceRegion([-1, -1, 0], [2, 0, .8], [0, 2, 0], region, { id: 'cloth', castsShadow: true });
  const atlas = builder.finish();
  const world = { spriteSurfaces: atlas };
  const trace = (x, origin = -1, direction = 1, length = 3) =>
    K.shadowCutouts.occludes(K.shadowCutouts.prepare(world), [x, .5, origin], [0, 0, direction], length);
  assert.equal(trace(-.5), true);
  assert.equal(trace(.5), false);
  assert.equal(trace(-.5, 1, -1), true);
  assert.equal(trace(-.5, -1, 1, 1), false);
  assert.equal(trace(-1.5), false);
  SpriteSurface.uvSlip(atlas, [{ face: 'cloth', flipU: true }]);
  assert.equal(trace(-.5), false);
  assert.equal(trace(.5), true);
  SpriteSurface.update(atlas, region, { w: 2, h: 2, rgba: Uint8Array.from(
    [0,0,0,127, 0,0,0,128, 0,0,0,127, 0,0,0,128]
  ) });
  assert.equal(trace(-.5), true);
  assert.equal(trace(.5), false);
  for (let i = 0; i < atlas.vertices.length; i += 5) atlas.vertices[i] += 1;
  SpriteSurface.markGeometryDirty(atlas);
  assert.equal(trace(-.5), false);
  assert.equal(trace(.5), true);
  assert.deepEqual(K.shadowCutouts.prepare(world, { enabled: false }), []);
});

test('painted scenery admits holes and casts each depth band at its world offset', () => {
  const atlas = K.sprite.atlas({
    metadata: { width: 3, height: 1, unitsPerPixel: 1, scenery: {
      bands: { near: -.4, base: 0 }, base: 'base',
      depthPaint: [{ band: 'near', shape: { type: 'rect', rect: [0, 0, 1, 1] } }]
    } },
    images: { color: Uint8Array.from([255,0,0,255, 0,0,0,0, 255,0,0,255]) }
  });
  const placed = K.sprite.placeAtlas({ atlas, at: t => [t, 0, 0], castsShadow: true });
  const world = { spriteAtlases: [placed] };
  const trace = (x, reach, time = 0) => K.shadowCutouts.occludes(
    K.shadowCutouts.prepare(world, { time }), [x, 0, 1], [0, 0, -1], reach);
  assert.equal(trace(-1, .8), true);
  assert.equal(trace(1, .8), false);
  assert.equal(trace(1, 1.1), true);
  assert.equal(trace(0, 1.1), false);
  assert.equal(trace(0, .8, 1), true);
  assert.throws(() => K.sprite.placeAtlas({ atlas, at: [0,0,0], mode: 'card', castsShadow: true }), /oriented scenery/);
});

function scene({ KIT: K, SpriteSurface, makeBuilder }, { wall = true, spot = false } = {}) {
  const atlas = SpriteSurface.make(32, 32);
  const region = atlas.reserve(5, 5, (x, y) => x === 2 && y >= 1 && y <= 3 ? null : 0x413141);
  atlas.faceRegion([-.65, .55, 0], [1.3, 0, 0], [0, 1.45, 0], region, { castsShadow: true });
  if (wall) atlas.face([-3, 0, -1.5], [6, 0, 0], [0, 3.3, 0], 1, 1, () => 0x6a6066);
  const surface = atlas.finish();
  const at = [-1.5, 1.82, 1.8], aim = [1.22, -.24, -2.55];
  const world = makeBuilder(11, [0x111725]).finish({
    spriteSurfaces: surface,
    cam: { target: [.1, 1.55, -.25], dist: 8, yaw: -.18, pitch: .1, sway: 0, fov: .52, projection: 'orthographic' },
    radius: 7, dither: 0, atmosphere: [K.atmosphere.box({ min: [-2, .2, -1.45], max: [2.8, 2.9, 1.2],
      density: .20, step: .19, color: '#a8a7a4', lit: true })],
    volumeLighting: { ambient: .12, ...(spot && { spots: [{ at, direction: aim, innerAngle: 24, outerAngle: 41,
      radius: 8, color: '#ffc986', intensity: 7, surfaceIntensity: 13 }] }) },
    areaLights: spot ? [] : [K.lightEmitters.disc({ id: 'window', at, normal: aim, visible: false, sampleGrid: 1,
      size: [.08, .08], radius: 8, intensity: 13, volumeIntensity: 7, color: '#ffc986' })]
  });
  return { world, surface, region };
}

function changed(a, b) {
  let count = 0;
  for (let i = 0; i < a.length; i += 3)
    if (Math.max(...[0, 1, 2].map(k => Math.abs(a[i + k] - b[i + k]))) > 5) count++;
  return count;
}

test('area and spot cutouts shadow surfaces and local fog independently', () => {
  const kit = require('..').load(), view = { w: 104, h: 68, px: 1, raw: true };
  for (const spot of [false, true]) {
    const { world } = scene(kit, { spot });
    const options = { ...view, atmosphere: false };
    assert(changed(render(world, options).rgb, render(world, { ...options, cutoutShadows: false }).rgb) > 80);
    const fog = scene(kit, { wall: false, spot }).world;
    const withShadow = render(fog, view), unshadowed = render(fog, { ...view, cutoutShadows: false });
    assert(changed(withShadow.rgb, unshadowed.rgb) > 80);
    assert.deepEqual(render(fog, { ...view, volumeLocalShadows: false }).rgb, unshadowed.rgb);
  }
});

test('WebGL cutouts invalidate surface and fog lighting when the paint changes', {
  skip: !process.env.INK_TEST_CHROME
}, () => {
  const result = webgl({}, scene, (kit, build, backend) => {
    const { world, surface, region } = build(kit), mist = build(kit, { wall: false }).world;
    const gpu = backend(104, 68, { raw: true, offscreen: true, emitterFogResolution: 28, emitterSurfaceResolution: 48 });
    try {
      const draw = (options, subject = world) => { gpu.draw(subject, options); return atob(gpu.image()); };
      const compare = (a, b) => {
        let count = 0;
        for (let i = 0; i < a.length; i += 3) if (Math.abs(a.charCodeAt(i) - b.charCodeAt(i)) > 8) count++;
        return count;
      };
      const before = draw({}), disabled = draw({ cutoutShadows: false });
      const surfaceOnly = draw({ atmosphere: false }), flat = draw({ atmosphere: false, cutoutShadows: false });
      const fog = compare(draw({}, mist), draw({ volumeLocalShadows: false }, mist));
      const pixels = Uint8Array.from({ length: 5 * 5 * 4 }, (_, i) => [65,49,65,255][i % 4]);
      SpriteSurface.update(surface, region, { w: 5, h: 5, rgba: pixels });
      const filled = draw({});
      const filledBase = draw({ cutoutShadows: false });
      let updatedShadow = 0;
      for (let i = 0; i < filled.length; i += 3)
        if (filledBase.slice(i,i+3) === disabled.slice(i,i+3) &&
          Math.abs(filled.charCodeAt(i) - before.charCodeAt(i)) > 8) updatedShadow++;
      return { wall: compare(surfaceOnly, flat), fog, updatedShadow };
    } finally { gpu.close(); }
  });
  assert(result.wall > 40 && result.fog > 40 && result.updatedShadow > 10, JSON.stringify(result));
});
