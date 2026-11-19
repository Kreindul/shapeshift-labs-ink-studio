// Each side retains its own palette and lighting. Compare the aperture plane
// with the source scene's packed coverage depth at every output pixel.
export const portalComposite = `#version 300 es
precision highp float;
uniform sampler2D u_source, u_destination, u_coverDepth;
uniform vec3 u_origin, u_right, u_up, u_normal, u_eye;
uniform mat4 u_portalView, u_portalProj;
uniform vec3 u_settings;
uniform vec2 u_half, u_size;
uniform int u_opening;
uniform float u_fade;
out vec4 o;
bool throughOpening() {
  vec2 p = (gl_FragCoord.xy / u_size * 2.0 - 1.0) * u_settings.xy;
  bool ortho = u_settings.z > 0.5;
  mat3 world = transpose(mat3(u_portalView));
  vec3 eye = u_eye + (ortho ? world * vec3(p, 0.0) : vec3(0));
  vec3 ray = world * vec3(ortho ? vec2(0) : p, -1.0);
  float towards = dot(ray, u_normal);
  if (towards >= -1e-7) return false;
  float t = dot(u_origin - eye, u_normal) / towards;
  if (t <= 0.0 || t >= 400.0) return false;
  vec3 at = eye + ray * t;
  vec3 relative = at - u_origin;
  vec2 local = vec2(dot(relative, u_right), dot(relative, u_up)) / u_half;
  if (u_opening == 2 ? dot(local, local) > 1.0 : any(greaterThan(abs(local), vec2(1.0)))) return false;
  vec4 coverage = texelFetch(u_coverDepth, ivec2(gl_FragCoord.xy), 0);
  if (coverage.a > 0.5) {
    vec3 bytes = floor(coverage.rgb * 255.0 + 0.5);
    float solid = dot(bytes, vec3(1.0, 256.0, 65536.0)) / 16777215.0;
    vec4 clip = u_portalProj * (u_portalView * vec4(at, 1.0));
    float plane = clip.z / clip.w * 0.5 + 0.5;
    if (solid <= plane + 1e-6) return false;
  }
  return true;
}
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec3 color = u_opening != 0 && throughOpening() ? texelFetch(u_destination, p, 0).rgb :
    texelFetch(u_source, p, 0).rgb;
  o = vec4(color * (1.0 - u_fade), 1.0);
}`;
