const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const studio = require('..');
const lib = studio.load(), K = lib.KIT;
const puppet = require('../examples/puppet.js')(lib);
const bounds = { min: [-1.3, -1.3, -1.3], max: [1.3, 1.3, 1.3] };
const sphere = (x, y, z) => Math.hypot(x, y, z) - 1;

function parseGlb(file) {
  const bytes = fs.readFileSync(file), jsonEnd = 20 + bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, jsonEnd));
  const bin = bytes.subarray(jsonEnd + 8);
  const data = index => {
    const accessor = gltf.accessors[index], view = gltf.bufferViews[accessor.bufferView];
    const [read, step] = {
      5121: ['readUInt8', 1], 5123: ['readUInt16LE', 2], 5125: ['readUInt32LE', 4], 5126: ['readFloatLE', 4]
    }[accessor.componentType];
    const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[accessor.type];
    return Array.from({ length: accessor.count }, (_, i) => Array.from({ length: components }, (_, c) =>
      bin[read]((view.byteOffset || 0) + (accessor.byteOffset || 0) +
        i * (view.byteStride || components * step) + c * step)
    ));
  };
  return { bytes, gltf, data };
}

function meshMetrics(points, faces) {
  const edges = new Map();
  const keys = points.map(p => p.map(v => Math.round(v * 1e6)).join('/'));
  let volume = 0, area = Infinity;
  for (const face of faces) {
    const [a, b, c] = face.map(i => points[i]);
    const normal = K.V.cross(K.V.sub(b, a), K.V.sub(c, a));
    area = Math.min(area, K.V.len(normal) / 2);
    volume += K.V.dot(a, normal) / 6;
    for (let j = 0; j < 3; j++) {
      const k = [keys[face[j]], keys[face[(j + 1) % 3]]].sort().join('|');
      edges.set(k, (edges.get(k) || 0) + 1);
    }
  }
  return { unique: new Set(keys).size, volume, area, badEdges: [...edges.values()].filter(n => n !== 2).length };
}

test('SDF export keeps indexed, outward closed surfaces with inner walls facing into cavities', () => {
  for (const method of ['surfaceNets', 'dualContour', 'tetrahedra']) {
    const mesh = K.model.fromSdf((x, y, z) => Math.max(sphere(x, y, z), 0.55 - Math.hypot(x, y, z)),
      { bounds, resolution: 0.145, method });
    const faces = mesh.faces.flatMap(f => f.length === 3 ? [f] : [[f[0], f[1], f[2]], [f[0], f[2], f[3]]]);
    const inner = faces.filter(f => Math.hypot(...mesh.points[f[0]]) < 0.7);
    assert.ok(meshMetrics(mesh.points, inner).volume < 0);
    const metrics = meshMetrics(mesh.points, faces);
    assert.ok(metrics.volume > 3);
    assert.equal(metrics.badEdges, 0);
    assert.ok(mesh.points.length < faces.length);
  }
  assert.throws(() => K.model.fromSdf(sphere, { bounds: { min: [-1, -1, -1], max: [1, 1, 1] }, resolution: 0.1 }), /positive at the sampling bounds/);
});

test('JSON dioramas export independently skinned parts and sample their runtime pose', () => {
  const spec = {
    id: 'jointed',
    solids: [
      { kind: 'ground', rad: 2 },
      { kind: 'ball', at: [-0.9, 1, 0], r: 0.2 },
      { kind: 'ball', at: [0, 1, 0], r: 0.6, part: 'body' },
      { kind: 'ball', at: [0, 2, 0], r: 0.35, part: 'head' }
    ],
    parts: { body: { joint: [0, 0.7, 0] }, head: { joint: [0, 1.7, 0], parent: 'body' } },
    motion: [{ part: 'body', do: 'spin', speed: 1 }, { part: 'head', do: 'turn', axis: [0, 0, 1], period: 1 }]
  };
  const scene = K.diorama.scene(spec), model = scene.model(1, { duration: 0.5, fps: 4 });
  assert.deepEqual(model.joints.map(({ name, parent }) => [name, parent]), [['body', null], ['head', 0]]);
  assert.equal(model.meshes[0].static, true);
  assert.deepEqual(model.meshes[2].weights[0], [[1, 1]]);
  const world = scene.build(1);
  world.anim.update(0, 0);
  world.anim.update(0.25, 0.25);
  for (let i = 0; i < model.joints.length; i++) {
    const offset = world.lab.rig.names.indexOf(model.joints[i].name) * 12;
    assert.deepEqual(model.animations[0].frames[1].matrices[i], [...world.lab.rig.M.slice(offset, offset + 12)]);
  }
});

const blenderApp = '/Applications/Blender.app/Contents/MacOS/Blender';
const blender = process.env.INK_BLENDER || (fs.existsSync(blenderApp) ? blenderApp : 'blender');
const blenderAvailable = spawnSync(blender, ['--version'], { stdio: 'ignore' }).status === 0;
const transform = (matrix, point) => [0, 1, 2].map(i =>
  matrix[i] * point[0] + matrix[4 + i] * point[1] + matrix[8 + i] * point[2] + matrix[12 + i]);
