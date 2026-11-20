const parity = [
  { id: 'baseline', expected: { left: [128, 96, 64], right: [96, 128, 176], background: [16, 20, 33] } },
  { id: 'tetrahedral', look: 'tetrahedral', expected: { left: [96, 64, 128], right: [96, 176, 96] } },
  { id: 'trilinear', look: 'trilinear', expected: { left: [48, 64, 128], right: [48, 176, 96] } },
  { id: 'linear-legal-range', look: 'linear-legal-range', tolerance: 1,
    expected: { left: [92, 68, 44], right: [68, 92, 128] } },
  { id: 'scoped-palette', look: 'scoped', expected: { left: [18, 120, 68], right: [96, 128, 176] } },
  { id: 'spatial-mask', look: 'masked', tolerance: 1, expected: { left: [74, 108, 66] },
    gap: { control: 'baseline', sample: 'left', reason: 'WebGL skips scoped spatial masks' } },
  { id: 'glass-control', glass: true, tolerance: 1, expected: { left: [76, 152, 38] } },
  { id: 'coverage-compositing', look: 'glass', glass: true, tolerance: 1, expected: { left: [76, 57, 140] },
    gap: { control: 'glass-control', sample: 'left', reason: 'WebGL does not grade each overlapping splat contribution' } }
];

const profile = [
  { id: 'baseline' },
  { id: 'global-lut', look: 'tetrahedral' },
  { id: 'scoped-palette', look: 'scoped' }
];

const samples = { left: [41, 40], right: [79, 40], background: [0, 0] };

// The same builder runs in Node and in the browser. It depends only on the bundled toolkit.
function buildFixture({ makeBuilder }, fixture, splats) {
  const palette = [0x101421, 0x806040, 0x6080b0, 0x00ee00];
  // Include the ungraded composite color so the native palette can represent the glass control.
  if (fixture.glass) palette.push(0x4c9826);
  const builder = makeBuilder(7, palette);
  const normal = [0, 0, 1];
  function disc(x, y, z, radius, color, object, glass = false) {
    const start = builder.count();
    builder.disc(x, y, z, normal, radius, .035, builder.P[color], glass ? .4 : 3, glass ? { gl: true, nd: true } : undefined);
    builder.describeSplats(start, builder.count(), { object, material: glass ? 'glass' : 'clay' });
  }
  if (splats === undefined) {
    disc(-.8, 0, 0, .47, 1, 'left');
    disc(.8, 0, 0, .47, 2, 'right');
    if (fixture.glass) disc(-.8, 0, .32, .32, 3, 'pane', true);
  } else {
    const side = Math.ceil(Math.sqrt(splats)), spacing = 2.6 / side;
    for (let i = 0; i < splats; i++) {
      const column = i % side, left = column < side / 2;
      disc((column + .5) * spacing - 1.3, (Math.floor(i / side) + .5) * spacing - 1.3,
        0, spacing * .52, left ? 1 : 2, left ? 'left' : 'right');
    }
  }

  const look = fixture.glass ? { coverageAware: true } : {};
  const kind = fixture.look;
  if (['trilinear', 'tetrahedral', 'linear-legal-range'].includes(kind)) {
    const legal = { space: 'srgb-linear', range: [16, 235] };
    const managed = kind === 'linear-legal-range';
    const data = Array.from({ length: 8 }, (_, i) => {
      const r = i & 1, g = (i >> 1) & 1, b = (i >> 2) & 1;
      // A cross-channel product differs between the two interpolants even on a two-point grid.
      return managed ? [r, g, b].map(x => 16 + x * 109.5) : [r * g, b, r];
    }).flat();
    look.colorLut = { size: 2, data, ...(managed ? {
      domainMin: [16, 16, 16], domainMax: [235, 235, 235], domainPolicy: 'error',
      color: { input: legal, output: legal }
    } : { interpolation: kind }) };
  }
  if (kind === 'scoped' || kind === 'masked' || kind === 'glass') {
    const mask = { type: 'axis', axis: 'y', space: 'world', range: [-1, 1], interpolation: 'linear' };
    look.paletteConstraints = { targets: [{
      select: { object: kind === 'glass' ? 'pane' : 'left', material: kind === 'glass' ? 'glass' : 'clay' },
      palette: [kind === 'glass' ? '#0000ff' : '#127844'],
      ...(kind === 'masked' && { mask })
    }] };
  }

  return builder.finish({ cam: { target: [0, 0, 0], dist: 5, yaw: 0, pitch: 0 }, look, refract: 0, dither: 0 });
}

module.exports = { parity, profile, samples, buildFixture };
