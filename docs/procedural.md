# Procedural primitives

`KIT.procedural` is available through both `load().KIT` and the plain-script
browser bundle. Its operations take coordinates, fields, metadata, and
callbacks. They can be composed without a scene, an editor, or WebGL.

```js
const { KIT } = require('@shapeshift-labs/ink-studio').load();
const P = KIT.procedural;

const ground = {
  height: (x, z) => .2 * x,
  slopeBound: .2,
  bounds: { min: [-2, -.4, -1], max: [2, .4, 1] }
};
const carrier = [[-2, 1, -1], [2, 1, -1], [2, 1, 1], [-2, 1, 1]];
const support = P.supportSkirt({ outline: carrier, ground });
const geometry = support.mesh({ material: 'concrete' });
const mesh = P.geometry.toKitMesh(geometry, (owner, material) => [.6, .64, .61]);
```

| API | Contract |
| --- | --- |
| `spatial`, `transforms` | World bounds, ray box intersection, affine frames, point and normal transforms, conservative distance scaling |
| `surface.plane(spec)`, `surface.cylinder(spec)`, `surface.transform(surface, pose)` | Named carrier charts with `sample([u,v])`, `project(point)`, `closest(point)` and `raycast(origin, unitDirection, max)` |
| `geometry.builder()`, `geometry.toKitMesh(geometry, materialResolver)` | Triangle streams with positions, normals, UVs, bounds and owner/surface/material groups. Material resolution takes `(owner, role)` and returns normalized RGB |
| `geometry.samplePatch(spec, emit)` | Adaptive sampling of a bounded UV patch, using world spacing and an optional acceptance mask |
| `geometry.triangulate2D(points)` | Index triples for a simple concave or convex 2D polygon |
| `geometry.clipConvex(mesh, planes, capMetadata)`, `geometry.clipSurface(mesh, planes)` | Clip to half spaces `dot(normal, point) <= offset`. Closed convex shells receive caps, open triangle streams retain interpolated UVs/normals |
| `geometry.clipConvexFaces(faces, planes, {capTag})` | Clip a closed convex shell of outward-wound planar faces. Keep polygons intact through clipping and tag each cap with its plane tag or the supplied default |
| `geometry.implicitSurface(field, bounds, options)` | Marching tetrahedra for negative-inside fields, with a bounded cell count |
| `pieces.convex`, `pieces.box`, `pieces.beam`, `pieces.tube`, `pieces.union` | Reusable solid pieces and query unions. Union meshes contain constituent shells |
| `fittedCourses(spec)` | Exact span fitting with stagger, periodic seams, material joints and logical cell identity |
| `fittedRibbon({inner, outer, pitch, gap, closed, phase, budget})` | Fit repeating bands along paired 2D or 3D rails. Each logical cell contains quadrilateral footprints split at source edges |
| `surfaceCells.clip(cells, {boundary, holes, budget, work})` | Intersect convex cell footprints with a convex chart boundary and subtract convex holes. Group fragments by logical cell key |
| `surfaceCells.loft(layout, {sample, levels, step, metadata, budget}, builder?)` | Map each fitted footprint onto two levels of a curved carrier. Emit closed, outward-wound fragments with shared cap and side vertices |
| `panelFrames({width, height, unit, beam, braceWidth, braces, periodic, budget})` | Fit posts, rails and optional diagonal braces to rectangular bays. Get stable keyed footprints and a signed chart query |
| `planarCells.layout(bounds, mask, options)`, `planarCells.prism(cell, options)` | Stable planar cells clipped to a mask, including disconnected fragments and holes. Prisms provide distance, ray, sampling and closed mesh operations |
| `supportSkirt({outline, ground, embed, overlap, maxDrop})` | Fill vertically below a convex planar carrier and above the supplied height field, up to the configured drop |
| `basins.surface(carrier, mask, options)`, `terraces.surface(carrier, configuration)` | Masked level cuts and configurable height bands. Carrier provides bounds, height, normal and domain predicates |
| `spans.catenary(a, b, options)` | Gravity-aware sagging curve with arc-length sampling, finite frames and closest-point queries |
| `proximity.connect(sockets, options)` | Deterministic matching of named sockets with reach, degree and compatibility limits |
| `populations.layout(boundsList, evaluate, options)` | Seeded world-space candidates ranked by density. Expanding the work region preserves existing candidate identities |
| `sampling.poisson(options)` | Seeded Bridson samples in finite 2D and 3D bounds, with masks, variable radii, pins and axis scaling |
| `materialBands(spec)` | Nonoverlapping local intervals with material and pattern metadata |
| `masks.stroke(spec)`, `masks.compose(specs, options)` | Tapered and feathered swept discs, ordered addition and erasure, signed distance and visible source ownership |
| `profileCut({profile, span, frame})` | Bounded extrusion of a simple 2D profile in an affine frame. `subtract(hostField)` forms an opening and `lining(thickness, hostField)` returns its material band |
| `clearance.field(solids).probe(bounds, options)` | Bounded sampled volume contacts for supplied solids with `id`, bounds, and distance functions |
| `emitters.compile(spec)` | Deterministic looping samples with caller-supplied direction and drift. Sample at any finite time with `sample(index, time)` or `samples(time)` |
| `routes.polyline(points, options)`, `routes.aroundConvex(outline, start, end, options)` | Arc-length routes with frames and closest queries. Convex XZ routes project endpoints onto an offset perimeter and interpolate world Y |
| `routes.terrain(start, end, options)` | Bounded, terrain-aware search between pinned points with slope, signed clearance, keep-out regions and turn costs |
| `hydrology.analyze(height, options)` | Priority-Flood, D8 catchments, stream orders, channel routes, wetness and optional D-infinity flow |
| `routes.layout(route, options)` | Fit bounded intervals on a polyline, catenary, or compatible curve. Place caller-chosen pieces using gapped endpoints and midpoint frames |
| `styles.catalog(definitions)`, `styles.compose(...layers)` | Caller-defined profiles, named inheritance, and deep composition. `styles.material(profile, role)` resolves aliases and normalized colors |
| `chunks.create({preview, refine})` | Cache realized chunks by key and revision, retain unrelated payloads, send bounded replacement patches, and cancel obsolete work |
| `contacts.index(mesh, options)`, `contacts.intersections(a, b, options)`, `contacts.clipCurve(points, solids)` | Index named triangle groups, trace noncoplanar contacts, and trim contact or authored curves against closed indexed solids |
| `contacts.traceSdf(chart, sd, options)`, `contacts.expose(curves, occluder, options)`, `contacts.field(curves)`, `contacts.runoff(curves, project, options)` | Trace SDF contacts, expose visible runs, derive distance masks and follow downhill paths |
| `tiles.compile(definitions)`, `tiles.solve(model, options)`, `tiles.learn(swatch)`, `tiles.overlap(bank, options)`, `tiles.wang(model, options)`, `tiles.refine(coarse, model, options)` | Weighted matched sockets, example-based synthesis, world-stable patterns and coarse-to-fine layouts |
| `fields.simplex(options)`, `fields.periodic(options)`, `fields.compile(expression, options)` | Seeded analytic noise and serializable field composition for SDFs, materials and placement |
| `grammar.expand(scope, rules, options)`, `grammar.children(layout)` | Bounded shape grammar with named partitions, fitted repeats, pinned spans, sockets and retained child specs |
| `contours.march(field, options)` | Bounded marching-squares paths at a scalar level |

