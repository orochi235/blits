# Companion Handles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** blits-tone's `Sound` and blits-quarks' `Source`/`Emitter`: library-level calls on each driver that return an object wired to the mix.

**Architecture:** Each handle sits on its package's existing driver (`drive`, `attach`, `detach`, `write`), adding methods to the returned `Driver`. A handle is its own blits subject. Tone gets base-relative targets and a `kit` option; quarks gets an extra-burst count per bound subject.

**Tech Stack:** TypeScript, vitest, Tone 15 (offline render via `node-web-audio-api`), three.quarks.

**Spec:** `docs/superpowers/specs/2026-10-18-companion-handles-design.md`

## Global Constraints

- No engine change: everything lives in `packages/tone` and `packages/quarks`.
- `drive`, `attach`, `detach`, `write`, `cancel` keep their current behavior; existing tests pass unchanged.
- Shipped source imports relatively (no path aliases); tests import Tone and `drive` from `test/audio.ts` only.
- Names: `wire`, `particles`, `synth`, `polySynth`, `oscillator`, `noise`, `at`, `cue`, `burst`, `copy`, `drop`; types `Sound`, `Source`, `Emitter`.
- Error messages start `blits-tone: ` / `blits-quarks: `, as the existing ones do.
- Changelogs go under `## Unreleased` with `### Added`; no version bump, no tag.
- Branch `companion-handles` off `main`.

## Review Focus

