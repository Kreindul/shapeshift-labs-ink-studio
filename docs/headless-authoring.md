# Headless procedural authoring

These APIs are available through `KIT.procedural` in Node and the browser bundle. Graph specifications are JSON data. Register executable operations in host code and share their typed inputs and outputs with the specification.

For image review and export, pass the finished world to Node's CPU `render()`. For interactive review, pass the world and authoring toolkit to the [WebGL canvas renderer](browser-renderer.md).

## Edit generated parts from the CLI

From the checkout, inspect the [editable passage](../examples/editable-passage.js)
and try its [edit batch](../examples/editable-passage.edits.json).

```sh
node cli/ink-studio.js authoring inspect examples/editable-passage.js --part '@/wall/parts/doorway'
node cli/ink-studio.js authoring preview examples/editable-passage.js examples/editable-passage.edits.json --image passage-preview.png
node cli/ink-studio.js authoring apply examples/editable-passage.js examples/editable-passage.edits.json --out passage.json
node cli/ink-studio.js render examples/editable-passage.js --authoring passage.json --out passage.png
```

`inspect` returns JSON with the current revision and entity records. Generated
records include the owner, rule, and key. A scene with a spatial context also
reports registered bounds and surfaces and resolves any authored anchor into a
world-space frame. Omit `--part` to list the whole scene.

Edit files contain an `operations` array and can pin the base by copying the
`revision` from `inspect`. Use these operations.

| Operation | Fields | Effect |
| --- | --- | --- |
| `update` | `id`, `patch` | Merge `parameters`, `anchor`, `parent`, or `styleRef` into the part. Generated edits become retained overrides. |
| `suppress` | Generated part `id` | Hide the part and suppress its slot on regeneration. |
| `allow` | Owner `id`, `rule`, `key` | Clear suppression so the rule can emit the part again. |

The batch reconciles its generation rules after staging all operations.
Both commands return added, removed and updated IDs, changed part records,
and checks from the scene's realization. The passage example rebuilds the
splats and colliders from the same geometry and checks whether a character
can still walk through the doorway and up the stairs. A failed scene check
returns exit code 2 and leaves the snapshot and image unwritten. Bad input
or a stale revision returns exit code 1.

Pass `--authoring passage.json` to inspect or edit a saved snapshot. Each
`apply` takes a new output path, so the previous snapshot remains available
for rollback. The output uses the existing retained-document format.
Preview can save a PNG to a new path with `--image`.

### Enable the CLI for a scene

Add `authoring(seed, {snapshot, controls})` to a JavaScript scene descriptor.
Return a retained `document`, an optional authoring `context` bound to it,
and `realize(snapshot)`. Initialize the default document when no snapshot is
supplied. The CLI passes any `--params` JSON as `controls` and uses the saved
seed when loading a snapshot.

The CLI reconciles the context, stages edits in one document transaction,
and calls `realize` with the immutable candidate. Return `{world, checks}`
or a promise for that result. A check contains `id`, Boolean `pass`, and
optionally a message and JSON evidence. Every check must pass before the
CLI writes an output. Successful realization supplies a packed render world.
A rejected realization can omit the world. Use the same realization in the
scene's normal `build` hook to render the saved snapshot.

## Fixed-size image framing

`KIT.captureFrame.fixed(viewWidth, viewHeight, options)` returns the centred
crop, exact output size, art raster dimensions and a lens multiplier. `aspect`
accepts `view`, `wide`, `square`, `portrait` and custom ratios from .25 through
4. `edge` is the longest PNG side in pixels. `scale` controls whole art-pixel
blocks from 1 to 8. A crop changes the lens around the same camera target.

```js
const studio = require('@shapeshift-labs/ink-studio');
const { captureFrame } = studio.load().KIT;
const frame = captureFrame.fixed(480, 360, { aspect: 'wide', edge: 1920, scale: 4 });
const art = studio.render(world, { w: frame.renderWidth, h: frame.renderHeight,
  px: 1, colored: true, lensScale: frame.lensScale });
const rgb = captureFrame.pixels(art.rgb, frame, { channels: 3 });
```

