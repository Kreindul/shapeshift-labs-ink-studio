/* Reuse retained depth buckets with smaller transient streams. */
const SplatOrder = (() => {
  const bins = 65536, never = () => false;
  const key = (depth, minimum, scale) => Math.max(0, Math.min(bins - 1, (depth - minimum) * scale | 0));

  function compile(indices, depthAt, behind = never) {
    if (!indices.length) return null;
    const depths = new Float32Array(indices.length);
    let minimum = Infinity, maximum = -Infinity;
    for (let i = 0; i < indices.length; i++) {
      const index = indices[i], depth = depthAt(index);
      if (!Number.isInteger(index) || index < 0 || index > 0x7fffffff ||
          (i > 0 && index <= indices[i - 1]) || !Number.isFinite(depth))
        throw new Error('Depth sorting needs increasing nonnegative integer indices and finite depths');
      depths[i] = depth;
      minimum = Math.min(minimum, depth);
      maximum = Math.max(maximum, depth);
    }
    const scale = (bins - 1) / (maximum - minimum || 1);
    const backKey = key(Math.fround(minimum), minimum, scale);
    const counts = new Uint32Array(bins), keys = new Uint16Array(indices.length);
    for (let i = 0; i < indices.length; i++) {
      const bucket = behind(indices[i]) ? backKey : key(depths[i], minimum, scale);
      keys[i] = bucket;
      counts[bucket]++;
    }
    let prefix = 0;
    for (let i = 0; i < bins; i++) {
      const count = counts[i];
      counts[i] = prefix;
      prefix += count;
    }
    const order = new Int32Array(indices.length), sortedKeys = new Uint16Array(indices.length);
    for (let i = 0; i < indices.length; i++) {
      const bucket = keys[i], position = counts[bucket]++;
      order[position] = indices[i];
      sortedKeys[position] = bucket;
    }
    return Object.freeze({ minimum, maximum, scale, backKey, order, keys: sortedKeys });
  }

  function merge(retained, indices, depthAt, behind, result, keysByIndex) {
    if (result.length < retained.order.length + indices.length) throw new Error('Depth order target is too small');
    for (const index of indices) {
      const depth = depthAt(index);
      if (!Number.isSafeInteger(index) || index < 0 || index >= keysByIndex.length || !Number.isFinite(depth))
        throw new Error('Depth sorting needs in-range indices and finite depths');
      // A changing range requires rebuilding the original buckets, including
      // ties. Let the caller perform its full sort with all current depths.
      if (depth < retained.minimum || depth > retained.maximum) return false;
      keysByIndex[index] = behind(index) ? retained.backKey : key(Math.fround(depth), retained.minimum, retained.scale);
    }
    indices.sort((a, b) => keysByIndex[a] - keysByIndex[b] || a - b);
    const { order, keys } = retained;
    let i = 0, at = 0;
    for (const index of indices) {
      const depth = keysByIndex[index];
      while (i < order.length && (keys[i] < depth || (keys[i] === depth && order[i] < index))) {
        result[at++] = order[i++];
      }
      result[at++] = index;
    }
    result.set(order.subarray(i), at);
    return true;
  }

  return Object.freeze({ compile, merge });
})();
if (typeof module !== 'undefined') module.exports = SplatOrder;