Heights and distances use world units. Planar masks take XZ and use negative
distance for the interior. Compiled carrier callbacks should be deterministic.
Primitive operations with sampling or tessellation expose work limits so the
caller can choose the appropriate detail for the use case. Mesh output is
approximate where a curved field is sampled. A support requires a conservative
height and slope declaration over its footprint.

Build the browser gallery with `node examples/procedural/build.js`. Open
`dist/procedural-gallery.html` and move the View angle slider to inspect the
actual meshes. The HTML contains the library and all the examples.

A mask stroke takes a unique `id`, 2D `points`, optional `radii`, `width`,
`softness`, `layer`, and `order`. Use `operation: 'erase'` to subtract a stroke.
A mask's signed distance is independent of its feathered coverage. Empty masks
return positive infinity. Clearance probes approximate contact at the selected
spacing. Choose spacing and padding in relation to the smallest obstruction
the caller needs to detect. Emitters describe visual trajectories and do not
perform particle collision or fluid simulation.

Route layout takes a positive `pitch`, optional physical `gap`, a normalized
`from` / `to` range, and a `distribution` of `ceil`, `floor`, or `round`.
For polylines the default policy fits independently across each straight
segment, so an interval never bridges a bend. A route has `length` and
`sample(t)` returning a `point` and optional frame metadata. For custom curves,
the caller owns arc-length parameterization. The sample contract is shared
with `spans.catenary`.