`pixels` expands each art pixel by an integer factor and trims any fractional
block at the output border. Use `flipY: true` for a bottom-up framebuffer
readback. The software renderer's `lensScale` also works independently with
either perspective or orthographic cameras.

## Graphs and reusable groups

```js
const graph = K.procedural.graph.create({
  inputs: { offset: { type: 'number', default: 2 } },
  nodes: {
    width: {
      op: 'add',
      inputs: {
        a: { input: 'offset' },
        b: { keys: [{ time: 0, value: 0 }, { time: 2, value: 1 }] }
      }
    }
  },
  outputs: { width: { node: 'width' } }
}, {
  operations: {
    add: {
      inputs: { a: 'number', b: 'number' },
      outputs: { value: 'number' },
      run: ({ a, b }) => ({ value: a + b })
    }
  }
});
const frame = graph.evaluate({ offset: 3 }, { time: 1, seed: 7 });
frame.outputs.width;
frame.preview('width');
frame.status.width;
```

Connections read an exposed `input`, a `node` and optional `port`, a keyframe track, or a literal `value`. Types include scalars, vectors, geometry, fields, points and raster images. A node's inputs, seed and optional clock control its cache. Returned preview handles see the outputs of their own run. Wrap a graph using `graph.group(spec, { operations, groups, outputs })` and register it as an operation in another graph. Each group instance owns its cache. Preview an inner node with a path such as `frame.preview('groupName/innerNode')`. Use `clear()` after changing resources in place. Built-in operations include `meshPaths`, `attributeTransfer`, `densityMesh`, `densityPoints`, `materialSample`, `rasterLayer`, and `tiles`.

`graph.repeat(value, count, step, { seed })` iterates a value. `graph.each(items, fn, { seed })` gives each item a reproducible seed based on its ID. `graph.simulation({ initial, step, dt, checkpoint, cache, maxSteps })` advances states using fixed timesteps. Sample with `simulation.sample(time, { inputs, version })` to retrieve an exact fixed-step state, the number of steps replayed, and the cached checkpoints. Bump the version when the simulation inputs change.

## Run a graph project from the CLI

The [headless graph project](../examples/headless-graph.json) uses a named
parameter, an animated link, and a [reusable group](../examples/headless-graph-group.json).

```sh
ink-studio graph validate examples/headless-graph.json
ink-studio graph plan examples/headless-graph.json
ink-studio graph inspect examples/headless-graph.json --node gain/scale --at 0.5
ink-studio graph run examples/headless-graph.json --at 0.5 --out graph-out
ink-studio graph batch examples/headless-graph.json cases.json --out graph-batch
ink-studio graph session examples/headless-graph.json --protocol ndjson
```

Use `"format": "ink-studio/graph-project"` and `"version": 1` with the same
`inputs`, `nodes`, and `outputs` as a library graph. Set input defaults on the
typed ports and pass overrides as a JSON object with `--inputs values.json`.
Optional project `time` and `seed` default to zero. Set `--at` for seconds and
`--seed` for a specific integer seed.

The `groups` map registers each named group as an operation. A group value is
an inline graph or a file path relative to the project. Group files use
`"format": "ink-studio/graph-group"` and `"version": 1` with the graph fields.
Groups can use other groups registered in the same project. Each instance
owns its own evaluator and cache. Validation checks typed links, missing
ports, asset references with literal names, and dependency and group cycles
without running nodes. Planning reports the evaluation order, source links
and inferred output types. Add `--inputs` to validate and show resolved
parameter values.

`inspect` accepts `--output NAME` or `--node PATH` with optional `--port NAME`
(defaults to `value`). Use slashes to address a node inside group instances.
The JSON report describes the sampled value. With `--out DIRECTORY`, a
serializable preview is written as PNG or JSON alongside the report.

In addition to the stock procedural graph operations, the runner registers
`add`, `multiply`, and `lessThan` with numeric `a` and `b` inputs, `time`, seeded `random`,
and `pngAsset` and `jsonAsset`. An asset operation reads a `name` from the
project's `assets` map. For example `"sprite": {"format":"png","file":"sprite.png"}`
declares a PNG asset called `sprite`. Assets are loaded relative to the
project and held as a snapshot for the life of the session. The plan and runs
share a hash of the project, resolved group definitions, and asset bytes.
Host operation implementations are supplied separately.

