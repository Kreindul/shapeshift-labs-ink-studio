const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const zlib = require('node:zlib');
const ink = require('..');

const fields = ['rot_3', 'z', 'x', 'scale_2', 'f_dc_1', 'rot_1', 'opacity', 'scale_0', 'y',
  'f_dc_2', 'rot_0', 'rot_2', 'scale_1', 'f_dc_0'];
const values = [Math.SQRT1_2, 3, -2, Math.log(.05), -.5, 0, 0, Math.log(.2), 1, 0, Math.SQRT1_2, 0, Math.log(.1), 1];
const approx = (a, b, tolerance = 1e-5) => assert(Math.abs(a-b) <= tolerance, `${a} differs from ${b}`);

function ply(format = 'ascii', coefficients = [], count = 1) {
  const eol = format === 'binary_big_endian' ? '\r\n' : '\n';
  const header = Buffer.from(['ply', 'format ' + format + ' 1.0', 'comment importer fixture', 'element vertex ' + count,
    ...fields.map(name => 'property float ' + name),
    ...coefficients.map((_, i) => 'property float f_rest_' + i),
    'element face 0', 'property list uchar int vertex_indices', 'end_header', ''].join(eol));
  const vertex = [...values, ...coefficients];
  if (format === 'ascii') return Buffer.concat([header, Buffer.from(vertex.join(' '))]);
  const payload = Buffer.alloc(vertex.length * 4);
  for (const [i, value] of vertex.entries()) payload[format === 'binary_little_endian' ? 'writeFloatLE' : 'writeFloatBE'](value, i * 4);
  return Buffer.concat([header, payload]);
}

function spz(version) {
  const header = Buffer.alloc(version === 4 ? 32 : 16);
  header.write('NGSP');
  header.writeUInt32LE(version, 4);
  header.writeUInt32LE(1, 8);
  header[12] = 1;
  header[13] = 12;
  header[14] = 1;
  const positions = version === 1 ? Buffer.from([0, 0xc0, 0, 0x3c, 0, 0x42]) : Buffer.alloc(9);
  if (version > 1) [-2, 1, 3].forEach((value, i) => positions.writeIntLE(value * 4096, i * 3, 3));
  const rotation = version < 3 ? Buffer.from([128, 128, 128]) : Buffer.from([0xff, 1, 0, 0xc0]);
  const streams = [positions, Buffer.from([128]), Buffer.from([128, 180, 90]), Buffer.from([128, 144, 160]),
    rotation, Buffer.from([128, 144, 112, 128, 128, 128, 160, 128, 128])];
  if (version < 4) return zlib.gzipSync(Buffer.concat([header, ...streams]));
  header[15] = streams.length;
  header.writeUInt32LE(header.length, 16);
  const table = Buffer.alloc(16 * streams.length);
  const compressed = streams.map((stream, i) => {
    let frame;
    if (zlib.zstdCompressSync) frame = zlib.zstdCompressSync(stream);
    else {
      /* A single-segment Zstandard frame containing one raw last block. */
      frame = Buffer.concat([Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x20, stream.length, stream.length * 8 + 1, 0, 0]), stream]);
    }
    table.writeBigUInt64LE(BigInt(frame.length), 16 * i);
    table.writeBigUInt64LE(BigInt(stream.length), 16 * i + 8);
    return frame;
  });
  return Buffer.concat([header, table, ...compressed]);
}

