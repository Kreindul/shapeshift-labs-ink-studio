/* One advected cloud coverage grid, sampled in world space for sky and shadows. */
const CloudField = (() => {
  const brand = Symbol.for('ink-studio.cloud-field');
  const wrap = (value, size) => ((value % size) + size) % size;
  const mix = (a, b, t) => a + (b - a) * t;
  const record = (value, name) => {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(name + ' needs an object');
    return value;
  };
  const vector = (value, size, name) => {
    if (!Array.isArray(value) || value.length !== size || !Array.from(value).every(Number.isFinite))
      throw new TypeError(name + ' needs ' + size + ' finite numbers');
    return value.slice();
  };
  const number = (value, lo, hi, name) => {
    if (!Number.isFinite(value) || value < lo || value > hi) throw new RangeError(name + ' is out of range');
    return value;
  };
  function shadowSettings(authored, override, profile = {}) {
    const enabled = override ?? authored;
    if (enabled === false || enabled === undefined) return null;
    const settings = value => value === true || value === false || value === undefined ? {} : record(value, 'Cloud shadows');
    const merged = { ...settings(authored), ...settings(override ?? undefined) };
    if (Object.keys(merged).some(key => !['strength', 'softness', 'direction'].includes(key)))
      throw new TypeError('Cloud shadows need strength, softness or direction settings');
    const { strength = profile.cloudShadowStrength ?? .72, softness = profile.cloudShadowSoftness ?? .7, direction } = merged;
    number(strength, 0, 1, 'Cloud shadow strength');
    number(softness, 0, 1000, 'Cloud shadow softness');
    if (direction !== undefined) {
      const length = Math.hypot(...vector(direction, 3, 'Cloud light direction'));
      if (!length || !Number.isFinite(length)) throw new RangeError('Cloud light direction must be nonzero');
    }
    return strength ? { strength, softness, direction } : null;
  }

  function compile(value) {
    if (value?.[brand] === true) return value;
    const { bounds, resolution = [48,48], coverage, velocity = [0,0], height = 8,
      color = '#d9e0ed', opacity = .85, repeat = false, visible = true } = record(value, 'Cloud field');
    const [minX,minZ] = vector(bounds?.min, 2, 'Cloud field minimum');
    const [maxX,maxZ] = vector(bounds?.max, 2, 'Cloud field maximum');
    const [width, rows] = vector(resolution, 2, 'Cloud resolution');
    const [vx,vz] = vector(velocity, 2, 'Cloud velocity');
    if (!(maxX > minX && maxZ > minZ) || !Number.isFinite((maxX-minX)+(maxZ-minZ)))
      throw new RangeError('Cloud bounds must have finite positive extent');
    if (![width,rows].every(n => Number.isInteger(n) && n >= 2 && n <= 256))
      throw new RangeError('Cloud resolution must be 2–256 samples per axis');
    number(height, -1e6, 1e6, 'Cloud height');
    number(opacity, 0, 1, 'Cloud opacity');
    if (typeof repeat !== 'boolean' || typeof visible !== 'boolean') throw new TypeError('Cloud repeat and visible must be boolean');
    if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) throw new TypeError('Cloud color needs #rrggbb');
    const rgb = [1,3,5].map(i => parseInt(color.slice(i,i+2),16)/255);
    const sx = (maxX-minX)/width, sz = (maxZ-minZ)/rows;
    const cells = new Float32Array(width*rows);
    const generate = typeof coverage === 'function';
    if (!generate && (!(Array.isArray(coverage) || ArrayBuffer.isView(coverage)) || coverage.length !== cells.length))
      throw new TypeError('Cloud coverage needs a row-major grid matching its resolution or a sample function');
    for (let z=0;z<rows;z++) for (let x=0;x<width;x++) {
      const i=z*width+x;
      cells[i]=number(generate ? coverage(minX+(x+.5)*sx,minZ+(z+.5)*sz) : coverage[i],0,1,'Cloud coverage');
    }
    function cell(data, x, z) {
      if (repeat) return data[wrap(z, rows)*width+wrap(x,width)];
      return x >= 0 && x < width && z >= 0 && z < rows ? data[z*width+x] : 0;
    }
    function pass(data, sigma, across) {
      if (sigma < .2) return data;
      const dimension = across ? width : rows;
      const extent = Math.min(dimension, Math.ceil(3*sigma));
      const weights = Array.from({length:2*extent+1}, (_,i) => Math.exp(-.5*((i-extent)/sigma)**2));
      const total = weights.reduce((sum,n)=>sum+n,0);
      const result = new Float32Array(data.length);
      for (let z=0;z<rows;z++) for (let x=0;x<width;x++) {
        let sum=0;
        for (let d=-extent;d<=extent;d++)
          sum+=weights[d+extent]*cell(data,across?x+d:x,across?z:z+d);
        result[z*width+x]=sum/total;
      }
      return result;
    }
    const cache = new Map();
    function softened(softness) {
      if (!softness) return cells;
      if (!cache.has(softness)) {
        if (cache.size >= 8) cache.delete(cache.keys().next().value);
        cache.set(softness, pass(pass(cells,softness/sx,true),softness/sz,false));
      }
      return cache.get(softness);
    }
    function frame(time, shadows, light = [-.52, .64, .57], displacement) {
      if (!Number.isFinite(time)) throw new RangeError('Cloud time is out of range');
      const [dx,dz] = vector(displacement ?? [vx*time,vz*time],2,'Cloud displacement');
      function sample(data, x, z) {
        if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
        const u=(x-minX-dx)/sx-.5, v=(z-minZ-dz)/sz-.5;
        if (!Number.isFinite(u) || !Number.isFinite(v)) return 0;
        const i=Math.floor(u), j=Math.floor(v);
        return mix(mix(cell(data,i,j),cell(data,i+1,j),u-i),
          mix(cell(data,i,j+1),cell(data,i+1,j+1),u-i),v-j);
      }
      let shadow = null;
      if (shadows) {
        const [lx,ly,lz] = shadows.direction ?? light;
        if (ly > 1e-5) {
          const map = softened(shadows.softness);
          const slopeX=lx/ly, slopeZ=lz/ly;
          shadow = (x,y,z) => y >= height ? 1 : 1 - shadows.strength * sample(map,
            x + (height-y)*slopeX, z + (height-y)*slopeZ);
        }
      }
      function paint(origin, direction, out) {
        if (!visible || !opacity || Math.abs(direction[1]) < 1e-8) return out;
        const distance=(height-origin[1])/direction[1];
        if (distance <= 0) return out;
        const amount=opacity*sample(cells,origin[0]+distance*direction[0],origin[2]+distance*direction[2]);
        for (let i=0;i<3;i++) out[i]=mix(out[i],rgb[i],amount);
        return out;
      }
      return { visible: visible && opacity > 0, coverage:(x,z)=>sample(cells,x,z), paint, shadow };
    }
    return Object.freeze({ [brand]:true, frame });
  }

  return Object.freeze({ compile, shadowSettings, dim: visibility => .35 + .65 * visibility });
})();
if (typeof module !== 'undefined') module.exports = CloudField;
