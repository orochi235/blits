# Stress demos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status: unbuilt (2026-10-30).** Spec: `docs/superpowers/specs/2026-10-30-stress-demos-design.md`.

**Goal:** Seven realistic workloads in `apps/stress` that measure blits' speed and check its correctness, each runnable headless (Node, fleet) and viewable on a canvas.

**Architecture:** Each scenario is a DOM-free module built from a seed and a size, exposing `step`, `read`, `check`, and `stats`. A Node runner bundled by esbuild drives any scenario, printing progress and writing raw per-frame (or per-window) records; one vite page draws any scenario. Small-size vitests run each `check()` in the normal suite.

**Tech Stack:** TypeScript, blits `src/` via alias, vitest, esbuild, vite, `@weasel-js/history` (tape for `history`).

## Rules every task follows

- Import blits as `@msb235/blits` and the app's own modules as `@stress/...` (alias, never `../../`).
- Learn an API from `site/src/pages/*.mdx`, `site/src/pages/glossary.mdx` and `src/types/*.ts` before using it. Never import from `src/` internals; only what `src/index.ts` exports. If a scenario needs something blits does not export, do it in the scenario and record a `gap` finding — never reach into internals.
- No file past ~300 lines. No inline styles. US English. Sparse comments.
- Tests: run only the file you touched, `npx vitest run apps/stress/test/<file>`. Never `npm test`, `npm run check`, `npm run typecheck` or `tsc -b` (a hook refuses them on this machine). Typecheck the app alone with `npx tsc -p apps/stress/tsconfig.json --noEmit`.
- Lint touched files: `npx biome check apps/stress`.
- Commit at the end of each task with an imperative subject, ending with the attribution lines from the session.

## Files

| Path | Owns |
|---|---|
| `apps/stress/package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore` | App wiring |
| `apps/stress/src/scenario.ts` | `Scenario`, `Finding`, `Make` types and the registry type |
| `apps/stress/src/rng.ts` | Seeded RNG |
| `apps/stress/src/registry.ts` | name → `Make` |
| `apps/stress/src/run.ts` | Runner: args, progress, records, retention, cap |
| `apps/stress/src/digest.ts` | Medians/percentiles from a run's records |
| `apps/stress/scripts/stress.mjs` | Bundles `run.ts`/`digest.ts` with esbuild and runs them under `--expose-gc` |
| `apps/stress/src/main.ts`, `src/app.css` | The page: picker, canvas, readout |
| `apps/stress/src/scenarios/<name>/scenario.ts`, `view.ts` | One demo each |
| `apps/stress/test/<name>.test.ts` | Small-size `check()` per demo |
| `apps/stress/README.md` | What each demo loads and checks; how to run |
| root `package.json`, `vitest.config.ts` | `stress` script; test include and `@stress` alias |

---

### Task 1: App skeleton, scenario contract, RNG, runner

**Files:** everything in the first seven rows of the table, root `package.json`, `vitest.config.ts`, `apps/stress/test/runner.test.ts`.

- [ ] **Step 1: App wiring.** Create `apps/stress/package.json`:

```json
{
  "name": "@blits/stress",
  "private": true,
  "type": "module",
  "scripts": { "dev": "vite", "build": "vite build", "typecheck": "tsc -p tsconfig.json --noEmit" },
  "devDependencies": { "typescript": "~6.0.0", "vite": "^8.0.0" }
}
```

`tsconfig.json`: copy `apps/fireworks/tsconfig.json`, with `paths` `{"@stress/*": ["./src/*"], "@msb235/blits": ["../../src/index.ts"]}`, `"types": ["vite/client", "node"]`, `include: ["src", "test", "scripts", "vite.config.ts"]`.

`vite.config.ts`: as fireworks', aliases `@msb235/blits` → `../../src/index.ts` and `@stress` → `./src`, port `4885`, `host: '::'`, `strictPort: true`.

`.gitignore`: `runs/` and `.build/`.

Root `package.json` scripts: `"stress": "node apps/stress/scripts/stress.mjs"`. Root `vitest.config.ts`: add `'apps/stress/test/**/*.test.ts'` to `include` and alias `'@stress': fileURLToPath(new URL('./apps/stress/src', import.meta.url))`.

