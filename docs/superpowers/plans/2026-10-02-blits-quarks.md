# blits-quarks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status: written 2026-10-02, nothing built.** Delete this file when the last task lands.

**Goal:** Ship `@msb235/blits-quarks`, a separate package in `packages/quarks` that turns each subject's pose from a blits mix into three.quarks particles: how many to emit, where, and with what start values.

**Architecture:** Subjects are emission points that may share one quarks system. Each `write(dt)` probes every attached subject, works out its particle count from a `rate` carry plus drained burst events, then for each subject writes its start values into the shared system (scaled from values captured at attach), emits at its position through the public `emit` with a burst index past the system's own bursts, and finally restores the authored values. Nothing else about quarks is wrapped.

**Tech Stack:** TypeScript 7 (`tsc -b`, project references), vitest 4, biome 2, Node 26, three 0.185, three.quarks 0.17. The engine stays zero-dependency; the package takes `three` and `three.quarks` as peers.

**Spec:** `docs/superpowers/specs/2026-10-02-blits-quarks-design.md`. Read it first.

---

## Commands

| What | Command (repo root) |
|---|---|
| Package tests | `npx vitest run packages/quarks` |
| Whole suite | `npx vitest run` |
| Lint | `npx biome check src test bench packages` |
| Typecheck | `npm run typecheck` (after Task 1 it covers the package) |

Every commit message is imperative with no prefix and ends with a `Co-Authored-By:` line naming the model that wrote it.

## Facts this plan rests on (checked 2026-10-02 against three.quarks 0.17.1, three 0.185.1)

- three.quarks runs in plain Node: `new ParticleSystem({...})` and `system.emit(...)` work without WebGL, and spawned particles are readable as `system.particles[0 .. particleNum)`, each with `startSpeed` (number), `life` (number), `startSize` (Vector3), `startColor` (Vector4), `position` (Vector3). Importing three.quarks prints one banner line; harmless. So the tests use real quarks, no fake.
- `emit(delta, state, matrix)` is public; `spawn` is private. `emit` spawns `ceil(state.waitEmiting)` particles, then fires the system's own `emissionBursts` from `state.burstIndex`, then adds `delta × emissionOverTime`. Calling it with `delta = 0` and `burstIndex = system.emissionBursts.length` spawns exactly the count asked and nothing else.
- `spawn` samples `startColor`, `startSpeed`, `startLife`, `startSize` per particle at birth, which is what makes per-subject values on a shared system work.
- `ConstantValue`, `IntervalValue` and `ConstantColor` all report `type === 'value'`, so they are told apart with `instanceof`.
- `EmissionState` (from `quarks.core`) is `{ burstIndex, burstWaveIndex, burstParticleIndex, burstParticleCount, isBursting, time, waitEmiting, travelDistance, previousWorldPos? }`.
- quarks' `emit` takes quarks' own `Matrix4` type; three's `Matrix4` works at runtime and needs a cast, as in magicsmoke's `src/sparks/emitters.ts`.
- A `step` does not run on a subject's first probe (the record is created stepped to now), so an event sent from `step` arrives on the second frame.
- npm workspaces only link workspace members, and the repo root (the engine) is not one: a lockfile check shows npm installs the workspace's `@msb235/blits` dependency from the registry (0.2.1) without conflict. So the package reads the engine's source through a TypeScript path and a vitest alias during development, and the published engine at its pinned version once a user installs it.
- `Handle.weight` is a settable number; `Particle` is exported by three.quarks as a type.

## Decisions this plan makes that the spec left open

- **`drive` takes the kit**: `drive(mix, { kit, bursts? })`. A `Mix` does not expose its kit, and refusing an unscalable generator at `attach` needs to know which channels are present before any probe.
- **A system must have `worldSpace: true`**, refused at `attach` otherwise. With `worldSpace: false` quarks ignores the emit position (or keeps a reference to the matrix as `parentMatrix`), so `at` could not be honored.
- **The rate carry is kept in particle-milliseconds** (`carry += rate × dt`, `count = floor(carry / 1000)`), so integer rates and frame times count exactly. A rate at or below 0 adds nothing; it never builds a debt.
- **Burst counts are floored, and a count at or below 0 adds nothing.**
- **Restore happens once per system at the end of `write`**, not after each subject.
- **Attaching a subject twice throws.** `detach` of the last subject on a system restores its authored values and forgets them, so a later `attach` recaptures what the host has set since.
- **The engine pin** is the engine's version in the root `package.json` at the time of the driver's release (0.2.1 today). The release workflow refuses to publish the driver if that version is not on npm.

## File structure

| File | Responsibility | Status |
|---|---|---|
| `packages/quarks/package.json` | Name, version 0.1.0, exact engine pin, peers, dev deps, `exports`, `files`, `build` | Create |
| `packages/quarks/tsconfig.json` | Composite build of `src` to `dist`, referencing the engine | Create |
| `packages/quarks/tsconfig.test.json` | Typecheck of `src` and `test`, no emit | Create |
| `packages/quarks/src/channels.ts` | `Emission`, the pose fields the driver reads, and `channels`, their stock channels | Create |
| `packages/quarks/src/authored.ts` | `Authored`: a system's start values captured once, written scaled per subject, restored; refusals | Create |
| `packages/quarks/src/drive.ts` | `drive`, `Driver`, `attach`/`detach`/`write`, rate carry, bursts, emit | Create |
| `packages/quarks/src/index.ts` | Public exports | Create |
| `packages/quarks/test/fixtures.ts` | `system()`, `born()`, `hold()` test helpers | Create |
| `packages/quarks/test/*.test.ts` | Tests per unit | Create |
| `packages/quarks/README.md`, `packages/quarks/CHANGELOG.md` | The package's own docs | Create |
| `package.json` (root) | `workspaces`, `typecheck` script | Modify |
| `vitest.config.ts`, `biome.json` (root) | Include the package's tests and files; alias the engine to source | Modify |
| `.github/workflows/release.yml` | A `quarks-v*` tag path | Modify |
| `README.md`, `docs/schema.html`, `HANDOFF.md` (root) | Mention the package; mark it built | Modify |

