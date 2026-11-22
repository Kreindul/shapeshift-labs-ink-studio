/* Stepped palette colors sampled from the geometric normal and the camera ray. */
const FacingColors = (() => {
  const width = 512, bandLimit = 8, rampLimit = 64;
  const record = value => value && Object.getPrototypeOf(value) === Object.prototype;
  const rgb = color => [(color >> 16 & 255) / 255, (color >> 8 & 255) / 255, (color & 255) / 255];

  function prepare(value, palette, { inheritedRamp, resolveColor, validateOnly = false } = {}) {
    if (value === undefined || value === false) return null;
    if (!record(value) || Object.keys(value).some(key => !['mode', 'bands', 'ramp'].includes(key)))
      throw new TypeError('Invalid facingColors material settings');
    const { mode = 'replace', bands, ramp = inheritedRamp } = value;
    if (!['replace', 'shift'].includes(mode) || !Array.isArray(bands) || !bands.length || bands.length > bandLimit)
      throw new TypeError('facingColors needs replace or shift mode and one to eight bands');
    const color = swatch => {
      if (typeof swatch === 'string' && /^#[0-9a-f]{6}$/i.test(swatch)) return rgb(parseInt(swatch.slice(1), 16));
      if (Number.isInteger(swatch) && swatch >= 0 && Number.isInteger(palette[swatch])) return rgb(palette[swatch]);
      if (typeof swatch === 'string' && swatch && !swatch.startsWith('#') && resolveColor) return resolveColor(swatch);
      if (Array.isArray(swatch) && swatch.length === 3 && [...swatch].every(n => Number.isFinite(n) && n >= 0 && n <= 1))
        return swatch.slice();
      throw new TypeError('Facing colors must be palette slots, roles, #rrggbb, or normalized RGB triples');
    };
    let previous = -1;
    const stops = Array.from(bands, band => {
      const key = mode === 'shift' ? 'steps' : 'color';
      if (!record(band) || Object.keys(band).some(field => field !== 'maxAngle' && field !== key))
        throw new TypeError('Invalid facingColors band');
      const { maxAngle } = band;
      if (!Number.isFinite(maxAngle) || maxAngle < 0 || maxAngle <= previous || maxAngle > 90)
        throw new RangeError('Facing band angles must strictly increase from 0 to 90 degrees');
      previous = maxAngle;
      const cosine = maxAngle === 90 ? 0 : Math.fround(Math.cos(maxAngle * Math.PI / 180));
      if (mode === 'replace') return { cosine, color: band.color === null ? null : color(band.color) };
      if (!Number.isInteger(band.steps) || Math.abs(band.steps) >= rampLimit)
        throw new RangeError('Facing ramp steps must be integers from -63 to 63');
      return { cosine, steps: band.steps };
    });
    if (previous !== 90) throw new RangeError('The last facing band must end at 90 degrees');
    if (mode === 'replace' && value.ramp !== undefined) throw new TypeError('Only shift mode accepts a facing ramp');
    let colors = [];
    if (mode === 'shift' && !(validateOnly && ramp === undefined)) {
      if (!Array.isArray(ramp) || !ramp.length || ramp.length > rampLimit)
        throw new RangeError('Facing ramp shifts need one to 64 material swatches');
      colors = Array.from(ramp, color);
    }
    return { mode, stops, colors };
  }

  function shade(profile, base, normal, view, output = base) {
    if (!profile) return output;
    const area = Math.hypot(...normal) * Math.hypot(...view);
    if (!(area >= 1e-8)) return output;
    const cosine = Math.abs((normal[0] * view[0] + normal[1] * view[1] + normal[2] * view[2]) / area);
    const band = profile.stops.find(stop => cosine >= stop.cosine);
    let swatch = band.color;
    if (band.steps) {
      let nearest = 0, error = Infinity;
      for (const [i, color] of profile.colors.entries()) {
        const distance = (base[0] - color[0]) ** 2 + (base[1] - color[1]) ** 2 + (base[2] - color[2]) ** 2;
        if (distance < error) { nearest = i; error = distance; }
      }
      swatch = profile.colors[Math.max(0, Math.min(profile.colors.length - 1, nearest + band.steps))];
    }
    if (swatch) for (let i = 0; i < 3; i++) output[i] = swatch[i];
    return output;
  }

  function table(world, prepareSurface) {
    if (!world.surfaceData || !world.surfaces?.some(entry => entry.settings.facingColors)) return null;
    const profiles = [], byDefinition = new Map();
    const slots = world.surfaces.map(({ settings, facingRamp }) => {
      if (!settings.facingColors) return 0;
      const profile = prepareSurface(settings, facingRamp);
      if (!profile) return 0;
      const key = JSON.stringify(profile);
      if (!byDefinition.has(key)) byDefinition.set(key, profiles.push(profile));
      return byDefinition.get(key);
    });
    const rows = Math.ceil(world.count / width);
    const height = rows + profiles.length;
    const data = new Float32Array(width * height * 4);
    const posed = [];
    for (let i = 0; i < world.count; i++) {
      const at = i * 8, slot = slots[world.surfaceData[at] - 1];
      if (!slot) continue;
      const offset = i * 4;
      data.set(world.surfaceData.subarray(at + 1, at + 4), offset);
      data[offset + 3] = (rows + slot) * (world.pix?.[at] ? -1 : 1);
      if (world.anim?.rig?.bid[i]) posed.push(i);
    }
    for (const [i, profile] of profiles.entries()) {
      const at = (rows + i) * width * 4;
      data.set([profile.stops.length, profile.colors.length, Number(profile.mode === 'shift'), 0], at);
      profile.stops.forEach((band, j) => {
        const color = band.color ?? [band.steps ?? 0, 0, band.color === null ? -1 : 0];
        data.set([...color, band.cosine], at + (j + 1) * 4);
      });
      profile.colors.forEach((color, j) => data.set(color, at + (j + 1 + bandLimit) * 4));
    }
    return { data, height, posed, count: world.count };
  }

  function pose(binding, world, time, frames) {
    if (!binding.posed.length) return false;
    const sample = frames(world, time);
    for (const i of binding.posed) {
      const kind = Math.round(world.data[i * 16 + 11]) & 15;
      const at = i * 8 + 1;
      // The vertex or indexed pixel shader applies GPU bone and orbit transforms.
      const normal = [5, 12, 13].includes(kind) ? null : sample(i).normal;
      binding.data.set(normal ?? world.surfaceData.subarray(at, at + 3), i * 4);
    }
    return true;
  }

  const rowsGLSL = `
uniform highp sampler2D u_facingRows;
uniform int u_facingCount;
vec4 facingRow(int i) {
  ivec2 at = ivec2(i & 511, i >> 9);
  return i >= 0 && i < u_facingCount ? texelFetch(u_facingRows, at, 0) : vec4(0.0);
}
`;

  const transformGLSL = `
vec3 facingNormal(vec3 normal, mat3 transform) {
  return abs(determinant(transform)) > 1e-8 ? transpose(inverse(transform)) * normal : normal;
}
`;

  const shadeGLSL = `
vec3 facingShade(vec3 base, vec4 row, vec3 toEye) {
  float area = length(row.xyz) * length(toEye);
  if (row.w == 0.0 || area < 1e-8) return base;
  int profile = int(abs(row.w)) - 1;
  vec3 info = texelFetch(u_facingRows, ivec2(0, profile), 0).xyz;
  float cosine = abs(dot(row.xyz, toEye) / area);
  for (int i = 1; i <= int(info.x); i++) {
    vec4 band = texelFetch(u_facingRows, ivec2(i, profile), 0);
    if (cosine < band.w) continue;
    if (info.z < 0.5) return band.b < 0.0 ? base : band.rgb;
    int steps = int(band.r);
    if (steps == 0) return base;
    int nearest = 0;
    float error = 1e9;
    for (int j = 0; j < int(info.y); j++) {
      vec3 d = base - texelFetch(u_facingRows, ivec2(j + ${bandLimit + 1}, profile), 0).rgb;
      float distance = dot(d, d);
      if (distance < error) { error = distance; nearest = j; }
    }
    int swatch = clamp(nearest + steps, 0, int(info.y) - 1);
    return texelFetch(u_facingRows, ivec2(swatch + ${bandLimit + 1}, profile), 0).rgb;
  }
  return base;
}
vec3 facingRay(vec2 pixel, vec2 size, float focal, bool ortho) {
  return vec3(ortho ? vec2(0.0) : (size * 0.5 - pixel) / focal, 1.0);
}
`;

  const splatVertexGLSL = rowsGLSL + transformGLSL + `
uniform bool u_facingPattern;
flat out vec4 v_facing;
flat out float v_facingFog;
void facingVertex(int index, mat3 pose, mat4 view, bool patternOwner, float fog) {
  vec4 row = facingRow(index);
  if (row.w != 0.0 && !(row.w < 0.0 && u_facingPattern && patternOwner))
    row.xyz = mat3(view) * facingNormal(row.xyz, pose);
  else row.w = 0.0;
  v_facing = row;
  v_facingFog = fog;
}
`;

  const splatFragmentGLSL = rowsGLSL + shadeGLSL + `
uniform float u_facingGridScale;
flat in vec4 v_facing;
flat in float v_facingFog;
vec3 facingFragment(vec3 color, vec3 fog, vec2 viewport, float focal, bool ortho) {
  if (v_facing.w == 0.0 || v_facingFog >= 0.999) return color;
  float scale = max(1.0, u_facingGridScale);
  vec2 pixel = (floor(gl_FragCoord.xy / scale) + 0.5) * scale;
  vec3 base = clamp((color - fog * v_facingFog) / (1.0 - v_facingFog), 0.0, 1.0);
  vec3 next = facingShade(base, v_facing, facingRay(pixel, viewport, focal, ortho));
  return mix(next, fog, v_facingFog);
}
`;

  const indexedGLSL = rowsGLSL + shadeGLSL + transformGLSL + `
uniform highp sampler2D u_facingBones;
vec3 facingIndexedNormal(vec3 normal, int i, highp sampler2D splats, float time) {
  ivec2 at = ivec2((i & 511) * 4, i >> 9);
  int kind = int(round(texelFetch(splats, at + ivec2(2, 0), 0).w)) & 15;
  vec2 motion = texelFetch(splats, at + ivec2(3, 0), 0).xy;
  if (kind == 5) {
    float angle = time * motion.y, c = cos(angle), s = sin(angle);
    return mat3(c,0,-s, 0,1,0, s,0,c) * normal;
  }
  if (kind == 12 || kind == 13) {
    int iBone = int(round(motion.x)) * 3;
    ivec2 bone = ivec2(iBone % 768, iBone / 768);
    vec3 a = texelFetch(u_facingBones, bone, 0).xyz;
    vec3 b = texelFetch(u_facingBones, bone + ivec2(1, 0), 0).xyz;
    vec3 c = texelFetch(u_facingBones, bone + ivec2(2, 0), 0).xyz;
    return facingNormal(normal, transpose(mat3(a,b,c)));
  }
  return normal;
}
vec3 facingIndexed(vec3 color, int index, highp sampler2D splats, float time,
    mat4 view, vec2 pixel, vec2 size, float focal, bool ortho) {
  vec4 row = facingRow(index);
  if (row.w >= 0.0) return color;
  row.xyz = mat3(view) * facingIndexedNormal(row.xyz, index, splats, time);
  return facingShade(color, row, facingRay(pixel, size, focal, ortho));
}
`;

  return Object.freeze({ width, prepare, shade, table, pose, splatVertexGLSL, splatFragmentGLSL, indexedGLSL });
})();
if (typeof module !== 'undefined') module.exports = FacingColors;
