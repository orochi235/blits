# Nesting and booking — design

**Unbuilt (2026-10-04).** Delete this file once both are built and the schema page describes them.

**For:** whoever builds these, and Mike, who reviews the design once before building starts.
**Answers:** how blits takes the last two of weasel's features (`NOTES-FROM-WEASEL.md`, "What weasel
has that blits doesn't"): a voice that holds voices, and events booked ahead against an outside clock.
Both build on `mix.rate`, which lands first, because both compose clocks with it.

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

## Booking: marks and events taken ahead of time

A host with an outside clock, such as an `AudioContext`, needs to hear about a time before it arrives.
Patch-sent events can't serve that: `send` runs while a subject catches up, so it isn't known ahead.
What is known ahead is the plan: the marks in `mix.marks`, and a new per-voice list of **hits**:
events at voice times.

```ts
mix.cue({ patch: spin, hits: [{ at: 0, event: 'whoosh' }, { at: 1200, event: 'clunk' }] });

const booker = mix.book({
  clock: () => audio.currentTime * 1000,   // the outside clock, in ms
  ahead: 100,                              // how far ahead to book
  late: 40,                                // skip anything found more than this past
  take(item, when, lateBy) {               // item: a Marked, or { voice, hit, pass }
    const src = play(item.event, when / 1000);
    return { stop: () => src.stop() };     // called if the time moves or the voice leaves
  },
});
```

- **Hits** play once per pass on the voice's clock (`rate`, `ramp`, the owner chain,
  and `mix.rate` all apply). They are per voice, not per subject: `stagger` does not spread them.
- **When** maps host time to the outside clock with a smoothed offset sampled at each `sync`. The
  filter is weasel's: fold 5% of each frame's residual in, and treat a jump past 50 ms as a resync.
- **Retraction.** Anything that moves a booked time by more than 1 ms, or removes it, calls `stop` on
  the booking and books it again at the next `sync`. That covers `seek`, `rate`/`ramp` on a voice,
  owner, or mix, `fade`/`mute`, `rebase`, and an anchor target moving. An item is identified by
  (voice, mark) or (voice, hit index, pass), so nothing is booked twice.
- **Late items.** An item first seen already past (a voice cued partway through, or a stalled frame) is
  taken at `when` = now with `lateBy` > 0, unless `lateBy` exceeds `late`.
- `book` takes an optional `tag` or `score` so that two bookers can split one mix.
- `book` returns a handle with `stop()`, which retracts everything still ahead and stops booking.
- Patch-sent events stay drain-only.

Names decided 2026-10-04: `owns` (Mike), `owner` for the child's field, `hits`, `book`, `take`.