### Outputs and CI

Declare `exports` as a map of artifact names to `{ "output": "name", "format": "json" }`,
`"png"` for RGB8 or RGBA8 image outputs, or `"atlas"` for an Ink sprite
atlas bundle. With `--out`, runs write those
artifacts and `report.json`. The stdout report includes artifact paths,
SHA-256 hashes and cache hits and misses for every executed node, including
group paths. Cache statuses describe the current evaluation. Unchanged
artifacts have the same hash across cold and warm runs.

Declare assertions on named outputs with `id`, `output`, `op` and `value`.
Use optional `path` to select record keys or array indices. Operators are
`eq` and `ne` for exact equality, `min` and `max` for inclusive numeric
limits, and `sha256` for a PNG or JSON byte hash. JSON exports sort object
keys and use UTF-8, two-space indentation and a trailing newline. Missing
paths fail. For example:

```json
{"id":"nativeWidth","output":"sprite","path":["width"],"op":"eq","value":32}
```

A batch file is an array of cases. Each case has a unique `id` and optional
`inputs`, `time` and `seed`. Cases run in order using one compiled graph.
`--inputs`, `--at` and `--seed` give defaults and each case can override
them. The CLI writes one report and artifact set per case under
`cases/<id>/` and an aggregate report at the output root. For example:

```json
[
  {"id":"default","time":0.5},
  {"id":"repeat","time":0.5},
  {"id":"regression","time":0.5,"inputs":{"base":1}}
]
```

Exit status is 0 on success, 2 when any assertion fails, and 1 for invalid
input or execution errors. Assertion failures still write the declared
artifacts and report.

### Persistent sessions

Send one JSON request per line. The response echoes the optional request
`id` and includes the per-request `code`. Use `run`, `inspect`, `plan`,
`clear` and `quit`. For example:

```json
{"id":1,"op":"run","inputs":{"base":5},"time":0.5,"seed":9}
{"id":2,"op":"inspect","node":"gain/scale","inputs":{"base":5},"time":0.5,"seed":9}
{"id":3,"op":"quit"}
```

Session requests use independent parameter overrides. A bad request returns
an error response and the session can answer later requests. `clear` resets
node and group caches. If the session has `--out`, each run or inspection
publishes into its own `request-N` directory.

Use `ink.readGraphProject(file)` or `ink.createGraphProject(spec, { baseDir,
operations })` in Node for the same validation, planning, inspection and
execution. `run` returns the native named outputs in addition to the report
and encoded artifacts. Operation implementations can be registered from the
host using `operations`, or from an `ink-studio.config.js` file using
`graphOperations`. Treat input and output values as immutable while an
evaluator caches them.

## Typed data and arrays

Declare these types on project inputs, group ports, or library operations.

| Port type | Value |
| --- | --- |
| `raster` | `{width, height, data, channels?}` with 1–4 interleaved channels of finite samples. Omit `channels` to infer it from the buffer length. PNG export requires RGB8 or RGBA8. |
| `field` | A callable field or an Ink handle with a `sample` method. Graph operations can produce fields such as the distance output of `meshPaths`. |
| `path` | At least two finite points of the same dimension (2D or 3D), or `{points, closed?}`. |
| `mesh` | 3D `points` and indexed polygon `faces`, or flat triangle buffers named `pos`/`tri`, `positions`/`indices`, or `points`/`triangles`. |
| `palette` | 1–256 swatches as packed RGB integers, six-digit hex strings, or RGB triples in `[0,1]`. Accepts a swatch array or `{palette}`. |
| `atlas` | An Ink sprite atlas with `metadata` and RGBA8 `images`, or its compiled handle. Use `atlas.compile` to make the handle in a graph. |
| `audio` | `{sampleRate, channels, samples}` with a positive integer rate and channel count and complete frames of normalized interleaved PCM samples in `[-1,1]`. |
| `record`, `array`, `array<T>` | A plain named record, an array of arbitrary values, or an array whose elements must satisfy port type `T`. Arrays can nest, as in `array<array<number>>`. |

