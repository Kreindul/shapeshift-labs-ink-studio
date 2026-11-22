const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const ink = require('..'), kit = ink.load(), K = kit.KIT, C = K.curveSplats;
const PNG = require('../cli/png.js');
const palette = [0x14212e, 0xf3b56b, 0x76d6ae];
const camera = { target: [0, 0, 0], yaw: 0, pitch: 0, dist: 6 };
const imageOptions = { w: 128, h: 76, px: 1, raw: true };
const host = builder => builder.finish({ cam: camera, radius: 5, fog: { c: 0, start: 1, max: 0 }, dither: 0 });
const at = (frame, x, y) => [...frame.rgb.subarray((y * frame.w + x) * 3, (y * frame.w + x) * 3 + 3)];
const source = (points, style = {}) => ({ source: { kind: 'path', points }, radius: .05, ...style });
const scene = strands => ({ format: C.format, version: 1, id: 'strand-check', camera, strands });

test('finite segment coverage is stable when a path is subdivided, in perspective and orthographic views', () => {
  const whole = [[-2, 0, -.45], [2, 0, .45]];
  const pieces = Array.from({ length: 41 }, (_, i) => K.V.lerp(whole[0], whole[1], i / 40));
  const a = C.world(scene([source(whole)])), b = C.world(scene([source(pieces)]));
  for (const ortho of [false, true]) {
    const opts = { ...imageOptions, transparent: true, ortho };
    const reference = ink.render(a, opts), divided = ink.render(b, opts);
    assert.ok(reference.alpha.some(alpha => alpha > 160));
    assert.equal(reference.alpha.length, divided.alpha.length);
    assert.ok(reference.alpha.every((alpha, i) => Math.abs(alpha - divided.alpha[i]) <= 1));
    assert.notDeepEqual(ink.render(a, { ...opts, curveSplats: false }).alpha, reference.alpha);
  }
});

test('an editable strand that crosses a solid in depth emerges at the correct end', () => {
  const B = kit.makeBuilder(1, palette);
  const points = [[-2, 0, -1.4], [2, 0, 1.4]];
  const strand = C.draw(B, points, { radius: .13, color: '#f3b56b', object: 'wire' });
  assert.equal(strand.segments, 1);
  B.disc(0, 0, 0, [0, 0, 1], .92, .05, B.P[2], 2.7);
  const world = host(B);
  const frame = ink.render(world, imageOptions);
  const left = at(frame, 54, 38), right = at(frame, 74, 38);
  assert.ok(left[0] < left[1], String(left));
  assert.ok(right[0] > right[1], String(right));

  const entry = scene([source(points, { radius: .13 })]);
  const before = ink.render(C.world(entry), imageOptions);
  points[1][1] = 1.2;
  assert.notDeepEqual(ink.render(C.world(entry), imageOptions).rgb, before.rgb);
  assert.equal(entry.strands[0].source.points[1][1], 1.2);
});

