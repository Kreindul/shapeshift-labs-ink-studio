// Publish a complete GLB after Blender has finished UV editing, skinning and packing it.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// Keep a complete GLB byte-for-byte, including extensions and animation interpolation.
function inspectCompleteGlb(input) {
  const fd = fs.openSync(input, 'r');
  try {
    const size = fs.fstatSync(fd).size,
      header = Buffer.alloc(20);
    if (
      fs.readSync(fd, header) !== header.length ||
      header.toString('ascii', 0, 4) !== 'glTF' ||
      header.readUInt32LE(4) !== 2 ||
      header.readUInt32LE(8) !== size ||
      header.toString('ascii', 16) !== 'JSON'
    )
      throw new Error('Invalid GLB 2.0 header');
    const length = header.readUInt32LE(12);
    if (length > size - 20 || length % 4) throw new Error('Invalid GLB JSON chunk length');
    const bytes = Buffer.alloc(length);
    if (fs.readSync(fd, bytes) !== length) throw new Error('Incomplete GLB JSON chunk');
    const gltf = JSON.parse(bytes.toString('utf8'));
    const external = asset => 'uri' in asset && !asset.uri.startsWith('data:');
    if (gltf.buffers?.some(external) || gltf.images?.some(external)) return null;
    const meshes = [];
    const count = i => gltf.accessors?.[i]?.count;
    for (const mesh of gltf.meshes || []) {
      let vertices = 0,
        triangles = 0,
        uvLayers = Infinity;
      for (const { mode = 4, indices, attributes } of mesh.primitives) {
        if (
          mode !== 4 ||
          !count(indices) ||
          count(indices) % 3 ||
          !count(attributes.POSITION) ||
          count(attributes.NORMAL) !== count(attributes.POSITION) ||
          count(attributes.TEXCOORD_0) !== count(attributes.POSITION)
        )
          return null;
        vertices += count(attributes.POSITION);
        triangles += count(indices) / 3;
        uvLayers = Math.min(uvLayers, Object.keys(attributes).filter(key => /^TEXCOORD_\d+$/.test(key)).length);
      }
      meshes.push({ name: mesh.name, vertices, triangles, uvLayers, generatedUVs: false });
    }
    if (!meshes.length) return null;
    return { meshes, joints: new Set(gltf.skins?.flatMap(skin => skin.joints)).size, preserved: true };
  } finally {
    fs.closeSync(fd);
  }
}

function exportGlb(modelOrFile, { out, blender = process.env.INK_BLENDER, uvMargin = 0.008, textureSize = 1024 } = {}) {
  if (!out || path.extname(out).toLowerCase() !== '.glb') throw new Error('Choose an .glb output filename');
  if (!Number.isFinite(uvMargin) || uvMargin <= 0 || uvMargin >= 0.1)
    throw new Error('UV margin must be between 0 and 0.1');
  if (![0, 256, 512, 1024, 2048, 4096].includes(textureSize))
    throw new Error('Texture size must be 0, 256, 512, 1024, 2048 or 4096');
  const input = typeof modelOrFile === 'string' ? path.resolve(modelOrFile) : null;
  if (input && !/\.(obj|gltf|glb)$/i.test(input)) throw new Error('Mesh input must be an OBJ, glTF or GLB');
  if (input && !fs.statSync(input).isFile()) throw new Error('Mesh input must be a file');
  if (!input && !modelOrFile) throw new Error('Model export requires indexed rest geometry');
  const app = '/Applications/Blender.app/Contents/MacOS/Blender';
  const executable = blender || (process.platform === 'darwin' && fs.existsSync(app) ? app : 'blender');
  const output = path.resolve(out);
  if (input === output) throw new Error('Choose an output different from the input mesh');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  // The same volume lets the final rename replace a destination atomically.
  const temp = fs.mkdtempSync(path.join(path.dirname(output), '.ink-glb-'));
  const config = path.join(temp, 'model.json');
  const staged = path.join(temp, 'asset.glb');
  try {
    const original = input && /\.glb$/i.test(input) && inspectCompleteGlb(input);
    if (original) {
      fs.copyFileSync(input, staged);
      fs.renameSync(staged, output);
      return { ...original, file: output };
    }
    const model = input ? null : modelOrFile.meshes ? modelOrFile : { meshes: [modelOrFile] };
    fs.writeFileSync(
      config,
      JSON.stringify({ input, model, staged, uvMargin, textureSize, name: path.parse(output).name })
    );
    const result = spawnSync(
      executable,
      [
        '--background',
        '--factory-startup',
        '--disable-autoexec',
        '--python-exit-code',
        '1',
        '--python',
        path.join(__dirname, 'export-glb.py'),
        '--',
        config
      ],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
    );
    if (result.error?.code === 'ENOENT')
      throw new Error(
        'GLB export requires Blender 4.5 or later. Set INK_BLENDER or pass --blender with the executable path.'
      );
    if (result.error) throw result.error;
    if (result.status !== 0 || !fs.existsSync(staged)) {
      const details = (result.stderr + '\n' + result.stdout).trim();
      throw new Error('GLB export failed\n' + details);
    }
    const report = result.stdout.split('\n').find(line => line.startsWith('INK_GLB '));
    if (!report) throw new Error('Blender finished without a GLB export report');
    const header = Buffer.alloc(12),
      fd = fs.openSync(staged, 'r');
    try {
      fs.readSync(fd, header);
      if (
        header.toString('ascii', 0, 4) !== 'glTF' ||
        header.readUInt32LE(4) !== 2 ||
        header.readUInt32LE(8) !== fs.fstatSync(fd).size
      )
        throw new Error('Blender returned an incomplete GLB');
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(staged, output);
    return { ...JSON.parse(report.slice(8)), file: output };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

module.exports = exportGlb;