Run `npm install` once so the workspace links.

- [ ] **Step 2: Contract.** `apps/stress/src/scenario.ts`:

```ts
/** What a check found. `undecided` is behavior blits has not settled; `gap` is something the scenario had to do itself. */
export interface Finding {
  kind: 'fail' | 'undecided' | 'gap';
  /** Frame the finding was seen at, when it has one. */
  at?: number;
  what: string;
}

export interface Scenario {
  readonly name: string;
  /** Simulated ms per frame. */
  readonly frameMs: number;
  /** Numbers `read` writes. */
  readonly width: number;
  /** Feeds frame `f`'s workload, then syncs the mix to `f * frameMs`. Frames arrive in order from 0. */
  step(f: number): void;
  /** Reads every subject into `out`, `width` numbers. */
  read(out: Float64Array): void;
  /** Counts worth recording each window: voices, subjects, anything the demo cares about. */
  stats(): Record<string, number>;
  /** Runs after the frames have played; empty when all is right. */
  check(): Finding[];
  /** Draws the current state, scaled to the canvas. Only the page calls it. */
  draw?(ctx: CanvasRenderingContext2D, w: number, h: number): void;
  close(): void;
}

export interface MakeOptions {
  seed: number;
  /** Scales the workload; each demo says what 1 unit means. */
  size: number;
  /** `false` runs the general path, as `BLITS_LANES=off` does. */
  lanes?: boolean;
}

export type Make = (opts: MakeOptions) => Scenario;

export interface Entry {
  make: Make;
  /** Size and frames the page and a plain run use. */
  size: number;
  frames: number;
  /** One line for the picker and the README. */
  blurb: string;
}
```

`draw` lives on the scenario rather than a separate `view.ts` when the drawing is under ~40 lines; otherwise `view.ts` exports `draw(s, ctx, w, h)` and the scenario's `draw` calls it. (This replaces the spec's always-separate `view.ts`; the spec is updated in Task 9.)

- [ ] **Step 3: RNG.** `apps/stress/src/rng.ts`, mulberry32:

```ts
export interface Rng {
  /** [0, 1) */
  next(): number;
  /** Integer in [0, n) */
  int(n: number): number;
  pick<T>(xs: readonly T[]): T;
}

export function rng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n) => Math.floor(next() * n),
    pick: (xs) => xs[Math.floor(next() * xs.length)] as (typeof xs)[number],
  };
}
```

- [ ] **Step 4: Registry.** `apps/stress/src/registry.ts` exports `const scenarios: Record<string, Entry> = {}`; each later task adds its line. Add a trivial `idle` entry for the runner test: a scenario with one subject, one `keys` voice over 1000 ms looping on `kit({ x: sum() })`, `check()` returning `[]`.

- [ ] **Step 5: Runner test (fails first).** `apps/stress/test/runner.test.ts`:

```ts
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { run } from '@stress/run';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'stress-')); dirs.push(d); return d; };

test('writes a header, one record per frame, and findings', async () => {
  const root = scratch();
  const out = await run({ name: 'idle', size: 1, frames: 30, seed: 1, root, quiet: true });
  const lines = readFileSync(join(out, 'frames.jsonl'), 'utf8').trim().split('\n');
  expect(JSON.parse(lines[0] as string).header.name).toBe('idle');
  expect(lines).toHaveLength(31);
  expect(JSON.parse(readFileSync(join(out, 'findings.json'), 'utf8'))).toEqual([]);
});

test('windows aggregate frames', async () => {
  const root = scratch();
  const out = await run({ name: 'idle', size: 1, frames: 30, seed: 1, root, window: 10, quiet: true });
  const lines = readFileSync(join(out, 'frames.jsonl'), 'utf8').trim().split('\n');
  expect(lines).toHaveLength(4);
  expect(JSON.parse(lines[1] as string)).toMatchObject({ from: 0, to: 9 });
});

test('keeps the newest five runs of a scenario', async () => {
  const root = scratch();
  for (let s = 1; s <= 7; s++) await run({ name: 'idle', size: 1, frames: 2, seed: s, root, quiet: true });
  expect(readdirSync(root).filter((d) => d.endsWith('-idle-' + d.split('-').pop()))).toHaveLength(5);
});
```

