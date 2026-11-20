# Headless worlds

Ink Studio can advance a declarative world, apply timed actions, inspect the
result, and replay or compare runs. A scene uses the same query descriptors
from JavaScript and the CLI. Each query reads one published revision.

For editable SDF-biome scenes, the
[biome revision API](procedural.md#biome-revisions) stages terrain, water,
navigation and splats together. Its packed render world can also be read
with `K.world.query.fromScene`.

[Place travel and portals](portals.md) connect separate authored places with
prepared destination views, actor and camera handoffs, and fade-based travel.

## Run and compare a watershed

Save the starting checkpoint after the reservoir has settled.

```sh
ink-studio sim run examples/world-watershed.json --ticks 30 --checkpoint filled.json
```

Save an action list as `spillway.json`.

```json
[
  {
    "tick": 31,
    "action": "river/bed",
    "args": {
      "bounds": {"min": [-1.55, -0.75], "max": [-0.55, 0.75]},
      "height": -0.25
    }
  }
]
```

Run both branches to the same tick. The baseline remains dry at the bridge.
The edited bed releases the reservoir and the downstream probe reports flow.

```sh
ink-studio sim fork filled.json --ticks 120 --record hold.run.json
ink-studio sim fork filled.json --ticks 120 --actions spillway.json --record lower.run.json
ink-studio probe lower.run.json --field river/water --entity footbridge --json
ink-studio sim diff hold.run.json lower.run.json --field river/depth --entity footbridge
ink-studio sim replay lower.run.json
ink-studio sim render lower.run.json --out lowered.png
```

In a simulation render, put [surface color curves](surface-materials.md#color-curves-on-surfaces)
in `visual.terrainSurface` or `entities.<id>.visual.surface`. Field sources
sample the rendered checkpoint or tick. Set `visual.look.colorCurves` for a
scene-wide palette treatment, and pass `--color-curves off` to preview the
scene with those layers disabled.

`sim resume` and `sim fork` both start a new process from a checkpoint. Keep
their output paths distinct to retain both branches. A run file contains its
starting checkpoint, added commands, and ending checkpoint. Replay verifies the
result against the recorded ending state. Sign differences between positive
and negative zero follow JSON numeric equality. `sim reset` on a recording
returns to its starting checkpoint. `--ticks` selects an absolute tick,
`--steps` advances relative to the current tick, and `--t` converts seconds
to a tick using the scene timestep. Use one of these per invocation.

`sim sweep <world> <cases.json>` runs an array of cases. Each entry accepts
`id`, `seed`, `edits`, `ticks`, `actions`, `probes`, and `assert`.
For sweeps from a checkpoint, use actions to vary the branches. A probe entry
contains `field`, optional `at`, and optional `args`.

When a case supplies `look`, the sweep renders every case from the same
simulation snapshot. [Look cases and color metrics](pixel-look.md#compare-looks-on-a-fixed-view) use the same format as `compare`.

`--assert checks.json` accepts an array of field checks with `field`, optional
`at`, optional `args`, optional expected `status` (default `ok`), and a
`when` condition. Use `tick` to check one earlier frame or `byTick` to allow
the condition to become true by a deadline. The default checks the final frame.
`--profile` reports per-system calls, total milliseconds and peak tick time.
A check may use `{"profile":"river","metric":"calls","max":90}`. Failed
assertions return exit code 2.

## Query a revision

```sh
ink-studio inspect lower.run.json
ink-studio inspect lower.run.json --near 2,0,0 --radius 2
ink-studio probe lower.run.json --field world/position --entity footbridge --socket north
ink-studio trace lower.run.json river/flow --at 1,0,0 --args '{"steps":30}'
ink-studio probe lower.run.json --field world/history --args '{"where":{"path":["kind"],"value":"bed-edit"}}'
```

Fields and traces are named `system/name`. Use the short name when only one
system exports it. A probe reports `ok`, `dry`, `outside`, `missing`, or
`unavailable` as appropriate. Runtime scene files, checkpoints and run files use
the same field registry. The existing diorama loader also adapts published water
volumes, material sandboxes and exposed traversal graphs for inspection. A scene
can supply its own query adapter using `world.query(world, time)`.

Use `field <file> <name> --spec samples.json` with one of these sample specs.

```json
{"grid":{"min":[-5,0,-1],"max":[5,0,1],"counts":[21,1,5]}}
```

```json
{"line":{"from":[-5,0,0],"to":[5,0,0],"count":41}}
```

```json
{"ticks":[10,20,30],"at":{"entity":"footbridge"}}
```

An explicit `points` array is also supported. A time series may carry a
`spatial` sample spec to export each frame on the same grid. Grid rows are
X-fastest. The field descriptor supplies units. Conditions accept `path` as a
path array or JSON pointer, `op` as one of `eq`, `ne`, `exists`, `lt`,
`lte`, `gt`, `gte`, or `in`, and `value` where needed. Combine conditions
with `all`, `any`, or `not`.

## Typed spatial fields

The `fields` system publishes numeric scalars (`number`), vectors
(`vec2` and `vec3`), and named categories (`category`). Each field
can declare `units`, a coordinate `space`, domain `axes`, and `bounds`.
Existing scalar definitions with `default` and `regions` still work.

- Probe points and field export positions are XYZ in world space. Use
  `axes` to select the coordinates the field uses, such as `xz` for a
  ground map or `y` for a height profile. Domain and region bounds use
  those axes in order.
- The default coordinate space is `"world"`. Use
  `{"entity":"station","socket":"vane"}` to sample relative to the live
  pose of an entity or socket. `vec3` values authored in that frame are
  rotated into world space on read. `vec2` values use world space, with
  `components` identifying their axes (`xz` by default).
- A field can read its default value, winning region, or an authored grid.
  Grid values are a flat array ordered by the first axis fastest.
  Grid nodes span the declared bounds, and an axis with one node is
  constant along that axis. Numeric grids default to linear interpolation.
  Set `"sampling":"nearest"` for nearest-node reads. Categories declare
  their allowed strings and use nearest-node or region sampling.
- Regions override the underlying default or grid, with the last match
  winning. Use `system/set` with `{field, region}` to append a region at a
  scheduled tick. State and checkpoints carry those edits.
- Bounds include both ends by default. A field can declare
  `"boundary":"half-open"` to exclude the upper end. An out-of-domain
  probe returns `outside`. The built-in water depth, bed, and XZ flow
  use the same contract with half-open cell bounds.

`inspect` exposes the type, units, and spatial contract. Add `--explain`
to `probe` or `field` to get the source of each sample, including its
grid nodes and weights, the winning region, or the solver cell. The
report includes the revision tick and the position in both coordinate
spaces. JavaScript callers pass `{explain:true}` as the probe's third
argument.

The [harbor station world](../examples/world-spatial-fields.json) uses
one wind field for a raft's sail, a flag, and smoke. It also defines a
temperature gradient and a shelter field attached to a socket.

```sh
ink-studio probe examples/world-spatial-fields.json --field weather/wind --entity brazier --explain
ink-studio probe examples/world-spatial-fields.json --field weather/cover --entity station --socket vane --explain
ink-studio probe examples/world-spatial-fields.json --field weather/temperature --at 0,2,0
ink-studio field examples/world-spatial-fields.json weather/wind --spec examples/spatial-wind-transect.json --explain
ink-studio probe examples/world-spatial-fields.json --field weather/wind --entity brazier --ticks 60 --explain
ink-studio render examples/spatial-field-wind.js --params '{"tick":120}' --t 1.55 --out harbor.png
```

A query can bind a reusable XYZ sampler to its snapshot. Supply the
consumer's expected type and units to validate the binding. An optional
typed fallback is returned when a sample is unavailable.

```js
const wind = run.query().sampler('weather/wind', {
  type: 'vec3', units: 'world/s', fallback: [0, 0, 0]
});
const velocity = wind(0.4, 0.55, 0.35);
```

Pass the same callable directly as an XPBD wind function, adapt it to
the particle flow callback, or use its velocity to step a seed
trajectory. Bind from the current query when a simulation advances.
In a mechanics system, a force of kind `sail` samples a vector wind
field, takes the apparent wind along the sail's local `axis`, and
applies a two-sided pressure force. Set `field` to the field name and
`units` to the expected velocity unit (default `world/s`).

## Conservative transfers between systems

Systems can expose named accounts. A transfer debits one account and
credits another with the same accepted quantity. A request names two
`system/account` endpoints and an amount. Both endpoints must agree
on the resource, unit string, and quantity type. Accounts support
continuous numbers, safe integers for countable items, and signed
`vec2` or `vec3` quantities such as momentum.

- `store` defines accounts with `resource`, `units`, `initial`, and
  optional `type`, `min`, and `max`. Numeric accounts default to a
  zero lower bound. Vector accounts default to signed, unbounded
  components. Specify vector bounds per component, using `null` for
  unbounded components.
- `exchange` defines named links with `from`, `to`, and either an
  `amount` per tick or a `rate` per second. A Boolean input named
  after each link controls whether it submits requests. It starts
  enabled unless the link declares `"enabled":false`.
- A `water` system can expose named cells with
  `"accounts":{"outlet":[0.5,0.5]}`. Each account reads and writes a
  cell's actual water volume in `world^3`. The basin's mass probe counts
  account transfers in `received` and `sent`. Incoming water starts
  at rest, and withdrawing volume preserves the remaining water's
  velocity. The solver can then evolve the basin normally.

The default `partial` mode moves as much as the source can supply and
the destination can hold. Use `"mode":"exact"` to require the whole
amount. A clipped vector keeps its direction. If a move would round
away at either endpoint, both balances stay intact and the receipt
reports the precision limit.

The runtime applies ordinary commands, then settles scheduled
`world/transfer` requests in command order. System-generated requests
follow in system ID order and preserve each producer's own order.
Each request sees the balances left by earlier requests in that tick.
Producers all read the same pre-transfer snapshot and the input
values available at the start of the tick. Solvers step from the
settled snapshot. A failed endpoint write aborts the tick, including
any earlier transfers. Checkpoints and replay preserve receipts.

The [transfer station](../examples/world-transfers.json) requests
five cubic world units from a shallow-water basin. The cistern has
room for two, so the basin drops from eight to six while the tank
rises from eight to ten. The next pump request moves zero. The same
scene demonstrates capped heat storage, exact and partial integer
shipments, and signed vector transfers.

```sh
ink-studio inspect examples/world-transfers.json
ink-studio probe examples/world-transfers.json --ticks 1 --field world/transfers
ink-studio probe examples/world-transfers.json --ticks 1 --field basin/mass
ink-studio probe examples/world-transfers.json --ticks 2 --field world/account --args '{"account":"cistern/water"}'
ink-studio render examples/conservative-transfer.js --out transfer-station.png
```

`world/transfers` reports the latest tick's receipts with requested
and applied quantities, status, and limiting endpoint. The runtime
also emits a `transfer` event for each receipt, so `world/history` can
filter earlier transfers even after the run advances.

A custom system exposes the same interface through its factory. An
account's `read` returns its balance and current bounds. Its `write`
receives the new absolute balance and returns the updated JSON state.
Both functions operate on the supplied snapshot. A writer updates
only its account and any associated bookkeeping.

```js
accounts: {
  heat: {
    resource: 'thermal-energy',
    units: 'J',
    type: 'number',
    read: state => ({balance: state.joules, max: state.capacity}),
    write: (state, balance) => ({...state, joules: balance})
  }
}
```

To drive requests from a model, implement
`requestTransfers(state, context)` and return an array of
`{from, to, amount, mode?, id?}` objects. Use `checkTransfers(validate)`
to validate fixed endpoint references during world validation.

## Spatial dependency reports

Registered simulation systems can declare the fields and regions
they read and write. A declaration can name a whole field or a
bounded region. Use `axes` for lower-dimensional domains such as
`xz` on a terrain grid. A read can add `padding` for nearby samples.

```js
dependencies: {
  reads: [{field: 'river/bed', bounds: {axes: 'xz', min: [0, 0], max: [8, 4]}, padding: 0.25}],
  writes: ['route-cost']
}
```

An action or step calls `ctx.spatial.write(field, bounds, reason)`
after changing a declared field. Use `null` for a whole-field
change. Short write names belong to the system publishing them.
Action writes are visible to readers on the same tick. Step writes
become visible on the next tick alongside the new state, and
checkpoints preserve any pending writes.

A consumer can call `ctx.spatial.changes(bounds)` to get the
overlapping writes that match its read declaration. Call
`ctx.spatial.rebuilt(kind, detail, bounds)` after doing the work.
The report lists affected readers independently of the recorded
rebuilds. Built-in field region edits and water bed edits publish
spatial writes. Active agents replan when a reported change overlaps
their remaining route. Routine simulation and unreported changes
still use each solver's normal update rules.

```sh
ink-studio sim dependencies examples/world-watershed.json --ticks 31 \
  --actions examples/spatial-bed-edit.json --out runtime-dependencies.json
ink-studio sim dependencies examples/spatial-rebuild.js --out retained-dependencies.json
```

The runtime report includes the changed field and bounds, affected
systems, and measured work such as the number of water bed cells
sampled and changed. A recorded run is played from its starting
checkpoint to recover this timeline. A retained driver exports
`dependencies(kit)` and supplies its own edit sequence.

The retained biome pipeline uses the same tracker for terrain spans,
connected flooding, water boundaries, traversal links, and splat
chunks. The report links recorded work to its input changes using
`because` IDs. Flooding can publish changes beyond the edited region.
Painting a material can rebuild nearby splats using retained surface
geometry. Physical spans and route links can stay cached. Ordinary
`sim render` still assembles a fresh headless render scene.

## Multi-rate simulation

Declare a system's `schedule` on the system record. The world's `dt`
still defines command times, scenario evaluation, and checkpoint
ticks.

| Schedule | Solver cadence |
| --- | --- |
| Omitted | One step per world tick with `ctx.dt = world.dt`. |
| `{"substeps":4}` | Four evenly spaced steps per tick, each with a quarter of the world timestep. |
| `{"every":4}` | One step on ticks 4, 8, 12, and so on, with four world timesteps of elapsed time. |

The runtime aligns fast solvers on an integer grid. It limits the
combined subdivision to 64 and the slow interval to 3600 ticks.
Solvers due at the same boundary read the same state snapshot.
A stateful publication is visible at the following boundary.
Combinational connections can deliver values at a shared boundary
in dependency order.

A connection's `sample` sets the crossing rule.

| Rule | Behavior |
| --- | --- |
| `hold` | Read the most recent available value when the consumer runs. This is the default for level signals. |
| `average` | Time-weight the held number or vector over the consumer's interval. The initial output covers the interval before the first publication. |
| `sum` | Add each published number or vector increment once. Consume the accumulated total on the next solver call. |
| `events` | Queue event entries in publication order and deliver them once. Event connections use this rule when multi-rate scheduling is active. |

Connection delays are measured in world ticks. Delayed levels hold
the selected tick's final value. Delayed sums and events carry all
publications from the selected tick as a batch. Manual numeric inputs
hold their latest command value. Manual events accumulate in command
order and wait for the scheduled consumer. Initial outputs seed held
levels, while sums and event wires collect solver publications.

`ctx.time` is the end of the current solver step. `ctx.baseDt`,
`ctx.every`, `ctx.substep`, and `ctx.substeps` describe the schedule
when multi-rate mode is active. `ctx.tick` is the containing world
tick. Peer state and field queries read the snapshot at the start
of the current boundary. Fast steps use distinct deterministic
random streams. Commands and conservative transfer settlement run
once at the world tick boundary. Spatial writes emitted by a step
become visible on the next world tick. Slow spatial readers keep
matching notices until their next step.

Checkpoints preserve pending signal samples and spatial notices.
Only completed world ticks publish state. If a substep fails, the
run retains its previous checkpoint, inputs, and pending commands.
Profile `calls` counts actual scheduled solver calls. `maxMs` is
the largest total time spent on that system in one world tick.

The [multi-rate yard](../examples/world-multi-rate.json) runs a
native cart at 80 Hz, weather controls at 20 Hz, and terrain wear
at 5 Hz. Set `contactEvents:true` on mechanics and wear to connect
their `contacts` ports across rates. The wear system applies a
batch of wheel contacts at its update boundary. The example also
shows a slow temperature average alongside a held temperature
signal for the heater.

```sh
ink-studio sim run examples/world-multi-rate.json --ticks 4 --profile --record yard.run.json
ink-studio probe yard.run.json --field world/signal --args '{"port":"trail/contacts"}'
ink-studio sim replay yard.run.json
```

## Causal traces

Enable `"causality": true` on a world to record causal evidence during
simulation. `"causality": {"limit": 4096}` sets the retained node count.
The default is 2048 and the maximum is 20000. Causal recording has its
own retention and captures emitted events even if the world timeline
filters them out.

The [mill example](../examples/world-causal-mill.json) records a pump
load of 12 at tick 3. The breaker trips at its threshold of 8 on tick 4,
the motor sets drive to zero on tick 5, and the shaft stops on tick 6.

```sh
ink-studio sim run examples/world-causal-mill.json --ticks 8 --record mill.run.json
ink-studio trace mill.run.json world/cause --entity mill-wheel --args '{"kind":"machine-stop","system":"mill"}'
ink-studio trace mill.run.json world/cause --args '{"event":"6.0"}'
ink-studio trace mill.run.json world/cause --args '{"port":"mill/speed.shaft","atTick":5}'
ink-studio sim replay mill.run.json
```

Select a trace root by causal node `id`, timeline `event` ID, signal
`port`, or event or decision `kind`. The port and kind lookups choose
the latest matching node at or before `atTick`. Filter by `system` or
entity where applicable. A port lookup prefers its output when both
directions exist. Set `"direction":"input"` to trace the input sample.
Edges point from effects to their recorded causes. The report gives
each node's tick, readings and details. A
`partial` status and `gaps` identify missing evidence when retention,
`maxDepth`, or the returned node `limit` cuts off a branch.

Signal traces carry the actual samples a solver used, including delayed
samples and the publications behind multi-rate averages, sums, and
event batches. An output or event may be attributed to a declared
decision, the current command, observed solver inputs, or a held
publication. The `basis` identifies that attribution. Observed inputs
establish what was available to the solver. Systems can record exactly
which evidence contributed to a decision. Checkpoints and run recordings
preserve causal evidence through resume, replay, and forks.

In an opted-in world, custom systems can use `ctx.causal.input(key)`
and `ctx.causal.previous(key)` to reference an input sample or previous
output. `ctx.causal.read(field, at, args)` returns the query `result`
and a `cause` ID, recording the measured value and available provenance.
Call `ctx.causal.record(kind, detail, {inputs, causes, outputs})` to
record a decision with its selected input keys, evidence IDs, and output
keys. Pass the returned decision ID in `ctx.emit(kind, detail, [id])`
to explain a specific event.

## Physical material assets

A versioned asset pack can carry a `materials` list alongside families
and looks. Give each material an ID such as `earthworks/clay`. Use
`world/material` to resolve its pack revision and effective properties
for a specified wetness. Most numeric properties accept a constant or
`{"dry": 0.82, "wet": 0.10}` to interpolate over the moisture range.

| Property | What uses it |
| --- | --- |
| `friction` | Mechanics uses the coefficient to reduce sliding and cap driven wheel traction. If both contacting materials supply a coefficient, their geometric mean is used. |
| `permeability` | Potential water loss through the bed in world units per second. Surface water caps the loss by available water and reports it in its drainage ledger. |
| `thermal.heatCapacity`, `thermal.conductance`, `dryingRate` | Lumped heat capacity in J/K and conductance in W/K use the same reference area. Each cell approaches its ambient temperature at their ratio. The drying rate is in inverse seconds at 20 °C. Dry cells lose moisture faster as their temperature rises. |
| `erosion.threshold`, `erosion.rate` | For cells covered by water, the bed lowers at `rate × (flow speed − threshold)` above the threshold in world units per second. Each water system exposes the removed bed volume in its `eroded` field. |
| `fracture.energy`, `fracture.parts` | The mechanics fracture action checks supplied impact energy against the threshold. Fragments inherit the material. `parts` is the default number of pieces and can be overridden by the action. |
| `sounds` | Names the `step`, `roll`, `impact` and `fracture` cues. Foot and wheel contacts carry cue IDs. Impacts and fractures expose their cues in the event record for a host to play. |
| `appearance.dry`, `appearance.wet` | Equal-length hex color ramps mapped to the scene palette. The ground renderer interpolates them from the same moisture field. |

Bind `materialAsset` and optional `materialWetness` to an entity or
mechanics body. A body binding takes precedence over its entity binding.
A `fracture` command without energy directly edits the body.

For terrain, declare a `materials` system with an XZ `grid` containing
`width`, `height`, optional `cell` and optional `origin`. Set the default
`material`, initial `wetness` and `temperature`, and optional bounded
`regions`. A region covers cells whose centers lie inside its bounds.
Use `airTemperature` or a numeric `ambientField` in `degC`. Point
`water` at a water-column field to wet submerged soil. The wetness
field measures surface condition on a scale from zero to one.

Use the same `soil/surface` field as `surface` in water and mechanics
config, and as `visual.fields.surface` for rendering. The system also
exposes `soil/material`, `soil/wetness`, and `soil/temperature` as typed
spatial fields. Water publishes erosion through its existing bed field
and spatial dependency reports. Checkpoints save soil conditions and
the original asset packs for replay.

In the [clay yard](../examples/world-physical-materials.json), both
lanes use the same [physical material pack](../examples/physical-materials.pack.json).
Their moisture changes grip and color. An impact energy of 5 breaks
the dry clay and leaves the wet clay intact.

```sh
ink-studio sim run examples/world-physical-materials.json --asset-pack examples/physical-materials.pack.json --ticks 22 --record yard.run.json
ink-studio probe yard.run.json --field soil/surface --at -1.15,0,-2 --explain
ink-studio probe yard.run.json --field world/material --args '{"id":"earthworks/clay","wetness":0.5}'
ink-studio sim render yard.run.json --colored --out clay-yard.png
```

## Live cuts, fills, and material layers

A `volume` system defines a bounded editable solid. Set `bounds`, align
their endpoints to `cell`, and choose a `chunkCells` size. Its `initial`
array takes the same shape arguments as the live actions, with an
`op` field for each entry. Entries are applied in order. Material IDs
can name an inline RGB ramp or a physical material in an installed pack.

| Action | Effect |
| --- | --- |
| `quarry/cut` | Removes the part of the solid inside the brush. Newly exposed surfaces take the material from the surviving interior. |
| `quarry/fill` | Adds solid and assigns the supplied `material` to the new volume. Existing solid retains its material. |
| `quarry/layer` | Changes the `material` of existing solid inside the brush. Geometry and water topology keep their cached data. |

Every action takes a `shape`. A box uses `at`, `half`, and optional
`round`. A sphere uses `at` and `radius`. A capsule uses `from`,
`to`, and `radius`. Brushes can cross chunk seams and are clipped to
the editable domain. Use a cell size fine enough to represent the
features you want to see or flood.

`clearance`, `support`, and `height` expose the current collision
shape. Existing navigation and movement systems can bind those fields.
`material` samples the surviving solid and `segment` traces a swept
sphere against the current clearance field. Add `sources` with a
point and water level to fill connected open spans at a fixed head.
`medium` and `water` query that occupancy. The fixed-head source supplies
newly connected passages and stops supplying disconnected ones.

Set `visual.volume` to the system ID to render its retained splats and
water. Edits rebuild intersecting chunks plus the sampling halo.
Unaffected chunk payloads keep their identity. `work` reports the last
edit's rebuilt and reused chunks and the separate water work. Spatial
dependency reports include water changes beyond the brush where a
connection opens or closes. Checkpoints save the ordered edits and
reconstruct the same solid, material and water state on restore.

The [spillway quarry](../examples/world-live-volumes.json) opens a
copper-lined passage at tick 2, applies a limestone layer at tick 4,
and closes the passage with a fill at tick 6.

```sh
ink-studio sim run examples/world-live-volumes.json --ticks 2 --record quarry.run.json
ink-studio probe quarry.run.json --field quarry/material --at 0,0.4,0
ink-studio probe quarry.run.json --field quarry/work
ink-studio trace quarry.run.json quarry/segment --at -3.1,1,0 --args '{"to":[3.1,1,0],"radius":0.12}'
ink-studio sim render quarry.run.json --colored --out quarry.png
```

## Surface state that follows geometry

Add `surfaceState` to a mechanics body to attach state to its original
faces. Face keys are `-x`, `+x`, `-y`, `+y`, `-z`, and `+z`. Each
entry in `surfaceState.faces` is an ordered array of stamps in unit UV.
The default channels are `paint` in RGB, `heat` in degrees Celsius, and
`grime`, `scar`, and `wear` on a scale from zero to one. Mechanics
`surfaceChannels` can add named color or scalar channels with bounds,
defaults, and units.

Use `rig/surface-stamp` with `body`, `face`, and `stamp` at a scheduled
tick. A stamp selects a `channel`, a `brush`, and a `value` for `set`
or scalar `add`. `clear` restores the channel's default. `strength`
scales the coverage. Use a `rect` brush with `min` and `max`, a `bitmap`
with those bounds and rows of dots and hashes, or a `stroke` with
UV `points`, `width`, and optional `softness` measured in the rest chart.
On a fragment, a stamp uses that face's local UV and affects only the
chosen piece.

`rig/reshape` changes the body's XYZ `half` sizes while keeping its
chart coordinates. When `rig/fracture` splits a body, its pieces keep
the correct regions of the original faces. New faces start at the
channel defaults and can use `surfaceState.fresh.material` and a
`surfaceState.fresh.ramp` of palette indices. The renderer retains the
original surface ID on the exterior splats, including after a rebake.

Probe `rig/surface` by body ID and face UV, or pass a world-space point
and body ID to resolve the local face and original UV. `rig/surface-charts`
returns the atlas data. Checkpoints save the chart windows and stamps.
For a custom mesh, use [surface chart correspondences](procedural.md#surface-state-through-remeshing).

The [split sign](../examples/world-surface-state.json) keeps the same
lettering through a reshape and fracture. Each broken edge exposes a
separate, unmarked wood surface.

```sh
ink-studio sim run examples/world-surface-state.json --ticks 11 --record sign.run.json
ink-studio probe sign.run.json --field rig/surface --args '{"body":"sign.0","face":"+z","uv":[0.44,0.5]}'
ink-studio probe sign.run.json --field rig/surface --args '{"body":"sign.0","face":"+x","uv":[0.5,0.5]}'
ink-studio sim render sign.run.json --colored --out sign.png
```

## Author a world

A manifest has `format: "ink-studio/world"`, `version: 1`, a stable `id`,
`seed`, `dt`, and tables of `entities` and `systems`. A system record
declares a `kind`, a `config`, and optionally a [solver schedule](#multi-rate-simulation). Optional sections include `connections`,
`prefabs`, `assetPacks`, `commands`, `history`, `causality`, `metadata` and
`scenario`. See [the watershed](../examples/world-watershed.json) and
[the quarry crossing](../examples/world-crossing.json) for working manifests.

`scene apply <world> <edits>` applies an ordered array of `set`, `remove`,
`merge` and `test` operations atomically. Paths accept arrays or JSON
pointers. Existing branches are shared until changed. `--dry-run` reports
changed paths and the targets affected by look edits. World manifests
and JSON dioramas also accept [`bind-look` edits](pixel-look.md#apply-look-bindings-with-scene-patches).
`--out` writes the validated result. The path-based operations also
accept retained authoring documents and JSON dioramas. `validate` checks a
world directly, or accepts `--world manifest.json --kind edits|actions` to
check a separate file against a world.

Entity positions are relative to their parent or host socket when attached.
Use `scene stamp <world> <prefab> --as id` to instantiate a reusable assembly.
The optional JSON `--args` accepts `position`, `params`, and local edit
`overrides`. In prefab declarations, `{"$param":"name"}` reads a parameter,
`{"$local":"id"}` refers to an internal object or system, and
`{"$port":"system/output"}` refers to a local port. Stamp rewrites internal
connections and exposes public ports as `assembly/port`. Prefabs can require
asset-pack IDs or exact revisions. `scene remix` modifies a definition and
`scene capture` saves a placed, edited assembly under a new prefab ID.

`world/input` drives an unconnected typed input, `world/patch` edits live
entity and metadata records, `world/event` emits a named event, and
`world/transfer` queues a conservative account transfer. Each
scheduled command has a positive integer `tick`, an `action`, and an
optional `args` object. Commands scheduled for one tick run in order. All
stepping systems read a common snapshot after that tick's commands. A
combinational control block can pass its result in the same tick. Stateful
outputs feed the next tick. Set a connection's `delay` to queue its signal
for a fixed number of ticks. The validator rejects instantaneous cycles.

A scenario accepts an initial patch in `start`, `commands`, an `allow` list
for external actions, an `until` tick, and ordered `rules` of kinds
`score`, `metric`, `win` and `fail`. A rule can probe a field and apply a
condition to its value. Run with `--scenario` to stop at an outcome. The quarry
example awards points when the sheep crosses an opening and ends when it
reaches the feeder.

## Built-in systems

| Kind | State, queries and actions |
| --- | --- |
| `fields` | Typed spatial fields with defaults, grids, regions and a `set` action. |
| `materials` | Grid of versioned surface materials with local moisture, temperature, coefficients, and appearance. |
| `volume` | Editable 3D solid with material layers, collision and support queries, fixed-head connected water, and locally retained splats. |
| `control` | Typed arithmetic, thresholds, selection, binary logic, pulses, latches, timers and hysteresis. |
| `store` | Bounded numeric, integer, or vector accounts with named resources and units. |
| `exchange` | Enabled links that request a fixed amount per tick or a rate per second. |
| `water` | Bounded XZ shallow water with live bed edits, fractional face openings, conservative pump transfer, sensors and probes for the bed, depth, current and volume. An `obstacle` field may supply signed solid clearance. |
| `mechanics` | Oriented box bodies and shared clearance or support queries, fixed and powered mounts, transmission ratios and stall reports, physical separation, configurable fracture, wheel traction, buoyancy, thrust and sail forces. |
| `navigation` | Bounded walking, swimming or flying route traces. Ground search can take depth, clearance and wear into account. Hosts can also expose the volumetric traversal graph. |
| `habitat` | Authored species rules evaluate world fields and nearby or reachable resources. Probes return a score, suitability and the reasons behind the decision. |
| `agents` | Ground, swim and flight movement with replanning, scene-aware destinations and optional limb contacts. Agents publish their real movement contacts for other systems. |
| `wear` | Optional wear from contact-producing systems or submitted contact batches. Track local accumulation and recovery, and use `enabled` to control updates. Trace a durable route and promote it with `scene promote <run> <trace> --as id`, supplying its endpoints through `--at` and JSON `--args`. |

The mechanics model uses bounded box colliders and approximate contact,
traction and buoyancy. Water handles one surface column per XZ cell. Keep a
simulation's resolution and bounds appropriate to these models. Use the same
query names to provide richer implementations for individual scenes.

`history.where` defines which events are meaningful to the world.
`history.limit` bounds retention, and the readout reports how many events
rolled off. `scene history <world> <rules.json>` adds seeded backstory.
A rule supplies `id`, a negative starting tick in `start`, optional
`count`, `interval` and `chance`, an `event`, and optional `edits`.
String values can reference `{id}`, `{index}` and `{tick}`. A
`{"$choose":[...]}` value selects from authored alternatives by seed.
The earlier events and their world edits survive in the derived manifest.

## Extend the runtime in JavaScript

```js
const { KIT: { world: W } } = require('@shapeshift-labs/ink-studio').load();

W.runtime.register('counter', ({ rate = 1 }) => ({
  initial: () => ({ count: 0 }),
  step: (state, tick) => ({ count: state.count + rate * tick.dt }),
  fields: {
    count: { type: 'number', read: ({ state }) => W.query.ok(state.count) }
  }
}));

const run = W.runtime.create({ systems: { meter: { kind: 'counter' } } });
run.advance(60);
console.log(run.query().probe('meter/count').value);
```

A system factory compiles its definition once per runtime instance.
`initial`, `step`, and `actions` return finite JSON state. Keep persistent
state in those values so fork and replay can recreate it. Optional hooks
include `checkAction(type,args)`, `validateState(state)`, `pose(state,id)`,
`fields`, `traces`, typed `inputs` and `outputs`, and
`output(state,context)`. A consumer can implement `checkFields(query)`
to bind and check its field references when the runtime compiles.
Use `W.spatialFields.define(spec, read)` to publish a custom scalar,
vector, or categorical field. The callback receives the projected
`point`, the regular query context, and an `explain` flag. Return a
regular query result with an optional `source` record for provenance.

A tick context exposes the world, peer state, shared
queries, input values, `emit(kind, detail)`, and a seeded `random(key)`.
Pose providers can also implement `poseEntities(state)` to enumerate all entity
IDs whose pose they can override or suppress in that state. The hook must return
an iterable and accept `undefined` before initialization. The query engine can
then update those entities and their attachments between snapshots. A provider
with only `pose` uses the per-snapshot index.
Load custom factories through the CLI's existing `ink-studio.config.js`
`load` hook when reading their checkpoints in a separate process.

Rill's revision and spatial lookup contracts inspired the query snapshots and
stable selectors. Frontier's path edits and Ink's state/action/query separation
inform the authoring and simulation interfaces. The implementation uses Ink
Studio's own data and solver primitives with the JavaScript standard library.

See [live world scaling](world-scaling.md) for the benchmark commands and results.

## Persistent interactables

`KIT.world.interactions.create({id, interactables, realize})` owns a
place's durable interaction state and timers alongside its published
world revision. Define stable interactable IDs with JSON initial state
and named actions. `breakable({id, point, integrity})` provides `hit` and
reports the remaining integrity. `latch({id, point, ticks})` provides
`press`. A positive duration activates the latch and schedules a reset.
Pressing again restarts that timer. A zero duration makes it toggle.
Both helpers accept cue names to select host effects.

A custom action receives `{state, states, revision, point, actor, args,
tick, timer}`. Its synchronous handler returns null to decline, or
`{state, timers?, cue?, detail?}` to apply the action. State, actor, args,
and detail use JSON data. An optional `validate(state)` can check the
initial, restored, and proposed state. Named timers use relative delays.

```js
actions: {
  strike({ state, actor }) {
    if (state.open || !actor?.tool) return null;
    return {
      state: { ...state, open: true },
      timers: { reset: { after: 90, action: 'reset' } },
      cue: 'gate-open'
    };
  },
  reset({ state, timer }) {
    return timer === 'reset' && state.open
      ? { state: { ...state, open: false }, cue: 'gate-close' }
      : null;
  }
}
```

Use `timers: {reset: null}` to cancel a timer, or write the same name to
reschedule it. A timer can pass JSON `args` to an action on the same
interactable. The host advances the absolute scene clock with
`await interactions.advance(tick)`. Timers run in deadline, interactable
ID, and timer ID order. Ticks without actions keep the current world
revision. `advance(tick, {limit})` defaults to at most 1024 due actions
per call. A result with `complete: false` can be continued by advancing
to the same target again.

The synchronous or asynchronous `realize(next, before)` callback
builds a revision from the proposed `next.states`. `next.event` describes
the proposed action, and is null for initial publication or restore.
Use a private [biome revision builder](procedural.md#biome-revisions) here
to derive colliders, navigation, and packed splats from the same state.
Read `interactions.current()` as the publication boundary. It switches
state, clocks, and the finished revision together. An error leaves the
last completed snapshot available, including any timer that was due.
Actions and timer advancement are serialized. A caller can supply
`expectedSequence` to `dispatch(id, action, {actor, args, expectedSequence})`
so a repeated command based on an old snapshot returns null.

`onEvent((event, snapshot, before) => …)` subscribes to successful
actions and returns an unsubscribe function. Each event carries the
world ID, sequence, tick, target, action, cue and any authored XYZ point
or JSON detail. Listeners run synchronously after publication. Their
errors are available in the action's `errors` array. Use the same cue
for particles, audio, and animation. Keep presentation effects outside
the durable world revision.

`checkpoint()` returns the JSON state, sequence, local tick, and pending
timers. On a fresh controller, `await restore()` publishes the initial
world, or `await restore(saved)` rebuilds the saved world. Restore
leaves the event stream quiet. Pass `checkpoint` as a [place payload
callback](portals.md#step-and-save-places) to keep these records on
departure. The host can advance the interaction clock only while the
place is active, or drive it on a background update schedule.

The [interactable locks example](../examples/interactable-locks.js)
ties a breakable wall and timed gate to one traversal graph. Its debris
uses splat samples from the wall that the committed revision removed.

## Character traversal and follow cameras

`KIT.world.characters.create({tuning, selectMode, modes, allowSupport})`
is an optional Y-up capsule solver. It uses the same support, signed
clearance, and medium queries as the rest of the world. A host can supply
`{supports(x, z, low, high), clearance(point, radius), mediumAt(point)}`
or use `characters.fromBiome(frame)` with a prepared biome frame. The
biome adapter allows a small configurable `supportPadding` search when
a conservative field requires extra clearance above a support.

Create a JSON actor with `controller.state({position, velocity, …})`.
Position is the center of the capsule. The controller preserves additional
JSON fields such as inventory. Call
`controller.step(actor, {move, vertical, jump, climb}, dt, world)` with
seconds and a world-space XZ move input. Swimming uses the vertical input,
with jump also available as an ascend button. Jumping from the ground
uses a button press edge. Set `climb: false` to disable the automatic
climb from the waterline onto a reachable, clear ledge.

The reported movement includes the next `actor`, swept `segments`,
`events`, and the body and eye media. The defaults switch between
`ground`, `air`, and `swim`, with independent swim-entry, swim-exit,
and eye probe heights. The swim solver adds the sampled XYZ current.
Tune the body dimensions, acceleration and speed, jumping and gravity,
water response, step height, ledge reach, and substep size. The controller
exposes its resolved `tuning` for inspection.

`selectMode(context)` can choose a custom mode. Return the natural mode
for the default behavior. Each custom mode receives the same actor, input,
medium, eyes, support, and timestep context. Return a `velocity` and an
optional JSON `actor` patch. The controller still applies its collision
sweep and owns position, velocity, mode, and jump-button state.
`allowSupport(actor, support, world)` can reject a support by tag or
apply a host-specific rule.

```js
const controller = KIT.world.characters.create({
  tuning: {walkSpeed: 3, climbHeight: 0.6},
  selectMode: ({input, natural}) => input.glide && natural === 'air' ? 'glide' : natural,
  modes: {
    glide({actor}) { return {velocity: [actor.velocity[0], -0.8, actor.velocity[2]]}; }
  }
});
```

`KIT.world.cameras.follow({tuning, stable})` creates a separate,
renderer-independent rig. Call `rig.start(actor)` and
`rig.step(state, actor, dt, {yaw, pitch, focus, clearance})`. Orbit inputs
are relative angles in radians. The rig steadies the focus inside a
vertical jump window and follows sustained rises, drops and swimming
at configurable rates. A custom `stable(actor)` can include other
movement modes. Supply a signed clearance query to shorten the camera
arm at an obstacle and ease it back out after the obstruction.

```js
const movement = controller.step(actor, input, dt, currentPlace.queries);
const travel = await controller.cross(session, 'garden-door', movement, {camera: camera.pose});
actor = travel?.actor ?? movement.actor;
camera = travel?.arrival
  ? rig.handoff(camera, travel.arrival)
  : rig.step(camera, actor, dt, {clearance: currentPlace.queries.clearance});
renderer.render(session.current().asset.world, {camera: {pose: camera.pose}});
```

`cross` checks the actual motion segments against a walk or drop link.
It returns null if the actor misses the opening, or reports `crossed`
or `blocked`. A blocked result keeps the actor on the source side.
For a successful crossing, use the destination's queries on the next
step. `rig.handoff` adopts the arrival camera pose and preserves the
mapped orbit frame. Use the same method with a fade arrival to reposition
the rig at the named anchor.

The [headless canal example](../examples/canal-traversal.js) follows a
traveler from a dry bank into the water, out over a ledge, and through a
rotated doorway.
