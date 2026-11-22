# Two-way material conversion

The `material-cells` world system keeps parcels in a cubic lattice. Lift
a face-connected patch into one compound rigid body and return it to cells
with a crumble command or a measured impact. Every parcel carries its
original ID, material, wetness, custom data, mass, and thermal energy
through both conversions.

[Cinder Foundry](../examples/material-conversion.cjs) shows a hot mixed
charge rotating above a cooling bed. Generate the browser demo, world
manifest, and recorded run with:

```sh
node examples/material-conversion.cjs ./cinder-foundry
```

## Author a lattice

Set `size: [nx, ny, nz]`, `origin: [x, y, z]`, and cubic `cell` size.
An initial entry has integer `at: [ix, iy, iz]`, a named `material`, and
optional `temperature` in Celsius, `wetness` from zero to one, and JSON
`data`. Lattice coordinates are zero-based from the minimum corner.
The world supports up to 512 occupied parcels, 32 moving pieces, and
1–12 face-connected parcels per rigid compound.

A material specifies `density`, `specificHeat`, and an optional packed RGB
`ramp` from ambient to `hotAt` degrees. Parcel mass is density times cell
volume. Temperature is derived from energy and parcel heat capacity.
`ambient` defaults to 20 °C. Set nonnegative `conduction` and `cooling`
rates to exchange heat between face-neighbors and with the air. These
updates apply on the lattice and inside each rigid piece. Wetness and
custom data travel unchanged.

Set `visual.volume` to the system name to render both representations
using the normal world viewer and headless renderer. Use the material
ramps to art-direct the temperature steps. Each exposed face retains
the parcel's stable splat IDs through the conversion.

## Lift, heat, and crumble

Use the ordinary simulation command pipeline, including
[event actions](event-actions.md). With a system named `forge`:

```json
{
  "tick": 12,
  "action": "forge/lift",
  "args": {
    "body": "charge",
    "cells": [[4, 6, 3], [5, 6, 3], [5, 7, 3]],
    "velocity": [4, 2, 0],
    "angular": [0, 0, 1.6],
    "breakSpeed": 3
  }
}
```

- **Lift** consumes the selected occupied cells and puts their original
  geometry in one compound body. The piece collides with stationary
  cells, other pieces, and the system's ground plane. Optional
  `gravity`, `ground` height, and `drag` configure the solver.
- **Heat** accepts `{ "at": [4, 6, 3], "energy": 10 }` for a cell or
  `{ "body": "charge", "energy": 10 }` for a moving piece. Applied energy
  is signed. The latter splits the heat by parcel capacity.
- **Crumble** accepts `{ "body": "charge", "spread": 2 }`. Set
  `breakSpeed` at lift to try this automatically on a swept collision at
  or above that closing speed. Parcel centers transform through the
  body's current rotation and position, then find distinct nearby
  unoccupied cells. `spread` searches up to four cells away, with a default
  of two. If there is no placement for the whole piece, an explicit
  command fails before committing. Automatic crumble emits
  `material-crumble-blocked` and keeps the moving piece. Set `settle: true`
  to let returned parcels drop through free cells one row per tick.

`cells`, `cell`, `bodies`, and `pieces` expose the current representations.
`pieces` includes parcel addresses at lift and their current world-space
centers. `clearance` samples both representations. `balance` accounts
for total mass, total thermal energy, applied energy, and ambient exchange.
Successful `material-lift` and `material-crumble` events link the body
and parcel IDs. The lattice and pieces share one checkpoint and replay
as part of a normal [world recording](simulation-checkpoints.md).
