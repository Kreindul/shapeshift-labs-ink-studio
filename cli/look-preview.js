const fs = require('node:fs');
const path = require('node:path');
const ArtPasses = require('../src/art-passes.js');
const Palette = require('./pass-preview.js');
const PNG = require('./png.js');
const R = require('./render.js');
const { registry } = require('./look-pass.js');

const lookKeys = ['tone', 'paletteRemap', 'colorCurves', 'colorLut', 'colorStack', 'colorStackAssetId',
  'paletteConstraints', 'renderStages', 'optics', 'coverageAware'];
const colorLayer = layer => ['colorCurve', 'colorLut', 'colorStack', 'projected'].includes(layer?.type);

function replaceSceneLook(base) {
  return Object.fromEntries(Object.entries(base ?? {}).filter(([key]) => !lookKeys.includes(key)));
}

function override(world, opt, kit) {
  const value = opt.look;
  const extras = ['look-select', 'look-params', 'look-strength'];
  if (value === undefined) {
    if (extras.some(key => opt[key] !== undefined)) throw new TypeError('Look binding options need --look pack/look');
    return world;
  }
  if (typeof value !== 'string') throw new TypeError('--look needs an asset ID, JSON file or off');
  const file = /\.json$/i.test(value);
  if (value === 'off' || file) for (const key of extras) if (opt[key] !== undefined)
    throw new TypeError('--' + key + ' applies to an asset ID');
  if (value === 'off') {
    const surfaces = world.surfaces?.map(({ settings, ...surface }) => {
      const { renderStages, paletteConstraint, layers, ...other } = settings;
      return { ...surface, settings: { ...other, ...(layers && {
        layers: Object.fromEntries(Object.entries(layers).filter(([, layer]) => !colorLayer(layer)))
      }) } };
    });
    world.look = replaceSceneLook(world.look);
    if (surfaces) world.surfaces = surfaces;
    return world;
  }
  const { assetPacks, looks } = kit.KIT.authoring;
  const packs = world.lookPreviewPacks ??
    require('./asset-pack.js').install(assetPacks, world.assetPacks, opt['asset-pack']);
  const catalog = packs?.length ? assetPacks.create({ packs }) : undefined;
  const parse = key => opt[key] === undefined ? undefined : JSON.parse(opt[key]);
  const base = world.look ?? {};
  if (file) {
    const json = JSON.parse(fs.readFileSync(value, 'utf8'));
    if (!json || Object.getPrototypeOf(json) !== Object.prototype) throw new TypeError('--look JSON needs a scene look object');
    const patched = looks.scene(Object.hasOwn(json, 'steps') ? { colorStack: json } : json, catalog);
    const inherited = json.asset !== undefined ? replaceSceneLook(base) : { ...base };
    if (Object.hasOwn(patched, 'colorStack')) delete inherited.colorStackAssetId;
    world.look = { ...inherited, ...patched };
  } else {
    const select = parse('look-select'), params = parse('look-params');
    const strength = opt['look-strength'] === undefined ? undefined :
      typeof opt['look-strength'] === 'string' && opt['look-strength'].trim() ? Number(opt['look-strength']) : NaN;
    const asset = { asset: value, ...(params !== undefined && { params }), ...(strength !== undefined && { strength }) };
    if (select === undefined) world.look = { ...replaceSceneLook(base), ...looks.scene({ asset }, catalog) };
    else {
      const scoped = looks.scene({ targets: [{ select, asset }] }, catalog);
      const constraints = scoped.paletteConstraints;
      const staged = base.renderStages?.length || world.surfaces?.some(surface => surface.settings.renderStages?.length);
      world.look = { ...base,
        ...(constraints && staged && { coverageAware: true }),
        ...(scoped.renderStages?.length && { renderStages: [...(base.renderStages || []), ...scoped.renderStages] }),
        ...(constraints && { paletteConstraints: { ...base.paletteConstraints,
          targets: [...(base.paletteConstraints?.targets ?? []), ...constraints.targets]
        } })
      };
    }
  }
  return world;
}

function preview(opt) {
  if (opt.passes === undefined) return null;
  const channels = ArtPasses.select(opt.passes === true ? ['target', 'mask', 'materialId'] : String(opt.passes).split(','));
  if (channels.some(channel => ['position', 'objectPosition'].includes(channel)))
    throw new TypeError('PNG pass previews need color, scalar, ID, normal or motion channels');
  const frames = new Map(channels.map(channel => [channel, []]));
  const lookPassRegistry = registry();
  let first, last;
  return {
    settings: { passes: channels, lookPassRegistry },
    capture(frame, scale) {
      first ??= { width: frame.w, height: frame.h, scale };
      last = frame.passes;
      for (const [channel, images] of frames)
        images.push(R.upscale(Palette.encode(frame, channel), scale));
    },
    write(output, { times, cols, fps } = {}) {
      const ext = path.extname(output);
      const base = ext ? output.slice(0, -ext.length) : output;
      const files = {};
      for (const [channel, images] of frames) {
        const file = base + '-' + channel + '.png';
        if (fps !== undefined) PNG.animate(file, images, fps);
        else {
          const image = cols !== undefined ? R.grid(images, cols, times.map(t => t + 's')) : images[0];
          PNG.write(file, image.w, image.h, image.rgb);
        }
        files[channel] = path.basename(file);
      }
      const file = base + '-passes.json';
      fs.writeFileSync(file, JSON.stringify({ ...first, rows: 'top-down', files,
        ...(times && { times }), ...(fps !== undefined && { fps }),
        ...Palette.labels(last)
      }, null, 2) + '\n');
      console.log('wrote', file);
    }
  };
}

module.exports = { override, preview };
