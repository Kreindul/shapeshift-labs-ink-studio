// Read resolved color and ownership once for native art-pixel finish passes.
export function createArtPixelFinish(gl, { target, textureUnit, fullscreen, copy }) {
  const buffer = target();
  let rgba, scratch, rgb, splatId, protectedPixels;
  function read(source, bytes, width, height) {
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, source.framebuffer);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  }
  function finish(owner, detail, output, width, height, process) {
    const size = width * height;
    if (splatId?.length !== size) {
      rgba = new Uint8Array(size * 4);
      scratch = new Uint8Array(size * 4);
      rgb = new Uint8Array(size * 3);
      splatId = new Uint32Array(size);
      protectedPixels = new Uint8Array(size);
    }
    read(buffer, rgba, width, height);
    read(owner, scratch, width, height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const p = y * width + x, j = ((height - 1 - y) * width + x) * 4;
      splatId[p] = scratch[j] | scratch[j + 1] << 8 | scratch[j + 2] << 16;
      rgb[3 * p] = rgba[j];
      rgb[3 * p + 1] = rgba[j + 1];
      rgb[3 * p + 2] = rgba[j + 2];
    }
    if (detail) {
      if (detail !== buffer) read(detail, scratch, width, height);
      const marked = detail === buffer ? rgba : scratch;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++)
        protectedPixels[y * width + x] = Number(marked[((height - 1 - y) * width + x) * 4 + 3] < 192);
    }
    const result = process({ w: width, h: height, rgb }, { splatId, protected: detail && protectedPixels });
    textureUnit(8, buffer.textures[0]);
    if (result !== rgb) {
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const p = (y * width + x) * 3, j = ((height - 1 - y) * width + x) * 4;
        rgba[j] = result[p];
        rgba[j + 1] = result[p + 1];
        rgba[j + 2] = result[p + 2];
      }
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    }
    fullscreen(copy, output, width, height, { u_src: 8 });
  }
  return { buffer, finish };
}
