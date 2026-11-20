# Live sun lighting

The Node renderer and CLI can relight sculpted objects with one directional sun at render time. A light-space depth map is rebuilt from posed opaque splats. Move the light to change illumination and cast shadows while keeping the same sculpt.

```sh
node cli/ink-studio.js render examples/live-sun.js --t 4 --raw --px 1 --out live.png
node cli/ink-studio.js render examples/live-sun.js --t 4 --live-sun off --raw --px 1 --out baked.png
node cli/ink-studio.js render examples/beacon-pool.js --live-sun --sun-direction 0.7,0.55,0.2 --out pool.png
```

For a JavaScript scene, set `S.captureAlbedo = true` before baking. Use a material's `albedo` field to author the unlit colour explicitly. The capture otherwise uses the last colour of the material's primary ramp. Direct builder dabs can supply the same information with `B.describeAlbedo(first, end, color)` and a surface normal. Older pixel-material bakes can use their existing ramps. Rows with missing lighting data keep their baked colour. CLI overrides capture albedo during the scene build.

```js
const light = {
  direction: seconds => [Math.sin(seconds), 0.72, Math.cos(seconds)],
  ambient: 0.32,
  intensity: 0.88,
  shadows: true,
  mapSize: 512,
  bias: 0.02,
  filter: 1
};

const image = ink.render(world, { t: 2, liveSun: light });
```

Set `world.liveSun` in the finished scene for a default. Per-render settings can override individual scene fields. Baked lighting is the default for other scenes. Pass `liveSun: false` or `--live-sun off` to compare the baked result. A direction is a vector from the scene towards the sun, or a function of render time in seconds. It is normalized once per frame.

| Option | CLI | Default |
| --- | --- | --- |
| `direction` | `--sun-direction x,y,z` | `[-0.52, 0.64, 0.57]` |
| `ambient` | `--sun-ambient n` | 0.32 |
| `intensity` | `--sun-intensity n` | 0.88 |
| `shadows` | `--sun-shadows off` | true |
| `mapSize` | `--shadow-map-size n` | 512, with a range of 32–2048 |
| `bias` | `--shadow-bias n` | 0.02 scene units |
| `filter` | Library option | 1 texel, with a range of 0–2 |

The map fits opaque scene splats independently of the viewing camera, so perspective and orthographic views can reuse the same authored light. Glass and outline-free particles do not cast shadows. Emissive colours keep their emission. Pixel-material renders sample their original ramps with the live light level. Raw renders use captured albedo with ambient and direct lighting. Highly specialized baked material effects may look different under live lighting. This version runs in the headless renderer.
