/* Registered sprite patches with their own timing, direction and drawn in-betweens. */
const SpriteTransitions = (() => {
  const record = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).every(key => keys.includes(key));
  const names = ['color', 'depth', 'normal', 'emission'];
  const finite = Number.isFinite;
  function check(ok, message) {
    if (!ok) throw new RangeError('Sprite transition: ' + message);
  }

  function prepare(definition, select, playback, { width, color, depthRange, copyRgba, pixelBudget, edited }) {
    if (definition === undefined) return null;
    check(Array.isArray(definition) && definition.length <= 256, 'expected up to 256 clips');
    const ids = new Set(), byView = new Map();
    let hasDepth = false;
    const stamps = typeof PixelStamps === 'undefined' ? require('./pixel-stamps.js') : PixelStamps;
    for (const clip of definition) {
      check(record(clip, ['id','frame','direction','pitch','rect','mode','start','period','fps','frames','palette','extensionDepth']),
        'invalid clip settings');
      const { id, rect, mode = 'patch', start = 0, period, fps = 12, frames, palette, extensionDepth } = clip;
      check(typeof id === 'string' && id.trim() && !ids.has(id), 'clips need distinct names');
      ids.add(id);
      check(Array.isArray(rect) && rect.length === 4 && Array.from(rect).every(Number.isSafeInteger) &&
        rect[2] > 0 && rect[3] > 0 && rect[2] * rect[3] <= 65536, 'rect needs an integer origin and up to 65,536 pixels');
      check((mode === 'patch' || mode === 'replace') && finite(start) && finite(fps) && fps > 0 &&
        (extensionDepth === undefined || finite(extensionDepth)) && Array.isArray(frames) && frames.length >= 1 &&
        frames.length <= 128, 'invalid mode, time, depth or cel list');
      const [left, top, w, h] = rect;
      const views = select(clip);
      check(views.every(({ rect: view }) => left >= -128 && top >= -128 && left + w <= view.width + 128 &&
        top + h <= view.height + 128 && left < view.width && top < view.height && left + w > 0 && top + h > 0),
        'rect must overlap the registered view with at most 128 pixels of overhang');
      const entries = Array.from(frames, (cel, frame) => {
        check(record(cel, ['duration','paint','images']) && !(cel.paint !== undefined && cel.images !== undefined),
          'a cel needs indexed paint, registered images or a timing-only frame');
        const { duration = 1 / fps, paint, images } = cel;
        check(finite(duration) && duration > 0, 'cel duration must be positive');
        if (paint === undefined && images === undefined) return { frame, duration };
        let maps;
        if (images) {
          check(record(images, names) && images.color !== undefined, 'registered images need an RGBA color channel');
          maps = Object.fromEntries(Object.entries(images).map(([name, image]) =>
            [name, copyRgba(image, w * h * 4, 'Sprite transition ' + name)]));
        } else {
          check(record(paint, ['rows','slots','strokes']) && Array.isArray(palette) && palette.length > 0 &&
            palette.every(entry => typeof entry === 'string' && /^#[\da-f]{6}$/i.test(entry)),
            'indexed cels need a hex RGB palette and rows, slots or strokes');
          maps = { color: stamps.image({ width: w, height: h, ...paint, palette }).rgba };
        }
        pixelBudget -= w * h * Object.keys(maps).length;
        check(pixelBudget >= 0, 'cel maps exceed the atlas pixel budget');
        check(!maps.depth || depthRange, 'a depth cel needs the atlas depth range');
        hasDepth ||= Boolean(maps.depth) || extensionDepth !== undefined;
        return { frame, duration, maps };
      });
      const duration = entries.reduce((sum, entry) => sum + entry.duration, 0);
      const epsilon = Math.min(duration * 1e-7, Math.max(1, Math.abs(start), period ?? 0, duration) * 4 * Number.EPSILON);
      check(finite(start + duration) && start + duration > start &&
        (period === undefined || finite(period) && period > 0 && period >= duration - epsilon),
        'repeat period must be at least the clip duration');
      const pick = playback(entries, fps, 'once');
      const bounds = [left, top, left + w, top + h];
      const draw = { bounds, mode, w, extensionDepth, at(time) {
        const age = time - start;
        if (!finite(age) || age < -epsilon) return;
        let local = Math.max(0, age);
        if (period !== undefined) {
          local %= period;
          if (period - local <= epsilon) local = 0;
        }
        return local < duration - epsilon ? entries[pick(local)].maps : undefined;
      } };
      const occupied = new Set();
      if (extensionDepth === undefined) for (const { maps } of entries) {
        if (!maps) continue;
        for (let p = 0; p < w * h; p++) if (maps.color[p * 4 + 3] && !maps.depth?.[p * 4 + 3]) occupied.add(p);
      }
      for (const view of views) {
        const patch = edited.get(view)?.maps.color;
        for (const p of occupied) {
          const x = left + p % w, y = top + Math.floor(p / w), rw = view.rect.width;
          check(x >= 0 && y >= 0 && x < rw && y < view.rect.height &&
            (patch ? patch[(y * rw + x) * 4 + 3] : color[((view.rect.y + y) * width + view.rect.x + x) * 4 + 3]),
            'paint beyond the displayed silhouette needs extensionDepth or a depth texel');
        }
        if (!byView.has(view)) byView.set(view, []);
        const clips = byView.get(view);
        check(clips.length < 16, 'one view can have up to 16 clips');
        clips.push(draw);
      }
    }

    const cache = new WeakMap(), drawLists = new WeakMap();
    function frame(view, time) {
      const prior = cache.get(view);
      if (prior?.time === time) return prior.packet;
      const active = [];
      const bounds = [Infinity,Infinity,-Infinity,-Infinity];
      for (const clip of byView.get(view) ?? []) {
        const maps = clip.at(time);
        if (!maps) continue;
        active.push({ ...clip, maps });
        for (let i = 0; i < 4; i++) bounds[i] = (i < 2 ? Math.min : Math.max)(bounds[i], clip.bounds[i]);
      }
      const packet = active.length ? Object.freeze({ bounds: Object.freeze(bounds) }) : null;
      if (packet) drawLists.set(packet, active);
      cache.set(view, { time, packet });
      return packet;
    }
    function read(packet, x, y) {
      const active = drawLists.get(packet);
      for (let i = (active?.length ?? 0) - 1; i >= 0; i--) {
        const cel = active[i], [left,top,right,bottom] = cel.bounds;
        if (x < left || x >= right || y < top || y >= bottom) continue;
        const index = ((y - top) * cel.w + x - left) * 4;
        if (cel.mode === 'replace' || cel.maps.color[index + 3])
          return { maps: cel.maps, index, extensionDepth: cel.extensionDepth };
      }
    }
    return { frame, read, hasDepth, pixelBudget };
  }
  return Object.freeze({ prepare });
})();
if (typeof module !== 'undefined') module.exports = SpriteTransitions;
