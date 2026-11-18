/* Indexed rest geometry and editable skin data for mesh export. */
(function (K) {
  const G = K.procedural.geometry,
    V = K.V;
  const linear = value => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const rgb = hex => [hex >> 16, (hex >> 8) & 255, hex & 255].map(channel => linear(channel / 255));

  function manifoldEdges(faces) {
    const edges = new Map();
    for (const face of faces)
      for (let i = 0; i < face.length; i++) {
        const a = face[i],
          b = face[(i + 1) % face.length],
          key = a < b ? a + '/' + b : b + '/' + a;
        const record = edges.get(key) || [0, 0];
        record[a < b ? 0 : 1]++;
        edges.set(key, record);
      }
    return [...edges.values()].every(([forward, back]) => forward === 1 && back === 1);
  }

  function fromSdf(field, { bounds, resolution = 0.08, maxCells = 500000, method = 'auto', ...options } = {}) {
    const fn = typeof field === 'function' ? field : field?.sd?.bind(field);
    const box = bounds ?? (field?.lo && field?.hi ? { min: field.lo, max: field.hi } : null);
    if (!fn || !box) throw new Error('Model export requires an SDF and sampling bounds');
    if (!['auto', 'dualContour', 'surfaceNets', 'tetrahedra'].includes(method))
      throw new Error('Unknown model meshing method');
    const { min, max } = K.procedural.spatial.bounds(box);
    if (!Number.isFinite(resolution) || resolution <= 0 || !Number.isSafeInteger(maxCells) || maxCells < 8)
      throw new Error('Model meshing needs a positive resolution and a sampling budget');
    const counts = max.map((v, i) => Math.max(1, Math.ceil((v - min[i]) / resolution)));
    if (counts.reduce((a, b) => a * b, 1) > maxCells)
      throw new Error(
        'Model bounds need ' + counts.join(' × ') + ' cells at this resolution. Use larger --res or tighter bounds.'
      );
    for (let a = 0; a < 3; a++) {
      const b = (a + 1) % 3,
        c = (a + 2) % 3,
        p = min.slice();
      for (const side of [min[a], max[a]]) {
        p[a] = side;
        for (let j = 0; j <= counts[b]; j++)
          for (let k = 0; k <= counts[c]; k++) {
            p[b] = min[b] + ((max[b] - min[b]) * j) / counts[b];
            p[c] = min[c] + ((max[c] - min[c]) * k) / counts[c];
            const distance = fn(...p);
            if (!Number.isFinite(distance) || distance <= 0)
              throw new Error(
                'The SDF must be positive at the sampling bounds. Enlarge the bounds or use a finite sculpt.'
              );
          }
      }
    }
    if (method !== 'tetrahedra') {
      const dual = G[method === 'auto' ? 'surfaceNets' : method](fn, { min, max }, { cell: resolution, maxCells });
      if (!dual.quads.length) throw new Error('No zero surface in the model bounds');
      if (method !== 'auto' || manifoldEdges(dual.quads))
        return { points: dual.points, faces: dual.quads, closed: true, ...options };
    }
    const mesh = G.implicitSurface(p => fn(...p), { min, max }, { resolution, maxCells });
    if (!mesh.positions.length) throw new Error('No zero surface in the model bounds');
    const indexed = G.toKitMesh(mesh, () => [0.45, 0.45, 0.45]);
    return fromMesh(indexed, { closed: true, ...options });
  }

  function fromSculpt(sculpt, { palette = PAL_HEX, bounds, resolution = 0.08, ...options } = {}) {
    sculpt.ready();
    const mesh = fromSdf(sculpt.sdf, { bounds: bounds ?? sculpt.modelBounds(resolution * 2), resolution, ...options }),
      shades = new Map();
    const materials = [];
    const partTags = mesh.points.map(p => sculpt.surfaceAt(...p).tag);
    const faceMaterials = mesh.faces.map(face => {
      const points = face.map(i => mesh.points[i]);
      const center = V.mul(
        points.reduce((sum, p) => V.add(sum, p), [0, 0, 0]),
        1 / face.length
      );
      const material = sculpt.surfaceAt(...center).material;
      const [x, y, z] = center;
      const ramp = material?.rf?.(x, y, z) || material?.r;
      const t = material?.em ? (material.v ?? 1) : Math.max(0, Math.min(1, 0.55 + (material?.mod?.(x, y, z) || 0)));
      const n = V.norm(V.cross(V.sub(points[1], points[0]), V.sub(points[2], points[0])));
      const sampled = material?.tex?.(x, y, z, n[1], t, n[0], n[2], null);
      const index = Number.isInteger(sampled)
        ? sampled
        : ramp?.[Math.min(ramp.length - 1, Math.floor(ramp.length * t))];
      const hex = palette[index] ?? 0xa8a8a8;
      const key = (material?.exportName || '') + '/' + hex;
      if (!shades.has(key)) {
        shades.set(key, materials.length);
        materials.push({ name: material?.exportName || '#' + hex.toString(16).padStart(6, '0'), color: rgb(hex) });
      }
      return shades.get(key);
    });
    return { ...mesh, faceMaterials, materials, partTags };
  }

  function fromMesh(mesh, options = {}) {
    const points = [],
      faces = [];
    for (let i = 0; i < mesh.pos.length; i += 3) points.push(Array.from(mesh.pos.slice(i, i + 3)));
    for (let i = 0; i < mesh.tri.length; i += 3) faces.push(Array.from(mesh.tri.slice(i, i + 3)));
    const colors = [];
    if (mesh.vcol) for (let i = 0; i < mesh.vcol.length; i += 3) colors.push(Array.from(mesh.vcol.slice(i, i + 3)));
    return {
      points,
      faces,
      ...(colors.length ? { colors } : {}),
      faceMaterials: Array.from(mesh.tmat),
      materials: mesh.mats.map(({ name, rgb }) => ({ name, color: rgb })),
      ...options
    };
  }

  function sampleClips(clips, sample) {
    return clips.map(({ name, duration, fps = 30, pose }) => {
      if (
        !Number.isFinite(duration) ||
        duration <= 0 ||
        !Number.isInteger(fps) ||
        fps < 1 ||
        fps > 240 ||
        duration * fps > 7200 ||
        typeof pose !== 'function'
      )
        throw new Error('Each model clip needs a duration, sample rate and pose function');
      const steps = Math.ceil(duration * fps);
      let last = 0;
      const frames = Array.from({ length: steps + 1 }, (_, i) => {
        const time = (duration * i) / steps;
        const matrices = sample(pose, time, time - last);
        last = time;
        return { time, matrices };
      });
      return { name, frames };
    });
  }

  /* Use the same cell influences and deformation matrices as the rendered puppet. */
  function fromPuppet(mesh, puppet, { clips = [], tags = {}, defaultPart } = {}) {
    const { partTags, ...geometry } = mesh;
    if (!partTags || partTags.length !== mesh.points.length)
      throw new Error('Puppet mesh export needs a tagged sculpt');
    const anchor = new Map(),
      cells = new Map(),
      joints = [];
    for (const name of puppet.order) {
      const part = puppet.parts[name];
      if (!part.ids.length || !part.skin.n) throw new Error('No splats were bound for puppet part ' + name);
      const parent = part.parent === null ? null : anchor.get(part.parent);
      const pivot = part.pivot,
        axis = part.axis;
      const length = Math.max(part.height / part.skin.n, 0.02);
      anchor.set(name, joints.length);
      joints.push({ name, parent, head: pivot, tail: V.mad(pivot, axis, length) });
      cells.set(
        name,
        part.skin.cells.map((point, index) => {
          const id = joints.length;
          joints.push({
            name: name + '.deform.' + (index + 1),
            parent: anchor.get(name),
            head: point,
            tail: V.mad(point, axis, length)
          });
          return id;
        })
      );
    }
    const weights = mesh.points.map((point, i) => {
      const tag = partTags[i],
        name = (Object.hasOwn(tags, tag) ? tags[tag] : tag) ?? defaultPart;
      if (!anchor.has(name)) throw new Error('Tag ' + String(tag) + ' does not map to a puppet part');
      const [a, b, w] = puppet.parts[name].skin.weightsAt(point),
        ids = cells.get(name);
      return w > 0
        ? [
            [ids[a], 1 - w],
            [ids[b], w]
          ]
        : [[ids[a], 1]];
    });
    const animations = sampleClips(clips, (pose, time, dt) => {
      puppet.time = time;
      puppet.clear();
      pose(time, dt, puppet);
      puppet.flush();
      return puppet.order.flatMap(name => {
        const part = puppet.parts[name];
        return [
          [...part.A, ...part.t],
          ...part.skin.cells.map((_, i) => {
            const k = 12 * (part.first + i);
            return Array.from(puppet.bones.slice(k, k + 12));
          })
        ];
      });
    });
    return { meshes: [{ ...geometry, weights }], joints, animations };
  }

  K.model = { fromSdf, fromSculpt, fromMesh, fromPuppet, sampleClips };
})(KIT);
