# Curve splat sources

Ink can render a 3D path as connected splat segments. The headless renderer
integrates density along each finite segment and composites its colour at the
segment's local depth. Splitting a straight span preserves its density through
the joint. Ordinary native splats can share the frame and occlude the curves.

## Author a source

```js
const { KIT: K, makeBuilder } = require('@shapeshift-labs/ink-studio').load();
const builder = makeBuilder(1, [0x142333, 0xefb973]);
const source = {
  kind: 'spline',
  points: [[-2, 0, 0], [-.6, .9, .2], [.8, -.3, .6], [2, 0, 0]],
  samples: 8
};
const ranges = K.curveSplats.draw(builder, source, {
  radius: .05, color: '#efb973', opacity: .94, object: 'rope', material: 'hemp'
});
```

Edit the control points or original source data and draw again into a fresh
builder to rebuild its native rows. `draw` leaves its inputs available for
editing and returns the total segment count and row ranges per strand. The
round `radius` sets the Gaussian standard deviation in world units.
`opacity` runs from 0 to 1 and determines the centre opacity of a long
span seen broadside. `color` accepts a hex colour or three RGB bytes.
A JavaScript callback can select colours by strand ID, family, index,
world position, arc distance, and textile UV when present.

| Source | Data |
| --- | --- |
| Path | An array of 3D points, a compiled `K.curve.path`, or a `{ kind: 'path', points, closed }` record. |
| Spline | `{ kind: 'spline', points, samples }` samples a Catmull–Rom spline through editable control points. `samples` is per pair of controls. |
| Curve family | `{ kind: 'family', definition }` uses an existing `K.curve.create` definition. |
| Textile | `{ kind: 'textile', plan }` reads a textile or interlace plan, keeping each strand's ID and width. Set `renderer: 'curve-splats'` in `K.textile.draw` appearance to opt in directly. Existing textile plans can still use `renderer: 'patches'`. |
| Routed link | `{ kind: 'routed', link }` uses a sampled routed link's `paths`, material, and radius. Cut and broken links retain their separate spans. In simulation visuals set `visual.routedLinkRenderer: 'curve-splats'` alongside `visual.fields.routedLinks`. |
| Particle trail | `{ kind: 'trail', samples }` takes one particle's ordered XYZ points or `{ point: [x,y,z] }` samples. Use `null` for a discontinuity or spawn break. Submit each particle separately. |

The optional `maxSegments` bounds preparation before the builder receives
any rows. Standalone scenes have a total budget of 60,000 segments.

## Set width, taper, and twist

Set the three channels independently on a strand. A number holds across the
whole strand. An array of `[u, value]` keys interpolates linearly. Use
`{ "samples": [...] }` for painted values spaced evenly along the path.
Positions run from 0 to 1 by arc length on each strand. A JavaScript
function can paint a channel from `{ u, distance, point, id, family, index, uv }`.
The `uv` entry is available on textile charts.

```js
K.curveSplats.draw(builder, source, {
  width: { samples: [.05, .11, .28, .36, .17] },
  taper: [[0, 1], [.72, 1], [1, 0]],
  twist: [[0, 0], [1, 2 * Math.PI]],
  aspect: .24
});
```

- `width` sets the nominal world-space width and takes precedence over
  `radius`. For a Gaussian section it is twice the major-axis standard
  deviation. For a flattened ribbon it measures the band before edge
  rounding. A fixed width keeps a cable at the same world gauge through bends.
- `taper` multiplies the width by a value from 0 to 1. A zero profile omits
  coverage there.
- `twist` rotates the section about the path tangent in radians. Set `up`
  to choose the initial major-axis direction. `aspect` sets the minor
  width as a fraction of the major width, from .1 to 1. Supplying `twist`
  defaults this ratio to .35 so the roll is visible. A round section uses 1.

`profileSamples` sets the sampling resolution for varying channels and
defaults to 96. The builder also splits at control keys and adds samples
for fast changes in keyed twist. The resulting piecewise sections fit
within the existing segment budget. Adjust the profiles or source geometry
and rebuild to update them.

Set `appearance.curveProfile` on a textile with `renderer: 'curve-splats'`
to pass the same options to its strands. With the simulation's curve splat
renderer enabled, set `visual.routedLinkProfiles.<link-id>` for an
individual routed link. The [profile example](../examples/curve-splat-profiles.json)
shows a fixed cable, painted stroke, tapered tip, and twisted ribbon. Run
`node examples/curve-splat-profiles.cjs studio/out/curve-splat-profiles`
to render an animated review.

## Choose a cross-section

Set `section` per strand. All three profiles support the same width, taper,
and twist channels.

| Section | Profile |
| --- | --- |
| `round` | Circular section around the tangent. It uses aspect 1 and keeps its shape under roll. |
| `elliptical` | Two transverse axes. The default minor-to-major ratio is .5. Set `aspect` from .1 to 1 for a narrower or rounder yarn. |
| `flattened` | A ribbon with a broad face, rounded edges, and a narrower thickness axis. The default thickness ratio is .16. Set `aspect` from .1 to .99. |