Run `npx vitest run apps/stress/test/runner.test.ts` — expect FAIL (no `@stress/run`).

- [ ] **Step 6: Runner.** `apps/stress/src/run.ts` exports:

```ts
export interface RunOptions {
  name: string; size: number; frames: number; seed: number;
  /** Directory runs land in; default `apps/stress/runs`. */
  root?: string;
  /** Aggregate this many frames into one record (the soak). */
  window?: number;
  lanes?: boolean;
  quiet?: boolean;
}
export async function run(o: RunOptions): Promise<string>; // returns the run directory
```

Behavior:
1. Prune: list `root`, keep the newest 4 directories ending in `-<name>-<seed>` pattern for this scenario (match `/-${name}-\d+$/`), by mtime; delete the rest (so with the new one, 5 remain).
2. Directory `root/<YYYY-MM-DD>-<HHMMSS>-<name>-<seed>`. (Time in the name so two runs of one seed do not collide.)
3. First line of `frames.jsonl`: `{"header": {name, size, frames, seed, lanes, window, host: os.hostname(), cpus, load: os.loadavg(), node: process.version, rev: <git rev-parse HEAD or null>, dirty: <bool>, started: ISO}}`.
4. Per frame: time `step(f)` and `read(buf)` separately with `performance.now()`. Without `window`: write `{"f", "step", "read"}` (ms, 4 decimals). With `window`: collect, and every `window` frames write `{from, to, stepP50, stepP99, stepMax, readP50, readMax, heap: process.memoryUsage().heapUsed, ...s.stats()}`.
5. Every 2% of frames (at least every 1000), unless `quiet`, print `frame 1200/6000  step p50 0.21 ms` to stderr.
6. Stop writing records past 50 MB (track bytes written); print one line saying so; keep running so the check still runs.
7. After the frames: `check()` → `findings.json`; print each finding; `close()`.
8. Use `fs.createWriteStream` and await `finish`.

Also a CLI `main(argv)` in `run.ts` that parses `<name> --size --frames --seed --window --lanes off --root`, defaults from the registry entry, prints the run directory, and exits 1 when any finding is `fail`.

Run the test — expect PASS.

- [ ] **Step 7: Digest.** `apps/stress/src/digest.ts` `digest(dir)` reads `frames.jsonl` and prints, with decimal-aligned `%7.3f` columns: count, step p50/p90/p99/max, read p50/max (per-frame records) or the window columns' medians and the first/last `heap` (window records). CLI `digest <dir>`.

- [ ] **Step 8: Launcher.** `apps/stress/scripts/stress.mjs`: `esbuild.build({ entryPoints: ['apps/stress/src/cli.ts'], bundle: true, platform: 'node', format: 'esm', outfile: 'apps/stress/.build/cli.mjs', alias: { '@msb235/blits': './src/index.ts', '@stress': './apps/stress/src' }, external: ['@weasel-js/history'] })`, then `spawn(process.execPath, ['--expose-gc', 'apps/stress/.build/cli.mjs', ...process.argv.slice(2)], { stdio: 'inherit' })` and exit with its code. `src/cli.ts`: `digest <dir>` → digest; otherwise `main(argv)`.

Check: `npm run stress -- idle --frames 300` prints a run dir; `npm run stress -- digest <that dir>` prints a table.

- [ ] **Step 9: Typecheck, lint, commit** — "add apps/stress with a scenario contract, seeded RNG, and a runner".

---

Every scenario task below has the same steps: **(1)** write `apps/stress/test/<name>.test.ts` (below), run, see it fail; **(2)** write the scenario; **(3)** run the test until it passes; **(4)** register it in `registry.ts` with the given defaults; **(5)** `npm run stress -- <name> --frames <defaults>` locally only if the default run takes under ~10 s (time `--frames 300` first and multiply); **(6)** typecheck, lint, commit "add the <name> stress demo".

Every test file has this shape, plus the demo's own assertions:

```ts
import { expect, test } from 'vitest';
import { scenarios } from '@stress/registry';

const play = (name: string, size: number, frames: number, seed = 1, lanes?: boolean) => {
  const s = scenarios[name]!.make({ seed, size, lanes });
  const buf = new Float64Array(s.width);
  const trace: number[][] = [];
  for (let f = 0; f < frames; f++) { s.step(f); s.read(buf); trace.push(Array.from(buf)); }
  return { s, trace };
};
```

A scenario's own `check()` holds the correctness logic; tests assert `check()` finds no `fail` at a small size, plus the demo-specific assertions listed.

### Task 2: Market heatmap (`heatmap`)

Size 1 = 1,000 cells. Defaults: size 5, frames 3600, frameMs 16.67.

- Kit `{ value: sum(), heat: ink() }` (`ink` path is new in 0.16; read `site/src/pages/channel.mdx`). Each cell is a subject `{ i }`.
- One `spring<Cell, Pose>('value', { from: 0, to: (c) => target[c.i] })` voice over all cells. Read `src/types/motion.ts` and `test/comeback.test.ts` for how a spring is retargeted per subject (`handle.to(subject, value)`).
- A seeded tick stream: each frame, `ticks = round(size * 1000 * rate * frameMs / 1000)` ticks where rate cycles 20–60 Hz per cell over 10 s; each tick picks a cell and a new target (`target += (rng.next() - 0.5) * 10`), calls `to`.
- `heat`: an `ink` voice per alert band, weights from a `level` signal per band, so heat blends round the hue.
- `read`: `pull` into columns (read `Columns` in `src/types/mix.ts`) when lanes are on; write `value` per cell then the 4 heat numbers.
- `stats`: `{ voices: m.voices().length, retargets }`.
- `check()`: after the last tick, stop ticking for 3 s of extra frames (run them inside `check`), then every cell's `value` within 1e-3 of its last target. **Lanes agree:** build a second instance with `lanes: false` and the same seed, play both the same frames, compare `read` output bit for bit (`Object.is` per number); a mismatch is `fail` naming the frame and cell.
- Test extra: `play('heatmap', 0.1, 300)` → `check()` has no `fail`.

### Task 3: Live feed (`feed`)

Size 1 = 100 items/s arriving. Defaults: size 1, frames 3600.

- Items `{ id, score }`; the visible list holds up to 500. Each frame, arrivals by Poisson-ish (`rng`) at `size * 100` per s; departures to keep the list near 400 after warm-up. Each arrival cues an entrance (`keys` 300 ms on `{ y: sum(), alpha: mul() }`, `freeze: 'after'`, fade out on departure: `handle.fade({ over: 200 })` then `m.drop(item)` once `done` resolves).
- Every 3 s, re-sort the list by `score` (scores drift by rng) or apply a filter that hides a seeded third; positions retarget with a `glide` on `y` (read `glide` in `src/types/motion.ts`).
- `read`: `m.pull(list, columns)`; width = 500 × 2, unused rows NaN.
- `stats`: `{ voices: m.voices().length, items: list.length, pending: unresolved done count }`.
- `check()`: (a) voices never exceeded `items * 3 + 10` at any window (track max in `step`); (b) every departed item's `done` resolved exactly once (count via `.then`, after an extra 1 s of frames and `await`-free check: count resolutions by a microtask flush — `check` is sync, so record resolution counts in `step` and allow 60 frames grace); (c) a departed, dropped item probes `alpha` 0 or its rest; `fail` otherwise.
- Test extra: size 0.5, 600 frames → no `fail`; `stats().voices` at the end under 1,500.

### Task 4: Video timeline (`timeline`)

Size 1 = 300 clips. Defaults: size 1, frames 2400.

- Mix with `history: { ms: 60_000, tape }` (`import { createHistory as tape } from '@weasel-js/history'`, as `test/arc.test.ts:321`). Kit `{ x: sum(), opacity: mul(), tint: color() }`. Each clip is one subject (a layer).
- 10 sequences, each a `span` (read `site/src/pages/score.mdx`), each holding 3 nested spans of 10 clips; clips are `keys` voices with `owner`.
- A seeded "editor" script, one action every 30–90 frames: `seek(t)` anywhere in [0, end], set `m.rate` to one of −2, −1, −0.5, 0.5, 1, 2, 4, or `ramp`. The script is generated once from the seed into an array of `{ frame, op }`, so a fresh mix can replay a prefix.
- `check()`: at 20 seeded checkpoint frames, compare the live `read` captured during play against a fresh mix built the same way that is played forward at rate 1 from 0 to the checkpoint's mix time `now` and read there. Numbers within 1e-6 → fine. A mismatch where any clip's owner chain ran backward in the 2 s before is `undecided` (HANDOFF: a child under a backward owner is undecided); otherwise `fail`. A `HistoryMiss` thrown by a seek is `fail` unless the target is older than 60 s of mix time.
- Test extra: size 0.1, 400 frames → no `fail`.

