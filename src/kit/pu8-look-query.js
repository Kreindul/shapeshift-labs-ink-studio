/* Query the same palette plan used by the renderers without rendering a viewport. */
(function (K) {
  const W = K.world, { check } = W.data;
  const rgb = packed => [packed >> 16, packed >> 8 & 255, packed & 255].map(n => n / 255);
  W.lookQuery = function (visual, time = 0) {
    let world, index, media, plan, stages;
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
      const { rgb: input, at, rest, base, stage, pixel = [0, 0], limit = 256 } = args;
      if (stage !== undefined) RenderStages.stage(stage);
      check(input === undefined || Array.isArray(input) && input.length === 3 && input.every(n => Number.isFinite(n) && n >= 0 && n <= 1),
        'A look sample needs normalized RGB');
      check((at === undefined || W.data.vector(at)) && (rest === undefined || W.data.vector(rest)),
        'A look mask sample needs a finite world point or rest point');
      check(base === undefined || W.data.vector(base) && base.every(n => n >= 0 && n <= 1), 'A look sample base needs normalized RGB');
      check(Array.isArray(pixel) && pixel.length === 2 && pixel.every(Number.isSafeInteger) &&
        Number.isSafeInteger(limit) && limit >= 1 && limit <= 4096, 'Expected an integer art pixel and a bounded result limit');
      const selected = groups(selector);
      if (!selected.length) return W.query.missing('no render target matches the selector','missing');
      stages ??= RenderStages.plan(world, { blueNoise }) ?? false;
      if (stages) {
        const sample = at || rest ? { position: rest, worldPosition: at, time } : null;
        const rows = selected.slice(0, limit).map(({ target, count, first }) => {
          const rules = first === undefined ? {} : stages.at(first);
          const evaluated = stage && input ? RenderStages.trace(rules[stage], input, sample, pixel) : null;
          const stagesForTarget = Object.fromEntries(RenderStages.names.filter(name => rules[name]).map(name =>
            [name, evaluated && stage === name ? evaluated.contributions : rules[name].map(rule => RenderStages.describe(rule, sample))]));
          return { target, count, stages: stagesForTarget, ...(evaluated && { rgb: evaluated.rgb }) };
        });
        return W.query.ok({ matched: selected.length, targets: rows });
      }
      const options = { palette: world.pal, roles: world.paletteRoles, blueNoise, context: world.surfaceEffects };
      plan ??= PixelLook.preparePaletteConstraints(world.look?.paletteConstraints, options) ?? false;
      const { paletteRemap, colorCurves, colorLut, colorStack, tone } = world.look ?? {};
      const coverageAware = world.look?.coverageAware === true;
      const tonePlan = coverageAware ? null : PixelLook.prepareTone(tone, blueNoise);
      const scene = Array.from(world.pal, rgb), grade = !tonePlan &&
        (PixelLook.colorGrade(world.pal, world.paletteRoles, world.anim?.grade, paletteRemap, colorCurves, colorLut, colorStack) ||
        world.anim?.grade);
      const palette = tonePlan?.palette ?? (grade ? PixelLook.gradePalette(grade) : world.pal);
      const rows = selected.slice(0, limit).map(({ target, count, first }) => {
        const id = plan && plan.match(target), rule = id && plan.rules.find(rule => rule.slot === id);
        const binding = first === undefined ? undefined : world.surfaceData?.[first * SurfaceLook.STRIDE];
        const surface = world.surfaces?.[binding - 1]?.settings;
        if (surface?.paletteConstraint && !surfacePalettes.has(binding))
          surfacePalettes.set(binding, PixelLook.prepareLookPolicy(surface.paletteConstraint, options));
        const policy = id ? plan.palettes[id - 1] : target.kind === 'splat' &&
          (surfacePalettes.get(binding) || (plan && plan.palettes[plan.defaultSlot - 1]));
        const rowPalette = policy ? policy.packed : !coverageAware && target.kind === 'splat' ? palette : null;
        const packed = input && rowPalette && (policy ? rowPalette[PixelLook.paletteIndex(policy, input, ...pixel, {
          scene, grade, useDither: target.kind === 'splat'
        })] : rowPalette[tonePlan ? PixelLook.toneIndex(tonePlan, ...input, ...pixel) : PixelLook.nearest(input, scene, false)]);
        let sampled = input && (packed == null ? input.slice() : rgb(packed));
        const spatial = policy?.mask;
        const amount = spatial && (at || rest) ? spatial({ position: rest, worldPosition: at, time }) : null;
        if (sampled && spatial && (coverageAware || amount !== null)) {
          const underlying = surfacePalettes.get(binding), defaultPolicy = plan && plan.palettes[plan.defaultSlot - 1];
          const fallback = underlying && !underlying.mask ? underlying : defaultPolicy;
          const dry = base ?? (fallback && !fallback.mask ? rgb(fallback.packed[PixelLook.paletteIndex(fallback, input, ...pixel,
            { scene, grade })]) : coverageAware ? input :
            rgb(palette[tonePlan ? PixelLook.toneIndex(tonePlan, ...input, ...pixel) : PixelLook.nearest(input, scene, false)]));
          const weight = amount ?? 0;
          sampled = sampled.map((color, i) => dry[i] * (1 - weight) + color * weight);
        }
        return { target, count, asset: policy?.assetId ?? (id ? null : surface?.lookAssetId ?? null), rule: rule?.select ?? null,
          palette: rowPalette && Array.from(rowPalette), ...(spatial && { maskWeight: amount }), ...(sampled && { rgb: sampled }) };
      });
      return W.query.ok({ matched: selected.length, targets: rows });
    }
    return { select, output };
  };
})(KIT);