For fitted ribbons, corresponding inner and outer vertices define a strip.
Pitch and gap are distances along the inner rail. The pitch is fitted to the
total length and a corner splits a cell into fragments with the same key.
`closed: true` connects the last and first vertices. A fractional `phase`
shifts the joints around that seam. The result contains footprints in the
input coordinate system so callers can extrude, clip or sample them.

Convex face clipping accepts face records with `points` in outward cyclic
order and an optional `tag`. Supply half spaces with `normal` and `offset`
and optionally attach a `tag` to any plane. The output has the same face record
shape, with a cap for each plane which intersects the volume. Triangulate the
result after clipping if the consumer uses triangle geometry.

`surfaceCells.clip` takes records with a string `key` and convex 2D
`polygon`, or cells from `fittedCourses` with `id` and `inset` bounds.
Either polygon winding is accepted. The output has counterclockwise convex
fragments in the same chart coordinates. Shared cell keys are grouped across
chart seams and split pieces. Material assignment and mapping chart points
onto the host are caller policies. The work budget counts vertices visited
by the clip operations.

`surfaceCells.loft` takes the clipped layout and calls `sample([u, v], level)`
for each position. Supply an ordered pair of finite levels whose samples
enclose a solid. Use `step` to subdivide in chart coordinates before mapping.
Each convex fragment emits a closed shell. A metadata callback can assign
owner, material and surface roles by the original logical cell key.

`panelFrames` fits to the carrier dimensions and exposes its member footprints
as `parts`. Pass those to `surfaceCells.clip` for openings, then loft the
remaining pieces onto the carrier. Posts and rails run continuously. Braces
fit inside individual bays and can be ascending, descending, alternating,
crossed or omitted. A callback can choose any of those policies per bay.
Set `periodic: true` for a shared post key across a wrapped chart seam.

Catalog definitions may name one or several parents using `extends`. A
resolved profile merges named or inline layers in order. Object keys compose
recursively, while arrays and scalar values replace earlier values.
Material role values accept aliases, RGB colors, and attribute records.
Use a complete material record or an inherited color when setting shades.

### Terrain routes between pins

`routes.terrain(start, end, options)` takes exact `[x, y, z]` pins with
distinct XZ coordinates. Supply `bounds: {min, max}` to limit the XZ search,
and `height(x, z)` to set the candidate centerline elevation. Add any intended
offset above the ground to this callback. Pin elevations are supplied
independently.

- `cell` controls the grid spacing. `sampleStep` controls checks along an
  edge and defaults to a third of the cell size.
- `maxSlope` is rise over horizontal run. It applies to the segment grade
  and to changes in the terrain sampled along each edge. `slopeCost` penalizes
  both uphill and downhill travel.
- `clearance(x, y, z)` supplies a signed obstacle distance at the route
  centerline. Set `minClearance` to account for the half-width and any margin.
  `keepOut(x, z, y)` blocks authored areas when it returns true.
- `cost(x, y, z)` supplies a nonnegative penalty per unit of horizontal
  travel. Positive infinity marks an impassable point. `turnCost` adds a
  penalty per radian of heading change.
- `maxDeviation` limits how far a segment can leave the height field.
  `lookAhead` bounds simplification. Use zero to keep the grid turns.

Callbacks should be deterministic. Clearance, grade, and keep-out checks
are sampled, including on shortcuts. Choose `sampleStep` and a clearance
margin for the smallest feature you need to avoid. A route can be unreachable
at a coarse grid spacing if the grid misses an available corridor.