A compiled path supplies its transported frame. Named elliptical and flattened
sections on textile charts use the chart normal as the thin axis. Raw polylines
and sampled routes use a transported frame from world up. Set `up` to override
the strand's reference width direction, or key `twist` to turn it along the path.

```js
const ribbon = K.curve.path(points, { up: [0, 1, 0] });
K.curveSplats.draw(builder, ribbon, {
  section: 'flattened',
  width: .24,
  aspect: .16,
  twist: [[0, 0], [1, Math.PI]]
});
```

For soft edges, the headless renderer integrates the ribbon's lateral density
with seven quadrature samples and combines it into one fragment per segment
and pixel. This keeps the profile continuous across straight subdivisions.
Existing recipes also accept the implicit section chosen by `aspect` or `twist`.
The [section comparison](../examples/curve-splat-sections.json) is editable
and renders with the normal still and clip commands.

## Choose an edge profile

Set `edge` on the strand or in a textile's `curveProfile` or a routed
link's profile. Each edge works with round, elliptical, and flattened sections.

| Edge | Coverage |
| --- | --- |
| `gaussian` | The default soft falloff. Good for fibres, ink washes, and glowing strands. |
| `beta` | A compact quadratic Beta kernel integrated over the finite segment. Coverage smoothly reaches zero. Its radius of support is √6 times the Gaussian section scale in the corresponding section coordinates. A flattened section integrates the bounded kernel across its band. |
| `hard` | A binary test of the art pixel's camera ray against the swept section. Inside pixels use the strand's authored opacity, which defaults to 1 in this mode. Adjacent segments share one coverage shape and contribute once per strand per pixel. |

The hard round and elliptical modes use capsules in the section's coordinates.
Hard flattened ribbons use a rounded band. Depth comes from the first
intersection. The hard edge is evaluated at the pixel centre, so preserve the
intended art resolution when previewing it. The two soft modes default to
opacity .94.

```js
K.curveSplats.draw(builder, path, { section: 'flattened', edge: 'hard', width: .18 });
```

Open the [editable edge comparison](../examples/curve-splat-edges.json) or run
`node examples/curve-splat-edges.cjs studio/out/curve-splat-edges` to render
the matched orbit and measured coverage plots.

## Finish caps and joins

Set `caps` once for both ends or give it separate `start` and `end` styles.
Terminal caps apply to open path endpoints.

| Cap | Appearance |
| --- | --- |
| `rounded` | The default end from the selected edge kernel. |
| `blunt` | Cuts off coverage at the endpoint. Hard edges use a tangent-plane cut in world space. Soft edges use the projected tangent-plane boundary. |
| `tapered` | Narrows to a point over `length`, a fraction of the whole path. |
| `fading` | Reduces density or hard-coverage opacity over `length` while keeping the prescribed width. |

The taper and fade length defaults to .16. Use `joins` to edit an explicit
position on the strand. `at` and `length` use normalized arc length, like a
width key. A `break` removes a centered interval and trims both newly exposed
ends. It also works across a closed path's seam. A `pool` adds local density
with `strength` and width with `spread`. Set `color` for an optional pigment
tint. Both soften toward the boundary of the pool. Overlapping break
intervals combine into one gap.

```js
K.curveSplats.draw(builder, path, {
  width: .18,
  edge: 'beta',
  caps: { start: 'blunt', end: { type: 'fading', length: .22 } },
  joins: [
    { type: 'pool', at: .45, length: .10, strength: 1.5, spread: .4, color: '#d49872' },
    { type: 'break', at: .72, length: .035 }
  ]
});
```

The [editable cap and join sheet](../examples/curve-splat-caps.json) uses all
four ends and both join edits. Run `node examples/curve-splat-caps.cjs
studio/out/curve-splat-caps` for an animated comparison.

## Render and compare

The [editable example](../examples/curve-splat-scene.json) uses
`format: "ink-studio/curve-splat-scene"`, `version: 1`, an `id`, and a
`strands` array. Each entry combines a `source` with drawing options. Supply
`background`, `palette`, or `camera` for a particular shot. In Node, build the
same JSON with `K.curveSplats.world(recipe)`.

```sh
node cli/ink-studio.js render examples/curve-splat-scene.json --raw --w 192 --h 96 --out crossing.png
node cli/ink-studio.js clip examples/curve-splat-scene.json --raw --w 192 --h 96 --fps 12 --to 3 --camera-orbit 30 --out crossing-orbit.png
node cli/ink-studio.js render examples/curve-splat-scene.json --curve-splats off --raw --w 192 --h 96 --out gaussian-carriers.png
node examples/curve-splat-gallery.cjs studio/out/curve-splats
```

`--curve-splats off` or `render(world, { curveSplats: false })` shows the
ordinary Gaussian row for each span. These rows also provide a fallback in
WebGL. The integrated coverage path is headless and works in perspective and
orthographic views. Use `--fragment-budget` when a large export with overlapping
strands needs more depth-sorted fragments.

The integration follows the finite Gaussian segment in
[Shramko et al., *Spaghetti Splatting*](https://arxiv.org/html/2611.12716v1).
Ink starts from authored or simulated paths. The implementation is
dependency-free.
