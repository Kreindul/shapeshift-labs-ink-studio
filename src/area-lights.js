/* Runtime rectangular and elliptical emitters for direct lighting and captures. */
const AreaLights = (() => {
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const fields = ['id', 'at', 'normal', 'up', 'shape', 'size', 'color', 'intensity', 'radius', 'sampleGrid',
    'twoSided', 'visible', 'reflection', 'shadows', 'shadowSteps', 'bias'];
  const vector = a => Array.isArray(a) && a.length === 3 && Array.from(a).every(Number.isFinite);
  const cross = ([x,y,z],[a,b,c]) => [y*c-z*b,z*a-x*c,x*b-y*a];
  const unit = (vector, label) => {
    const length = Math.hypot(...vector);
    if (!Number.isFinite(length) || length < 1e-8) throw new RangeError(label + ' needs a nonzero direction');
    return vector.map(n => n/length);
  };
  const between = (n, low, high) => Number.isFinite(n) && n >= low && n <= high;
  function disk(x,y) {
    if (!x && !y) return [0,0];
    const wide = Math.abs(x) > Math.abs(y), radius = wide ? x : y;
    const angle = Math.PI/4 * (wide ? y/x : 2 - x/y);
    return [radius*Math.cos(angle),radius*Math.sin(angle)];
  }

  function prepare(value) {
    if (value === undefined || value === false) return [];
    if (!Array.isArray(value) || value.length > 16) throw new TypeError('Area lights need an array of up to 16 emitters');
    const ids = new Set();
    return Array.from(value, light => {
      if (!record(light) || Object.keys(light).some(key => !fields.includes(key)))
        throw new TypeError('Invalid area light fields');
      const { id, at, normal: facing = [0,0,1], shape = 'rectangle', size, color = '#fff2dd',
        intensity = 2, radius = 6, sampleGrid = 4, shadowSteps, bias = .025,
        twoSided = false, visible = true, reflection = true, shadows = true } = light;
      if (typeof id !== 'string' || !id.trim() || ids.has(id)) throw new TypeError('Area lights need unique IDs');
      ids.add(id);
      if (!vector(at) || !vector(facing) || light.up !== undefined && !vector(light.up) ||
          !Array.isArray(size) || size.length !== 2 || !Array.from(size).every(n => between(n, .001, 1000)) ||
          !['rectangle','disk'].includes(shape)) throw new RangeError('Area lights need a position, orientation and positive rectangle or disk size');
      if (!between(intensity, 0, 64) || !between(radius,.001,1000) || !between(bias,.001,.25) ||
          !Number.isInteger(sampleGrid) || !between(sampleGrid,1,8) ||
          shadowSteps !== undefined && (!Number.isInteger(shadowSteps) || !between(shadowSteps,2,16)) ||
          [twoSided,visible,reflection,shadows].some(value => typeof value !== 'boolean') ||
          typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color))
        throw new RangeError('Invalid area light intensity, radius, sampling, shadow or color settings');
      const normal = unit(facing,'Area light normal');
      const u = unit(cross(light.up ?? (Math.abs(normal[1]) > .95 ? [0,0,1] : [0,1,0]),normal),'Area light up');
      const v = cross(normal,u), half = size.map(n=>n*.5), points = [];
      for (let y=0;y<sampleGrid;y++) for (let x=0;x<sampleGrid;x++) {
        const a=2*(x+.5)/sampleGrid-1, b=2*(y+.5)/sampleGrid-1;
        const [s,t] = shape === 'disk' ? disk(a,b) : [a,b];
        points.push(at.map((p,k)=>p+s*half[0]*u[k]+t*half[1]*v[k]));
      }
      const rgb = [1,3,5].map(i=>parseInt(color.slice(i,i+2),16)/255);
      return { id, at:at.slice(), normal, u, v, half, shape, rgb, intensity, radius, points,
        twoSided, visible, reflection, shadows, shadowSteps, bias };
    });
  }
  return Object.freeze({ prepare });
})();
if (typeof module !== 'undefined') module.exports = AreaLights;
