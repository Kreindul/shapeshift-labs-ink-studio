# Headless procedural authoring

These APIs are available through `KIT.procedural` in Node and the browser bundle. Graph specifications are JSON data. Register executable operations in host code and share their typed inputs and outputs with the specification.

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

Connections read an exposed `input`, a `node` and optional `port`, a keyframe track, or a literal `value`. Types include scalars, vectors, geometry, fields, points and raster images. A node's inputs, seed and optional clock control its cache. Returned preview handles see the outputs of their own run. Wrap a graph using `graph.group(spec, { operations, groups, outputs })` and register it as an operation in another graph. Each group instance owns its cache. Use `clear()` after changing resources in place.

`graph.repeat(value, count, step, { seed })` iterates a value. `graph.each(items, fn, { seed })` gives each item a reproducible seed based on its ID. `graph.simulation({ initial, step, dt, checkpoint, cache, maxSteps })` advances states using fixed timesteps. Sample with `simulation.sample(time, { inputs, version })` to retrieve an exact fixed-step state, the number of steps replayed, and the cached checkpoints. Bump the version when the simulation inputs change.

## Geometry and attributes

`geometry.meshPaths(mesh, { sources, edgeCost, maxCost })` supports native and imported indexed meshes. It returns per-vertex distances and predecessors, plus `path(vertex)` and `curves(vertices)`. The cost function receives positions, vertex IDs, length and adjacent faces. Return infinity to block an edge.

`attributes.mesh(mesh, { vertex, face })` builds a nearest-surface sampler. Use `{ type: 'number' | 'vec2' | 'vec3' | 'label', values }` per channel. Numeric values interpolate across triangles. Labels and stable IDs are assigned from the dominant vertex or authored face. `attributes.sdf(field, callback)` projects a point onto a signed field. `attributes.carrier(carrier, callback)` samples a named surface chart. Use `attributes.transfer(sampler, domain, entities)` for points, faces, vertices, curve control points or instances, and `attributes.splats(world, sampler)` to generate a table indexed by splat slot.

## Materials, artwork and animation signals

`graph.material({ height, wetness, ink, palette })` returns coordinated sample functions for height, normal, wetness, ink and palette roles. Connect individual outputs to masks, finishes or layered materials. `graph.tiles({ bounds, cell, mask, vector, scale, seed })` uses stable tile IDs and per-tile sampling to vary density, alignment and size.

`graph.raster({ width, height, layers, tags, fps })` takes named layers with RGBA frame arrays. Tags define half-open frame ranges, loop behavior and rate. Use `layer(name, time, tag)` for one image, or `composite(time, { tag, layers })` to composite selected layers in order. The payload is independent of the tool used to paint the source frames.

`KIT.anim.stateGraph.create(spec).instantiate()` runs keyframed states. Declare named inputs and triggers, timeline keys and optional cues per state, and ordered transition rules. A rule can check a trigger, minimum state age and input comparisons, with an optional blend. Advance on a monotonically increasing clock, calling `trigger(name)` and `advance(time, inputChanges)`. A returned sample includes the active state, mixed channels, cues and the transition taken. The host can bind those channels and cues to any effect or scene property.

Try `ink-studio sheet examples/graph-study.js --from 0 --to 2.6 --n 4 --ortho` for a layered signal animation that drives a cached growth effect across field-aligned tiles.

## Flooded Shrine

`procedural.floodedShrine.create({ seed, controls, snapshot })` owns a retained authoring document with an entrance, a hero silhouette and generated parts. Use `pin`, `setControls` and `regenerate` to steer the layout. Work with generated parts via the document's ordinary update, suppress, promote and undo APIs. The waterline, age, vegetation and path clearance can change while pinned anchors and authored overrides persist.

```sh
ink-studio render examples/flooded-shrine.js --ortho --params '{"waterline":0.3,"age":0.65,"vegetation":0.8,"clearance":1.3}'
ink-studio variants examples/flooded-shrine.js --seeds 6,19,27,30,47,71 --group openness --motion
```

The variant sheet is sorted by silhouette, openness or wear. The JSON sidecar includes art-resolution crisp and lint measures, and short-orbit shimmer when `--motion` is supplied. Existing snapshots can be used with `--authoring file.json`.
