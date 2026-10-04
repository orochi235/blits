# blits playground Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser app inside the blits repo where you compose voices on a score, watch them play
on a stage of dots or letters, and inspect how each channel folds.

**Architecture:** A composition is plain data (`Composition`). A pure `compile` turns it into a
blits mix (plus one solo mix per voice for the inspector); a `Player` drives those mixes in fixed
1000/60 ms frames, replaying from zero to scrub back. React panels edit the composition; generic
widgets under `src/widgets/` know nothing of blits and carry forge stories so they can move to
weasel later.

**Tech Stack:** Vite 8, React 19, `@vitejs/plugin-react` 6, `@weasel-js/labkit`/`ui`/`core`/
`theme`/`forge` 1.7.3, vitest 4 (node environment, pure modules only), Playwright 1.63 for the
smoke run, biome.

**Spec:** `docs/superpowers/specs/2026-10-03-playground-design.md` — read it first.

## Global Constraints

- App at `apps/playground`, package name `@blits/playground`, `private: true`.
- `@weasel-js/*` pinned to exactly `1.7.3`; React `^19.3.0`; Vite `^8`; Playwright `1.63.0`.
- Dev server: port `4881`, `server.host: '::'`, `strictPort: true`.
- blits is imported as `@msb235/blits`, aliased to the repo's `src/index.ts` (Vite and vitest),
  never the built `dist`.
- App code imports its own modules through the `@pg/*` alias (`apps/playground/src/*`), never
  `../../`. Widgets in `src/widgets/` import nothing from `@msb235/blits` or `@pg/blits`.
- Every widget ships a `*.stories.tsx` in forge CSF (`Meta`/`StoryObj` from `@weasel-js/forge`).
- No inline `style=` props except where a story harness needs a fixed size; CSS modules otherwise.
- No `!important`. US English. Comments sparse, 1–2 lines, only what the code cannot say.
- The composition types are named `Composition`, `Voice`, `PatchSource`, `Expr` in
  `src/blits/composition.ts`; blits' own `Voice`-like types are aliased on import where both meet.
- The kit (spec, "The kit"): `offset: vec(2, sum())`, `turn: sum()`, `scale: mul()`,
  `color: hex()`, `opacity: mul({ bounds: [0, 1] })`, `glow: max()`.
- Mixes are built with `stepMs: 1000 / 60`; the player advances in whole 1000/60 ms frames and
  `pull`s every subject every frame, live or replaying, so both give the same poses.
- Nothing is written to disk at run time; the smoke run's screenshots go to a temp dir removed on exit.
- Commits: imperative, lowercase, terse, ending with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **An expression that throws on some subjects only** (`(s) => s.col.foo.bar`) — the stage keeps
   drawing, the throwing calls rest, and the field shows the first message. Test in Task 3.
2. **Scrubbing back over a stateful voice** (a spring, a `slew` weight) lands on exactly the pose
   continuous playback showed at that time. Test in Task 5.
3. **A voice anchored to a voice that is deleted or renamed** — compile still returns, the anchored
   voice waits pending, and nothing throws. Test in Task 4.
4. **Dragging a clip's right edge on a voice with `period: 0`** (an aperiodic `fn` or a motion
   voice) — there are no passes to snap to; the edge does not move and no `loop` is written. Test in
   Task 7.
5. **A composition loaded from an old or hand-edited URL hash** with a missing field or wrong
   `version` — the app falls back to the default preset instead of a blank page. Test in Task 13.

---

## File structure

```
apps/playground/
  package.json  vite.config.ts  tsconfig.json  index.html  README.md
  scripts/docs.mjs              typedoc → src/generated/docs.json (gitignored)
  scripts/smoke.mjs             headless run of every preset
  src/main.tsx
  src/widgets/                  generic; no blits
    ScoreLanes/  geometry.ts drag.ts ScoreLanes.tsx ScoreLanes.module.css ScoreLanes.stories.tsx index.ts
    ExprInput/   ExprInput.tsx ExprInput.module.css ExprInput.stories.tsx index.ts
    CodePane/    CodePane.tsx CodePane.module.css CodePane.stories.tsx index.ts
    ChannelPlot/ path.ts ChannelPlot.tsx ChannelPlot.module.css ChannelPlot.stories.tsx index.ts
  src/blits/
    composition.ts  kit.ts  stage.ts  expr.ts  compile.ts  player.ts
    easing.ts  keys.ts  score.ts  presets/index.ts  presets/*.ts
    stages/draw.ts  stages/Stage.tsx  stages/Stage.module.css
  src/app/
    App.tsx  App.module.css  Transport.tsx  VoicePanel.tsx  PatchPanel.tsx
    WeightField.tsx  Inspector.tsx  useComposition.ts  docs.ts
  test/                         vitest, node, pure modules only
    stage.test.ts expr.test.ts compile.test.ts player.test.ts keys.test.ts
    geometry.test.ts drag.test.ts score.test.ts path.test.ts load.test.ts presets.test.ts
```

---

### Task 1: Scaffold the workspace

**Files:**
- Create: `apps/playground/package.json`, `apps/playground/vite.config.ts`,
  `apps/playground/tsconfig.json`, `apps/playground/index.html`, `apps/playground/src/main.tsx`,
  `apps/playground/src/app/App.tsx`, `apps/playground/.gitignore`
- Modify: `package.json` (root: `workspaces`, scripts), `vitest.config.ts` (root: include)

**Interfaces:**
- Produces: `npm run dev -w @blits/playground` serving on 4881; the `@pg/*` and `@msb235/blits`
  aliases; root `vitest` picking up `apps/playground/test/**/*.test.ts`.

- [ ] **Step 1: Write `apps/playground/package.json`**

```json
{
  "name": "@blits/playground",
  "private": true,
  "type": "module",
  "scripts": {
    "docs": "node scripts/docs.mjs",
    "dev": "npm run docs && vite",
    "build": "npm run docs && vite build",
    "stories": "weaselforge dev --config vite.config.ts",
    "smoke": "npm run build && node scripts/smoke.mjs",
    "typecheck": "npm run docs && tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@weasel-js/core": "1.7.3",
    "@weasel-js/labkit": "1.7.3",
    "@weasel-js/theme": "1.7.3",
    "@weasel-js/ui": "1.7.3",
    "react": "^19.3.0",
    "react-dom": "^19.3.0"
  },
  "devDependencies": {
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@vitejs/plugin-react": "^6.0.0",
    "@weasel-js/forge": "1.7.3",
    "playwright": "1.63.0",
    "typedoc": "^0.28.20",
    "typescript": "~6.0.0",
    "vite": "^8.0.0"
  }
}
```

- [ ] **Step 2: Write `apps/playground/vite.config.ts`**

```ts
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { forge } from '@weasel-js/forge/vite';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

const at = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const stories = process.argv.some((a) => a.includes('weaselforge'));

export default defineConfig({
  base: './',
  plugins: [react(), ...(stories ? forge({ stories: ['src/widgets/**/*.stories.tsx'] }) : [])],
  resolve: {
    alias: {
      // Develop against the engine's source; the published package ships dist.
      '@msb235/blits': at('../../src/index.ts'),
      '@pg': at('./src'),
    },
  },
  server: {
    host: '::',
    port: 4881,
    strictPort: true,
    fs: { allow: [searchForWorkspaceRoot(process.cwd())] },
  },
});
```

- [ ] **Step 3: Write `apps/playground/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "paths": {
      "@pg/*": ["./src/*"],
      "@msb235/blits": ["../../src/index.ts"]
    }
  },
  "include": ["src", "test", "vite.config.ts"]
}
```

- [ ] **Step 4: Write `index.html`, `src/main.tsx`, `src/app/App.tsx`, `.gitignore`**

`apps/playground/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>blits playground</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/playground/src/main.tsx`:
```tsx
import '@weasel-js/labkit/styles.css';
import { App } from '@pg/app/App';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`apps/playground/src/app/App.tsx` (replaced in Task 12):
```tsx
import { LabShell } from '@weasel-js/labkit';

export function App() {
  return (
    <LabShell title="blits playground" mode="dark">
      <p>playground</p>
    </LabShell>
  );
}
```

`apps/playground/.gitignore`:
```
dist
src/generated
```

- [ ] **Step 5: Wire the root**

In root `package.json`: `"workspaces": ["site", "packages/*", "apps/*"]`, and add scripts:
```json
"playground": "npm run dev -w @blits/playground",
"playground:smoke": "npm run smoke -w @blits/playground",
```
and change `"typecheck"` to append ` && npm run typecheck -w @blits/playground`.

In root `vitest.config.ts`, set
`include: ['test/**/*.test.ts', 'packages/*/test/**/*.test.ts', 'apps/playground/test/**/*.test.ts']`
and add `'@pg': fileURLToPath(new URL('./apps/playground/src', import.meta.url))` to `alias`.

Create `apps/playground/scripts/docs.mjs` now as a stub that writes `{}` so `dev`/`typecheck`
run (Task 15 fills it):
```js
import { mkdirSync, writeFileSync } from 'node:fs';
const out = new URL('../src/generated/', import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL('docs.json', out), '{}\n');
```

- [ ] **Step 6: Install and verify**

Run: `npm install` (root). Then `npm run build -w @blits/playground`.
Expected: build succeeds, `apps/playground/dist/index.html` exists.
Run the dev server in the background (`npm run playground`), then
`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4881/ ; curl -s -o /dev/null -w '%{http_code}' 'http://[::1]:4881/'`.
Expected: `200200`. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts apps/playground
git commit -m "scaffold the playground app on labkit"
```

---

### Task 2: The composition, the kit and the subjects

**Files:**
- Create: `apps/playground/src/blits/composition.ts`, `src/blits/kit.ts`, `src/blits/stage.ts`
- Test: `apps/playground/test/stage.test.ts`

**Interfaces:**
- Produces:
  - `Composition`, `Voice`, `PatchSource`, `Expr`, `Level`, `StageSpec`, `ChannelName` (types)
  - `KIT: Kit<Pose>`, `Pose`, `CHANNELS: readonly ChannelName[]`, `REST: Pose`
  - `Subject { index; row; col; x; y; char }`, `subjectsOf(stage: StageSpec): Subject[]`

- [ ] **Step 1: Write the failing test** — `apps/playground/test/stage.test.ts`

```ts
import { CHANNELS, KIT } from '@pg/blits/kit';
import { subjectsOf } from '@pg/blits/stage';
import { describe, expect, it } from 'vitest';

describe('subjectsOf', () => {
  it('lays dots out row by row, x and y in 0..1', () => {
    const s = subjectsOf({ kind: 'dots', cols: 3, rows: 2 });
    expect(s.length).toBe(6);
    expect(s[4]).toEqual({ index: 4, row: 1, col: 1, x: 0.5, y: 1, char: '' });
  });
  it('makes one subject per letter, spaces included', () => {
    const s = subjectsOf({ kind: 'letters', text: 'a b' });
    expect(s.map((x) => x.char)).toEqual(['a', ' ', 'b']);
    expect(s[2]).toMatchObject({ index: 2, row: 0, col: 2, x: 1, y: 0 });
  });
  it('a single column or row sits at 0', () => {
    expect(subjectsOf({ kind: 'dots', cols: 1, rows: 1 })[0]).toMatchObject({ x: 0, y: 0 });
  });
});

describe('the kit', () => {
  it('has the six channels in drawing order', () => {
    expect(CHANNELS).toEqual(['offset', 'turn', 'scale', 'color', 'opacity', 'glow']);
    expect(Object.keys(KIT).sort()).toEqual([...CHANNELS].sort());
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run apps/playground/test/stage.test.ts`. Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

`src/blits/kit.ts`:
```ts
import { hex, type Kit, kit, max, mul, sum, vec } from '@msb235/blits';

export interface Pose {
  offset: number[];
  turn: number;
  scale: number;
  color: number;
  opacity: number;
  glow: number;
}

export type ChannelName = keyof Pose;

export const CHANNELS: readonly ChannelName[] = ['offset', 'turn', 'scale', 'color', 'opacity', 'glow'];

export const KIT: Kit<Pose> = kit<Pose>({
  offset: vec(2, sum()),
  turn: sum(),
  scale: mul(),
  color: hex(),
  opacity: mul({ bounds: [0, 1] }),
  glow: max(),
});
```

`src/blits/composition.ts`:
```ts
import type { Easing, Keyframe, Placement } from '@msb235/blits';
import type { ChannelName, Pose } from './kit';

/** Source of a function: `(s) => …` for a subject, a signal such as `slew(level('x'), …)`. */
export interface Expr {
  code: string;
}

export interface Level {
  name: string;
  value: number;
  min: number;
  max: number;
}

export type StageSpec = { kind: 'dots'; cols: number; rows: number } | { kind: 'letters'; text: string };

export type PatchSource =
  | { kind: 'keys'; period: number; stops: Keyframe<Pose>[]; ease?: Easing }
  | { kind: 'fn'; period: number; writes: ChannelName[]; at: string; state?: string; step?: string }
  | {
      kind: 'spring' | 'glide' | 'tween';
      channel: ChannelName;
      opts: Record<string, number | number[] | Expr>;
    };

export interface Voice {
  id: string;
  name: string;
  hue: number;
  patch: PatchSource;
  start: number;
  rate: number;
  loop: boolean | number;
  stagger?: Expr;
  target?: Expr;
  hold?: 'before' | 'after' | 'both';
  weight: number | Expr;
  fade: { in?: number; out?: number; ease?: Easing };
  locus?: string;
  from?: 'current';
  anchor?: Placement;
}

export interface Composition {
  version: 1;
  title: string;
  stage: StageSpec;
  length: number;
  levels: Level[];
  voices: Voice[];
}

export const isExpr = (v: unknown): v is Expr =>
  typeof v === 'object' && v !== null && typeof (v as Expr).code === 'string';
```

`src/blits/stage.ts`:
```ts
import type { StageSpec } from './composition';

export interface Subject {
  index: number;
  row: number;
  col: number;
  x: number;
  y: number;
  char: string;
}

const unit = (i: number, n: number) => (n > 1 ? i / (n - 1) : 0);

export function subjectsOf(stage: StageSpec): Subject[] {
  if (stage.kind === 'letters') {
    const chars = [...stage.text];
    return chars.map((char, i) => ({ index: i, row: 0, col: i, x: unit(i, chars.length), y: 0, char }));
  }
  const out: Subject[] = [];
  for (let row = 0; row < stage.rows; row++)
    for (let col = 0; col < stage.cols; col++)
      out.push({
        index: out.length,
        row,
        col,
        x: unit(col, stage.cols),
        y: unit(row, stage.rows),
        char: '',
      });
  return out;
}
```

- [ ] **Step 4: Run it** — same command. Expected: PASS (4 tests).
- [ ] **Step 5: Commit** — `git add apps/playground && git commit -m "add the playground's composition types, kit and subjects"`

---

### Task 3: Expressions

**Files:**
- Create: `apps/playground/src/blits/expr.ts`
- Test: `apps/playground/test/expr.test.ts`

**Interfaces:**
- Consumes: `Expr` (Task 2); `slew`, `lag`, `peak`, `gate`, `level`, `Signal` from `@msb235/blits`.
- Produces:
  - `interface Faults { count: number; first: string | null }`
  - `interface Scope { level(name: string): Signal<Subject> }`
  - `compileExpr<F extends (...a: never[]) => unknown>(expr: Expr, scope: Scope, fallback: ReturnType<F>): { fn: F; faults: Faults } | { error: string; line: number | null }`

The code evaluates once, in strict mode, with `slew`, `lag`, `peak`, `gate` and `level` in scope; it
must produce a function. That function is wrapped so a throw returns `fallback` and is counted.

- [ ] **Step 1: Write the failing test** — `apps/playground/test/expr.test.ts`

```ts
import { compileExpr } from '@pg/blits/expr';
import { level } from '@msb235/blits';
import { describe, expect, it } from 'vitest';

const scope = { level: () => level() };

describe('compileExpr', () => {
  it('compiles an arrow function of the subject', () => {
    const r = compileExpr<(s: { col: number }) => number>({ code: '(s) => s.col * 80' }, scope, 0);
    if ('error' in r) throw new Error(r.error);
    expect(r.fn({ col: 2 })).toBe(160);
  });

  it('reports a syntax error with no function', () => {
    const r = compileExpr({ code: '(s) => s.col *' }, scope, 0);
    expect('error' in r && r.error.length > 0).toBe(true);
  });

  it('reports code that is not a function', () => {
    const r = compileExpr({ code: '42' }, scope, 0);
    expect(r).toEqual({ error: 'must be a function', line: null });
  });

  it('rests a call that throws, counts it, and keeps the first message', () => {
    const r = compileExpr<(s: { col: number }) => number>(
      { code: '(s) => { if (s.col > 0) throw new Error("boom " + s.col); return 1; }' },
      scope,
      0,
    );
    if ('error' in r) throw new Error(r.error);
    expect(r.fn({ col: 0 })).toBe(1);
    expect(r.fn({ col: 1 })).toBe(0);
    expect(r.fn({ col: 2 })).toBe(0);
    expect(r.faults).toEqual({ count: 2, first: 'boom 1' });
  });

  it('has the signal makers and level in scope', () => {
    const r = compileExpr({ code: 'slew(level("mouse"), { riseMs: 100 })' }, scope, 0);
    if ('error' in r) throw new Error(r.error);
    expect(typeof r.fn).toBe('function');
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run apps/playground/test/expr.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** — `src/blits/expr.ts`

```ts
import { gate, lag, peak, type Signal, slew } from '@msb235/blits';
import type { Expr } from './composition';
import type { Subject } from './stage';

