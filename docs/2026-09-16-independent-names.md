# A second naming, from the definitions alone

**For:** whoever calls the blits vocabulary. **Answers:** what each role would be called by someone
working from its definition and nothing else.

Every name here was chosen from the gloss in `vocabulary.json` with that file's
candidate lists and consistent-set columns unread, so where a pick matches the sheet it is
convergence rather than agreement. Where a definition named its own incumbent, that is noted.

One name per role, the reason in a clause, and the runner-up worth taking instead. The set is meant
to be read as a set: it settles on a lighting desk with voices playing on it, and the last section
says where that metaphor strains.

## Nouns

| Role | Pick | Why | Runner-up |
|---|---|---|---|
| What one call returns: the slots it drives, each a change from rest | **patch** | Partial by construction, stated against a base — a reader already knows a patch does not mention what it leaves alone | bid |
| One field: a name and a rule for combining two values written to it | **lane** | Values run down it and the rule of the road belongs to the lane, not to whoever is driving | channel |
| The closed list of fields one kind of thing can be moved on | **desk** | A lighting desk is exactly this: every control that exists for one kind of thing, and nothing else reachable | board |
| The thing being driven | **body** | What forces act on; survives being a letter, a wedge or a page without sounding like any of them | unit |
| The function an author writes, pure, returning a patch | **move** | Authorable and namable — a flicker move, a slam move — and it is what a body is made to do | figure |
| One of those, playing, with its own clock, rate and weight | **voice** | Two of the same move playing at once are two voices of one patch, which is the polyphony this already is | take |
| Everything the host holds, stepped once a frame | **mix** | Says what it does to what it holds; the incumbent is right and swapping it would cost more than it returns | ensemble |
| A 0-to-1 value from outside the clock, read per body per frame | **feed** | It is fed in rather than computed, and it keeps arriving | tap |
| The remote for one voice: weight, rate, seek, stop, `done` | **handle** | The word every neighboring API already uses for the thing you keep in order to point back at what you started | lead |
| The code behind a mix that steps and samples | **engine** | Already the word in the decided seam; a second name for it would only break the seam's own prose | works |
| The program that owns the frame loop | **host** | Standard for the program a package plays inside, and it implies the package draws nothing | owner |
| A lane's value for nothing happening | **rest** | Music and physics agree, it is one syllable, and "pulled to rest" needs no gloss | zero |
| How much of a voice is on, 0 to 1 | **level** | On a desk every voice has one, and it is the only thing the mix touches | weight |
| One body at one frame, every lane filled | **pose** | Complete where a patch is partial, and the word for a full set of channel values at an instant | state |
| What one voice does to one body this frame, after its level | **share** | Its size is the voice's own, not a fraction of a whole — two shares of 0.1 leave 0.01 | stake |
| What a move is handed: the world it may read but did not compute | **world** | Names the contents by where they came from, which is the only thing they have in common | now |
| How long one pass lasts, the phase wrapping across it | **lap** | One time around; a lap of zero reads correctly as "does not go around" | span |
| Where a voice is within that, 0 to 1 | **phase** | Fixed by prior decision; the definition says so itself | — |
| A label shared by voices that are alternatives in time, capped to sum to 1 | **seat** | One at a time, or two sharing it mid-handover — the cap is the seat, not a rule about the group | bank |

## Verbs

| Role | Pick | Why | Runner-up |
|---|---|---|---|
| Put a voice into the mix | **play** | What you do to a move, and it returns the handle the way playing anything gives you something to stop | start |
| Take one out, its level ramping down first | **stop** | Fading is the ordinary case, so the plain word should mean it; leaving without a fade is `cut` | end |
| Move the mix to a frame | **tick** | Clock-driven and idempotent for one time, which is what a tick is | step |
| Ask for one body's pose now | **read** | `mix.read(body)` says it: nothing is computed on demand, the frame already happened | ask |
| Move one voice's own clock | **seek** | The media word, one syllable, and it already implies nothing else moves | scrub |
| Put several in whose levels one feed shares out | **blend** | The result is between them at every moment, which is the whole point | cross |
| Stop every voice with a given fade | **clear** | Empties the thing rather than acting on any member of it | hush |
| Throw away the state kept for a body | **drop** | Shorter than forget and free of the suggestion that it might be remembered again | free |

## Operations

| Role | Pick | Why | Runner-up |
|---|---|---|---|
| Combine two values on one lane | **join** | A lattice join in the algebra column, and "take the larger" is literally one | meet |
| Pull a value toward its lane's rest by 0 to 1 | **dim** | On a desk this is the physical act; that only a lane with a rest can be dimmed then reads as obvious | pull |
| Find the value a fraction of the way between two | **tween** | The animation word, one syllable, and it does not imply a rest the way the others do | slide |
| Merge every share reaching one body into one pose | **fold** | The Σ it stands for, and the operation an engine exists to run | sum |

## Where the set strains

**`patch` collides with `voice`.** In synthesis a patch is the program a voice plays — which here is
the **move**, not what a call returns. If the set keeps `voice`, take **bid** for the first role
instead: a voice bids a change on a lane, the lane's `join` settles competing bids, and what a body
finally holds is the `fold` of the bids that reached it. That reading is more coherent than `patch`,
at the cost of a word nobody will guess cold.

**`mix` is the noun and `blend` and `fold` are both verbs for combining.** They are three different
things — the live set, putting several voices in under one feed, and merging shares into a pose —
and only the first is obvious from the word. If one has to move, `blend` is the one to rename,
because `cross` carries "between two alternatives" and `blend` does not.

**`lane` against `desk`.** A desk of lanes is not a phrase anyone says; a desk of channels is. The
pair survives because `lane` earns its keep elsewhere — it is what a value runs down and what owns
the join rule — but this is the join in the set that a reader will notice first.
