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

## 3D color LUTs

A 3D LUT samples all three input channels together. Use one to shift
blue shadows toward violet while keeping an equally bright red in its
original hue.

```sh
node cli/ink-studio.js lut import examples/blue-shadow.cube --out blue-shadow.json
node cli/ink-studio.js render examples/rgb-lut.js --ortho --lut examples/blue-shadow.cube --out violet.png
node cli/ink-studio.js render examples/rgb-lut.js --ortho --lut blue-shadow.json --out from-json.png
node cli/ink-studio.js render examples/rgb-lut.js --ortho --lut off --out before.png
```

Import standalone 3D `.cube` tables with `LUT_3D_SIZE`, optional
`TITLE`, and either per-channel `DOMAIN_MIN` and `DOMAIN_MAX` or
`LUT_3D_INPUT_RANGE`. The CLI can print the native JSON to stdout.
Both formats store triplets with red varying fastest, then green,
then blue. [Adobe Cube specification](https://kono.phpage.fr/images/a/a1/Adobe-cube-lut-specification-1.0.pdf) · [Resolve range header reference](https://github.com/AcademySoftwareFoundation/OpenColorIO/blob/main/src/OpenColorIO/fileformats/FileFormatResolveCube.cpp)

This is an identity table in native JSON.

```json
{
  "format": "ink-studio/lut",
  "version": 1,
  "size": 2,
  "domainMin": [0, 0, 0],
  "domainMax": [1, 1, 1],
  "interpolation": "tetrahedral",
  "data": [
    0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0,
    0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1
  ]
}
```

Use `size³` RGB triplets in one flat array. The domain defaults to
[0, 1] on all three axes and out-of-domain inputs use the nearest
boundary. Choose `tetrahedral` (the default) or `trilinear`.
`ColorLUT.parseCube(text)` returns the same immutable JSON shape from
JavaScript, and `ColorLUT.prepare(definition).sample(rgb, out)` samples
it with an optional reusable output array. The sampler keeps finite
output values outside [0, 1], and the renderers clamp display colors.

Put a native definition in `finish.look.colorLut`, `look.colorLut`
in `B.finish()`, or `visual.look.colorLut` on a simulation manifest.
Scene LUTs run during palette resolve in the CLI and standard WebGL
renderer. They follow the animation grade and channel curves. Palette
remaps and protected swatches apply last. Raw output and stipple use
their own resolve paths. See [surface LUTs](surface-materials.md#3d-luts-on-surfaces)
to transform a material sample before compositing.

## Named color stacks

Use `finish.look.colorStack` in a JSON diorama, `look.colorStack`
in `B.finish()`, or `visual.look.colorStack` in a simulation manifest.
A stack has a `name` and ordered `steps`. Give a step an `id` to identify it
while editing. Set `enabled: false` to skip a step or set an `amount`
from zero to one to blend its result into the color entering that step.

```json
{
  "name": "Cool dusk",
  "steps": [
    { "id": "shade", "type": "exposure", "stops": -0.25 },
    { "id": "cool", "type": "hue", "degrees": 20, "amount": 0.6 },
    { "id": "lantern", "type": "paletteRemap", "remap": { "rules": [], "protect": ["glow"] } }
  ]
}
```

| Step type | Editable settings |
| --- | --- |
| `exposure` | `stops` scales RGB by `2 ** stops`. |
| `contrast` | `factor` scales each channel's distance from `pivot`, which defaults to 0.5. |
| `saturation` | `factor` scales the distance from luminance. Zero gives grayscale and one is neutral. |
| `hue` | `degrees` rotates the hue with the channel minimum and maximum held fixed. |
| `channelMix` | `matrix` contains RGB weights for each of the three output channels. Optional `offset` adds an RGB triple. |
| `curves` | `curves` takes the same luminance ramp or RGB channel curves as `look.colorCurves`. |
| `lut` | `lut` takes a native 3D LUT, including a JSON import from `.cube`. |
| `paletteRemap` | `remap` addresses the original palette slots by swatch, index, or role. Rules blend against the color at this point in the stack. Protected slots retain their original colors through the entire grade. |

The scene stack uses Ink Studio's working RGB values. The renderer clamps
the final stack color for display. Curves and LUTs use their own domains
when they sample an intermediate value. Palette resolution feeds the
animation grade, standalone curves and LUT, then the stack. A standalone
palette remap applies last, with protections from both definitions honored.
The CLI and WebGL share the same scene stack evaluation. Raw and stipple
output use their existing resolve paths.

The JavaScript bundle exposes `ColorStack.prepare(stack).sample(rgb, out)`
for RGB-only stacks. A [material stack](surface-materials.md#color-stacks-on-surfaces)
uses that same evaluation before compositing.

```sh
node cli/ink-studio.js render lab/data-shrine.json --t 4 --pitch .31 --yaw .55 --target 0,1.15,0 --color-stack off --out before.png
node cli/ink-studio.js render lab/data-shrine.json --t 4 --pitch .31 --yaw .55 --target 0,1.15,0 --color-stack examples/lantern-dusk.json --out dusk.png
```

The same `--color-stack` option works with `sim render`. A JSON file
overrides the authored scene stack. `off` bypasses scene and surface stacks.

## Color spaces and numeric ranges

Add `color` to a LUT, curves definition, palette remap, or stack step to
declare how that operation reads and writes RGB. Ink Studio converts its
working sRGB values into the declared input and converts the result from the
declared output back to working sRGB.

```json
{
  "color": {
    "input": { "space": "srgb-linear", "range": [16, 235], "outOfRange": "clamp" },
    "output": { "space": "srgb-linear", "range": [16, 235], "outOfRange": "preserve" }
  }
}
```

Each endpoint accepts `srgb`, `srgb-linear`, `display-p3`, or
`display-p3-linear`. Use a shared `[min, max]` or give each channel its
own bounds with `{ "min": [r, g, b], "max": [r, g, b] }`. The bounds
map to normalized zero and one in the declared space. `preserve` keeps
finite values beyond the bounds, `clamp` limits them to the bounds,
and `error` rejects them. Omitted endpoint settings default to `srgb`,
`[0, 1]`, and `preserve`. Definitions without `color` keep their
existing behavior. RGB conversions use the D65 matrices and extended
sRGB transfer functions in the [CSS Color 4 conversion reference](https://www.w3.org/TR/css-color-4/#color-conversion-code).

LUT entries, numeric ramp colors, RGB channel curves, and numeric remap
targets use the declared code values. A luminance ramp derives its scalar
from the input RGB. A material ramp driven by a scene field reads the
field in its own units. Hex colors and palette swatches are authored in
sRGB and converted as needed. The parametric stack steps use normalized
values in the declared spaces, so a contrast pivot of 0.5 stays at the
middle of the input range. A step's own `color` replaces the nested
definition's declaration for that step.

A LUT's table domain defines where the grid is sampled, independently of
the input encoding's numeric range. The sampler uses `domainPolicy` to
`clamp` to the grid by default, report an `error`, or `extrapolate`
with the nearest edge cell. Use `ColorLUT.prepare(lut).sample(rgb, out)`
to work directly in table values or `.apply(rgb, out)` to work in renderer
sRGB. Use `ColorSpace.convert(rgb, from, to)` to convert between descriptors
in JavaScript.

When importing `.cube`, supply the spaces and ranges the table was
authored for. The import stores them in the native JSON. Use
`--input-out-of-range` and `--output-out-of-range` to set the endpoint
policies. The CLI and standard WebGL scene renderer use the same
declarations.

```sh
node cli/ink-studio.js lut import examples/half-gain-legal.cube \
  --input-space srgb-linear --output-space srgb-linear \
  --input-range 16,235 --output-range 16,235 --domain-policy error \
  --out half-linear.json
node cli/ink-studio.js render examples/rgb-lut.js --ortho --lut half-linear.json --out linear.png
```

## Target palettes and dithering

Use `finish.look.paletteConstraints` on a JSON diorama, `look.paletteConstraints`
in `B.finish()`, or `visual.look.paletteConstraints` on a simulation manifest.
Each target chooses the swatches that can appear on its visible surfaces.
Background pixels and unselected surfaces use the scene resolve. Use an
optional `default` policy to cover foreground surfaces without a target.

```json
{
  "targets": [
    {
      "material": "foliage",
      "palette": ["#152a2a", "#234839", "#356449", "#4c8054", "#71a260", "#a0bf77"],
      "dither": { "pattern": "blue-noise", "strength": 0.85, "seed": 74 }
    },
    {
      "object": "courier",
      "material": "status",
      "palette": ["#9c343a", "#d84a43"],
      "reserved": ["#ff654e"]
    }
  ]
}
```

- A target matches its `object`, its `material`, or both. The last
  matching rule wins. In JSON dioramas, these names come from the solid's
  `part` or `id` and the material's role. JavaScript sculpts use
  `objectId` on the shape and `materialId` on the material. For direct
  splats use `B.describeSplats(first, end, { object, material })`.
  Simulation renders expose entity, body, and agent IDs, authored body
  materials, and material names such as `terrain` and `water`.
- Swatches accept hex colors, normalized RGB triples, scene palette
  indices, and named palette roles or stops. Omitting `palette` uses the
  scene swatches. `reserved` entries preserve exact matches at 8-bit RGB
  precision and stay out of ordinary quantization and dithering.
- `none`, `checker`, `bayer`, and seeded `blue-noise` set the threshold
  pattern. Strength 0 picks the nearest swatch. Increasing strength lets
  more art pixels pick the second swatch near a transition. CLI renders
  can use the existing screen, world, or object dither coordinates.
- Explicit target palettes take precedence over a surface layer's
  `outputPalette` in CLI renders. Layer palettes take precedence over
  `default`. Outlines and finish overlays use their existing paths.
  Standard WebGL targets use solid splat ownership and screen art pixels.

In JavaScript, `PixelLook.preparePalette(policy, { palette, roles, blueNoise })`
returns packed swatches and `index(rgb, x, y)` for sampling normalized
RGB at a chosen position. Pass `KIT.procedural.materials.blueNoise` when
preparing a blue-noise policy.

```sh
node cli/ink-studio.js render examples/palette-constraints.js --ortho --palette-constraints off --out before.png
node cli/ink-studio.js render examples/palette-constraints.js --ortho --out constrained.png
```

Use `--palette-constraints rules.json` to override the authored rules
in `render` or `sim render`. `off` bypasses the target policies.