---

### Task 1: Workspace scaffolding

**Files:**
- Create: `packages/quarks/package.json`, `packages/quarks/tsconfig.json`, `packages/quarks/tsconfig.test.json`, `packages/quarks/src/index.ts`, `packages/quarks/test/scaffold.test.ts`
- Modify: `package.json`, `vitest.config.ts`, `biome.json`

- [ ] **Step 1: Create the package manifest**

`packages/quarks/package.json`:

```json
{
  "name": "@msb235/blits-quarks",
  "version": "0.1.0",
  "description": "Drives three.quarks particle systems from a blits mix: how many particles each subject emits, where, and with what start values",
  "keywords": ["particles", "three.quarks", "three", "blits", "effects"],
  "license": "MIT",
  "author": "orochi235",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/orochi235/blits.git",
    "directory": "packages/quarks"
  },
  "homepage": "https://github.com/orochi235/blits/tree/main/packages/quarks#readme",
  "bugs": "https://github.com/orochi235/blits/issues",
  "publishConfig": {
    "access": "public"
  },
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist", "CHANGELOG.md"],
  "scripts": {
    "build": "tsc -b",
    "prepack": "npm run build"
  },
  "dependencies": {
    "@msb235/blits": "0.2.1"
  },
  "peerDependencies": {
    "three": ">=0.185.0 <1.0.0",
    "three.quarks": "^0.17.1"
  },
  "devDependencies": {
    "@types/three": "^0.185.4",
    "three": "^0.185.1",
    "three.quarks": "^0.17.1"
  }
}
```

No `sideEffects: false`: importing three.quarks has one (it logs a banner), and claiming none would be untrue.

- [ ] **Step 2: Create the build and test configs**

`packages/quarks/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "composite": true,
    "skipLibCheck": true,
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "tsBuildInfoFile": ".tsbuildinfo",
    "paths": { "@msb235/blits": ["../../src/index.ts"] }
  },
  "references": [{ "path": "../.." }],
  "include": ["src"]
}
```

The path names the real package, so the emitted `import ... from '@msb235/blits'` is the specifier the published tarball needs; it is not a repo-path alias.

`packages/quarks/tsconfig.test.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "composite": false,
    "noEmit": true,
    "rootDir": "../..",
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Write a failing scaffold test**

`packages/quarks/test/scaffold.test.ts`:

```ts
import { kit, mix, sum } from '@msb235/blits';
import { ParticleSystem } from 'three.quarks';
import { describe, expect, it } from 'vitest';
import * as quarks from '../src/index.js';

describe('the package', () => {
  it('resolves the engine from source and three.quarks from the workspace', () => {
    const m = mix<string, { n: number }>(kit({ n: sum() }));
    m.sync(0);
    expect(m.probe('a').n).toBe(0);
    expect(typeof ParticleSystem).toBe('function');
    expect(quarks).toBeTypeOf('object');
  });
});
```

`packages/quarks/src/index.ts` (placeholder export so the module exists; Task 2 replaces it):

```ts
export {};
```

- [ ] **Step 4: Wire the workspace into the root**

In root `package.json`, change `"workspaces": ["site"]` to:

```json
  "workspaces": [
    "site",
    "packages/*"
  ]
```

and change the `typecheck` script to:

```json
    "typecheck": "tsc -b && tsc -p tsconfig.test.json && tsc -b packages/quarks && tsc -p packages/quarks/tsconfig.test.json",
```

Root `vitest.config.ts` becomes:

```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The engine is not a workspace member, so a package testing against it reads its source.
  resolve: { alias: { '@msb235/blits': fileURLToPath(new URL('./src/index.ts', import.meta.url)) } },
  test: { include: ['test/**/*.test.ts', 'packages/*/test/**/*.test.ts'] },
});
```

In root `biome.json`, add to `files.includes` after `"bench/**",`:

```json
      "packages/*/src/**",
      "packages/*/test/**",
      "packages/*/*.json",
```

- [ ] **Step 5: Install and run the test to see it pass**

Run: `npm install` (updates `package-lock.json` with the workspace and its dev dependencies)
Run: `npx vitest run packages/quarks`
Expected: 1 passed (plus the three.quarks banner line).

- [ ] **Step 6: Run every check**

Run: `npm run typecheck && npx biome check src test bench packages && npx vitest run`
Expected: all clean; the whole suite passes. If `tsc -b packages/quarks` reports a file outside `rootDir`, the `references` entry is missing or the engine's `tsconfig.json` lost `composite: true`; fix that, not the paths.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.config.ts biome.json packages/quarks
git commit -m "add the packages/quarks workspace for a three.quarks driver"
```

---

### Task 2: The driver's channels

**Files:**
- Create: `packages/quarks/src/channels.ts`, `packages/quarks/test/channels.test.ts`
- Modify: `packages/quarks/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/quarks/test/channels.test.ts`:

```ts
import { kit, max, mix, patch } from '@msb235/blits';
import { describe, expect, it } from 'vitest';
import { channels, type Emission } from '../src/index.js';

describe('channels', () => {
  it('rests at no rate, unscaled values and no offset', () => {
    const m = mix<string, Emission>(kit<Emission>(channels));
    m.sync(0);
    expect(m.probe('a')).toEqual({
      rate: 0,
      speed: 1,
      size: 1,
      life: 1,
      tint: [1, 1, 1, 1],
      offset: [0, 0, 0],
    });
  });

  it('adds rates and offsets, and multiplies scales, across voices on one subject', () => {
    type Pose = Emission & { heat: number };
    const m = mix<string, Pose>(kit<Pose>({ ...channels, heat: max() }));
    const hold = (d: Partial<Pose>) =>
      patch<string, Pose>(0, () => d, { writes: Object.keys(d) as (keyof Pose)[] });
    m.cue({ patch: hold({ rate: 10, speed: 2, offset: [1, 0, 0] }) });
    m.cue({ patch: hold({ rate: 5, speed: 3, offset: [0, 2, 0], heat: 0.5 }) });
    m.sync(0);
    const p = m.probe('a');
    expect([p.rate, p.speed, p.offset, p.heat]).toEqual([15, 6, [1, 2, 0], 0.5]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run packages/quarks/test/channels.test.ts`
Expected: FAIL, `channels` is not exported.

- [ ] **Step 3: Implement**

`packages/quarks/src/channels.ts`:

```ts
import { type Channel, mul, sum, vec } from '@msb235/blits';

/** The pose fields the driver reads. A host's kit holds any of them, and fields of its own. */
export interface Emission {
  /** Particles per second the driver emits at the subject. */
  rate: number;
  /** Scales the system's authored `startSpeed`. */
  speed: number;
  /** Scales the system's authored `startSize`. */
  size: number;
  /** Scales the system's authored `startLife`. */
  life: number;
  /** Scales the system's authored `startColor`, per component. */
  tint: number[];
  /** Added to the subject's position. */
  offset: number[];
}

/** The driver's channels, to spread into a kit: `kit({ ...channels, heat: max() })`. */
export const channels: { readonly [K in keyof Emission]: Channel<Emission[K]> } = {
  rate: sum(),
  speed: mul(),
  size: mul(),
  life: mul(),
  tint: vec(4, mul()),
  offset: vec(3, sum()),
};
```

`packages/quarks/src/index.ts`:

```ts
export type { Emission } from './channels.js';
export { channels } from './channels.js';
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run packages/quarks/test/channels.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/quarks/src packages/quarks/test/channels.test.ts
git commit -m "add the driver's channels: rate, speed, size, life, tint and offset"
```

---

### Task 3: Authored values, scaled per subject and restored

**Files:**
- Create: `packages/quarks/src/authored.ts`, `packages/quarks/test/fixtures.ts`, `packages/quarks/test/authored.test.ts`

- [ ] **Step 1: Write the test helpers**

`packages/quarks/test/fixtures.ts`:

```ts
import { patch } from '@msb235/blits';
import { MeshBasicMaterial, Vector4 } from 'three';
import {
  ConstantColor,
  ConstantValue,
  IntervalValue,
  type Particle,
  ParticleSystem,
  PointEmitter,
  RenderMode,
} from 'three.quarks';
import type { Emission } from '../src/index.js';

export interface Spot {
  id: string;
}

type Parameters = ConstructorParameters<typeof ParticleSystem>[0];

/** A system authored as speed 5, life 2, size 0.1..0.2 and color (1, 0.5, 0.25, 1). */
export function system(over: Partial<Parameters> = {}): ParticleSystem {
  return new ParticleSystem({
    looping: true,
    duration: 1,
    onlyUsedByOther: true,
    worldSpace: true,
    shape: new PointEmitter(),
    startLife: new ConstantValue(2),
    startSpeed: new ConstantValue(5),
    startSize: new IntervalValue(0.1, 0.2),
    startColor: new ConstantColor(new Vector4(1, 0.5, 0.25, 1)),
    emissionOverTime: new ConstantValue(0),
    renderMode: RenderMode.BillBoard,
    material: new MeshBasicMaterial(),
    ...over,
  });
}

/** Every particle the system holds, oldest first. */
export function born(s: ParticleSystem): Particle[] {
  return Array.from({ length: s.particleNum }, (_, i) => s.particles[i] as Particle);
}

/** A voice that holds these fields at a constant value. */
export function hold(d: Partial<Emission>) {
  return patch<Spot, Emission>(0, () => d, { writes: Object.keys(d) as (keyof Emission)[] });
}
```

- [ ] **Step 2: Write the failing test**

`packages/quarks/test/authored.test.ts`:

```ts
import { Vector4 } from 'three';
import { Bezier, ColorRange, type IntervalValue, PiecewiseBezier, type ConstantValue } from 'three.quarks';
import { describe, expect, it } from 'vitest';
import { Authored } from '../src/authored.js';
import { system } from './fixtures.js';

const all = { speed: true, size: true, life: true, tint: true };

describe('Authored', () => {
  it('scales from what the host authored and puts it back', () => {
    const s = system();
    const a = new Authored(s, all);
    a.apply({ speed: 2, size: 3, life: 0.5, tint: [0.5, 1, 2, 1] });
    expect((s.startSpeed as ConstantValue).value).toBe(10);
    expect([(s.startSize as IntervalValue).a, (s.startSize as IntervalValue).b]).toEqual([
      0.1 * 3,
      0.2 * 3,
    ]);
    expect((s.startLife as ConstantValue).value).toBe(1);
    a.restore();
    expect((s.startSpeed as ConstantValue).value).toBe(5);
    expect([(s.startSize as IntervalValue).a, (s.startSize as IntervalValue).b]).toEqual([0.1, 0.2]);
  });

  it('never compounds, however many times it applies', () => {
    const s = system();
    const a = new Authored(s, all);
    for (let i = 0; i < 50; i++) a.apply({ speed: 2 });
    expect((s.startSpeed as ConstantValue).value).toBe(10);
  });

  it('leaves alone a field whose channel is not applied, whatever generates it', () => {
    const curve = new PiecewiseBezier([[new Bezier(1, 1, 1, 1), 0]]);
    const range = new ColorRange(new Vector4(0, 0, 0, 1), new Vector4(1, 1, 1, 1));
    const s = system({ startSize: curve, startColor: range });
    const a = new Authored(s, { speed: true, size: false, life: false, tint: false });
    a.apply({ speed: 2, size: 9, tint: [0, 0, 0, 0] });
    expect(s.startSize).toBe(curve);
    expect(s.startColor).toBe(range);
  });

  it('refuses a generator it cannot scale, naming the field', () => {
    const curve = new PiecewiseBezier([[new Bezier(1, 1, 1, 1), 0]]);
    expect(() => new Authored(system({ startSize: curve }), all)).toThrow(/startSize/);
    const range = new ColorRange(new Vector4(0, 0, 0, 1), new Vector4(1, 1, 1, 1));
    expect(() => new Authored(system({ startColor: range }), all)).toThrow(/startColor/);
  });

  it('refuses a system that does not emit in world space', () => {
    expect(() => new Authored(system({ worldSpace: false }), all)).toThrow(/worldSpace/);
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run packages/quarks/test/authored.test.ts`
Expected: FAIL, `../src/authored.js` does not exist.

