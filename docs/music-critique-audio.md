# Audio critique workbench

Inspect the actual rendered production, listen to selected audio views,
try an editable fix, and keep the chosen version with a listening reason.
The [blind critique workflow](music-critique.md) remains available for
collecting votes.

```sh
ink-studio music critique inspect cue.json passage.json --out evidence
ink-studio music critique compare cue.json repairs.json --out comparison
ink-studio music critique apply cue.json comparison/comparison.json decision.json --out kept
```

## Pull up a phrase

Ranges use the mixer's beat, bar, second or sample positions. They are
half-open. Use `context` to hear what's on either side without having to
move the focus. A probe runs the score and effects from cue start before
returning the requested audio, and uses the original note lengths even
when a preview ends partway through a note.

```json
{
  "range": {"from": {"beat": 8}, "to": {"beat": 11}},
  "context": {"beforeBeats": 2, "afterBeats": 3},
  "lead": "hook",
  "sampleRate": 32000,
  "views": [
    {"id": "arrival", "mode": "mix", "span": "context"},
    {"id": "hook-solo", "mode": "solo", "tracks": ["hook"]},
    {"id": "keys-solo", "mode": "solo", "tracks": ["keys"]},
    {"id": "without-keys", "mode": "without", "tracks": ["keys"]},
    {"id": "mono", "mode": "mono"}
  ]
}
```

`solo` adds the selected track stems. Include the stem named `room` to
hear the shared room. `without` subtracts selected rendered stems from
the mix while retaining the other rendered contributions, including any
shared room and ducking already present. To hear a genuine change to the
track and its sends, audition a `silence` edit. Probe previews share a
headroom trim and the report measures the original PCM.

The report includes beat, sample and second addresses for candidate
problems and written clip notes. It highlights over-range peaks, mono
loss and simultaneous band energy between the lead and competing stems.
Use the band readings as clues and listen to the actual phrase and
solos. An overlap suggestion has an initial frequency, Q and local gain
cut you can copy or change. The report also includes similar beat
patterns and the underlying measurements by window. [Neutron's masking workflow](https://www.izotope.com/en/learn/unmasking-your-mix-with-neutron)

## Audition a repair

Use the same range and context in the comparison. The edit scope defaults
to the focus. An explicit `range` can address a smaller spot or part of
the surrounding context. Up to six alternatives can be compared at once.

```json
{
  "range": {"from": {"beat": 8}, "to": {"beat": 11}},
  "context": {"beforeBeats": 2, "afterBeats": 3},
  "lead": "hook",
  "sampleRate": 32000,
  "level": "matched",
  "candidates": [
    {
      "id": "local-bell",
      "label": "Cut the upper-mid overlap",
      "edits": [
        {"op": "eq", "range": {"from": {"beat": 8}, "to": {"beat": 9}},
          "parts": ["keys"], "hz": 700, "q": 1.15, "gainDb": -5, "fadeSeconds": 0.025}
      ]
    },
    {
      "id": "softer-answer",
      "edits": [
        {"op": "note", "part": "keys", "clip": "return", "voice": "upper",
          "note": "answer", "set": {"velocity": 0.48}}
      ]
    }
  ]
}
```

Time-scoped operations are `eq`, `level`, `silence`, `register`,
`density`, `room`, `tail` and `depth`, with the usual [cue-map settings](music-cue-map.md).
Omit `parts` to use the normal scope of that cue lane.
`note` edits a written clip note's beat, duration, MIDI, velocity,
expression or tie. Use note addresses from the probe. Edits are validated
by the ordinary production compiler. Conflicts with existing automation,
out-of-range edits and changes to pinned parts appear under `blocked`.

The comparison includes the original and each valid take on the same
sample timeline. The default `matched` matches the context's integrated
loudness under a common ceiling. Use `fixed` to hear changes at a common
playback gain. Per-take focus measurements and band overlaps use the
unscaled render. `differenceRms` uses the raw context to show how much
the edit changed that audio. Audible preference is an editorial
decision. [ITU-R listening test methodology](https://www.itu.int/rec/r-rec-bs.1534/en)

## Keep the heard decision

```json
{"token":"edit-token-from-comparison","take":"local-bell",
 "reason":"The hook reads through the entrance and the chord still rings."}
```

`apply` checks that the production, audio assets and comparison still
match. It writes a portable production recipe, a reusable native revision,
and a searchable listening reference with the recorded reason.
The existing `music critique find` command indexes these decisions too.

JavaScript exposes `KIT.music.production.critique.openAudio(production, assets)`
with `inspect(request)` and `compare(request)`. The handle reuses the
original render for repeated requests over the same sample context.
Use `critique.applyEdit(production, key, decision, assets)` to keep a take.
Graph operations are `music.inspectCritiqueAudio`,
`music.compareCritiqueEdits` and `music.applyCritiqueEdit`. The inspect
node's `clip` port carries the first requested view directly as audio.
The comparison node's `original` and `candidate` ports carry the
original and first valid edited audio. Its `audio` port holds the whole
comparison and `value.blocked` explains unavailable alternatives.

Use [foreground mixing](music-foreground-mix.md) to propose moves that follow
a sequence of foreground tracks and compare rendered balance per moment.