test('Gaussian PLY is property-ordered, accepts ASCII and both byte orders, and keeps SH', async () => {
  const { decodeGaussianPly, gaussianSplatWorld } = await import('../src/gaussian-splats.mjs');
  for (const encoding of ['ascii', 'binary_little_endian', 'binary_big_endian']) {
    const cloud = decodeGaussianPly(ply(encoding, [1,2,3,4,5,6,7,8,9]));
    assert.deepEqual([...cloud.positions], [-2, 1, 3]);
    assert.deepEqual([...cloud.sh], [1,4,7,2,5,8,3,6,9]);
    approx(cloud.rotations[2], Math.SQRT1_2);
    approx(cloud.scales[0], .2);
    approx(cloud.opacity[0], .5);
    const world = gaussianSplatWorld(cloud, { size: 1.2 });
    approx(world.data[4], .01);
    approx(world.data[8], .04);
    approx(world.data[10], .0025);
    assert.notEqual(gaussianSplatWorld(cloud, { viewDirection: [0,0,1] }).data[7], world.data[7]);
    approx(gaussianSplatWorld(cloud, { size: 1.2, up: 'z' }).data[8], .0025);
  }
  assert.throws(() => decodeGaussianPly(ply('binary_little_endian').subarray(0, -3)), /Truncated/);
  assert.throws(() => decodeGaussianPly(ply('ascii', [], 2), { maxPoints: 1 }), /point count/);
  assert.throws(() => decodeGaussianPly('ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nend_header\n0'), /Gaussian fields/);
});

test('SPZ versions 1 through 4 decode positions, covariance inputs, alpha and SH', async () => {
  const { decodeGaussianSplat, gaussianSplatWorld } = await import('../src/gaussian-splats.mjs');
  for (const version of [1, 2, 3, 4]) {
    const cloud = await decodeGaussianSplat(spz(version));
    assert.equal(cloud.version, version);
    assert.deepEqual([...cloud.positions], [-2, 1, 3]);
    assert.deepEqual([...cloud.sh], [0,.125,-.125,0,0,0,.25,0,0]);
    assert.equal(cloud.antialiased, true);
    approx(cloud.opacity[0], 128 / 255);
    approx(cloud.scales[0], Math.exp(-2));
    if (version >= 3) {
      approx(cloud.rotations[2], Math.SQRT1_2);
      approx(cloud.rotations[3], Math.SQRT1_2);
    }
    assert.equal(gaussianSplatWorld(cloud).data.length, 16);
  }
  const badTable = spz(4);
  badTable.writeBigUInt64LE(22n, 40);
  await assert.rejects(decodeGaussianSplat(badTable), /stream size/);
  await assert.rejects(decodeGaussianSplat(spz(4).subarray(0, -2)), /stream size/);
  await assert.rejects(decodeGaussianSplat(new Uint8Array([1,2,3,4])), /Expected PLY/);
});

test('the public Node and CLI entry points render imported Gaussian data', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-gaussian-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'sample.spz'), out = path.join(dir, 'sample.png');
  fs.writeFileSync(file, spz(4));
  const cloud = await ink.readGaussianSplat(file);
  const world = await ink.gaussianSplatWorld(cloud);
  const frame = ink.render(world, { w: 36, h: 32, px: 1, raw: true });
  assert(frame.rgb.some((value, i) => value !== world.bg[i % 3]));
  execFileSync(process.execPath, [path.resolve(__dirname, '../cli/ink-studio.js'), 'render', file,
    '--raw', '--w', '36', '--h', '32', '--out', out], { cwd: dir });
  assert.equal(fs.readFileSync(out).subarray(1, 4).toString(), 'PNG');
});

test('live worlds share decoded rows and preserve the fixed-view fallback', async () => {
  const { decodeGaussianSplat, gaussianSplatWorld } = await import('../src/gaussian-splats.mjs');
  for (const bytes of [ply('binary_little_endian', Array(9).fill(.1)), spz(4)]) {
    const cloud = await decodeGaussianSplat(bytes);
    const palette = [0x152537, 0xbdad99];
    const viewDirection = [1, 0, 1];
    const baked = gaussianSplatWorld(cloud, { viewDirection });
    assert.equal(baked.gaussianHarmonics, undefined);
    for (const colorMode of ['rgb', 'palette']) {
      const world = gaussianSplatWorld(cloud, { viewDirection, colorMode, palette });
      assert.deepEqual(world.data, baked.data);
      assert.equal(world.gaussianHarmonics.dc, cloud.dc);
      assert.equal(world.gaussianHarmonics.sh, cloud.sh);
      assert.equal(world.gaussianHarmonics.degree, 1);
      assert.equal(world.gaussianHarmonics.colorMode, colorMode);
      assert.deepEqual(world.bg, [0x15, 0x25, 0x37]);
      assert.deepEqual(world.pal, palette);
    }
    assert.throws(() => gaussianSplatWorld(cloud, { colorMode: 'invalid' }), /Gaussian color mode/);
    assert.throws(() => gaussianSplatWorld(cloud, { palette: [] }), /Gaussian palette/);
  }
});

