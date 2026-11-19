/* Named places, oriented apertures and retained travel handoffs. */
(function (K) {
  const W = K.world, V = K.V, { freeze, clone } = K.procedural.data;
  const finite = Number.isFinite;
  const xyz = value => Array.isArray(value) && value.length === 3 && Array.from(value).every(finite);
  const positive = value => finite(value) && value > 0;
  const name = value => typeof value === 'string' && value.trim().length > 0;
  const point = value => {
    if (!xyz(value)) throw new TypeError('Expected finite XYZ coordinates');
    return value.slice();
  };

  function anchor({ origin, normal = [0, 0, 1], up = [0, 1, 0] } = {}) {
    const n = V.norm(point(normal), [0, 0, 0]), right = V.norm(V.cross(point(up), n), [0, 0, 0]);
    if (V.len(n) < 0.99 || V.len(right) < 0.99)
      throw new RangeError('Portal anchor axes must be nonzero and independent');
    return freeze({ origin: point(origin), normal: n, right, up: V.cross(n, right) });
  }

  function doorway({ from, to, halfWidth, halfHeight, shape = 'rect' } = {}) {
    if (!positive(halfWidth) || !positive(halfHeight) || !['rect', 'ellipse'].includes(shape))
      throw new RangeError('A doorway needs positive half extents and a rectangular or elliptical aperture');
    const a = anchor(from), b = anchor(to);
    const project = (p, basis) => [V.dot(p, basis.right), V.dot(p, basis.up), V.dot(p, basis.normal)];
    const direction = value => {
      const [x, y, z] = project(point(value), a);
      return V.mad(V.mad(V.mul(b.right, -x), b.up, y), b.normal, -z);
    };
    const transformPoint = value => V.add(b.origin, direction(V.sub(point(value), a.origin)));
    function mapCamera(camera) {
      if (camera == null) return null;
      return freeze({ ...clone(camera), eye: transformPoint(camera.eye), right: direction(camera.right),
        up: direction(camera.up), back: direction(camera.back),
        ...(camera.target === undefined ? {} : { target: transformPoint(camera.target) }) });
    }
    function hit(previous, next, { radius = 0 } = {}) {
      if (!finite(radius) || radius < 0) throw new RangeError('Crossing radius must be nonnegative');
      const p = V.sub(point(previous), a.origin), q = V.sub(point(next), a.origin);
      const z0 = V.dot(p, a.normal), z1 = V.dot(q, a.normal);
      if (z0 < 0 || z1 >= 0 || radius >= Math.min(halfWidth, halfHeight)) return null;
      const fraction = z0 / (z0 - z1), at = V.mad(p, V.sub(q, p), fraction);
      const x = V.dot(at, a.right), y = V.dot(at, a.up);
      const fits = shape === 'ellipse' ?
        Math.hypot(x / halfWidth, y / halfHeight) + radius / Math.min(halfWidth, halfHeight) <= 1 :
        Math.abs(x) + radius <= halfWidth && Math.abs(y) + radius <= halfHeight;
      if (!fits) return null;
      return freeze({ fraction, point: V.add(a.origin, at) });
    }
    return Object.freeze({ from: a, to: b, halfWidth, halfHeight, shape,
      point: transformPoint, direction, camera: mapCamera, hit });
  }

  function unique(rows, kind) {
    if (!Array.isArray(rows) || rows.length > 4096) throw new TypeError('Expected a bounded list of ' + kind);
    const result = new Map();
    for (const row of rows) {
      if (!name(row?.id) || result.has(row.id)) throw new TypeError(kind + ' need unique IDs');
      result.set(row.id, row);
    }
    return result;
  }

  function create({ places, links = [], saved = {} } = {}) {
    const catalog = unique(places, 'Places'), graph = unique(links, 'Links'), memory = new Map(Object.entries(clone(saved)));
    const exits = new Map();
    let active = null, pending = null, walking = false, fading = null, disposed = false;
    for (const [id, row] of catalog) {
      if (typeof row.prepare !== 'function') throw new TypeError('Each place needs a prepare callback');
      const anchors = new Map(Object.entries(row.anchors ?? {}).map(([key, value]) => [key, anchor(value)]));
      catalog.set(id, { id, anchors, prepare: row.prepare });
    }
    function endpoint(value) {
      const place = catalog.get(value?.place), at = place?.anchors.get(value?.anchor);
      if (!at) throw new TypeError('Travel endpoints need a declared place and anchor');
      return Object.freeze({ place: place.id, anchor: value.anchor, at });
    }
    for (const [id, row] of graph) {
      const from = endpoint(row.from), to = endpoint(row.to), mode = row.mode ?? 'walk';
      const radius = row.radius ?? 1, height = row.height ?? 0.7, duration = row.duration ?? 0.8;
      if ((mode !== 'walk' && mode !== 'fade') || !positive(radius) || !positive(height) || !positive(duration) ||
          row.open !== undefined && typeof row.open !== 'function')
        throw new TypeError('Invalid travel mode, gate or trigger controls');
      const opening = mode === 'walk' ? doorway({ ...row.aperture, from: from.at, to: to.at }) : null;
      const link = Object.freeze({ id, from, to, mode, opening, radius, height, duration, open: row.open });
      graph.set(id, link);
      if (!exits.has(from.place)) exits.set(from.place, []);
      exits.get(from.place).push(link);
    }

    function guard() {
      if (disposed) throw new Error('The place session has been disposed');
    }
    function permits(link, actor) {
      return !link.open || Boolean(link.open({ active, actor, link }));
    }
    function linked(id) {
      const link = graph.get(id);
      if (!link || link.from.place !== active?.id) throw new RangeError('This link does not start in the active place');
      return link;
    }
    const release = asset => {
      if (asset !== active?.asset) asset?.dispose?.();
    };
    function cancel() {
      const job = pending;
      pending = null;
      if (!job) return;
      job.controller.abort();
      release(job.asset);
    }
    function request(place, at, link, reason) {
      cancel();
      const from = active, controller = new AbortController(), job = { from, controller, place, link, asset: null };
      pending = job;
      job.done = Promise.resolve().then(() => place.prepare({
        id: place.id, anchor: at, state: memory.get(place.id), previous: from?.id === place.id ? from.asset : null,
        signal: controller.signal, reason, link
      })).then(asset => {
        if (!asset || typeof asset !== 'object') throw new TypeError('Place preparation must return a payload');
        if (pending !== job) {
          release(asset);
          return null;
        }
        job.asset = asset;
        return asset;
      }).catch(error => {
        if (pending !== job) return null;
        pending = null;
        throw error;
      });
      return job;
    }
    function activate(job, actor, camera, crossing) {
      if (pending !== job || job.from !== active || !job.asset) return null;
      const link = job.link;
      if (link && !permits(link, actor)) return null;
      const opening = link?.opening, at = link?.to.at;
      const arrival = actor && freeze({ ...clone(actor),
        position: opening ? opening.point(actor.position) : at.origin.slice(),
        ...(actor.velocity ? { velocity: opening ? opening.direction(actor.velocity) : [0, 0, 0] } : {}),
        ...(actor.forward && opening ? { forward: opening.direction(actor.forward) } : {}),
        ...(actor.up && opening ? { up: opening.direction(actor.up) } : {})
      });
      const mappedCamera = opening?.camera(camera) ?? null;
      if (arrival && job.asset.canArrive && !job.asset.canArrive(arrival, link)) return null;
      const previous = active, state = previous?.asset.checkpoint?.();
      if (state !== undefined) memory.set(previous.id, freeze(clone(state)));
      active = Object.freeze({ id: job.place.id, asset: job.asset });
      pending = null;
      release(previous?.asset);
      return Object.freeze({ place: active, link, actor: arrival, camera: mappedCamera, crossing });
    }

    async function enter(id, at) {
      guard();
      if (walking || fading) throw new Error('Travel is already in progress');
      const place = catalog.get(id), target = at === undefined ? null : place?.anchors.get(at);
      if (!place || at !== undefined && !target) throw new RangeError('Unknown place or arrival anchor');
      const job = request(place, target, null, 'enter');
      if (!await job.done) return null;
      return activate(job, null, null, null)?.place ?? null;
    }
    function prepare(id) {
      guard();
      const link = linked(id);
      if (pending?.link === link) return pending.done;
      if (walking || fading) throw new Error('Travel is already in progress');
      return request(catalog.get(link.to.place), link.to.at, link, 'preview').done;
    }
    function approach(position, { distance = 8, actor } = {}) {
      guard();
      point(position);
      if (!positive(distance)) throw new RangeError('Preview distance must be positive');
      if (walking || fading) return null;
      let best = null, nearest = distance;
      for (const link of exits.get(active?.id) ?? []) {
        if (!link.opening || !permits(link, actor)) continue;
        const delta = V.sub(position, link.from.at.origin), d = V.len(delta);
        if (V.dot(delta, link.from.at.normal) >= 0 && (d < nearest || d === nearest && best && link.id < best.id)) {
          nearest = d;
          best = link;
        }
      }
      if (!best) {
        if (pending?.link?.opening) cancel();
        return null;
      }
      return Object.freeze({ link: best, ready: prepare(best.id) });
    }
    function view(id = pending?.link?.id, actor) {
      const job = pending, link = job?.link;
      if (!job?.asset || link?.id !== id || !link.opening || !permits(link, actor)) return null;
      return Object.freeze({ opening: link.opening, source: active.asset.world, destination: job.asset.world,
        link, asset: job.asset });
    }
    async function cross(id, { previous, actor, camera, radius } = {}) {
      guard();
      if (walking || fading) return null;
      const link = linked(id);
      if (!actor || !link.opening || !permits(link, actor)) return null;
      const crossing = link.opening.hit(previous, actor.position, { radius });
      if (!crossing) return null;
      const traveler = clone(actor), view = camera == null ? null : clone(camera);
      const loaded = prepare(id), job = pending;
      walking = true;
      try {
        if (!await loaded) return null;
        return activate(job, traveler, view, crossing);
      } finally {
        walking = false;
      }
    }
    function fade(id, { actor } = {}) {
      guard();
      if (walking || fading) throw new Error('Travel is already in progress');
      const link = linked(id);
      if (link.mode !== 'fade' || !permits(link, actor)) return null;
      const delta = V.sub(point(actor?.position), link.from.at.origin);
      if (Math.hypot(delta[0], delta[2]) > link.radius || Math.abs(delta[1]) > link.height) return null;
      const loaded = prepare(id), job = pending, half = link.duration / 2;
      const traveler = freeze(clone(actor));
      let elapsed = 0, opacity = 0, phase = 'out', ready = false, error, arrival;
      loaded.then(value => {
        ready = true;
        if (!value) error = new Error('Destination preparation was cancelled');
      }, reason => { ready = true; error = reason; });
      const playback = Object.freeze({
        advance(dt) {
          guard();
          if (!finite(dt) || dt < 0) throw new RangeError('Fade steps need finite nonnegative time');
          if (phase === 'out') {
            const left = half - elapsed;
            elapsed = Math.min(half, elapsed + dt);
            opacity = elapsed / half;
            dt = Math.max(0, dt - left);
            if (elapsed === half) phase = 'hold';
          }
          if (phase === 'hold' && ready) {
            try {
              if (!error) arrival = activate(job, traveler, null, null);
            } catch (reason) {
              error = reason;
            }
            if (!arrival) error ??= new Error('Arrival is unavailable');
            if (pending === job) cancel();
            elapsed = 0;
            phase = 'in';
          }
          if (phase === 'in') {
            elapsed = Math.min(half, elapsed + dt);
            opacity = 1 - elapsed / half;
            if (elapsed === half) {
              phase = error ? 'failed' : 'done';
              fading = null;
            }
          }
          return Object.freeze({ phase, opacity, arrival: arrival ?? null, error: error ?? null, place: active });
        }
      });
      fading = playback;
      return playback;
    }
    function checkpoint() {
      guard();
      const states = new Map(memory), state = active?.asset.checkpoint?.();
      if (state !== undefined) states.set(active.id, state);
      return freeze({ place: active?.id ?? null, saved: clone(Object.fromEntries(states)) });
    }
    return Object.freeze({ current: () => active, enter, approach, prepare, view, cross, fade, checkpoint,
      dispose() {
        if (disposed) return;
        disposed = true;
        const previous = active;
        active = null;
        cancel();
        release(previous?.asset);
      } });
  }

  W.portals = Object.freeze({ anchor, doorway, create });
})(KIT);