test('spline, textile, routed and recorded trail inputs retain their separate paths and labels', () => {
  const B = kit.makeBuilder(1, palette);
  const spline = C.draw(B, { kind: 'spline', points: [[-1,0,0], [0,1,0], [1,0,0]], samples: 8 });
  assert.equal(spline.end - spline.first, 16);
  const compiled = K.curve.create({ type: 'flower', segments: 64 });
  assert.equal(C.draw(B, compiled).segments, 64);

  const textile = K.textile.weave({ size: [2, 1.4], columns: 4, rows: 3, radius: .06, clearance: .02 });
  let sampled = 0;
  const yarn = K.textile.draw(B, textile, { renderer: 'curve-splats', curveProfile: { section: 'flattened', width: .18, twist: .3 }, color: ({ uv }) => {
    assert.equal(uv.length, 2);
    sampled++;
    return '#76d6ae';
  } });
  assert.equal(yarn.threads.length, textile.threads.length);
  assert.equal(sampled, yarn.segments);
  assert.ok(yarn.threads.every((strand, i) => strand.id === textile.threads[i].id));

  const fixture = structuredClone(require('../examples/world-routed-workshop.json'));
  fixture.visual.routedLinkRenderer = 'curve-splats';
  fixture.visual.routedLinkProfiles = { hose: { width: .28 } };
  const run = K.world.runtime.create(fixture);
  const link = run.query().probe('routes/links', undefined, { link: 'hose' }).value;
  const routed = C.draw(B, { kind: 'routed', link });
  assert.equal(routed.threads.length, link.paths.length);
  assert.ok(routed.segments > 0);
  const visual = K.world.visual(kit, run.view(), run.query());
  assert.equal(visual.curveSplats, true);
  const meta = visual.renderMetadata, hose = meta.objects.indexOf('hose');
  assert.ok(hose > 0);
  assert.ok(meta.objectIds.some((id, i) => id === hose && Math.abs(visual.data[i * 16 + 12] - .14) < 1e-6));

  const trail = { kind: 'trail', samples: [{ point: [0, 0, 0] }, { point: [.4, .2, 0] },
    null, [1, 1, 0], [1.5, 1.2, 0]] };
  assert.equal(C.draw(B, trail, { object: 'spark' }).segments, 2);
  const count = B.count();
  assert.throws(() => C.draw(B, trail, { maxSegments: 1 }), /segment budget/);
  assert.equal(B.count(), count);
  const world = host(B);
  assert.ok(world.renderMetadata.objects.includes('hose'));
  assert.ok(world.renderMetadata.objects.includes('spark'));
});