### Task 5: Cue stack (`cues`)

Size 1 = 500 cues over 48 fixtures. Defaults: size 1, frames 7200.

- Fixtures `{ i }`, kit `{ level: max(), hue: sum() }`. A cue = set of fixture levels + fade-in ms + optional follow (auto-GO after its fade + delay). Cue voices are `keys` from the fixture's previous level to the cue's level; follow cues are placed with `anchor: { start: { of: <prev name>, mark: 'end', by: delay } }` (read `Placement` in `src/types/place.ts`; check the mark names in `site/src/pages/score.mdx`).
- An operator script from the seed: GO mostly, BACK (fades the last cue out and re-cues the one before) 1 in 10, GO pressed mid-fade 1 in 5.
- 4 manual faders as `level()` signals weighting a "manual" voice per fader group; the script moves them.
- **Model** (`apps/stress/src/scenarios/cues/model.ts`, independent of blits): replays the same operator script with plain arithmetic: each fixture's level = max over active cues of its linear-faded contribution, and max with fader × fader-group level. Same semantics as the blits kit: `max` channel = highest takes precedence; GO mid-fade starts the next cue's fade from the live level.
- `check()`: at every 10th frame recorded during play, blits' `level` per fixture within 1e-6 of the model. Report the first mismatching frame per fixture as `fail` with both numbers. If the model and blits disagree because the model's semantics guess differs from blits' documented behavior, fix the model and say why in a one-line comment.
- Test extra: size 0.1, 1200 frames → no `fail`.

### Task 6: Kiosk soak (`kiosk`)

Size 1 = 1 simulated hour. Defaults: size 72, window 3600 (one simulated minute at 60 fps); frames computed as `size * 216_000`.

- 2,000 subjects (an LED wall). Three looping patterns (`keys` loops of 4 s, 7 s, 11 s on `{ gain: mul(), color: color() }`) crossfading via `role` every 5 simulated minutes; a burst voice every 20 s; `m.rebase()` once per simulated hour with a fake 30-minute gap (a timestamp jump) to mimic a sleeping kiosk.
- The clock is synthetic: `step(f)` syncs to `f * frameMs + gaps`, where `gaps` is the total fake sleep so far, so `rebase` is exercised.
- `stats`: `{ voices, live: m.live ? 1 : 0, now: m.now }`.
- `check()`: (a) build a fresh mix, cue the same loops started at the same mix `now` modulo each loop's period, read; the live read at the last frame matches within 1e-6 (drift test); (b) voices at the last window ≤ voices at the first window after warm-up + 2 (no growth); (c) stop everything (`m.mute({ over: 0 })` then step 60 more frames): `m.live` is false.
- Run budget: time `--size 0.167` (10 min) first and print the extrapolated wall time for size 72 in the commit body.
- Test extra: size 0.05 (3 min), window 3600 → no `fail`.

### Task 7: Character rig (`rig`)

Size 1 = 10 characters. Defaults: size 5, frames 3600.

