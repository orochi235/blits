# Notes from astv

**For:** whoever works on blits' score, `project(at)` and reading back. **Answers:** what astv
needs from a future-and-past reading API, in astv's words, and which astv cases the design has to
pass. Written 2026-09-29 against blits `a22eaa8`, after a conversation between the astv and blits
sessions. astv (`~/src/astv`) plays a repo's git history as an animated wall of cards: one commit
per step, each step a scene landing, a morph into it, then a rest.

Nothing here was measured; it is what astv designed on 2026-09-29, partly built. When an item is
dealt with, delete it, and delete this file once it is empty.

## What astv is building

A play's timeline owns one record per step k: its facts (which nodes that commit changed, by
identity key, with a change kind), its scene request, its laid-out scene (one promise, fetched on
first ask) and its ghosts (removed nodes held on the wall for a few steps). Anything looking ahead
is handed the promise the landing will install, so nothing can disagree with what lands. The
request for step k is a pure function of rail position and config. A knob change starts a new
generation and drops every cached future. The change glow is being made stateless: a node's glow
is a function of position minus the last step at or before it that changed the node.

## The operations astv needs, in astv's words

- **Read at k.** Everything a consumer draws at step k: facts, scene, glow. A step whose future is
  not fixed (the worktree, a live Claude transcript) answers `held`, never a missing answer.
- **Read at k−3.** The same read behind the playhead, for a scrub backwards. For everything but
  ghosts and a camera mid-flight, this is the same lookup as reading ahead.
- **What changes next.** The next n steps' facts, nearest first, for anything that has to be ready
  before a change lands. astv's first customer is a container that opens one step early so its
  growth finishes before its contents light: `anchor: { in: T }` done by hand.
- **Invalidate the future.** A config change means every read ahead reruns. The future is a
  function of the plan, so nothing is patched up.

## Cases the design has to pass

- **Scrubbing is discrete, and backwards is as common as forwards.** A reader drags a rail ten
  commits back, then forward three. A round trip k → k−5 → k must give an identical picture to
  never having left.
- **Arrivals are regular members.** A file that a commit adds is laid out like every other node and
  enters by the one rule for anything that appears: it grows out of its nearest ancestor that was
  on screen, whatever the reason it appeared. No placeholder state, no rule that only applies to
  arrivals.
- **A camera that retargets mid-flight.** astv's flights retarget when a new scene lands while the
  camera is still moving. Your note that `from: 'current'` restarts from zero velocity, so a
  retarget kinks, is the known gap this case would hit.
- **State that cannot be a function of position.** Ghosts need a removed node's position from the
  scene before the commit that removed it; a camera mid-flight has velocity. These are astv's two
  candidates for your nearest-checkpoint-then-step-forward answer.

## How astv's effects would map, as the blits session read them

A glow per node with decay: a signal on weight, or stateless as above. Staggered morphs: a `keys`
patch with `stagger`. Ghost fades: a handle fade. The stepped "reach" animation: `ease: { steps: n }`.
A retargeting camera: `keys` with `from: 'current'`. astv does not depend on blits and is not
proposing to yet; the per-step record is offered as a test case for `project`/`assess` before
either is built.