- A `Sound` wired, then cued, then dropped while a curve is scheduled ahead: the parameter must land on its base, not hold the last ramp value.
- `copy()` of a `Sound` whose original is connected: the copy is not connected anywhere and nothing is shared (the original's `get()` changing later leaves the copy alone).
- Two emitters on one source where only one bursts: the other emits nothing extra, and the burst lands at the bursting emitter's position.
- `cue` after `drop`: throws, rather than cueing onto a subject the driver no longer writes.
- A kit with no channel matching any of the node's parameters: `wire` works and drives nothing, rather than throwing.

---

### Task 1: Tone — base-relative wiring with `t.wire` and `Sound`

**Files:**
- Create: `packages/tone/src/sound.ts`
- Modify: `packages/tone/src/drive.ts`, `packages/tone/src/index.ts`
- Test: `packages/tone/test/sound.test.ts`

**Interfaces:**
- Produces:
  - `DriveOptions<E = unknown, I = unknown, O = unknown>` gains `kit?: Kit<O>`; `drive<I, O, E>(mix: Mix<I, O>, opts?: DriveOptions<E, I, O>)`.
  - `Driver<I, O>` gains `wire<N extends ToneAudioNode>(node: N): Sound<N, I, O>`.
  - `interface Sound<N, I, O> { readonly node: N; cue(spec: Omit<VoiceSpec<I, O>, 'subjects'>): Handle<I>; drop(): void }`, exported. Task 2 adds `copy`.
  - `channels: Kit<{ detune: number; volume: number; gain: number }>` = `{ detune: sum(), volume: sum(), gain: mul() }`, exported.

- [ ] **Step 1: Write the failing tests** in `test/sound.test.ts`, each rendering through `Tone.Offline` the way `render.ts` does (an `Oscillator` or `Gain` whose param is sampled by routing a `Tone.Signal` copy, or by reading `param.getValueAtTime`):
  - `holds a wired node's parameters at their base with nothing cued`: `new Tone.Oscillator({ detune: 50, volume: -6 })`, wired with `kit: kit(channels)`; after 10 frames, `detune.value === 50`, `volume.value === -6`.
  - `moves detune and volume from the base`: cue a constant patch `{ detune: 100, volume: -3 }`; expect `150` and `-9` (within 1e-6) after a write.
  - `scales gain from the base`: `new Tone.Gain(0.5)`, constant `{ gain: 0.5 }` → `0.25`.
  - `leaves a note's frequency alone`: a wired `Tone.Synth`, `triggerAttack('A4')` scheduled at 0.1 s, writes every 16 ms for 0.3 s; `frequency.getValueAtTime(0.2) === 440`.
  - `puts the base back on drop`: cue `{ detune: 100 }` on base 50, write, `drop()`, write again; `detune.getValueAtTime(after drop) === 50`.
  - `drives nothing a kit has no channel for`: kit `{ other: sum() }`; wire succeeds; `detune.value` unchanged.
  - throws: `wire` without `kit` (`/needs a kit/`); `wire` of a node already wired (`/already wired/`); `wire({})` (`/not a Tone node/`); `cue({ subjects: [x], ... })` (`/names its own subject/`); `cue` after `drop()` (`/dropped/`).

- [ ] **Step 2: Run** `npx vitest run packages/tone/test/sound.test.ts` — expected FAIL (`wire` is not a function).

- [ ] **Step 3: Implement.**
  - `drive.ts`: a bound target carries `combine: (value: number) => number`; `attach` uses identity, so its behavior is unchanged. `write` writes `combine(value)`. Add an internal `bind(subject, entries)` that `wire` uses.
  - `sound.ts`: `wire` checks `node instanceof ToneAudioNode`, a module-level `WeakSet` of wired nodes, and `opts.kit`. It walks `Object.keys(node)` plus the prototype's getters for properties that are `instanceof Param` or `instanceof Signal` and whose name is in the kit; for each, base = `param.value` at wire time, and `combine` = `base + v` when the kit channel's `rest === 0`, `base * v` when `rest === 1`, else `v`. The `Sound` object is the subject (cast to `I` inside). `drop()` detaches, sets each param back with `cancelAndHoldAtTime(now)` then `setValueAtTime(base, now)`, calls `mix.drop(sound)`, removes the node from the `WeakSet`, and marks the sound dropped.
  - `index.ts`: export `Sound`, `channels`.

- [ ] **Step 4: Run** the new file and `npx vitest run packages/tone` — expected PASS, the existing tests unchanged.

- [ ] **Step 5: Commit** — `git commit -m "wire a Tone node to a mix as a Sound, its parameters moved from their base by the kit's channels"`

### Task 2: Tone — shortcut constructors and `copy()`

**Files:**
- Modify: `packages/tone/src/sound.ts`, `packages/tone/src/drive.ts`
- Test: `packages/tone/test/sound.test.ts`

**Interfaces:**
- Consumes: Task 1's `wire`, `Sound`.
- Produces: `Driver` gains `synth(opts?: Partial<SynthOptions>)`, `polySynth(opts?)`, `oscillator(opts?)`, `noise(opts?)`, each `= wire(new Tone.X(opts))` returning `Sound<Tone.X, I, O>`; `Sound.copy(): Sound<N, I, O>` = `wire(new (node.constructor)(node.get()))`.

- [ ] **Step 1: Write the failing tests:**
  - for each shortcut: `t.synth({ oscillator: { type: 'sawtooth' } }).node instanceof Tone.Synth`, and so on.
  - `copies each shortcut class with equal settings`: for each, `expect(s.copy().node.get()).toEqual(s.node.get())`.
  - `a copy is unlinked`: cue `{ detune: 100 }` on the original only; the copy's `detune` stays at its base; `copy().node !== s.node`; the copy has no output connections (`numberOfOutputs` connections: assert by rendering the copy without connecting it and getting silence).

- [ ] **Step 2: Run** — expected FAIL (`synth` is not a function).

- [ ] **Step 3: Implement.** The shortcuts import Tone's classes from `tone` (a peer). A class whose `get()` copy fails the equality is fixed in `copy` or listed in the README (Task 5).

- [ ] **Step 4: Run** `npx vitest run packages/tone` — PASS.

- [ ] **Step 5: Commit** — `git commit -m "add synth, polySynth, oscillator and noise to blits-tone's driver, and copy() on a Sound"`

### Task 3: quarks — `wire`, `particles`, `Source`, `Emitter`, `burst`, `drop`

**Files:**
- Create: `packages/quarks/src/source.ts`
- Modify: `packages/quarks/src/drive.ts`, `packages/quarks/src/index.ts`
- Test: `packages/quarks/test/source.test.ts`

**Interfaces:**
- Produces:
  - `Driver<I>` gains `wire(system: ParticleSystem): Source<I>` and `particles(opts: ConstructorParameters<typeof ParticleSystem>[0]): Source<I>` = `wire(new ParticleSystem({ worldSpace: true, ...opts }))`.
  - `interface Source<I> { readonly system: ParticleSystem; at(position: AttachOptions['at']): Emitter<I>; copy(): Source<I>; drop(): void }`.
  - `interface Emitter<I> { readonly source: Source<I>; cue(spec: Omit<VoiceSpec<I, O>, 'subjects'>): Handle<I>; burst(n: number): void; drop(): void }` (O is the driver's).

- [ ] **Step 1: Write the failing tests** in `test/source.test.ts`, using `fixtures.ts`' `system()`, `hold()` and `born()` and `drive.test.ts`'s `run` loop:
  - `emits from two emitters on one source independently`: `src = q.wire(system())`, `e1 = src.at([1,0,0])` cued `hold({ rate: 10 })`, `e2 = src.at([0,2,0])` cued `hold({ rate: 20 })`; after `run(10, 100, …)`, 10 particles at x = 1 and 20 at y = 2, all in `src.system`.
  - `bursts n at the next write, at its own emitter only`: `e1.burst(5)` then one write → 5 particles at x = 1, none at y = 2; a second write adds none.
  - `burst floors and ignores n ≤ 0 or not finite`: `burst(2.7)` → 2; `burst(-1)`, `burst(NaN)` → 0.
  - `particles defaults worldSpace on`: `q.particles({ ...fields of system() without worldSpace })` does not throw and emits.
  - `drop on the last emitter puts the authored values back`: after cueing `hold({ rate: 10, speed: 2 })` and writing, `e1.drop()` → `(src.system.startSpeed as ConstantValue).value === 5`.
  - `drop on a source drops every emitter`: two emitters, `src.drop()`, write → no new particles; `m.atRest(e1)` is true.
  - throws: `cue` naming `subjects` (`/names its own subject/`); `cue` after `drop` (`/dropped/`); `wire({})` (`/not a ParticleSystem/`).

- [ ] **Step 2: Run** `npx vitest run packages/quarks/test/source.test.ts` — FAIL.

- [ ] **Step 3: Implement.** In `drive.ts`, `Bound` gains `extra: number`; `write` adds `b.extra` into `b.count` after the rate step, then zeroes it. `at` calls `attach(emitter, system, { at })`, with the emitter object as subject. `Emitter.drop` = `detach` + `mix.drop`. `Source.drop` drops each of its live emitters.

- [ ] **Step 4: Run** `npx vitest run packages/quarks` — PASS, the existing tests unchanged.

- [ ] **Step 5: Commit** — `git commit -m "wire a quarks system to a mix as a Source, with an Emitter per emission point"`

### Task 4: quarks — `Source.copy()`

**Files:**
- Modify: `packages/quarks/src/source.ts`
- Test: `packages/quarks/test/source.test.ts`

**Interfaces:**
- Consumes: Task 3's `Source`.
- Produces: `Source.copy(): Source<I>` = `wire(this.system.clone())`, with no emitters.

- [ ] **Step 1: Write the failing test** `copy is a new system with no emitters`: `c = src.copy()`; `c.system !== src.system`; after an emitter on `src` writes, `c.system.particleNum === 0`; an emitter on `c` cued `hold({ rate: 10 })` emits 10 into `c.system` and none into `src.system`; `(c.system.startSpeed as ConstantValue).value === 5`.

- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run packages/quarks` — PASS.
- [ ] **Step 5: Commit** — `git commit -m "copy a quarks Source as an unlinked clone of its system"`

### Task 5: READMEs, changelogs, handoff

**Files:**
- Modify: `packages/tone/README.md`, `packages/quarks/README.md`, `packages/tone/CHANGELOG.md`, `packages/quarks/CHANGELOG.md`, `HANDOFF.md`
- Delete: `docs/superpowers/specs/2026-10-18-companion-handles-design.md`, this plan

- [ ] **Step 1:** Each README opens with the handles: the spec's "Where the calls live" example and table, its rules for `cue`/`drop`/`copy`/`burst`, and (Tone) "Which Tone parameters a handle drives" with its rest table and the `frequency` warning. `drive`/`attach`/`detach` move under a `## Lower level` heading, unchanged. List any shortcut class whose copy is not exact (Task 2).
- [ ] **Step 2:** Each changelog: `## Unreleased` → `### Added`, one entry per call; Tone's also lists `kit` on `DriveOptions`.
- [ ] **Step 3:** `HANDOFF.md`: replace item 0 with one line saying the handles are built, unreleased, documented in each README. Delete the spec and this plan; the READMEs now carry them.
- [ ] **Step 4:** `npm run lint && npm run typecheck` — clean; `npx vitest run packages` — PASS.
- [ ] **Step 5: Commit** — `git commit -m "document blits-tone's Sound and blits-quarks' Source and Emitter, and retire their spec and plan"`