const matrixMul = (a, b) => b.map((_, i) => [0, 1, 2, 3].reduce((s, j) =>
  s + a[j * 4 + i % 4] * b[i - i % 4 + j], 0));
function trs(node) {
  if (node.matrix) return node.matrix;
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1], [sx, sy, sz] = node.scale || [1, 1, 1];
  return [
    (1 - 2 * (y*y + z*z)) * sx, 2 * (x*y + w*z) * sx, 2 * (x*z - w*y) * sx, 0,
    2 * (x*y - w*z) * sy, (1 - 2 * (x*x + z*z)) * sy, 2 * (y*z + w*x) * sy, 0,
    2 * (x*z + w*y) * sz, 2 * (y*z - w*x) * sz, (1 - 2 * (x*x + y*y)) * sz, 0,
    ...(node.translation || [0, 0, 0]), 1
  ];
}

test('GLB export writes a clean UV atlas and reproduces the puppet deformation', { skip: !blenderAvailable }, t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-glb-test-'));
  t.after(() => fs.rmSync(dir, { force: true, recursive: true }));
  const file = path.join(dir, 'puppet.glb'), model = puppet.model(puppet.seed);
  const report = studio.exportGlb(model, { out: file, blender, textureSize: 512 });
  const { gltf, data, bytes } = parseGlb(file), p = gltf.meshes[0].primitives[0], attr = p.attributes;
  const verts = data(attr.POSITION), indices = data(p.indices).flat();
  const faces = Array.from({ length: indices.length / 3 }, (_, i) => indices.slice(i * 3, i * 3 + 3));
  const metrics = meshMetrics(verts, faces);
  assert.deepEqual([metrics.unique, faces.length, metrics.badEdges], [report.meshes[0].vertices, report.meshes[0].triangles, 0]);
  assert.ok(metrics.volume > 0 && metrics.area > 0);
  assert.equal(data(attr.NORMAL).length, verts.length);
  const uv = data(attr.TEXCOORD_0);
  assert.ok(uv.every(uv => uv.every(x => Number.isFinite(x) && x >= 0 && x <= 1)));
  assert.ok(faces.every(f => {
    const [[ax, ay], [bx, by], [cx, cy]] = f.map(i => uv[i]);
    return Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) > 1e-9;
  }));
  assert.equal(gltf.images[0].mimeType, 'image/png');
  assert.equal(gltf.materials[0].pbrMetallicRoughness.baseColorTexture.index, 0);

  const skin = gltf.skins[0], clip = gltf.animations[0];
  const animated = structuredClone(gltf.nodes), at = 0.5;
  assert.equal(clip.name, 'Victory');
  assert.equal(skin.joints.length, model.joints.length);
  for (const channel of clip.channels) {
    const sampler = clip.samplers[channel.sampler], times = data(sampler.input).flat();
    const i = times.findIndex(t => Math.abs(t - at) < 1e-5);
    const values = data(sampler.output);
    assert.ok(i >= 0 || values.every(v => v.every((x, k) => Math.abs(x - values[0][k]) < 1e-6)));
    animated[channel.target.node][channel.target.path] = values[Math.max(0, i)];
  }
  const parents = new Map(animated.flatMap(({ children = [] }, i) => children.map(c => [c, i])));
  const jointWorld = (list, i) => parents.has(i) ? matrixMul(jointWorld(list, parents.get(i)), trs(list[i])) : trs(list[i]);
  const frame = model.animations[0].frames.find(f => f.time === at), inverseBind = data(skin.inverseBindMatrices);
  const deltas = skin.joints.map((index, i) => matrixMul(jointWorld(animated, index), inverseBind[i]));
  const sourceDelta = skin.joints.map(index => frame.matrices[model.joints.findIndex(j => j.name === animated[index].name)]);
  const weights = data(attr.WEIGHTS_0), joints = data(attr.JOINTS_0);
  let drift = 0, displacement = 0;
  for (let i = 0; i < verts.length; i++) {
    assert.ok(Math.abs(weights[i].reduce((sum, w) => sum + w, 0) - 1) < 1e-6);
    const blend = (matrices, apply) => weights[i].reduce((p, w, j) => w ? K.V.mad(
      p, apply(matrices[joints[i][j]], verts[i]), w
    ) : p, [0, 0, 0]);
    const got = blend(deltas, transform);
    const expected = blend(sourceDelta, (m, p) => K.V.add(K.M.app(m, p), m.slice(9)));
    drift = Math.max(drift, K.V.len(K.V.sub(got, expected)));
    displacement = Math.max(displacement, K.V.len(K.V.sub(got, verts[i])));
  }
  assert.ok(drift < 1e-4, 'maximum vertex drift ' + drift);
  assert.ok(displacement > 0.05);

  const copy = path.join(dir, 'copy.glb');
  assert.equal(studio.exportGlb(file, { out: copy, blender: '/not-required' }).preserved, true);
  assert.deepEqual(fs.readFileSync(copy), bytes);
  assert.throws(() => studio.exportGlb({ points: [], faces: [] }, { out: file, blender }), /GLB export failed/);
  assert.deepEqual(fs.readFileSync(file), bytes);
});
