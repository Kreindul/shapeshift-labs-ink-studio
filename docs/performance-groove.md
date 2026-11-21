# Groove from a performance

Measure a reference take against its own beat grid. Apply the resulting groove
to a production at a different tempo. The template stores timing in beats,
accent as a relative multiplier, and length in beats. Each dimension has its
own control. You can audition a timing change with the written syncopation,
accents and lengths held constant. [Ableton Groove Pool](https://www.ableton.com/en/live-manual/12/using-grooves/)
 · [Witek et al. on syncopation](https://doi.org/10.1371/journal.pone.0094446)
 · [Senn et al. on microtiming](https://doi.org/10.3389/fpsyg.2016.01487)

## Extract a reference

```sh
ink-studio music groove extract take.json --out groove.json
```

For audio, give each role its own WAV lane where possible. A mixed break
can be used as one lane. Supply its recorded tempo and the time in seconds
of the beat-zero downbeat. Here the reference is two bars of 16th notes.

```json
{
  "input": {
    "kind": "audio",
    "lanes": {"kick": "kick.wav", "rim": "rim.wav", "ghost": "ghost.wav"}
  },
  "grid": {"id": "break", "map": {"tempo": 98, "origin": 0.16}, "length": 8, "step": 0.25},
  "detect": {"minGap": 0.065, "sensitivity": 1.7},
  "gate": {"relative": 0.13, "floor": 0.005, "hold": 0.018, "max": 0.7}
}
```

Ink locates transients on the sample grid and estimates accents and audible
lengths with an RMS envelope. `minGap`, `hold`, and `max` are in seconds.
Respectively, the gate controls set the fraction of peak level, the floor,
the quiet time needed to close the gate, and the maximum measured length.
Check the measured hits if the source is noisy or has overlapping sounds.

For a played take in Standard MIDI File format 0 or 1 with PPQ timing,
replace the input with a MIDI file and lane selectors. Channels are 1-based,
tracks are 0-based, and pitch and velocity ranges can refine the routing.
Velocities use a 0–1 range in selectors. Length is the interval from note-on
to note-off in beats. Audio detector and gate options are for WAV input.
[MIDI file specification](https://midi.org/standard-midi-files)

```json
{
  "input": {
    "kind": "midi",
    "file": "playing.mid",
    "lanes": [
      {"lane": "kick", "channel": 10, "notes": [36]},
      {"lane": "rim", "channel": 10, "notes": [37, 38], "velocity": [0.5, 1]},
      {"lane": "ghost", "channel": 10, "notes": [38], "velocity": [0, 0.49]}
    ]
  },
  "grid": {"id": "playing", "length": 8, "step": 0.25}
}
```

Use `{"kind":"events","file":"observations.json"}` to fit your own measured
observations. Each row has a `lane` and either `beat` or `time`. It may have a
`velocity` and a `durationBeats`, or a `duration` in seconds for a timed row.
The audio and event grid can use Ink's tempo map and swing. For any input,
`startBeat` sets the extraction range and `cycles` folds multiple passes into
one template. Onsets beyond `tolerance` beats from the nearest grid line or
outside the extraction window are counted in the report. When a slot has
multiple measurements, Ink takes their medians. Accents are relative to the
median level of that lane.

## Apply it to a score

```sh
ink-studio music production groove score.json mapping.json --out played.json
ink-studio music production render played.json --out take
```

```json
{
  "template": "groove.json",
  "anchors": [0, 4, 8, 12],
  "links": [{"leader": "kick", "followers": ["bass"], "within": 0.0625, "strength": 1}],
  "tracks": {
    "kick": {"lane": "kick", "timing": 0.8, "accent": 0.6, "length": 0},
    "snare": {
      "lane": "rim", "timing": 1, "accent": 0.85, "length": 0.5,
      "articulations": {"ghost": {"lane": "ghost", "timing": 1.1, "length": 1}}
    }
  }
}
```

Use `roles` for defaults such as `lead`, `bass`, or `percussion`. Named tracks
and articulations can override them. Independent strengths of 0 keep the
authored values, 1 applies the measured values, and up to 2 amplifies the
differences. Onsets add the measured offset, accent scales velocity, and
length blends toward the measured gate. Missing cells are neutral, and
explicit pitch ties keep their gates. The destination tempo map sets the
timing in seconds. `startBeat` controls where the pattern first applies.

Anchors keep attacks on the written timing clock while allowing accent and
gate changes. Links match notes by written beat within the given tolerance.
Matched notes follow a leader’s performed attack. Unmatched notes keep their
own timing rules. The score's written beats and pitches stay editable, and
the CLI includes a change report in the playable recipe.

Graph pipelines can connect `audio.extractGroove` or `music.fitGroove`
to `music.applyGroove` by passing the extracted `value` as the mapping's
`template`. The direct production API is `KIT.music.production.mapGroove`.
The same mapping can go into a revision for a producer audition.

## Side Pocket workshop

```sh
node examples/music-production/performance-groove-workshop.cjs output
```

This builds a 98 BPM reference break from
[recorded one-shots](../examples/music-production/samples/CREDITS.md) and a
synthesized kick, and writes a short authored MIDI take. It exports the
measured lanes, the editable transfer, and three 112 BPM renders of the same
cue. Compare the grid, timing only, and the full transfer.
