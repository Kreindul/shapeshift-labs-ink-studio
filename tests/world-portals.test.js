const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const core = require('..');
const { KIT } = core.load();
const { portals } = KIT.world;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const settle = () => new Promise(resolve => setImmediate(resolve));
const a = { origin: [0, 0, 0], normal: [0, 0, 1] };
const b = { origin: [8, 1, 4], normal: [1, 0, 0] };
const aperture = { halfWidth: 1.2, halfHeight: 1.5 };
const from = { place: 'a', anchor: 'door' }, to = { place: 'b', anchor: 'door' };

test('doorway crossing sweeps a bounded oriented aperture and maps poses and velocity', () => {
  const door = portals.doorway({ from: a, to: b, ...aperture });
  const reverse = portals.doorway({ from: b, to: a, ...aperture });
  assert.deepEqual(door.point([0, 0, -2]), [10, 1, 4]);
  assert.deepEqual(door.direction([0, 0, -3]), [3, 0, 0]);
  assert(KIT.V.dist(reverse.point(door.point([0.7, 3, -9])), [0.7, 3, -9]) < 1e-12);
  assert.equal(door.hit([3, 0, 1], [0, 0, -1]), null);
  assert.equal(door.hit([0, 0, -1], [0, 0, 1]), null);
  assert.equal(door.hit([1, 0, 2], [1, 0, -2], { radius: 0.3 }), null);
  assert.deepEqual(door.hit([0, 0, 1], [0, 0, -3]), { point: [0, 0, 0], fraction: 0.25 });
  const ellipse = portals.doorway({ from: a, to: b, ...aperture, shape: 'ellipse' });
  assert.equal(ellipse.hit([1.1, 1.3, 1], [1.1, 1.3, -1]), null);
  const camera = { eye: [0, 0, 4], right: [1, 0, 0], up: [0, 1, 0], back: [0, 0, 1] };
  assert.equal(JSON.stringify(door.camera(camera)),
    JSON.stringify({ eye: [4, 1, 4], right: [0, 0, 1], up: [0, 1, 0], back: [-1, 0, 0] }));
  assert.throws(() => portals.anchor({ ...a, up: [0, 0, 1] }), /independent/);
});

test('nearby preview is promoted once, gated, and keeps place state on the return trip', async () => {
  const held = deferred(), loads = [], released = [], assetB = { world: { name: 'dungeon' } };
  let unlocked = false, state = 1;
  const session = portals.create({
    places: [
      { id: 'a', anchors: { door: a }, prepare(context) {
        loads.push(['a', context.reason, context.state?.state]);
        state = context.state?.state ?? state;
        return { world: {}, checkpoint: () => ({ state }), dispose: () => released.push('a') };
      } },
      { id: 'b', anchors: { door: b }, prepare(context) { loads.push(['b', context.reason]); return held.promise; } }
    ],
    links: [
      { id: 'in', from, to, aperture, open: () => unlocked },
      { id: 'out', from: to, to: from, aperture }
    ]
  });
  const start = await session.enter('a');
  assert.equal(session.approach([0, 0, 2]), null);
  unlocked = true;
  const approach = session.approach([0, 0, 2]);
  assert.equal(session.approach([0, 0, 1]).ready, approach.ready);
  assert.equal(session.view(), null);
  held.resolve(assetB);
  await approach.ready;
  assert.equal(session.view().destination, assetB.world);
  const actor = { position: [0, 0, -1], velocity: [0, 0, -2], carried: { id: 'lamp' } };
  unlocked = false;
  assert.equal(await session.cross('in', { previous: [0, 0, 1], actor }), null);
  unlocked = true;
  state = 7;
  const crossed = await session.cross('in', { previous: [0, 0, 1], actor });
  assert.equal(crossed.place.asset, assetB);
  assert.equal(session.current(), crossed.place);
  assert.deepEqual(crossed.actor.position, [9, 1, 4]);
  assert.deepEqual(crossed.actor.velocity, [2, 0, 0]);
  assert.equal(crossed.actor.carried.id, 'lamp');
  assert.equal(Object.isFrozen(actor.carried), false);
  assert.equal(start.id, 'a');
  assert.deepEqual(session.checkpoint(), { place: 'b', saved: { a: { state: 7 } } });
  assert.equal(session.view(), null);
  await session.cross('out', { previous: [9, 1, 4], actor: { position: [7.5, 1, 4] } });
  assert.equal(session.current().id, 'a');
  assert.deepEqual(loads, [['a', 'enter', undefined], ['b', 'preview'], ['a', 'preview', 7]]);
  assert.deepEqual(released, ['a']);
  session.dispose();
});