Use a `data.typed` node with a top-level `type` and a `value` input to
validate a literal or a value from `jsonAsset` and expose a typed output.
Graph planning checks links between declared types. A link from `any` is
checked against the receiving port when evaluated. Node callers can supply
native typed buffers and compiled handles as input overrides. Their contents
must stay immutable while cached.

### Array operations

`array.map`, `array.filter`, `array.reduce`, and keyed `array.sort` take
`items` and name a reusable callback with the node's `group` field. The group
declares an `item` input and a `value` output. It can also declare a numeric
`index` for the zero-based index in the input array. Further group inputs
become ports on the array node. Each item gets a deterministic seed based
on its index and the node seed.

| Operation | Group output and result |
| --- | --- |
| `array.map` | Replace each item with the group's `value`. |
| `array.filter` | Keep items whose group returns `true`, in input order. |
| `array.reduce` | Pass `initial` to the group's `accumulator` input, then feed each returned `value` into the next call in input order. An empty array returns `initial`. |
| `array.sort` | Use finite numbers or strings as keys, in `asc` or `desc` order. Equal keys preserve input order in both directions. Omit `group` to sort an array of numbers or strings directly. |

`array.broadcast` takes an `arrays` record of named axes and an explicit
`mode`. Use `data.record` to assemble axes linked from other graph nodes.
The output has one record per row, keyed by axis name.

| Mode | Alignment |
| --- | --- |
| `zip` | Pair entries at the same index. All axes must have the same length. |
| `cycle` | Run to the longest length and wrap shorter axes. |
| `hold` | Run to the longest length and repeat the last entry of each shorter axis. |
| `cartesian` | Produce every combination. Axis names sort lexically and the last axis varies fastest. |
| `cartesianReverse` | Produce every combination with the first sorted axis varying fastest. |

An empty axis produces zero rows when the lengths are valid for the mode.
Set `limit` to cap the number of output rows. The same operation is available
as `KIT.procedural.graph.arrays.broadcast(arrays, { mode, limit })`.

### Cartesian parameter sweeps

`graph batch` also accepts a sweep object. Each axis contains a nonempty
array of values. Sweep any named graph parameter under `inputs` and
optionally `time` and `seed`. The batch uses sorted axis names
(`inputs.NAME`, `seed`, `time`) with the last axis varying fastest. It
assigns sequential case IDs with the given `idPrefix` and reports the axis
lengths and case count alongside the regular batch results. The default
limit is 256 cases.

```json
{"idPrefix":"signal","sweep":{"inputs":{"gain":[1,2,3],"threshold":[2,3]}}}
```

The [signal graph](../examples/headless-array-graph.json) maps, filters,
sorts, and reduces a typed numeric array. Run it for six combinations
using the [sweep definition](../examples/headless-array-sweep.json).

```sh
ink-studio graph batch examples/headless-array-graph.json examples/headless-array-sweep.json --out graph-sweep
```

## Standalone raster composition

The raster library lives at `ink.load().KIT.procedural.raster`. The same
operations are stock nodes in versioned graph projects. They work on
standalone canvases and imported PNGs. Canvas coordinates start at the
top left, with X right and Y down. Color composition uses straight-alpha
RGBA8 in and out. One-channel rasters can also carry signed or fractional
values, such as depths in scene units or normalized masks.

| Graph operation | Inputs and outputs |
| --- | --- |
| `raster.canvas` | Set `width`, `height` and an optional RGB or RGBA `color` in byte units. Defaults to transparent. |
| `raster.channel` | Extract a channel from `source`. Set `options.channel` to an index, `r`, `g`, `b`, `alpha` or `luma`. |
| `raster.channels` | Set `planes` to one to four aligned single-channel rasters or constants. At least one plane supplies the dimensions. |
| `raster.math` | Set `a`, `b` and `op`. `b` may be an aligned raster or a scalar. A single-channel `b` broadcasts across the channels of `a`. |
| `raster.mask` | Multiply `source` alpha by an aligned `mask`. Set `options.channel` (default `luma`), `scale` (default 255) and `invert`. |
| `raster.rgba` | Convert `source` to RGBA8 for display or PNG export. One and two channels represent gray and gray-alpha. |
| `raster.frame` | Composite the current time of an Ink layered raster `source`. Set optional `options.tag` and `layers`. |

