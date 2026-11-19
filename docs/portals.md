# Places and travel links

`KIT.world.portals` provides a headless session for travel between named
places. A host supplies place preparation, feeds actor movement into the
session, and decides when to step simulation. Use the same primitives with
hand-built dioramas, streamed chunks, or biome revisions.

## Publish a place

A place has a stable `id`, named `anchors`, and a `prepare(context)` callback.
Each anchor has a world-space `origin`, a `normal` pointing toward the
front of the opening, and an optional `up`. The session makes an
orthonormal frame from these axes.

`prepare({id, anchor, state, previous, time, signal, reason, link})` returns a
payload, synchronously or asynchronously. Use `anchor.origin` to choose
chunks around the arrival. `reason` is `enter`, `preview`, or `restore`.
`anchor` is null when entering without a named anchor or restoring.
`state` is the place's saved JSON value and `time` is its local elapsed
time in seconds. For a link within the active place, `previous` is the
active payload and can be returned if it also serves the destination.
The session promotes the prepared payload on successful travel. It
aborts superseded requests and disposes discarded payloads.

A payload can provide these fields and callbacks.

| Member | Purpose |
| --- | --- |
| `world` | The packed splat world to show through a doorway or render after arrival. A headless host can supply its own payload fields. |
| `canArrive(actor, link)` | An optional synchronous clearance check in destination coordinates. Return false to keep the source active. |
| `checkpoint()` | An optional synchronous callback returning the current place's JSON state. The session uses it for saves and link conditions. |
| `step({id, dt, time, active})` | An optional synchronous simulation callback. `dt` is the duration in seconds and `time` is the local clock at the end of the step. |
| `prepareArrival(context)` | An optional callback on a retained payload. It can prepare chunks around another arrival anchor while the place keeps ticking. It accepts the same context as `prepare`, with the live payload in `previous` and its current checkpoint in `state`. |
| `dispose()` | A synchronous release callback. The session releases discarded payloads, paused payloads on departure, and live payloads when the session ends. |

## Step and save places

Set `tickPolicy: 'pause'` to save and release the payload on departure.
This is the default. Set `tickPolicy: 'continue'` to keep a visited
place's live payload and simulate it while the traveler is elsewhere.
Returning to a retained place reuses that payload. The host calls
`session.step(dt)` with seconds. Each step advances the active place
and the retained places in ID order. A place prepared only as a preview
starts ticking on its first entry.

`session.place(id)` reports the named anchors, policy, local time, and
status. `active` is the current place, `away` is a retained place, and
`inactive` covers paused and unvisited places. `session.linksFrom(id)`
lists the declared outgoing links.

`session.checkpoint()` returns `{place, saved, clocks?, away?}`.
`saved` contains each place's JSON state, including current checkpoints
from retained places. `clocks` contains elapsed seconds by place ID and
`away` lists the retained place IDs. Call `await session.restore(save)`
on a new session to restore the active place and resume the retained
places. A failed load leaves the session empty. The format also accepts
older `{place, saved}` checkpoints. Save the actor and camera separately
if the experience needs their exact poses on reload.

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
    requires: { path: '/actor/hasKey', value: true }
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
prefetching. A link is directed. Add a second link with its own anchors
and conditions for a return route. A `requires` condition uses the
[world query condition format](headless-worlds.md) and can address `/actor`,
`/state` (the source place's checkpoint), and `/time` (the source
place's clock). An optional `open({active, actor, link})` callback can
inspect the live payload. When both gates are supplied, both must pass.
The session checks gates when offering a preview, showing it, and
attempting travel. It rechecks them before handing off to the destination.

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

## Drop through a hatch

A link with `mode: 'drop'` uses the same swept crossing as a door and
arrives at the destination anchor. Give a horizontal hatch a source
`normal: [0, 1, 0]` and `up: [0, 0, 1]` to trigger when the actor falls
through from above. The trigger defaults to a circle of radius 1. Use
`radius` to size it or supply `aperture` for custom half extents and shape.

```js
const drop = {
  id: 'cellar-hatch', mode: 'drop',
  from: { place: 'court', anchor: 'hatch' },
  to: { place: 'cellar', anchor: 'landing' },
  requires: { path: '/state/hatchOpen', value: true }
};
const result = await session.cross(drop.id, { previous: positionBeforeMovement, actor, camera });
```

Drop links preserve velocity and orientation. A supplied camera moves
by the same offset as the actor. You can prefetch the landing with
`session.prepare(drop.id)`. Drop links use the source render until
handoff. A separate door, drop, or fade link can provide a return trip.

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
for two-way doors, a separate fade link, and a garden that keeps time
while you're away.
