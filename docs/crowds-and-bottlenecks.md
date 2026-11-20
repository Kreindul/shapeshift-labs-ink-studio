# Crowds and bottlenecks

Add `crowd: {}` to an `agents` system to enable local avoidance for
walkers. Walkers that share a crossing belong in the same agents system.
Each walker checks swept separation against nearby walkers and uses the
normal terrain traversal sweep for its chosen move. The spatial index
updates as poses commit so a later move sees earlier walkers' new
positions. [Frank Cheng's GDC session on pathing and steering](https://www.gdcvault.com/play/1028036/)

| Crowd setting | Default | Purpose |
| --- | --- | --- |
| `avoidance` | `true` | Steer around and yield to nearby walkers. |
| `lookAhead` | 0.55 | Additional distance to check when choosing a detour. |
| `spacing` | 0.02 | Extra separation beyond walker radii. |
| `bottlenecks` | `{}` | Named passages with capacity and directional admission. |

## Author a passage

```json
{
  "crowd": {
    "bottlenecks": {
      "bridge": {
        "from": [4, 0, 0],
        "to": [8, 0, 0],
        "width": 1.25,
        "capacity": 2,
        "batch": 2,
        "queueOffset": 0.94
      }
    }
  }
}
```

`from` and `to` define the two ends of a straight walking passage.
`width` is its full width and `height` defaults to 2 world units.
`approach` controls how far away a walker can join a queue. It defaults
to 1.8. Leave walkable space to the right of each approach for the
holding positions. `queueOffset` controls how far they sit from the
centerline and defaults to 85% of the passage width.

`capacity` counts admitted walkers, including those approaching the
entrance. Once admitted, walkers follow the centerline to clear the
opposite end. Authored occupants consume slots from the first update.
The default `alternate` policy lets up to `batch` walkers enter in one
direction when both sides are waiting. It drains the passage before
switching sides. `fifo` gives the oldest waiting side the next turn.
Arrival time, distance to the entrance, and agent ID determine queue
order.

Each passage exposes two Boolean inputs. For an agents system called
`crew`, `crew/open.bridge.a` controls entry from `from` and
`crew/open.bridge.b` controls entry from `to`. Both default to true.
They can be connected to door, lift landing, or dock readiness signals.
Closing entry lets walkers already in the passage finish crossing.

`crew/crowd-status` reports steering and queue status separately from
the agent's route status. `crew/bottlenecks` reports the active direction,
reservations, queues, open inputs, and completed counts. Queues and
reservations survive checkpoints and forks. Coarse cohorts hold at
passages and resume admission when detailed movement returns.

## Run opposing queues

In the [bridge example](../examples/world-crowd-bridge.json) two groups of
four walkers exchange banks. The bridge has two slots and alternates
direction as each batch clears.

```sh
ink-studio probe examples/world-crowd-bridge.json --ticks 65 --field crew/bottlenecks --json
ink-studio sim render examples/world-crowd-bridge.json --ticks 75 --colored --out crowd-bridge.png
```