Channel math offers `add`, `subtract`, `multiply`, `divide`, `min`, `max`,
`difference`, `power`, `greater`, `less` and `equal`. Comparisons produce
zero or one, so set mask `scale` to 1 when using them to gate coverage.
Math preserves numeric results and rejects nonfinite samples. Inspect
numeric channels with `graph inspect` or export them as JSON.

### Layers, depth, and height

Use `raster.blend` for a `background` and `foreground`. Its `options`
describe the foreground layer. Use `raster.stack`, `raster.depth` or
`raster.height` with explicit `width`, `height` and a `layers` array for
several layers. A layer has a `source` raster and optional integer `x` and
`y` offsets, `opacity` from 0 to 1, RGB `tint` multipliers from 0 to 1, a
local `mask` with `maskOptions`, and a blend `mode`.

Modes are `normal`, `multiply`, `screen`, `overlay`, `hardLight`,
`softLight`, `add`, `subtract`, `darken`, `lighten`, `difference` and
`exclusion`. The ordinary stack draws from back to front in array order.

- `raster.depth` accepts a scalar or an aligned one-channel `depth` per
  layer. Lower values are closer. It sorts covered samples per pixel and
  resolves ties in stack order. The `depth` output gives the closest
  contributing depth. Use the color output's alpha for coverage.
- `raster.height` compares a scalar or an aligned one-channel `height` per
  layer as it composites. Higher samples come forward. `options.bias`
  shifts the comparison and `softness` feathers the join in height units.
  The `height` output contains the visible, coverage-weighted height.

Create each layer record with `data.record` to link its image and maps.
Use another `data.record` to name those layers and `data.collect` with a
`source` record and `keys` array to assemble them in explicit order.

### Sprite transforms and packing

| Graph operation | Options |
| --- | --- |
| `raster.crop` | Set `x`, `y`, `width`, and `height` of an in-bounds rectangle. |
| `raster.resize` | Set `width` and `height`. Choose `nearest` (default) or `bilinear` for `filter`. Bilinear filters colors with premultiplied alpha by default. Set `premultiply: false` for independent numerical channels. |
| `raster.nineSlice` | Set `width`, `height`, and `insets: [left, top, right, bottom]`. Choose `stretch` or `repeat` for `fill`. Corners retain their original dimensions. |
| `raster.spriteStack` | Pass one raster or a bottom-to-top array as `source`. Set the repeat `count`, per-slice pixel `shift`, rotation `angle` in radians, first or last slice `anchor`, base `tint`, or `endOpacity`. Set `size` and optional `position` for a fixed canvas. Omit them to fit the full stack. |
| `raster.pack` | Set `sprites` and options such as `maxWidth`, `maxHeight`, transparent `padding`, edge `extrude`, and alpha `trim`. Outputs the color raster, native `atlas` and `metadata`. |

Crop, resize, and nine-slice accept an optional pixel `pivot: [x, y]` on
the source raster and map it into the result. Sprite stacks align slices
by pivot, falling back to their centers.

Atlas entries can be a raster or a record with `source`, `id`, optional
`pivot`, `unitsPerPixel`, and aligned `maps` such as `normal`, `emission`,
`silhouette`, and `depth`. For Ink RGB24 depth maps provide
`options.depthRange: [near, far]`. Packing keeps the original frame order
and records each source size, trim offset, atlas rectangle and adjusted
pivot. Export the node's `atlas` port with `format: "atlas"` to write
`artifacts/<name>/atlas.json` and its PNGs, ready for `readSpriteAtlas`.

Generate the [review example](../examples/raster-composition.cjs) to see
depth-sorted rings, height-blended moss, a masked beacon beam, a stamped
sprite stack, a nine-slice panel, and a packed sheet. The example writes the
input PNGs and graph project, runs the CLI, and makes a PNG review board.

```sh
node examples/raster-composition.cjs raster-composition-review
ink-studio graph run raster-composition-review/composition.json --out raster-composition-review/graph
```

## Drawing, layout, and regions

Use `draw.render` with `width`, `height`, and a `commands` array to
make a transparent standalone raster. Commands draw in order, in
top-left pixel coordinates. Set `edges: "hard"` for pixel coverage or
use the default `"smooth"` coverage. Hex colors accept RGB and RGBA.

