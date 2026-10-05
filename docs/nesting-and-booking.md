# Nesting — design

**Unbuilt (2026-10-04).** Delete this file once nesting is built and the schema page describes it. Booking is built; the schema page's Time section has it.

**For:** whoever builds it, and Mike, who reviews the design once before building starts.
**Answers:** how blits takes the last of weasel's features (`NOTES-FROM-WEASEL.md`, "What weasel
has that blits doesn't"): a voice that holds voices. It builds on `mix.rate`, because it composes
clocks with it. Booking (`mix.book`, `hits`) is built and maps a hit to host time through the
voice's own clock and `mix.rate` only, so nesting has to route `src/book.ts`'s hit times (`timeOfHit`,
and the voice-time bounds in `hits`) through the owner chain.

## Nesting: `owns`

`mix.owns(spec)` cues an **owner**: a voice with no patch that holds other voices and owns their
playback. A child names it with `owner: handle`. The mix's own clock is the root owner, so `mix.rate`
is the outermost link in the same chain.

```ts
const intro = mix.owns({ anchor: { start: { after: 'title' } }, fade: { out: 300 }, name: 'intro' });
mix.cue({ patch: slide, owner: intro, start: 0 });
mix.cue({ patch: glow, owner: intro, anchor: { start: { after: 'slide' } } });
intro.rate = 0.5;   // both children run at half speed
intro.seek(800);    // both move, as handle.seek moves one voice
intro.fade();       // one envelope over both
```

| On the owner | What it does to its children |
|---|---|
| `start`, `anchor`, `name`, `tags`, `score` | Place the owner on its own owner's clock, as for any voice. |
| a child's `start` / `anchor` | Counted on the owner's clock: ms from the owner's start. |
| bare names in a child's anchors | Resolve among its siblings. An owner is a score with its own clock. |
| `rate`, `ramp` | Multiply into each child's own rate, under `mix.rate`. |
| `seek` | Moves the owner's clock. The children's phases follow, and state stays where it is (`handle.seek`'s rule). |
| `weight` (a number or a Signal), `fade` | Multiply into each child's weight per subject. |
| `hold` | Holds the children's clocks with its own. |
| `done` / `played` | Resolve when every child has left / finished its passes. An owner with no children left leaves. |
| `loop` | Refused at cue (decided 2026-10-04): a pass would have to restart stateful children, so it waits for a use. |

- Owners nest (`mix.owns({ owner: outer })`).
- `mix.voices()` lists owners and children alike, and a handle exposes its `owner`.
- `marks` maps a child's marks to the host clock through each owner's clock. A mark is listed only
  while every clock above it is fixed, which is the existing rule for "nothing has fixed it yet".
- Under `history`, an owner's control changes are recorded like a handle's, so `project` composes
  them both ways.
- Lanes: a voice's elapsed time is read from its owner chain rather than from the mix clock. The
  phase arithmetic stays the one copy in `clock.ts`. A voice with no owner pays nothing.

Names decided 2026-10-04: `owns` (Mike), `owner` for the child's field.
