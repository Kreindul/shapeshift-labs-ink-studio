/* Portable control events and stateless frame-aligned replay. */
(function (P) {
  const A = P.mediaGraph, T = P.takeTime, pointTimes = new WeakMap();
  const { range, plain, id, clock } = P.mediaGraphSupport;
  const format = 'ink-studio/input-recording', maxEvents = 100000;

  function control(value, depth = 0) {
    if (value === null || typeof value === 'boolean' || Number.isFinite(value) ||
        typeof value === 'string' && value.length <= 4096) return value;
    if (depth < 8 && Array.isArray(value) && value.length <= 64)
      return Object.freeze(Array.from(value, item => control(item, depth + 1)));
    if (depth < 8 && plain(value) && Object.keys(value).length <= 64 && Object.keys(value).every(id))
      return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, control(item, depth + 1)])));
    throw new TypeError('Input values need bounded finite JSON data');
  }

  function event({ time, timecode = time, channel, kind = 'set', value = kind === 'pulse' ? true : undefined } = {}) {
    const point = T.read(timecode), seconds = T.seconds(point);
    const exact = typeof timecode !== 'number';
    if (!range(seconds, 0, 1e9) || !id(channel) || !['set', 'pulse'].includes(kind) ||
        time !== timecode && (!exact || time !== seconds))
      throw new RangeError('An input event needs seconds, a named channel and a set or pulse kind');
    const row = Object.freeze({ time: seconds, channel, kind, value: control(value),
      ...(exact && { timecode: Object.freeze({ ...timecode }) }) });
    pointTimes.set(row, point);
    return row;
  }
  function initialState(initial) {
    if (!plain(initial) || Object.keys(initial).length > 1024 || !Object.keys(initial).every(id))
      throw new RangeError('A recording needs bounded named input channels');
    return Object.freeze(Object.fromEntries(Object.entries(initial).map(([key, value]) => [key, control(value)])));
  }

  function recording({ events, initial = {}, format: kind, version } = {}) {
    if (kind !== undefined && (kind !== format || version !== 1) || version !== undefined && version !== 1 ||
        !Array.isArray(events) || events.length > maxEvents) throw new TypeError('Invalid version 1 input recording');
    const state = initialState(initial);
    const entries = Array.from(events, event).sort((a, b) => T.compare(pointTimes.get(a), pointTimes.get(b)));
    if (new Set([...Object.keys(state), ...entries.map(entry => entry.channel)]).size > 1024)
      throw new RangeError('Input recording exceeds its channel budget');
    return Object.freeze({ format, version: 1, initial: state, events: Object.freeze(entries) });
  }

  function recorder(initial = {}) {
    const state = initialState(initial), events = [], channels = new Set(Object.keys(state));
    function append(value) {
      if (events.length >= maxEvents) throw new RangeError('Input recording exceeds its event budget');
      const row = event(value);
      if (channels.size >= 1024 && !channels.has(row.channel)) throw new RangeError('Input recording exceeds its channel budget');
      channels.add(row.channel);
      events.push(row);
      return row;
    }
    return Object.freeze({ append, snapshot: () => recording({ initial: state, events }) });
  }

  function seek(rows, time, inclusive = false, aligned = false, exact = false) {
    let a = 0, b = rows.length;
    while (a < b) {
      const middle = (a + b) >> 1, t = rows[middle].time;
      const order = exact ? T.compare(pointTimes.get(rows[middle]), time) :
        t === time || aligned && Math.abs(t - time) <= 8 * Number.EPSILON * Math.max(1, Math.abs(time)) ? 0 : t - time;
      if (order === 0 ? inclusive : order < 0) a = middle + 1;
      else b = middle;
    }
    return a;
  }

  function inputReplay(input) {
    const source = recording(input), tracks = new Map();
    for (const row of source.events) if (row.kind === 'set') {
      if (!tracks.has(row.channel)) tracks.set(row.channel, []);
      tracks.get(row.channel).push(row);
    }
    return Object.freeze({ source, sample(options = {}) {
      const { time = 0, offset = 0, from, take } = options;
      const frame = clock(time, options);
      const timing = take === undefined ? null : T.requireFrame(take);
      const mediaOffset = timing ? T.read(offset) : offset;
      const local = seconds => timing ? T.sub(T.read(seconds), mediaOffset) : seconds - mediaOffset;
      const coordinate = seconds => timing ? T.sub(seconds, mediaOffset) : local(seconds);
      const at = coordinate(timing?.start ?? (options.frame === undefined ? time : frame.start));
      const start = coordinate(timing?.start ?? frame.start), end = coordinate(timing?.end ?? frame.end);
      const aligned = options.frame !== undefined, exact = Boolean(timing);
      if (!range(exact ? T.seconds(mediaOffset) : offset, -1e9, 1e9) || from !== undefined &&
          (exact ? T.compare(local(from), at) > 0 : !range(from, -1e9, 1e9) || from > at + offset))
        throw new RangeError('Invalid input replay offset or interval');
      const state = { ...source.initial };
      for (const [channel, rows] of tracks) {
        const index = seek(rows, at, true, aligned, exact);
        if (index) state[channel] = rows[index - 1].value;
      }
      const begin = from === undefined ? seek(source.events, start, false, true, exact) : seek(source.events, local(from), true, false, exact);
      const until = from === undefined ? seek(source.events, end, false, true, exact) : seek(source.events, at, true, false, exact);
      const events = source.events.slice(begin, until);
      return { value: state, events, pulses: events.filter(row => row.kind === 'pulse'),
        report: { ...frame, sampleTime: exact ? T.seconds(at) : at } };
    } });
  }

  function actions(state, contexts, context) {
    return P.inputActions.compile(contexts).sample(context, [Object.fromEntries(Object.entries(state).flatMap(([key, value]) =>
      Number.isFinite(value) || typeof value === 'boolean' ? [[key, Number(value)]] : []))]);
  }

  Object.assign(A, { recording, recorder, inputReplay, actions });
})(KIT.procedural);
