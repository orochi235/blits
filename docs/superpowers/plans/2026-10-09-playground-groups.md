# Playground groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The playground offers blits' owners and spans: a `groups` list in the composition, compiled with `mix.owns`/`mix.span`, drawn on the score as header lanes, and edited in a Group panel.

**Architecture:** The spec is `docs/superpowers/specs/2026-10-09-playground-groups-design.md`; read it first. Pure modules in `apps/playground/src/blits/` gain the data model, the fit compiler and the cueing; the blits-free `ScoreLanes` widget gains header rows and depth; React panels in `src/app/` edit groups. Every task leaves `npm run playground:check` green.

**Tech Stack:** TypeScript, React, Vite, vitest (node env), weasel/labkit widgets, blits from `src/index.ts` via the `@msb235/blits` alias.

**Conventions (all tasks):** read `apps/playground/README.md` and the root `~/.claude/CLAUDE.md` coding rules. No inline styles; CSS modules. Comments sparingly. US English, Oxford comma. A source file past ~300 lines gets split along what it owns rather than grown (`compile.ts` is at 364: Task 2 moves group cueing into its own module). Widgets in `src/widgets/` never import blits or `@pg/blits`. Run only the tests covering the diff while iterating: `npx vitest run apps/playground/test/<file>` from the repo root, plus `npm run typecheck -w @blits/playground` (check `apps/playground/package.json` for the exact script name) and `npx biome check apps/playground`. Commit after each task with an imperative subject; end the message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: The data model, fits, and load

**Files:**
- Modify: `apps/playground/src/blits/composition.ts`
- Create: `apps/playground/src/blits/fit.ts`
- Modify: `apps/playground/src/blits/load.ts`
- Modify: `apps/playground/src/blits/edit.ts` (the `MAX_*` cap checks)
- Create: `apps/playground/src/blits/groups.ts` (tree helpers)
- Test: `apps/playground/test/fit.test.ts`, `apps/playground/test/groups.test.ts`, `apps/playground/test/load.test.ts`

- [ ] **Step 1: Types.** In `composition.ts` add, importing `Order`, `Strength` from `@msb235/blits`:

```ts
export interface Hints {
  faster?: number;
  slower?: number;
  overlap?: boolean;
  ballast?: boolean;
  priority?: Strength;
}

export type FitStep =
  | { kind: 'condense' }
  | { kind: 'shed' }
  | { kind: 'conclude' }
  | { kind: 'overrun'; cap?: number }
  /** `(span, kids, plan) => plan`, with `plain` and `layout` in scope. */
  | { kind: 'code'; code: string };

export interface SpanSettings {
  duration?: number;
  priority?: Strength;
  order?: Order;
  share?: number;
  spill?: 'instant' | 'overrun';
  /** Unset: blits' default fit. */
  fit?: FitStep[];
}

export interface Group {
  id: string;
  name: string;
  hue: number;
  kind: 'owner' | 'span';
  /** The parent group's id. */
  owner?: string;
  start: number;
  rate: number;
  weight: number | Expr;
  fade: { in?: number; out?: number; ease?: Easing };
  freeze?: 'before' | 'after' | 'both';
  anchor?: Placement;
  /** Read only when the parent is a span. */
  hints?: Hints;
  /** Only on kind 'span'. */
  span?: SpanSettings;
}
```

`Voice` gains `owner?: string; hints?: Hints;`. `Composition` gains `groups?: Group[];`. Add `export const MAX_GROUPS = 16;` and `export const FIT_PRESETS = { default: [{ kind: 'condense' }, { kind: 'shed' }], lax: [{ kind: 'condense' }, { kind: 'shed' }, { kind: 'overrun' }] } as const satisfies Record<string, FitStep[]>;`.

- [ ] **Step 2: Tree helpers, test first.** `groups.ts` exports, all pure over a `Composition`:

```ts
/** The group a voice or group id sits directly under, or undefined at the top. */
export function parentOf(c: Composition, id: string): Group | undefined;
/** True when `id` (voice or group) sits directly under a span. */
export function underSpan(c: Composition, id: string): boolean;
/** Every group from the top down to the one holding `id`, outermost first. */
export function ancestorsOf(c: Composition, id: string): Group[];
/** A cycle in `owner` links, or an unknown `owner` id, as a message; null when the tree is sound. */
export function treeFault(c: Composition): string | null;
/**
 * The score's and the cue's order: depth-first, a group just before its first member, groups with
 * no members at the end. Each row is a voice or a group with its depth (0 at the top).
 */
export function rowsOf(c: Composition): { kind: 'voice' | 'group'; id: string; depth: number }[];
```

`rowsOf` keeps every group's block whole: build the tree (the children of each group and of the top, in order of first appearance in `voices`, a nested group positioned at its first member), then emit it depth-first. Empty groups go at the end of their parent's children. Tests in `test/groups.test.ts`: a flat composition's rows equal its voices at depth 0; voices `a(g1), b, c(g1)` give `g1(0), a(1), c(1), b(0)`; nested `g2` under `g1` with voice `d(g2)` listed first gives `g1, g2, d, …`; an empty group lands at the end; `treeFault` catches `g1.owner = g2, g2.owner = g1` and `owner: 'nope'`.

- [ ] **Step 3: Fit compiler, test first.** `fit.ts`:

```ts
import { conclude, condense, type Fit, layout, overrun, pipe, plain, shed } from '@msb235/blits';
import type { FitStep } from './composition';

/** A step list as blits' fit, or the code step's error. Undefined steps: blits' default. */
export function fitOf(steps: FitStep[] | undefined, compileCode: (code: string) => Fit | { error: string; line: number | null }): Fit | undefined | { error: string; line: number | null; step: number };
```

Each stock step maps to its blits function (`overrun({ cap })` only when `cap` is set). A `code` step compiles with `new Function('plain', 'layout', 'return (' + code + ')')(plain, layout)` through the caller's `compileCode` so `expr.ts`' error-line handling is reused: look at `compileExpr` in `src/blits/expr.ts` and add a sibling there that compiles a function with an extra scope of `{ plain, layout }` rather than writing a second compiler. A code fit that throws at runtime returns the plan it was given, and counts a fault the way `compileExpr`'s functions do. Test (`test/fit.test.ts`): for `[condense, shed]`, `[condense, shed, overrun{cap:1.5}]`, `[conclude]` and a code step `(span, kids, plan) => ({ ...plan, rate: plan.rate.map(() => 2) })`, a blits mix with a `span({ duration: 600, fit })` holding three 400 ms `keys` voices (one `overlap: true`, one `ballast: true`, one `faster: 2`) reports the same `SpanHandle.result` after syncing to 100 ms as the same span cued with the hand-written `pipe(...)`.

- [ ] **Step 4: Load, test first.** In `load.ts` add a `group` validator (shape per Step 1, `kind` one of the two, `span` only on kind span, each `FitStep` shape, `hints` shape, `priority` one of `weak`/`strong`/`required`, `order` one of `queue`/`stagger`/`together`, `share` in 0..1), `voice` accepts `owner?: str` and `hints?`. `load` refuses: `groups.length > MAX_GROUPS`; `treeFault(c) !== null`; a group of kind `owner` whose parent is a span. Add one `load.test.ts` case per refusal and one round-trip of a valid nested composition. Extend `edit.ts`' cap checks so no edit can exceed `MAX_GROUPS`.

- [ ] **Step 5: Run and commit.** `npx vitest run apps/playground/test/fit.test.ts apps/playground/test/groups.test.ts apps/playground/test/load.test.ts`, typecheck, biome. Commit `add owner and span groups to the playground's composition`.

### Task 2: Compile groups

