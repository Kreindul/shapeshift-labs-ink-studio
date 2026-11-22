# Music edit sessions

Hear alternate score performances and audio takes in a common mix. Loop a
passage, switch lanes at score addresses, and keep chosen ranges in an
editable recipe. Use [producer revisions](music-producer.md),
[audio editorial](audio-editorial.md), and [sample motifs](sample-motif.md)
as sources.

## Assemble a session

The CLI recipe has `session` and an optional top-level `assets` table
mapping names to relative WAV paths. The session contains the following:

| Field | Purpose |
| --- | --- |
| `format`, `version` | `"ink-studio/music-edit-session"`, `1` |
| `id`, `sampleRate` | Session name and stereo output clock, 8–96 kHz |
| `production` | The ordinary production, with its existing arrangement, patch, and track IDs |
| `takes` | Named production revisions. The original score is always `reference`. |
| `audio` | Additional named lanes with `{take, takes}` to specify each lane's default and alternatives |
| `comp` | Selected source ranges, with `{lane, take, from, to, fadeSamples?}` |
| `pins` | A lane table mapping to `"all"` (protect the source lane) or, for score lanes, `"pitch"` (protect the written pitch sequence per voice within each selection) |
| `mixer` | Native mixer desk with `output`, `strips`, and optional `processors`, `taps`, `tail`, and `peakPolicy` |
| `automation` | Named fader, pan, send-level, or insert parameter lanes with named control points |

Each production track and added audio lane has its own strip. A separate
`score-room` strip receives the production's room contribution. The desk
uses the production tempo map, and its source clips come from the session
lanes. Add sends, groups, inserts, sidechains, and returns just as in the
[mixer](audio-mixer.md). For example, a fader automation lane is
`{"target":{"strip":"lead","parameter":"fader"},"unit":"beats","points":[{"id":"near","at":16,"value":0.85}]}`.
A send target uses `{strip,send,parameter:"level"}`. An insert target uses
`{processor,parameter}` with an automatable parameter on that processor.

An audio take can use a WAV `{asset, at?, fromSample?, toSample?}`, an
editorial project `{editorial, track?, at?}`, or a saved sample audition
`{motif:{source,score,plan,role}, at?}`. A sample-motif take plays the isolated
role, with its original score-window start as the default placement. The other
takes default to sample zero. All placement and range addresses use the
mixer's musical, second, or sample syntax. Bars are zero-indexed.

## Loop, switch, keep

Render this preview to play bars 7–10 twice, switching the lead to its
`breathy` take at the start of bar 9 on the second pass.

```json
{
  "from": {"bar": 6},
  "to": {"bar": 10},
  "passes": 2,
  "switches": [
    {"pass": 1, "at": {"bar": 8}, "lane": "lead", "take": "breathy", "fadeSamples": 240}
  ]
}
```

The preview prerolls from cue start and outputs only the requested loop
passes. The desk processes one continuous timeline and keeps its state across
switches and wraps. Score-addressed automation follows each pass. Insert
parameters that specify a one-time trigger or source buffer position
continue to refer to the unrolled mixer timeline. Switches persist into
subsequent passes and use a one-sided entrance fade if specified.

Keep the second half with an addressed edit:

```json
[
  {"op":"comp","lane":"lead","take":"breathy","from":{"bar":8},"to":{"bar":10},"fadeSamples":240}
]
```

Ranges are half-open. A keep edit replaces overlapping choices in the target
range and retains their remaining portions. Saved fades blend with the
default take at both edges. Score comps select *performed audio* before the
desk, so timing, recorded attacks, and note releases are heard from their
own take. The take's notes, patch, and native revision remain editable.
An `all` pin guards the source material before the desk so the mixer can
still balance it. A `pitch` pin permits changes to gate, timing, dynamics,
and articulation while preserving pitches. Production pins still apply.

```sh
ink-studio music session inspect cue.json --out addresses.json
ink-studio music session preview cue.json review.json --out listen
ink-studio music session edit cue.json keep.json --out kept.json
ink-studio music session render kept.json --out print
```

Inspection lists take and audio clip IDs, automation point IDs, and performed
notes. Address an editable note clip with
`{op:"note",take,lane,clip,voice,note,set:{beat,duration,velocity,play}}`.
Other edits are `{op:"pin",lane,mode}`, where `null` releases an ordinary
session pin, `{op:"score-take",take,revision}`, `{op:"audio-take",lane,take,source}`,
`{op:"automation",lane,point,at?,value?}`, and
`{op:"editorial",lane,take,edits:[...]}` using native editorial clip commands.

## Keep the audition warm

`ink-studio music session stream cue.json` uses one JSON request and response
per line. For example:

```jsonl
{"op":"preview","out":"first","preview":{"from":{"bar":6},"to":{"bar":10}}}
{"op":"edit","changes":[{"op":"comp","lane":"lead","take":"breathy","from":{"bar":8},"to":{"bar":10}}]}
{"op":"preview","out":"second","preview":{"from":{"bar":6},"to":{"bar":10}}}
{"op":"save","out":"kept.json"}
```

Each preview or render writes a mix, named mixer taps, switch positions, and
cache counts. A persistent stream or JS handle reuses unchanged rendered
takes, with bounded cache eviction. Mixing runs again to preserve effect
history and respond to changed routing or automation. The interface produces
offline listening passes and files. It can be driven by an agent without a
DAW or device transport.

The JavaScript entry point is
`KIT.procedural.mediaGraph.musicSession.create(assets)`. It returns
`inspect(session)`, `edit(session, edits)`, and
`render(session, preview?)`. Use `music.inspectEditSession`,
`music.editSession`, and `music.renderEditSession` in a graph.
