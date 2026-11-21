# Shadows from painted cutouts

Set `castsShadow: true` on a world-facing painted surface to let its alpha
block local light. The light projects the same cut edges through its
transparent texels as it moves. The cutout affects solid receivers and the
scattered light in lit fog.

```js
const atlas = SpriteSurface.make();
const region = atlas.reserve(paint.w, paint.h);
atlas.faceRegion(
  [-1.2, .45, 0], [1.4, 0, -.2], [0, 2.5, 0], region,
  { id: 'paper', castsShadow: true }
);
const spriteSurfaces = atlas.finish();
SpriteSurface.update(spriteSurfaces, region, paint);
// Pass spriteSurfaces to B.finish() with a shadow-casting light.
```

`SpriteSurface.face` accepts the same option. The face can be slanted or
skewed. Each light ray samples the nearest authored texel. Alpha 128 and
above blocks the ray, including when it reaches the back of the paper.
Texture edits through `SpriteSurface.update` and whole-face UV slip affect
the shadow as well. For geometry updates, call
`SpriteSurface.markGeometryDirty` and keep the face as one parallelogram.
Shadow lookup uses the original paint resolution even when a camera view
uses distance-based palette sampling. The scene supports up to 16 cutout
planes and 1,048,576 mask pixels, with a maximum of 1,024 pixels per axis.

## Painted scenery cards

Pass `castsShadow: true` to a scenery placement to use its painted depth
bands as light-space planes. Ink keeps the orientation, pivot, scale, and
depth offset of each band. This works with JavaScript placements and with
the named atlas paths in `finish.spriteAtlases`. Use planar sprite surfaces
for visible cutouts in both renderers. The headless renderer also draws
painted scenery placements. [Atlas paint conventions](impostor-atlases.md#painted-scenery)

```js
const ivy = K.sprite.placeAtlas({
  atlas: ivyAtlas, at: [0, 1.4, .2], mode: 'scenery', castsShadow: true
});
```

## Light and preview controls

- Area emitters use their existing `shadows` setting. Volume spotlights and
  points use `castsShadow`. A spotlight with `surfaceIntensity` lights
  solid receivers as well as the fog. Existing SDF shadow casters and
  custom ray queries can contribute alongside the cutouts.
- Use `volumeLocalShadows: false` to compare the fog with the wall shadow
  still present. Use `cutoutShadows: false` in render options or
  `--cutout-shadows off` in the CLI to compare both paths with the
  painted geometry still visible.
- The headless renderer tests the paint at each shadow ray. WebGL uses
  the same cutout test at its surface and fog lighting samples. Increase
  `emitterSurfaceResolution` or `emitterFogResolution` to show smaller
  projected details on large faces and volumes.

## The Papercut Lantern

The first study swings an amber lamp past a torn moth stencil. The second
uses the same mounting frame for painted ivy under a teal spotlight.
[Runnable example](../examples/painted-cutout-shadows.js)

```sh
node cli/ink-studio.js clip examples/painted-cutout-shadows.js --raw \
  --w 288 --h 176 --px 1 --from 0 --to 4.8 --fps 15 --out papercut-lantern.png
node cli/ink-studio.js clip examples/painted-cutout-shadows.js --raw \
  --params '{"study":"ivy"}' --w 288 --h 176 --px 1 --from 0 --to 4.8 --fps 15 --out ivy-lantern.png
```