An `ok` result includes a `route` compatible with `routes.layout` and a
weighted `cost`. Other statuses are `blocked-pin`, `unreachable`, and
`budget`. A budget result names the exhausted limit. Configure `maxCells`,
`maxVisits`, and `maxSamples` to bound work. The result reports counts in
`work`.

The runnable example uses ordinary SDFs for the ground, boulders, and
paving, then bakes two versions of the scene as splats. The pins are identical
in both versions.

```sh
node cli/ink-studio.js render examples/terrain-route.js --seed 13 --ortho --colored
node cli/ink-studio.js render examples/terrain-route.js --seed 14 --ortho --colored
```

### Watersheds and river networks

Pass `P.hydrology.analyze(height, {bounds, cell, origin, channelArea, lakeAt})`
a deterministic `height(x, z)` callback and a bounded XZ work region. The
lattice is aligned to the world coordinates in `origin`, which defaults
to `[0, 0]`. Drainage uses Priority-Flood depression filling and D8
steepest descent. Interior flats follow the flood path towards an outlet.
The boundary represents the extent of the drainage model. Re-run the analysis
when the extent, elevation, or rainfall changes. The optional
`rain(x, z, y)` supplies a nonnegative multiplier for each cell's area.

- `fields` contains row-major typed arrays, X first. Elevation is the authored
  surface, drainage height is the filled surface, and terrain height applies
  fills only outside authored lakes. `receiver` is the downstream sample
  index or `-1` at an outlet. Treat the arrays as analysis results when
  reusing them with the point queries.
- `sample(x, z)` interpolates scalar data such as accumulation and wetness.
  Catchment and lake IDs, lake level, and stream order use the nearest
  lattice sample. It returns `null` outside the sampled region.
- `reaches` contains ordinary arc-length routes separated at stream starts,
  junctions, lakes, and outlets. The first directed world-lattice edge
  determines a reach ID. The same edge keeps its identity while the lattice
  alignment and that section of the graph agree. Set `channelArea` to the
  minimum contributing area for a visible channel.
- `lakeAt(x, z, y)` may return a lake ID, `{id, level}`, or `null`.
  An authored lake keeps its bed in `terrainHeight` and its specified water
  level. The drainage grid routes through it, and internal lake channel
  segments remain submerged. Its network node connects incoming and outgoing
  reaches. `wetness(x, z)` returns one on sampled lake interiors.
- `distributed: true` also returns D-infinity area accumulation with
  `receiver`, `secondary`, and `secondaryShare` arrays. Flow may split
  between adjacent downhill directions adjoining the steepest facet.
  The reach and catchment APIs describe the D8 network.

The splat example uses the network to place river surfaces and the wetness
field to darken banks and place reeds around an authored pond.

```sh
node cli/ink-studio.js render examples/watershed.js --ortho --colored
```

### Stable spacing and finite Poisson sampling

Opt in to minimum-distance placement with
`P.populations.layout(regions, evaluate, {exclusion: {distance}})`.
The higher-priority eligible candidate blocks lower-priority candidates within
the exclusion distance. Candidate identity and the decision are based on world
coordinates and a bounded neighbor halo. Use the same seed, settings, and
world-space evaluator in every chunk. The evaluator also sees candidates just
outside the output regions so splitting a region produces the same placements.

Set `exclusion.maxDistance` to bound variable `minDistance` values returned
by the evaluator or values in `exclusion.species`. An evaluator may return
a `species` name. Supply a nested table such as `{oak: {moss: 0.6}}` to add a
symmetric pair separation. A pair uses the maximum of its two sample distances
and any matching species rules. Candidate and comparison budgets include work
in the halo.

Use `P.sampling.poisson({bounds: {min, max}, radius, seed})` for a finite
patch. Bounds and points have two or three coordinates. `mask(point)` can
restrict the domain. `seeds` pins starting samples. `reseed` allows a bounded
number of extra random seeds in disconnected regions after a patch finishes.
For variable spacing, supply `radius(point)`, `minRadius`, and `maxRadius`.
Pair separation is the larger radius. With `axisScale`, distance is measured
after dividing each coordinate difference by that axis scale. The result
contains each `point` and `radius`, plus a work report and status.
A `budget` or `point-limit` result contains the samples inserted so far.