test('the normal render CLI opens an editable JSON curve scene and can switch to Gaussian carriers', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-curve-splats-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const file = name => path.join(folder, name);
  const entry = scene([{ source: { kind: 'spline', points: [[-2,0,0],[-.8,.7,.2],[.8,-.5,-.3],[2,0,0]], samples: 5 },
    section: 'flattened', edge: 'beta', caps: { start: 'blunt', end: 'fading' }, width: { samples: [.06, .21, .10] }, twist: [[0, 0], [1, Math.PI]], color: '#f3b56b', object: 'wire' }]);
  fs.writeFileSync(file('strand.json'), JSON.stringify(entry));
  const cli = path.resolve(__dirname, '../cli/ink-studio.js');
  for (const mode of ['on', 'off']) {
    const result = spawnSync(process.execPath, [cli, 'render', 'strand.json', '--curve-splats', mode,
      '--raw', '--w', '128', '--h', '76', '--px', '1', '--out', mode + '.png'], { cwd: folder, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  const curve = PNG.read(file('on.png')), fallback = PNG.read(file('off.png'));
  assert.equal(curve.w, 128);
  assert.notDeepEqual(curve.rgb, fallback.rgb);
});

const band = (frame, x) => {
  let result = 0;
  for (let y = 0; y < frame.h; y++) result += frame.alpha[y * frame.w + x] / 255;
  return result;
};
const straight = [[-2, 0, 0], [2, 0, 0]];
const profileFrame = style => ink.render(C.world(scene([{ source: straight, ...style }])),
  { ...imageOptions, ortho: true, transparent: true });

test('width and taper use arc length, including for a path with irregular control spacing', () => {
  const fixed = profileFrame({ width: .22 });
  assert.deepEqual(fixed.alpha, profileFrame({ radius: .11 }).alpha);
  assert.ok(Math.abs(band(fixed, 48) - band(fixed, 80)) < .02);
  const pressure = { samples: [.10, .43, .10] };
  const painted = profileFrame({ width: pressure, taper: [[0, 1], [.64, 1], [1, 0]] });
  assert.ok(band(painted, 64) > 2 * band(painted, 35));
  assert.ok(band(painted, 92) < .25 * band(painted, 64));
  const irregular = ink.render(C.world(scene([{ source: [[-2, 0, 0], [-1.85, 0, 0], [.92, 0, 0], [2, 0, 0]],
    width: pressure, taper: [[0, 1], [.64, 1], [1, 0]] }])),
  { ...imageOptions, ortho: true, transparent: true });
  assert.ok(Math.abs(band(irregular, 64) - band(painted, 64)) < .08);
  assert.deepEqual(pressure.samples, [.10, .43, .10]);
});

test('twist physically turns an elliptical section about the strand tangent', () => {
  const broad = profileFrame({ width: .44, aspect: .26, twist: 0 });
  const edge = profileFrame({ width: .44, aspect: .26, twist: Math.PI / 2 });
  const visibleWidth = (frame, x) => {
    let pixels = 0;
    for (let y = 0; y < frame.h; y++) if (frame.alpha[y * frame.w + x] >= 30) pixels++;
    return pixels;
  };
  assert.ok(visibleWidth(broad, 64) >= visibleWidth(edge, 64) * 2);
  const roll = profileFrame({ width: .44, aspect: .26, twist: [[0, 0], [1, Math.PI]] });
  assert.ok(visibleWidth(roll, 64) < visibleWidth(roll, 43) * .65);
  assert.ok(visibleWidth(roll, 64) < visibleWidth(roll, 86) * .65);
  const circular = profileFrame({ width: .44, aspect: 1 });
  assert.deepEqual(profileFrame({ width: .44, aspect: 1, twist: [[0, 0], [1, 5]] }).alpha, circular.alpha);
});

test('profile painters are sampled in path order and a bad profile leaves the builder intact', () => {
  const B = kit.makeBuilder(1, palette), positions = [];
  const range = C.draw(B, straight, { width: at => {
    positions.push(at.u);
    assert.equal(at.point.length, 3);
    return .05 + at.u * .18;
  }, twist: at => at.u * Math.PI, profileSamples: 24 });
  assert.equal(range.segments, 24);
  assert.ok(positions.every((v, i) => i === 0 || v > positions[i - 1]));
  const count = B.count();
  assert.throws(() => C.draw(B, straight, { taper: [[0, 1], [0, .3]] }), /increasing positions/);
  assert.throws(() => C.draw(B, straight, { width: ({ u }) => u > .6 ? NaN : .25 }), /invalid width/);
  assert.throws(() => C.draw(B, straight, { taper: 0, twist: [[0, 0], [1, Math.PI]], maxSegments: 3 }), /segment budget/);
  assert.equal(B.count(), count);
});

test('named round and elliptical sections preserve the existing profiles while flattened sections have a plateau', () => {
  const width = .9, aspect = .25;
  const round = profileFrame({ width, section: 'round' });
  assert.deepEqual(round.alpha, profileFrame({ width }).alpha);
  const ellipse = profileFrame({ width, aspect, section: 'elliptical' });
  assert.deepEqual(ellipse.alpha, profileFrame({ width, aspect }).alpha);
  const flat = profileFrame({ width, aspect, section: 'flattened' });
  const center = frame => frame.alpha[38 * frame.w + 64];
  const atOffset = (frame, offset) => frame.alpha[(38 + offset) * frame.w + 64] / center(frame);
  assert.ok(atOffset(flat, 5) > .90);
  assert.ok(atOffset(flat, 5) > atOffset(ellipse, 5) + .07);
  assert.ok(atOffset(flat, 12) < .08 && atOffset(ellipse, 12) > .25);
});

test('flattened sections follow the authored path frame and continue across subdivided spans', () => {
  const folded = K.curve.path(straight, { up: [0, 0, 1] });
  const settings = { width: .4, aspect: .24, section: 'flattened' };
  const raster = (source, settings, ortho) => ink.render(C.world(scene([{ source, ...settings }])),
    { ...imageOptions, ortho, transparent: true });
  const broad = raster(straight, settings, true), edge = raster(folded, settings, true);
  assert.notDeepEqual(broad.alpha, edge.alpha);
  assert.deepEqual(broad.alpha, raster(folded, { ...settings, up: [0, 1, 0] }, true).alpha);
  assert.ok(band(broad, 64) > band(edge, 64));

  const pieces = Array.from({ length: 24 }, (_, i) => K.V.lerp(straight[0], straight[1], i / 23));
  for (const ortho of [false, true]) {
    const a = raster(straight, settings, ortho), b = raster(pieces, settings, ortho);
    assert.ok(a.alpha.every((value, i) => Math.abs(value - b.alpha[i]) <= 1));
  }
  const B = kit.makeBuilder(1, palette);
  assert.throws(() => C.draw(B, straight, { section: 'square' }), /round, elliptical or flattened/);
  assert.throws(() => C.draw(B, straight, { section: 'round', aspect: .5 }), /round sections use aspect 1/);
  assert.equal(B.count(), 0);
});

test('Gaussian is the default, compact Beta ends at its support, and hard coverage has a binary edge', () => {
  const options = { width: .44, opacity: .94 };
  const gaussian = profileFrame(options), beta = profileFrame({ ...options, edge: 'beta' });
  assert.deepEqual(gaussian.alpha, profileFrame({ ...options, edge: 'gaussian' }).alpha);
  const at = (frame, y) => frame.alpha[y * frame.w + 64];
  assert.ok(Math.abs(at(beta, 38) - at(gaussian, 38)) <= 2);
  assert.ok(at(gaussian, 50) > 0);
  assert.equal(at(beta, 50), 0);
  assert.ok(beta.alpha.some(value => value > 0 && value < 128));

  const hard = profileFrame({ width: .44, edge: 'hard' });
  assert.equal(at(hard, 38), 255);
  assert.ok(hard.alpha.every(value => value === 0 || value === 255));
  const B = kit.makeBuilder(1, palette);
  assert.throws(() => C.draw(B, straight, { edge: 'sharp' }), /gaussian, beta or hard/);
  assert.equal(B.count(), 0);
});

test('compact and half-opacity hard sections keep their coverage through subdivisions', () => {
  const pieces = Array.from({ length: 32 }, (_, i) => K.V.lerp(straight[0], straight[1], i / 31));
  const raster = (source, settings, ortho) => ink.render(C.world(scene([{ source, ...settings }])),
    { ...imageOptions, ortho, transparent: true });
  for (const section of ['round', 'elliptical', 'flattened']) for (const edge of ['beta', 'hard']) {
    const style = { section, edge, width: .4, opacity: .5, twist: .31 };
    for (const ortho of [false, true]) {
      const a = raster(straight, style, ortho), b = raster(pieces, style, ortho);
      assert.ok(a.alpha.some(value => value > 12));
      assert.ok(a.alpha.every((value, i) => Math.abs(value - b.alpha[i]) <= 1), section + '/' + edge);
      if (edge === 'hard') assert.ok(b.alpha.every(v => v === 0 || v === 128));
    }
  }
  const view = { ...imageOptions, yaw: Math.PI / 2, transparent: true, ortho: true };
  const endOn = source => ink.render(C.world(scene([{ source, width: .3, edge: 'beta', opacity: .45 }])), view);
  const a = endOn(straight), b = endOn(pieces);
  assert.ok(a.alpha.some(value => value > 128));
  assert.ok(a.alpha.every((value, i) => Math.abs(value - b.alpha[i]) <= 1));
});

test('hard strand groups stay distinct when native worlds with the same local IDs are joined', () => {
  const make = z => {
    const B = kit.makeBuilder(1, palette);
    C.draw(B, straight.map(([x, y]) => [x, y, z]), { edge: 'hard', width: .4, opacity: .5, object: 'cord' });
    return host(B);
  };
  const front = make(.3), back = make(-.3);
  const world = K.procedural.splatProvenance.join([front, back], front);
  const opts = { ...imageOptions, ortho: true, transparent: true };
  const single = ink.render(front, opts), combined = ink.render(world, opts);
  assert.equal(single.alpha[38 * single.w + 64], 128);
  assert.equal(combined.alpha[38 * combined.w + 64], 191);
});

test('rounded, blunt, tapered and fading caps control each end independently', () => {
  const base = profileFrame({ width: .4 }), rounded = profileFrame({ width: .4, caps: 'rounded' });
  const blunt = profileFrame({ width: .4, caps: { start: 'blunt', end: 'rounded' } });
  assert.deepEqual(base.alpha, rounded.alpha);
  const at = (frame, x, y = 38) => frame.alpha[y * frame.w + x];
  assert.ok(at(rounded, 21) > 15);
  assert.equal(at(blunt, 21), 0);
  assert.equal(at(blunt, 106), at(rounded, 106));
  assert.equal(at(blunt, 64), at(rounded, 64));
  const start = type => profileFrame({ width: .4, caps: { start: { type, length: .38 } } });
  const tapered = start('tapered'), fading = start('fading');
  assert.ok(band(tapered, 35) < band(base, 35) / 2);
  assert.ok(at(tapered, 35) > at(fading, 35) + 70);
  assert.equal(at(fading, 64), at(base, 64));
  assert.equal(at(tapered, 106), at(base, 106));

  const B = kit.makeBuilder(1, palette);
  assert.throws(() => C.draw(B, straight, { caps: { end: 'square' } }), /invalid cap/);
  assert.throws(() => C.draw(B, straight, { joins: [{ type: 'pool', at: 1.1 }] }), /invalid join/);
  assert.equal(B.count(), 0);
});

test('blunt caps survive straight subdivision and native assembly in both projections', () => {
  const pieces = Array.from({ length: 39 }, (_, i) => K.V.lerp(straight[0], straight[1], i / 38));
  for (const edge of ['gaussian', 'beta', 'hard']) {
    const make = points => C.world(scene([source(points, { caps: 'blunt', width: .31, edge, opacity: .57 })]));
    for (const ortho of [false, true]) {
      const options = { ...imageOptions, ortho, yaw: .67, transparent: true };
      const world = make(pieces), a = ink.render(make(straight), options), b = ink.render(world, options);
      assert.ok(a.alpha.every((value, i) => Math.abs(value - b.alpha[i]) <= 1), edge + '/' + ortho);
      const native = K.procedural.splatProvenance;
      const subset = native.subset(world, Array.from({ length: world.count }, (_, i) => world.count - 1 - i));
      assert.deepEqual(ink.render(native.join([subset], world), options).alpha, b.alpha);
    }
  }
});

test('small breaks stay open even with soft edges and pools change only a local part of the strand', () => {
  for (const edge of ['gaussian', 'beta', 'hard']) {
    const gap = profileFrame({ width: .4, edge, joins: [{ at: .5, type: 'break', length: .04 }] });
    assert.equal(gap.alpha[38 * gap.w + 64], 0);
    assert.ok(gap.alpha[38 * gap.w + 58] > 80);
    assert.ok(gap.alpha[38 * gap.w + 69] > 80);
  }
  const base = profileFrame({ width: .4, opacity: .35 });
  const pool = profileFrame({ width: .4, opacity: .35,
    joins: [{ at: .5, type: 'pool', length: .18, strength: 2, spread: .4, color: '#63d5be' }] });
  assert.ok(band(pool, 64) > band(base, 64) * 1.7);
  assert.ok(Math.abs(band(pool, 35) - band(base, 35)) < .03);
  const tint = at(pool, 64, 38);
  assert.ok(tint[1] > tint[0]);

  const loop = { kind: 'path', closed: true, points: [[0,1,0],[2,1,0],[2,-1,0],[-2,-1,0],[-2,1,0]] };
  const renderLoop = joins => ink.render(C.world(scene([{ source: loop, width: .25, joins }])),
    { ...imageOptions, ortho: true, transparent: true });
  const closed = renderLoop([]), opened = renderLoop([{ type: 'break', at: 0, length: .06 }]);
  assert.ok(closed.alpha[19 * closed.w + 64] > 180);
  assert.equal(opened.alpha[19 * opened.w + 64], 0);
});

test('distance material keys resolve scene roles, tint pigment, and control coverage independently', () => {
  const input = {
    ...scene([{ source: [[-2, 0, 0], [-1.75, 0, 0], [2, 0, 0]], width: .38, edge: 'hard',
      along: { paletteRole: [[0, 'wire.shadow'], [.5, 'wire.highlight']],
        pigment: '#ff80ff', opacity: { keys: [[0, 1], [.5, .5]], interpolation: 'step' } } }]),
    palette: ['#b75a38', '#b75a38', '#80cc80'], paletteRoles: { wire: [1, 3] }
  };
  const world = C.world(input), frame = ink.render(world, { ...imageOptions, ortho: true, transparent: true });
  assert.equal(world.count, 3);
  assert.equal(world.pal.length, 4);
  assert.deepEqual(at(frame, 42, 38), [183, 45, 56]);
  assert.deepEqual(at(frame, 86, 38), [128, 102, 128]);
  assert.equal(frame.alpha[38 * frame.w + 42], 255);
  assert.equal(frame.alpha[38 * frame.w + 86], 128);
  assert.equal(world.curveSplatSource, input);

  const B = kit.makeBuilder(1, palette);
  assert.throws(() => C.draw(B, straight, { along: { paletteRole: 'undefined' } }), /Unknown or empty palette role/);
  assert.throws(() => C.draw(B, straight, { along: { roughness: ({ u }) => u < .5 ? .3 : 1.5 } }), /roughness/);
  assert.equal(B.count(), 0);
  C.draw(B, straight, { width: .4, edge: 'hard', along: { pigment: { samples: ['#ff0000', '#0000ff'] } } });
  const blend = ink.render(host(B), { ...imageOptions, ortho: true });
  const [red, green, blue] = at(blend, 64, 38);
  assert.ok(Math.abs(red - blue) < 12 && green === 0);
});

test('strand roughness moves a highlight without changing coverage and emission has its own pass', () => {
  const recipe = {
    ...scene([{ source: straight, edge: 'hard', width: .62, color: '#58261e',
      along: {
        roughness: { keys: [[0, .08], [.5, .82]], interpolation: 'step' },
        emission: { keys: [[0, 0], [.62, .6]], interpolation: 'step' }, emissionColor: '#2080ff'
      } }]),
    liveSun: { direction: [0, .55, 1], intensity: .8, shadows: false }
  };
  const world = C.world(recipe);
  const opts = { ...imageOptions, ortho: true, transparent: true, passes: ['emission'] };
  const lit = ink.render(world, opts), unlit = ink.render(world, { ...opts, liveSun: { intensity: 0 } });
  assert.deepEqual(lit.alpha, unlit.alpha);
  assert.deepEqual(lit.passes.emission, unlit.passes.emission);
  const peak = x => Math.max(...Array.from({ length: lit.h }, (_, y) => at(lit, x, y)[0] - at(unlit, x, y)[0]));
  assert.ok(peak(43) > peak(88) * 1.5);
  const band = x => Array.from({ length: lit.h }, (_, y) => at(lit, x, y)[0] - at(unlit, x, y)[0])
    .filter(value => value > 4).length;
  assert.ok(band(88) > band(43));
  const e = x => [...lit.passes.emission.slice((38 * lit.w + x) * 3, (38 * lit.w + x) * 3 + 3)];
  assert.deepEqual(e(43), [0, 0, 0]);
  assert.ok(e(88)[0] < .10 && e(88)[1] > .29 && e(88)[2] > .58);
  assert.notDeepEqual(ink.render(world, { ...opts, pitch: .35 }).rgb, lit.rgb);

  const B = kit.makeBuilder(1, world.pal);
  B.disc(0, -1, 0, [0, 0, 1], .1, .02, B.P[0], 1);
  const plain = host(B);
  const joined = kit.SplatProvenance.join([plain, world], { cam: camera, fog: world.fog, liveSun: recipe.liveSun });
  assert.deepEqual([...joined.curveMaterials.slice(0, 4)], [0, 0, 0, 0]);
  assert.deepEqual(joined.curveMaterials.slice(4), world.curveMaterials);
  assert.ok(ink.render(joined, opts).passes.emission.some(value => value > .58));
});

test('textile worlds can paint with named palette roles and the yarn sample context', () => {
  const yarn = K.textile.weave({ size: [3, 2], columns: 4, rows: 3, radius: .06, clearance: .02 });
  const world = K.textile.world(yarn, {
    pal: palette, paletteRoles: { amber: [1], green: [2] },
    appearance: { renderer: 'curve-splats', curveProfile: { profileSamples: 24,
      along: { paletteRole: ({ u, distance, family, uv }) => {
        assert.ok(uv.length === 2 && distance > 0);
        return (family === 'warp') === (u < .5) ? 'amber' : 'green';
      } } } }
  });
  const frame = ink.render(world, imageOptions);
  let green = 0, amber = 0;
  for (let i = 0; i < frame.rgb.length; i += 3) {
    if (frame.rgb[i] > 150 && frame.rgb[i + 1] < frame.rgb[i]) amber++;
    if (frame.rgb[i + 1] > 150 && frame.rgb[i] < frame.rgb[i + 1]) green++;
  }
  assert.ok(green > 20 && amber > 20);
});
