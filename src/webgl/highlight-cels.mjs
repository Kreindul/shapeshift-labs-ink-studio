const vertex = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_pixel;
layout(location=1) in vec3 a_rgb;
uniform vec2 u_size;
flat out vec3 v_rgb;
flat out float v_depth;
void main() {
  vec2 uv = (a_pixel.xy + .5) / u_size;
  gl_Position = vec4(2.0 * uv.x - 1.0, 1.0 - 2.0 * uv.y, 0.0, 1.0);
  gl_PointSize = 1.0;
  v_depth = a_pixel.z;
  v_rgb = a_rgb;
}`;

const fragment = `#version 300 es
precision highp float;
uniform sampler2D u_ownerDepth;
uniform vec2 u_depthRange;
flat in vec3 v_rgb;
flat in float v_depth;
out vec4 color;
void main() {
  vec4 owner = texelFetch(u_ownerDepth, ivec2(gl_FragCoord.xy), 0);
  float z = dot(round(owner.rgb * 255.0), vec3(1.0, 256.0, 65536.0)) / 16777215.0;
  if (owner.a > .5 && v_depth > mix(u_depthRange.x, u_depthRange.y, z) + .0001) discard;
  color = vec4(v_rgb, 1.0);
}`;

export function createHighlightCelDraw(gl, resources, textureUnit, api) {
  const shader = resources.program(vertex, fragment);
  const vao = resources.allocate('VertexArray'), buffer = resources.allocate('Buffer');
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  for (let i = 0; i < 2; i++) {
    gl.enableVertexAttribArray(i);
    gl.vertexAttribPointer(i, 3, gl.FLOAT, false, 24, i * 12);
  }
  return function draw(rows, width, height, output, depth, range) {
    const vertices = [];
    api.pixels(rows, width, height, (x, y, z, r, g, b) => vertices.push(x, y, z, r/255, g/255, b/255));
    if (!vertices.length) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, output);
    gl.viewport(0, 0, width, height);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, Float32Array.from(vertices), gl.DYNAMIC_DRAW);
    textureUnit(3, depth);
    gl.useProgram(shader.p);
    shader.set({ u_size: [width, height], u_ownerDepth: 3, u_depthRange: range });
    const dither = gl.isEnabled(gl.DITHER);
    gl.disable(gl.DITHER);
    gl.drawArrays(gl.POINTS, 0, vertices.length / 6);
    if (dither) gl.enable(gl.DITHER);
  };
}
