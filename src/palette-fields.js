/* Scoped, dependency-free palette fields for textures and material samplers. */
const PaletteFields = (() => {
  const pixels = typeof PixelLook === 'undefined' ? require('./pixel-look.js') : PixelLook;
  const fraction = n => Number.isFinite(n) && n >= 0 && n <= 1;
  const coord = n => Math.max(0, Math.min(1, n));
  const wrap = n => n - Math.floor(n);
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const channel = (offset, hue, saturation, value) => {
    const k = (offset + hue) % 6;
    return value * (1 - saturation * Math.max(0, Math.min(k, 4 - k, 1)));
  };

  function swatch(value) {
    if (typeof value === 'string' && /^#[\da-f]{6}$/i.test(value)) {
      const packed = parseInt(value.slice(1), 16);
      return [packed >> 16, packed >> 8 & 255, packed & 255].map(n => n / 255);
    }
    return value;
  }

  const pair = values => Array.isArray(values) && values.length === 2 && Array.from(values).every(Number.isFinite);
  function hueBrightness(definition, resolveColor = swatch) {
    if (!record(definition) || Object.keys(definition).some(key => !['palette', 'hue', 'brightness', 'saturation'].includes(key)))
      throw new TypeError('A hue–brightness field needs a palette and optional hue, brightness and saturation');
    const { palette, hue = [0, 1], brightness = [0, 1], saturation = 1 } = definition;
    if (!Array.isArray(palette) || !palette.length || palette.length > 48)
      throw new RangeError('A hue–brightness field needs 1–48 palette swatches');
    if (!pair(hue) || hue[1] <= hue[0] || hue[1] - hue[0] > 1 ||
        !pair(brightness) || !brightness.every(fraction) || brightness[0] > brightness[1] || !fraction(saturation))
      throw new RangeError('Use an increasing hue range up to one turn, ordered brightness in [0, 1], and saturation in [0, 1]');
    const swatches = Object.freeze(Array.from(palette, value => {
      if (value === undefined) throw new TypeError('Invalid hue–brightness swatch');
      const rgb = resolveColor(value);
      if (!Array.isArray(rgb) || rgb.length !== 3 || !Array.from(rgb).every(fraction))
        throw new TypeError('Hue–brightness fields require hex colors or normalized RGB swatches');
      return Object.freeze(rgb.slice());
    }));
    const startHue = wrap(hue[0]), hueSpan = hue[1] - hue[0], [dark, light] = brightness;
    const rgb = [0, 0, 0];
    function index(u, v) {
      if (!Number.isFinite(u) || !Number.isFinite(v)) throw new TypeError('Palette field coordinates must be finite');
      const h = wrap(startHue + hueSpan * coord(u)) * 6;
      const value = dark + (light - dark) * coord(v);
      rgb[0] = channel(5, h, saturation, value);
      rgb[1] = channel(3, h, saturation, value);
      rgb[2] = channel(1, h, saturation, value);
      return pixels.nearest(rgb, swatches);
    }
    function sample(u, v, out = [0, 0, 0]) {
      const swatch = swatches[index(u, v)];
      for (let k = 0; k < 3; k++) out[k] = swatch[k];
      return out;
    }
    function raster(w, h) {
      if (!Number.isSafeInteger(w) || !Number.isSafeInteger(h) || Math.min(w, h) < 1 || w * h > 2 ** 20)
        throw new RangeError('Palette field raster needs positive integer dimensions and at most 1,048,576 pixels');
      const rgb = new Uint8Array(w * h * 3), indices = new Uint8Array(w * h);
      const bytes = swatches.map(color => color.map(value => Math.round(value * 255)));
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const p = y * w + x;
        indices[p] = index((x + .5) / w, 1 - (y + .5) / h);
        rgb.set(bytes[indices[p]], p * 3);
      }
      return { w, h, rgb, indices, palette: swatches };
    }
    return Object.freeze({ palette: swatches, index, sample, raster });
  }

  return Object.freeze({ hueBrightness });
})();
if (typeof module !== 'undefined') module.exports = PaletteFields;