**Files:**
- Create: `apps/playground/src/blits/cueGroups.ts`
- Modify: `apps/playground/src/blits/compile.ts`
- Test: `apps/playground/test/groups-compile.test.ts`

- [ ] **Step 1: Failing tests.** Using `compile.test.ts`'s `voice`, `comp` and `same` helpers (copy them, or move them into `test/helpers.ts` and import from both files — prefer the move):
  1. An owner `g` (`rate: 2`, `weight: 0.5`, `fade: { in: 200 }`, `start: 100`) holding a keys voice `a` (`start: 50`, `loop: 2`) gives, to the bit, the poses of `const h = m.owns({...}); m.cue({ ..., owner: h })`.
  2. A span `s` (`duration: 600`, `order: 'stagger'`, `share: 0.3`, `fit: [{kind:'condense'},{kind:'shed'}]`) holding three keys voices with hints gives the poses of the hand-written `m.span(...)` with the same children, and `built.groupHandles.get('s')` is a `SpanHandle` whose `result` matches.
  3. A span inside an owner, cued depth-first, matches its hand-written cue.
  4. A voice under a span that has a `start` anchor gets a field error `{ voice: id, field: 'anchor' }`; one with `loop: true` gets `{ field: 'loop' }`; both are left out and the rest still play.
  5. A group's weight expression that fails to compile errors on `{ voice: groupId, field: 'weight' }` and leaves the group and everything under it out, each member reporting `{ field: 'owner', error: 'its group "<name>" has errors' }`.
  6. With `solos: true`, every solo mix holds every group, and the soloed voice's poses in its solo equal its poses in the full mix when it is the only voice.

- [ ] **Step 2: Implement.** `Built` gains `groupHandles: Map<string, Handle<Subject>>` (a span's is a `SpanHandle`). In `cueGroups.ts`, export a function that `make` in `compile.ts` calls in place of its voice loop: it walks `rowsOf(c)` and, for a group, builds an `OwnerSpec`/`SpanSpec` (weight via the same `compileExpr` path voices use; `fit` via `fitOf`; `hints` spread onto the spec when the parent is a span; `owner` set to the parent's handle; `start`/`anchor` dropped under a span) and calls `m.owns` or `m.span`; for a voice, it builds the spec with `specOf` (move `specOf` and `patchOf` out of `compile.ts` into `spec.ts` if that keeps both files under 300 lines), sets `owner` to its parent's handle and spreads `hints` under a span, and refuses the cases blits refuses (Spec table) as field errors before cueing. Solo mixes cue every group at its own weight. Keep the duplicate-name check: a name must be unique across voices *and* groups, since anchors find both by name.

- [ ] **Step 3: Run the new file and `test/compile.test.ts`, `test/presets.test.ts`, `test/player.test.ts`.** All pass. Commit `cue the playground's groups with mix.owns and mix.span`.

### Task 3: The score

**Files:**
- Modify: `apps/playground/src/widgets/ScoreLanes/index.ts`, `ScoreLanes.tsx`, `geometry.ts`, `ScoreLanes.module.css`, `ScoreLanes.stories.tsx`
- Modify: `apps/playground/src/blits/score.ts`
- Test: `apps/playground/test/geometry.test.ts`, `apps/playground/test/score.test.ts`

The widget's existing word `group` means a locus bracket; leave it. The new concept is a **header**.

- [ ] **Step 1: Widget props.** `Clip` gains `depth?: number`, `factor?: number` (shown as `×1.3` after the label when not 1), `skipped?: boolean` (drawn as a dashed outline, no fill). Add:

```ts
export interface Header {
  id: string;
  lane: number;
  depth: number;
  label: string;
  hue: number;
  start: number;
  end: number;          // ms; Infinity for open
  budget?: number;      // ms on the score where the budget ends
  over?: number;        // ms past the budget
  fell?: boolean;
  folded?: boolean;
}
```

