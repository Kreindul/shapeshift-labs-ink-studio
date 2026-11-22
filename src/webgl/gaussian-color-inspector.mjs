import { gaussianSplatColors } from '../gaussian-splats.mjs';
import { cameraLens } from './camera-lens.mjs';
import { cameraPose, makeCamera } from './view.mjs';

const minimumWeight = .018;
const inside = (u, v) => u >= 0 && u < 1 && v >= 0 && v < 1;

function screenPosition(camera, [x, y, z]) {
  const { view: m, projection: p } = camera;
  const depth = -(m[2]*x + m[6]*y + m[10]*z + m[14]);
  if (depth < camera.clipNear || depth > camera.clipFar) return null;
  const divisor = camera.ortho ? 1 : depth;
  const u = .5 + .5 * (m[0]*x + m[4]*y + m[8]*z + m[12]) * p[0] / divisor;
  const v = .5 - .5 * (m[1]*x + m[5]*y + m[9]*z + m[13]) * p[5] / divisor;
  return inside(u, v) ? [u, v] : null;
}

export function createGaussianColorInspector(renderer, world, { width, height }) {
  if (!world?.gaussianHarmonics || typeof renderer?.pick !== 'function' ||
      ![width, height].every(n => Number.isSafeInteger(n) && n > 0))
    throw new TypeError('A Gaussian color inspector needs a live imported world and palette grid size');

  let selection = null;
  function hits(camera, u, v, frame) {
    const { view, eye, tangent, ortho, clipNear, clipFar } = camera;
    const rayAt = cameraLens.rays(view, eye, width, height, height / (2 * tangent), ortho);
    const { origin, direction, axial } = rayAt(u * width, (1 - v) * height);
    return renderer.pick(world, {
      origin: origin.map((value, i) => value + direction[i] * clipNear / axial), direction,
      maxDistance: (clipFar - clipNear) / axial, soft: true, threshold: minimumWeight
    }, frame);
  }

  function select(u, v, frame = {}) {
    const hit = inside(u, v) ? hits(makeCamera(world, frame, width, height), u, v, frame).dominant : null;
    selection = hit && hit.weight >= minimumWeight && hit.index >= 0 && hit.index < world.gaussianHarmonics.count ?
      Object.freeze({ index: hit.index, point: Object.freeze(hit.point.slice()) }) : null;
    return selection;
  }

  function inspect(frame, readPalettePixel) {
    if (!selection) return null;
    const camera = makeCamera(world, frame, width, height), pose = cameraPose(camera);
    const { index, point } = selection;
    const uv = screenPosition(camera, point);
    const sample = { selection, index, uv, back: pose.back,
      ...gaussianSplatColors(world, index, { ...pose, ortho: camera.ortho }) };
    if (!uv) return { ...sample, state: 'offscreen' };
    const x = Math.floor(uv[0] * width), y = Math.floor(uv[1] * height);
    const { contributions } = hits(camera, (x + .5) / width, (y + .5) / height, frame);
    if (!contributions.some(hit => hit.index === index && hit.weight >= minimumWeight))
      return { ...sample, state: 'obscured' };
    const color = readPalettePixel(x, y);
    const slot = color ? world.pal.indexOf(color[0] << 16 | color[1] << 8 | color[2]) : -1;
    return { ...sample, state: 'visible', pixel: [x, y],
      swatch: slot >= 0 ? { index: slot, rgb: [color[0], color[1], color[2]] } : null };
  }

  return Object.freeze({ select, inspect, clear() { selection = null; } });
}

export function gaussianSwatchJump(before, after) {
  if (!before?.swatch || !after?.swatch || before.selection !== after.selection ||
      before.swatch.index === after.swatch.index) return null;
  const cosine = before.back.reduce((sum, value, axis) => sum + value * after.back[axis], 0);
  const degrees = Math.acos(Math.max(-1, Math.min(1, cosine))) * 180 / Math.PI;
  if (degrees < .001 || degrees > 2.00001) return null;
  const weights = [.30, .55, .15];
  const distance = Math.sqrt(before.swatch.rgb.reduce((sum, value, channel) =>
    sum + weights[channel] * (value - after.swatch.rgb[channel]) ** 2, 0));
  if (distance < 24) return null;
  return { from: before.swatch, to: after.swatch, degrees, distance };
}