The splat example compares two independently populated chunks with one finite
Bridson patch at the same exclusion distance.

```sh
node cli/ink-studio.js render examples/poisson-patches.js --seed 0 --ortho --colored
node cli/ink-studio.js render examples/poisson-patches.js --seed 1 --ortho --colored
```

### Contact fields, runoff, and contours

`P.contours.march(field, {bounds, cell, iso})` extracts open paths and closed
loops from a bounded 2D scalar field. The default level is zero. Use it for
shorelines, isolines, or curves in a carrier chart. The callback receives two
coordinates and returns a finite scalar or `null` where the domain ends.

`P.contacts.traceSdf(chart, sd, options)` runs the contour calculation on
`sd(...chart.sample([u, v]).p)`, then lifts the paths onto the chart in world
space. The default chart bounds are `[0, 1] × [0, 1]`. Typical carriers are
`P.surface.plane()` and `P.surface.cylinder()`. Use finer `cell` values for
smaller intersections. The result can also be built from authored world-space
polylines or the existing triangle-contact API.

- Pass an `occluder(x, y, z)` to `traceSdf`, or call
  `P.contacts.expose(curves, occluder, {step, clearance})` directly, to trim
  hidden segments against a signed field. Resolution is controlled by `step`.
- `P.contacts.field(curves)` indexes curve segments. Query `nearest(point)`
  for distance, closest point, tangent, source ID, and position along the
  curve. Use `distance(x, y, z)` for an unsigned field or `sdf(radius)` for
  a tubular signed distance function.
- Use `field.mask({inner, outer, weight})` to produce a feathered coverage
  callback. The optional `weight(hit, point)` can limit paint to one side
  of a seam or fade it along the curve. Use it in a material's `tex` or
  `mod`, a surface layer's `mask`, decal placement, or a relief operation.
- `P.contacts.runoff(curves, project, {spacing, step, distance})` starts
  evenly spaced downhill traces on a carrier. The projection callback
  receives a point and returns `{p, n}` for the projected point and normal,
  or `null` outside its domain. Feed the trails into the same distance field
  to make streaks. Change `direction` to trace another environmental flow.

The SDF example compares the same sandstone wall with and without contact
stains and seam-driven moss.

```sh
node cli/ink-studio.js render examples/contact-masks.js --seed 0 --ortho --colored
node cli/ink-studio.js render examples/contact-masks.js --seed 1 --ortho --colored
```

### Socket tiling and learned swatches

Compile tile IDs, positive weights, and directional sockets with
`P.tiles.compile(definitions)`. Set sockets using `north`, `east`, `south`,
and `west` keys. Omitted sockets are `null`. Opposite sides must match.
A JavaScript `matches(a, b, direction)` option can define other compatibility.

`P.tiles.solve(model, {width, height, seed, pins, ports})` uses weighted
minimum-entropy selection, arc consistency and bounded backtracking.
Coordinates are integer `x` and `z`. A pin names a `tile` or an allowed
`tiles` list. A port supplies `{x, z, direction, socket}`. Use ports to
carry the edges of an authored connectivity graph into the tiling.
Optional `boundary` sockets apply at outer edges and next to masked cells.
`wrap` is a boolean or separate X and Z booleans.

An `ok` result contains row-major tile IDs and an `at(x, z)` query. Empty
cells contain `null`. An inconsistent set of constraints reports
`contradiction`, with a conflict cell when known. Limits on `maxWork` or
`maxBacktracks` report `budget`.

- `tiles.learn(swatch, {size, periodic, symmetry})` learns overlapping
  square patterns from rows of scalar values. `tiles.overlap(bank, options)`
  synthesizes a new swatch. Its pins are `{x, z, value}` in the output.
- `tiles.wang(model, {width, height, labels, origin, seed})` hashes edges
  using integer world coordinates so independent regions agree on shared
  seams. Supply variants for every signature used by the label alphabet.
  Incomplete sets return `missing` with the required signature.
