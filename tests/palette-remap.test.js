const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('..');
const { KIT, PixelLook } = core.load();
const { render } = require('../cli/render.js');
const example = require('../examples/palette-remap.json');

test('remaps resolve exact duplicate swatches, indices and ramp stops from the original palette', () => {
  const base = [0x001122, 0x223344, 0x223344, 0x445566, 0x667788, 0xffca31];
  const roles = { stone: [1, 3, 4], beacon: [5] };
  const remap = PixelLook.prepareRemap({ rules: [
    { from: '#223344', to: '#ffffff' },
    { from: 'stone.shadow', to: '#ab4422' },
    { from: 'stone.midtone', to: '#992211' },
    { from: 'stone.2', to: '#cc8877' },
    { from: '#667788', to: '#223344' },
    { from: 5, to: 0x00ffff }
  ], protect: ['beacon'] }, base, roles);
  const prior = new Float32Array(base.length * 3).fill(.5);
  assert.deepEqual(PixelLook.gradePalette(remap.grade(prior)),
    [0x808080, 0xab4422, 0xffffff, 0x992211, 0x223344, 0xffca31]);
  assert.deepEqual(Array.from(prior), Array(base.length * 3).fill(.5));
  assert.deepEqual(base, [0x001122, 0x223344, 0x223344, 0x445566, 0x667788, 0xffca31]);
});

test('bad selectors and outputs are reported as palette remap validation errors', () => {
  for (const from of ['#ff007e', 'missing', 'stone.89', -1, 44, null]) {
    const spec = structuredClone(example);
    spec.finish.look.paletteRemap.rules.push({ from, to: '#000000' });
    assert.equal(KIT.diorama.check(spec).find(row => row.level === 'error')?.path, 'finish.look.paletteRemap');
  }
  assert.throws(() => PixelLook.prepareRemap({ rules: [{ from: 0, to: '#fff' }] }, [0]), /output needs/);
  assert.throws(() => PixelLook.prepareRemap({ rules: [], protect: ['unknown'] }, [0]), /Unknown or empty palette role/);
});

test('headless render applies the remap after palette selection and preserves every protected pixel', () => {
  const world = KIT.diorama.build(example), options = { w: 240, h: 168, px: 2, ortho: true };
  const before = render(world, { ...options, paletteRemap: false }), after = render(world, options);
  assert.deepEqual(after.use, before.use);
  assert.deepEqual(after.palette.slice(0, 6), [0x07080b, 0x16152e, 0x29254e, 0x424789, 0x6380ba, 0x92b9d0]);
  const protectedColors = new Map([0x07080b, 0xc8321e, 0xffd24a, 0xfff3c0].map(color => [color, 0]));
  for (let i = 0; i < before.rgb.length; i += 3) {
    const color = (before.rgb[i] << 16) | (before.rgb[i + 1] << 8) | before.rgb[i + 2];
    if (!protectedColors.has(color)) continue;
    protectedColors.set(color, protectedColors.get(color) + 1);
    assert.deepEqual(after.rgb.subarray(i, i + 3), before.rgb.subarray(i, i + 3));
  }
  for (const color of [0x07080b, 0xc8321e, 0xfff3c0]) assert(protectedColors.get(color) > 5);
  assert.notDeepEqual(after.rgb, before.rgb);
  for (const alternate of [{ raw: true }, { tone: 'stipple' }]) {
    assert.deepEqual(render(world, { ...options, ...alternate }).rgb,
      render(world, { ...options, ...alternate, paletteRemap: false }).rgb);
  }
  for (const alternate of [{ colored: true }, { stable: { resolve: 'coverage' } }]) {
    assert.deepEqual(render(world, { ...options, ...alternate }).palette, after.palette);
  }
});