| Command | Settings |
| --- | --- |
| `rect`, `ellipse` | Specify `rect: [x, y, width, height]`, `fill`, optional `stroke` and stroke `width`. Rectangles also accept a corner `radius`. |
| `polygon` | Set `points` for one contour or `rings` for several. Fill uses even-odd coverage, so a second contour can cut a hole. |
| `path` | Use 2D `points`, a linked typed path in `source`, or an SVG-style `d` string. Set `color` or `stroke` and `width`. For filled contours, set `fill` and close each contour. |
| `ribbon` | Follow a 2D path with a constant width or one width per path point. Set `fill`, optional `stroke` and `strokeWidth`, and a `miterLimit` for corners. |
| `text` | Set `text`, integer `at: [x,y]`, `color`, and optional bitmap typography settings. |
| `arrow`, `grid` | Use the screen-space settings from [Drawing primitives](drawing-primitives.md). |

`draw.path` turns one `d` contour into a typed `{points, closed}` path.
The path syntax supports absolute and relative `M L H V Q C A Z`.
Use `options.steps` to sample curves. `draw.render` can also fill
multiple closed contours from one `d` string. `draw.ribbon` accepts a
typed `source` and returns a polygon command ready to draw. Assemble
linked commands in explicit order with `data.record` and `data.collect`.

`draw.text` generates a standalone bitmap raster and `metrics` with
its width, height, line count and scale. It uses Ink's 6×8 glyphs,
with integer `scale`, `tracking`, and `leading`, optional `columns`
for character wrapping, and `align: "left" | "center" | "right"`.
Supply `customGlyphs` as a map from characters to rows of `#` and
spaces to draw symbols in the same grid.

### Relative boxes

`layout.boxes` takes the canvas `width`, `height`, and a `boxes` array.
Each entry has an `id` and optionally a `parent`, `size`, `offset`,
`anchor`, `pivot`, and `padding`. Parents use their content rectangle
as the coordinate system for children. Size and offset accept pixels
or percentage strings relative to the parent span. Anchor fractions
select a point in the parent and pivot fractions select a point in the
child. Padding uses a number or four left, top, right, bottom values.
The result is keyed by ID. Each box reports a pixel-rounded `rect`
and `content` rectangle.

```json
{"id":"legend","parent":"sheet","size":["45%",18],"anchor":[1,1],"pivot":[1,1],"offset":[-4,-3]}
```

Get a named box with `data.get`. Pass the box and a `source` raster to
`layout.place` to produce a layer for `raster.stack`. Set `options.fit`
to `contain`, `cover`, `stretch`, or `none`. Fractional `align` defaults
to the center. Placement uses `content` by default and clips overflow.
Set `area: "rect"` to use the outer box, or `clip: false` to allow spill.

### Flood fill and connected components

- `raster.floodFill` takes a `source` and `options.seed: [x,y]`. It
  replaces the connected region with `color` and returns a byte `mask`
  and `stats` with area and pixel bounds. Choose `connectivity` of 4 or 8.
  Set `tolerance` to the maximum byte difference from the seed in each
  RGBA channel.
- `raster.components` thresholds the selected `channel` into adjoining
  regions. The default selects alpha on alpha-bearing sources and luma
  otherwise. Choose `threshold`, `invert`, `minArea`, and 4- or 8-way
  `connectivity`. IDs follow the first covered pixel in row-major order.
  The result contains component records with IDs, areas, seeds, and
  bounding rectangles, plus a one-channel `labels` raster with zero
  for background.
- `raster.extractComponent` takes the original `source`, `labels`, and a
  component record. It crops to the component bounds and clears pixels
  outside that component. Use it in an `array.map` group to pass the
  isolated sprites to `raster.pack`.

The library provides the same operations under
`ink.load().KIT.procedural.drawing2d`. The [tide chart example](../examples/drawing-layout.cjs)
renders two chart sizes, fills shoreline and lagoon regions, draws the
route ribbon, and extracts three symbols to a native atlas.

```sh
node examples/drawing-layout.cjs drawing-layout-review
ink-studio graph run drawing-layout-review/tide-chart.json --out drawing-layout-review/graph
```