test('preview replacement aborts an old load and disposes its late result', async () => {
  const held = deferred(), released = [];
  let signal;
  const session = portals.create({ places: [
    { id: 'a', anchors: { door: a }, prepare: () => ({}) },
    { id: 'b', anchors: { door: b }, prepare(context) { signal = context.signal; return held.promise; } }
  ], links: [{ id: 'in', from, to, aperture }] });
  await session.enter('a');
  const pending = session.approach([0, 0, 2]).ready;
  await settle();
  assert.equal(session.approach([0, 0, 12]), null);
  assert.equal(signal.aborted, true);
  held.resolve({ dispose: () => released.push('b') });
  assert.equal(await pending, null);
  assert.deepEqual(released, ['b']);
  assert.equal(session.current().id, 'a');
  session.dispose();
});

test('walking through a still-loading doorway retains that destination', async () => {
  const held = deferred();
  const session = portals.create({ places: [
    { id: 'a', anchors: { door: a }, prepare: () => ({}) },
    { id: 'b', anchors: { door: b }, prepare: () => held.promise }
  ], links: [{ id: 'in', from, to, aperture }] });
  await session.enter('a');
  const preview = session.approach([0, 0, 1]);
  const walking = session.cross('in', { previous: [0, 0, 1], actor: { position: [0, 0, -0.2] } });
  assert.equal(session.approach([0, 0, -0.2]), null);
  assert.equal(session.current().id, 'a');
  held.resolve({});
  assert.equal((await walking).place.asset, await preview.ready);
  assert.equal(session.current().id, 'b');
});

test('fade waits at black for readiness, arrives at the anchor, and recovers from failure', async () => {
  const held = deferred();
  const session = portals.create({ places: [
    { id: 'a', anchors: { door: a }, prepare: () => ({}) },
    { id: 'b', anchors: { door: b }, prepare: () => held.promise }
  ], links: [{ id: 'pool', from, to, mode: 'fade', radius: 1.5, duration: 1 }] });
  await session.enter('a');
  assert.equal(session.fade('pool', { actor: { position: [2, 0, 0] } }), null);
  const fade = session.fade('pool', { actor: { position: [0.3, 0, 0], velocity: [1, 0, 0] } });
  assert.equal(fade.advance(0.25).opacity, 0.5);
  assert.equal(fade.advance(1).phase, 'hold');
  assert.equal(session.current().id, 'a');
  const asset = {};
  held.resolve(asset);
  await settle();
  const swap = fade.advance(0);
  assert.equal(swap.opacity, 1);
  assert.equal(swap.place.asset, asset);
  assert.deepEqual(swap.arrival.actor.position, b.origin);
  assert.deepEqual(swap.arrival.actor.velocity, [0, 0, 0]);
  assert.equal(fade.advance(0.5).phase, 'done');
  session.dispose();

  const fail = portals.create({ places: [
    { id: 'a', anchors: { door: a }, prepare: () => ({}) },
    { id: 'b', anchors: { door: b }, prepare() { throw new Error('offline'); } }
  ], links: [{ id: 'pool', from, to, mode: 'fade', duration: 1 }] });
  await fail.enter('a');
  const play = fail.fade('pool', { actor: { position: [0, 0, 0] } });
  play.advance(0.5);
  await settle();
  const recovered = play.advance(0.5);
  assert.equal(recovered.phase, 'failed');
  assert.equal(recovered.opacity, 0);
  assert.equal(recovered.place.id, 'a');
  assert.match(recovered.error.message, /offline/);
});

