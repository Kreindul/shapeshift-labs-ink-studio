/* Color operations ordered by their place in the render pipeline. */
const RenderStages = (() => {
  let stacks, space, pixels, targets, effects;
  try {
    stacks = ColorStack;
    space = ColorSpace;
    pixels = PixelLook;
    targets = TargetSelectors;
    effects = SplatEffects;
  } catch {
    stacks = require('./color-stack.js');
    space = require('./color-space.js');
    pixels = require('./pixel-look.js');
    targets = require('./target-selectors.js');
    effects = require('./splat-effects.js');
  }
  const names = Object.freeze(['material', 'lit', 'frame', 'palette']);
  const linear = space.prepare('srgb', 'srgb-linear'), encode = space.prepare('srgb-linear', 'srgb');
  const unpack = n => [n >> 16, n >> 8 & 255, n & 255].map(value => value / 255);
  const luma = rgb => .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
  const byte = n => Math.round(Math.max(0, Math.min(1, n)) * 255);
  const pack = rgb => byte(rgb[0]) * 65536 + byte(rgb[1]) * 256 + byte(rgb[2]);

  function stage(value) {
    if (!names.includes(value)) throw new RangeError('Render stage must be material, lit, frame or palette');
    return value;
  }

  function blend({ order = 0, weight = 1 } = {}) {
    if (!Number.isSafeInteger(order)) throw new TypeError('Look order must be a safe integer');
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw new RangeError('Look weight must be in [0, 1]');
    return { order, weight };
  }

  function albedo(value, palette) {
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return parseInt(value.slice(1), 16);
    if (Array.isArray(value) && value.length === 3 && Array.from(value).every(n => Number.isFinite(n) && n >= 0 && n <= 1))
      return pack(value);
    if (Number.isSafeInteger(value) && value >= 0 && Number.isSafeInteger(palette?.[value])) return palette[value];
    throw new TypeError('Material albedo must be a palette index, #rrggbb or normalized RGB triple');
  }

  function prepare(entries, options = {}) {
    if (entries === undefined || entries === false) return [];
    if (!Array.isArray(entries) || entries.length > 64) throw new TypeError('Expected up to 64 render stage rules');
    return Array.from(entries, (entry, i) => {
      if (!entry || Object.getPrototypeOf(entry) !== Object.prototype ||
          Object.keys(entry).some(key => !['stage', 'stack', 'palette', 'select', 'mask', 'assetId', 'order', 'weight'].includes(key)))
        throw new TypeError('Invalid render stage rule at index ' + i);
      const name = stage(entry.stage), isPalette = name === 'palette';
      if (isPalette ? !entry.palette || entry.stack !== undefined : !entry.stack || entry.palette !== undefined)
        throw new TypeError('The ' + name + ' stage needs ' + (isPalette ? 'a palette policy' : 'a color stack'));
      if (!isPalette && Object.getPrototypeOf(entry.stack) !== Object.prototype)
        throw new TypeError('A render stage color stack must be an object');
      if (Array.isArray(entry.stack?.steps) && entry.stack.steps.some(step => step?.type === 'paletteRemap'))
        throw new TypeError('Render stage stacks operate on RGB and require RGB color transforms');
      if (isPalette && entry.palette.source !== undefined)
        throw new TypeError('The palette stage samples the resolved frame');
      const { order, weight } = blend(entry);
      const { amount: stackAmount = 1 } = entry.stack ?? {};
      if (!Number.isFinite(stackAmount) || stackAmount < 0 || stackAmount > 1)
        throw new RangeError('Color stack amount must be in [0, 1]');
      const mask = effects.prepareMask(entry.mask, options.context, { validateOnly: options.validateOnly || options.skipMasks });
      return {
        name, order, weight, stackAmount, mask, disabled: Boolean(options.skipMasks && mask),
        select: entry.select === undefined ? null : targets.prepare(entry.select),
        assetId: entry.assetId,
        stack: isPalette ? null : stacks.prepare({ ...entry.stack, amount: 1 }, {
          resolveColor: value => unpack(albedo(value, options.palette))
        }),
        palette: isPalette ? pixels.preparePalette(entry.palette, options) : null
      };
    });
  }

  function plan(world, options = {}) {
    const entries = world.look?.renderStages;
    if ((entries === undefined || entries === false || Array.isArray(entries) && !entries.length) &&
        !world.surfaces?.some(({ settings }) => settings.renderStages !== undefined && settings.renderStages !== false)) return null;
    const context = { palette: world.pal, roles: world.paletteRoles, context: world.surfaceEffects, ...options };
    const scene = prepare(entries, context);
    const surfaces = world.surfaces?.map(({ settings }) => prepare(settings.renderStages, context)) ?? [];
    const rules = [...scene, ...surfaces.flat()];
    if (!rules.length) return null;
    const all = rules.filter(rule => !rule.disabled);
    const lookup = all.some(rule => rule.select) ? targets.index(world) : null;
    const cache = new Map();
    const group = (rules, target) => {
      const slots = {};
      for (const rule of rules) {
        if (rule.disabled || rule.select && (!target || !targets.matches(rule.select, target))) continue;
        (slots[rule.name] ??= []).push(rule);
      }
      for (const list of Object.values(slots)) list.sort((a, b) => a.order - b.order);
      return slots;
    };
    const global = group(scene);
    function at(i) {
      if (i < 0) return global;
      if (!lookup && !surfaces.length) return global;
      const surface = surfaces[(world.surfaceData?.[i * 8] || 0) - 1];
      const target = lookup?.row(i);
      const key = surface ?? null;
      if (!cache.has(key)) cache.set(key, new Map());
      const rows = cache.get(key);
      if (!rows.has(target)) rows.set(target, surface?.length ? group([...scene, ...surface], target) : group(scene, target));
      return rows.get(target);
    }
    const post = rule => !rule.disabled && (rule.name === 'frame' || rule.name === 'palette');
    const postMask = all.some(rule => post(rule) && rule.mask);
    const owner = postMask || scene.some(rule => post(rule) && rule.select) || surfaces.some(rules => rules.some(post));
    return {
      at, post: all.some(post), postMask, owner,
      palettes: [...new Set(all.flatMap(rule => rule.palette?.packed ?? []))],
      surfaceMask: all.some(rule => !post(rule) && rule.mask)
    };
  }

  const coverage = (rule, sample) => rule.mask ? sample ? rule.mask(sample) : null : 1;

  function describe(rule, sample, maskWeight = coverage(rule, sample)) {
    return {
      asset: rule.assetId ?? null, select: rule.select, order: rule.order, weight: rule.weight,
      ...(rule.stack && { stack: rule.stack.name, stackAmount: rule.stackAmount }),
      ...(rule.mask && { maskWeight }),
      effectiveWeight: maskWeight === null ? null : rule.weight * rule.stackAmount * maskWeight,
      ...(rule.palette && { palette: rule.palette.packed })
    };
  }

  function evaluate(rules, rgb, sample, x, y, contributions) {
    if (!rules) return rgb;
    let result = rgb;
    for (const rule of rules) {
      const maskWeight = coverage(rule, sample);
      const amount = rule.weight * rule.stackAmount * (maskWeight ?? 0);
      const input = result;
      const applied = rule.palette ? amount >= .5 : amount > 0;
      let transformed;
      if (applied && rule.palette) {
        transformed = result = rule.palette.swatches[rule.palette.index(input, x, y)];
      } else if (applied) {
        transformed = rule.stack.sample(input);
        result = amount === 1 ? transformed : transformed.map((n, i) => input[i] + (n - input[i]) * amount);
      }
      if (contributions) contributions.push({
        ...describe(rule, sample, maskWeight), applied, input, ...(transformed && { transformed }), output: result
      });
    }
    return result;
  }

  function apply(rules, rgb, sample) {
    return evaluate(rules, rgb, sample, 0, 0);
  }

  function trace(rules, rgb, sample, [x, y] = [0, 0]) {
    const contributions = [];
    const output = evaluate(rules, rgb, sample, x, y, contributions);
    return { rgb: output, contributions };
  }

  function material(rules, shaded, reference, sample) {
    if (!rules || reference === undefined) return apply(rules, shaded, sample);
    const base = unpack(reference), painted = apply(rules, base, sample);
    if (painted.every((value, i) => value === base[i])) return shaded;
    const unlit = linear(base), lit = linear(shaded), changed = linear(painted);
    const baseLuma = luma(unlit);
    const fallback = baseLuma > 0 ? Math.min(1, luma(lit) / baseLuma) : 1;
    for (let i = 0; i < 3; i++) {
      // The bake stores a selected ramp swatch. Recover its attenuation and any additive highlight.
      const gain = unlit[i] > 0 ? Math.min(1, lit[i] / unlit[i]) : fallback;
      changed[i] = changed[i] * gain + Math.max(0, lit[i] - unlit[i]);
    }
    return encode(changed, changed);
  }

  function quantize(rules, rgb, x, y, sample) {
    return evaluate(rules, rgb, sample, x, y);
  }

  function finish(frame, plan, passes, time) {
    const { w, h, rgb } = frame;
    const swatches = new Map(plan.palettes.map((color, i) => [color, i]));
    const use = new Uint32Array(swatches.size);
    for (let p = 0; p < w * h; p++) {
      const owner = (passes?.splatId?.[p] || 0) - 1;
      const rules = plan.at(owner);
      const offset = p * 3;
      if (!rules.frame && !rules.palette) {
        const index = swatches.get(rgb[offset] * 65536 + rgb[offset + 1] * 256 + rgb[offset + 2]);
        if (index !== undefined) use[index]++;
        continue;
      }
      const sample = plan.postMask && owner >= 0 ? {
        position: Array.from(passes.objectPosition.subarray(offset, offset + 3)),
        worldPosition: Array.from(passes.position.subarray(offset, offset + 3)),
        normal: Array.from(passes.normal.subarray(offset, offset + 3)), time
      } : null;
      const original = [rgb[offset] / 255, rgb[offset + 1] / 255, rgb[offset + 2] / 255];
      const color = quantize(rules.palette, apply(rules.frame, original, sample), p % w, Math.floor(p / w), sample);
      const index = swatches.get(pack(color));
      if (index !== undefined) use[index]++;
      if (color !== original) for (let k = 0; k < 3; k++) rgb[offset + k] = byte(color[k]);
    }
    if (swatches.size) {
      frame.palette = plan.palettes;
      frame.use = use;
    }
    return frame;
  }

  return Object.freeze({ names, stage, blend, albedo, prepare, plan, describe, trace, apply, material, quantize, finish });
})();
if (typeof module !== 'undefined') module.exports = RenderStages;