## Geometry and attributes

`geometry.meshPaths(mesh, { sources, edgeCost, maxCost })` supports native and imported indexed meshes. It returns per-vertex distances and predecessors, plus `path(vertex)`, `curves(vertices)` and a sampled `distanceAt(point)` field. The cost function receives positions, vertex IDs, length and adjacent faces. Return infinity to block an edge.

`attributes.mesh(mesh, { vertex, face })` builds a nearest-surface sampler. Use `{ type: 'number' | 'vec2' | 'vec3' | 'label', values }` per channel. Numeric values interpolate across triangles. Labels and stable IDs are assigned from the dominant vertex or authored face. `attributes.sdf(field, callback)` projects a point onto a signed field. `attributes.carrier(carrier, callback)` samples a named surface chart. Use `attributes.transfer(sampler, domain, entities)` for points, faces, vertices, curve control points or instances. Use `attributes.paths` to retain curve IDs and per-control-point attributes, `attributes.nearest` to sample another captured table, and `attributes.splats(world, sampler)` to generate a table indexed by splat slot.

## Materials, artwork and animation signals

`graph.material({ height, wetness, ink, palette })` returns coordinated sample functions for height, normal, wetness, ink and palette roles. Connect individual outputs to masks, finishes or layered materials. `graph.tiles({ bounds, cell, mask, vector, scale, seed })` uses stable tile IDs and per-tile sampling to vary density, alignment and size.

`graph.raster({ width, height, layers, tags, fps })` takes named layers with RGBA frame arrays. Tags define half-open frame ranges, loop behavior and rate. Use `layer(name, time, tag)` for one image, or `composite(time, { tag, layers })` to composite selected layers in order. The payload is independent of the tool used to paint the source frames. In Node, `studio.readRasterAsset(file)` also accepts the same manifest with relative PNG paths as frame entries.

`KIT.anim.stateGraph.create(spec).instantiate()` runs keyframed states. Declare named inputs and triggers, timeline keys and optional cues per state, and ordered transition rules. A rule can check a trigger, minimum state age and input comparisons, with an optional blend. Advance on a monotonically increasing clock, calling `trigger(name)` and `advance(time, inputChanges)`. A returned sample includes the active state, mixed channels, cues and the transition taken. The host can bind those channels and cues to any effect or scene property.

Try `ink-studio sheet examples/graph-study.js --from 0 --to 2.6 --n 4 --ortho` for a layered signal animation that drives a cached growth effect across field-aligned tiles.

## Incremental authoring context

`ctx.collection` can match exact scalar values in `parameters` alongside
type and relationship filters. For a fact computed from multiple records,
`ctx.watch(select)` tracks a pure selector against the immutable document
view. Descriptors and rules rerun when the result changes by `Object.is`.
Use a scalar or stable immutable reference for the result. Spatial queries
made by a rule retain their type, tag and exclusion filters when deciding
whether a change affects it.

## Flooded Shrine

`procedural.floodedShrine.create({ seed, controls, snapshot })` owns a retained authoring document with an entrance, a hero silhouette and generated parts. Use `pin`, `setControls` and `regenerate` to steer the layout. Work with generated parts via the document's ordinary update, suppress, promote and undo APIs. The waterline, age, vegetation and path clearance can change while pinned anchors and authored overrides persist.

```sh
ink-studio render examples/flooded-shrine.js --ortho --params '{"waterline":0.3,"age":0.65,"vegetation":0.8,"clearance":1.3}'
ink-studio variants examples/flooded-shrine.js --seeds 6,19,27,30,47,71 --group openness --motion
```

The variant sheet is sorted by silhouette, openness or wear. The JSON sidecar includes art-resolution crisp and lint measures, and short-orbit shimmer when `--motion` is supplied. Existing snapshots can be used with `--authoring file.json`.

## GLB cutouts and UV surface stamps

`await studio.readAsset(file, {size: 3})` reads a portable GLB asset on Node, with the bundled PNG decoder. Supply `decodeImage` for embedded JPEGs. Embedded images retain RGB and optional alpha up to 128 pixels per edge, within the existing 16,384-texel budget.

