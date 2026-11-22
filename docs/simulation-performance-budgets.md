# Measured simulation performance budgets

`sim budget` runs a named set of world-step and block-playback cases. It writes wall-clock timing distributions alongside scheduler bounds, prepared work and memory, queue usage, and missed deadlines.

```sh
ink-studio sim budget plan.json --out report.json --require-budget
```

```json
{
  "format": "ink-studio/simulation-performance-plan",
  "version": 1,
  "id": "playback-budget",
  "cases": {
    "host": {
      "mode": "world", "source": "scene.world.json", "steps": 90,
      "limits": { "maxMissedDeadlines": 0, "maxTypedStateBytes": 16000 }
    },
    "audio": {
      "mode": "blocks", "source": "vent.model.json", "path": "live",
      "samples": 4096, "requests": [64, 128, 192],
      "limits": { "maxWorkPerBlock": 1152, "maxPreparedBytes": 8192 },
      "detail": true
    }
  }
}
```

Source paths are relative to the plan. Pin kernel revisions in the source model and register creator kernels through the project's ordinary `ink-studio.config.js`. World cases use the in-process native runner. Block cases call the [block playback host](simulation-block-independence.md) with the repeating request pattern and trim the last request to the sample count. Select `path: "live"` for a prepared processor or `path: "offline"` for the ordinary block executor.

## Read timings and deadlines

- `steps` measures complete world steps. `requests` measures complete playback requests, including internal block splits and queue bookkeeping. `blocks` measures each internal block and its retention work. Prepared processor reports also include the processor's own elapsed times, excluding its outer host.
- Timing summaries include count, total, mean, p50, p95, p99, and maximum. The first invocation is measured after preparation. With `detail: true`, the first 4,096 operations retain their positions and timings. The summary and first-miss location cover all measured operations.
- The nominal release period is one world tick or a playback request's sample duration. The deadline defaults to that period. Use positive `deadlineMs` to set another completion allowance while keeping the same release cadence.
- `operationOverruns` counts operations whose measured duration alone exceeds the deadline. `missed` carries unfinished time into the next nominal release. A short operation can miss if it starts late. The report includes first miss and peak carried debt. This is a cadence replay of measured service times. Node runs the operations in order without sleeping.
- `native.kernels` retains processor-local deadline misses and faults. A native deadline miss records committed work, while a rejected request retains the previous committed state. Rejections remain separate from the simulated host deadline counter.

## Work, memory, and queues

World work lists [planned scheduled visits](simulation-execution-plan.md), declared units by system, and observed per-system calls. Timed split inputs expand the declared visit bound by their maximum segment count. Prepared processors publish their effective block size, base work at that size, hard work cap, and observed peak. Author-defined work units belong to their kernel. The top-level work gate is available when a world has one prepared processor, or when a block case uses a prepared processor.

Memory separates tracked prepared allocations, including rollback storage, from portable typed state and declared workspace or serialized payload sizes at the ending state. The tracked prepared allocation already includes its own typed state. The Node report also samples process-wide RSS, heap, external memory, and array buffers before and after the measured operations and every 64 operations. `sampledPeak` covers those observations.

In a world, queue depths are sampled at committed tick boundaries for scheduled commands, buffered inputs, delays, and model bridge inputs. Delayed queues report aggregate capacity across their slots. In block playback, event queues record actual committed high-water, attempted high-water, and overflow counts. Set `events.capacity` per port up to the native limit of 10,000. Set `events.drainEvery` to the number of playback requests between reads, with 1 as the default and 0 to hold events unread. Overflow rejects the block and reports its attempted range and retained cursor.

Available limits are `maxStepMs`, `maxRequestMs`, `maxBlockMs`, `maxMissedDeadlines`, `maxNativeMisses`, `maxPendingCommands`, `maxQueuedEvents`, `maxQueueOverflows`, `maxPreparedBytes`, `maxTypedStateBytes`, `maxWorkPerBlock`, and `maxRssBytes`. Limits require the selected mode to have the corresponding measurement. `--require-budget` writes the report, then exits with code 2 for a failed limit or an execution fault. This lets CI gate stable capacities separately from wall time measured on the target host.

The library entry is `KIT.world.performanceBudgets.run(plan, {resolve, now, memory})`. Pass a resolver that returns a loaded native world or model. The optional clock supplies monotonic milliseconds. The optional memory sampler returns byte counts.

```sh
node examples/simulation-performance-budgets/demo.cjs ./studio/out/simulation-budgets
```

The demo profiles a 60 Hz world with a 48 kHz prepared vent, then replays the vent through variable audio requests. It also runs a deliberately tight deadline and shows what happens when a one-event playback queue is drained or left unread.

To replay an exported bench outside the checkout, run the CLI from its `bench` directory. Set `INK_STUDIO_BENCH_PACKAGE` to the Ink Studio checkout or installed package if its example kernels are elsewhere.
