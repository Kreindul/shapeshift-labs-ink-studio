// Covered pixels carry the projected color. Uncovered pixels are black.
// Use the art-pixel grid for the ordered threshold so upscaling stays crisp.
const InkVeil = (() => {
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  function rank(x, y) {
    return (bayer[(Math.floor(x) & 3) + ((Math.floor(y) & 3) << 2)] + .5) / 16;
  }

  // The authored field returns signed distance, with the interior positive.
  function footprint(bounds, size, distance, feather = .4) {
    const [x0, z0, x1, z1] = bounds;
    if (bounds.length !== 4 || !bounds.every(Number.isFinite) || !(x1 > x0 && z1 > z0) ||
      !Number.isInteger(size) || size < 2 || size > 1024 || !(feather > 0 && Number.isFinite(feather)))
      throw new RangeError('Expected a nonempty footprint, a bounded integer size and a positive feather');
    const data = new Uint8Array(size * size);
    for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) {
      const d = distance(x0 + (x + .5) * (x1 - x0) / size, z0 + (z + .5) * (z1 - z0) / size);
      data[z * size + x] = Math.round(Math.max(0, Math.min(1, d / feather)) * 255);
    }
    return { bounds: bounds.slice(), size, data };
  }

  // A one-shot track accumulates soft world-space regions, then settles
  // to the fully visible scene. The caller owns the playback clock.
  function reveal(cues, settle) {
    if (cues.length < 1 || cues.length > 8 || settle.length !== 2 ||
        !settle.every(Number.isFinite) || settle[0] < 0 || settle[1] <= settle[0])
      throw new RangeError('Expected 1–8 reveal cues and an increasing settle interval');
    const centers = new Float32Array(cues.length * 4), extents = new Float32Array(cues.length * 4);
    for (const [i, cue] of cues.entries()) {
      if (cue.at.length !== 3 || cue.extent.length !== 3 || !cue.at.every(Number.isFinite) ||
          !cue.extent.every(v => Number.isFinite(v) && v > 0) ||
          ![cue.start, cue.end].every(Number.isFinite) || cue.start < 0 || cue.end <= cue.start)
        throw new RangeError('Expected a finite reveal center, positive extents and an increasing cue interval');
      centers.set(cue.at, i * 4);
      extents.set(cue.extent, i * 4);
    }
    const ease = n => {
      const t = Math.max(0, Math.min(1, n));
      return t * t * (3 - 2 * t);
    };
    const frame = { centers, extents, settled: 0 };
    return {
      duration: settle[1],
      sample(seconds) {
        for (const [i, cue] of cues.entries()) {
          const age = (seconds - cue.start) / (cue.end - cue.start), t = ease(age);
          centers[i * 4 + 3] = ease(age * 4);
          extents[i * 4 + 3] = .18 + .82 * t;
        }
        frame.settled = ease((seconds - settle[0]) / (settle[1] - settle[0]));
        return frame;
      }
    };
  }

  const glsl = `
uniform bool u_inkOn, u_inkWater;
uniform vec4 u_inkPlane, u_inkBounds, u_inkPulse;
uniform vec3 u_inkCyan, u_inkWarm;
uniform int u_inkCount;
uniform vec4 u_inkSources[8]; // world xz, falloff radius, signed intensity
uniform sampler2D u_inkFootprint;
uniform int u_inkRevealCount;
uniform float u_inkRevealSettled;
uniform vec4 u_inkRevealCenters[8], u_inkRevealExtents[8];

float inkRank(ivec2 pixel) {
  const float ranks[16] = float[16](${bayer.map(i => i.toFixed(1)).join(',')});
  return (ranks[(pixel.x & 3) + ((pixel.y & 3) << 2)] + 0.5) / 16.0;
}

vec3 inkVeil(vec3 color, ivec2 pixel, vec2 resolution, float depth, mat3 view, vec3 eye,
  vec4 camera, bool ortho) {
  float rank = inkRank(ivec2(pixel.x, int(resolution.y) - 1 - pixel.y));
  float value = mix(dot(color, vec3(0.30, 0.49, 0.21)), max(color.r, max(color.g, color.b)), 0.46);
  float coverage = mix(1.0, smoothstep(u_inkPlane.y, u_inkPlane.z, value), u_inkPlane.w);

  vec2 screen = ((vec2(pixel) + 0.5) / resolution * 2.0 - 1.0) * camera.xy;
  mat3 inverseView = transpose(view);
  vec3 origin = eye + (ortho ? inverseView * vec3(screen, 0.0) : vec3(0.0));
  vec3 ray = inverseView * vec3(ortho ? vec2(0.0) : screen, -1.0);
  float surfaceDepth = mix(camera.z, camera.w, depth);
  vec3 position = origin + ray * surfaceDepth;
  // The ray has unit forward speed in camera coordinates, so the plane
  // intersection is directly comparable to the composited scene depth.
  if (u_inkWater && ray.y < -0.015 && origin.y > u_inkPlane.x) {
    float at = (u_inkPlane.x - origin.y) / ray.y;
    vec2 q = origin.xz + ray.xz * at;
    vec2 uv = (q - u_inkBounds.xy) / (u_inkBounds.zw - u_inkBounds.xy);
    if (at < surfaceDepth + 0.17 && all(greaterThan(uv, vec2(0.0))) && all(lessThan(uv, vec2(1.0)))) {
      float shore = texture(u_inkFootprint, uv).r;
      if (shore > 0.0) {
        position = vec3(q.x, u_inkPlane.x, q.y);
        float cold = 0.0, warm = 0.0;
        for (int i = 0; i < 8; i++) {
          if (i >= u_inkCount) break;
          vec4 source = u_inkSources[i];
          vec2 d = (q - source.xy) / source.z;
          float strength = 1.0 - smoothstep(0.0, 1.0, dot(d,d));
          cold = max(cold, strength * source.w);
          warm = max(warm, -strength * source.w);
        }
        vec2 cursor = (q - u_inkPulse.xy) * vec2(0.82, 0.46);
        float beam = (1.0 - smoothstep(0.0, 2.1, dot(cursor,cursor))) * u_inkPulse.z;
        float t = u_inkPulse.w;
        float bent = q.x * 5.7 + sin(q.y * 2.8 - t * 0.82) * 1.3 + sin(t + q.y * 1.14) * 0.7;
        float lace = 1.0 - smoothstep(0.04, 0.41, abs(sin(bent) + 0.42 * sin(q.y * 6.2 + t * 0.9)));
        float ripples = 1.0 - smoothstep(0.03, 0.22, abs(sin(q.y * 5.38 + 0.4 * sin(bent) - t * 1.32)));
        float light = max(cold, warm) + beam * 0.52;
        float whitewater = clamp((lace * 0.58 + ripples * 0.42) * (light + beam * 0.34), 0.0, 1.0);
        float painted = shore * clamp(0.025 + light * (0.60 + 0.32 * lace) + whitewater * 0.38, 0.0, 1.0);
        vec3 neon = mix(u_inkCyan, u_inkWarm, warm / max(0.01, cold + warm + beam));
        vec3 wash = neon * (0.12 + 0.40 * light + 0.52 * whitewater);
        color = mix(color * 0.44, max(color * 0.69, wash), shore);
        coverage = mix(coverage, painted, shore);
      }
    }
  }
  if (u_inkRevealCount > 0) {
    float shown = u_inkRevealSettled;
    for (int i = 0; i < 8; i++) {
      if (i >= u_inkRevealCount) break;
      vec4 cue = u_inkRevealCenters[i], area = u_inkRevealExtents[i];
      vec3 offset = (position - cue.xyz) / (area.xyz * area.w);
      shown = max(shown, cue.w * (1.0 - smoothstep(0.47, 1.00, dot(offset,offset))));
    }
    coverage *= shown;
  }
  return coverage >= rank ? color : vec3(0.0);
}
`;

  return Object.freeze({ rank, footprint, reveal, glsl });
})();
if (typeof module !== 'undefined') module.exports = InkVeil;
