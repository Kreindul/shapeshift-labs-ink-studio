# Tone and stipple

The stipple look maps the lit frame to a small palette on a fixed screen grid.
Try it with the [polished seal](../examples/stipple.json).

```sh
node cli/ink-studio.js render examples/stipple.json --w 1024 --h 1024 --t 1.5
node cli/ink-studio.js clip examples/stipple.json --w 1024 --h 1024 --from 0 --to 3 --fps 24
node cli/ink-studio.js shimmer examples/stipple.json --mode still --t 0 --frames 15 --step 0.2
```

In JSON, set `finish.look.tone` to `"stipple"` or an object that overrides
preset settings. In JavaScript, pass the same `look` object to `B.finish()`.
The CLI can preview the preset on any scene with `--tone stipple`.
Use `--tone off` to switch to the scene's regular palette.

```json
{
  "finish": {
    "look": {
      "pixelSize": 2,
      "tone": {
        "preset": "stipple",
        "cutoff": 0.2,
        "stops": [[0, "#000000"], [0.22, "#176bfa"], [0.8, "#ff8d27"], [1, "#fff1cd"]],
        "pattern": "blue-noise",
        "seed": 17,
        "amount": 0.85,
        "preserveDots": true
      }
    }
  }
}
```

- `pixelSize` fixes the number of screen pixels per art pixel. At 1024 × 1024,
  a size of 2 produces a 512 × 512 art grid. The CLI uses nearest-neighbor
  enlargement. `--px` overrides the scene's size.
- `cutoff` maps luminance at or below that value to black. The renderer
  remaps the range above the cutoff to 0–1 before looking up `stops`.
  Provide 2–48 strictly increasing stops. Start with `[0, "#000000"]`
  and end at position 1. The stops define an output palette independent
  of the sculpt's material palette.
- `pattern` selects a repeating 4 × 4 `bayer` tile or the toolkit's
  `blue-noise` tile. The blue-noise `seed` changes the pattern.
  Both tiles are anchored to the top-left of the art grid.
  `amount` ranges from 0, a hard transition between stops, to 1, the full
  threshold pattern.
- `preserveDots` skips the scene's pixel cleanup by default. `--clean`
  explicitly enables cleanup. `--raw` bypasses the tone mapping.
  An enabled tone mode takes precedence over `--colored`.

Use the [surface light track](surface-materials.md#animate-the-finish-light) to
move the highlights between color bands. The threshold pattern stays fixed
across frames.

## Host integration

The [WebGL canvas renderer](browser-renderer.md) reads the world's `look.tone`.
Pass `tone` in the frame options to override the look, and set the canvas
drawing buffer dimensions to the desired art resolution. The headless
renderer derives that grid from its viewport and `look.pixelSize` or `--px`.

`PixelLook.prepareTone(settings, KIT.procedural.materials.blueNoise)`
returns the ordered stops, packed output palette, tile dimensions and an
array of normalized thresholds. Prepare it once per look. A CPU host can use
`PixelLook.toneIndex(prepared, r, g, b, x, y)` to look up a palette index.

A WebGL 2 host can include `PixelLook.toneGlsl` in its fragment shader and
call `inkToneResolve(litRgb, artPixel)` before enlargement. Pass normalized
lit RGB composited over black and integer art-pixel coordinates measured
from the top-left. Set `u_inkToneCount` to the number of stops,
`u_inkToneCutoff` and `u_inkToneAmount` to the prepared settings, and
`u_inkToneStops` to the normalized RGB colors with stop positions in alpha.
Upload the threshold array as an `R32F` texture with nearest filtering and
bind it to `u_inkToneRanks`.

## Palette remaps

Use `finish.look.paletteRemap` on a JSON diorama or `look.paletteRemap`
in `B.finish()`. The renderer selects a color from the original palette
with the usual lighting and dithering, then looks up its replacement.

```json
{
  "rules": [
    { "from": "stone.shadow", "to": "#16152e" },
    { "from": "#474d57", "to": "#424789" },
    { "from": 4, "to": "#6380ba" }
  ],
  "protect": [0, "signal", "beacon.highlight"]
}
```

`from` and `protect` accept zero-based palette indices, exact `#rrggbb`
swatches, full role names, and role stops such as `stone.shadow`,
`stone.midtone`, `stone.highlight`, or `stone.1`. A full role addresses
every entry in its ramp. For a ramp with an even number of stops,
`midtone` picks the lower middle stop. `to` accepts a packed RGB integer
or `#rrggbb` string. Rules always match the original palette. The last
rule for an entry wins, and protection restores the original color even
when an animation grade is active.

Role names refer to entries in the existing material ramps. Two surfaces
that share an entry receive the same color. JSON dioramas supply roles
from their style and `roles` table. For a custom JS builder, pass
`paletteRoles: { stone: [1, 2, 3] }` to `B.finish()` if needed.

The CLI and the WebGL renderer use the remap during scene palette
resolve. Stipple, projected layers with their own output palette, and
raw rendering use their own color paths. Pass `paletteRemap: false` to
a render call or `--palette-remap off` in the CLI to preview the base
palette. `K.fx.grade(stage).setRemap(definition, amount)` drives a stage
grade from JavaScript, with strength from zero to one.

```sh
node cli/ink-studio.js validate examples/palette-remap.json
node cli/ink-studio.js render examples/palette-remap.json --ortho --palette-remap off --out before.png
node cli/ink-studio.js render examples/palette-remap.json --ortho --out after.png
```

## Color ramps and channel curves

A ramp maps a scalar to an RGB color. Stops use the source's own units
and must increase strictly. Samples outside the stops use the nearest
endpoint. `step` holds each stop until the next. `linear` blends between
stops. `smooth` eases in and out between stops without overshoot.

Use `finish.look.colorCurves` in JSON or `look.colorCurves` in `B.finish()`.

```json
{
  "ramp": {
    "interpolation": "smooth",
    "stops": [[0, "#11172a"], [0.45, "#708b9f"], [1, "#fbe8cb"]]
  },
  "channels": {
    "blue": { "stops": [[0, 0.08], [0.5, 0.62], [1, 1]] }
  }
}
```

The scene ramp reads the luminance of each selected palette color.
You can use a ramp, channel curves, or both. Channel curves take inputs
and outputs in [0, 1]. Each uses its own channel, after the ramp when
present. Unspecified channels pass through. Animation grades feed into
the curves, and authored palette remaps and their protections apply last.
Stipple and raw output bypass the scene curves.

The library exposes `ColorCurves.scalar(definition)`,
`ColorCurves.ramp(definition)` and `ColorCurves.prepare(transfer)`
as reusable samplers. Standalone ramp colors accept six-digit hex,
packed RGB integers, or normalized RGB triples. Pass an output array
to a ramp sampler to reuse storage. The perceptual
`KIT.procedural.materials.ramp(anchors, options)` also accepts
`interpolation` and keeps its existing color space and default blend.
See [surface curves](surface-materials.md#color-curves-on-surfaces)
to bind a ramp to depth or a field.