export interface Faults {
  count: number;
  first: string | null;
}

export interface Scope {
  level(name: string): Signal<Subject>;
}

export type Compiled<F> = { fn: F; faults: Faults } | { error: string; line: number | null };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The line `new Function` reports, less the two it adds above the author's code. */
function lineOf(err: unknown): number | null {
  const at = err instanceof Error ? /<anonymous>:(\d+):\d+/.exec(err.stack ?? '') : null;
  return at ? Math.max(1, Number(at[1]) - 2) : null;
}

export function compileExpr<F extends (...args: never[]) => unknown>(
  expr: Expr,
  scope: Scope,
  fallback: ReturnType<F>,
): Compiled<F> {
  let made: unknown;
  try {
    made = new Function('slew', 'lag', 'peak', 'gate', 'level', `"use strict";\nreturn (${expr.code}\n);`)(
      slew,
      lag,
      peak,
      gate,
      (name: string) => scope.level(name),
    );
  } catch (err) {
    return { error: message(err), line: lineOf(err) };
  }
  if (typeof made !== 'function') return { error: 'must be a function', line: null };
  const inner = made as (...args: unknown[]) => unknown;
  const faults: Faults = { count: 0, first: null };
  const fn = ((...args: unknown[]) => {
    try {
      return inner(...args);
    } catch (err) {
      faults.count++;
      faults.first ??= message(err);
      return fallback;
    }
  }) as unknown as F;
  // A signal marked `input` must keep its mark through the wrapper, or a read back trusts it.
  if ((inner as { input?: boolean }).input) (fn as unknown as { input: boolean }).input = true;
  return { fn, faults };
}
```

- [ ] **Step 4: Run it** — expected PASS (5 tests).
- [ ] **Step 5: Commit** — `git commit -am "compile playground expressions, resting calls that throw"` (add the new files first).

---

### Task 4: Compile a composition into mixes

**Files:**
- Create: `apps/playground/src/blits/compile.ts`
- Test: `apps/playground/test/compile.test.ts`

**Interfaces:**
- Consumes: Tasks 2–3; `mix`, `keys`, `patch`, `spring`, `glide`, `tween`, `level`, `Handle`,
  `Mix`, `VoiceSpec as BlitsVoiceSpec` from `@msb235/blits`.
- Produces:
  - `interface FieldError { voice: string | null; field: string; error: string; line: number | null }`
  - `interface Built { mix: Mix<Subject, Pose>; solos: Map<string, Mix<Subject, Pose>>; handles: Map<string, Handle<Subject>>; patches: Map<string, Patch<Subject, Pose, unknown>>; levels: Map<string, { set(v: number): void }>; faults: Map<string, Faults>; errors: FieldError[] }` — `patches` is the full mix's patch per voice, which live mode retargets through (`.to()` / `push` on a motion patch)
  - `compile(c: Composition, subjects: readonly Subject[], opts?: { solos?: boolean }): Built`
  - `const FRAME = 1000 / 60`

Rules: cue voices in order; a voice with any error is skipped and its errors returned; a solo mix
for voice v cues every voice but forces every other voice's weight to `0`, so anchors and loci
still resolve. Levels are created once per `compile` with `level(value)` and shared by every
mix — `Built.levels.get(name).set(v)` moves them all.

- [ ] **Step 1: Write the failing test** — `apps/playground/test/compile.test.ts`

```ts
import { compile, FRAME } from '@pg/blits/compile';
import type { Composition, Voice } from '@pg/blits/composition';
import { KIT, type Pose } from '@pg/blits/kit';
import { subjectsOf } from '@pg/blits/stage';
import { keys, mix, patch, spring } from '@msb235/blits';
import { describe, expect, it } from 'vitest';

const voice = (v: Partial<Voice> & Pick<Voice, 'id' | 'patch'>): Voice => ({
  name: v.id, hue: 0, start: 0, rate: 1, loop: true, weight: 1, fade: {}, ...v,
});
const comp = (voices: Voice[]): Composition => ({
  version: 1, title: 't', stage: { kind: 'dots', cols: 3, rows: 2 }, length: 2000, levels: [], voices,
});
const subjects = subjectsOf({ kind: 'dots', cols: 3, rows: 2 });

/** Plays both mixes frame by frame and compares every subject's pose, to the bit. */
function same(a: ReturnType<typeof mix<(typeof subjects)[0], Pose>>, b: typeof a, ms = 1500) {
  for (let t = 0; t <= ms; t += FRAME) {
    a.sync(t);
    b.sync(t);
    for (const s of subjects) expect(a.probe(s)).toStrictEqual(b.probe(s));
  }
}