- Each bone a subject `{ char, bone }`. Kit `{ rot: quat(), pos: vec(3, sum()) }` (read `src/rotation.ts`).
- Clips: `walk`, `run`, `idle`, each a `keys` voice per character over its 20 bones, quats from a seeded per-bone axis and angle curve. Crossfade walk→run over 400 ms by fading one and rising the other, weights from a `level` per character.
- IK hold: on bones 12–14 (one arm) of each character, a hold that should override `rot` on those bones **and only the y component of `pos`**. Try it the blits way first (a voice with `target` on those bones and a weight). Where blits cannot weight some components of a `vec` and not others, apply that part in the scenario after `probe` and record a `gap` finding once: "a voice's weight cannot cover some components of a vec(3) and not others; the rig applies the IK y-hold itself". If the quat blend of more than two clips at once does not match the normalized weighted quat average (see below), that is a `fail`, not a gap.
- `check()`: at 30 seeded frames, recompute each bone's expected `rot` by hand: normalized weighted sum of the clip quats (sign-aligned to the first), and compare to blits within 1e-4 (dot product ≥ 1 − 1e-6). Mismatch → `fail` with bone and frame.
- `stats`: `{ voices, gaps: number of gap findings }`.
- Test extra: size 0.2, 300 frames → no `fail`; findings include at least one `gap` (if blits turns out able to say it, delete this assertion and say so in the commit body).

### Task 8: Slide deck (`deck`)

Size 1 = 40 slides. Defaults: size 1, frames 3600.

- Slides are spans; each holds 2–6 builds (`keys` voices on `{ x: sum(), opacity: mul() }`) placed by `anchor` one after another; subjects are the build elements (one per build).
- Mix with `history: { ms: 600_000, tape }`.
- A seeded presenter script: next (70%), back (15%), jump to a seeded slide (5%), next pressed mid-build (10%). Navigation is `seek` to the target slide/build's start mark (read `marks` in `src/types/mix.ts`).
- `check()`: after each action, record `read` once the deck settles (when the action's build finishes); a fresh deck that seeks straight to the same slide and build reads the same within 1e-6 → else `fail`. Every build's `done` resolves at most once (count with `.then` in a map keyed by handle id; checked after 60 frames of grace) → else `fail`.
- Test extra: size 0.25, 900 frames → no `fail`.

### Task 9: The page

**Files:** `apps/stress/index.html`, `src/main.ts`, `src/app.css`, root script `"stress:dev": "npm run dev -w @blits/stress"`.

- `html`, `body`, `#root`: `height: 100%; margin: 0; overflow: hidden`. A header row: `<select>` of the registry, a seed input, a size input, a restart button, and a readout last in the row, `min-width: 18ch`, `font-variant-numeric: tabular-nums`, showing `frame 1234  step 0.21 ms`.
- A canvas, height `min(400px, 60vh)`, width the column. `requestAnimationFrame` loop: `step(f++)`, time it, `draw(ctx, w, h)`; scenarios without `draw` fill a grid of `read` values as gray levels.
- Every scenario gets a `draw` in its folder (`view.ts` if over ~40 lines): heatmap a grid colored by heat, feed bars at `y`, timeline layer rows, cues a fixture strip, kiosk the LED wall, rig stick figures (pos only, x/y), deck the current slide's builds.
- Check headless with the playwright MCP: load `http://localhost:4885`, pick each scenario, screenshot; `scrollTo(0, 5000)` leaves `scrollY` 0; post each screenshot with `transom post`.
- Update the spec's Shape table (`draw` on the scenario, `view.ts` only when long). Commit "add the stress page".

### Task 10: Fleet runs, findings, docs

- [ ] `onto test` the repo once (the suite now includes `apps/stress/test`) — background, read the exit code when done.
- [ ] Estimate each large run (items × measured ms, from the local short runs), then on the fleet with `--kind bench`: every scenario at its defaults, `heatmap` also at `--size 50` and `--lanes off`, `kiosk` at size 72. Copy each run's `frames.jsonl` header + digest into `bench/runs/2026-10-30-stress-<name>.txt` (the raw `frames.jsonl` too when under 5 MB).
- [ ] Each `fail` → a failing test in `test/` that reproduces it at the smallest size, recorded in HANDOFF under a new "Stress demos" item (not fixed in this plan). Each `undecided` → appended to HANDOFF's undecided list. Each `gap` → HANDOFF, and `NOTES-FROM-WEASEL.md` where weasel hit the same one.
- [ ] `apps/stress/README.md`: what each demo loads and checks (the spec's table, updated), how to run, where runs go and their bound. Add `apps/stress` to the root README's list of apps if it has one, and `~/src/PROJECTS.md` is not affected (same project).
- [ ] Delete the spec and this plan (their content now lives in the README and HANDOFF). Commit "document the stress demos and record what they found, retiring their spec and plan".