`ScoreLanesProps` gains `headers?: readonly Header[]` and `onFold?(id: string, folded: boolean): void`. A header lane draws a bar from `start` to `end`, a vertical budget line across its own lane and its members' lanes, a red hatched stretch `[budget, budget + over]`, and a "fell" badge in the label column; the label has a ▾/▸ button that calls `onFold`. Clicking a header selects it through `onSelect(id)`. Labels indent 12 px per depth. Folded headers' members are not passed in (the adapter drops them), so the widget needs no fold logic of its own beyond the button. Lane count is the max over clips and headers.

- [ ] **Step 2: Clip length honors rate.** `score.ts` sets `pass` to `period / rate` (a rate of 0 or below draws an open clip: `passes: Infinity`). Add a `score.test.ts` case: a voice at `rate: 2`, period 500, `loop: 2` ends at `start + 500`.

- [ ] **Step 3: Adapter.** `clipsOf(c, subjects, built?)` returns `{ clips, links, headers }` laid out by `rowsOf`, dropping rows under a folded group (fold state is UI state held in `App.tsx`, passed as a `Set<string>`; not stored in the composition). With `built`, a clip under a span reads its placement from `built.mix.marks(...)`: its `start` mark's timestamp, minus the mix's time origin (find how `player.ts` maps composition time to host timestamps and use the same mapping); `factor` is `built.handles.get(id).rate / voice.rate`; `skipped` when its `start` and `end` marks coincide while its natural length is above 0. Under a span, `locked: true`. A header's `start`/`end` come from the group's own marks, `budget` is `start + duration / rate`, and `over`/`fell` from `SpanHandle.result`. Verify against blits whether marks of a voice that has not started yet are listed by `marks(from, to)` before the first sync; if they are not, sync a throwaway compile once at 0 inside `clipsOf` rather than reaching into blits internals. Tests: a span of three queue children places each after the last, a `faster: 2` child that had to be sped up shows `factor` 2, a `ballast` child that was shed is `skipped`, a folded group hides its members.

- [ ] **Step 4: Story.** Add a forge story with a span header, an owner header nesting it, a fitted clip with a factor, and a skipped one.

- [ ] **Step 5:** run `geometry`, `score`, `drag` tests; typecheck; biome. Commit `draw owners and spans on the playground's score as header lanes`.

### Task 4: Editing groups

**Files:**
- Modify: `apps/playground/src/blits/edit.ts` (or a new `src/blits/groupEdits.ts` if `edit.ts` would pass 300 lines)
- Create: `apps/playground/src/app/GroupPanel.tsx`, `apps/playground/src/app/FitSteps.tsx`, `apps/playground/src/app/HintsFields.tsx`
- Modify: `apps/playground/src/app/VoicePanel.tsx`, `VoiceColumn.tsx`, `LivePanel.tsx`, `App.tsx`, `apps/playground/src/blits/player.ts`
- Test: `apps/playground/test/edit.test.ts`

- [ ] **Step 1: Pure edits, test first.** `addGroup(c, kind)` (fresh id, name `group N` unique across voices and groups, next hue, `start: 0`, `rate: 1`, `weight: 1`, `fade: {}`; a span gets `span: {}`), `deleteGroup(c, id)` (members and child groups move to its parent), `joinGroup(c, id, groupId | null)` (a voice or group moves under a group; joining a span drops `start` → 0 and the start anchor (`anchor.start`, `anchor.in`); refuses an owner into a span and a move that would make a cycle; leaving a span drops `hints`), `setGroup(c, group)`. After any edit that changes the tree, reorder `voices` to the order `rowsOf` gives, so `voices` stays cue order. Each result passes `load`. Tests cover each of those rules.

- [ ] **Step 2: Hints fields.** `HintsFields` edits `faster`, `slower` (numbers ≥ 1), `overlap`, `ballast` (checkboxes), `priority` (select), with blits' doc comments as tooltips the way `VoicePanel` shows them (`src/generated/docs.json` from `scripts/docs.mjs`; extend that script to also pull `SpanHints`, `OwnerSpec` and `SpanSpec`).

