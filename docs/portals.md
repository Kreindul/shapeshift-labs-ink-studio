# Places, doorways and fade travel

`KIT.world.portals` provides a headless session for travel between named
places. A host supplies place preparation, feeds actor movement into the
session, and decides when to step simulation. Use the same primitives with
hand-built dioramas, streamed chunks, or biome revisions.

## Publish a place

A place has an `id`, named `anchors`, and a `prepare(context)` callback.
Each anchor has a world-space `origin`, a `normal` pointing toward the
front of the doorway, and an optional `up`. The session makes an
orthonormal frame from these axes.

`prepare({id, anchor, state, previous, signal, reason, link})` returns a
payload, synchronously or asynchronously. Use `anchor.origin` to choose
chunks around the arrival. `reason` is `enter` or `preview`. Reuse
`previous` if a link within the same place can share the active payload.
The session promotes that exact payload on successful travel. It aborts
superseded requests and disposes late payloads.

A payload can provide these fields and callbacks.

| Member | Purpose |
| --- | --- |
| `world` | The packed splat world to show through a doorway or render after arrival. A headless host can supply its own payload fields. |
| `canArrive(actor, link)` | An optional synchronous clearance check in destination coordinates. Return false to keep the source active. |
| `checkpoint()` | An optional synchronous callback returning the place's JSON state before departure. The next preparation receives that state. |
| `dispose()` | A synchronous release callback for resources owned by this payload. The session releases discarded previews and departed payloads. |

`session.checkpoint()` returns `{place, saved}`. To resume, pass `saved`
to a new session and call `enter(place)`. Save actor state and the camera
with this checkpoint if the experience needs an exact location on reload.

## Walk through a door

```js
const { KIT: { world: { portals } } } = require('@shapeshift-labs/ink-studio').load();
const session = portals.create({
  places: [
    { id: 'court', anchors: { arch: { origin: [0, 1.5, 0] } }, prepare: loadCourt },
    { id: 'garden', anchors: { arch: { origin: [8, 1.5, 4], normal: [1, 0, 0] } }, prepare: loadGarden }
  ],
  links: [{
    id: 'garden-door', from: { place: 'court', anchor: 'arch' },
    to: { place: 'garden', anchor: 'arch' },
    aperture: { halfWidth: 1, halfHeight: 1.45, shape: 'rect' },
    open: ({ actor }) => Boolean(actor?.hasKey)
  }]
});
await session.enter('court');
const approach = session.approach(actor.position, { actor, distance: 10 });
await approach?.ready;
const preview = session.view('garden-door', actor);
```

Use `approach` as the actor moves to keep the nearest eligible front-facing
door prepared. The returned `ready` promise rejects on a failed load and
resolves to null when superseded. `prepare(linkId)` allows explicit
prefetching. A link is directed. Add the reverse link for a return route.
An `open` callback can inspect the active payload or traveler and is
checked again at crossing.

```js
renderer.render(session.current().asset.world, { ...frame, portal: preview });
const camera = renderer.cameraPose(session.current().asset.world, frame);
const crossed = await session.cross('garden-door', {
  previous: positionBeforeMovement, actor, camera, radius: 0.2
});
if (crossed) {
  actor = crossed.actor;
  frame.camera = { ...frame.camera, pose: crossed.camera };
}
```

`cross` tests a sweep of the actor's center from `previous` to
`actor.position` against the bounded aperture. The radius reserves
clearance around the center. The arrival preserves the distance traveled
past the plane, rotates supplied `velocity`, `forward` and `up`, and maps
the supplied camera pose through the same frame. Additional JSON actor
properties carry forward. A null result leaves the source active. Keep your
actor on the source side while a load or clearance check is unresolved.
A host can also use `portals.doorway({from, to, halfWidth, halfHeight, shape})`
directly for `hit`, `point`, `direction`, or `camera` operations.

WebGL supports one visible destination view per render and rectangular or
elliptical apertures. The renderer evaluates the opening per pixel and
uses foreground splat coverage to occlude it. The destination is rendered
with its mapped camera, own palette and environment. Its splats and water
before the arrival plane are clipped. Set `destinationFrame` on the
preview descriptor for destination-specific render options such as `time`.
The portal frame geometry is authored as part of the source place.

## Fade at a ring or pool

A link with `mode: 'fade'` uses a cylindrical trigger around its source
anchor. `radius` defaults to 1, vertical `height` tolerance to 0.7, and
`duration` in seconds to 0.8.

```js
const travel = session.fade('pool', { actor });
const step = travel?.advance(dt);
if (step?.arrival) actor = step.arrival.actor;
renderer.render(session.current().asset.world, { ...frame, fade: step?.opacity ?? 0 });
```

The playback reports `out`, `hold`, `in`, `done`, or `failed`.
It holds at full black until the destination is ready, places the actor at
the arrival anchor, and reveals the new place. On preparation failure or
a blocked arrival, it reveals the original place and returns the error.
`arrival` is available after handoff; use the changed place or the arrival
object's identity to run one-time host logic. The host can feed opacity
into its own compositor, audio, or transition presentation.

See [the headless courtyard and lantern garden](../examples/place-portals.js)
for two-way doors, a separate fade link, and an editable place checkpoint.
