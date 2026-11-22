# Versioned simulation models

An `ink-studio/simulation-model` document packages the inputs and settings for
a fixed-tick simulation. Ink resolves the document into an ordinary world,
then uses the same runtime for direct runs, worker execution, checkpoints,
and replay. The [sluice model](../examples/simulation-models/sluice.json)
opens a gate at tick 5 and measures flow, downstream water depth, and the
mass balance.

```sh
ink-studio sim model validate examples/simulation-models/sluice.json
ink-studio sim model inspect examples/simulation-models/sluice.json
ink-studio sim model compile examples/simulation-models/sluice.json --out sluice.world.json
ink-studio sim run examples/simulation-models/sluice.json --ticks 12 --workers 2 --record sluice.run.json
ink-studio sim verify sluice.run.json
```

Run a model directly or run its compiled world. Both use the same tick
duration and seed. Run and replay reports include the named outputs and
probe results at the selected endpoint. Use `sim plan` to see the resolved
world schedule, or `probe` to sample an individual world field.

## Author a model

| Property | Contents |
| --- | --- |
| `format`, `version` | `"ink-studio/simulation-model"` and schema version `1`. |
| `id`, `revision` | A model ID and a positive integer revision. Publish edits as a new model revision. |
| `seed`, `numerics` | An explicit integer world seed and `{"dt":0.05}` for the world tick in seconds. |
| `domain`, `parameters`, `initial`, `boundaries` | JSON records that hold the authored data. A model may leave any of these records empty. Individual operators define how they interpret the data wired into their settings. |
| `operators` | A named map of native system instances. Each has a `kind` and a pinned `revision`. Supply `config`, `schedule`, and `contract` as for a [world system](headless-worlds.md#compose-system-contracts). Put per-operator numerical settings here. |
| `inputs`, `outputs` | Named aliases of `"operator/port"` strings. An exposed input must be free of internal connections. Its type comes from the native port definition. |
| `probes` | Named records with a world `field` and optional `at` and `args`. Use an XYZ position, a point selector, or an entity/socket selector. Reads retain the normal world query status. |
| `connections` | Optional native world signal connections between operators. |
| `commands` | Optional inputs scheduled as records with `tick`, `input`, and `value`. Supply `id` to give a command its own stable label. |
| `world` | Optional `entities`, `visual`, `assetPacks`, and `metadata` carried into the compiled world. |

Use an object such as `{"$model":"/initial/water"}` as an operator setting,
world setting, or scheduled input value. The JSON Pointer reads from one of
the four authoring sections. A binding replaces the entire value at its
destination. An unknown section or missing key fails validation. For example,
the sluice passes its initial wet region to the water solver and uses the same
downstream coordinate for its outlet sensor throughout the run.

A take can point its `world` at a model file. Match the take's simulation
rate to the model timestep. `project pack` retains the model source with
the rest of the take, so the bundled take can run after relocation.

## Use the library

```js
const { KIT: { world: W } } = require('@shapeshift-labs/ink-studio').load();
const model = require('./sluice.json');
const run = W.runtime.create(model);
run.advance(12);
console.log(W.models.sample(run));
run.schedule([W.models.command(run.view().world, 'gateOpening', 0.1, 13)]);
run.advance(13);
```

Call `W.runtime.validate(model)` to check the document and resolve its
operator kinds, ports, and probes. The returned world holds the resolved
settings and operator pins. Store the original model for editing and the
ordinary run recording or checkpoint for exact replay.

A host can register a custom implementation with
`W.runtime.register(kind, factory, { revision: 2 })`. Different revisions
of one kind can coexist. Supply the pinned revision in every host that
loads the model or replays its checkpoint. Increment an operator's revision
when its numerical behaviour changes. Unpinned world manifests still use the
first registered implementation or their host override.
