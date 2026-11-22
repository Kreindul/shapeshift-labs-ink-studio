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
  const yarn = K.textile.draw(B, textile, { renderer: 'curve-splats', color: ({ uv }) => {
    assert.equal(uv.length, 2);
    sampled++;
    return '#76d6ae';
  } });
  assert.equal(yarn.threads.length, textile.threads.length);
  assert.equal(sampled, yarn.segments);
  assert.ok(yarn.threads.every((strand, i) => strand.id === textile.threads[i].id));

  const fixture = structuredClone(require('../examples/world-routed-workshop.json'));
  fixture.visual.routedLinkRenderer = 'curve-splats';
  const run = K.world.runtime.create(fixture);
  const link = run.query().probe('routes/links', undefined, { link: 'hose' }).value;
  const routed = C.draw(B, { kind: 'routed', link });
  assert.equal(routed.threads.length, link.paths.length);
  assert.ok(routed.segments > 0);
  assert.equal(K.world.visual(kit, run.view(), run.query()).curveSplats, true);

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
    radius: .065, color: '#f3b56b', object: 'wire' }]);
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
