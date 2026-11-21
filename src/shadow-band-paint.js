/* Signed paint along rest-space brush paths. */
const ShadowBandPaint = (() => {
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const range = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
  const xyz = point => Array.isArray(point) && point.length === 3 && Array.from(point).every(n => range(n, -1e6, 1e6));

  function stroke(spec) {
    if (!record(spec) || Object.keys(spec).some(key => !['points','radius','bias','softness'].includes(key)))
      throw new TypeError('Shadow band paint needs points, radius, bias and optional softness');
    const { points, radius, bias, softness = .16 } = spec;
    if (!Array.isArray(points) || !points.length || points.length > 1024 || !Array.from(points).every(xyz) ||
        !range(radius, 1e-5, 1e4) || !range(bias, -1, 1) || !range(softness, 0, 1))
      throw new RangeError('Shadow band paint needs finite XYZ points, positive radius, bias in [-1, 1] and softness in [0, 1]');
    return { points: points.map(point => point.slice()), radius, bias, softness };
  }

  function prepare(strokes) {
    if (!Array.isArray(strokes) || strokes.length > 256)
      throw new RangeError('Shadow band paint needs a list of up to 256 strokes');
    const paths = Array.from(strokes, spec => {
      const { points, radius, bias, softness } = stroke(spec);
      const first = points[0], min = first.slice(), max = first.slice();
      for (const point of points) for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], point[axis]);
        max[axis] = Math.max(max[axis], point[axis]);
      }
      const segments = points.map(([x,y,z], i) => {
        const end = points[i+1] ?? points[i], dx=end[0]-x, dy=end[1]-y, dz=end[2]-z;
        return { x,y,z,dx,dy,dz,inverse:1/(dx*dx+dy*dy+dz*dz || 1) };
      });
      return { min:min.map(n=>n-radius), max:max.map(n=>n+radius), radius, bias, softness, segments };
    });
    return ([x,y,z]) => {
      let value = 0;
      for (const { min,max,radius,bias,softness,segments } of paths) {
        if (x<min[0] || x>max[0] || y<min[1] || y>max[1] || z<min[2] || z>max[2]) continue;
        let nearest = radius*radius;
        for (const segment of segments) {
          const ox=x-segment.x, oy=y-segment.y, oz=z-segment.z;
          const t=Math.max(0,Math.min(1,(ox*segment.dx+oy*segment.dy+oz*segment.dz)*segment.inverse));
          const distance=(ox-t*segment.dx)**2+(oy-t*segment.dy)**2+(oz-t*segment.dz)**2;
          nearest=Math.min(nearest,distance);
        }
        if (nearest >= radius*radius) continue;
        const u=softness ? Math.min(1,(1-Math.sqrt(nearest)/radius)/softness) : 1;
        value = u===1 ? bias : value+(bias-value)*u*u*(3-2*u);
      }
      return value;
    };
  }

  const level = (incidence, visibility, bias = 0) => Math.max(0,Math.min(1,incidence-bias))*visibility;
  return Object.freeze({ stroke, prepare, level });
})();
if (typeof module !== 'undefined') module.exports = ShadowBandPaint;
