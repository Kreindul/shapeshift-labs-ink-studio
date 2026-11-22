# Artist-authored cards and impostors

Place a sprite atlas in a scene as a camera-facing card or as a directional impostor. One atlas can supply color, depth, normals, and emission. With directional placement, Ink chooses the closest authored heading and elevation. A card uses the first view for its frame and faces the camera throughout a turn.

```js
const atlas = studio.readSpriteAtlas('drone/atlas.json');
const sprite = K.sprite.placeAtlas({
  atlas,
  at: [0, 1.2, 0],
  mode: 'impostor',
  yaw: 0,
  scale: 1
});
return B.finish({ ...sceneSettings, spriteAtlases: [sprite] });
```

Use `K.sprite.atlas({ metadata, images })` with decoded RGBA byte buffers. `images.color` is required. `depth`, `normal`, and `emission` are optional and use the same dimensions and view rectangles. `at` and `frame` can be functions of scene time in JavaScript. Each placement can disable depth, relighting, or emission with `depth: false`, `lighting: false`, or `emission: false`.

Use [sprite-based object reconstruction](sprite-reconstruction.md) when one atlas should stand in for named native geometry at a distance in the headless or WebGL renderer.

## Map and view conventions

| Channel | Encoding |
| --- | --- |
| Color | Straight RGBA. Color alpha defines the silhouette. |
| Depth | RGB24 stores the normalized value `(R × 65536 + G × 256 + B) / 16777215`. Set `depthFormat: 'gray'` to use the red channel for grayscale depth. `depthRange` maps the image values from near to far in scene units, and `depthOrigin` gives the value at the pivot plane. Depth increases away from the viewer. Alpha zero uses the pivot plane. |
| Normal | Signed XYZ in RGB, mapped from [-1, 1] to [0, 255]. Alpha zero marks a missing normal. `normalSpace: 'view'` is the default for an authored atlas, with X right, Y up, and +Z toward the viewer. `'asset'` uses object axes. Normals respond to live sun in the headless renderer. |
| Emission | `emissionMode: 'add'` adds emission RGB weighted by the map alpha. `'baked'` describes an atlas with emission already included in its color, using premultiplied emission RGB. Emission is also available as an art pass. |

The manifest has the sheet `width`, `height`, a `files` object with relative PNG paths, and `frames` with view rectangles. Each entry can specify `frame`, `yaw`, `pitch`, `pivot`, `unitsPerPixel`, and `depthOrigin`. Angles use radians. Rectangles and pixel pivots use top-down atlas coordinates. Put shared `unitsPerPixel` and `depthOrigin` at the top level when they apply to every view.

```json
{
  "width": 192,
  "height": 64,
  "unitsPerPixel": 0.035,
  "depthRange": [-0.7, 0.7],
  "files": { "color": "color.png", "depth": "depth.png", "normal": "normal.png", "emission": "emission.png" },
  "frames": [
    { "yaw": 0, "pitch": 0.14, "rect": { "x": 0, "y": 0, "width": 64, "height": 64 } },
    { "yaw": 1.57, "pitch": 0.14, "rect": { "x": 64, "y": 0, "width": 64, "height": 64 } },
    { "yaw": 1.57, "pitch": 0.84, "rect": { "x": 128, "y": 0, "width": 64, "height": 64 } }
  ]
}
```

Ink's [atlas exporter](art-passes.md#directional-sprite-atlas) writes registered scale and depth for each view. Use `--pitches` to bake additional elevation rows. Older manifests can specify `unitsPerPixel`, `depthOrigin`, and `pitch` when the original export camera is known.

```sh
ink-studio atlas my-prop.js --directions 12 --pitches 0.14,0.48,0.84 --maps depth,normal,emission --out drone
ink-studio render my-scene.js --sprite-atlas drone/atlas.json --sprite-at 0,1.2,0 --live-sun on --raw --out scene.png
ink-studio render examples/relightable-impostor.js --t 3 --sprite-atlas-mode card --raw --out card.png
ink-studio render examples/relightable-impostor.js --t 3 --sprite-atlas-mode impostor --raw --out impostor.png
```

A JSON diorama can put an array of placements in `finish.spriteAtlases` and refer to each `atlas` by a path relative to the diorama. Use `--sprite-atlas off` to hide the authored placements in a comparison. A manifest passed with `--sprite-atlas` replaces the scene's placements for that render and defaults to the world origin. Set `--sprite-at x,y,z` and `--sprite-scale n` to place it.

Depth positions each texel along its draw ray and participates in the scene's depth, fog, and emission passes. The renderer uses the silhouette of the selected view. The [survey drone example](../examples/relightable-impostor.js) demonstrates both placement modes under changing camera and lighting angles.

## Painted scenery