describe('compile', () => {
  it('a keys voice gives the poses the hand-written cue gives', () => {
    const stops = [
      { at: 0, delta: { scale: 1, offset: [0, 0] } },
      { at: 1, delta: { scale: 2, offset: [10, -5] } },
    ];
    const built = compile(
      comp([voice({ id: 'a', patch: { kind: 'keys', period: 500, stops }, loop: 2, stagger: { code: '(s) => s.col * 100' }, fade: { in: 200 } })]),
      subjects,
    );
    const hand = mix<(typeof subjects)[0], Pose>(KIT, { stepMs: FRAME });
    hand.cue({ patch: keys(500, stops), loop: 2, stagger: (s) => s.col * 100, fade: { in: 200 } });
    expect(built.errors).toEqual([]);
    same(built.mix, hand);
  });

  it('a fn voice with state and step gives the hand-written poses', () => {
    const at = '(phase, s, set) => ({ turn: set.state.n + phase * s.col })';
    const built = compile(
      comp([voice({ id: 'f', patch: { kind: 'fn', period: 300, writes: ['turn'], at, state: '() => ({ n: 0 })', step: '(st) => { st.n++; }' } })]),
      subjects,
    );
    const hand = mix<(typeof subjects)[0], Pose>(KIT, { stepMs: FRAME });
    hand.cue({
      patch: patch<(typeof subjects)[0], Pose, { n: number }>(300, (phase, s, set) => ({ turn: set.state.n + phase * s.col }), {
        writes: ['turn'], state: () => ({ n: 0 }), step: (st) => { st.n++; },
      }),
    });
    same(built.mix, hand);
  });

  it('a spring voice gives the hand-written poses', () => {
    const built = compile(
      comp([voice({ id: 's', patch: { kind: 'spring', channel: 'offset', opts: { to: { code: '(s) => [s.col * 10, 0]' }, from: [0, 0], stiffness: 120 } } })]),
      subjects,
    );
    const hand = mix<(typeof subjects)[0], Pose>(KIT, { stepMs: FRAME });
    hand.cue({ patch: spring<(typeof subjects)[0], Pose, number[]>('offset', { to: (s) => [s.col * 10, 0], from: [0, 0], stiffness: 120 }) });
    same(built.mix, hand);
  });

  it('skips a voice with a bad expression, names the field, and keeps the rest', () => {
    const ok = voice({ id: 'ok', patch: { kind: 'keys', period: 100, stops: [{ at: 0, delta: { glow: 1 } }] } });
    const bad = voice({ id: 'bad', patch: ok.patch, stagger: { code: '(s) =>' } });
    const built = compile(comp([ok, bad]), subjects);
    expect(built.errors.map((e) => [e.voice, e.field])).toEqual([['bad', 'stagger']]);
    built.mix.sync(0);
    expect(built.mix.probe(subjects[0] as never).glow).toBe(1);
    expect(built.handles.has('bad')).toBe(false);
    expect([...built.patches.keys()]).toEqual(['ok']);
  });

  it('an anchor to a voice that does not exist leaves the voice pending without throwing', () => {
    const v = voice({ id: 'late', patch: { kind: 'keys', period: 100, stops: [{ at: 0, delta: { glow: 1 } }] }, anchor: { start: { after: 'gone' } } });
    const built = compile(comp([v]), subjects);
    built.mix.sync(0);
    built.mix.sync(500);
    expect(built.handles.get('late')?.state).toBe('pending');
  });

  it('a solo mix shows one voice as if the others were silent', () => {
    const a = voice({ id: 'a', patch: { kind: 'keys', period: 100, stops: [{ at: 0, delta: { glow: 0.5 } }] } });
    const b = voice({ id: 'b', patch: { kind: 'keys', period: 100, stops: [{ at: 0, delta: { glow: 0.9 } }] } });
    const built = compile(comp([a, b]), subjects, { solos: true });
    const solo = built.solos.get('a');
    solo?.sync(0);
    expect(solo?.probe(subjects[0] as never).glow).toBe(0.5);
  });

  it('a level is shared by every mix', () => {
    const c = comp([voice({ id: 'w', patch: { kind: 'keys', period: 100, stops: [{ at: 0, delta: { glow: 1 } }] }, weight: { code: 'level("k")' } })]);
    c.levels = [{ name: 'k', value: 0.25, min: 0, max: 1 }];
    const built = compile(c, subjects, { solos: true });
    built.mix.sync(0);
    expect(built.mix.probe(subjects[0] as never).glow).toBeCloseTo(0.25, 12);
    built.levels.get('k')?.set(1);
    built.mix.sync(FRAME);
    built.solos.get('w')?.sync(FRAME);
    expect(built.mix.probe(subjects[0] as never).glow).toBe(1);
    expect(built.solos.get('w')?.probe(subjects[0] as never).glow).toBe(1);
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run apps/playground/test/compile.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** — `src/blits/compile.ts`

```ts
import {
  glide,
  type Handle,
  keys,
  level,
  type Mix,
  mix,
  type Patch,
  patch,
  type Signal,
  spring,
  tween,
  type VoiceSpec as BlitsVoiceSpec,
} from '@msb235/blits';
import { type Composition, type Expr, isExpr, type PatchSource, type Voice } from './composition';
import { compileExpr, type Faults, type Scope } from './expr';
import { KIT, type Pose } from './kit';
import type { Subject } from './stage';

export const FRAME = 1000 / 60;

export interface FieldError {
  voice: string | null;
  field: string;
  error: string;
  line: number | null;
}

export interface Built {
  mix: Mix<Subject, Pose>;
  solos: Map<string, Mix<Subject, Pose>>;
  handles: Map<string, Handle<Subject>>;
  patches: Map<string, Patch<Subject, Pose, unknown>>;
  levels: Map<string, { set(v: number): void }>;
  faults: Map<string, Faults>;
  errors: FieldError[];
}

type Spec = BlitsVoiceSpec<Subject, Pose>;

/** One voice's spec, or the errors that kept it from being built. */
function specOf(v: Voice, scope: Scope, faults: Faults[]): { spec: Spec } | { errors: FieldError[] } {
  const errors: FieldError[] = [];
  const fn = <F extends (...a: never[]) => unknown>(field: string, expr: Expr, fallback: ReturnType<F>): F | undefined => {
    const r = compileExpr<F>(expr, scope, fallback);
    if ('error' in r) {
      errors.push({ voice: v.id, field, error: r.error, line: r.line });
      return undefined;
    }
    faults.push(r.faults);
    return r.fn;
  };
  const made = patchOf(v.patch, fn);
  const stagger = v.stagger ? fn<(s: Subject) => number>('stagger', v.stagger, 0) : undefined;
  const target = v.target ? fn<(s: Subject) => boolean>('target', v.target, false) : undefined;
  const weight = isExpr(v.weight) ? fn<Signal<Subject>>('weight', v.weight, 0) : v.weight;
  if (errors.length > 0 || made === undefined || weight === undefined) return { errors };
  const spec: Spec = {
    patch: made as Patch<Subject, Pose, unknown>,
    start: v.start,
    rate: v.rate,
    loop: v.loop,
    weight,
    fade: v.fade,
    name: v.name,
  };
  if (stagger) spec.stagger = stagger;
  if (target) spec.target = target;
  if (v.hold) spec.hold = v.hold;
  if (v.locus) spec.locus = v.locus;
  if (v.from) spec.from = v.from;
  if (v.anchor) {
    spec.anchor = v.anchor;
    delete spec.start;
  }
  return { spec };
}

type Fn = <F extends (...a: never[]) => unknown>(field: string, expr: Expr, fallback: ReturnType<F>) => F | undefined;

function patchOf(p: PatchSource, fn: Fn): Patch<Subject, Pose, unknown> | undefined {
  if (p.kind === 'keys') return keys<Subject, Pose>(p.period, p.stops, p.ease ? { ease: p.ease } : {});
  if (p.kind === 'fn') {
    const at = fn<(phase: number, s: Subject, set: never) => Partial<Pose>>('at', { code: p.at }, {});
    const state = p.state ? fn<(s: Subject) => unknown>('state', { code: p.state }, undefined) : undefined;
    const step = p.step ? fn<(st: unknown, dt: number) => void>('step', { code: p.step }, undefined) : undefined;
    if (!at || (p.state && !state) || (p.step && !step)) return undefined;
    return patch<Subject, Pose, unknown>(p.period, at as never, {
      writes: p.writes,
      ...(state ? { state } : {}),
      ...(step ? { step: step as never } : {}),
    }) as Patch<Subject, Pose, unknown>;
  }
  const opts: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p.opts)) {
    if (!isExpr(v)) opts[k] = v;
    else {
      const f = fn<(s: Subject) => unknown>(`opts.${k}`, v, 0);
      if (!f) return undefined;
      opts[k] = f;
    }
  }
  const maker = p.kind === 'spring' ? spring : p.kind === 'glide' ? glide : tween;
  return maker<Subject, Pose, number | number[]>(p.channel, opts as never) as unknown as Patch<Subject, Pose, unknown>;
}

export function compile(c: Composition, subjects: readonly Subject[], opts: { solos?: boolean } = {}): Built {
  const levels = new Map(c.levels.map((l) => [l.name, level<Subject>(l.value)]));
  const scope: Scope = { level: (name) => levels.get(name) ?? level<Subject>(0) };
  const errors: FieldError[] = [];
  const faults = new Map<string, Faults>();
  const patches = new Map<string, Patch<Subject, Pose, unknown>>();

  // Specs are built afresh per mix: a motion patch keeps its state on itself and plays on one voice.
  const make = (only: string | null) => {
    const m = mix<Subject, Pose>(KIT, { stepMs: FRAME });
    const handles = new Map<string, Handle<Subject>>();
    for (const v of c.voices) {
      const list: Faults[] = [];
      const r = specOf(v, scope, list);
      if ('errors' in r) {
        if (only === null) errors.push(...r.errors);
        continue;
      }
      const spec = only === null || only === v.id ? r.spec : { ...r.spec, weight: 0 };
      try {
        handles.set(v.id, m.cue(spec));
      } catch (err) {
        if (only === null) errors.push({ voice: v.id, field: 'cue', error: err instanceof Error ? err.message : String(err), line: null });
        continue;
      }
      if (only === null) {
        patches.set(v.id, r.spec.patch);
        faults.set(v.id, {
          get count() { return list.reduce((n, f) => n + f.count, 0); },
          get first() { return list.find((f) => f.first)?.first ?? null; },
        });
      }
    }
    return { m, handles };
  };
  const full = make(null);
  const solos = new Map<string, Mix<Subject, Pose>>();
  if (opts.solos) for (const id of full.handles.keys()) solos.set(id, make(id).m);
  void subjects;
  return { mix: full.m, solos, handles: full.handles, patches, levels, faults, errors };
}
```

`subjects` is unused here; it stays in the signature because the player and tests pass it and a
later per-subject precompute needs it. A solo's faults are not counted: the full mix's are what the
panel shows.

- [ ] **Step 4: Run it** — expected PASS (7 tests). If the keys or spring comparison fails, check
  that `stepMs: FRAME` is on both mixes and that both are synced at identical timestamps.
- [ ] **Step 5: Commit** — `git add apps/playground && git commit -m "compile a playground composition into a mix and one solo mix per voice"`

---

### Task 5: The player

**Files:**
- Create: `apps/playground/src/blits/player.ts`
- Test: `apps/playground/test/player.test.ts`

**Interfaces:**
- Consumes: `compile`, `Built`, `FRAME` (Task 4), `Subject` (Task 2), `CHANNELS`.
- Produces:
  - `interface Columns { offset: Float64Array; turn: Float64Array; scale: Float64Array; color: Float64Array; opacity: Float64Array; glow: Float64Array }`
  - `class Player` with:
    - `constructor(build: () => Built, subjects: readonly Subject[])`
    - `readonly subjects: readonly Subject[]`, `built: Built`, `t: number` (score ms, a whole frame count × FRAME)
    - `seek(t: number): void` — forward steps whole frames to the last frame at or before `t`; backward rebuilds and replays from 0
    - `rebuild(): void` — rebuild at the same `t`
    - `readonly columns: Columns` — the full mix's poses at `t`, one entry per subject (`offset` holds 2 per subject)
    - `solo(id: string, out: Columns): void` — pulls a solo mix's poses at `t`
    - `setLevel(name: string, value: number): void`

Every frame stepped calls `sync` on every mix and `pull`s every subject from each, so stateful
signals see the same frame spacing live or replaying.

- [ ] **Step 1: Write the failing test** — `apps/playground/test/player.test.ts`

```ts
import { compile, FRAME } from '@pg/blits/compile';
import type { Composition } from '@pg/blits/composition';
import { Player } from '@pg/blits/player';
import { subjectsOf } from '@pg/blits/stage';
import { describe, expect, it } from 'vitest';

const c: Composition = {
  version: 1, title: 't', stage: { kind: 'dots', cols: 4, rows: 1 }, length: 3000,
  levels: [{ name: 'k', value: 1, min: 0, max: 1 }],
  voices: [
    { id: 'sp', name: 'sp', hue: 0, start: 0, rate: 1, loop: true, weight: { code: 'slew(level("k"), { riseMs: 400 })' }, fade: {},
      patch: { kind: 'spring', channel: 'offset', opts: { to: { code: '(s) => [s.col * 20, 5]' }, from: [0, 0] } } },
  ],
};
const subjects = subjectsOf(c.stage);
const player = () => new Player(() => compile(c, subjects, { solos: true }), subjects);

describe('Player', () => {
  it('lands on whole frames', () => {
    const p = player();
    p.seek(100);
    expect(p.t).toBe(Math.floor(100 / FRAME) * FRAME);
  });

  it('scrubbing back lands on the pose continuous playback showed', () => {
    const live = player();
    const snaps = new Map<number, number[]>();
    for (let f = 0; f <= 90; f++) {
      live.seek(f * FRAME);
      if (f === 30 || f === 60) snaps.set(f, [...live.columns.offset]);
    }
    live.seek(30 * FRAME);
    expect([...live.columns.offset]).toEqual(snaps.get(30));
    const fresh = player();
    fresh.seek(60 * FRAME);
    expect([...fresh.columns.offset]).toEqual(snaps.get(60));
  });

  it('rebuild keeps the playhead', () => {
    const p = player();
    p.seek(500);
    const t = p.t;
    p.rebuild();
    expect(p.t).toBe(t);
  });

  it('a solo pulls one voice', () => {
    const p = player();
    p.seek(400);
    const out = Player.columnsFor(subjects.length);
    p.solo('sp', out);
    expect([...out.offset]).toEqual([...p.columns.offset]);
  });
});
```

- [ ] **Step 2: Run it** — expected FAIL.

- [ ] **Step 3: Implement** — `src/blits/player.ts`

```ts
import { type Built, FRAME } from './compile';
import type { Subject } from './stage';

export interface Columns {
  offset: Float64Array;
  turn: Float64Array;
  scale: Float64Array;
  color: Float64Array;
  opacity: Float64Array;
  glow: Float64Array;
}

const frameOf = (t: number) => Math.max(0, Math.floor(t / FRAME + 1e-9));

export class Player {
  built: Built;
  t = 0;
  readonly columns: Columns;
  private frame = -1;
  private readonly scratch: Columns;

  static columnsFor(n: number): Columns {
    return {
      offset: new Float64Array(n * 2),
      turn: new Float64Array(n),
      scale: new Float64Array(n),
      color: new Float64Array(n),
      opacity: new Float64Array(n),
      glow: new Float64Array(n),
    };
  }

  constructor(
    private readonly build: () => Built,
    readonly subjects: readonly Subject[],
  ) {
    this.columns = Player.columnsFor(subjects.length);
    this.scratch = Player.columnsFor(subjects.length);
    this.built = build();
    this.step(0);
  }

  seek(t: number): void {
    const target = frameOf(t);
    if (target < this.frame) {
      this.built = this.build();
      this.frame = -1;
    }
    for (let f = this.frame + 1; f <= target; f++) this.step(f);
  }

  rebuild(): void {
    const target = this.frame;
    this.built = this.build();
    this.frame = -1;
    for (let f = 0; f <= target; f++) this.step(f);
  }

  solo(id: string, out: Columns): void {
    this.built.solos.get(id)?.pull(this.subjects, out);
  }

  setLevel(name: string, value: number): void {
    this.built.levels.get(name)?.set(value);
  }

  private step(f: number): void {
    const t = f * FRAME;
    const { mix, solos } = this.built;
    mix.sync(t);
    mix.pull(this.subjects, this.columns);
    for (const solo of solos.values()) {
      solo.sync(t);
      solo.pull(this.subjects, this.scratch);
    }
    this.frame = f;
    this.t = t;
  }
}
```

- [ ] **Step 4: Run it** — expected PASS (4 tests).
- [ ] **Step 5: Commit** — `git add apps/playground && git commit -m "add the playground player: whole frames forward, replay to scrub back"`

---

### Task 6: Keys stops ↔ timeline tracks, and easing

**Files:**
- Create: `apps/playground/src/blits/easing.ts`, `apps/playground/src/blits/keys.ts`
- Test: `apps/playground/test/keys.test.ts`

**Interfaces:**
- Consumes: `Keyframe`, `Easing`, `mixHex` from `@msb235/blits`; `EasingSpec`, `SampledTrack` from
  `@weasel-js/core`; `easingBezier` from `@weasel-js/ui`.
- Produces:
  - `toWeasel(e: Easing | undefined): EasingSpec | undefined`, `toBlits(e: EasingSpec | undefined): Easing | undefined`
  - `tracksOf(stops: readonly Keyframe<Pose>[], period: number): SampledTrack<unknown>[]` — one track per channel keyed, label = channel name, `t = at * period`
  - `stopsOf(tracks: readonly SampledTrack<unknown>[], period: number): Keyframe<Pose>[]` — one stop per distinct key time, carrying every channel keyed there, sorted by `at`

Easing maps through bezier control points: blits' named curves are CSS's
(`ease` .25,.1,.25,1; `ease-in` .42,0,1,1; `ease-out` 0,0,.58,1; `ease-in-out` .42,0,.58,1;
`linear` → undefined); a weasel spec becomes `{ bezier: easingBezier(spec) }`. Blits `steps` and
function easings have no weasel form: `toWeasel` returns `undefined` for them and the stop keeps
its own easing unless the user changes it (handled in `stopsOf` by preserving the original
`ease` when the track key's easing is unchanged — see the test).

- [ ] **Step 1: Write the failing test** — `apps/playground/test/keys.test.ts`

```ts
import { stopsOf, tracksOf } from '@pg/blits/keys';
import { toBlits, toWeasel } from '@pg/blits/easing';
import { describe, expect, it } from 'vitest';

const stops = [
  { at: 0, delta: { scale: 1, offset: [0, 0] } },
  { at: 0.5, delta: { scale: 2 }, ease: 'ease-in' as const },
  { at: 1, delta: { scale: 1, offset: [10, 0] } },
];

describe('tracksOf / stopsOf', () => {
  it('splits stops into one track per channel, in ms', () => {
    const tracks = tracksOf(stops, 400);
    expect(tracks.map((t) => t.label)).toEqual(['offset', 'scale']);
    expect(tracks[0]?.keys.map((k) => k.t)).toEqual([0, 400]);
    expect(tracks[1]?.keys.map((k) => k.t)).toEqual([0, 200, 400]);
  });

  it('round-trips', () => {
    const back = stopsOf(tracksOf(stops, 400), 400);
    expect(back).toEqual([
      { at: 0, delta: { scale: 1, offset: [0, 0] } },
      { at: 0.5, delta: { scale: 2 }, ease: { bezier: [0.42, 0, 1, 1] } },
      { at: 1, delta: { scale: 1, offset: [10, 0] } },
    ]);
  });
});

describe('easing', () => {
  it('maps named curves through bezier points', () => {
    expect(toWeasel('ease-out')).toEqual({ bezier: [0, 0, 0.58, 1] });
    expect(toWeasel('linear')).toBeUndefined();
    expect(toBlits({ bezier: [0.1, 0.2, 0.3, 0.4] })).toEqual({ bezier: [0.1, 0.2, 0.3, 0.4] });
    expect(toBlits(undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it** — expected FAIL.

- [ ] **Step 3: Implement**

`src/blits/easing.ts`:
```ts
import type { Easing } from '@msb235/blits';
import type { EasingSpec } from '@weasel-js/core';
import { easingBezier } from '@weasel-js/ui';

type Bezier = readonly [number, number, number, number];
const NAMED: Record<string, Bezier> = {
  ease: [0.25, 0.1, 0.25, 1],
  'ease-in': [0.42, 0, 1, 1],
  'ease-out': [0, 0, 0.58, 1],
  'ease-in-out': [0.42, 0, 0.58, 1],
};

export function toWeasel(e: Easing | undefined): EasingSpec | undefined {
  if (e === undefined || e === 'linear' || typeof e === 'function') return undefined;
  if (typeof e === 'string') return { bezier: NAMED[e] as Bezier };
  if ('bezier' in e) return { bezier: e.bezier };
  return undefined;
}

export function toBlits(e: EasingSpec | undefined): Easing | undefined {
  if (e === undefined) return undefined;
  if (typeof e === 'object' && 'bezier' in e) return { bezier: [...e.bezier] as unknown as Bezier };
  const b = easingBezier(e);
  return b ? { bezier: [...b] as unknown as Bezier } : undefined;
}
```
(If `easingBezier`'s return type differs from a 4-tuple or `null`, adapt the last two lines to it;
check `node_modules/@weasel-js/ui/dist/*.d.ts` for `easingBezier`.)

`src/blits/keys.ts`:
```ts
import { type Keyframe, mixHex } from '@msb235/blits';
import type { SampledTrack } from '@weasel-js/core';
import { toBlits, toWeasel } from './easing';
import { CHANNELS, type ChannelName, type Pose } from './kit';

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const interpolateOf = (ch: ChannelName) =>
  ch === 'offset'
    ? (a: number[], b: number[], u: number) => a.map((x, i) => lerp(x, b[i] ?? x, u))
    : ch === 'color'
      ? (a: number, b: number, u: number) => mixHex(a, b, u)
      : undefined;

export function tracksOf(stops: readonly Keyframe<Pose>[], period: number): SampledTrack<unknown>[] {
  const keyed = CHANNELS.filter((ch) => stops.some((s) => s.delta[ch] !== undefined));
  const ordered = [...keyed].sort((a, b) => firstAt(stops, a) - firstAt(stops, b) || CHANNELS.indexOf(a) - CHANNELS.indexOf(b));
  return ordered.map((ch) => ({
    kind: 'sampled',
    label: ch,
    keys: stops
      .filter((s) => s.delta[ch] !== undefined)
      .map((s) => ({ t: s.at * period, value: s.delta[ch], ...(toWeasel(s.ease) ? { easing: toWeasel(s.ease) } : {}) })),
    ...(interpolateOf(ch) ? { interpolate: interpolateOf(ch) as never } : {}),
    onTick: () => {},
  }));
}

const firstAt = (stops: readonly Keyframe<Pose>[], ch: ChannelName) =>
  stops.find((s) => s.delta[ch] !== undefined)?.at ?? 1;

export function stopsOf(tracks: readonly SampledTrack<unknown>[], period: number): Keyframe<Pose>[] {
  const byAt = new Map<number, Keyframe<Pose>>();
  for (const track of tracks) {
    const ch = track.label as ChannelName;
    for (const key of track.keys) {
      const at = period > 0 ? Math.round((key.t / period) * 1e9) / 1e9 : 0;
      const stop = byAt.get(at) ?? { at, delta: {} };
      (stop.delta as Record<string, unknown>)[ch] = key.value;
      const ease = toBlits(key.easing);
      if (ease !== undefined) stop.ease = ease;
      byAt.set(at, stop);
    }
  }
  return [...byAt.values()].sort((a, b) => a.at - b.at);
}
```

Tracks are ordered by the first stop each channel appears in, ties broken by `CHANNELS` order.

- [ ] **Step 4: Run it** — expected PASS (3 tests).
- [ ] **Step 5: Commit** — `git add apps/playground && git commit -m "map keys stops to timeline tracks and blits easing to weasel's"`

---

### Task 7: The `ScoreLanes` widget

**Files:**
- Create: `apps/playground/src/widgets/ScoreLanes/geometry.ts`, `drag.ts`, `ScoreLanes.tsx`,
  `ScoreLanes.module.css`, `ScoreLanes.stories.tsx`, `index.ts`
- Test: `apps/playground/test/geometry.test.ts`, `apps/playground/test/drag.test.ts`

**Interfaces:**
- Produces (no blits imports anywhere in this folder):
```ts
export interface Clip {
  id: string;
  lane: number;
  label: string;
  hue: number;
  start: number;              // ms
  pass: number;               // ms one pass lasts; 0 = no passes
  passes: number;             // Infinity = open-ended
  fadeIn: number;
  fadeOut: number;
  spread: number;             // ms from first to last subject's start; 0 = none
  holdBefore: boolean;
  holdAfter: boolean;
  group?: string;
  locked?: boolean;           // start is set elsewhere (anchored): body drag disabled
}
export type Edge = 'start' | 'end';
export interface Link { from: { clip: string; edge: Edge }; to: { clip: string; edge: Edge } }
export type ClipEdit =
  | { clip: string; kind: 'move'; start: number }
  | { clip: string; kind: 'fadeIn' | 'fadeOut'; ms: number }
  | { clip: string; kind: 'passes'; passes: number }
  | { clip: string; kind: 'link'; link: Link };
export interface ScoreLanesProps {
  clips: readonly Clip[];
  links: readonly Link[];
  duration: number;
  playhead: number;
  selected: string | null;
  onSelect(id: string | null): void;
  onEdit(edit: ClipEdit): void;
  onScrub(t: number): void;
  laneHeight?: number;        // default 36
  labelWidth?: number;        // default 140
}
// geometry.ts
export interface Scale { x(t: number): number; t(x: number): number }
export function scaleOf(duration: number, width: number, labelWidth: number): Scale
export function clipEnd(c: Clip): number                 // start + pass*passes, Infinity if open
export function clipPolygon(c: Clip, s: Scale, top: number, h: number, viewEnd: number): string // SVG points
export function passLines(c: Clip, viewEnd: number): number[]  // ms of each internal divider, capped at 200
// drag.ts
export type Handle = 'body' | 'fadeIn' | 'fadeOut' | 'end'
export function dragEdit(c: Clip, handle: Handle, dt: number): ClipEdit | null
```

- [ ] **Step 1: Write the failing tests**

`apps/playground/test/geometry.test.ts`:
```ts
import { clipEnd, clipPolygon, passLines, scaleOf } from '@pg/widgets/ScoreLanes/geometry';
import type { Clip } from '@pg/widgets/ScoreLanes';
import { describe, expect, it } from 'vitest';

const clip = (c: Partial<Clip>): Clip => ({
  id: 'a', lane: 0, label: 'a', hue: 200, start: 0, pass: 500, passes: 2, fadeIn: 0, fadeOut: 0,
  spread: 0, holdBefore: false, holdAfter: false, ...c,
});

describe('geometry', () => {
  it('maps time to x past the label column and back', () => {
    const s = scaleOf(2000, 1140, 140);
    expect(s.x(0)).toBe(140);
    expect(s.x(2000)).toBe(1140);
    expect(s.t(640)).toBe(1000);
  });
  it('ends a clip after its passes, or never', () => {
    expect(clipEnd(clip({ start: 100 }))).toBe(1100);
    expect(clipEnd(clip({ passes: Number.POSITIVE_INFINITY }))).toBe(Number.POSITIVE_INFINITY);
  });
  it('slopes the fades', () => {
    const s = scaleOf(1000, 1000, 0);
    expect(clipPolygon(clip({ fadeIn: 100, fadeOut: 200 }), s, 10, 20, 1000)).toBe('0,30 100,10 800,10 1000,30');
  });
  it('draws an open clip to the view end', () => {
    const s = scaleOf(1000, 1000, 0);
    expect(clipPolygon(clip({ passes: Number.POSITIVE_INFINITY }), s, 0, 10, 1000)).toBe('0,10 0,0 1000,0 1000,10');
  });
  it('puts dividers between passes, none for an aperiodic clip', () => {
    expect(passLines(clip({ passes: 3 }), 5000)).toEqual([500, 1000]);
    expect(passLines(clip({ pass: 0, passes: 1 }), 5000)).toEqual([]);
  });
});
```

`apps/playground/test/drag.test.ts`:
```ts
import { dragEdit } from '@pg/widgets/ScoreLanes/drag';
import type { Clip } from '@pg/widgets/ScoreLanes';
import { describe, expect, it } from 'vitest';

const clip = (c: Partial<Clip>): Clip => ({
  id: 'a', lane: 0, label: 'a', hue: 200, start: 100, pass: 500, passes: 2, fadeIn: 50, fadeOut: 50,
  spread: 0, holdBefore: false, holdAfter: false, ...c,
});

describe('dragEdit', () => {
  it('moves the body, not before 0', () => {
    expect(dragEdit(clip({}), 'body', 40)).toEqual({ clip: 'a', kind: 'move', start: 140 });
    expect(dragEdit(clip({}), 'body', -500)).toEqual({ clip: 'a', kind: 'move', start: 0 });
  });
  it('does not move an anchored clip', () => {
    expect(dragEdit(clip({ locked: true }), 'body', 40)).toBeNull();
  });
  it('snaps the end to whole passes, at least one', () => {
    expect(dragEdit(clip({}), 'end', 300)).toEqual({ clip: 'a', kind: 'passes', passes: 3 });
    expect(dragEdit(clip({}), 'end', -2000)).toEqual({ clip: 'a', kind: 'passes', passes: 1 });
  });
  it('leaves an aperiodic clip\'s end alone', () => {
    expect(dragEdit(clip({ pass: 0, passes: 1 }), 'end', 300)).toBeNull();
  });
  it('makes an open clip finite from its arrow', () => {
    expect(dragEdit(clip({ passes: Number.POSITIVE_INFINITY }), 'end', 0)).toEqual({ clip: 'a', kind: 'passes', passes: 1 });
  });
  it('clamps fades to 0..clip length', () => {
    expect(dragEdit(clip({}), 'fadeIn', 30)).toEqual({ clip: 'a', kind: 'fadeIn', ms: 80 });
    expect(dragEdit(clip({}), 'fadeOut', -30)).toEqual({ clip: 'a', kind: 'fadeOut', ms: 80 });
    expect(dragEdit(clip({}), 'fadeIn', -100)).toEqual({ clip: 'a', kind: 'fadeIn', ms: 0 });
  });
});
```

- [ ] **Step 2: Run both** — expected FAIL.

- [ ] **Step 3: Implement geometry, drag and types**

`src/widgets/ScoreLanes/index.ts` holds the types from **Interfaces** above (copy them verbatim,
less the `geometry.ts`/`drag.ts` function lines) and re-exports `ScoreLanes`:
```ts
export { ScoreLanes } from './ScoreLanes';
```

`src/widgets/ScoreLanes/geometry.ts`:
```ts
import type { Clip } from './index';

export interface Scale {
  x(t: number): number;
  t(x: number): number;
}

export function scaleOf(duration: number, width: number, labelWidth: number): Scale {
  const span = Math.max(1, width - labelWidth);
  return { x: (t) => labelWidth + (t / duration) * span, t: (x) => ((x - labelWidth) / span) * duration };
}

export function clipEnd(c: Clip): number {
  if (!Number.isFinite(c.passes)) return Number.POSITIVE_INFINITY;
  return c.start + (c.pass > 0 ? c.pass * c.passes : 0);
}

export function clipPolygon(c: Clip, s: Scale, top: number, h: number, viewEnd: number): string {
  const end = Math.min(clipEnd(c), viewEnd);
  const open = !Number.isFinite(clipEnd(c));
  const x0 = s.x(c.start);
  const x1 = s.x(end);
  const inX = s.x(c.start + c.fadeIn);
  const outX = open ? x1 : s.x(end - c.fadeOut);
  const fmt = (x: number, y: number) => `${Math.round(x * 100) / 100},${y}`;
  return [fmt(x0, top + h), fmt(inX, top), fmt(outX, top), fmt(x1, top + h)].join(' ');
}

export function passLines(c: Clip, viewEnd: number): number[] {
  if (c.pass <= 0) return [];
  const end = Math.min(clipEnd(c), viewEnd);
  const out: number[] = [];
  for (let t = c.start + c.pass; t < end - 1e-9 && out.length < 200; t += c.pass) out.push(t);
  return out;
}
```
(The open-clip test expects `'0,10 0,0 1000,0 1000,10'` with `fadeIn: 0`; the slope collapses to
a vertical edge, which is what that string is.)

`src/widgets/ScoreLanes/drag.ts`:
```ts
import { clipEnd } from './geometry';
import type { Clip, ClipEdit } from './index';

export type Handle = 'body' | 'fadeIn' | 'fadeOut' | 'end';

export function dragEdit(c: Clip, handle: Handle, dt: number): ClipEdit | null {
  if (handle === 'body')
    return c.locked ? null : { clip: c.id, kind: 'move', start: Math.max(0, c.start + dt) };
  if (handle === 'end') {
    if (c.pass <= 0) return null;
    if (!Number.isFinite(c.passes)) return { clip: c.id, kind: 'passes', passes: 1 };
    return { clip: c.id, kind: 'passes', passes: Math.max(1, Math.round(c.passes + dt / c.pass)) };
  }
  const length = Number.isFinite(clipEnd(c)) ? clipEnd(c) - c.start : Number.POSITIVE_INFINITY;
  const was = handle === 'fadeIn' ? c.fadeIn : c.fadeOut;
  const ms = Math.min(length, Math.max(0, was + (handle === 'fadeIn' ? dt : -dt)));
  return { clip: c.id, kind: handle, ms };
}
```

- [ ] **Step 4: Run both tests** — expected PASS (11 tests).

- [ ] **Step 5: Write the component and its stylesheet**

`src/widgets/ScoreLanes/ScoreLanes.tsx`:
```tsx
import { type PointerEvent, useMemo, useRef, useState } from 'react';
import { dragEdit, type Handle } from './drag';
import { clipEnd, clipPolygon, passLines, scaleOf } from './geometry';
import type { Clip, ClipEdit, Edge, ScoreLanesProps } from './index';
import s from './ScoreLanes.module.css';

const WIDTH = 1000;

type Drag = { clip: Clip; handle: Handle; x0: number } | { link: { clip: string; edge: Edge }; x: number; y: number };

export function ScoreLanes(props: ScoreLanesProps) {
  const { clips, links, duration, playhead, selected, onSelect, onEdit, onScrub } = props;
  const laneH = props.laneHeight ?? 36;
  const labelW = props.labelWidth ?? 140;
  const lanes = Math.max(1, ...clips.map((c) => c.lane + 1));
  const height = 24 + lanes * laneH;
  const scale = useMemo(() => scaleOf(duration, WIDTH, labelW), [duration, labelW]);
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [preview, setPreview] = useState<ClipEdit | null>(null);

  const local = (e: PointerEvent) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return { x: ((e.clientX - box.left) / box.width) * WIDTH, y: ((e.clientY - box.top) / box.height) * height };
  };
  const msPerUnit = duration / (WIDTH - labelW);
  const shown = (c: Clip): Clip => {
    if (!preview || preview.clip !== c.id) return c;
    if (preview.kind === 'move') return { ...c, start: preview.start };
    if (preview.kind === 'passes') return { ...c, passes: preview.passes };
    if (preview.kind === 'fadeIn') return { ...c, fadeIn: preview.ms };
    if (preview.kind === 'fadeOut') return { ...c, fadeOut: preview.ms };
    return c;
  };
  const begin = (e: PointerEvent, clip: Clip, handle: Handle) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    onSelect(clip.id);
    if (e.altKey && (handle === 'body' || handle === 'end')) {
      const p = local(e);
      setDrag({ link: { clip: clip.id, edge: handle === 'end' ? 'end' : 'start' }, x: p.x, y: p.y });
    } else setDrag({ clip, handle, x0: local(e).x });
  };
  const move = (e: PointerEvent) => {
    if (!drag) return;
    const p = local(e);
    if ('link' in drag) setDrag({ ...drag, x: p.x, y: p.y });
    else setPreview(dragEdit(drag.clip, drag.handle, (p.x - drag.x0) * msPerUnit));
  };
  const end = (e: PointerEvent) => {
    if (drag && 'link' in drag) {
      const p = local(e);
      const lane = Math.floor((p.y - 24) / laneH);
      const t = scale.t(p.x);
      const hit = clips.find((c) => c.lane === lane && c.id !== drag.link.clip && t >= c.start && t <= Math.min(clipEnd(c), duration));
      if (hit) {
        const edge: Edge = t - hit.start < Math.min(clipEnd(hit), duration) - t ? 'start' : 'end';
        onEdit({ clip: drag.link.clip, kind: 'link', link: { from: drag.link, to: { clip: hit.id, edge } } });
      }
    } else if (preview) onEdit(preview);
    setDrag(null);
    setPreview(null);
  };
  const scrub = (e: PointerEvent) => {
    const t = scale.t(local(e).x);
    if (t >= 0) onScrub(Math.min(duration, t));
  };

  const ticks = Array.from({ length: Math.floor(duration / 1000) + 1 }, (_, i) => i * 1000);
  const edgeX = (id: string, edge: Edge) => {
    const c = clips.find((x) => x.id === id);
    if (!c) return null;
    return { x: scale.x(edge === 'start' ? c.start : Math.min(clipEnd(c), duration)), y: 24 + c.lane * laneH + laneH / 2 };
  };

  return (
    <svg ref={svg} className={s.score} viewBox={`0 0 ${WIDTH} ${height}`} role="group" aria-label="score"
      onPointerMove={move} onPointerUp={end} onPointerDown={() => onSelect(null)}>
      <g className={s.ruler} onPointerDown={(e) => { e.stopPropagation(); scrub(e); }}>
        <rect x={labelW} y={0} width={WIDTH - labelW} height={22} />
        {ticks.map((t) => (
          <text key={t} x={scale.x(t) + 3} y={15}>{t / 1000}s</text>
        ))}
      </g>
      {Array.from({ length: lanes }, (_, i) => (
        <line key={i} className={s.laneLine} x1={0} x2={WIDTH} y1={24 + (i + 1) * laneH} y2={24 + (i + 1) * laneH} />
      ))}
      {clips.map((raw) => {
        const c = shown(raw);
        const top = 24 + c.lane * laneH + 4;
        const h = laneH - 12;
        const end = Math.min(clipEnd(c), duration);
        const fill = `hsl(${c.hue} 70% 62%)`;
        return (
          <g key={c.id} className={c.id === selected ? s.selected : s.clip}>
            <text className={s.label} x={6} y={top + h / 2 + 4}>{c.label}</text>
            {c.holdBefore && c.start > 0 && (
              <rect className={s.hatch} x={labelW} y={top} width={scale.x(c.start) - labelW} height={h} style={{ color: fill }} />
            )}
            <polygon points={clipPolygon(c, scale, top, h, duration)} fill={fill}
              onPointerDown={(e) => begin(e, raw, 'body')} />
            {passLines(c, duration).map((t) => (
              <line key={t} className={s.pass} x1={scale.x(t)} x2={scale.x(t)} y1={top} y2={top + h} />
            ))}
            {c.spread > 0 && (
              <rect className={s.spread} x={scale.x(c.start)} y={top + h + 2} width={scale.x(c.start + c.spread) - scale.x(c.start)} height={3} fill={fill} />
            )}
            {c.holdAfter && Number.isFinite(clipEnd(c)) && end < duration && (
              <rect className={s.hatch} x={scale.x(end)} y={top} width={WIDTH - scale.x(end)} height={h} style={{ color: fill }} />
            )}
            <circle className={s.handle} cx={scale.x(c.start + c.fadeIn)} cy={top} r={4}
              onPointerDown={(e) => begin(e, raw, 'fadeIn')} />
            {Number.isFinite(clipEnd(c)) && (
              <>
                <circle className={s.handle} cx={scale.x(end - c.fadeOut)} cy={top} r={4}
                  onPointerDown={(e) => begin(e, raw, 'fadeOut')} />
                <rect className={s.edge} x={scale.x(end) - 3} y={top} width={6} height={h}
                  onPointerDown={(e) => begin(e, raw, 'end')} />
              </>
            )}
            {!Number.isFinite(clipEnd(c)) && (
              <text className={s.arrow} x={WIDTH - 16} y={top + h / 2 + 5}
                onPointerDown={(e) => begin(e, raw, 'end')}>→</text>
            )}
          </g>
        );
      })}
      {links.map((l) => {
        const a = edgeX(l.from.clip, l.from.edge);
        const b = edgeX(l.to.clip, l.to.edge);
        if (!a || !b) return null;
        return <path key={`${l.from.clip}-${l.to.clip}`} className={s.link} d={`M${b.x} ${b.y} C ${b.x} ${(a.y + b.y) / 2}, ${a.x} ${(a.y + b.y) / 2}, ${a.x} ${a.y}`} />;
      })}
      {drag && 'link' in drag && (() => {
        const a = edgeX(drag.link.clip, drag.link.edge);
        return a ? <line className={s.link} x1={a.x} y1={a.y} x2={drag.x} y2={drag.y} /> : null;
      })()}
      <line className={s.playhead} x1={scale.x(playhead)} x2={scale.x(playhead)} y1={0} y2={height} />
    </svg>
  );
}
```
The two `style={{ color }}` props carry a per-clip hue into the hatch pattern's `currentColor`;
that is the one data-driven inline style this widget needs.

`src/widgets/ScoreLanes/ScoreLanes.module.css`:
```css
.score { width: 100%; display: block; user-select: none; font: 11px var(--wzl-font-ui, sans-serif); }
.ruler rect { fill: var(--wzl-surface-2, #1a1f2a); cursor: ew-resize; }
.ruler text { fill: var(--wzl-text-muted, #7b8494); font-variant-numeric: tabular-nums; }
.laneLine { stroke: var(--wzl-border, #262c38); }
.label { fill: var(--wzl-text, #c9d1dc); }
.clip polygon { opacity: 0.8; cursor: grab; }
.selected polygon { opacity: 1; stroke: var(--wzl-text, #fff); stroke-width: 1.5; cursor: grab; }
.pass { stroke: var(--wzl-surface-1, #12151c); stroke-width: 2; pointer-events: none; }
.spread { opacity: 0.4; pointer-events: none; }
.hatch { fill: currentColor; opacity: 0.25; pointer-events: none; mask: repeating-linear-gradient(45deg, #000 0 3px, transparent 3px 7px); }
.handle { fill: var(--wzl-text, #fff); opacity: 0; cursor: ew-resize; }
.clip:hover .handle, .selected .handle { opacity: 0.9; }
.edge { fill: transparent; cursor: col-resize; }
.arrow { fill: var(--wzl-surface-1, #12151c); font-size: 16px; cursor: w-resize; }
.link { fill: none; stroke: var(--wzl-accent, #ffd36b); stroke-dasharray: 4 3; stroke-width: 1.5; pointer-events: none; }
.playhead { stroke: var(--wzl-danger, #ff6b8b); stroke-width: 2; pointer-events: none; }
```

- [ ] **Step 6: Write the stories** — `src/widgets/ScoreLanes/ScoreLanes.stories.tsx`

```tsx
import type { Meta, StoryObj } from '@weasel-js/forge';
import { useState } from 'react';
import { type Clip, type ClipEdit, type Link, ScoreLanes } from './index';

const meta: Meta<typeof ScoreLanes> = { title: 'playground/ScoreLanes', component: ScoreLanes };
export default meta;

const CLIPS: Clip[] = [
  { id: 'wave', lane: 0, label: 'wave · keys', hue: 220, start: 0, pass: 1000, passes: 2, fadeIn: 300, fadeOut: 250, spread: 1100, holdBefore: false, holdAfter: false },
  { id: 'pulse', lane: 1, label: 'pulse · fn', hue: 155, start: 1000, pass: 600, passes: Number.POSITIVE_INFINITY, fadeIn: 0, fadeOut: 0, spread: 0, holdBefore: false, holdAfter: false },
  { id: 'settle', lane: 2, label: 'settle · spring', hue: 280, start: 3000, pass: 1300, passes: 1, fadeIn: 0, fadeOut: 0, spread: 0, holdBefore: true, holdAfter: true },
  { id: 'spin', lane: 3, label: 'spin · keys', hue: 45, start: 2000, pass: 900, passes: 1, fadeIn: 150, fadeOut: 150, spread: 0, holdBefore: false, holdAfter: false, locked: true },
];
const LINKS: Link[] = [{ from: { clip: 'spin', edge: 'start' }, to: { clip: 'wave', edge: 'end' } }];

function apply(clips: Clip[], e: ClipEdit): Clip[] {
  return clips.map((c) => {
    if (c.id !== e.clip) return c;
    if (e.kind === 'move') return { ...c, start: e.start };
    if (e.kind === 'passes') return { ...c, passes: e.passes };
    if (e.kind === 'fadeIn') return { ...c, fadeIn: e.ms };
    if (e.kind === 'fadeOut') return { ...c, fadeOut: e.ms };
    return c;
  });
}

function Harness() {
  const [clips, setClips] = useState(CLIPS);
  const [links, setLinks] = useState(LINKS);
  const [playhead, setPlayhead] = useState(1300);
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <div style={{ width: 900 }}>
      <ScoreLanes clips={clips} links={links} duration={6000} playhead={playhead} selected={selected}
        onSelect={setSelected} onScrub={setPlayhead}
        onEdit={(e) => (e.kind === 'link' ? setLinks((l) => [...l.filter((x) => x.from.clip !== e.clip), e.link]) : setClips((c) => apply(c, e)))} />
    </div>
  );
}

export const Arrangement: StoryObj<typeof ScoreLanes> = { render: () => <Harness /> };
```

- [ ] **Step 7: Check it** — `npm run stories -w @blits/playground` in the background; open
  `http://localhost:<port>/` headless with the playwright MCP, select the ScoreLanes story,
  screenshot it and `transom post` the screenshot; drag a clip body and confirm it moves. Stop
  the server.
- [ ] **Step 8: Commit** — `git add apps/playground && git commit -m "add ScoreLanes, a clip-per-lane arrangement widget with fades, passes, holds and links"`

---

### Task 8: Voices ↔ clips

**Files:**
- Create: `apps/playground/src/blits/score.ts`
- Test: `apps/playground/test/score.test.ts`

**Interfaces:**
- Consumes: `Voice`, `Composition`, `Subject`, `compileExpr`, `Clip`, `Link`, `ClipEdit`.
- Produces:
  - `clipsOf(c: Composition, subjects: readonly Subject[]): { clips: Clip[]; links: Link[] }`
  - `applyEdit(c: Composition, edit: ClipEdit): Composition` (pure; returns a new composition)

Mapping: `pass` = the patch's `period` for `keys`/`fn`, `0` for motion; `passes` = `loop === true ? Infinity : loop === false ? 1 : loop`; `fadeIn/fadeOut` from `fade`; `spread` = max stagger over subjects (0 without stagger, or if the expression errors); `holdBefore/After` from `hold`; `group` = `locus`; `locked` = `anchor?.start !== undefined || anchor?.in !== undefined`. Links come from `anchor.start`/`anchor.in` given as `{ after: name }` (to the target's `end`), `{ with: name }` (to its `start`) or `{ of: name, mark }` (`start`/`in` → `start`, `out`/`end` → `end`), found by voice `name`. A `link` edit writes `anchor: { start: { after: <to name> } }` when `to.edge === 'end'`, else `{ start: { with: <to name> } }`. A `passes` edit writes `loop: passes`. A `move` edit writes `start`.

- [ ] **Step 1: Write the failing test** — `apps/playground/test/score.test.ts`

```ts
import type { Composition, Voice } from '@pg/blits/composition';
import { applyEdit, clipsOf } from '@pg/blits/score';
import { subjectsOf } from '@pg/blits/stage';
import { describe, expect, it } from 'vitest';

const v = (x: Partial<Voice> & Pick<Voice, 'id'>): Voice => ({
  name: x.id, hue: 10, start: 0, rate: 1, loop: 2, weight: 1, fade: { in: 100, out: 50 },
  patch: { kind: 'keys', period: 400, stops: [{ at: 0, delta: { glow: 1 } }] }, ...x,
});
const c: Composition = {
  version: 1, title: 't', stage: { kind: 'dots', cols: 4, rows: 1 }, length: 4000, levels: [],
  voices: [
    v({ id: 'a', stagger: { code: '(s) => s.col * 100' }, hold: 'after', locus: 'g' }),
    v({ id: 'b', loop: true, anchor: { start: { after: 'a' } } }),
    v({ id: 'c', patch: { kind: 'spring', channel: 'scale', opts: { to: 2 } }, loop: true }),
  ],
};
const subjects = subjectsOf(c.stage);

describe('clipsOf', () => {
  it('maps a voice to a clip', () => {
    const { clips } = clipsOf(c, subjects);
    expect(clips[0]).toEqual({
      id: 'a', lane: 0, label: 'a · keys', hue: 10, start: 0, pass: 400, passes: 2, fadeIn: 100, fadeOut: 50,
      spread: 300, holdBefore: false, holdAfter: true, group: 'g', locked: false,
    });
    expect(clips[1]).toMatchObject({ passes: Number.POSITIVE_INFINITY, locked: true });
    expect(clips[2]).toMatchObject({ pass: 0, label: 'c · spring' });
  });
  it('draws an anchor as a link', () => {
    expect(clipsOf(c, subjects).links).toEqual([{ from: { clip: 'b', edge: 'start' }, to: { clip: 'a', edge: 'end' } }]);
  });
  it('an anchor naming a missing voice draws no link', () => {
    const d = { ...c, voices: [v({ id: 'x', anchor: { start: { after: 'nobody' } } })] };
    expect(clipsOf(d, subjects).links).toEqual([]);
  });
});

describe('applyEdit', () => {
  it('writes passes as loop, a move as start, fades as fade', () => {
    let d = applyEdit(c, { clip: 'a', kind: 'passes', passes: 3 });
    d = applyEdit(d, { clip: 'a', kind: 'move', start: 250 });
    d = applyEdit(d, { clip: 'a', kind: 'fadeOut', ms: 80 });
    expect(d.voices[0]).toMatchObject({ loop: 3, start: 250, fade: { in: 100, out: 80 } });
    expect(c.voices[0]?.loop).toBe(2);
  });
  it('writes a link as an anchor on the voice it starts from', () => {
    const d = applyEdit(c, { clip: 'c', kind: 'link', link: { from: { clip: 'c', edge: 'start' }, to: { clip: 'a', edge: 'start' } } });
    expect(d.voices[2]?.anchor).toEqual({ start: { with: 'a' } });
  });
});
```

- [ ] **Step 2: Run it** — expected FAIL.

- [ ] **Step 3: Implement** — `src/blits/score.ts`

```ts
import type { Anchor } from '@msb235/blits';
import type { Clip, ClipEdit, Link } from '@pg/widgets/ScoreLanes';
import type { Composition, Voice } from './composition';
import { compileExpr } from './expr';
import { level } from '@msb235/blits';
import type { Subject } from './stage';

const scope = { level: () => level<Subject>(0) };

function spreadOf(v: Voice, subjects: readonly Subject[]): number {
  if (!v.stagger) return 0;
  const r = compileExpr<(s: Subject) => number>(v.stagger, scope, 0);
  if ('error' in r) return 0;
  let most = 0;
  for (const s of subjects) {
    const d = Number(r.fn(s));
    if (Number.isFinite(d) && d > most) most = d;
  }
  return most;
}

function targetOf(a: Anchor | number | undefined): { name: string; edge: 'start' | 'end' } | null {
  if (a === undefined || typeof a === 'number') return null;
  const name = (q: unknown) => (typeof q === 'string' ? q : (q as { name?: string }).name);
  if ('after' in a) return name(a.after) ? { name: name(a.after) as string, edge: 'end' } : null;
  if ('with' in a) return name(a.with) ? { name: name(a.with) as string, edge: 'start' } : null;
  if ('before' in a) return name(a.before) ? { name: name(a.before) as string, edge: 'start' } : null;
  const n = name(a.of);
  return n ? { name: n, edge: a.mark === 'start' || a.mark === 'in' ? 'start' : 'end' } : null;
}

export function clipsOf(c: Composition, subjects: readonly Subject[]): { clips: Clip[]; links: Link[] } {
  const clips = c.voices.map((v, lane): Clip => {
    const pass = v.patch.kind === 'keys' || v.patch.kind === 'fn' ? v.patch.period : 0;
    const clip: Clip = {
      id: v.id,
      lane,
      label: `${v.name} · ${v.patch.kind}`,
      hue: v.hue,
      start: v.start,
      pass,
      passes: v.loop === true ? Number.POSITIVE_INFINITY : v.loop === false ? 1 : v.loop,
      fadeIn: v.fade.in ?? 0,
      fadeOut: v.fade.out ?? 0,
      spread: spreadOf(v, subjects),
      holdBefore: v.hold === 'before' || v.hold === 'both',
      holdAfter: v.hold === 'after' || v.hold === 'both',
      locked: v.anchor?.start !== undefined || v.anchor?.in !== undefined,
    };
    if (v.locus) clip.group = v.locus;
    return clip;
  });
  const links: Link[] = [];
  for (const v of c.voices) {
    const t = targetOf(v.anchor?.start ?? v.anchor?.in);
    const to = t && c.voices.find((x) => x.name === t.name);
    if (t && to) links.push({ from: { clip: v.id, edge: 'start' }, to: { clip: to.id, edge: t.edge } });
  }
  return { clips, links };
}

export function applyEdit(c: Composition, edit: ClipEdit): Composition {
  const voices = c.voices.map((v): Voice => {
    if (v.id !== edit.clip) return v;
    if (edit.kind === 'move') return { ...v, start: edit.start };
    if (edit.kind === 'passes') return { ...v, loop: edit.passes };
    if (edit.kind === 'fadeIn') return { ...v, fade: { ...v.fade, in: edit.ms } };
    if (edit.kind === 'fadeOut') return { ...v, fade: { ...v.fade, out: edit.ms } };
    const to = c.voices.find((x) => x.id === edit.link.to.clip);
    if (!to) return v;
    return { ...v, anchor: { ...v.anchor, start: edit.link.to.edge === 'end' ? { after: to.name } : { with: to.name } } };
  });
  return { ...c, voices };
}
```

- [ ] **Step 4: Run it** — expected PASS (5 tests).
- [ ] **Step 5: Commit** — `git add apps/playground && git commit -m "map playground voices to score clips and edits back"`

---

### Task 9: `ExprInput` and `CodePane`

**Files:**
- Create: `src/widgets/ExprInput/{ExprInput.tsx,ExprInput.module.css,ExprInput.stories.tsx,index.ts}`,
  `src/widgets/CodePane/{CodePane.tsx,CodePane.module.css,CodePane.stories.tsx,index.ts}`

**Interfaces:**
- Produces:
```ts
export interface ExprInputProps { value: string; onCommit(next: string): void; error?: string | null; placeholder?: string; label: string }
export function ExprInput(p: ExprInputProps): ReactElement
export interface CodePaneProps { value: string; onCommit(next: string): void; error?: string | null; errorLine?: number | null; label: string; rows?: number }
export function CodePane(p: CodePaneProps): ReactElement
```
Both keep a local draft and call `onCommit` on blur or Cmd/Ctrl+Enter (not on every keystroke, so
a half-typed expression does not recompile each key). Both show `error` under the field in a
`role="alert"` element. `CodePane` shows line numbers in a gutter and marks `errorLine`.

- [ ] **Step 1: Write `ExprInput`**

```tsx
import { type KeyboardEvent, useEffect, useState } from 'react';
import s from './ExprInput.module.css';

export interface ExprInputProps {
  value: string;
  onCommit(next: string): void;
  error?: string | null;
  placeholder?: string;
  label: string;
}

export function ExprInput({ value, onCommit, error, placeholder, label }: ExprInputProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft !== value && onCommit(draft);
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') setDraft(value);
  };
  return (
    <label className={s.field}>
      <span className={s.label}>{label}</span>
      <input className={error ? s.bad : s.input} value={draft} placeholder={placeholder} spellCheck={false}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={key} />
      {error && <span className={s.error} role="alert">{error}</span>}
    </label>
  );
}
```
`index.ts`: `export { ExprInput, type ExprInputProps } from './ExprInput';`

`ExprInput.module.css`:
```css
.field { display: grid; gap: 2px; }
.label { font: 11px var(--wzl-font-ui, sans-serif); color: var(--wzl-text-muted, #7b8494); }
.input, .bad { font: 12px ui-monospace, monospace; padding: 4px 6px; border-radius: 4px; background: var(--wzl-surface-2, #1a1f2a); color: var(--wzl-text, #e8e2d0); border: 1px solid var(--wzl-border, #2c3240); }
.bad { border-color: var(--wzl-danger, #ff6b8b); }
.error { font: 11px ui-monospace, monospace; color: var(--wzl-danger, #ff6b8b); }
```

- [ ] **Step 2: Write `CodePane`**

```tsx
import { type KeyboardEvent, useEffect, useState } from 'react';
import s from './CodePane.module.css';

export interface CodePaneProps {
  value: string;
  onCommit(next: string): void;
  error?: string | null;
  errorLine?: number | null;
  label: string;
  rows?: number;
}

export function CodePane({ value, onCommit, error, errorLine, label, rows = 6 }: CodePaneProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => draft !== value && onCommit(draft);
  const key = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
    if (e.key === 'Tab') {
      e.preventDefault();
      const el = e.currentTarget;
      const at = el.selectionStart;
      setDraft(`${draft.slice(0, at)}  ${draft.slice(el.selectionEnd)}`);
      requestAnimationFrame(() => el.setSelectionRange(at + 2, at + 2));
    }
  };
  const lines = Math.max(rows, draft.split('\n').length);
  return (
    <div className={s.pane}>
      <span className={s.label}>{label}</span>
      <div className={s.body}>
        <ol className={s.gutter} aria-hidden="true">
          {Array.from({ length: lines }, (_, i) => (
            <li key={i} className={i + 1 === errorLine ? s.marked : undefined}>{i + 1}</li>
          ))}
        </ol>
        <textarea className={s.code} value={draft} rows={lines} spellCheck={false} aria-label={label}
          onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={key} />
      </div>
      {error && <span className={s.error} role="alert">{errorLine ? `line ${errorLine}: ` : ''}{error}</span>}
    </div>
  );
}
```
`index.ts`: `export { CodePane, type CodePaneProps } from './CodePane';`

`CodePane.module.css`:
```css
.pane { display: grid; gap: 2px; }
.label { font: 11px var(--wzl-font-ui, sans-serif); color: var(--wzl-text-muted, #7b8494); }
.body { display: grid; grid-template-columns: auto 1fr; background: var(--wzl-surface-2, #1a1f2a); border: 1px solid var(--wzl-border, #2c3240); border-radius: 4px; }
.gutter { margin: 0; padding: 4px 6px; list-style: none; text-align: right; color: var(--wzl-text-muted, #59606d); font: 12px/1.5 ui-monospace, monospace; font-variant-numeric: tabular-nums; }
.marked { color: var(--wzl-danger, #ff6b8b); }
.code { resize: vertical; border: 0; background: transparent; color: var(--wzl-text, #e8e2d0); font: 12px/1.5 ui-monospace, monospace; padding: 4px 6px; tab-size: 2; }
.error { font: 11px ui-monospace, monospace; color: var(--wzl-danger, #ff6b8b); }
```

- [ ] **Step 3: Write both stories files**

`ExprInput.stories.tsx`:
```tsx
import type { Meta, StoryObj } from '@weasel-js/forge';
import { useState } from 'react';
import { ExprInput } from './index';

const meta: Meta<typeof ExprInput> = { title: 'playground/ExprInput', component: ExprInput };
export default meta;

function Harness({ initial, error }: { initial: string; error?: string }) {
  const [v, setV] = useState(initial);
  return <ExprInput label="stagger" value={v} onCommit={setV} error={error ?? null} />;
}
export const Valid: StoryObj<typeof ExprInput> = { render: () => <Harness initial="(s) => s.col * 80" /> };
export const Broken: StoryObj<typeof ExprInput> = { render: () => <Harness initial="(s) => s.col *" error="Unexpected token '}'" /> };
```

`CodePane.stories.tsx`:
```tsx
import type { Meta, StoryObj } from '@weasel-js/forge';
import { useState } from 'react';
import { CodePane } from './index';

const meta: Meta<typeof CodePane> = { title: 'playground/CodePane', component: CodePane };
export default meta;

const AT = '(phase, s, set) => ({\n  turn: Math.sin(phase * Math.PI * 2) * 30,\n  glow: phase,\n})';
function Harness({ error, line }: { error?: string; line?: number }) {
  const [v, setV] = useState(AT);
  return <div style={{ width: 420 }}><CodePane label="at" value={v} onCommit={setV} error={error ?? null} errorLine={line ?? null} /></div>;
}
export const Clean: StoryObj<typeof CodePane> = { render: () => <Harness /> };
export const ErrorOnLine2: StoryObj<typeof CodePane> = { render: () => <Harness error="s.nope is undefined" line={2} /> };
```

- [ ] **Step 4: Check** — `npm run typecheck -w @blits/playground` passes; load both stories in forge
  headless and confirm they render (no console errors).
- [ ] **Step 5: Commit** — `git add apps/playground && git commit -m "add ExprInput and CodePane widgets"`

---

### Task 10: `ChannelPlot`

**Files:**
- Create: `src/widgets/ChannelPlot/{path.ts,ChannelPlot.tsx,ChannelPlot.module.css,ChannelPlot.stories.tsx,index.ts}`
- Test: `apps/playground/test/path.test.ts`

**Interfaces:**
- Produces:
```ts
export interface Series { id: string; hue: number; values: readonly number[]; thick?: boolean }
export interface ChannelPlotProps { label: string; times: readonly number[]; series: readonly Series[]; playhead: number; width?: number; height?: number }
export function ChannelPlot(p: ChannelPlotProps): ReactElement
export function rangeOf(series: readonly Series[]): [number, number]      // padded 5%, never zero-width
export function pathOf(times: readonly number[], values: readonly number[], x: (t: number) => number, y: (v: number) => number): string
```

- [ ] **Step 1: Write the failing test** — `apps/playground/test/path.test.ts`

```ts
import { pathOf, rangeOf } from '@pg/widgets/ChannelPlot/path';
import { describe, expect, it } from 'vitest';

describe('ChannelPlot paths', () => {
  it('pads the range and never collapses it', () => {
    expect(rangeOf([{ id: 'a', hue: 0, values: [0, 10] }])).toEqual([-0.5, 10.5]);
    expect(rangeOf([{ id: 'a', hue: 0, values: [3, 3] }])).toEqual([2.5, 3.5]);
    expect(rangeOf([])).toEqual([-0.5, 0.5]);
  });
  it('builds a polyline path, skipping non-finite values', () => {
    expect(pathOf([0, 1, 2], [0, Number.NaN, 2], (t) => t * 10, (v) => v)).toBe('M0 0M20 2');
    expect(pathOf([0, 1], [1, 2], (t) => t, (v) => -v)).toBe('M0 -1L1 -2');
  });
});
```

- [ ] **Step 2: Run it** — expected FAIL.

- [ ] **Step 3: Implement**

`path.ts`:
```ts
export interface Series {
  id: string;
  hue: number;
  values: readonly number[];
  thick?: boolean;
}

export function rangeOf(series: readonly Series[]): [number, number] {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const s of series)
    for (const v of s.values)
      if (Number.isFinite(v)) {
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
  if (!Number.isFinite(lo)) return [-0.5, 0.5];
  if (hi - lo < 1e-9) return [lo - 0.5, hi + 0.5];
  const pad = (hi - lo) * 0.05;
  return [lo - pad, hi + pad];
}

export function pathOf(times: readonly number[], values: readonly number[], x: (t: number) => number, y: (v: number) => number): string {
  let d = '';
  let pen = false;
  times.forEach((t, i) => {
    const v = values[i];
    if (v === undefined || !Number.isFinite(v)) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'}${Math.round(x(t) * 100) / 100} ${Math.round(y(v) * 100) / 100}`;
    pen = true;
  });
  return d;
}
```

`ChannelPlot.tsx`:
```tsx
import { Plot2D } from '@weasel-js/ui';
import { pathOf, rangeOf, type Series } from './path';
import s from './ChannelPlot.module.css';

export interface ChannelPlotProps {
  label: string;
  times: readonly number[];
  series: readonly Series[];
  playhead: number;
  width?: number;
  height?: number;
}

export function ChannelPlot({ label, times, series, playhead, width = 320, height = 90 }: ChannelPlotProps) {
  const [lo, hi] = rangeOf(series);
  const t0 = times[0] ?? 0;
  const t1 = times[times.length - 1] ?? 1;
  const x = (t: number) => ((t - t0) / Math.max(1e-9, t1 - t0)) * width;
  const y = (v: number) => height - ((v - lo) / (hi - lo)) * height;
  return (
    <figure className={s.plot}>
      <figcaption className={s.label}>{label}</figcaption>
      <Plot2D width={width} height={height} xRange={[0, width]} yRange={[0, height]} axes={false} grid={false} aria-label={label}>
        {series.map((ser) => (
          <path key={ser.id} d={pathOf(times, ser.values, x, y)} fill="none"
            stroke={`hsl(${ser.hue} 70% 62%)`} strokeWidth={ser.thick ? 2.5 : 1} opacity={ser.thick ? 1 : 0.65} />
        ))}
        <line className={s.playhead} x1={x(playhead)} x2={x(playhead)} y1={0} y2={height} />
      </Plot2D>
    </figure>
  );
}
```
Note: Plot2D's children are in plot space. If its y axis is flipped relative to the `y` above
(check `modelToPlot` in `node_modules/@weasel-js/ui`), drop the `height -` in `y`. Verify against
the story in Step 4.

`index.ts`: `export { ChannelPlot, type ChannelPlotProps } from './ChannelPlot'; export type { Series } from './path';`

`ChannelPlot.module.css`:
```css
.plot { margin: 0; display: grid; gap: 2px; }
.label { font: 11px var(--wzl-font-ui, sans-serif); color: var(--wzl-text-muted, #7b8494); }
.playhead { stroke: var(--wzl-danger, #ff6b8b); stroke-width: 1; }
```

`ChannelPlot.stories.tsx`:
```tsx
import type { Meta, StoryObj } from '@weasel-js/forge';
import { ChannelPlot } from './index';

const meta: Meta<typeof ChannelPlot> = { title: 'playground/ChannelPlot', component: ChannelPlot };
export default meta;

const times = Array.from({ length: 121 }, (_, i) => i * 25);
const a = times.map((t) => Math.sin(t / 400));
const b = times.map((t) => (t > 1200 ? 0.6 : 0));
const folded = a.map((v, i) => v + (b[i] ?? 0));

export const TwoVoicesAndTheFold: StoryObj<typeof ChannelPlot> = {
  render: () => (
    <ChannelPlot label="turn · subject 3" times={times} playhead={1500}
      series={[{ id: 'a', hue: 220, values: a }, { id: 'b', hue: 30, values: b }, { id: 'fold', hue: 0, values: folded, thick: true }]} />
  ),
};
```

- [ ] **Step 4: Run the test and load the story** — test PASS (2); story renders with the thick
  line above the thin ones where `b` turns on.
- [ ] **Step 5: Commit** — `git add apps/playground && git commit -m "add ChannelPlot, voices thin and the fold thick"`

---

### Task 11: The stages

**Files:**
- Create: `apps/playground/src/blits/stages/draw.ts`, `stages/Stage.tsx`, `stages/Stage.module.css`

**Interfaces:**
- Consumes: `Columns` (Task 5), `Subject`, `StageSpec`.
- Produces:
  - `drawDots(ctx: CanvasRenderingContext2D, stage: { cols: number; rows: number }, cols: Columns, w: number, h: number, picked: number | null): void`
  - `drawLetters(ctx, subjects: readonly Subject[], cols: Columns, w, h, picked): void`
  - `pickAt(stage: StageSpec, subjects: readonly Subject[], x: number, y: number, w: number, h: number): number | null`
  - `Stage` component: `{ stage: StageSpec; subjects: readonly Subject[]; columns: Columns; frame: number; picked: number | null; onPick(i: number | null): void }` — redraws when `frame` changes.

Drawing rules (both stages): base position from the layout; `offset` adds pixels; `turn` is
degrees; `scale` multiplies the base size; `color` is `0xrrggbb` (`#` + 6 hex digits); `opacity`
is alpha; `glow > 0` draws a halo of radius `size * (1 + glow)` at alpha `0.25 * glow`. A rest pose
(kit rests: offset 0, turn 0, scale 1, color 0 is black — **so the stage treats color 0 as the
base color `#7aa2ff`**, documented in the panel) draws every subject at its base.

- [ ] **Step 1: Implement `draw.ts`**

```ts
import type { StageSpec } from '../composition';
import type { Columns } from '../player';
import type { Subject } from '../stage';

const BASE = '#7aa2ff';
const css = (c: number) => (c === 0 ? BASE : `#${(c & 0xffffff).toString(16).padStart(6, '0')}`);

interface Placed { x: number; y: number; size: number }

function dotsLayout(stage: { cols: number; rows: number }, w: number, h: number, i: number): Placed {
  const pad = 40;
  const col = i % stage.cols;
  const row = Math.floor(i / stage.cols);
  const dx = stage.cols > 1 ? (w - pad * 2) / (stage.cols - 1) : 0;
  const dy = stage.rows > 1 ? (h - pad * 2) / (stage.rows - 1) : 0;
  return {
    x: stage.cols > 1 ? pad + col * dx : w / 2,
    y: stage.rows > 1 ? pad + row * dy : h / 2,
    size: Math.max(3, Math.min(dx || 40, dy || 40) * 0.28),
  };
}

function lettersLayout(n: number, w: number, h: number, i: number): Placed {
  const size = Math.min(96, (w - 60) / Math.max(1, n));
  return { x: w / 2 + (i - (n - 1) / 2) * size, y: h / 2, size };
}

function paint(ctx: CanvasRenderingContext2D, p: Placed, cols: Columns, i: number, picked: boolean, shape: (r: number) => void) {
  const x = p.x + (cols.offset[i * 2] ?? 0);
  const y = p.y + (cols.offset[i * 2 + 1] ?? 0);
  const r = p.size * (cols.scale[i] ?? 1);
  const glow = cols.glow[i] ?? 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(((cols.turn[i] ?? 0) * Math.PI) / 180);
  ctx.globalAlpha = Math.max(0, Math.min(1, cols.opacity[i] ?? 1));
  const color = css(cols.color[i] ?? 0);
  if (glow > 0) {
    ctx.save();
    ctx.globalAlpha *= Math.min(1, 0.25 * glow);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, r * (1 + glow), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = color;
  shape(r);
  if (picked) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#ff6b8b';
    ctx.lineWidth = 2;
    ctx.strokeRect(-r - 4, -r - 4, r * 2 + 8, r * 2 + 8);
  }
  ctx.restore();
}

export function drawDots(ctx: CanvasRenderingContext2D, stage: { cols: number; rows: number }, cols: Columns, w: number, h: number, picked: number | null): void {
  ctx.clearRect(0, 0, w, h);
  const n = stage.cols * stage.rows;
  for (let i = 0; i < n; i++)
    paint(ctx, dotsLayout(stage, w, h, i), cols, i, i === picked, (r) => {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(0, -1, r, 2); // the tick that shows turn
    });
}

export function drawLetters(ctx: CanvasRenderingContext2D, subjects: readonly Subject[], cols: Columns, w: number, h: number, picked: number | null): void {
  ctx.clearRect(0, 0, w, h);
  subjects.forEach((s, i) =>
    paint(ctx, lettersLayout(subjects.length, w, h, i), cols, i, i === picked, (r) => {
      ctx.font = `700 ${r * 1.6}px Georgia, serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.char, 0, 0);
    }),
  );
}

export function pickAt(stage: StageSpec, subjects: readonly Subject[], x: number, y: number, w: number, h: number): number | null {
  let best: number | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  subjects.forEach((_, i) => {
    const p = stage.kind === 'dots' ? dotsLayout(stage, w, h, i) : lettersLayout(subjects.length, w, h, i);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD && d < p.size * 1.5) {
      bestD = d;
      best = i;
    }
  });
  return best;
}
```
Picking uses base positions, so a subject that has moved far is picked where it started; that is
stated in the inspector's caption.

- [ ] **Step 2: Implement `Stage.tsx` and its CSS**

```tsx
import { useEffect, useRef } from 'react';
import type { StageSpec } from '../composition';
import type { Columns } from '../player';
import type { Subject } from '../stage';
import { drawDots, drawLetters, pickAt } from './draw';
import s from './Stage.module.css';

export interface StageProps {
  stage: StageSpec;
  subjects: readonly Subject[];
  columns: Columns;
  frame: number;
  picked: number | null;
  onPick(i: number | null): void;
}

export function Stage({ stage, subjects, columns, frame, picked, onPick }: StageProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (el.width !== Math.round(w * dpr)) el.width = Math.round(w * dpr);
    if (el.height !== Math.round(h * dpr)) el.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (stage.kind === 'dots') drawDots(ctx, stage, columns, w, h, picked);
    else drawLetters(ctx, subjects, columns, w, h, picked);
  }, [stage, subjects, columns, frame, picked]);
  return (
    <canvas ref={canvas} className={s.stage} aria-label="stage"
      onPointerDown={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        onPick(pickAt(stage, subjects, e.clientX - box.left, e.clientY - box.top, box.width, box.height));
      }} />
  );
}
```
`Stage.module.css`:
```css
.stage { width: 100%; height: 100%; display: block; background: var(--wzl-surface-1, #12151c); border-radius: 6px; cursor: crosshair; }
```

- [ ] **Step 3: Check** — `npm run typecheck -w @blits/playground` passes.
- [ ] **Step 4: Commit** — `git add apps/playground && git commit -m "draw the playground's dots and letters stages"`

---

### Task 12: App shell, transport, stage and score

**Files:**
- Create: `src/app/App.tsx` (replace), `src/app/App.module.css`, `src/app/Transport.tsx`, `src/app/useComposition.ts`
- Modify: none

**Interfaces:**
- Consumes: everything above; `LabShell` from labkit; `Transport as WeaselTransport` from `@weasel-js/ui`.
- Produces:
  - `useComposition(initial: Composition): { comp; set(next: Composition): void; undo(); redo(); canUndo; canRedo }` (Task 13 adds persistence inside it; here it is plain state + labkit undo functions)
  - `App` layout: grid areas `stage inspector side` / `score score side`.

- [ ] **Step 1: `useComposition.ts`**

```ts
import { emptyStack, pushSnapshot, redo as redoOf, type UndoStack, undo as undoOf } from '@weasel-js/labkit';
import { useCallback, useState } from 'react';
import type { Composition } from '@pg/blits/composition';

export function useComposition(initial: Composition) {
  const [comp, setComp] = useState(initial);
  const [stack, setStack] = useState<UndoStack>(emptyStack());
  const set = useCallback((next: Composition) => {
    setStack((s) => pushSnapshot(s, comp, 200));
    setComp(next);
  }, [comp]);
  const undo = useCallback(() => {
    const r = undoOf(stack, comp);
    if (!r) return;
    setStack(r.stack);
    setComp(r.snapshot as Composition);
  }, [stack, comp]);
  const redo = useCallback(() => {
    const r = redoOf(stack, comp);
    if (!r) return;
    setStack(r.stack);
    setComp(r.snapshot as Composition);
  }, [stack, comp]);
  return { comp, set, undo, redo, canUndo: stack.past.length > 0, canRedo: stack.future.length > 0 };
}
```

- [ ] **Step 2: `Transport.tsx`** — play/pause, rate, loop region, live toggle, level sliders

```tsx
import { Transport as WeaselTransport } from '@weasel-js/ui';
import type { Level } from '@pg/blits/composition';
import s from './App.module.css';

export interface TransportProps {
  playing: boolean;
  onPlaying(p: boolean): void;
  rate: number;
  onRate(r: number): void;
  loop: boolean;
  onLoop(l: boolean): void;
  t: number;
  length: number;
  live: boolean;
  onLive(l: boolean): void;
  levels: readonly Level[];
  values: Record<string, number>;
  onLevel(name: string, v: number): void;
}

export function Transport(p: TransportProps) {
  return (
    <div className={s.transport}>
      <WeaselTransport paused={!p.playing} loop={p.loop} rate={p.rate} playhead={p.t} duration={p.length}
        onPlay={() => p.onPlaying(true)} onPause={() => p.onPlaying(false)}
        onLoopChange={(l) => p.onLoop(l !== false)} onRateChange={p.onRate} />
      <label className={s.live}>
        <input type="checkbox" checked={p.live} onChange={(e) => p.onLive(e.target.checked)} /> live
      </label>
      {p.live && <span className={s.badge}>live changes are temporary</span>}
      {p.levels.map((l) => (
        <label key={l.name} className={s.level}>
          {l.name}
          <input type="range" min={l.min} max={l.max} step={(l.max - l.min) / 200}
            value={p.values[l.name] ?? l.value} onChange={(e) => p.onLevel(l.name, Number(e.target.value))} />
        </label>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: `App.tsx`** — owns the player and the frame loop

```tsx
import { compile } from '@pg/blits/compile';
import type { Composition } from '@pg/blits/composition';
import { Player } from '@pg/blits/player';
import { DEFAULT } from '@pg/blits/presets';
import { applyEdit, clipsOf } from '@pg/blits/score';
import { subjectsOf } from '@pg/blits/stage';
import { Stage } from '@pg/blits/stages/Stage';
import { ScoreLanes } from '@pg/widgets/ScoreLanes';
import { LabShell } from '@weasel-js/labkit';
import { useEffect, useMemo, useRef, useState } from 'react';
import s from './App.module.css';
import { Transport } from './Transport';
import { useComposition } from './useComposition';

export function App() {
  const { comp, set, undo, redo } = useComposition(DEFAULT);
  const subjects = useMemo(() => subjectsOf(comp.stage), [comp.stage]);
  const compRef = useRef(comp);
  compRef.current = comp;
  const player = useMemo(() => new Player(() => compile(compRef.current, subjects, { solos: true }), subjects), [subjects]);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(true);
  const [live, setLive] = useState(false);
  const [levelValues, setLevelValues] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(0);

  // A new composition rebuilds at the same playhead.
  useEffect(() => {
    player.rebuild();
    for (const [k, v] of Object.entries(levelValues)) player.setLevel(k, v);
    setFrame((f) => f + 1);
  }, [comp, player]);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let id = requestAnimationFrame(function tick(now) {
      let t = player.t + (now - last) * rate;
      last = now;
      if (t > comp.length) t = loop ? 0 : comp.length;
      player.seek(t);
      setFrame((f) => f + 1);
      id = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(id);
  }, [playing, rate, loop, comp.length, player]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [undo, redo]);

  const { clips, links } = useMemo(() => clipsOf(comp, subjects), [comp, subjects]);
  const scrub = (t: number) => {
    player.seek(t);
    setFrame((f) => f + 1);
  };

  return (
    <LabShell title="blits playground" mode="dark">
      <div className={s.grid}>
        <section className={s.stage}>
          <Stage stage={comp.stage} subjects={subjects} columns={player.columns} frame={frame} picked={picked} onPick={setPicked} />
        </section>
        <section className={s.inspector}>{/* Task 15 */}</section>
        <aside className={s.side}>{/* Tasks 13–14 */}</aside>
        <section className={s.score}>
          <Transport playing={playing} onPlaying={setPlaying} rate={rate} onRate={setRate} loop={loop} onLoop={setLoop}
            t={player.t} length={comp.length} live={live} onLive={setLive} levels={comp.levels} values={levelValues}
            onLevel={(name, v) => { setLevelValues((x) => ({ ...x, [name]: v })); player.setLevel(name, v); }} />
          <ScoreLanes clips={clips} links={links} duration={comp.length} playhead={player.t} selected={selected}
            onSelect={setSelected} onScrub={scrub} onEdit={(e) => set(applyEdit(comp, e))} />
        </section>
      </div>
    </LabShell>
  );
}

export type { Composition };
```
`DEFAULT` comes from Task 14; until then create `src/blits/presets/index.ts` exporting a
`DEFAULT: Composition` with one `keys` voice so this compiles (Task 14 replaces the file).

`App.module.css`:
```css
.grid { display: grid; grid-template-columns: 1.4fr 1fr 360px; grid-template-rows: minmax(320px, 1.2fr) auto; grid-template-areas: 'stage inspector side' 'score score side'; gap: 8px; height: calc(100vh - 64px); padding: 8px; }
.stage { grid-area: stage; min-height: 0; }
.inspector { grid-area: inspector; overflow: auto; }
.side { grid-area: side; overflow: auto; display: grid; align-content: start; gap: 12px; }
.score { grid-area: score; display: grid; gap: 4px; }
.transport { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.live, .level { display: flex; align-items: center; gap: 4px; font: 12px var(--wzl-font-ui, sans-serif); }
.badge { font: 11px var(--wzl-font-ui, sans-serif); color: var(--wzl-accent, #ffd36b); }
```

- [ ] **Step 4: Check in the browser** — `npm run playground` in the background; open
  `http://localhost:4881/` headless; the stage shows dots moving, the score shows one clip with a
  moving playhead; drag the clip body and see `start` change. Screenshot, `transom post` it.
  Check the console for errors. Stop the server.
- [ ] **Step 5: Commit** — `git add apps/playground && git commit -m "lay out the playground: stage, score and transport over the player"`

---

### Task 13: Voice panel, weight, persistence and share

**Files:**
- Create: `src/app/VoicePanel.tsx`, `src/app/WeightField.tsx`, `src/blits/load.ts`
- Modify: `src/app/useComposition.ts`, `src/app/App.tsx` (render `VoicePanel` in `.side`; add a share button)
- Test: `apps/playground/test/load.test.ts`

**Interfaces:**
- Produces:
  - `load(raw: unknown): Composition | null` — accepts only `version === 1` objects with the required fields of the right types, else `null`
  - `VoicePanel` props: `{ voice: Voice; errors: FieldError[]; faults: Faults | undefined; onChange(v: Voice): void; onDelete(): void }`
  - `WeightField` props: `{ value: number | Expr; error: string | null; onChange(w: number | Expr): void }`

- [ ] **Step 1: Write the failing test** — `apps/playground/test/load.test.ts`

```ts
import { load } from '@pg/blits/load';
import { DEFAULT } from '@pg/blits/presets';
import { describe, expect, it } from 'vitest';

describe('load', () => {
  it('accepts a good composition', () => {
    expect(load(JSON.parse(JSON.stringify(DEFAULT)))).toEqual(DEFAULT);
  });
  it('refuses a wrong version, a missing field, or junk', () => {
    expect(load({ ...DEFAULT, version: 2 })).toBeNull();
    const { voices: _, ...noVoices } = DEFAULT;
    expect(load(noVoices)).toBeNull();
    expect(load({ ...DEFAULT, voices: [{ id: 'x' }] })).toBeNull();
    expect(load('nope')).toBeNull();
    expect(load(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it** — expected FAIL.

- [ ] **Step 3: Implement `load.ts`**

```ts
import type { Composition, Voice } from './composition';

const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

function voiceOk(v: unknown): v is Voice {
  if (!obj(v)) return false;
  const p = v.patch;
  return (
    typeof v.id === 'string' && typeof v.name === 'string' && num(v.hue) && num(v.start) && num(v.rate) &&
    (typeof v.loop === 'boolean' || num(v.loop)) && (num(v.weight) || obj(v.weight)) && obj(v.fade) &&
    obj(p) && (p.kind === 'keys' || p.kind === 'fn' || p.kind === 'spring' || p.kind === 'glide' || p.kind === 'tween')
  );
}

export function load(raw: unknown): Composition | null {
  if (!obj(raw) || raw.version !== 1) return null;
  if (typeof raw.title !== 'string' || !num(raw.length) || !obj(raw.stage)) return null;
  if (!Array.isArray(raw.levels) || !Array.isArray(raw.voices) || !raw.voices.every(voiceOk)) return null;
  const st = raw.stage;
  if (!(st.kind === 'dots' && num(st.cols) && num(st.rows)) && !(st.kind === 'letters' && typeof st.text === 'string')) return null;
  return raw as unknown as Composition;
}
```

- [ ] **Step 4: Run it** — expected PASS (2 tests).

- [ ] **Step 5: Persist and share in `useComposition`**

Replace the `useState(initial)` line with a lazy initializer that prefers the URL hash, then
localStorage, then `initial`, each through `load`:
```ts
const KEY = 'blits-playground:composition';
function first(initial: Composition): Composition {
  try {
    const hash = new URLSearchParams(location.hash.slice(1)).get('c');
    const fromHash = hash ? load(JSON.parse(decodeURIComponent(atob(hash)))) : null;
    if (fromHash) return fromHash;
    const stored = localStorage.getItem(KEY);
    return (stored && load(JSON.parse(stored))) || initial;
  } catch {
    return initial;
  }
}
```
and add an effect that writes `localStorage.setItem(KEY, JSON.stringify(comp))` (in try/catch) on
every change, plus a `share()` returning
`${location.origin}${location.pathname}#c=${btoa(encodeURIComponent(JSON.stringify(comp)))}`.
(labkit's `urlHashAdapter`/`localStorageAdapter` are async key-value stores; for one value read
once at startup, the direct calls above are simpler and give `load` the raw value to validate. Say
so in the commit body.) In `App`, add a "share" button that copies `share()` to the clipboard.

- [ ] **Step 6: `WeightField.tsx`**

```tsx
import { ExprInput } from '@pg/widgets/ExprInput';
import type { Expr } from '@pg/blits/composition';

const PRESETS: Record<string, string> = {
  'follow a level': 'slew(level("mouse"), { riseMs: 200, fallMs: 600 })',
  'by column': '(s) => s.x',
  'pulse': '(s, set) => 0.5 + 0.5 * Math.sin(set.timestamp / 300 + s.index)',
};

export function WeightField({ value, error, onChange }: { value: number | Expr; error: string | null; onChange(w: number | Expr): void }) {
  const isNum = typeof value === 'number';
  return (
    <div>
      <label>
        weight{' '}
        <select value={isNum ? 'number' : 'signal'} onChange={(e) => onChange(e.target.value === 'number' ? 1 : { code: '(s) => 1' })}>
          <option value="number">number</option>
          <option value="signal">signal</option>
        </select>
      </label>
      {isNum ? (
        <input type="number" step={0.05} min={0} max={1} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      ) : (
        <>
          <ExprInput label="signal" value={value.code} error={error} onCommit={(code) => onChange({ code })} />
          <select value="" onChange={(e) => e.target.value && onChange({ code: PRESETS[e.target.value] as string })}>
            <option value="">insert…</option>
            {Object.keys(PRESETS).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 7: `VoicePanel.tsx`** — ControlPanel for scalar fields, ExprInputs for expressions

```tsx
import { ControlPanel, type ConfigField, fromConfigFields } from '@weasel-js/labkit';
import type { FieldError } from '@pg/blits/compile';
import type { Voice } from '@pg/blits/composition';
import type { Faults } from '@pg/blits/expr';
import { ExprInput } from '@pg/widgets/ExprInput';
import { docOf } from './docs';
import { WeightField } from './WeightField';

const FIELDS: ConfigField[] = [
  { key: 'name', label: 'name', type: 'text', default: '' },
  { key: 'start', label: 'start', type: 'number', default: 0, min: 0, step: 10 },
  { key: 'rate', label: 'rate', type: 'slider', default: 1, min: 0, max: 4, step: 0.05 },
  { key: 'loopForGood', label: 'loop for good', type: 'checkbox', default: true },
  { key: 'passes', label: 'passes', type: 'number', default: 1, min: 1, step: 1 },
  { key: 'fadeIn', label: 'fade in', type: 'number', default: 0, min: 0, step: 10 },
  { key: 'fadeOut', label: 'fade out', type: 'number', default: 0, min: 0, step: 10 },
  { key: 'hold', label: 'hold', type: 'select', default: 'none', options: ['none', 'before', 'after', 'both'].map((v) => ({ value: v, label: v })) },
  { key: 'locus', label: 'locus', type: 'text', default: '' },
  { key: 'fromCurrent', label: "from: 'current'", type: 'checkbox', default: false },
].map((f) => ({ ...f, label: f.label })) as ConfigField[];
const SCHEMA = fromConfigFields(FIELDS);

export interface VoicePanelProps {
  voice: Voice;
  errors: FieldError[];
  faults: Faults | undefined;
  onChange(v: Voice): void;
  onDelete(): void;
}

export function VoicePanel({ voice: v, errors, faults, onChange, onDelete }: VoicePanelProps) {
  const errorOf = (field: string) => errors.find((e) => e.voice === v.id && e.field === field)?.error ?? null;
  const config = {
    name: v.name, start: v.start, rate: v.rate,
    loopForGood: v.loop === true, passes: typeof v.loop === 'number' ? v.loop : 1,
    fadeIn: v.fade.in ?? 0, fadeOut: v.fade.out ?? 0,
    hold: v.hold ?? 'none', locus: v.locus ?? '', fromCurrent: v.from === 'current',
  };
  const setConfig = (path: string, value: unknown) => {
    const n = { ...config, [path]: value };
    onChange({
      ...v,
      name: n.name, start: n.start, rate: n.rate,
      loop: n.loopForGood ? true : n.passes,
      fade: { ...v.fade, in: n.fadeIn, out: n.fadeOut },
      hold: n.hold === 'none' ? undefined : (n.hold as Voice['hold']),
      locus: n.locus || undefined,
      from: n.fromCurrent ? 'current' : undefined,
    });
  };
  return (
    <section aria-label={`voice ${v.name}`}>
      <ControlPanel title={`voice · ${v.name}`} schema={SCHEMA} config={config} setConfig={setConfig} />
      <ExprInput label="stagger" placeholder="(s) => s.col * 80" value={v.stagger?.code ?? ''} error={errorOf('stagger')}
        onCommit={(code) => onChange({ ...v, stagger: code ? { code } : undefined })} />
      <ExprInput label="target" placeholder="(s) => s.row === 0" value={v.target?.code ?? ''} error={errorOf('target')}
        onCommit={(code) => onChange({ ...v, target: code ? { code } : undefined })} />
      <WeightField value={v.weight} error={errorOf('weight')} onChange={(weight) => onChange({ ...v, weight })} />
      {faults && faults.count > 0 && <p role="status">{faults.count} calls threw; first: {faults.first}</p>}
      <p title={docOf('VoiceSpec.anchor')}>
        anchor: {v.anchor ? JSON.stringify(v.anchor) : 'none'}{' '}
        {v.anchor && <button type="button" onClick={() => onChange({ ...v, anchor: undefined })}>clear</button>}
      </p>
      <button type="button" onClick={onDelete}>delete voice</button>
    </section>
  );
}
```
`docOf` comes from Task 15; until then create `src/app/docs.ts` with
`export const docOf = (_: string): string | undefined => undefined;`.

In `App.tsx`, render in `.side`: an "add voice" button (appends a `keys` voice with a fresh id
`v${Date.now().toString(36)}` and hue `(voices.length * 67) % 360`), then the selected voice's
`VoicePanel` (`selected` from the score) wired to `set({ ...comp, voices: comp.voices.map(...) })`.
`errors` and `faults` come from `player.built`.

- [ ] **Step 8: Check in the browser** — select a clip, change `rate`, type a bad stagger and see
  the error under it while the stage keeps playing; reload and see the composition kept; open the
  share link in a new headless page and see the same composition; open `#c=garbage` and see the
  default. Screenshot each and `transom post` them.
- [ ] **Step 9: Commit** — `git add apps/playground && git commit -m "edit a voice's spec, keep the composition, and share it by link"`

---

### Task 14: Patch panels and presets

**Files:**
- Create: `src/app/PatchPanel.tsx`, `src/blits/presets/{index.ts,stagger-wave.ts,crossfade.ts,spring-retarget.ts,hold-handover.ts,pointer-glow.ts,fold-rules.ts}`
- Modify: `src/app/App.tsx` (render `PatchPanel` under `VoicePanel`; a preset menu in the header)
- Test: `apps/playground/test/presets.test.ts`

**Interfaces:**
- Produces: `PRESETS: { name: string; comp: Composition }[]`, `DEFAULT = PRESETS[0].comp`;
  `PatchPanel` props `{ voice: Voice; errors: FieldError[]; playhead: number; onChange(v: Voice): void }`.

- [ ] **Step 1: Write the failing test** — `apps/playground/test/presets.test.ts`

```ts
import { compile, FRAME } from '@pg/blits/compile';
import { Player } from '@pg/blits/player';
import { PRESETS } from '@pg/blits/presets';
import { subjectsOf } from '@pg/blits/stage';
import { describe, expect, it } from 'vitest';

describe.each(PRESETS)('preset $name', ({ comp }) => {
  it('compiles with no errors and plays a second with no faults', () => {
    const subjects = subjectsOf(comp.stage);
    const p = new Player(() => compile(comp, subjects, { solos: true }), subjects);
    expect(p.built.errors).toEqual([]);
    p.seek(1000);
    for (const f of p.built.faults.values()) expect(f.count).toBe(0);
    expect(p.t).toBeCloseTo(Math.floor(1000 / FRAME) * FRAME, 9);
  });
});

it('has the six presets the spec lists', () => {
  expect(PRESETS.map((x) => x.name)).toEqual(['stagger wave', 'crossfade', 'spring retarget', 'hold handover', 'pointer glow', 'fold rules']);
});
```

- [ ] **Step 2: Run it** — expected FAIL.

- [ ] **Step 3: Write the presets.** Each file default-exports a `Composition`. Full contents:

`stagger-wave.ts`:
```ts
import type { Composition } from '../composition';
const c: Composition = {
  version: 1, title: 'stagger wave', stage: { kind: 'dots', cols: 12, rows: 6 }, length: 4000, levels: [],
  voices: [{
    id: 'wave', name: 'wave', hue: 220, start: 0, rate: 1, loop: true, weight: 1, fade: { in: 400 },
    stagger: { code: '(s) => s.col * 90 + s.row * 30' },
    patch: { kind: 'keys', period: 1200, ease: 'ease-in-out', stops: [
      { at: 0, delta: { offset: [0, 0], scale: 1 } },
      { at: 0.5, delta: { offset: [0, -18], scale: 1.6 } },
      { at: 1, delta: { offset: [0, 0], scale: 1 } },
    ] },
  }],
};
export default c;
```

`crossfade.ts`:
```ts
import type { Composition } from '../composition';
const c: Composition = {
  version: 1, title: 'crossfade', stage: { kind: 'dots', cols: 8, rows: 4 }, length: 6000,
  levels: [{ name: 'mix', value: 0.5, min: 0, max: 1 }],
  voices: [
    { id: 'warm', name: 'warm', hue: 25, start: 0, rate: 1, loop: true, locus: 'tone', fade: {},
      weight: { code: '(s, set) => 1 - level("mix")(s, set)' },
      patch: { kind: 'keys', period: 1000, stops: [{ at: 0, delta: { color: 0xff8f3f, scale: 1.4 } }] } },
    { id: 'cool', name: 'cool', hue: 200, start: 0, rate: 1, loop: true, locus: 'tone', fade: {},
      weight: { code: 'level("mix")' },
      patch: { kind: 'keys', period: 1000, stops: [{ at: 0, delta: { color: 0x3fa9ff, scale: 0.7 } }] } },
  ],
};
export default c;
```

`spring-retarget.ts`:
```ts
import type { Composition } from '../composition';
const c: Composition = {
  version: 1, title: 'spring retarget', stage: { kind: 'dots', cols: 6, rows: 3 }, length: 5000, levels: [],
  voices: [{
    id: 'spring', name: 'spring', hue: 280, start: 0, rate: 1, loop: true, weight: 1, fade: {},
    patch: { kind: 'spring', channel: 'offset', opts: { from: [0, -60], to: { code: '(s) => [0, 0]' }, stiffness: 120, damping: 8 } },
  }],
};
export default c;
```

`hold-handover.ts`:
```ts
import type { Composition } from '../composition';
const c: Composition = {
  version: 1, title: 'hold handover', stage: { kind: 'letters', text: 'blits' }, length: 5000, levels: [],
  voices: [
    { id: 'rise', name: 'rise', hue: 45, start: 0, rate: 1, loop: 1, hold: 'after', weight: 1, fade: {},
      stagger: { code: '(s) => s.index * 120' },
      patch: { kind: 'keys', period: 800, ease: 'ease-out', stops: [
        { at: 0, delta: { offset: [0, 0] } }, { at: 1, delta: { offset: [0, -30], color: 0xffd36b } },
      ] } },
    { id: 'drop', name: 'drop', hue: 330, start: 0, rate: 1, loop: 1, weight: 1, fade: { in: 200 },
      anchor: { start: { after: 'rise' } },
      patch: { kind: 'keys', period: 1000, stops: [
        { at: 0, delta: { turn: 0 } }, { at: 1, delta: { turn: 360 } },
      ] } },
  ],
};
export default c;
```
(`rise` holds after, so its `end` is unfixed and `drop`, anchored after it, waits pending — the
score shows the dashed link and a pending clip; fading `rise` in live mode starts `drop`. That is
the lesson the preset carries; the panel caption says so.)

`pointer-glow.ts`:
```ts
import type { Composition } from '../composition';
const c: Composition = {
  version: 1, title: 'pointer glow', stage: { kind: 'dots', cols: 10, rows: 5 }, length: 4000,
  levels: [{ name: 'mouse', value: 0, min: 0, max: 1 }],
  voices: [{
    id: 'glow', name: 'glow', hue: 50, start: 0, rate: 1, loop: true, fade: {},
    weight: { code: 'slew(level("mouse"), { riseMs: 150, fallMs: 900 })' },
    patch: { kind: 'keys', period: 1000, stops: [{ at: 0, delta: { glow: 1.5, color: 0xffe08a } }] },
  }],
};
export default c;
```

`fold-rules.ts`:
```ts
import type { Composition } from '../composition';
const v = (id: string, hue: number, start: number, delta: Record<string, number>) => ({
  id, name: id, hue, start, rate: 1, loop: 1 as const, weight: 1, fade: { in: 300, out: 300 },
  patch: { kind: 'keys' as const, period: 2000, stops: [{ at: 0, delta }] },
});
const c: Composition = {
  version: 1, title: 'fold rules', stage: { kind: 'dots', cols: 3, rows: 1 }, length: 5000, levels: [],
  voices: [
    v('sum a', 10, 0, { turn: 30 }), v('sum b', 40, 1000, { turn: 30 }),
    v('mul a', 160, 0, { scale: 1.5 }), v('mul b', 190, 1000, { scale: 1.5 }),
    v('max a', 260, 0, { glow: 0.6 }), v('max b', 290, 1000, { glow: 0.9 }),
  ],
};
export default c;
```

`index.ts`:
```ts
import type { Composition } from '../composition';
import crossfade from './crossfade';
import foldRules from './fold-rules';
import holdHandover from './hold-handover';
import pointerGlow from './pointer-glow';
import springRetarget from './spring-retarget';
import staggerWave from './stagger-wave';

export const PRESETS: { name: string; comp: Composition }[] = [
  { name: 'stagger wave', comp: staggerWave },
  { name: 'crossfade', comp: crossfade },
  { name: 'spring retarget', comp: springRetarget },
  { name: 'hold handover', comp: holdHandover },
  { name: 'pointer glow', comp: pointerGlow },
  { name: 'fold rules', comp: foldRules },
];

export const DEFAULT: Composition = staggerWave;
```

- [ ] **Step 4: Run it** — expected PASS (7 tests). `level("mix")` in an expression is the composition's shared level signal (Task 4), so `crossfade`'s two weights always sum to 1.

- [ ] **Step 5: `PatchPanel.tsx`** — one editor per kind

```tsx
import { stopsOf, tracksOf } from '@pg/blits/keys';
import type { FieldError } from '@pg/blits/compile';
import type { PatchSource, Voice } from '@pg/blits/composition';
import { CHANNELS, type ChannelName } from '@pg/blits/kit';
import { CodePane } from '@pg/widgets/CodePane';
import { ExprInput } from '@pg/widgets/ExprInput';
import type { SampledTrack } from '@weasel-js/core';
import { Timeline } from '@weasel-js/ui';
import { useState } from 'react';

export interface PatchPanelProps { voice: Voice; errors: FieldError[]; playhead: number; onChange(v: Voice): void }

export function PatchPanel({ voice: v, errors, playhead, onChange }: PatchPanelProps) {
  const p = v.patch;
  const set = (patch: PatchSource) => onChange({ ...v, patch });
  const err = (field: string) => errors.find((e) => e.voice === v.id && e.field === field);
  const [mode, setMode] = useState<'dope' | 'graph'>('dope');
  return (
    <section aria-label="patch">
      <label>
        kind{' '}
        <select value={p.kind} onChange={(e) => set(blank(e.target.value as PatchSource['kind']))}>
          {['keys', 'fn', 'spring', 'glide', 'tween'].map((k) => <option key={k}>{k}</option>)}
        </select>
      </label>
      {(p.kind === 'keys' || p.kind === 'fn') && (
        <label>period <input type="number" min={0} step={50} value={p.period} onChange={(e) => set({ ...p, period: Number(e.target.value) })} /></label>
      )}
      {p.kind === 'keys' && (
        <div style={{ height: 220 }}>
          <Timeline tracks={tracksOf(p.stops, p.period)} duration={p.period} playhead={p.period > 0 ? playhead % p.period : 0}
            mode={mode} onModeChange={setMode} transport={false} onScrub={() => {}}
            onChange={(tracks) => set({ ...p, stops: stopsOf(tracks as SampledTrack<unknown>[], p.period) })} />
        </div>
      )}
      {p.kind === 'fn' && (
        <>
          <fieldset>
            <legend>writes</legend>
            {CHANNELS.map((ch) => (
              <label key={ch}>
                <input type="checkbox" checked={p.writes.includes(ch)}
                  onChange={(e) => set({ ...p, writes: e.target.checked ? [...p.writes, ch] : p.writes.filter((x) => x !== ch) })} /> {ch}
              </label>
            ))}
          </fieldset>
          <CodePane label="at (phase, s, setting) => delta" value={p.at} error={err('at')?.error ?? null} errorLine={err('at')?.line ?? null} onCommit={(at) => set({ ...p, at })} />
          <CodePane label="state (s) => initial" rows={2} value={p.state ?? ''} error={err('state')?.error ?? null} onCommit={(x) => set({ ...p, state: x || undefined })} />
          <CodePane label="step (state, dt, s, setting) => void" rows={3} value={p.step ?? ''} error={err('step')?.error ?? null} onCommit={(x) => set({ ...p, step: x || undefined })} />
        </>
      )}
      {(p.kind === 'spring' || p.kind === 'glide' || p.kind === 'tween') && (
        <>
          <label>
            channel{' '}
            <select value={p.channel} onChange={(e) => set({ ...p, channel: e.target.value as ChannelName })}>
              {CHANNELS.map((ch) => <option key={ch}>{ch}</option>)}
            </select>
          </label>
          {Object.entries(p.opts).map(([k, val]) => (
            <ExprInput key={k} label={k} value={typeof val === 'object' && !Array.isArray(val) ? val.code : JSON.stringify(val)}
              error={err(`opts.${k}`)?.error ?? null}
              onCommit={(text) => {
                let next: number | number[] | { code: string };
                try { next = JSON.parse(text); } catch { next = { code: text }; }
                set({ ...p, opts: { ...p.opts, [k]: next } });
              }} />
          ))}
        </>
      )}
    </section>
  );
}

function blank(kind: PatchSource['kind']): PatchSource {
  if (kind === 'keys') return { kind, period: 1000, stops: [{ at: 0, delta: { scale: 1 } }, { at: 1, delta: { scale: 1.5 } }] };
  if (kind === 'fn') return { kind, period: 1000, writes: ['turn'], at: '(phase) => ({ turn: phase * 360 })' };
  if (kind === 'spring') return { kind, channel: 'offset', opts: { from: [0, -40], to: [0, 0], stiffness: 170, damping: 26 } };
  if (kind === 'glide') return { kind, channel: 'offset', opts: { from: [0, 0], velocity: [200, 0], ms: 325 } };
  return { kind, channel: 'offset', opts: { from: [0, 0], to: [40, 0], ms: 600 } };
}
```
The `style={{ height: 220 }}` is required: `Timeline` is a flex column that collapses in a
container with no height (see weasel's Timeline story). Move it to a CSS module class if one
already exists in the panel by this point.

In `App.tsx`: render `PatchPanel` under `VoicePanel`, and a `<select>` in `LabShell`'s `header`
listing `PRESETS` that calls `set(preset.comp)`.

- [ ] **Step 6: Check in the browser** — load each preset from the menu; edit a keys stop in the
  timeline and see the stage change; break an `fn`'s `at` and see the line marked. Screenshot,
  `transom post`.
- [ ] **Step 7: Commit** — `git add apps/playground && git commit -m "edit patches by kind and ship six starter compositions"`

---

### Task 15: Inspector, live mode and field docs

**Files:**
- Create: `src/app/Inspector.tsx`
- Modify: `src/app/App.tsx`, `src/app/VoicePanel.tsx`, `src/app/docs.ts`, `scripts/docs.mjs`

**Interfaces:**
- Consumes: `Player.solo`, `ChannelPlot`, `Handle` from `@msb235/blits`.
- Produces: `Inspector` props `{ player: Player; comp: Composition; picked: number | null; frame: number }`;
  `docOf(path: string): string | undefined` reading `src/generated/docs.json` (`{ "VoiceSpec.loop": "…", … }`).

- [ ] **Step 1: Inspector** — keeps a rolling 3 s history per channel for the picked subject: the
  full mix's value and each voice's solo value, sampled each `frame`.

```tsx
import type { Composition } from '@pg/blits/composition';
import { CHANNELS } from '@pg/blits/kit';
import { type Columns, Player } from '@pg/blits/player';
import { ChannelPlot, type Series } from '@pg/widgets/ChannelPlot';
import { useEffect, useMemo, useRef, useState } from 'react';

const WINDOW = 3000;
type Sample = { t: number; full: Record<string, number>; solos: Record<string, Record<string, number>> };

const read = (cols: Columns, ch: string, i: number) =>
  ch === 'offset' ? (cols.offset[i * 2 + 1] ?? 0) : ((cols as unknown as Record<string, Float64Array>)[ch]?.[i] ?? 0);

export function Inspector({ player, comp, picked, frame }: { player: Player; comp: Composition; picked: number | null; frame: number }) {
  const scratch = useMemo(() => Player.columnsFor(player.subjects.length), [player]);
  const history = useRef<Sample[]>([]);
  const [, bump] = useState(0);
  useEffect(() => { history.current = []; }, [picked, comp]);
  useEffect(() => {
    if (picked === null) return;
    const full: Record<string, number> = {};
    for (const ch of CHANNELS) full[ch] = read(player.columns, ch, picked);
    const solos: Sample['solos'] = {};
    for (const v of comp.voices) {
      player.solo(v.id, scratch);
      solos[v.id] = Object.fromEntries(CHANNELS.map((ch) => [ch, read(scratch, ch, picked)]));
    }
    const h = history.current;
    if (h.length > 0 && player.t < (h[h.length - 1] as Sample).t) h.length = 0;
    h.push({ t: player.t, full, solos });
    while (h.length > 0 && (h[0] as Sample).t < player.t - WINDOW) h.shift();
    bump((x) => x + 1);
  }, [frame, picked]);
  if (picked === null) return <p>Click a subject on the stage.</p>;
  const h = history.current;
  const times = h.map((x) => x.t);
  return (
    <div>
      <p>subject {picked} · picked at its resting place · offset plots y</p>
      {CHANNELS.map((ch) => {
        const series: Series[] = comp.voices
          .filter((v) => h.some((x) => x.solos[v.id]))
          .map((v) => ({ id: v.id, hue: v.hue, values: h.map((x) => x.solos[v.id]?.[ch] ?? Number.NaN) }));
        series.push({ id: 'fold', hue: 0, values: h.map((x) => x.full[ch] ?? Number.NaN), thick: true });
        return <ChannelPlot key={ch} label={ch} times={times} series={series} playhead={player.t} />;
      })}
    </div>
  );
}
```
(The full mix and the solos are already stepped by the player each frame, so the inspector only
reads; `player.solo` pulls one solo's columns at the current `t`.)

- [ ] **Step 2: Live mode** — in `App.tsx`, when `live` is on, the `VoicePanel` gets an extra row
  of live controls for the selected voice, acting on `player.built.handles.get(id)`:
  weight slider (`handle.weight = x`), `fade()` button, `seek` number input
  (`handle.seek(ms)`), `ramp` (rate + over), and for motion voices a "retarget" `ExprInput`
  (`(s) => target`) that calls `(player.built.patches.get(id) as { to(s: Subject, v: unknown): void }).to(subject, fn(subject))`
  for every subject. A live control never calls `set()`; any `set()` or backward `seek` rebuilds and
  drops the live state. Show the badge from Task 12.

- [ ] **Step 3: Field docs** — replace the stub `scripts/docs.mjs`:

```js
// Pulls the doc comments of VoiceSpec and Handle members out of blits' types for field tooltips.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Application } from 'typedoc';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const app = await Application.bootstrap({
  entryPoints: [`${root}src/index.ts`],
  tsconfig: `${root}tsconfig.json`,
  excludePrivate: true,
  logLevel: 'Warn',
});
const project = await app.convert();
const out = {};
for (const name of ['VoiceSpec', 'Handle']) {
  const decl = project?.getChildByName(name);
  for (const child of decl?.children ?? []) {
    const text = child.comment?.summary?.map((p) => p.text).join('') ?? child.signatures?.[0]?.comment?.summary?.map((p) => p.text).join('');
    if (text) out[`${name}.${child.name}`] = text.trim();
  }
}
const dir = new URL('../src/generated/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('docs.json', dir), `${JSON.stringify(out, null, 2)}\n`);
console.log(`docs: ${Object.keys(out).length} fields`);
```

`src/app/docs.ts`:
```ts
import docs from '@pg/generated/docs.json';
export const docOf = (path: string): string | undefined => (docs as Record<string, string>)[path];
```
In `VoicePanel`, give each `ExprInput`/field wrapper `title={docOf('VoiceSpec.<key>')}` (keys:
`stagger`, `target`, `weight`, `start`, `rate`, `loop`, `fade`, `hold`, `locus`, `from`).

- [ ] **Step 4: Check** — `npm run docs -w @blits/playground` prints a count above 15; in the
  browser, hovering `stagger` shows blits' own doc comment; pick a dot and see its six plots fill;
  in `fold rules`, the `turn` plot shows two thin lines and a thick line at their sum. Toggle live,
  drag a weight, see the badge; scrub back, see the live change gone. Screenshot, `transom post`.
- [ ] **Step 5: Commit** — `git add apps/playground && git commit -m "add the inspector, live handle controls, and blits' own docs on each field"`

---

### Task 16: Smoke run, wiring, README

**Files:**
- Create: `apps/playground/scripts/smoke.mjs`, `apps/playground/README.md`
- Modify: root `package.json` (`check`), `site/src/` nav (link to the playground), `HANDOFF.md`
- Delete: `docs/superpowers/specs/2026-10-03-playground-design.md`, this plan

- [ ] **Step 1: `scripts/smoke.mjs`** — serves `dist`, loads each preset, plays one second

```js
// Loads the built playground once per preset in headless Chromium, plays a second, and fails on
// any console error, page error, or a stage that drew nothing.
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer((req, res) => {
  let path = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html');
  if (!existsSync(path)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' });
  createReadStream(path).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}/`;
const shots = mkdtempSync(join(tmpdir(), 'playground-smoke-'));
const browser = await chromium.launch({ headless: true });
let failed = 0;
try {
  const probe = await browser.newPage();
  await probe.goto(origin, { waitUntil: 'networkidle' });
  const names = await probe.locator('header select option').allTextContents();
  await probe.close();
  for (const [i, name] of names.entries()) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.locator('header select').selectOption({ label: name });
    await page.waitForTimeout(1000);
    const drawn = await page.locator('canvas[aria-label=stage]').evaluate((c) => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let k = 3; k < d.length; k += 4) if (d[k] > 0) return true;
      return false;
    });
    if (!drawn) errors.push('stage drew nothing');
    await page.screenshot({ path: join(shots, `${i}.png`) });
    const ok = errors.length === 0;
    if (!ok) failed++;
    console.log(`${String(i + 1).padStart(2)}/${names.length}  ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    for (const e of errors) console.log(`       ${e}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
  rmSync(shots, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
```
(The preset `<select>` must live in `LabShell`'s `header`; if labkit renders `header` in another
element, adjust both selectors to the preset select's `aria-label="preset"` and give it that
label in Task 14.)

- [ ] **Step 2: Run it** — `npm run playground:smoke`. Expected: one `ok` line per preset, exit 0.
- [ ] **Step 3: Wire `check`** — root `"check"` becomes
  `npm run lint && npm run typecheck && npm run test && npm run playground:smoke`.
- [ ] **Step 4: Site link** — find the site's nav component (`grep -rn "href=" site/src/components | head`)
  and add a "playground" link to `http://localhost:4881/` for local dev, labeled as local-only.
- [ ] **Step 5: README and cleanup** — write `apps/playground/README.md` holding what in the spec
  stays true (purpose, run commands, the kit table, the score mapping table, where widgets live and
  that they must not import blits, the presets), then `git rm` the spec and this plan, and add a
  line to `HANDOFF.md`'s State list pointing at the README.
- [ ] **Step 6: Full local check of the touched area** — `npx biome check .`, `npm run typecheck`,
  `npx vitest run apps/playground/test`, `npm run playground:smoke`. All green.
- [ ] **Step 7: Commit** — `git add -A apps/playground package.json site HANDOFF.md docs && git commit -m "smoke-test every preset, link the playground from the site, and fold its design into a README"`

---

## Self-review notes

- Spec coverage: purpose/where (T1), kit (T2), composition (T2), expressions + guard (T3), compile
  + solos (T4), runtime play/scrub/levels (T5, T12), score (T7, T8), voice/weight panels (T13),
  patch panels (T14), inspector + live mode + docs tooltips (T15), state/share/undo (T12, T13),
  presets (T14), testing incl. smoke (T4–T8, T10, T13, T14, T16). Reading back, events and level
  recording are out of scope per the spec.
