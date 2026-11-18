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