- [ ] **Step 4: Implement**

`packages/quarks/src/authored.ts`:

```ts
import { ConstantColor, ConstantValue, IntervalValue, type ParticleSystem } from 'three.quarks';
import type { Emission } from './channels.js';

type Scalar = 'speed' | 'size' | 'life';

const FIELD = { speed: 'startSpeed', size: 'startSize', life: 'startLife' } as const;
const SCALARS = ['speed', 'size', 'life'] as const;

type Range =
  | { gen: ConstantValue; value: number }
  | { gen: IntervalValue; a: number; b: number };

/** Which of the driver's channels a host's kit holds, and so which fields the driver writes. */
export type Applies = Readonly<Record<Scalar | 'tint', boolean>>;

/**
 * A system's start values as the host authored them, captured once so scaling never compounds:
 * written scaled for one subject before its particles are born, and put back afterwards.
 */
export class Authored {
  private readonly ranges: Partial<Record<Scalar, Range>> = {};
  private readonly tint: { gen: ConstantColor; rgba: readonly number[] } | null;

  constructor(
    readonly system: ParticleSystem,
    applies: Applies,
  ) {
    if (!system.worldSpace)
      throw new Error(
        'blits-quarks: a system needs worldSpace: true, since the driver places particles in world coordinates',
      );
    for (const name of SCALARS) {
      if (!applies[name]) continue;
      const gen = system[FIELD[name]];
      if (gen instanceof ConstantValue) this.ranges[name] = { gen, value: gen.value };
      else if (gen instanceof IntervalValue) this.ranges[name] = { gen, a: gen.a, b: gen.b };
      else
        throw new Error(
          `blits-quarks: ${FIELD[name]} has to be a ConstantValue or an IntervalValue to scale`,
        );
    }
    if (!applies.tint) this.tint = null;
    else if (system.startColor instanceof ConstantColor) {
      const c = system.startColor.color;
      this.tint = { gen: system.startColor, rgba: [c.x, c.y, c.z, c.w] };
    } else throw new Error('blits-quarks: startColor has to be a ConstantColor to tint');
  }

  apply(pose: Partial<Emission>): void {
    for (const name of SCALARS) {
      const range = this.ranges[name];
      const k = pose[name];
      if (range === undefined || k === undefined) continue;
      if ('value' in range) range.gen.value = range.value * k;
      else {
        range.gen.a = range.a * k;
        range.gen.b = range.b * k;
      }
    }
    const tint = this.tint;
    const k = pose.tint;
    if (tint !== null && k !== undefined) {
      const [r, g, b, a] = tint.rgba as [number, number, number, number];
      tint.gen.color.set(r * (k[0] ?? 1), g * (k[1] ?? 1), b * (k[2] ?? 1), a * (k[3] ?? 1));
    }
  }

  restore(): void {
    for (const name of SCALARS) {
      const range = this.ranges[name];
      if (range === undefined) continue;
      if ('value' in range) range.gen.value = range.value;
      else {
        range.gen.a = range.a;
        range.gen.b = range.b;
      }
    }
    if (this.tint !== null) {
      const [r, g, b, a] = this.tint.rgba as [number, number, number, number];
      this.tint.gen.color.set(r, g, b, a);
    }
  }
}
```

- [ ] **Step 5: Run it to see it pass**

Run: `npx vitest run packages/quarks/test/authored.test.ts`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add packages/quarks/src/authored.ts packages/quarks/test/fixtures.ts packages/quarks/test/authored.test.ts
git commit -m "capture a system's authored start values, scale them per subject and put them back"
```

---

### Task 4: `drive`, `attach`, `detach` and `write` with a rate

**Files:**
- Create: `packages/quarks/src/drive.ts`, `packages/quarks/test/drive.test.ts`
- Modify: `packages/quarks/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/quarks/test/drive.test.ts`:

```ts
import { kit, type Mix, mix } from '@msb235/blits';
import { ConstantValue } from 'three.quarks';
import { describe, expect, it } from 'vitest';
import { channels, drive, type Emission } from '../src/index.js';
import { born, hold, type Spot, system } from './fixtures.js';

const K = kit<Emission>(channels);
const a: Spot = { id: 'a' };
const b: Spot = { id: 'b' };

function run(frames: number, dt: number, m: Mix<Spot, Emission>, w: () => void) {
  for (let f = 0; f < frames; f++) {
    m.sync(f * dt);
    w();
  }
}

