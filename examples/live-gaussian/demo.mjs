import { createRenderer } from '../../src/webgl/renderer.mjs';
import { decodeGaussianSplat, gaussianSplatWorld } from '../../src/gaussian-splats.mjs';
import { samplePly, sampleSpz, pelagicPalette } from '../webgpu-graphs/sample.mjs';

const get = id => document.getElementById(id);
const orbit = get('angle'), degrees = get('degrees'), play = get('play'), status = get('status');
const samples = [['ply', samplePly], ['spz', sampleSpz]];
const maxBytes = 768 * 1024 * 1024;
let views, drawCanvas, renderer, world, ticket = 0, playing = false, previous, request, angle = Number(orbit.value);

function frame(now) {
  request = undefined;
  if (playing && previous !== undefined) {
    angle = (angle + Math.min(.05, (now - previous) / 1000) * 28 + 180) % 360 - 180;
    orbit.value = Math.round(angle);
  }
  previous = now;
  degrees.value = orbit.value + '°';
  if (world) {
    const camera = { ...world.cam, yaw: angle * Math.PI / 180, pitch: -.08, dist: world.cam.dist * .94 };
    try {
      for (const { canvas, context } of views) {
        const { width, height } = canvas;
        renderer.render(world, {
          camera, gaussianColor: canvas.id, width, height, colored: false, dither: 0, damp: false, changedRows: []
        });
        context.drawImage(drawCanvas, 0, drawCanvas.height - height, width, height, 0, 0, width, height);
      }
    } catch (error) {
      errorStatus(error);
      world = undefined;
      setPlaying(false);
    }
  }
  if (playing) redraw();
}

function redraw() {
  request ??= requestAnimationFrame(frame);
}

function setPlaying(active) {
  playing = active;
  previous = undefined;
  play.textContent = active ? 'Pause' : 'Play';
  play.setAttribute('aria-pressed', active);
  if (active) redraw();
}

function errorStatus(error) {
  status.dataset.state = 'error';
  status.textContent = error.message;
}

async function open(name, read, mode) {
  const job = ++ticket;
  status.dataset.state = 'loading';
  status.textContent = 'Opening ' + name + '…';
  try {
    const cloud = await decodeGaussianSplat(await read(), { maxPoints: 2_000_000 });
    if (job !== ticket) return;
    world = gaussianSplatWorld(cloud, { colorMode: 'rgb', palette: pelagicPalette });
    status.dataset.state = 'ready';
    status.textContent = name + ' · ' + cloud.count.toLocaleString() + ' splats · SH degree ' + cloud.degree;
    for (const [id] of samples) get(id).setAttribute('aria-pressed', id === mode);
    redraw();
  } catch (error) {
    if (job === ticket) errorStatus(error);
  }
}

try {
  views = ['rgb', 'palette'].map(id => {
    const canvas = get(id);
    return { canvas, context: canvas.getContext('2d', { alpha: false }) };
  });
  drawCanvas = document.createElement('canvas');
  drawCanvas.width = views[0].canvas.width;
  drawCanvas.height = views[0].canvas.height;
  renderer = createRenderer(drawCanvas, { toolkit: { KIT, PixelLook } });
  orbit.addEventListener('input', () => {
    angle = Number(orbit.value);
    setPlaying(false);
    redraw();
  });
  play.addEventListener('click', () => setPlaying(!playing));
  for (const [id, read] of samples) get(id).addEventListener('click', () => open('Sample ' + id.toUpperCase(), read, id));
  get('file').addEventListener('change', event => {
    const file = event.currentTarget.files[0];
    if (file) void open(file.name, () => {
      if (file.size > maxBytes) throw new RangeError('Gaussian file exceeds the byte limit');
      return file.arrayBuffer();
    });
  });
  void open('Sample PLY', samplePly, 'ply');
} catch (error) {
  errorStatus(error);
  for (const id of ['angle', 'play', 'ply', 'spz', 'file']) get(id).disabled = true;
}