Painted scenery can cast [thick cutout shadows](painted-cutout-shadows.md#front-and-back-depth)
with a uniform thickness or paired depth maps.

A scenery atlas splits one painting into parallel planes in world space.
Paint named depths for things a character can pass behind or in front of.
The normal brush marks where the scene's live sun should relight the painting.
The color PNG provides the silhouette and can include transparent pixels.
Use `castsShadow: true` on the placement to cast shadows from those depth
bands. [Shadows from painted cutouts](painted-cutout-shadows.md)

Add the `scenery` section to an atlas manifest.

```json
{
  "width": 196,
  "height": 122,
  "unitsPerPixel": 0.046,
  "files": { "color": "arcade.png" },
  "scenery": {
    "bands": { "ivy": -0.98, "wall": 0, "recess": 1.32 },
    "base": "wall",
    "depthPaint": [
      { "band": "recess", "shape": { "type": "rect", "rect": [74, 60, 68, 48] } },
      { "band": "ivy", "shape": { "type": "path", "points": [[41, 15], [48, 28], [45, 46]], "width": 4 } }
    ],
    "lightPaint": [
      { "normal": [-0.5, 0.55, 0.72], "shape": { "type": "rect", "rect": [19, 35, 17, 2] } }
    ]
  }
}
```

- Each band is an offset from the reference plane in scene units. Negative
  offsets bring paint toward the viewer. Positive offsets set paint back.
  Use up to 16 bands. Unmarked paint uses `base`.
- Both brush lists accept paths with a width in pixels, polygon fills, and
  rectangles. Coordinates are on the full PNG with the origin at its top left.
  Later strokes can override earlier marks. Brush edges snap to the painted
  pixel grid and leave the source color and alpha intact.
- Light brush normals use the atlas's normal space. View-space axes default
  to right, up, and toward the viewer. The brush can add to or replace
  regions of an imported normal PNG. Unmarked texels with no normal retain
  their painted color.
- Scenery uses the band offsets in place of a depth PNG. Omit `frames`
  for a full-image view. Supply one to set the reference pitch, yaw or pivot.
  Placement scale changes both the pixel size and the depth offsets.

The usual `K.sprite.placeAtlas` and JSON `finish.spriteAtlases` placements
select `scenery` mode automatically for this kind of atlas. The plane stays
at its authored world orientation as the camera turns. Use the existing
`depth: false` to flatten it for comparison and `lighting: false` to see the
paint without live shading. The software renderer and CLI composite the
paint with real geometry and depth-dependent fog.

For a single flattened painting, match the reference camera and keep turns
short. Wider turns can expose gaps behind painted foreground details. Fill
those areas with a backing card or geometry when a shot needs them.

[The Ivy Arcade](../examples/painted-scenery.js) uses one painting for the
ivy, wall and recess. A courier crosses a floor baked to splats, and the
stone piers use [SDF-assisted coverage](sdf-assist.md).

```sh
ink-studio clip examples/painted-scenery.js --from 0 --to 5.6 --fps 10 \
  --w 224 --h 152 --px 1 --out ivy-arcade.png
ink-studio render examples/painted-scenery.js --t 3.2 --params '{"depth":false}' \
  --w 224 --h 152 --px 1 --out flattened.png
```

## Hand-edited animation cels

Bake the directional atlas as usual. Crop the view you want to paint from
`color.png` using its `rect` in `atlas.json`. Save your painted RGBA tile
outside the bake directory. The tile keeps the baked dimensions and
alignment, including any transparent margin around the original sprite.
Keep the edits in a separate JSON file so you can rebake the 3D animation
without overwriting the paint.

```json
{
  "poses": { "reach": 5, "brace": 6 },
  "replacements": [
    { "frame": "reach", "direction": 0, "effectDepth": -0.30, "files": { "effect": "sleeve-smear.png" } },
    { "frame": "brace", "direction": 0, "files": { "color": "brace.png" } }
  ],
  "holds": [
    { "frame": "brace", "direction": 0, "frames": 2 }
  ]
}
```

- `frame` accepts a baked frame number or a name from `poses`. Each
  replacement must select exactly one view. Add `pitch` in radians if the
  bake contains the same direction at multiple elevations.
- A hold displays the named frame for the specified number of consecutive
  baked frames, counting the source frame. A hold can target selected views
  or omit `direction` and `pitch` to cover all views. It changes the displayed
  cel while scene time, camera motion, and other animations advance.
- Replacing `color` inherits the baked pivot, scale, and per-texel depth,
  normal, and emission. You can supply aligned `depth`, `normal`, or
  `emission` PNGs using the same encodings as the atlas. Paint outside the
  original alpha requires an authored depth texel or a numeric
  `extensionDepth` in scene units relative to the pivot plane.
- An optional `effect` PNG can paint outside the silhouette. It is a
  separate color layer that participates in sorting without writing depth.
  Use `effectDepth` to place it relative to the pivot plane. Negative offsets
  place paint toward the viewer.

To load the edits from a scene, reference them with `"cels": "edits.json"`
in `atlas.json`. The patch PNG paths are relative to the sidecar. In Node
you can pass `{ cels: '/path/to/edits.json' }` to `readSpriteAtlas`. For
an in-memory atlas use the same `metadata.cels` structure, with decoded RGBA
tiles in `images` instead of paths in `files`.

Set `playback: 'once'` or `playback: 'loop'` on a placement to sample the
baked timing from the scene clock. Elapsed time starts at the first frame.
Existing explicit `frame` controls can also select edited or held frames.
The Node renderer and CLI support cel edits on card and impostor atlases.

```sh
ink-studio clip my-scene.json --sprite-atlas path/to/atlas.json \
  --sprite-cels path/to/edits.json --sprite-playback once
ink-studio clip examples/lantern-catch.js --from 0 --to 1.65 --fps 24 \
  --w 192 --h 140 --px 1 --out lantern-catch.png
```

[Lantern catch](../examples/lantern-catch.js) bakes a roughly 32-pixel
character, paints its catch sleeve and holds the braced pose for two frames
while the swinging lantern and camera keep moving. Use `--params
'{"edited":false}'` for the original bake.

## Painted sprite fringes

Add `fringe` to the same `cels` sidecar used for replacements and
holds. Paint the **attachment sites** on a sprite view with indexed
brushes. Each painted texel pins an independently timed, hand-drawn
cel sequence. A brush can trail behind a hem, flicker along a banner,
or send a small detached fragment past the tile edge.

```json
{
  "poses": { "hover": 1 },
  "fringe": {
    "clips": {
      "wisp": {
        "width": 3,
        "height": 3,
        "pin": [1, 0],
        "palette": ["#8ed6cb", "#4a9aaa"],
        "frames": [
          { "rows": [".0.", ".01", "..1"], "duration": 0.12 },
          { "rows": [".0.", "10.", "1.."], "duration": 0.16 },
          { "rows": ["...", ".0.", "..1"], "offset": [2, 3], "duration": 0.14 },
          { "duration": 0.08 }
        ]
      }
    },
    "brushes": [
      { "clip": "wisp", "depth": 0.04, "opacity": 0.85 },
      { "clip": "wisp", "phase": 0.19, "depth": 0.07, "opacity": 0.7 }
    ],
    "paint": {
      "strokes": [
        { "slot": 0, "shape": { "type": "rect", "rect": [16, 31, 1, 1] } },
        { "slot": 1, "shape": { "type": "rect", "rect": [20, 31, 1, 1] } }
      ]
    }
  }
}
```

- Clips use the [indexed pixel stamp](pixel-stamps.md) cel format, so a
  pose can be authored as `rows`, `slots`, or `strokes`. Each clip
  has a palette of RGB hex swatches and a `pin` in top-left art-pixel
  coordinates. `fps` and optional per-cel `duration` control timing.
  Playback loops by default. Use `playback: 'once'` and a final empty cel
  to play a wisp once and clear it.
- Each painted site selects a brush index. For exact placement, use
  single-pixel marks and leave holes between strands. Use whole-view
  `rows` or `slots`, or ordered strokes. A stroke with `slot: null`
  erases sites. Each view supports up to 512 painted sites. A clip
  supports up to 96 cels on a grid up to 64×64 pixels.
- `phase` offsets the clip clock in seconds. Choose different phases for
  neighboring strands. A cel can also nudge its painted pixels with an
  integer `offset: [x, y]`. For a release, leave a gap at the pin and
  offset successive cels away from the hem. The detached fragment is
  animated in sprite-local pixels and can extend beyond the bake.
- Use `views: [{ frame: 'hover', direction: 0, paint: { ... } }]` to
  replace the default anchor map for a pose or direction. Add `pitch`
  to distinguish elevations. Use an empty `paint: {}` to clear the
  anchors for a matching view. A held pose keeps its own anchor map
  while the fringe clock keeps advancing.
- `depth` sorts the fringe relative to the pivot plane in scene units,
  using the same convention as `effectDepth`. It participates in
  occlusion and fog as translucent paint. Set an optional `emission`
  gain from zero to one for glow passes. Painting the fringe keeps the
  registered body color and auxiliary maps intact.

The Node renderer and CLI draw fringes on card and impostor atlases,
including native-pixel cards. An editor can query
`atlas.fringe(atlas.select(frame, mode, direction), time)` for a
view-local packet with exclusive `bounds` and `at(x, y)` samples.

[The Drowned Belfry](../examples/tidekeeper-fringe.js) uses three clips for
a ghost's fluttering hem, long ribbons, and small released wisps. Render
with `--params '{"fringe":false}'` to inspect the underlying silhouette.

```sh
node cli/ink-studio.js clip examples/tidekeeper-fringe.js --w 322 --h 214 --px 1 \
  --raw --from 0 --to 6 --fps 15 --out drowned-belfry.apng
```