- `tiles.refine(coarse, model, {size, template})` expands each coarse cell
  into a square block, then solves all fine cells together. Templates supply
  fine tile IDs or allowed lists, or `null` for free cells. The coarse mask
  carries through to the fine result.

Use the chosen IDs to emit signed solids or splats, or interpret swatch
values as material masks. The example bakes an authored three-way path with
weighted socket tiles, and a ceramic panel generated from a small swatch.

```sh
node cli/ink-studio.js render examples/constraint-tiles.js --seed 0 --ortho --colored
node cli/ink-studio.js render examples/constraint-tiles.js --seed 1 --ortho --colored
```

### Composable procedural fields

`P.fields.compile(expression, {seed})` returns a function
`field(x, y, z, time = 0)`. Pass the function to a terrain sampler, scalars
in a material, or a population evaluator. The compiled `spec` and `seed`
can be saved and recompiled as JSON. Use `field.sample(x, y, z, time)` for a
value, XYZ gradient, and time derivative. Analytic derivatives are
propagated through the expression. Clamps, folds, and nearest-feature ties
use one selected derivative at corners.

| Node | Controls |
| --- | --- |
| Number or `constant` | A scalar number or `{type: 'constant', value}` |
| `axis` | Read `x`, `y`, `z`, or `time` with optional scalar `scale` |
| `simplex` | Seeded noise. `axes` selects two or three spatial coordinates. `scale` is a world length or XYZ lengths |
| `periodic` | Gradient noise with XYZ world `period` lengths. Use `null` on axes that should have no explicit period. Scale selects the approximate lattice size |
| `loop` | Two spatial coordinates, selected by `axes`, and a circle in a four-dimensional noise field. Set the time `period` and circle `radius` |
| `fbm`, `ridge`, `billow` | `source`, `octaves`, `gain`, and `lacunarity`. Ridge also has `offset` and `feedback` |
| `warp` | `source`, `strength`, `iterations`, and `decay`. Supply three component fields in `vector` or use seeded default components at `scale` |
| `terrace` | `source`, height `step`, `offset`, and transition width as a fraction of a step |
| `distance` | XYZ `point` or XYZ polylines in `paths`, with optional signed `radius`. Set `axes: 'xz'` for plan distance |
| `add`, `multiply`, `min`, `max` | Compose two or more `inputs` |
| `clamp` | Limit `source` to `min` and `max` |

The raw `fields.simplex({dimension, seed})` and
`fields.periodic({dimension, seed, periods})` APIs expose `value`,
`gradient`, and `sample` in two to four dimensions. Raw periodic lattice
periods are integer cell counts. Noise has nominal unit amplitude, and
`clamp` can constrain the final range.

The sculpt node `S.displace(heldSolid, expression, amplitude, options)`
compiles a JSON expression once and clamps its samples to the node's
zero-to-one input range. The original callback signature still accepts a
numeric field. The example applies the same field vocabulary to terrain
heights, shading, and displaced solids.

```sh
node cli/ink-studio.js render examples/composed-fields.js --seed 0 --ortho --colored
node cli/ink-studio.js render examples/composed-fields.js --seed 1 --ortho --colored
```

### Shape grammar and pinned bays

`P.grammar.expand({id, symbol, bounds}, rules, options)` lays out named,
axis-aligned scopes in local XYZ units. A production can reference another
rule by its name. Use `null` to reserve an empty scope. The result contains
parts and sockets with stable keys and a work count.

- `split` divides a scope on an `axis`. Give each `parts` entry a `key`
  and a production in `use`. A fixed `size` reserves world units.
  `weight` shares the remaining space among flexible parts.
- `repeat` fits cells at a nominal `pitch` on an `axis`. Supply `use`
  for each bay and optional `gap` between bays. Pass inline `pins` or
  use a `pinSet` name with `options.pinSets`. Each pin has a stable
  `id`, absolute `at` coordinate and `span`. It can specify its own
  `use` or use the operation's `pinUse` production.
