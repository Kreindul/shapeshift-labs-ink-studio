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
| `geometry.implicitSurface(field, bounds, options)` | Marching tetrahedra for negative-inside fields, with a bounded cell count |
| `pieces.convex`, `pieces.box`, `pieces.beam`, `pieces.tube`, `pieces.union` | Reusable solid pieces and query unions. Union meshes contain constituent shells |
| `fittedCourses(spec)` | Exact span fitting with stagger, periodic seams, material joints and logical cell identity |
| `fittedRibbon({inner, outer, pitch, gap, closed, phase, budget})` | Fit repeating bands along paired 2D or 3D rails. Each logical cell contains quadrilateral footprints split at source edges |
| `planarCells.layout(bounds, mask, options)`, `planarCells.prism(cell, options)` | Stable planar cells clipped to a mask, including disconnected fragments and holes. Prisms provide distance, ray, sampling and closed mesh operations |
| `supportSkirt({outline, ground, embed, overlap, maxDrop})` | Fill vertically below a convex planar carrier and above the supplied height field, up to the configured drop |
| `basins.surface(carrier, mask, options)`, `terraces.surface(carrier, configuration)` | Masked level cuts and configurable height bands. Carrier provides bounds, height, normal and domain predicates |
| `spans.catenary(a, b, options)` | Gravity-aware sagging curve with arc-length sampling, finite frames and closest-point queries |
| `proximity.connect(sockets, options)` | Deterministic matching of named sockets with reach, degree and compatibility limits |
| `populations.layout(boundsList, evaluate, options)` | Seeded world-space candidates ranked by density. Expanding the work region preserves existing candidate identities |
| `materialBands(spec)` | Nonoverlapping local intervals with material and pattern metadata |
| `masks.stroke(spec)`, `masks.compose(specs, options)` | Tapered and feathered swept discs, ordered addition and erasure, signed distance and visible source ownership |
| `profileCut({profile, span, frame})` | Bounded extrusion of a simple 2D profile in an affine frame. `subtract(hostField)` forms an opening and `lining(thickness, hostField)` returns its material band |
| `clearance.field(solids).probe(bounds, options)` | Bounded sampled volume contacts for supplied solids with `id`, bounds, and distance functions |
| `emitters.compile(spec)` | Deterministic looping samples with caller-supplied direction and drift. Sample at any finite time with `sample(index, time)` or `samples(time)` |
| `routes.polyline(points, options)`, `routes.aroundConvex(outline, start, end, options)` | Arc-length routes with frames and closest queries. Convex XZ routes project endpoints onto an offset perimeter and interpolate world Y |
| `routes.layout(route, options)` | Fit bounded intervals on a polyline, catenary, or compatible curve. Place caller-chosen pieces using gapped endpoints and midpoint frames |
| `styles.catalog(definitions)`, `styles.compose(...layers)` | Caller-defined profiles, named inheritance, and deep composition. `styles.material(profile, role)` resolves aliases and normalized colors |
| `chunks.create({preview, refine})` | Cache realized chunks by key and revision, retain unrelated payloads, send bounded replacement patches, and cancel obsolete work |
| `contacts.index(mesh, options)`, `contacts.intersections(a, b, options)`, `contacts.clipCurve(points, solids)` | Index named triangle groups, trace noncoplanar contacts, and trim contact or authored curves against closed indexed solids |

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

Catalog definitions may name one or several parents using `extends`. A
resolved profile merges named or inline layers in order. Object keys compose
recursively, while arrays and scalar values replace earlier values.
Material role values accept aliases, RGB colors, and attribute records.
Use a complete material record or an inherited color when setting shades.

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