function browserProbe(createRenderer) {
  const canvas = document.querySelector('canvas');
  const renderer = createRenderer(canvas, { toolkit: { KIT, PixelLook } });
  const gl = canvas.getContext('webgl2'), size = 65;
  const from = { origin: [0, 0, 0], normal: [0, 0, 1] };
  const to = { origin: [8, 0, 4], normal: [1, 0, 0] };
  const door = shape => KIT.world.portals.doorway({ from, to, halfWidth: 0.9, halfHeight: 0.9, shape });
  const s = makeBuilder(1, [0, 0xff2020, 0x20ff20]);
  s.disc(0, 0, -1, [0, 0, 1], 6, 0.02, s.P[1], 1);
  s.disc(-0.45, 0, 1, [0, 0, 1], 0.17, 0.02, s.P[2], 1);
  const source = s.finish({ cam: { target: [0, 0, 0], dist: 4 } });
  const d = makeBuilder(1, [0, 0x2040ff, 0xffac20]);
  d.disc(10, 0, 4, [-1, 0, 0], 6, 0.02, d.P[1], 1);
  d.disc(7, 0, 4, [-1, 0, 0], 6, 0.02, d.P[2], 1);
  const destination = d.finish();
  const render = (overrides = {}, shape) => {
    renderer.render(source, { width: size, height: size, raw: true, portal: { source, destination, opening: door(shape) },
      ...overrides });
    const bytes = new Uint8Array(size * size * 4);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    if (gl.getError() !== gl.NO_ERROR) throw new Error('WebGL error during portal render');
    return (x, y) => bytes.slice((y * size + x) * 4, (y * size + x) * 4 + 3);
  };
  function dominant(image, x, y, channel, label) {
    const rgb = image(x, y);
    if (rgb[channel] < 170 || rgb.some((v, i) => i !== channel && v >= 120))
      throw new Error(label + ' yielded ' + rgb.join(','));
  }
  const front = render();
  dominant(front, 32, 32, 2, 'a rotated destination is visible and geometry before the exit is clipped');
  dominant(front, 17, 32, 1, 'foreground occludes the doorway');
  dominant(front, 3, 32, 0, 'source remains visible outside the doorway');
  dominant(render({ camera: { yaw: Math.PI } }), 32, 32, 0, 'the doorway is hidden from behind');
  dominant(render({ camera: { ortho: true } }), 32, 32, 2, 'orthographic doorway');
  const circle = render({}, 'ellipse');
  dominant(circle, 32, 32, 2, 'ellipse center');
  dominant(circle, 13, 13, 0, 'ellipse corner');

  const { waterBodies } = KIT.procedural;
  const pool = (min, max) => waterBodies.scene([waterBodies.create({ id: 'pool',
    bounds: { min: [min, 0], max: [max, 8] }, sample: () => ({ bed: -2, surface: 2 }),
    optics: { tint: [0, 0, 0], extinction: [1, 1, 1], foam: 0, surface: 0, caustics: 0, refraction: 0 } })]);
  const underwater = (min, max) => render({ portal: { source, opening: door(),
    destination: { ...destination, water: pool(min, max) } } })(32, 32);
  if (underwater(5, 7.8)[2] < 238 || underwater(8.1, 9.7)[2] > 75)
    throw new Error('water attenuation must start at the destination doorway plane');

  const half = render({ fade: 0.5 }), dark = render({ portal: null, fade: 1 });
  if (half(32, 32)[2] < 119 || half(32, 32)[2] > 130 || dark(32, 32).some(v => v !== 0))
    throw new Error('fade opacity was not applied to the visible frame');
  const pose = door().camera(renderer.cameraPose(source, { width: size, height: size }));
  if (pose.eye[0] !== 4 || pose.back[0] !== -1) throw new Error('camera handoff lost the relative pose');
  renderer.dispose();
}

test('WebGL presents oriented apertures with foreground occlusion and scene fades', {
  skip: !process.env.INK_TEST_CHROME
}, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-portals-'));
  try {
    const browserEntry = pathToFileURL(path.resolve(__dirname, '../webgl.mjs')).href;
    const page = path.join(temp, 'portals.html');
    fs.writeFileSync(path.join(temp, 'bundle.js'), core.bundle());
    fs.writeFileSync(page, `<!doctype html><canvas></canvas><pre id="result">PENDING</pre>
<script src="bundle.js"></script><script type="module">
import { createRenderer } from ${JSON.stringify(browserEntry)};
const result = document.querySelector('#result');
try { (${browserProbe.toString()})(createRenderer); result.textContent = 'PASS'; }
catch (error) { result.textContent = error.stack; }
</script>`);
    const html = execFileSync(process.env.INK_TEST_CHROME, [
      '--headless', '--no-first-run', '--disable-background-networking', '--allow-file-access-from-files',
      '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--user-data-dir=' + path.join(temp, 'profile'),
      '--dump-dom', pathToFileURL(page).href
    ], { timeout: 90000, encoding: 'utf8', maxBuffer: 4e6, stdio: ['ignore', 'pipe', 'ignore'] });
    assert.equal(html.match(/<pre id="result">([^<]*)<\/pre>/)?.[1], 'PASS');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
