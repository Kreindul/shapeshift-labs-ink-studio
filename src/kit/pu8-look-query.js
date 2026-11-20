/* Query the same palette plan used by the renderers without rendering a viewport. */
(function (K) {
  const W = K.world, { check } = W.data;
  const rgb = packed => [packed >> 16, packed >> 8 & 255, packed & 255].map(n => n / 255);
  W.lookQuery = function (visual) {
    let world, index, media, plan;
    const blueNoise = K.procedural.materials.blueNoise, surfacePalettes = new Map();
    function setup() {
      if (world) return;
      world = visual();
      index = TargetSelectors.index(world);
      media = TargetSelectors.media(world);
    }
    function groups(selector) {
      setup();
      return index.groups(selector).concat(media.filter(row => !selector || TargetSelectors.matches(selector, row))
        .map(target => ({ target, count: 1 })));
    }
    function select(spec) {
      const selector = spec === undefined ? undefined : TargetSelectors.prepare(spec);
      return K.procedural.data.freeze(groups(selector).map(({ target, count }) => ({ ...target, count })));
    }
    function output(spec, args = {}) {
      const selector = spec === undefined ? undefined : TargetSelectors.prepare(spec);
      const { rgb: input, pixel = [0, 0], limit = 256 } = args;
      check(input === undefined || Array.isArray(input) && input.length === 3 && input.every(n => Number.isFinite(n) && n >= 0 && n <= 1),
        'A look sample needs normalized RGB');
      check(Array.isArray(pixel) && pixel.length === 2 && pixel.every(Number.isSafeInteger) &&
        Number.isSafeInteger(limit) && limit >= 1 && limit <= 4096, 'Expected an integer art pixel and a bounded result limit');
      const selected = groups(selector);
      if (!selected.length) return W.query.missing('no render target matches the selector','missing');
      const options = { palette: world.pal, roles: world.paletteRoles, blueNoise };
      plan ??= PixelLook.preparePaletteConstraints(world.look?.paletteConstraints, options) ?? false;
      const { paletteRemap, colorCurves, colorLut, colorStack, tone } = world.look ?? {};
      const tonePlan = PixelLook.prepareTone(tone, blueNoise);
      const scene = Array.from(world.pal, rgb), grade = !tonePlan &&
        (PixelLook.colorGrade(world.pal, world.paletteRoles, world.anim?.grade, paletteRemap, colorCurves, colorLut, colorStack) ||
        world.anim?.grade);
      const palette = tonePlan?.palette ?? (grade ? PixelLook.gradePalette(grade) : world.pal);
      const rows = selected.slice(0, limit).map(({ target, count, first }) => {
        const id = plan && plan.match(target), rule = id && plan.rules.find(rule => rule.slot === id);
        const binding = first === undefined ? undefined : world.surfaceData?.[first * SurfaceLook.STRIDE];
        const surface = world.surfaces?.[binding - 1]?.settings;
        if (surface?.paletteConstraint && !surfacePalettes.has(binding))
          surfacePalettes.set(binding, PixelLook.preparePalette(surface.paletteConstraint, options));
        const policy = id ? plan.palettes[id - 1] : target.kind === 'splat' &&
          (surfacePalettes.get(binding) || (plan && plan.palettes[plan.defaultSlot - 1]));
        const rowPalette = policy ? policy.packed : target.kind === 'splat' ? palette : null;
        const packed = input && rowPalette && (policy ? rowPalette[PixelLook.paletteIndex(policy, input, ...pixel, {
          scene, grade, useDither: target.kind === 'splat'
        })] : rowPalette[tonePlan ? PixelLook.toneIndex(tonePlan, ...input, ...pixel) : PixelLook.nearest(input, scene, false)]);
        return { target, count, asset: id ? policy.assetId ?? null : surface?.lookAssetId ?? null, rule: rule?.select ?? null,
          palette: rowPalette && Array.from(rowPalette), ...(input && { rgb: packed == null ? input.slice() : rgb(packed) }) };
      });
      return W.query.ok({ matched: selected.length, targets: rows });
    }
    return { select, output };
  };
})(KIT);
