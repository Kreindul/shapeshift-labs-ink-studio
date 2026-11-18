/* Ordered height contributions and their ownership. The caller supplies the
   bounded masks and spatial index used to select layers for each point. */
(function (K) {
  function sample(layers, x, z) {
    let delta = 0, owner = null, coverage = 0;
    for (const layer of layers) {
      const { min, max } = layer.bounds;
      if (x < min[0] || x > max[0] || z < min[2] || z > max[2]) continue;
      const w = layer.weight(x, z);
      if (w <= 0) continue;

      const { operation, height } = layer.parameters;
      if (operation === 'erase') {
        if (w === 1) {
          delta = 0;
          coverage = 0;
          owner = null;
        } else {
          delta *= 1 - w;
          coverage *= 1 - w;
        }
        continue;
      }

      const h = height * w;
      if (operation === 'add') delta += h;
      else if (operation === 'max') delta = Math.max(delta, h);
      else if (operation === 'min') delta = Math.min(delta, h);
      else delta = delta * (1 - w) + h;
      owner = layer.entity.id;
      coverage = Math.max(coverage, w);
    }
    return { delta, owner, coverage };
  }

  function distance(layers, x, z, id) {
    let d = Infinity, found = false;
    for (const layer of layers) {
      const erased = layer.parameters.operation === 'erase';
      if (id !== undefined && !found) {
        if (!erased && layer.entity.id === id) {
          found = true;
          d = layer.support(x, z);
        }
        continue;
      }
      if (id === undefined && !erased) d = Math.min(d, layer.support(x, z));
      else if (d < Infinity) d = Math.max(d, -layer.support(x, z));
    }
    return d;
  }

  K.heightLayers = Object.freeze({ sample, distance });
})(KIT);
