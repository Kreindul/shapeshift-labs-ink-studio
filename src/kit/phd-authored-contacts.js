/* Time-ranged puppet contacts and scrub-safe rigid socket transfers. */
(function (K) {
  const { anim: A, deform: D, V, M, clamp } = K;
  const zero = [0, 0, 0];
  const xyz = v => Array.isArray(v) && v.length === 3 && Array.from(v).every(Number.isFinite);
  const name = id => typeof id === 'string' && !!id.trim() && !(id in Object.prototype);
  const smooth = t => A.ease(t, 'smooth');
  const unit = t => Number.isFinite(t) && t >= 0 && t <= 1;

  function basis(matrix) {
    const x = V.norm([matrix[0], matrix[3], matrix[6]], [1, 0, 0]);
    const y = [matrix[1], matrix[4], matrix[7]];
    const up = V.norm(V.mad(y, x, -V.dot(x, y)), V.perp(x));
    return M.cols(x, up, V.cross(x, up));
  }

  function mount(spec = {}) {
    const { position = zero, rotation = zero } = spec;
    if (!xyz(position) || !xyz(rotation)) throw new TypeError('A prop mount needs XYZ position and Euler degrees');
    return { position: position.slice(), rotation: D.euler(rotation) };
  }

  function compose(parent, local) {
    return { position: V.add(parent.position, M.app(parent.rotation, local.position)),
      rotation: M.mul(parent.rotation, local.rotation) };
  }

  function relative(parent, world) {
    const inverse = M.tr(parent.rotation);
    return { position: M.app(inverse, V.sub(world.position, parent.position)), rotation: M.mul(inverse, world.rotation) };
  }

  function create({ duration, puppet, sample, sockets = {}, contacts = [], prop, height = 1 } = {}) {
    if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(height) || height <= 0 ||
        typeof sample !== 'function' || typeof puppet?.solve !== 'function' || typeof puppet.point !== 'function' ||
        !sockets || typeof sockets !== 'object' || !Array.isArray(contacts))
      throw new TypeError('Authored contacts need a puppet, pose sampler, duration and sockets');
    const { parts } = puppet;
    function basePose(time) {
      const value = sample(time);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('A pose sampler must return a pose object');
      return Object.fromEntries(Object.entries(value).map(([id, channels]) =>
        [id, Object.fromEntries(Object.entries(channels).map(([channel, v]) =>
          [channel, Array.isArray(v) ? v.slice() : v]))]));
    }
    function part(id) {
      if (!name(id) || !Object.hasOwn(parts, id)) throw new Error('Unknown puppet part: ' + id);
      return parts[id];
    }
    function under(id, root) {
      while (id != null) {
        if (id === root) return true;
        id = parts[id].parent;
      }
      return false;
    }
    if (prop && part(prop.part).parent) throw new Error('An animated prop must be a top-level puppet part');
    const slots = new Map(Object.entries(sockets).map(([id, value]) => {
      const { part: owner, rotation, normal, dir, tangent } = value || {};
      const p = value?.point ?? value?.p;
      if (!name(id) || !xyz(p) || (rotation !== undefined && !xyz(rotation)))
        throw new TypeError('A socket needs an ID, point and valid axes: ' + id);
      if (owner != null) {
        part(owner);
        if (prop && under(owner, prop.part)) throw new Error('A prop cannot own an attachment socket in its track');
      }
      const direction = normal ?? dir ?? [0, 1, 0];
      if (!xyz(direction) || V.len(direction) < 1e-8 || (tangent !== undefined && !xyz(tangent)))
        throw new TypeError('Invalid socket axes: ' + id);
      const up = V.norm(direction);
      const along = tangent ?? (Math.abs(up[0]) < 0.9 ? [1, 0, 0] : [0, 0, 1]);
      const orthogonal = V.mad(along, up, -V.dot(along, up));
      if (V.len(orthogonal) < 1e-8) throw new TypeError('Socket axes must span a frame: ' + id);
      const right = V.norm(orthogonal);
      return [id, { part: owner ?? null, point: p.slice(),
        rotation: rotation ? D.euler(rotation) : M.cols(right, up, V.cross(right, up)) }];
    }));
    function socket(id) {
      if (!slots.has(id)) throw new Error('Unknown attachment socket: ' + id);
      return slots.get(id);
    }
    function socketPoint(slot) {
      return slot.part ? puppet.point(slot.part, slot.point) : slot.point.slice();
    }
    function socketFrame(id) {
      const slot = socket(id), position = socketPoint(slot);
      if (!slot.part) return { position, rotation: slot.rotation.slice() };
      const owner = part(slot.part);
      const linear = owner.D ? M.mul(owner.A, D.jac(owner.D, slot.point)) : owner.A;
      return { position, rotation: M.mul(basis(linear), slot.rotation) };
    }
    function chain(upper, lower) {
      if (part(lower).parent !== part(upper).name) throw new Error('An IK contact needs a connected two-part chain');
    }
    const contactIds = new Set();
    const holds = Array.from(contacts, contact => {
      const { id, upper, part: lower, point, target, start, end,
        fadeIn = 0, fadeOut = 0, weight = 1, pole, enabled = true } = contact || {};
      if (!name(id) || contactIds.has(id) || !xyz(point) || ![start, end, fadeIn, fadeOut].every(Number.isFinite) ||
          start < 0 || end > duration || end <= start || fadeIn < 0 || fadeOut < 0 ||
          fadeIn + fadeOut > end - start + 1e-10 || !unit(weight) ||
          (pole !== undefined && !xyz(pole)) || typeof enabled !== 'boolean')
        throw new TypeError('Invalid contact range, fade or point: ' + id);
      part(lower);
      if (upper !== undefined) chain(upper, lower);
      if (prop && under(lower, prop.part)) throw new Error('Author contacts on the puppet, or attach the prop at a socket');
      if (!xyz(target)) {
        const slot = socket(target);
        if (under(slot.part, upper ?? lower)) throw new Error('A contact cannot target its own moving chain');
      }
      contactIds.add(id);
      return { id, upper, part: lower, point: point.slice(), target: xyz(target) ? target.slice() : target,
        start, end, fadeIn, fadeOut, weight, pole: pole?.slice(), enabled };
    });
    function contactStrength(t, contact) {
      if (!contact.enabled || t < contact.start || t > contact.end) return 0;
      const enter = contact.fadeIn ? smooth((t - contact.start) / contact.fadeIn) : 1;
      const exit = contact.fadeOut ? smooth((contact.end - t) / contact.fadeOut) : 1;
      return contact.weight * enter * exit;
    }
    function applyContacts(t) {
      const active = [];
      puppet.solve();
      for (const hold of holds) {
        const strength = contactStrength(t, hold);
        if (!strength) continue;
        const target = Array.isArray(hold.target) ? hold.target.slice() : socketPoint(socket(hold.target));
        if (hold.upper !== undefined) puppet.reach(hold.upper, hold.part, hold.point, target, { pole: hold.pole, w: strength });
        else puppet.pin(hold.part, hold.point, target, strength);
        active.push({ id: hold.id, part: hold.part, strength, target, point: hold.point });
      }
      return active;
    }

    const keys = [], initial = prop ? { socket: prop.socket, mount: mount(prop.mount) } : null;
    function before(t, limit = keys.length) {
      for (let i = limit - 1; i >= 0; i--) if (t >= keys[i].time) return keys[i];
      return initial;
    }
    function propFrame(t, limit = keys.length) {
      const key = before(t, limit);
      const incoming = socketFrame(key.socket);
      if (key.time === undefined || t >= key.settleEnd && t > key.time) return compose(incoming, key.mount);
      const u = key.settleEnd > key.time ? smooth((t - key.time) / (key.settleEnd - key.time)) : 0;
      return compose(incoming, { position: V.lerp(key.offset.position, key.mount.position, u),
        rotation: u === 0 ? key.offset.rotation : M.mul(M.rot(key.delta.axis, key.delta.angle * (1 - u)), key.mount.rotation) });
    }
    function solveReach(key, target, strength) {
      const hand = socket(key.socket);
      return puppet.reach(key.reach.upper, hand.part, hand.point, target, { pole: key.reach.pole, w: strength });
    }
    if (prop) {
      if (!Array.isArray(prop.keys)) throw new TypeError('An animated prop needs an array of transfer keys');
      socket(initial.socket);
      const ids = new Set();
      const drafts = Array.from(prop.keys, draft => {
        const { id, time, to, reach, settle } = draft || {};
        if (!name(id) || ids.has(id) || !Number.isFinite(time) || time < 0 || time > duration ||
            (settle !== undefined && (!Number.isFinite(settle) || settle <= 0)))
          throw new TypeError('Invalid prop transfer key: ' + id);
        ids.add(id);
        const hand = socket(to), targetMount = draft.mount ? mount(draft.mount) : initial.mount;
        if (reach !== undefined) {
          if (!reach || typeof reach !== 'object' || !hand.part || !name(reach.upper) ||
              (reach.pole !== undefined && !xyz(reach.pole)) ||
              (reach.lead !== undefined && (!Number.isFinite(reach.lead) || reach.lead < 0)) ||
              V.len(targetMount.position) > 1e-8) throw new TypeError('A reach needs a receiving limb and a grip-centered mount');
          chain(reach.upper, hand.part);
        }
        return { id, time, socket: to, mount: targetMount, settle,
          reach: reach && { upper: reach.upper, pole: reach.pole?.slice(), lead: reach.lead } };
      }).sort((a, b) => a.time - b.time);
      D.inspectPoses(puppet, solve => {
        for (const [index, key] of drafts.entries()) {
          const previous = keys.at(-1) ?? initial;
          const hand = socket(key.socket), outgoing = socket(previous.socket);
          if (previous.socket === key.socket || previous.time === key.time ||
              (key.reach && under(outgoing.part, key.reach.upper)))
            throw new Error('A transfer needs a new socket, unique time and independent receiving limb');
          solve(basePose(key.time));
          applyContacts(key.time);
          const world = propFrame(key.time);
          const reachDistance = key.reach ? V.dist(socketPoint(hand), world.position) : 0;
          const lead = key.reach ? key.reach.lead ?? clamp(0.12 + reachDistance / (height * 1.6), 0.16, 0.68) : 0;
          const reachStart = Math.max(previous.settleEnd ?? 0, key.time - lead);
          const settleEnd = Math.min(duration, drafts[index + 1]?.time ?? duration,
            key.time + (key.settle ?? clamp((key.time - reachStart) * 0.5, 0.1, 0.28)));
          const reachMiss = key.reach ? solveReach(key, world.position, 1) : null;
          const offset = relative(socketFrame(key.socket), world);
          const delta = M.axisAngle(M.mul(offset.rotation, M.tr(key.mount.rotation)));
          keys.push({ ...key, from: previous.socket, reachStart, settleEnd, offset, delta,
            anchor: world.position, reachDistance, reachMiss });
        }
      });
    }
    const handoffs = Object.freeze(keys.map(key => Object.freeze({ id: key.id, from: key.from, to: key.socket,
      reachStart: key.reachStart, time: key.time, settleEnd: key.settleEnd,
      reachDistance: key.reachDistance, reachMiss: key.reachMiss })));
    const ranges = Object.freeze(holds.map(hold => Object.freeze({
      id: hold.id, part: hold.part, start: hold.start, end: hold.end, enabled: hold.enabled,
      fadeIn: hold.fadeIn, fadeOut: hold.fadeOut, weight: hold.weight
    })));
    function phase(t, key) {
      if (t < key.reachStart) return 'before';
      if (t < key.time) return 'reach';
      if (t === key.time) return 'transfer';
      return t < key.settleEnd ? 'settle' : 'after';
    }
    function apply(time) {
      if (!Number.isFinite(time)) throw new TypeError('Contact time must be finite');
      const t = clamp(time, 0, duration), active = applyContacts(t), reaches = [];
      for (const [index, key] of keys.entries()) {
        if (!key.reach || t < key.reachStart || t > key.settleEnd) continue;
        const strength = t === key.time ? 1 : t < key.time
          ? smooth((t - key.reachStart) / (key.time - key.reachStart))
          : 1 - smooth((t - key.time) / (key.settleEnd - key.time));
        if (!strength) continue;
        const target = t <= key.time ? propFrame(t, index).position : key.anchor;
        solveReach(key, target, strength);
        const hand = socket(key.socket);
        reaches.push({ id: key.id, part: hand.part, strength, target: target.slice(), point: hand.point });
      }
      let attachment = null;
      if (prop) {
        const transform = propFrame(t), owner = before(t).socket;
        const show = puppet.pose[prop.part]?.show;
        puppet.pose[prop.part] = { pos: V.sub(transform.position, part(prop.part).pivot), turn: transform.rotation.slice(),
          ...(show !== undefined && { show }) };
        puppet.solve();
        attachment = { part: prop.part, owner, ...transform };
      }
      function evidence({ point, ...record }) {
        const position = puppet.point(record.part, point);
        return { ...record, position, miss: V.dist(position, record.target) };
      }
      return { time: t, contacts: active.map(evidence), reaches: reaches.map(evidence), attachment };
    }
    function pose(time) {
      if (!Number.isFinite(time)) throw new TypeError('Contact time must be finite');
      puppet.pose = basePose(clamp(time, 0, duration));
      return apply(time);
    }
    function focus(id) {
      const key = handoffs.find(key => key.id === id);
      if (!key) throw new Error('Unknown prop transfer: ' + id);
      const start = Math.max(0, key.reachStart - 0.12);
      const end = Math.min(duration, key.settleEnd + 0.12), span = end - start;
      return Object.freeze({ ...key, start, end, duration: span, phaseAt: time => phase(time, key), timeAt(elapsed) {
        if (!Number.isFinite(elapsed)) throw new TypeError('Focus time must be finite');
        const offset = elapsed % span;
        return start + (offset < 0 ? offset + span : offset);
      } });
    }
    return Object.freeze({ duration, handoffs, contacts: ranges, pose, focus,
      inspect: time => D.inspectPoses(puppet, () => pose(time)) });
  }

  A.contacts = Object.freeze({ create });
})(KIT);