- [ ] **Step 3: Voice panel.** An `owner` select (top, or each group; spans not offered to a group of kind owner) calling `joinGroup`; `HintsFields` when `underSpan`. The `start` field and anchor start controls are disabled under a span with the note "a span places it".

- [ ] **Step 4: Fit steps.** `FitSteps` edits `FitStep[] | undefined`: a list of steps, each with remove and up/down; an add menu (condense, shed, overrun, conclude, code); `cap` number on overrun; a `CodePane` on a code step showing its compile error on its line; presets "default" and "lax" that replace the list; a "blits default" state for undefined.

- [ ] **Step 5: Group panel.** Name, kind (switching to owner drops `span`; refused while held by a span), start and anchor (hidden under a span), rate, weight via the existing `WeightField`, fade via the same fields `VoicePanel` uses, freeze, `HintsFields` under a span, and for a span: duration, priority, order, share (0..1, shown only for `stagger`), spill, `FitSteps`, then the live `FitResult` read from `player.built.groupHandles.get(id).result` each frame (`budget`, `length`, `over`, `skipped`, `fell`, numbers in `tabular-nums`, right-aligned, fixed decimals). A delete button calls `deleteGroup`.

- [ ] **Step 6: Selection and live.** `App.tsx` holds the selected id; when it names a group, `VoiceColumn` shows `GroupPanel` in place of `VoicePanel`/`PatchPanel`, and in live mode `LivePanel` acts on the group's handle (generalize `LivePanel` and `Player`'s handle lookup to a voice or group id; a group's handle is reached in the full mix and every solo mix as a voice's is). "add group" sits beside "add voice" and offers owner or span. The score's `onFold` toggles the fold set.

- [ ] **Step 7:** run `edit`, `player` tests; typecheck; biome; `npm run playground:smoke`. Commit `edit owners and spans in the playground`.

### Task 5: Flow, inspector, presets, and docs

**Files:**
- Modify: `apps/playground/src/blits/flow.ts`, `apps/playground/src/app/Inspector.tsx`, `apps/playground/src/blits/player.ts`
- Create: `apps/playground/src/blits/presets/owner-fade.ts`, `apps/playground/src/blits/presets/span-fit.ts`; register them where the other presets are
- Modify: `apps/playground/README.md`, `HANDOFF.md`
- Test: `apps/playground/test/flow.test.ts`, `apps/playground/test/presets.test.ts`

- [ ] **Step 1: Flow, test first.** `flowOf` adds a node per group between the weight signals and the voices; edges group → each voice and nested group it holds; a group's weight expression is parsed for levels and signal calls as a voice's is. Test: an owner with `weight: level('x')` over two voices gives `level x → group → voice a`, `→ voice b`.

- [ ] **Step 2: Inspector.** Under a voice's `weightOf`, list each enclosing group's `weightOf` for the picked subject (the Player's weights record gains groups).

- [ ] **Step 3: Presets.** "owner fade": an owner with `fade: { in: 400, out: 400 }` and a weight level over three voices, faded as one. "span fit": a 2 s span in a queue holding four keys voices whose natural lengths sum past the budget, with one `faster: 1.5`, one `overlap`, one `ballast`, fit `lax` with `cap: 1.2`. `test/presets.test.ts` already plays every preset clean.

- [ ] **Step 4: Docs.** README: the `Composition` block gains `groups`; a "Groups" section (what an owner and a span are in the playground, the fit steps, the header lanes, what blits refuses and how the playground meets it); the score table gains the header row and the fitted-clip row; the panels table gains Group; presets table gains both. HANDOFF item 13: remove the spans-and-fits entry and the owners half of the next one, leaving `mix.blend` and the marks/hits/events entry.

- [ ] **Step 5:** `npm run playground:check`. Commit `add the owner and span presets, and document groups in the playground`.