test('WebGL live Gaussian color matches baked harmonics through degree four', { skip: !process.env.INK_TEST_CHROME }, async () => {
  const { decodeGaussianSplat, gaussianSplatWorld } = await import('../src/gaussian-splats.mjs');
  const cases = [];
  const camera = { yaw: .72, pitch: -.31, dist: 4, target: [0, 0, 0] };
  const ray = [-Math.cos(camera.pitch) * Math.sin(camera.yaw), -Math.sin(camera.pitch), -Math.cos(camera.pitch) * Math.cos(camera.yaw)];
  const palette = [0x031528, 0x713f86, 0xc18671, 0x76b9ad, 0xa6dcf9];
  for (let l = 0; l <= 4; l++) {
    const count = 3 * ((l + 1) ** 2 - 1);
    const coeffs = Array.from({ length: count }, (_, i) => Math.sin(i * 2.13 + .2) * .16);
    const cloud = await decodeGaussianSplat(ply('binary_little_endian', coeffs));
    cloud.opacity[0] = 1;
    const up = l % 2 === 0 ? 'z' : 'y';
    const world = gaussianSplatWorld(cloud, { colorMode: 'rgb', size: 1.8, palette, up });
    const baked = gaussianSplatWorld(cloud, { size: 1.8, palette, up,
      viewDirection: up === 'z' ? [ray[0], -ray[2], ray[1]] : ray });
    const { gaussianHarmonics: rows, ...base } = world;
    cases.push({ base: { ...base, data: Array.from(base.data), moving: [], back: [] },
      rows: { ...rows, dc: Array.from(rows.dc), sh: Array.from(rows.sh) }, fixed: Array.from(baked.data) });
  }

  const result = require('../cli/look-webgl.js')({}, () => {}, (kit, fixture, backend, input) => {
    const renderer = backend(80, 80, { offscreen: true, colored: false, dither: 0, damp: false });
    const center = () => renderer.sample({ p: [40, 40] }).p;
    const results = [];
    for (const { base, rows, fixed } of input.cases) {
      const fallback = { ...base, data: Float32Array.from(fixed), moving: new Int32Array(), back: new Int32Array() };
      const world = { ...fallback, data: Float32Array.from(base.data), gaussianHarmonics: {
        ...rows, dc: Float32Array.from(rows.dc), sh: Float32Array.from(rows.sh)
      } };
      const { camera } = input;
      renderer.draw(fallback, { camera, raw: true });
      const baked = center();
      renderer.draw(world, { camera });
      const rgb = center();
      renderer.draw(world, { camera: { ...camera, ortho: true } });
      const ortho = center();
      renderer.draw(world, { camera: { ...camera, yaw: camera.yaw - Math.PI } });
      const opposite = center();
      renderer.draw(world, { camera, gaussianColor: 'palette', raw: true });
      const palette = center();
      renderer.draw(fallback, { camera, raw: true });
      results.push({ baked, rgb, ortho, opposite, palette, restored: center() });
    }
    renderer.close();
    return { results };
  }, { cases, camera });
  const samples = palette.map(color => [color >> 16, color >> 8 & 255, color & 255]);
  for (const [degree, { baked, rgb, ortho, opposite, palette: stepped, restored }] of result.results.entries()) {
    for (let channel = 0; channel < 3; channel++) {
      approx(rgb[channel], baked[channel], 2);
      approx(ortho[channel], baked[channel], 2);
    }
    assert.deepEqual(restored, baked);
    assert(samples.some(swatch => swatch.every((value, i) => value === stepped[i])));
    if (degree > 0) assert.notDeepEqual(opposite, rgb);
  }
});