test('stage grade can replace and clear a palette remap without altering the baked palette', () => {
  const world = { pal: [0, 0x404040], paletteRoles: { stone: [1] } }, stage = { W: world };
  const grade = KIT.fx.grade(stage);
  const remap = { rules: [{ from: 'stone.shadow', to: '#e0a020' }] };
  grade.setRemap(remap, .5);
  assert.deepEqual(PixelLook.gradePalette(stage.grade), [0, 0x907030]);
  assert.deepEqual(world.pal, [0, 0x404040]);
  grade.setRemap(remap, 0);
  assert.equal(stage.grade, null);
});

function testWebGL(createRenderer, spec) {
  const canvas = document.querySelector('canvas');
  const renderer = createRenderer(canvas, { toolkit: { KIT, PixelLook } });
  const gl = canvas.getContext('webgl2'), world = KIT.diorama.build(spec);
  function pixels(paletteRemap, colorCurves) {
    renderer.render(world, { paletteRemap, colorCurves, ortho: true, colored: false, dither: 0 });
    const rgba = new Uint8Array(canvas.width * canvas.height * 4);
    gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    return Array.from({ length: rgba.length / 4 }, (_, i) => (rgba[i * 4] << 16) | (rgba[i * 4 + 1] << 8) | rgba[i * 4 + 2]);
  }
  const before = pixels(false), after = pixels();
  const output = PixelLook.gradePalette(PixelLook.prepareRemap(world.look.paletteRemap, world.pal, world.paletteRoles).grade());
  let changed = 0, signal = 0, beacon = 0;
  for (let i = 0; i < before.length; i++) {
    const color = before[i], expected = output[world.pal.indexOf(color)];
    if (after[i] !== expected) throw new Error(`Wrong palette output for #${color.toString(16)} at pixel ${i}`);
    changed += Number(expected !== color);
    signal += Number(color === 0xc8321e);
    beacon += Number(color === 0xfff3c0);
  }
  if (changed < 100 || signal < 5 || beacon < 5) throw new Error('Missing visible remap or protected swatches');
  const transfer = { channels: { blue: { stops: [[0, .1], [1, .8]], interpolation: 'smooth' } } };
  for (const remap of [false, world.look.paletteRemap]) {
    const evaluated = pixels(remap, transfer);
    const swatches = PixelLook.gradePalette(PixelLook.colorGrade(world.pal, world.paletteRoles, null, remap, transfer));
    if (!evaluated.every((color, i) => color === swatches[world.pal.indexOf(before[i])]))
      throw new Error('WebGL color curves differ from the shared CPU palette evaluation');
  }
  renderer.dispose();
}

test('WebGL matches CPU palette remaps and channel curves with protected swatches', { skip: !process.env.INK_TEST_CHROME }, () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { execFileSync } = require('node:child_process'), { pathToFileURL } = require('node:url');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-remap-')), url = file => pathToFileURL(file).href;
  try {
    const page = path.join(temp, 'remap.html'), browserEntry = url(path.resolve(__dirname, '../webgl.mjs'));
    fs.writeFileSync(path.join(temp, 'bundle.js'), core.bundle());
    fs.writeFileSync(page, `<!doctype html><canvas width="180" height="126"></canvas><pre id="result">PENDING</pre>
<script src="bundle.js"></script><script type="module">
import { createRenderer } from ${JSON.stringify(browserEntry)};
const result = document.querySelector('#result');
try {
  (${testWebGL.toString()})(createRenderer, ${JSON.stringify(example)});
  result.textContent = 'PASS';
} catch (error) { result.textContent = error.stack; }
</script>`);
    const html = execFileSync(process.env.INK_TEST_CHROME, ['--headless', '--no-first-run', '--disable-background-networking',
      '--allow-file-access-from-files', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
      '--user-data-dir=' + path.join(temp, 'profile'), '--dump-dom', url(page)],
    { timeout: 60000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    assert.equal(html.match(/<pre id="result">([^<]*)<\/pre>/)?.[1], 'PASS');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