describe('drive', () => {
  it("gives each subject's particles its own start values and position on a shared system", () => {
    const m = mix<Spot, Emission>(K);
    const s = system();
    m.cue({ patch: hold({ rate: 10, speed: 2, life: 0.5 }), subjects: [a] });
    m.cue({ patch: hold({ rate: 20, speed: 3 }), subjects: [b] });
    const q = drive(m, { kit: K });
    q.attach(a, s, { at: [1, 0, 0] });
    q.attach(b, s, { at: () => ({ x: 0, y: 2, z: 0 }) });
    run(10, 100, m, () => q.write(100));
    const fromA = born(s).filter((p) => p.position.x === 1);
    const fromB = born(s).filter((p) => p.position.y === 2);
    expect(fromA).toHaveLength(10);
    expect(fromB).toHaveLength(20);
    for (const p of fromA) expect([p.startSpeed, p.life]).toEqual([10, 1]);
    for (const p of fromB) expect([p.startSpeed, p.life]).toEqual([15, 2]);
    expect((s.startSpeed as ConstantValue).value).toBe(5);
  });

  it('emits exactly rate × time over many frames for a fractional rate', () => {
    const m = mix<Spot, Emission>(K);
    const s = system();
    m.cue({ patch: hold({ rate: 2.5 }), subjects: [a] });
    const q = drive(m, { kit: K });
    q.attach(a, s, { at: [0, 0, 0] });
    run(1000, 16, m, () => q.write(16));
    expect(s.particleNum).toBe(40);
  });

  it('adds the offset to the position', () => {
    const m = mix<Spot, Emission>(K);
    const s = system();
    m.cue({ patch: hold({ rate: 10, offset: [0, 0, 3] }), subjects: [a] });
    const q = drive(m, { kit: K });
    q.attach(a, s, { at: [1, 0, 0] });
    run(1, 100, m, () => q.write(100));
    expect(born(s).map((p) => p.position.toArray())).toEqual([[1, 0, 3]]);
  });

  it('emits nothing at a rate at or below 0, and builds no debt', () => {
    const m = mix<Spot, Emission>(K);
    const s = system();
    const neg = m.cue({ patch: hold({ rate: -5 }), subjects: [a] });
    const q = drive(m, { kit: K });
    q.attach(a, s, { at: [0, 0, 0] });
    run(10, 100, m, () => q.write(100));
    expect(s.particleNum).toBe(0);
    neg.weight = 0;
    m.cue({ patch: hold({ rate: 10 }), subjects: [a] });
    m.sync(1000);
    q.write(100);
    expect(s.particleNum).toBe(1);
  });

  it("does not fire the system's own bursts when it emits", () => {
    const m = mix<Spot, Emission>(K);
    const s = system({
      emissionBursts: [
        { time: 0, count: new ConstantValue(7), cycle: 1, interval: 0.01, probability: 1 },
      ],
    });
    m.cue({ patch: hold({ rate: 10 }), subjects: [a] });
    const q = drive(m, { kit: K });
    q.attach(a, s, { at: [0, 0, 0] });
    run(1, 100, m, () => q.write(100));
    expect(s.particleNum).toBe(1);
  });

  it('stops a detached subject, and recaptures a system attached again', () => {
    const m = mix<Spot, Emission>(K);
    const s = system();
    m.cue({ patch: hold({ rate: 10, speed: 2 }), subjects: [a] });
    const q = drive(m, { kit: K });
    q.attach(a, s, { at: [0, 0, 0] });
    run(1, 100, m, () => q.write(100));
    q.detach(a);
    m.sync(100);
    q.write(100);
    expect(s.particleNum).toBe(1);
    (s.startSpeed as ConstantValue).value = 8;
    q.attach(a, s, { at: [0, 0, 0] });
    m.sync(200);
    q.write(100);
    expect(born(s).map((p) => p.startSpeed)).toEqual([10, 16]);
  });

  it('refuses a subject attached twice', () => {
    const q = drive(mix<Spot, Emission>(K), { kit: K });
    q.attach(a, system(), { at: [0, 0, 0] });
    expect(() => q.attach(a, system(), { at: [0, 0, 0] })).toThrow(/attached/);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run packages/quarks/test/drive.test.ts`
Expected: FAIL, `drive` is not exported.

- [ ] **Step 3: Implement**

`packages/quarks/src/drive.ts`:

```ts
import type { Kit, Mix } from '@msb235/blits';
import { Matrix4 } from 'three';
import type { ParticleSystem } from 'three.quarks';
import { Authored } from './authored.js';
import type { Emission } from './channels.js';

/** A point in world space, as an object or a tuple. */
export type Position = { x: number; y: number; z: number } | readonly [number, number, number];

export interface AttachOptions {
  /** Where the subject emits: a position, or a function asked on each frame it emits. */
  at: Position | (() => Position);
}

/** The event a patch sends to burst particles at its subject. */
export interface Burst {
  count: number;
}

export interface DriveOptions<O> {
  /** The mix's kit, so the driver knows which of its channels are present before any probe. */
  kit: Kit<O>;
  /** The tag whose events are bursts; without one the driver drains nothing. */
  bursts?: string;
}

export interface Driver<I> {
  attach(subject: I, system: ParticleSystem, opts: AttachOptions): void;
  detach(subject: I): void;
  /** Probes every attached subject and emits its particles, `dt` ms after the last write. */
  write(dt: number): void;
}

interface Bound<O> {
  system: ParticleSystem;
  authored: Authored;
  at: AttachOptions['at'];
  pose: O;
  /** Particle-milliseconds owed by `rate`, below one particle's worth. */
  carry: number;
  count: number;
}

type EmitMatrix = Parameters<ParticleSystem['emit']>[2];

export function drive<I, O extends Partial<Emission>>(
  mix: Mix<I, O>,
  opts: DriveOptions<O>,
): Driver<I> {
  const kit = opts.kit as object;
  const applies = {
    speed: 'speed' in kit,
    size: 'size' in kit,
    life: 'life' in kit,
    tint: 'tint' in kit,
  };
  const bound = new Map<I, Bound<O>>();
  const systems = new Map<ParticleSystem, { authored: Authored; users: number }>();
  const matrix = new Matrix4();
  const state = {
    burstIndex: 0,
    burstWaveIndex: 0,
    burstParticleIndex: 0,
    burstParticleCount: 0,
    isBursting: false,
    time: 0,
    waitEmiting: 0,
    travelDistance: 0,
  };

  const emit = (b: Bound<O>): void => {
    b.authored.apply(b.pose);
    const at = typeof b.at === 'function' ? b.at() : b.at;
    const [x, y, z] = 'x' in at ? [at.x, at.y, at.z] : at;
    const o = b.pose.offset;
    matrix.makeTranslation(x + (o?.[0] ?? 0), y + (o?.[1] ?? 0), z + (o?.[2] ?? 0));
    // Past the system's own bursts, and no time passing: exactly `count` particles, nothing else.
    state.burstIndex = b.system.emissionBursts.length;
    state.burstWaveIndex = 0;
    state.burstParticleIndex = 0;
    state.burstParticleCount = 0;
    state.isBursting = false;
    state.time = 0;
    state.waitEmiting = b.count;
    state.travelDistance = 0;
    b.system.emit(0, state, matrix as unknown as EmitMatrix);
  };

  return {
    attach(subject, system, { at }) {
      if (bound.has(subject)) throw new Error('blits-quarks: that subject is attached already');
      let held = systems.get(system);
      if (held === undefined) {
        held = { authored: new Authored(system, applies), users: 0 };
        systems.set(system, held);
      }
      held.users++;
      bound.set(subject, {
        system,
        authored: held.authored,
        at,
        pose: {} as O,
        carry: 0,
        count: 0,
      });
    },

    detach(subject) {
      const b = bound.get(subject);
      if (b === undefined) return;
      bound.delete(subject);
      const held = systems.get(b.system);
      if (held !== undefined && --held.users === 0) {
        held.authored.restore();
        systems.delete(b.system);
      }
    },

    write(dt) {
      for (const [subject, b] of bound) {
        mix.probe(subject, b.pose);
        const rate = b.pose.rate ?? 0;
        if (rate > 0) b.carry += rate * dt;
        const n = Math.floor(b.carry / 1000);
        b.carry -= n * 1000;
        b.count = n;
      }
      if (opts.bursts !== undefined)
        for (const sent of mix.drain<Burst>(opts.bursts)) {
          const b = bound.get(sent.subject);
          const n = Math.floor(sent.event.count);
          if (b !== undefined && n > 0) b.count += n;
        }
      for (const b of bound.values())
        if (b.count > 0) {
          emit(b);
          b.count = 0;
        }
      for (const held of systems.values()) held.authored.restore();
    },
  };
}
```

Append to `packages/quarks/src/index.ts`:

```ts
export type { AttachOptions, Burst, DriveOptions, Driver, Position } from './drive.js';
export { drive } from './drive.js';
```

- [ ] **Step 4: Run it to see it pass**

Run: `npx vitest run packages/quarks/test/drive.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Run every check, then commit**

Run: `npm run typecheck && npx biome check src test bench packages && npx vitest run`
Expected: clean, all pass.

```bash
git add packages/quarks/src packages/quarks/test/drive.test.ts
git commit -m "add drive: emit each attached subject's particles from its rate, on a shared system"
```

---

### Task 5: Bursts from drained events

**Files:**
- Create: `packages/quarks/test/bursts.test.ts`

The code is already in Task 4's `write`; this task proves it.

- [ ] **Step 1: Write the test**

`packages/quarks/test/bursts.test.ts`:

```ts
import { kit, mix, patch } from '@msb235/blits';
import { describe, expect, it } from 'vitest';
import { channels, drive, type Emission } from '../src/index.js';
import { born, hold, type Spot, system } from './fixtures.js';

const K = kit<Emission>(channels);
const a: Spot = { id: 'a' };
const b: Spot = { id: 'b' };

// Sends one burst of three, and holds speed at 4 for its subject.
const pop = () =>
  patch<Spot, Emission, { sent: boolean }>(0, () => ({ speed: 4 }), {
    writes: ['speed'],
    state: () => ({ sent: false }),
    step: (st, _dt, _subject, setting) => {
      if (st.sent) return;
      st.sent = true;
      setting.send({ count: 3 });
    },
  });

describe('bursts', () => {
  it("fires a burst at its own subject, with that subject's values, beside its rate", () => {
    const m = mix<Spot, Emission>(K);
    const s = system();
    m.cue({ patch: pop(), subjects: [a], tags: ['sparks'] });
    m.cue({ patch: hold({ rate: 10 }), subjects: [a, b] });
    const q = drive(m, { kit: K, bursts: 'sparks' });
    q.attach(a, s, { at: [1, 0, 0] });
    q.attach(b, s, { at: [0, 2, 0] });
    for (let f = 0; f < 3; f++) {
      m.sync(f * 100);
      q.write(100);
    }
    expect(born(s).filter((p) => p.position.x === 1).map((p) => p.startSpeed)).toEqual(
      Array(6).fill(20),
    );
    expect(born(s).filter((p) => p.position.y === 2).map((p) => p.startSpeed)).toEqual(
      Array(3).fill(5),
    );
  });

  it('drains only its own tag, and ignores a burst for a subject not attached', () => {
    const m = mix<Spot, Emission>(K);
    const s = system();
    m.cue({ patch: pop(), subjects: [a, b], tags: ['sparks'] });
    m.cue({ patch: pop(), subjects: [a], tags: ['other'] });
    const q = drive(m, { kit: K, bursts: 'sparks' });
    q.attach(a, s, { at: [0, 0, 0] });
    for (let f = 0; f < 3; f++) {
      m.sync(f * 100);
      m.probe(b);
      q.write(100);
    }
    expect(s.particleNum).toBe(3);
    expect(m.drain('other')).toHaveLength(1);
  });
});
```

A `step` does not run on a subject's first probe, so the burst lands on the second frame; three frames give `a` three rate particles and one burst of three.

- [ ] **Step 2: Run it**

Run: `npx vitest run packages/quarks/test/bursts.test.ts`
Expected: 2 passed. If the first fails with 4 particles for `a`, the burst was not drained: check `drive` drains after probing, not before.

- [ ] **Step 3: Commit**

```bash
git add packages/quarks/test/bursts.test.ts
git commit -m "test bursts drained by tag, at their own subject, with its values"
```

---

### Task 6: Docs

**Files:**
- Create: `packages/quarks/README.md`, `packages/quarks/CHANGELOG.md`
- Modify: `README.md`, `docs/schema.html`, `HANDOFF.md`

- [ ] **Step 1: Write the package README**

`packages/quarks/README.md`:

````markdown
# @msb235/blits-quarks

Drives [three.quarks](https://github.com/Alchemist0823/three.quarks) particle systems from a
[blits](https://github.com/orochi235/blits) mix. You build the systems and the renderer; each frame
the driver reads each subject's pose and turns it into particles: how many to emit, where, and with
what start values. Nothing else about quarks is wrapped.

```
npm install @msb235/blits @msb235/blits-quarks three three.quarks
```

```ts
import { kit, max, mix } from '@msb235/blits';
import { channels, drive } from '@msb235/blits-quarks';

const K = kit({ ...channels, heat: max() });   // the driver's channels, plus your own
const m = mix(K);
const quarks = drive(m, { kit: K, bursts: 'sparks' });
quarks.attach(fault, fizzSystem, { at: () => fault.at });

// each frame
m.sync(now);
quarks.write(dt);           // dt in ms
batch.update(dt / 1000);    // your own BatchedRenderer
```

## Subjects are emission points

Many subjects may share one system, so no shader compiles mid-effect. Each subject's pose is its
own: before a subject's particles are born the driver writes that subject's start values into the
system, scaled from what you authored; afterwards it puts your values back. quarks reads start
values at birth, so every particle carries its own subject's values, and particles the system emits
on its own are untouched.

| Channel | Arithmetic | Meaning |
|---|---|---|
| `rate` | `sum()` | Particles per second the driver emits at the subject |
| `speed`, `size`, `life` | `mul()` | Scale the authored `startSpeed`, `startSize`, `startLife` |
| `tint` | `vec(4, mul())` | Scales the authored `startColor` per component |
| `offset` | `vec(3, sum())` | Added to the subject's position |

Only the channels in your kit are written; leave one out and that field stays yours. A burst is an
event `{ count }` a patch `send`s under the tag you gave `drive`.

## Limits

- `startSpeed`, `startSize` and `startLife` must be a `ConstantValue` or `IntervalValue`, and
  `startColor` a `ConstantColor`, when their channel is in the kit; anything else is refused at
  `attach`, naming the field.
- A system must have `worldSpace: true`.
- What quarks does to a particle after birth (forces, behaviors, color over life) stays quarks'.
````

- [ ] **Step 2: Write the package changelog**

`packages/quarks/CHANGELOG.md`:

```markdown
# Changelog

This package follows [semver](https://semver.org). Below 1.0.0, a breaking change bumps the minor
version and everything else the patch. The release workflow refuses a `quarks-v*` tag with no
section here.

## Unreleased

### Added

- `drive(mix, { kit, bursts? })`, `attach`, `detach` and `write`: a subject's `rate` emits particles
  at its position on a system it may share with other subjects, each born with its own subject's
  `speed`, `size`, `life` and `tint`; events tagged for bursts emit `count` more. `channels` holds
  the stock channels for those fields.
```

- [ ] **Step 3: Mention the package in the engine's docs**

In root `README.md`, insert before `## Status`:

```markdown
## Packages

`packages/quarks` is `@msb235/blits-quarks`, a driver that turns poses into
[three.quarks](https://github.com/Alchemist0823/three.quarks) particles. It is published separately
so the engine keeps no dependencies; its README says how it works.
```

In `docs/schema.html`, in the "Pieces from other packages" section, replace the sentence
`Nothing works this way yet: magicsmoke keeps its fault mix private, and the host calls <code>smoke.cue</code> and <code>smoke.sync</code> while magicsmoke syncs, probes, drains and renders inside.`
with:

```html
The first is <code>@msb235/blits-quarks</code> in <code>packages/quarks</code>: a patch sends <code>{ count }</code> under a tag, and the driver drains that tag and emits the particles at the event's subject. magicsmoke still keeps its fault mix private, and the host calls <code>smoke.cue</code> and <code>smoke.sync</code> while magicsmoke syncs, probes, drains and renders inside.
```

In `HANDOFF.md`, replace item `1d.` with:

```markdown
1d. **`@msb235/blits-quarks` is built, in `packages/quarks`, unreleased.** Its README says how it
   works. Before its first release Mike registers trusted publishing for the name (the release
   workflow's header says how); then the release is a `quarks-v0.1.0` tag, after renaming its
   changelog's Unreleased section. Moving magicsmoke's fizz and tuning onto it is a follow-up in
   magicsmoke's repo.
```

- [ ] **Step 4: Commit**

```bash
git add packages/quarks/README.md packages/quarks/CHANGELOG.md README.md docs/schema.html HANDOFF.md
git commit -m "document blits-quarks in its README, the engine's README, the schema and the handoff"
```

---

### Task 7: Release workflow

**Files:**
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Make the workflow publish either package by tag**

Replace `.github/workflows/release.yml` with:

```yaml
name: Release

# Publishes on a pushed tag, with no npm token anywhere: npm's trusted publishing swaps the
# workflow's OIDC token for a short-lived credential, which is why `id-token: write` is the one
# permission that matters here. A `v*` tag publishes the engine, `@msb235/blits`; a `quarks-v*` tag
# publishes the driver in `packages/quarks`, `@msb235/blits-quarks`.
#
# npmjs.com holds the trust, per package: `npm trust github <name> --file release.yml --repo
# orochi235/blits --allow-publish` registers it, and `npm trust list <name>` shows it. It can be set
# before a package's first publish, so every version goes out from here.

on:
  push:
    tags: ['v*', 'quarks-v*']
  workflow_dispatch:

permissions:
  contents: read
  id-token: write

concurrency:
  group: release
  cancel-in-progress: false

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7

      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          registry-url: https://registry.npmjs.org
          cache: npm

      # Trusted publishing needs npm 11.5.1 or later, which is newer than the npm some Node lines
      # ship with. Upgrading is cheaper than pinning a Node version for a reason unrelated to Node.
      - run: npm install -g npm@latest

      - run: npm ci

      # Separately rather than through `npm run check`, so a failure names which one broke.
      - name: Lint
        run: npm run lint

      - name: Typecheck
        run: npm run typecheck

      - name: Test
        run: npm test

      # Which package this run publishes, from the tag; a run by hand publishes the engine.
      - name: Pick the package
        id: pick
        run: |
          case "$GITHUB_REF_NAME" in
            quarks-v*) echo "dir=packages/quarks" >> "$GITHUB_OUTPUT"
                       echo "version=${GITHUB_REF_NAME#quarks-v}" >> "$GITHUB_OUTPUT" ;;
            *)         echo "dir=." >> "$GITHUB_OUTPUT"
                       echo "version=${GITHUB_REF_NAME#v}" >> "$GITHUB_OUTPUT" ;;
          esac

      # A tag that disagrees with the manifest publishes a version nobody asked for, under a name
      # git will keep pointing somewhere else. Cheaper to stop here than to unpublish.
      - name: The tag has to be the version being published
        if: github.ref_type == 'tag'
        working-directory: ${{ steps.pick.outputs.dir }}
        run: |
          manifest="$(node -p 'require("./package.json").version')"
          if [ "${{ steps.pick.outputs.version }}" != "$manifest" ]; then
            echo "tag says ${{ steps.pick.outputs.version }}, package.json says $manifest" >&2
            exit 1
          fi

      - name: The changelog has a section for this version
        working-directory: ${{ steps.pick.outputs.dir }}
        run: |
          version="$(node -p 'require("./package.json").version')"
          if ! grep -qx "## $version" CHANGELOG.md; then
            echo "CHANGELOG.md has no '## $version' section" >&2
            exit 1
          fi

      # The driver pins the engine exactly; a pin npm cannot serve would publish a broken install.
      - name: The driver's engine is on npm
        if: steps.pick.outputs.dir == 'packages/quarks'
        run: |
          pin="$(node -p 'require("./packages/quarks/package.json").dependencies["@msb235/blits"]')"
          npm view "@msb235/blits@$pin" version

      # `workspaces` only wires up the site and the driver for development. npm publishes
      # package.json as it stands, so the field has to come off this throwaway checkout before packing.
      - name: Drop the workspaces from the engine's published manifest
        if: steps.pick.outputs.dir == '.'
        run: npm pkg delete workspaces

      - name: Publish the engine
        if: steps.pick.outputs.dir == '.'
        run: npm publish

      - name: Publish the driver
        if: steps.pick.outputs.dir == 'packages/quarks'
        run: npm publish -w @msb235/blits-quarks
```

- [ ] **Step 2: Check the workflow parses**

Run: `node -e "require('node:fs').readFileSync('.github/workflows/release.yml','utf8')" && npx --yes yaml-lint .github/workflows/release.yml`
Expected: no errors. If `yaml-lint` cannot be fetched, check indentation by eye against the file above.

- [ ] **Step 3: Check the driver packs**

Run: `npm pack -w @msb235/blits-quarks --dry-run`
Expected: lists `dist/index.js`, `dist/index.d.ts`, `dist/channels.*`, `dist/authored.*`, `dist/drive.*`, `CHANGELOG.md`, `README.md`, `package.json`, and nothing from `src` or `test`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "let the release workflow publish blits-quarks on a quarks-v tag"
```

**Not done by this plan:** registering trusted publishing for `@msb235/blits-quarks` on npmjs.com. Mike runs `npm trust github @msb235/blits-quarks --file release.yml --repo orochi235/blits --allow-publish` before the first `quarks-v*` tag.

---

### Task 8: Final checks and retiring the plan

- [ ] **Step 1: Run every check**

Run: `npm run typecheck && npm run lint && npx vitest run`
Expected: all clean; the whole suite, engine and driver, passes.

- [ ] **Step 2: Check the README carries what the spec said**

Read `docs/superpowers/specs/2026-10-02-blits-quarks-design.md` against `packages/quarks/README.md`: the model (subjects are emission points, values applied at birth, authored values restored), the channel table, the limits, the `drive` signature with `kit`. Anything the spec says that the README lacks and a user needs goes into the README now.

- [ ] **Step 3: Delete the spec and this plan**

```bash
git rm docs/superpowers/specs/2026-10-02-blits-quarks-design.md docs/superpowers/plans/2026-10-02-blits-quarks.md
git commit -m "retire the blits-quarks spec and plan now that its README carries the design"
```
