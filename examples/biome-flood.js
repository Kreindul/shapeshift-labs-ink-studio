/* A headless highland lake above a reservoir and two passages at different elevations. */
module.exports = function floodValley(K, { surfaceScatter = 0.24 } = {}) {
  const { biomeRecipes, biomeWorld, sparseBricks, spanFlood, waterBodies } = K.procedural;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function cave(min, max, round = 0.24) {
    const half = max.map((v, i) => (v - min[i]) * 0.5), center = min.map((v, i) => v + half[i]);
    return { bounds: { min: min.map(v => v - 1.25), max: max.map(v => v + 1.25) }, sdf(x, y, z) {
      const q = [x, y, z].map((v, i) => Math.abs(v - center[i]) - half[i] + round);
      return Math.hypot(...q.map(v => Math.max(0, v))) + Math.min(0, Math.max(...q)) - round;
    } };
  }
  function ramp(left, right) {
    const shell = cave([left, -5.04, 1.32], [right, -0.65, 4.8]);
    return { bounds: shell.bounds, sdf(x, y, z) {
      const floor = clamp(-5.03 + (z - 1.98) * 1.03, -5.03, -2.58);
      return Math.max(shell.sdf(x, y, z), (floor - y) / Math.hypot(1, 1.03));
    } };
  }
  function height(x, z) {
    const basin = 1.55 * Math.exp(-0.085 * x * x - 0.105 * z * z);
    return 2.65 + 0.23 * Math.sin(x * 0.31) + 0.20 * Math.cos(z * 0.37) +
      0.11 * Math.sin((x + z) * 0.83) + 0.05 * Math.cos(x * 1.85 - z * 1.27) - basin;
  }
  const caves = [
    cave([-3.8, -5.4, 0.2], [-0.59, -1.38, 2.45], 0.38),
    cave([0.57, -5.12, 0.22], [7.62, -1.16, 2.16], 0.35),
    ramp(0.77, 2.78), ramp(5.11, 7.51),
    cave([0.94, -2.61, 3.73], [7.71, -0.49, 5.78], 0.20),
    cave([7.19, -2.62, 4.04], [10.56, -0.76, 6.38], 0.23)
  ];
  const author = biomeRecipes.create({ seed: 492, fallback: 'upland',
    conditions(x, y, z) { return { moisture: 1 - clamp(Math.hypot(x, z) / 8, 0, 1), light: y < 0 ? 0.15 : 1 }; },
    regions: [
      { id: 'shore', biome: 'shore', bounds: { min: [-4.6, 1.2, -4.3], max: [4.6, 2.5, 4.3] },
        weight: 0.84 },
      { id: 'cavern', biome: 'cavern', bounds: { min: [-5.1, -6.2, -0.75], max: [11.8, 0.25, 7.8] } }
    ],
    recipes: [
      { id: 'upland', materials: { meadow: [0x263e43, 0x47605c, 0x738366, 0xa2ab75, 0xc6b987] },
        populations: [{ id: 'pine', density: 0.55, habitat: { media: ['air'], ranges: { elevation: { min: 2.2 } } } }] },
      { id: 'shore', materials: { gravel: [0x464137, 0x72634f, 0xa19064, 0xc9b583, 0xd9ca9e] },
        populations: [{ id: 'rush', density: 0.8, habitat: { media: ['air'], ranges: { elevation: { min: 1.8, max: 2.35 } } } }] },
      { id: 'cavern', materials: { slate: [0x242539, 0x474356, 0x726075, 0xa2837f, 0xc59d85],
        iron: [0x362b42, 0x604159, 0x89586b, 0xae7776, 0xcf987f] },
        strata: { fallback: 'slate', layers: [{ min: -7.75, max: -6.9, material: 'iron' }] },
        populations: [{ id: 'cave-growth', density: 0.68, habitat: { media: ['air'] } },
          { id: 'water-grass', density: 0.55, habitat: { media: ['water'] } }] }
    ]
  });
  const view = author.view();
  const compiler = biomeWorld.create({
    height, caves, surfaceScatter, cell: 0.25, chunkCells: 16, verticalCells: [-27, 24], terrainSlope: 0.68,
    palette: [0x151e2d, 0x45596a, 0x60837b, 0x9db078, 0xd9c693, 0xe1c09a],
    materialRamps: { 'cut-stone': [0x3a2b43, 0x5e4055, 0x99696b, 0xc58775] },
    layers: [
      { id: 'surface', options: { spacing: 1.13, slots: 2, exclusion: { distance: 0.67 } }, habitatOffset: 0.12 },
      { id: 'lower', options: { spacing: 0.68, slots: 2, exclusion: { distance: 0.36 } }, habitatOffset: 0.42,
        height: (x, z, frame) => frame.supports(x, z, -5.48, -4.32)[0]?.y ?? null }
    ],
    emit(B, item) {
      const [x, y, z] = item.point, s = item.scale;
      if (item.species === 'pine') {
        B.disc(x, y + s * 0.23, z, [1, 0, 0], 0.18 * s, 0.075 * s, [105, 83, 62], 1);
        for (let i = 0; i < 5; i++) {
          const width = (0.42 - i * 0.073) * s;
          B.disc(x + Math.sin(i * 2) * 0.05 * s, y + (0.38 + i * 0.19) * s, z,
            [0, 1, 0.13], width, width * 0.62, [48 + i * 6, 81 + i * 8, 77 + i * 4], 1);
        }
      } else if (item.species === 'rush' || item.species === 'water-grass') {
        const tint = item.species === 'rush' ? [154, 154, 88] : [44, 126, 113];
        for (let i = 0; i < 4; i++) {
          B.disc(x + (i - 1.5) * 0.057 * s, y + (0.13 + i * 0.046) * s, z,
            [0.15, 0, 1], (0.075 + i * 0.015) * s, 0.033 * s, tint, 1);
        }
      } else {
        const tint = [152, 98 + Math.round(item.yaw * 2), 129];
        B.iso(x, y + 0.058 * s, z, 0.11 * s, tint, 1);
        B.iso(x + 0.06 * s, y + 0.12 * s, z, 0.07 * s, [190, 151, 162], 1);
      }
    }
  });
  const indices = Array.from({ length: 48 }, (_, i) => [i % 8 - 3, Math.floor(i / 8) - 3]);
  const tiles = indices.map(([x, z]) => ({ id: x + '/' + z, resolution: [8, 8],
    bounds: { min: [x * 4, -6.75, z * 4], max: [x * 4 + 4, 6, z * 4 + 4] } }));
  const sources = [
    { id: 'lake', point: [0.25, 1.7, 0.25], level: 1.87, current: [0.07, 0, -0.12] },
    { id: 'reservoir', point: [-2.25, -4.62, 1.25], level: -3.25, current: [0.23, 0, 0] }
  ];
  const optics = { tint: [0.045, 0.32, 0.39], extinction: [0.86, 0.34, 0.19],
    surfaceColor: [0.24, 0.70, 0.78], surface: 0.31, foam: 0.28, refraction: 0.78, caustics: 0.16 };
  const base = compiler.prepare(view);
  const empty = sparseBricks.create({ cell: 0.25, brickSize: 4, base: base.distance });
  const cut = cave([-1.29, -5.12, 0.68], [1.25, -3.59, 1.94], 0.23);
  const brush = () => empty.edit({ operation: 'subtract', smooth: 0.12, material: 'cut-stone', sdf: cut.sdf,
    bounds: { min: [-1.75, -5.6, 0.36], max: [1.7, -3.2, 2.24] } });
  const agent = { radius: 0.13, height: 0.47, stepUp: 0.61, maxDrop: 0.78, swimStep: 0.48,
    origin: [0, 0], maxChecks: 12000000 };

  async function build(bricks = empty, { previous, clock } = {}) {
    const timings = {};
    async function stage(name, run) {
      const t = clock?.();
      const result = await run();
      if (clock) timings[name] = clock() - t;
      return result;
    }
    const dirtyBounds = previous ? bricks.changesFrom(previous.bricks) : undefined;
    const edited = compiler.prepare(view, { bricks });
    const spans = await stage('spans', () => edited.bakeSpanTiles({ tiles, step: 0.22,
      previous: previous?.spans, dirtyBounds }));
    const flood = await stage('fill', () => spanFlood.create({ tiles: spans.tiles, sources,
      previous: previous?.flood, origin: agent.origin }));
    const water = await stage('water', () => waterBodies.sceneFromSpans(flood.tiles, { optics, previous: previous?.water }));
    const frame = compiler.prepare(view, { bricks, water });
    const graph = await stage('graph', () => frame.traversalGraph({ ...agent, tiles: flood.tiles,
      previous: previous?.graph, dirtyBounds }));
    const patch = await stage('chunks', () => compiler.update(frame, indices));
    const chunks = compiler.chunks();
    const world = await stage('assembly', () => compiler.makeWorld(frame, chunks, { radius: 26 }));
    return { bricks, spans, flood, water, frame, graph, chunks, patch, world, timings };
  }

  const keys = {
    lake: [0.25, 1.65, 0.25], reservoir: [-2.25, -4.35, 1.25],
    floodedHall: [3.25, -4.5, 1.25], upperRoute: [4.25, -2.12, 4.75],
    dryChamber: [8.75, -2.0, 4.75],
    routeStart: [1.25, -2.16, 4.25], routeEnd: [6.75, -2.16, 4.25]
  };
  return { build, brush, empty, keys, indices };
};