The texture sampler exposes `opacityAt(face, u, v)` and `opacityAtPoint(face, x, y, z)`. Material samples also include `opacity`. glTF `OPAQUE` ignores alpha, `MASK` applies `alphaCutoff`, and `BLEND` multiplies texture, base-color factor and vertex alpha. Older RGB recipes remain opaque. Thumbnails composite visible layers in depth order.

`KIT.authoring.assetSurfaces.splat(builder, asset, options)` emits planar surface stamps carrying a UV shader. Atlas color, normal, roughness, emission and coverage are sampled at each art pixel. Texture detail therefore survives coarse splat spacing. The stamps retain underlying geometry behind cutouts and can be added to an existing scene.

`assetSurfaces.world(asset, options)` wraps the same path in a standalone world. Options include `size`, `at`, `turn`, `up`, `res`, `maxSplats`, `light`, `ambient`, `palette`, `hues`, `shades` and `cam`. Splats use the renderer's usual translucent blending. Save the portable asset or scene factory to preserve UV shaders, whose functions cannot be retained in a plain JSON world dump.

`assetSurfaces.field(asset, {size, cells, thick, alphaCutoff})` excludes invisible triangle patches before distance-field conversion. Visibility is sampled at twice the atlas texel density, with bounded triangle work. Fractional opacity is classified at the supplied cutoff (default 0.5). The result is a geometric signed field, so its resolution and shell thickness determine the smallest retained opening. Supply `thick` when converting open clothing or overlay surfaces.

The headless CLI automatically uses UV stamps for GLBs that fit the portable asset budgets. Use `--uv` to require that path and report unsupported imports, or `--uv off` to select the existing geometry importer.

```sh
ink-studio render character.glb --uv --res .06 --ortho --out character.png
```

### Textured SDF reconstruction

Pass `geometry: 'sdf'` to `assetSurfaces.world` or `assetSurfaces.splat` for the complete mesh → alpha-aware SDF → reconstructed surface → UV/material transfer → splat pipeline. The default remains `geometry: 'mesh'`.

The alpha field retains the original face that owns each visible patch. The reconstructed splats use that ownership to sample the original atlas at each rendered pixel, while their positions and normals come from the reconstructed surface. This preserves the source color, alpha, roughness, normal and emission channels through remeshing. Small cutouts and closely spaced layers remain limited by field resolution and shell thickness.

```js
const surfaces = studio.load().KIT.authoring.assetSurfaces;
const asset = await studio.readAsset('character.glb', {size: 3});
const world = surfaces.world(asset, {
  geometry: 'sdf', size: 6, cells: 112, thick: .065, res: .045
});
```

`cells` controls field resolution, `resolution` optionally controls reconstruction spacing, and `res` controls splat spacing. `world.sdf` records field dimensions, spacing, source triangle count and reconstructed triangle count for inspection. An optional `field` can supply a modified asset field, retaining its `sourceFace` lookup. This supports SDF carving before textured splat baking. A plain distance grid without source-face ownership needs that attribution restored before UV transfer.

```sh
ink-studio render character.glb --uv --geometry sdf --cells 112 --thick .065 --res .045 --ortho --out character-sdf.png
```


### Background transaction resolution

After collecting a draft with `document.begin(label)`, a caller can use
`await document.scheduleCommit(resolveDraft)` to resolve it in a worker.
The callback receives a frozen draft and returns the complete resolved document
snapshot. Configure the worker with the same generation rules and commit hooks
as the owning document. The result records one undo step and one autosave
revision. The document exposes the draft for rendering during resolution.

A new write, undo, or explicit commit settles the pending transaction using
the local hooks. Cancellation discards the draft, and late replies are ignored.
A failed resolver falls back to local hooks and ordinary rollback behavior.

### Immutable document patches

Use `A.data.documentView(snapshot)` to validate and freeze a worker's initial
snapshot. `A.data.patchDocumentView(view, {metadata, upserts, removed})` applies
later revisions to that view. `metadata` replaces supplied top-level JSON
values, `upserts` maps entity IDs to complete records, and `removed` lists
entity IDs to delete. The result validates references across the change and
shares unchanged entity and style records with the previous view. This lets
workers retain compiled geometry and material caches between messages.
