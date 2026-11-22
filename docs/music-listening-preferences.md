# Recall preferences from blind listening

Preference memory carries pairwise listening choices into a different cue. It
records what was compared, the criterion, the vote counts including ties, the
editor's reason, and the source passage in beats, seconds, and samples. Recall
can move an applicable edit to the front of a new audition. Keeping that edit
is a separate decision.

## Record a choice

Add a listening context to a [critique brief](music-critique.md). Use stable
names shared by your sessions. Supply at least a `scene` or `moment`.
`role`, `style`, and `intent` are optional. Use only the facets where you
intend the decision to apply.

```json
{
  "section": "return",
  "goal": "Give the pickup room before the low end arrives.",
  "kind": "arrival",
  "listeningContext": {
    "scene": "suspense",
    "moment": "before-reveal",
    "role": "bass"
  }
}
```

```sh
ink-studio music critique plan first-cue.json first-brief.json --out first-plan.json
ink-studio music critique listen first-cue.json first-plan.json --out first-review
```

Share `first-review/public` with listeners. The labels, audio, and ballot
are public. The private key maps labels to edits and carries the listening
context. Combine ballots from different listeners under the same test token
and write an editorial reason for the chosen take.

```sh
ink-studio music critique keep first-cue.json first-review/review-key.json decision.json --out chosen
ink-studio music critique remember listening-memory chosen/reference.json
```

The archive writes one immutable JSON record per test. Repeating the same
archive operation is safe. Keep `chosen/reference.json` with the cue for the
exact revision and individual ballots. To archive a blind test from before
context was supported, run `keep` with its original private key and add
`listeningContext` to the decision.

For a comparison of shared room on percussion, use `kind: "space"`. It
offers `dry-drums` when playing percussion sends to the shared room.
For a reusable edit of your own, use `kind: "custom"` or add `takes` to
a preset brief. Give each take an `id`, a listening `hypothesis`, and an
ordinary [production revision](music-production.md) in `revision`. Keep
the move ID stable when the same editorial idea has different track names
or settings in another cue.

## Bring the evidence into another session

Set `memory` in the next brief to the directory relative to the brief, set
the new `listeningContext`, and choose a `criterion` of `identity`
(the default), `shape`, `groove`, or `replay`. The plan exposes
`preference` with the recommendation, matching tests, vote counts,
and rationale for each eligible pair. Query the same archive on its own.

```json
{
  "context": {"scene": "suspense", "moment": "before-reveal", "role": "bass"},
  "criterion": "shape",
  "moves": ["reference", "delay-bass"]
}
```

```sh
ink-studio music critique recall listening-memory query.json --out evidence.json
```

Every recorded facet has to match. A query may add further facets. Each pair
uses its most specific eligible tests. Both takes must be available if
`moves` is supplied. Each test contributes its vote margin as a fraction
of all votes for that pair and criterion, including ties. Recall leaves
the preference unset when the leading evidence is tied. Choosing the
original is also a valid outcome. In a new plan, normal edit checks and pins
still determine which moves can be offered.

Headless graphs expose `music.rememberListeningPreference` and
`music.recallListeningPreferences`. In JavaScript use
`KIT.music.production.critique.rememberPreference(memory, reference)` and
`recallPreferences(memory, query)`. Pass `undefined` to start an archive
with the first reference. The returned versioned snapshot can be serialized
as JSON and loaded by the CLI as an alternative to a directory.