- `inset` moves the faces inwards by `margin`, or different XYZ `min` and
  `max` margins. An `optional` inset may omit a scope too small to fit.
- `group` evaluates named `children` in the same scope. A `choice`
  picks one named production from positive weighted `options` using
  the seed and scope lineage.
- `emit` returns the scope's `bounds`, `center` and `half` dimensions
  with a material or geometry `role`. Emitters are supplied by the caller.
  A `socket` returns a `name`, point, and normal on the selected `axis`
  and `side`. The other two positions come from normalized XYZ `at`.
  Both can carry JSON `data`.

Around a pin, bay keys count out from the pinned end of the span. When
resizing adds bays towards an outer edge, the nearby keys stay stable.
Call `grammar.children(layout)` and pass those child specs to
`doc.derive(owner, rule, children)` so the existing authoring document
preserves hand edits. Emit geometry with standard SDF nodes such as
`S.box(part.center, part.half, material)`.

The sample changes the width of a façade around a pinned entrance.
The edited blue window, neighboring trim and socket attachments are
realized from the retained document and baked to splats.

```sh
node cli/ink-studio.js render examples/pinned-facade.js --seed 0 --ortho --colored
node cli/ink-studio.js render examples/pinned-facade.js --seed 1 --ortho --colored
```

## Optional retained authoring

`KIT.authoring.document(snapshot?, options?)` stores JSON intent. Transactions
share stable identifiers, deterministic seeds, anchors, generated children,
overrides, undo/redo, and an optional storage adapter. Call `derive(owner,
rule, children)` with stable per-rule keys. Editing a derived child preserves
its overrides through regeneration. `promote(id)`, `suppress(id)`, and
`allow(owner, rule, key)` control its relationship to the rule. Pass `getItem`
and `setItem` to `doc.autosave(storage, key)` to keep a recovery journal.
`projectDerived(snapshot, jobs)` runs the same derivations on a shared
immutable view without changing the document or its history.

`KIT.authoring.context(doc)` indexes spatial descriptors supplied by
`context.register(type, { describe, raycast? })`. Descriptors provide world
bounds and may expose named surfaces. `context.query`, `nearest`, `raycast`,
and `anchor` use those descriptors. A rule registered with
`context.rule({id, types, generate})` returns child specifications and can
read named entities, related collections, and spatial regions. Changes
invalidate affected descriptors and rules. The context reconciles within
the transaction and rolls back a rule chain that fails to converge.

`KIT.authoring.worldFrame(context, id)` composes local transforms and resolves
surface anchors. `context.style(id)` combines the environment, related hosts
and entity overrides through the same style catalog as the pure API.

## Incremental realization

`P.chunks.create({preview, refine})` accepts synchronous builders or promises.
Call `await chunks.update(descriptors, options)` with the complete desired
descriptor set. Each descriptor has a stable `key`, a string or integer
`revision`, caller-owned `input`, optional `bounds`, and optional dependency
IDs. Bump the revision whenever the input changes, or supply `changedIds`
and `regions` for external dependencies. Treat inputs and committed outputs
as immutable while in use. The runtime retains payloads by reference.

Set `quality: 'preview'` for the fast builder and `quality: 'final'` for
refinement. The callback receives the descriptor, an abort signal, and
the previous payload and quality. Updates publish a patch with replacement
chunks, removed keys, and old and new affected regions. Submitting another
update or calling `cancel()` aborts obsolete work and suppresses publication
even if the builder ignores the signal. Builders can use a worker or another
async backend supplied by the caller. Achievable frame times depend on the
builders and renderer.

The gallery's **Retained assemblies** example combines these APIs. Resizing
the left mount changes generated attachments and replaces that mount's visual
chunk. The right payload is reused. Undo and Redo operate on the retained
document and trigger the same realization path.

Contact curves follow the input mesh resolution. `contacts.index` can restrict
the index to named surface groups and exposes bounds queries and segment
crossings. Use a closed shell for point containment and curve occlusion.
`intersections` returns paired surface names and stitched world points.
`clipCurve` returns exposed runs with source segment coordinates and blocker
IDs. The caller can send those runs to a route, sweep, or trim material.
