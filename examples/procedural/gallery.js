(function (K) {
  const P = K.procedural;
  const colors = {
    basalt: [85, 110, 106],
    glaze: [45, 136, 123],
    coral: [228, 123, 95],
    ochre: [219, 178, 96],
    cream: [226, 220, 180]
  };
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const box = (center, half, material) => P.pieces.box(center, half, identity, { material }).mesh;
  const tube = (a, b, radius, material) => P.pieces.tube(a, b, radius, { material }, 6).mesh;

  function courses() {
    const layout = P.fittedCourses({ width: 4.8, height: 1.9, unit: [0.8, 0.4], joint: 0.05, stagger: 0.5 });
    return layout.cells.map(({ row, inset }) => {
      const [x, y] = inset.min;
      const [right, top] = inset.max;
      return box(
        [(x + right) / 2, (y + top) / 2, 0],
        [(right - x) / 2, (top - y) / 2, 0.18],
        row % 2 ? 'glaze' : 'basalt'
      );
    });
  }

  function cells() {
    const field = (x, z) => Math.max(Math.hypot(x, z) - 2.2, 0.75 - Math.hypot(x, z));
    const layout = P.planarCells.layout({ min: [-2.2, 0, -2.2], max: [2.2, 0, 2.2] }, field, { size: 0.72, seed: 8 });
    return layout.cells.map((cell, index) =>
      P.planarCells.prism(cell, { bottom: -0.2, top: 0.08, material: index % 3 ? 'glaze' : 'cream' }).mesh()
    );
  }

  function skirt() {
    const ground = {
      height: (x, z) => 0.23 * x + 0.17 * z,
      slopeBound: 0.29,
      bounds: { min: [-2, -0.8, -1.3], max: [2, 0.8, 1.3] }
    };
    const outline = [
      [-2, 1, -1.15],
      [2, 1, -1.15],
      [2, 1, 1.15],
      [-2, 1, 1.15]
    ];
    const support = P.supportSkirt({ ground, outline, overlap: 0 });
    const mesh = support.mesh({ material: 'basalt', surface: 'support' });
    // The platform covers this cap. Omit it from the gallery's painter pass.
    const sides = { ...mesh, groups: mesh.groups.filter(group => group.surface !== 'support-top') };
    return [sides, box([0, 1.23, 0], [2.1, 0.23, 1.25], 'ochre')];
  }

  function span() {
    const sockets = [
      { id: 'a', point: [-2.5, 2, 0], group: 'cable' },
      { id: 'b', point: [2.5, 2.8, 0], group: 'cable' }
    ];
    const edges = P.proximity.connect(sockets);
    const out = sockets.map(({ point: [x, y, z] }) => box([x, y / 2, z], [0.17, y / 2, 0.17], 'basalt'));
    for (const edge of edges) {
      const [a, b] = [edge.a, edge.b].map(id => sockets.find(socket => socket.id === id).point);
      const catenary = P.spans.catenary(a, b, { sag: 0.9 });
      for (let i = 0; i < 24; i++) {
        const { point } = catenary.sample(i / 24);
        const next = catenary.sample((i + 1) / 24).point;
        out.push(tube(point, next, 0.045, 'ochre'));
        if (i % 3 === 2) out.push(box(K.V.sub(point, [0, 0.16, 0]), [0.08, 0.15, 0.045], 'coral'));
      }
    }
    return out;
  }

  function clipped() {
    const a = box([0, 0, 0], [1.1, 1.1, 1.1], 'glaze');
    return [P.geometry.clipConvex(a, [{ normal: [0.8, 0.45, 1], offset: 0.45 }], { material: 'coral' })];
  }

  function population() {
    const region = { min: [-2, 0, -2], max: [2, 0, 2] };
    const result = P.populations.layout(
      [region],
      (x, z) => ({
        density: Math.min(0.9, Math.max(0, (2.3 - Math.hypot(x, z)) * 0.4))
      }),
      { spacing: 0.55, slots: 3, seed: 11 }
    );
    return [
      box([0, -0.1, 0], [2.15, 0.1, 2.15], 'basalt'),
      ...result.instances.map(({ point: [x, z], scale, rank }) =>
        tube([x, 0, z], [x, scale * (0.25 + rank), z], 0.075, rank < 0.25 ? 'ochre' : 'coral')
      )
    ];
  }

  const examples = [
    ['Fitted courses', 'Staggered units fit the domain and preserve physical joints.', courses],
    ['Masked cells', 'Clipped prisms follow an annular mask with real gaps.', cells],
    ['Gravity support', 'A convex carrier meets the supplied sloping ground.', skirt],
    ['Flexible span', 'Matched sockets carry an arc-length sampled cable.', span],
    ['Convex clipping', 'A closed cap carries its own material role.', clipped],
    ['Stable population', 'World space ranks give each candidate a stable identity.', population]
  ];

  function triangles(meshes) {
    return meshes.flatMap(mesh =>
      mesh.groups.flatMap(group => {
        const output = [];
        for (let i = group.start; i < group.start + group.count; i += 3) {
          const points = [0, 1, 2].map(j => mesh.positions.slice((i + j) * 3, (i + j + 1) * 3));
          const normal = mesh.normals.slice(i * 3, i * 3 + 3);
          output.push({ points, normal, color: colors[group.material] || colors.basalt });
        }
        return output;
      })
    );
  }

  const panels = examples.map(([name, description, build]) => {
    const article = document.createElement('article');
    const canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 360;
    canvas.setAttribute('aria-label', name + ' geometry');
    const text = document.createElement('div');
    const heading = document.createElement('h2');
    heading.textContent = name;
    const copy = document.createElement('p');
    copy.textContent = description;
    text.append(heading, copy);
    article.append(canvas, text);
    document.getElementById('gallery').append(article);
    return { canvas, faces: triangles(build()) };
  });

  function draw(yaw) {
    const V = K.V;
    const view = V.norm([Math.sin(yaw), 0.72, Math.cos(yaw)]);
    const right = V.norm(V.cross([0, 1, 0], view));
    const up = V.cross(view, right),
      sun = V.norm([-0.45, 0.8, 0.35]);
    for (const { canvas, faces } of panels) {
      const ctx = canvas.getContext('2d');
      const projected = faces.map(face => ({
        ...face,
        points: face.points.map(p => [V.dot(p, right), -V.dot(p, up), V.dot(p, view)])
      }));
      const points = projected.flatMap(face => face.points);
      const min = [0, 1].map(k => Math.min(...points.map(p => p[k])));
      const max = [0, 1].map(k => Math.max(...points.map(p => p[k])));
      const scale = Math.min(570 / (max[0] - min[0]), 270 / (max[1] - min[1]));
      const center = min.map((v, k) => (v + max[k]) / 2);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const depth = face => face.points.reduce((sum, p) => sum + p[2], 0);
      for (const face of projected.sort((a, b) => depth(a) - depth(b))) {
        if (V.dot(face.normal, view) < 0) continue;
        const light = 0.63 + 0.37 * Math.max(0, V.dot(face.normal, sun));
        const color = 'rgb(' + face.color.map(x => Math.round(x * light)).join(',') + ')';
        ctx.beginPath();
        for (const [x, y] of face.points)
          ctx.lineTo(canvas.width / 2 + (x - center[0]) * scale, canvas.height / 2 + (y - center[1]) * scale);
        ctx.closePath();
        ctx.fillStyle = ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.fill();
        ctx.stroke();
      }
    }
  }
  const slider = document.getElementById('yaw');
  const update = () => draw((Number(slider.value) * Math.PI) / 180);
  slider.addEventListener('input', update);
  update();
})(KIT);
