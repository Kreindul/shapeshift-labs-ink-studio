/* Optional camera and sampling controls in native art pixels. */
const ArtStability = (() => {
  function prepare(definition) {
    if (!definition) return null;
    const settings = definition === true ? { snap: true } : definition;
    if (typeof settings !== 'object' || Array.isArray(settings)) throw new TypeError('Expected pixel stability settings');
    const { snap = false, anchor = [0, 0, 0], dither = 'screen', spacing = .08,
      resolve = 'native', threshold = .4, protect = [] } = settings;
    if (typeof snap !== 'boolean' || !Array.isArray(anchor) || anchor.length !== 3 || !anchor.every(Number.isFinite) ||
        !['screen', 'world', 'object'].includes(dither) || !Number.isFinite(spacing) || spacing <= 0 ||
        !['native', 'coverage', 'clusters'].includes(resolve) || !Number.isFinite(threshold) || threshold <= 0 || threshold > 1 ||
        !Array.isArray(protect) || !protect.every(value => typeof value === 'string' || Number.isSafeInteger(value)))
      throw new RangeError('Invalid pixel stability settings');
    return { snap, anchor, dither, spacing, resolve, threshold, protect: new Set(protect.map(String)) };
  }

  function snapView(view, pixelsPerUnit, anchor) {
    const result = view.slice();
    for (let row = 0; row < 2; row++) {
      const position = anchor[0] * view[row] + anchor[1] * view[4 + row] + anchor[2] * view[8 + row] + view[12 + row];
      const snapped = Math.round(position * pixelsPerUnit) / pixelsPerUnit;
      result[row + 12] += snapped - position;
    }
    return result;
  }

  const modulo = (n, size) => ((n % size) + size) % size;
  function ditherCoordinates(settings, passes, p, x, y) {
    if (!settings || settings.dither === 'screen' || !passes?.splatId[p]) return [x, y];
    const coordinates = settings.dither === 'object' ? passes.objectPosition : passes.position;
    const q = p * 3;
    const ix = Math.floor(coordinates[q] / settings.spacing);
    const iy = Math.floor(coordinates[q + 1] / settings.spacing);
    const iz = Math.floor(coordinates[q + 2] / settings.spacing);
    // Mixing the three integer axes lets any axis-aligned surface use both pattern dimensions.
    return [ix + 3 * iy + 2 * iz, 2 * ix + iy + 3 * iz];
  }

  function protectedPixel(settings, passes, p) {
    if (!settings || !passes) return false;
    const object = passes.objectId?.[p], material = passes.materialId?.[p];
    return (object > 0 && settings.protect.has(String(passes.objects[object] ?? object))) ||
      (material > 0 && settings.protect.has(String(passes.materials[material] ?? material)));
  }

  function resolve(native, samples, settings, palette, pixelLook, dither) {
    const { w, h, color, passes } = native, sw = samples.w;
    const rgb = new Uint8Array(w * h * 3), use = new Uint32Array(palette.length);
    const coverage = new Float32Array(w * h), detail = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x, s = (y * sw + x) * 2;
      coverage[p] = (samples.passes.coverage[s] + samples.passes.coverage[s + 1] +
        samples.passes.coverage[s + sw] + samples.passes.coverage[s + sw + 1]) * .25;
      const n = p * 3, light = passes.emission;
      detail[p] = Boolean(native.detail?.[p] || passes.protected?.[p] || protectedPixel(settings, passes, p) ||
        (light && Math.max(light[n], light[n + 1], light[n + 2]) > .12));
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x, s = (y * sw + x) * 2, q = p * 3;
      const c = ((h - 1 - y) * w + x) * 3;
      const [dx, dy] = ditherCoordinates(settings, passes, p, x, y);
      const bias = (pixelLook.bayerRank(dx, dy) - .5) * dither;
      let threshold = settings.threshold, chosen = 0;
      if (settings.resolve === 'clusters' && coverage[p] > 0 && coverage[p] < 1) {
        const neighbor = (x > 0 && coverage[p - 1] >= threshold) || (x + 1 < w && coverage[p + 1] >= threshold) ||
          (y > 0 && coverage[p - w] >= threshold) || (y + 1 < h && coverage[p + w] >= threshold);
        threshold += neighbor ? -.12 : .10;
      }
      if (detail[p] || coverage[p] >= threshold) {
        const votes = new Map();
        if (coverage[p] < .98 && !detail[p]) {
          for (const j of [s, s + 1, s + sw, s + sw + 1]) {
            const weight = samples.passes.coverage[j];
            if (weight < .06) continue;
            const iy = (sw * (samples.h - 1 - Math.floor(j / sw)) + j % sw) * 3, a = weight || 1;
            // The raw samples are composited against palette zero. Recover the foreground.
            const shade = palette[0].map((bg, k) => Math.max(0, Math.min(1, (samples.color[iy + k] / 255 - bg * (1 - a)) / a + bias)));
            const index = pixelLook.nearest(shade, palette, true);
            votes.set(index, (votes.get(index) || 0) + weight);
          }
        }
        chosen = pixelLook.nearest([color[c] / 255 + bias, color[c + 1] / 255 + bias, color[c + 2] / 255 + bias], palette, !detail[p]);
        let best = votes.get(chosen) || 0;
        for (const [index, weight] of votes) if (weight > best) {
          chosen = index;
          best = weight;
        }
      }
      use[chosen]++;
      for (let k = 0; k < 3; k++) rgb[q + k] = Math.round(palette[chosen][k] * 255);
    }
    return { w, h, rgb, use, detail };
  }

  return Object.freeze({ prepare, snapView, modulo, ditherCoordinates, protectedPixel, resolve });
})();
if (typeof module !== 'undefined') module.exports = ArtStability;
