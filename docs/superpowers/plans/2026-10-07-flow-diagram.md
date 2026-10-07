# Flow Diagram Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Draw a composition's signal flow (levels → signals → voices → channels → pose) in the playground's right column, and a channel's fold tree on click, using `@weasel-js/diagram`.

**Architecture:** weasel-diagram gains a data-in entry (`diagramScene`), a barycenter crossing-reduction option on `layered`, and a read-only `DiagramView`. The playground gets a pure `flowOf(composition)` / `foldOf(flow, channel)` in `src/blits/flow.ts`, a `FlowDiagram` widget that knows only graph data, and a `FlowPanel` that wires it to selection. Voice and patch panels move to a **Voice** tab beside **Plots** in the middle column.

**Tech Stack:** TypeScript, React 19, Vite, vitest, acorn, `@weasel-js/{core,diagram,ui,labkit,forge}`, weasel's changesets.

**Spec:** `docs/superpowers/specs/2026-10-07-flow-diagram-design.md`

## Global Constraints

- Two repos. blits at `~/src/blits`; weasel work in a worktree at `~/src/weasel/.worktrees/diagram-from-data` on branch `diagram-from-data`, never on weasel's `main`.
- Every `@weasel-js/*` package moves together; no mixed versions inside blits.
- Publishing weasel (1.9.0) is Mike's call. Task 11 stops and asks before any `npm publish` or `changeset publish`.
- No `@internal`/`@experimental` weasel API in blits code. `SceneCanvas`'s `actions` prop is `@experimental`; don't pass it.
- Channel rules come from `KIT[ch].kind`, and rests from `KIT[ch].rest`. Both are public `Channel` fields. Don't keep a second table of rule names.
- Node ids are stable across edits: `level:<name>`, `sig:<voiceId>:<field>:<path>`, `expr:<voiceId>:<field>`, `voice:<voiceId>`, `ch:<channel>`, `pose`, `rest:<channel>`.
- Commit subjects: imperative, lowercase, repo vocabulary (see `git log`); end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- US English, sparse comments (only what the code can't say), no inline styles, no `!important`.
- While iterating, run only the tests covering the diff. After the final merge to `main`, start `onto test` in the background.

## Review Focus

- **A level named in an expression but absent from the composition** (it reads 0) still gets a level node, marked faulted with detail `missing: reads 0`. Test in Task 5.
- **A weight expression with no signal calls**, e.g. `(s) => s.index / 10`, gets an expr node with no inputs and an edge into the voice. Test in Task 5.
- **A voice that writes no channels** (`keys` whose stops are all `{}`, `fn` with `writes: []`) appears with no outgoing edges and creates no channel node. Test in Task 5.
- **One level read twice in one expression** gives one edge, not two. Test in Task 5.
- **Folding a channel nothing writes anymore**, after the voice that wrote it is deleted while its fold is open, shows "nothing writes <channel>", never a blank canvas or a throw. Test in Task 6 (`foldOf` returns empty), with the panel text in Task 9.

---

### Task 1: Move blits to weasel 1.8.1

**Files:**
- Modify: `package.json` (root `devDependencies`), `site/package.json`, `apps/playground/package.json`
- Modify: `package-lock.json` (by npm)

**Interfaces:**
- Produces: every `@weasel-js/*` in blits at `1.8.1`, which later tasks build on.

- [ ] **Step 1: List the current pins**

Run: `cd ~/src/blits && grep -rn '"@weasel-js/' package.json site/package.json apps/playground/package.json`
Expected: `1.7.3` in site and playground (core, labkit, theme, ui, forge), and `^1.8.1` for history at the root.

- [ ] **Step 2: Rewrite every 1.7.3 pin to 1.8.1**

```bash
cd ~/src/blits
sed -i '' 's/"\(@weasel-js\/[a-z0-9-]*\)": "1\.7\.3"/"\1": "1.8.1"/' site/package.json apps/playground/package.json
grep -rn '"@weasel-js/' site/package.json apps/playground/package.json
```
Expected: every line shows `1.8.1`.

- [ ] **Step 3: Install**

Run: `npm install`
Expected: exits 0. `ls node_modules/@weasel-js/core/package.json && grep '"version"' node_modules/@weasel-js/core/package.json` shows `1.8.1`.

- [ ] **Step 4: Verify nothing regressed**

Run: `npm run lint && npm run typecheck && npm run playground:check && npm run site:build`
Expected: all exit 0; the smoke run prints `ok` for every preset.
If a 1.8.x API change breaks a call site, fix the call site to the 1.8.1 API (read the package's CHANGELOG.md under `node_modules/@weasel-js/<pkg>/`) and re-run.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json site/package.json apps/playground/package.json
git commit -m "move every @weasel-js package to 1.8.1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: weasel worktree, and barycenter ordering in `layered`

**Files:**
- Modify: `~/src/weasel/.worktrees/diagram-from-data/packages/diagram/src/layout.ts` (the `LayoutOptions` interface)
- Modify: `…/packages/diagram/src/layered.ts` (the `layered` function)
- Create: `…/packages/diagram/src/barycenter.ts`
- Test: `…/packages/diagram/src/barycenter.test.ts`

**Interfaces:**
- Produces: `LayoutOptions.order?: 'seeded' | 'barycenter'` (default `'seeded'`, `layered` only); `barycenterOrder(graph: Graph, rows: GraphNode[][], back: ReadonlySet<string>): GraphNode[][]`.

- [ ] **Step 1: Create the worktree and move the session into it**

```bash
git -C ~/src/weasel worktree add .worktrees/diagram-from-data -b diagram-from-data main
cd ~/src/weasel/.worktrees/diagram-from-data && npm ci
```
Then call `EnterWorktree` with path `~/src/weasel/.worktrees/diagram-from-data` and say in chat that the session moved.
Expected: `git -C ~/src/weasel/.worktrees/diagram-from-data branch --show-current` prints `diagram-from-data`.

- [ ] **Step 2: Write the failing test**

`packages/diagram/src/barycenter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Graph, GraphEdge, GraphNode } from './graph';
import { layered } from './layered';

function graph(ids: string[], pairs: [string, string][]): Graph {
  const nodes: GraphNode[] = ids.map((id, i) => ({
    id, bounds: { x: i, y: 0, width: 40, height: 20 }, pinned: false,
  }));
  const edges: GraphEdge[] = pairs.map(([from, to], i) => ({ id: `e${i}`, from, to }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return {
    nodes, edges,
    node: (id) => byId.get(id),
    outgoing: (id) => edges.filter((e) => e.from === id),
    incoming: (id) => edges.filter((e) => e.to === id),
  };
}

/** Edge pairs that cross between adjacent ranks, read off the laid-out x. */
function crossings(g: Graph, at: ReadonlyMap<string, { x: number; y: number }>): number {
  const pos = (id: string) => at.get(id) ?? g.node(id)!.bounds;
  let n = 0;
  for (const a of g.edges) for (const b of g.edges) {
    if (a.id >= b.id) continue;
    const [a0, a1, b0, b1] = [pos(a.from), pos(a.to), pos(b.from), pos(b.to)];
    if (a0.y !== b0.y || a1.y !== b1.y) continue;
    if ((a0.x - b0.x) * (a1.x - b1.x) < 0) n++;
  }
  return n;
}

// Sources a, b; sinks listed so the seeded order crosses both edges.
const IDS = ['a', 'b', 'y', 'x'];
const PAIRS: [string, string][] = [['a', 'x'], ['b', 'y']];

describe('layered order', () => {
  it('keeps the seeded order by default, crossings and all', () => {
    const g = graph(IDS, PAIRS);
    expect(crossings(g, layered(g))).toBe(1);
  });

  it('untangles a crossing with order: barycenter', () => {
    const g = graph(IDS, PAIRS);
    expect(crossings(g, layered(g, { order: 'barycenter' }))).toBe(0);
  });

  it('gives the same answer every run', () => {
    const g = graph(IDS, PAIRS);
    const first = [...layered(g, { order: 'barycenter' })];
    expect([...layered(g, { order: 'barycenter' })]).toEqual(first);
  });

  it('lays out a graph with no edges without throwing', () => {
    const g = graph(['only'], []);
    expect(() => layered(g, { order: 'barycenter' })).not.toThrow();
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run packages/diagram/src/barycenter.test.ts`
Expected: the barycenter test fails; `order` is not a known option, and TS may flag it.

- [ ] **Step 4: Add the option**

In `layout.ts`, inside `LayoutOptions`, after `rankGap`:

```ts
  /** How `layered` orders nodes within a rank. `'seeded'` (default) keeps
   *  the order they already sit in; `'barycenter'` reorders to reduce edge
   *  crossings, for a generated diagram with no arranged order to keep.
   *  Other layouts ignore it. */
  order?: 'seeded' | 'barycenter';
```

- [ ] **Step 5: Write `barycenter.ts`**

```ts
/**
 * Barycenter crossing reduction: each node moves to the mean position of its
 * neighbors in the adjacent rank, sweeping down then up a fixed number of
 * times. Ties keep the current order, so the result is a function of the
 * input order alone.
 */
import type { Graph, GraphNode } from './graph';

const SWEEPS = 4;

export function barycenterOrder(
  graph: Graph,
  rows: GraphNode[][],
  back: ReadonlySet<string>,
): GraphNode[][] {
  const out = rows.map((row) => [...row]);
  const index = new Map<string, number>();
  const reindex = (row: GraphNode[]) => row.forEach((n, i) => index.set(n.id, i));
  out.forEach(reindex);

  const reorder = (row: GraphNode[], neighbors: (id: string) => string[]) => {
    const key = new Map<string, number>();
    for (const [i, n] of row.entries()) {
      const at = neighbors(n.id).map((id) => index.get(id)).filter((v): v is number => v !== undefined);
      key.set(n.id, at.length === 0 ? i : at.reduce((s, v) => s + v, 0) / at.length);
    }
    row.sort((a, b) => key.get(a.id)! - key.get(b.id)! || index.get(a.id)! - index.get(b.id)!);
    reindex(row);
  };

  const ups = (id: string) => graph.incoming(id).filter((e) => !back.has(e.id)).map((e) => e.from);
  const downs = (id: string) => graph.outgoing(id).filter((e) => !back.has(e.id)).map((e) => e.to);
  for (let s = 0; s < SWEEPS; s++) {
    for (let r = 1; r < out.length; r++) reorder(out[r]!, ups);
    for (let r = out.length - 2; r >= 0; r--) reorder(out[r]!, downs);
  }
  return out;
}
```

- [ ] **Step 6: Use it in `layered`**

In `layered.ts`, replace the loop that builds `packed` so that the in-rank order is computed first, then optionally reordered:

```ts
  const rows = [...byRank.keys()].sort((a, b) => a - b);
  const back = backEdges(graph);
  let ordered = rows.map((rank) => seededOrder(byRank.get(rank)!, axes.cross, order));
  if (opts.order === 'barycenter') ordered = barycenterOrder(graph, ordered, back);
  const packed = new Map<number, ReturnType<typeof packAcross>>();
  let widest = 0;
  for (const [i, rank] of rows.entries()) {
    const p = packAcross(ordered[i]!, axes.cross, nodeGap);
    packed.set(rank, p);
    widest = Math.max(widest, p.span);
  }
```

Also change `const ranks = ranksOf(graph, backEdges(graph));` to `const ranks = ranksOf(graph, back);`, moving the `back` declaration above it, and add `import { barycenterOrder } from './barycenter';`.

- [ ] **Step 7: Run the new tests and the existing layout tests**

Run: `npx vitest run packages/diagram/src/barycenter.test.ts packages/diagram/src/layout.test.ts`
Expected: all pass; `layout.test.ts`'s idempotence tests still pass, because the default is unchanged.

- [ ] **Step 8: Commit**

```bash
git add packages/diagram/src/layout.ts packages/diagram/src/layered.ts packages/diagram/src/barycenter.ts packages/diagram/src/barycenter.test.ts
git commit -m "add a barycenter order option to layered, for diagrams with no arranged order

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `diagramScene`, a laid-out scene from plain data

**Files:**
- Create: `…/packages/diagram/src/fromData.ts`
- Test: `…/packages/diagram/src/fromData.test.ts`
- Modify: `…/packages/diagram/src/index.ts` (exports)

**Interfaces:**
- Consumes: `layered` and `LayoutOptions.order` from Task 2; `EDGE_DERIVE_PATH`, `LABEL_DERIVE_POSE` (existing).
- Produces:

```ts
export interface DataNode { id: string; lines: readonly string[] }
export interface DataEdge { from: string; to: string; label?: string }
export interface DiagramData { nodes: readonly DataNode[]; edges: readonly DataEdge[] }
export interface NodeStyle { fill: string; stroke: string; text: string; strokeWidth?: number }
export interface EdgeStyle { stroke: string; width?: number }
export interface DiagramSceneData {
  diagram?: DiagramNode | DiagramEdge | { label: DiagramLabel };
  fill?: { color: string };
  stroke?: Stroke;
  text?: string;
  style?: { fontFamily: string; fontSize: number };
}
export type DiagramSpec = AddNodeSpec<DiagramSceneData, 'main', RectPose>;
export interface DiagramSceneOptions {
  layout?: LayoutFn;              // default layered
  layoutOptions?: LayoutOptions;  // default { order: 'barycenter' }
  router?: 'straight' | 'bezier' | 'orthogonal'; // default 'bezier'
  font?: { fontFamily: string; fontSize: number }; // default sans-serif 12
  nodeStyle?: (node: DataNode) => NodeStyle;
  edgeStyle?: (edge: DataEdge) => EdgeStyle;
}
export function diagramScene(data: DiagramData, opts?: DiagramSceneOptions): DiagramSpec[];
export function edgeIdOf(edge: DataEdge): string; // `edge:<from>-><to>` plus `:<label>` when labeled
```

- [ ] **Step 1: Write the failing test**

`packages/diagram/src/fromData.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createScene } from '@weasel-js/core';
import { diagramScene, edgeIdOf, type DiagramData } from './fromData';
import { withDiagramRegistry } from './edge';

const DATA: DiagramData = {
  nodes: [
    { id: 'a', lines: ['level mix', '0–1'] },
    { id: 'b', lines: ['warm'] },
    { id: 'c', lines: ['color', 'hex'] },
  ],
  edges: [{ from: 'a', to: 'b', label: 'weight' }, { from: 'b', to: 'c' }],
};

const containers = (specs: ReturnType<typeof diagramScene>) =>
  specs.filter((s) => s.kind === 'container');

describe('diagramScene', () => {
  it('makes one container per node, carrying the data id', () => {
    expect(containers(diagramScene(DATA)).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('makes one text child per line, unpickable', () => {
    const texts = diagramScene(DATA).filter((s) => s.data?.text !== undefined && s.parent === ('a' as never));
    expect(texts.map((t) => t.data?.text)).toEqual(['level mix', '0–1']);
    expect(texts.every((t) => t.pickable === false)).toBe(true);
  });

  it('lays nodes out in ranks running down by default', () => {
    const ys = containers(diagramScene(DATA)).map((s) => (s.pose as { y: number }).y);
    expect(ys[0]).toBeLessThan(ys[1]!);
    expect(ys[1]).toBeLessThan(ys[2]!);
  });

  it('gives each edge a stable id and a label node', () => {
    const specs = diagramScene(DATA);
    const edge = specs.find((s) => s.id === (edgeIdOf(DATA.edges[0]!) as never));
    expect(edge?.dependsOn).toEqual(['a', 'b']);
    expect(specs.some((s) => s.data?.text === 'weight' && s.dependsOn?.[0] === edge?.id)).toBe(true);
  });

  it('drops an edge whose end is not a node', () => {
    const specs = diagramScene({ nodes: DATA.nodes, edges: [{ from: 'a', to: 'nowhere' }] });
    expect(specs.some((s) => s.dependsOn !== undefined)).toBe(false);
  });

  it('applies nodeStyle and edgeStyle', () => {
    const specs = diagramScene(DATA, {
      nodeStyle: () => ({ fill: '#000000', stroke: '#ff0000', text: '#ffffff', strokeWidth: 3 }),
      edgeStyle: () => ({ stroke: '#00ff00', width: 1 }),
    });
    expect(containers(specs)[0]!.data?.stroke).toEqual({ paint: { color: '#ff0000' }, width: 3 });
    const edge = specs.find((s) => s.id === (edgeIdOf(DATA.edges[1]!) as never));
    expect(edge?.data?.stroke).toMatchObject({ paint: { color: '#00ff00' }, width: 1 });
  });

  it('handles one node and no edges', () => {
    expect(containers(diagramScene({ nodes: [{ id: 'pose', lines: ['pose'] }], edges: [] }))).toHaveLength(1);
  });

  it('loads into a scene', () => {
    const scene = createScene({
      systemLayers: [{ id: 'main' as const }],
      initial: diagramScene(DATA),
      registry: withDiagramRegistry(),
    });
    expect(scene.get('b' as never)).toBeDefined();
  });
});
```

If `createScene` does not take `initial`/`registry`, check the `UseSceneOptions` type in `packages/core/src/core/scene/` and add the specs with `scene.add` in a loop instead.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run packages/diagram/src/fromData.test.ts`
Expected: fails with "Cannot find module './fromData'".

- [ ] **Step 3: Write `fromData.ts`**

```ts
/**
 * `diagramScene` — a laid-out diagram from plain `{ nodes, edges }`.
 *
 * Sizes are estimated from character counts, not measured, so layout runs
 * without a canvas and gives the same answer in node and in a browser.
 */
import type { AddNodeSpec, RectPose, Stroke } from '@weasel-js/core';
import { EDGE_DERIVE_PATH, type DiagramEdge } from './edge';
import type { Graph, GraphEdge, GraphNode } from './graph';
import { LABEL_DERIVE_POSE, type DiagramLabel } from './label';
import { layered } from './layered';
import type { LayoutFn, LayoutOptions } from './layout';
import type { DiagramNode } from './types';

export interface DataNode { id: string; lines: readonly string[] }
export interface DataEdge { from: string; to: string; label?: string }
export interface DiagramData { nodes: readonly DataNode[]; edges: readonly DataEdge[] }
export interface NodeStyle { fill: string; stroke: string; text: string; strokeWidth?: number }
export interface EdgeStyle { stroke: string; width?: number }

export interface DiagramSceneData {
  diagram?: DiagramNode | DiagramEdge | { label: DiagramLabel };
  fill?: { color: string };
  stroke?: Stroke;
  text?: string;
  style?: { fontFamily: string; fontSize: number };
}

export type DiagramSpec = AddNodeSpec<DiagramSceneData, 'main', RectPose>;

export interface DiagramSceneOptions {
  layout?: LayoutFn;
  layoutOptions?: LayoutOptions;
  router?: 'straight' | 'bezier' | 'orthogonal';
  font?: { fontFamily: string; fontSize: number };
  nodeStyle?: (node: DataNode) => NodeStyle;
  edgeStyle?: (edge: DataEdge) => EdgeStyle;
}

const FONT = { fontFamily: 'sans-serif', fontSize: 12 };
const NODE: NodeStyle = { fill: '#16222c', stroke: '#7ba7c7', text: '#dbe7f2' };
const EDGE: EdgeStyle = { stroke: '#7ba7c7' };
const PAD = { x: 12, y: 8 };
const LINE = 1.4;
const GLYPH = 0.6;
const MIN_WIDTH = 64;

export const edgeIdOf = (e: DataEdge) => `edge:${e.from}->${e.to}${e.label ? `:${e.label}` : ''}`;

function sizeOf(node: DataNode, fontSize: number) {
  const longest = Math.max(0, ...node.lines.map((l) => l.length));
  return {
    width: Math.max(MIN_WIDTH, Math.ceil(longest * GLYPH * fontSize + 2 * PAD.x)),
    height: Math.ceil(Math.max(1, node.lines.length) * LINE * fontSize + 2 * PAD.y),
  };
}

function graphOf(nodes: GraphNode[], edges: GraphEdge[]): Graph {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, GraphEdge[]>();
  const inc = new Map<string, GraphEdge[]>();
  for (const e of edges) {
    out.set(e.from, [...(out.get(e.from) ?? []), e]);
    inc.set(e.to, [...(inc.get(e.to) ?? []), e]);
  }
  return {
    nodes,
    edges,
    node: (id) => byId.get(id),
    outgoing: (id) => out.get(id) ?? [],
    incoming: (id) => inc.get(id) ?? [],
  };
}

export function diagramScene(data: DiagramData, opts: DiagramSceneOptions = {}): DiagramSpec[] {
  const font = opts.font ?? FONT;
  const ids = new Set(data.nodes.map((n) => n.id));
  const edges = data.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  // Seeded on the diagonal in source order, so whichever axis a layout reads
  // for in-rank order, it starts from the data's own order.
  const seeds: GraphNode[] = data.nodes.map((n, i) => ({
    id: n.id,
    bounds: { x: i, y: i, ...sizeOf(n, font.fontSize) },
    pinned: false,
  }));
  const graph = graphOf(seeds, edges.map((e) => ({ id: edgeIdOf(e), from: e.from, to: e.to })));
  const moved = (opts.layout ?? layered)(graph, opts.layoutOptions ?? { order: 'barycenter' });

  const specs: DiagramSpec[] = [];
  for (const [i, n] of data.nodes.entries()) {
    const seed = seeds[i]!.bounds;
    const at = moved.get(n.id) ?? seed;
    const pose = { x: at.x, y: at.y, width: seed.width, height: seed.height };
    const style = opts.nodeStyle?.(n) ?? NODE;
    specs.push({
      id: n.id as never,
      kind: 'container',
      layer: 'main',
      pose,
      data: {
        diagram: { outline: 'rect' },
        fill: { color: style.fill },
        stroke: { paint: { color: style.stroke }, width: style.strokeWidth ?? 2 },
      },
    });
    for (const [k, text] of n.lines.entries()) {
      specs.push({
        kind: 'leaf',
        layer: 'main',
        parent: n.id as never,
        pickable: false,
        pose: {
          x: pose.x + PAD.x,
          y: pose.y + PAD.y + k * LINE * font.fontSize,
          width: pose.width - 2 * PAD.x,
          height: LINE * font.fontSize,
        },
        data: { text, style: font, fill: { color: style.text } },
      });
    }
  }
  for (const e of edges) {
    const id = edgeIdOf(e);
    const style = opts.edgeStyle?.(e) ?? EDGE;
    specs.push({
      id: id as never,
      kind: 'leaf',
      layer: 'main',
      pickable: false,
      pose: { x: 0, y: 0, width: 0, height: 0 },
      data: {
        diagram: { from: {}, to: {}, router: opts.router ?? 'bezier' },
        stroke: { paint: { color: style.stroke }, width: style.width ?? 1.5, markerEnd: 'arrow' },
      },
      dependsOn: [e.from as never, e.to as never],
      derivePath: EDGE_DERIVE_PATH,
    });
    if (e.label) {
      specs.push({
        kind: 'leaf',
        layer: 'main',
        pickable: false,
        pose: { x: 0, y: 0, width: e.label.length * GLYPH * (font.fontSize - 2), height: font.fontSize },
        data: {
          diagram: { label: { at: e.label, offset: 9 } },
          text: e.label,
          style: { ...font, fontSize: font.fontSize - 2 },
          fill: { color: style.stroke },
        },
        dependsOn: [id as never],
        derivePose: LABEL_DERIVE_POSE as never,
      });
    }
  }
  return specs;
}
```

Check `DiagramLabel`'s fields against `label.ts` before relying on `{ at, offset }`. The edges demo passes `at` as the router name; read what `at` means there and use the right value.

- [ ] **Step 4: Export it**

In `index.ts`, after the label exports:

```ts
export { diagramScene, edgeIdOf } from './fromData';
export type {
  DataEdge,
  DataNode,
  DiagramData,
  DiagramSceneData,
  DiagramSceneOptions,
  DiagramSpec,
  EdgeStyle,
  NodeStyle,
} from './fromData';
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run packages/diagram/src/fromData.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add packages/diagram/src/fromData.ts packages/diagram/src/fromData.test.ts packages/diagram/src/index.ts
git commit -m "add diagramScene, a laid-out diagram from plain nodes and edges

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `DiagramView`, its demo, docs and changeset

**Files:**
- Create: `…/packages/diagram/src/DiagramView.tsx`, `…/packages/diagram/src/mirrorSelection.ts`
- Test: `…/packages/diagram/src/mirrorSelection.test.ts`
- Modify: `…/packages/diagram/src/index.ts`, `…/packages/diagram/README.md`
- Create: `…/apps/site/demos/DiagramDataDemo.tsx`
- Modify: `…/apps/site/registry.ts` (one entry beside `diagram-layout`)
- Create: `…/.changeset/diagram-from-data.md`

**Interfaces:**
- Consumes: `DiagramSpec`, `diagramScene` (Task 3).
- Produces:

```ts
export interface DiagramViewProps {
  specs: readonly DiagramSpec[];
  width: number;
  height: number;
  /** A participant id, or null for none. */
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  className?: string;
}
export function DiagramView(props: DiagramViewProps): JSX.Element;
export function useMirroredSelection(
  selection: Pick<SelectionApi, 'current' | 'set'>,
  selected: string | null | undefined,
  onSelect: ((id: string | null) => void) | undefined,
): void;
```

- [ ] **Step 1: Write the failing test for the selection mirror**

`packages/diagram/src/mirrorSelection.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMirroredSelection } from './mirrorSelection';

const api = (current: string[]) => ({ current: current as never[], set: vi.fn() });

describe('useMirroredSelection', () => {
  it('pushes the prop into the canvas selection', () => {
    const sel = api([]);
    renderHook(() => useMirroredSelection(sel, 'a', undefined));
    expect(sel.set).toHaveBeenCalledWith(['a']);
  });

  it('reports a canvas pick through onSelect', () => {
    const onSelect = vi.fn();
    let current: string[] = [];
    const { rerender } = renderHook(() => useMirroredSelection(api(current), null, onSelect));
    current = ['b'];
    rerender();
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('does not report on mount, so a controlled prop is never cleared', () => {
    const onSelect = vi.fn();
    renderHook(() => useMirroredSelection(api([]), 'a', onSelect));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does not report the echo of its own push', () => {
    const onSelect = vi.fn();
    let current: string[] = [];
    const { rerender } = renderHook(() => useMirroredSelection(api(current), 'a', onSelect));
    current = ['a'];
    rerender();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('does nothing when the two agree', () => {
    const sel = api(['a']);
    const onSelect = vi.fn();
    renderHook(() => useMirroredSelection(sel, 'a', onSelect));
    expect(sel.set).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run packages/diagram/src/mirrorSelection.test.ts`
Expected: fails, module not found.

- [ ] **Step 3: Write `mirrorSelection.ts`**

```ts
import type { NodeId, SelectionApi } from '@weasel-js/core';
import { useEffect, useRef } from 'react';

/** Keeps a canvas selection and a controlled `selected` prop in step: a prop
 *  change is pushed in, a pick on the canvas is reported out. */
export function useMirroredSelection(
  selection: Pick<SelectionApi, 'current' | 'set'>,
  selected: string | null | undefined,
  onSelect: ((id: string | null) => void) | undefined,
): void {
  const picked = (selection.current[0] as string | undefined) ?? null;
  const want = selected ?? null;
  const pushed = useRef<string | null | undefined>(undefined);
  const seen = useRef(picked);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the prop changes, not the canvas
  useEffect(() => {
    if (pushed.current === want) return;
    pushed.current = want;
    if (picked !== want) selection.set(want === null ? [] : [want as NodeId]);
  }, [want]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the canvas changes, not the prop
  useEffect(() => {
    if (seen.current === picked) return;
    seen.current = picked;
    if (picked !== want) onSelect?.(picked);
  }, [picked]);
}
```

The second effect reports only a change on the canvas, never the state it mounted with and never the echo of a prop push. Weasel lints with ESLint, not biome. Swap the two `biome-ignore` lines for whatever the repo's `react-hooks/exhaustive-deps` suppression looks like elsewhere (`grep -rn exhaustive-deps packages | head -3`).

- [ ] **Step 4: Run it**

Run: `npx vitest run packages/diagram/src/mirrorSelection.test.ts`
Expected: pass.

- [ ] **Step 5: Write `DiagramView.tsx`**

```tsx
import {
  fitViewToBounds,
  SceneCanvas,
  useScene,
  useSelection,
  WeaselProvider,
  type RectPose,
} from '@weasel-js/core';
import { useEffect, useMemo } from 'react';
import { withDiagramRegistry } from './edge';
import type { DiagramSceneData, DiagramSpec } from './fromData';
import { useMirroredSelection } from './mirrorSelection';
import { registerDiagramShape } from './shape';

export interface DiagramViewProps {
  specs: readonly DiagramSpec[];
  width: number;
  height: number;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  className?: string;
}

let made = 0;
const keys = new WeakMap<readonly DiagramSpec[], number>();
const keyOf = (specs: readonly DiagramSpec[]) => {
  let k = keys.get(specs);
  if (k === undefined) keys.set(specs, (k = ++made));
  return k;
};

/** A read-only diagram: pan, zoom and pick a node, nothing else. A new `specs`
 *  array is a new scene, fitted to the box. */
export function DiagramView(props: DiagramViewProps) {
  return (
    <WeaselProvider>
      <Inner key={keyOf(props.specs)} {...props} />
    </WeaselProvider>
  );
}

function Inner({ specs, width, height, selected, onSelect, className }: DiagramViewProps) {
  useEffect(() => registerDiagramShape<RectPose>(), []);
  const registry = useMemo(() => withDiagramRegistry<RectPose>(), []);
  const scene = useScene<DiagramSceneData, 'main', RectPose>({
    systemLayers: [{ id: 'main' }],
    initial: specs as DiagramSpec[],
    registry,
  });
  const selection = useSelection({ scene, mode: 'single' });
  useMirroredSelection(selection, selected, onSelect);
  const defaultView = useMemo(() => {
    const boxes = specs.filter((s) => s.kind === 'container').map((s) => s.pose as RectPose);
    if (boxes.length === 0) return undefined;
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    const bounds = {
      x,
      y,
      width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
      height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
    };
    return fitViewToBounds(bounds, { width, height }, { x: 0, y: 0, scale: { x: 1, y: 1 } }, { maxScale: 1 });
  }, [specs, width, height]);
  return (
    <SceneCanvas
      scene={scene}
      selection={selection}
      features={['view', 'pick']}
      width={width}
      height={height}
      className={className}
      {...(defaultView ? { defaultView } : {})}
    />
  );
}
```

If `useSelection`'s `scene` option or `SceneCanvas`'s `defaultView` typing differs from what is assumed here, follow `apps/site/demos/DiagramLayoutDemo.tsx` and `SceneCanvas.view.test.tsx`; neither is `@experimental`.

- [ ] **Step 6: Export both**

In `index.ts`:

```ts
export { DiagramView } from './DiagramView';
export type { DiagramViewProps } from './DiagramView';
export { useMirroredSelection } from './mirrorSelection';
```

Check `tsup.config.ts`'s `external` already lists `react`; it does.

- [ ] **Step 7: Add the site demo**

`apps/site/demos/DiagramDataDemo.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { DiagramView, diagramScene, type DiagramData } from '@weasel-js/diagram';

/** Sinks listed out of order on purpose: the barycenter pass is what keeps
 *  these edges from crossing. */
const DATA: DiagramData = {
  nodes: [
    { id: 'mix', lines: ['level mix', '0–1'] },
    { id: 'inv', lines: ['1 − mix'] },
    { id: 'warm', lines: ['warm', 'keys · 1000 ms'] },
    { id: 'cool', lines: ['cool', 'keys · 1000 ms'] },
    { id: 'scale', lines: ['scale', 'mul'] },
    { id: 'color', lines: ['color', 'hex'] },
    { id: 'pose', lines: ['pose', '× 32 dots'] },
  ],
  edges: [
    { from: 'mix', to: 'inv' },
    { from: 'inv', to: 'warm', label: 'weight' },
    { from: 'mix', to: 'cool', label: 'weight' },
    { from: 'warm', to: 'color' },
    { from: 'warm', to: 'scale' },
    { from: 'cool', to: 'color' },
    { from: 'cool', to: 'scale' },
    { from: 'color', to: 'pose' },
    { from: 'scale', to: 'pose' },
  ],
};

export function DiagramDataDemo() {
  const specs = useMemo(() => diagramScene(DATA), []);
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <div className="ckd-stack">
      <div className="ckd-row">picked: {picked ?? 'none'}</div>
      <DiagramView specs={specs} width={640} height={420} selected={picked} onSelect={setPicked} className="ckd-canvas" />
    </div>
  );
}
```

In `apps/site/registry.ts`, add after the `diagram-layout` entry, copying its shape:

```ts
  {
    id: 'diagram-data',
    title: 'Diagram from data',
    package: 'diagram',
    description:
      'diagramScene takes plain nodes and edges and returns a laid-out scene; DiagramView draws it read-only, with pan, zoom and picking. Layout defaults to layered with order: barycenter, which reorders each rank to reduce crossings, since generated data has no arranged order to keep. Click a node to pick it.',
    load: () => import('./demos/DiagramDataDemo').then((m) => m.DiagramDataDemo),
    path: 'apps/site/demos/DiagramDataDemo.tsx',
  },
```

Match whatever other fields neighboring entries carry.

- [ ] **Step 8: See it**

Run `npm run dev:kit` in the background from the worktree, then open `/#diagram-data` headless (playwright MCP). Screenshot it, `transom post` the shot to zone `weasel`, and check that the edges don't cross, each label sits on its edge, and clicking a node updates "picked". Stop the dev server when done.

- [ ] **Step 9: README and changeset**

In `packages/diagram/README.md`, add a section after "Laying it out":

````markdown
### From data

`diagramScene` turns plain `{ nodes, edges }` into a laid-out scene, and
`DiagramView` draws one read-only, with pan, zoom and picking:

```tsx
const specs = useMemo(() => diagramScene(data, { nodeStyle }), [data]);
return <DiagramView specs={specs} width={360} height={600} selected={id} onSelect={setId} />;
```

Node sizes are estimated from line lengths, so layout runs without a canvas.
It defaults to `layered` with `order: 'barycenter'`.
````

`.changeset/diagram-from-data.md`:

```markdown
---
'@weasel-js/diagram': minor
---

Add `diagramScene` and `DiagramView`, a laid-out read-only diagram from plain nodes and edges, and `order: 'barycenter'` for `layered`, which reorders ranks to reduce crossings.
```

Check `.changeset/config.json` for fixed or linked groups. If every package versions together, the changeset still names only diagram.

- [ ] **Step 10: Run the diagram package's tests and typecheck**

Run: `npx vitest run packages/diagram && npx tsc -p packages/diagram/tsconfig.json --noEmit && npm run build -w @weasel-js/diagram`
Expected: all pass; `packages/diagram/dist/index.d.ts` declares `DiagramView` and `diagramScene`.

- [ ] **Step 11: Commit**

```bash
git add packages/diagram apps/site/demos/DiagramDataDemo.tsx apps/site/registry.ts .changeset/diagram-from-data.md
git commit -m "add DiagramView, a read-only diagram with pan, zoom and picking, and a demo from data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `flowOf`, the composition's signal-flow graph

**Files:**
- Create: `apps/playground/src/widgets/FlowDiagram/types.ts`
- Create: `apps/playground/src/blits/flow.ts`
- Test: `apps/playground/test/flow.test.ts`

**Interfaces:**
- Produces (`types.ts`, owned by the widget as `ScoreLanes` owns clips):

```ts
export type FlowKind = 'level' | 'signal' | 'expr' | 'voice' | 'channel' | 'pose' | 'rest';
export interface FlowNode {
  id: string;
  kind: FlowKind;
  label: string;
  detail?: string;
  hue?: number;
  faulted?: boolean;
}
export interface FlowEdge { id: string; from: string; to: string; label?: string }
export interface Flow { nodes: FlowNode[]; edges: FlowEdge[] }
```

- Produces (`flow.ts`): `flowOf(comp: Composition, faulted?: ReadonlySet<string>): Flow`, `writesOf(patch: PatchSource): ChannelName[]`.

- [ ] **Step 1: Write the types**

`apps/playground/src/widgets/FlowDiagram/types.ts` with exactly the block above.

- [ ] **Step 2: Write the failing test**

`apps/playground/test/flow.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Composition, Voice } from '@pg/blits/composition';
import { flowOf, writesOf } from '@pg/blits/flow';
import { KIT } from '@pg/blits/kit';
import crossfade from '@pg/blits/presets/crossfade';
import pointerGlow from '@pg/blits/presets/pointer-glow';

const edges = (c: Composition, faulted?: Set<string>) =>
  flowOf(c, faulted).edges.map((e) => [e.from, e.to, e.label ?? ''] as const);
const node = (c: Composition, id: string) => flowOf(c).nodes.find((n) => n.id === id);

const voice = (over: Partial<Voice>): Voice => ({
  id: 'v', name: 'v', hue: 0, start: 0, rate: 1, loop: true, fade: {}, weight: 1,
  patch: { kind: 'keys', period: 1000, stops: [{ at: 0, delta: { glow: 1 } }] },
  ...over,
});
const comp = (voices: Voice[], levels: Composition['levels'] = []): Composition => ({
  version: 1, title: 't', stage: { kind: 'dots', cols: 2, rows: 1 }, length: 1000, levels, voices,
});

describe('flowOf', () => {
  it('draws the crossfade preset', () => {
    expect(new Set(flowOf(crossfade).nodes.map((n) => n.id))).toEqual(
      new Set(['level:mix', 'voice:warm', 'expr:warm:weight', 'voice:cool', 'ch:color', 'ch:scale', 'pose']),
    );
    expect(new Set(edges(crossfade))).toEqual(new Set([
      ['level:mix', 'expr:warm:weight', ''],
      ['expr:warm:weight', 'voice:warm', 'weight'],
      ['level:mix', 'voice:cool', 'weight'],
      ['voice:warm', 'ch:color', ''],
      ['voice:warm', 'ch:scale', ''],
      ['voice:cool', 'ch:color', ''],
      ['voice:cool', 'ch:scale', ''],
      ['ch:color', 'pose', ''],
      ['ch:scale', 'pose', ''],
    ]));
  });

  it('labels a channel with its rule and the pose with its subjects', () => {
    expect(node(crossfade, 'ch:color')?.detail).toBe(KIT.color.kind);
    expect(node(crossfade, 'pose')?.detail).toBe('× 32 dots');
  });

  it('makes a signal op a node of its own', () => {
    expect(node(pointerGlow, 'sig:glow:weight:0')?.label).toBe('slew(riseMs 150, fallMs 900)');
    expect(edges(pointerGlow)).toContainEqual(['level:mouse', 'sig:glow:weight:0', '']);
    expect(edges(pointerGlow)).toContainEqual(['sig:glow:weight:0', 'voice:glow', 'weight']);
  });

  it('marks a level the composition lacks', () => {
    const c = comp([voice({ weight: { code: 'level("gone")' } })]);
    expect(node(c, 'level:gone')).toMatchObject({ faulted: true, detail: 'missing: reads 0' });
  });

  it('gives an expression with no signal calls a node with no inputs', () => {
    const c = comp([voice({ stagger: { code: '(s) => s.index / 10' } })]);
    expect(node(c, 'expr:v:stagger')?.label).toBe('s.index / 10');
    expect(edges(c)).toContainEqual(['expr:v:stagger', 'voice:v', 'stagger']);
    expect(edges(c).filter(([, to]) => to === 'expr:v:stagger')).toEqual([]);
  });

  it('draws a voice that writes nothing, with no channel', () => {
    const c = comp([voice({ patch: { kind: 'fn', period: 1000, writes: [], at: '() => ({})' } })]);
    expect(node(c, 'voice:v')).toBeDefined();
    expect(flowOf(c).nodes.some((n) => n.kind === 'channel')).toBe(false);
  });

  it('draws one edge for a level read twice', () => {
    const c = comp([voice({ weight: { code: '(s, set) => level("a")(s, set) * level("a")(s, set)' } })], [
      { name: 'a', value: 1, min: 0, max: 1 },
    ]);
    expect(edges(c).filter(([from]) => from === 'level:a')).toHaveLength(1);
  });

  it('keeps an unparsable expression as one faulted node', () => {
    const c = comp([voice({ weight: { code: 'level("a"' } })]);
    expect(node(c, 'expr:v:weight')).toMatchObject({ kind: 'expr', faulted: true });
  });

  it('marks a voice that failed to compile', () => {
    expect(flowOf(crossfade, new Set(['warm'])).nodes.find((n) => n.id === 'voice:warm')?.faulted).toBe(true);
  });

  it('gives an empty composition a pose and nothing else', () => {
    expect(flowOf(comp([])).nodes.map((n) => n.id)).toEqual(['pose']);
  });
});

describe('writesOf', () => {
  it('reads keys, fn and motion patches', () => {
    expect(writesOf({ kind: 'keys', period: 1, stops: [{ at: 0, delta: { scale: 1, color: 0 } }] })).toEqual(['scale', 'color']);
    expect(writesOf({ kind: 'fn', period: 1, writes: ['turn'], at: '' })).toEqual(['turn']);
    expect(writesOf({ kind: 'spring', channel: 'offset', opts: {} })).toEqual(['offset']);
  });
});
```

`writesOf` returns channels in `CHANNELS` order (`offset, turn, scale, color, opacity, glow`), hence `['scale', 'color']`.

- [ ] **Step 3: Run it to see it fail**

Run: `cd ~/src/blits && npx vitest run apps/playground/test/flow.test.ts`
Expected: fails, `@pg/blits/flow` not found.

- [ ] **Step 4: Write `flow.ts`**

```ts
import { parseExpressionAt } from 'acorn';
import type { Flow, FlowEdge, FlowNode } from '@pg/widgets/FlowDiagram/types';
import { type Composition, type Expr, isExpr, type Level, type PatchSource, type Voice } from './composition';
import { CHANNELS, type ChannelName, KIT } from './kit';
import { subjectsOf } from './stage';

const OPS = new Set(['gate', 'lag', 'peak', 'slew']);
const FIELDS = ['weight', 'stagger', 'target'] as const;
const MAX_LABEL = 28;

type AstNode = { type: string; start: number; end: number; [k: string]: unknown };
const isAst = (v: unknown): v is AstNode =>
  typeof v === 'object' && v !== null && typeof (v as AstNode).type === 'string';

const clip = (s: string) => {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > MAX_LABEL ? `${flat.slice(0, MAX_LABEL - 1)}…` : flat;
};
const bodyOf = (code: string) => code.replace(/^\s*(\([^)]*\)|\w+)\s*=>\s*/, '');

const calleeOf = (n: AstNode): string | null =>
  n.type === 'CallExpression' && isAst(n.callee) && n.callee.type === 'Identifier'
    ? (n.callee.name as string)
    : null;

function levelNameOf(n: AstNode): string | null {
  if (calleeOf(n) !== 'level') return null;
  const [arg] = n.arguments as AstNode[];
  return arg?.type === 'Literal' && typeof arg.value === 'string' ? arg.value : null;
}

function argText(n: AstNode, code: string): string {
  if (n.type !== 'ObjectExpression') return code.slice(n.start, n.end);
  return (n.properties as AstNode[])
    .map((p) => {
      const key = isAst(p.key) ? code.slice(p.key.start, p.key.end) : '';
      const value = isAst(p.value) ? code.slice(p.value.start, p.value.end) : '';
      return `${key} ${value}`;
    })
    .join(', ');
}

function parse(code: string): AstNode | null {
  try {
    const root = parseExpressionAt(code, 0, { ecmaVersion: 'latest' }) as unknown as AstNode;
    return code.slice(root.end).trim() === '' ? root : null;
  } catch {
    return null;
  }
}

/** The channels a patch writes, in `CHANNELS` order. */
export function writesOf(p: PatchSource): ChannelName[] {
  if (p.kind === 'keys') {
    const seen = new Set(p.stops.flatMap((s) => Object.keys(s.delta)));
    return CHANNELS.filter((c) => seen.has(c));
  }
  if (p.kind === 'fn') return CHANNELS.filter((c) => p.writes.includes(c));
  return [p.channel];
}

function voiceDetail(v: Voice): string {
  const parts: string[] = [v.patch.kind];
  if (v.patch.kind === 'keys' || v.patch.kind === 'fn') parts.push(`${v.patch.period} ms`);
  if (v.loop === true) parts.push('loop');
  else if (typeof v.loop === 'number') parts.push(`×${v.loop}`);
  if (typeof v.weight === 'number') parts.push(`w ${v.weight}`);
  return parts.join(' · ');
}

class Builder {
  readonly nodes = new Map<string, FlowNode>();
  readonly edges = new Map<string, FlowEdge>();
  constructor(private readonly levels: ReadonlyMap<string, Level>) {}

  node(n: FlowNode): string {
    if (!this.nodes.has(n.id)) this.nodes.set(n.id, n);
    return n.id;
  }

  edge(from: string, to: string, label?: string) {
    const id = `${from}->${to}${label ? `:${label}` : ''}`;
    if (!this.edges.has(id)) this.edges.set(id, { id, from, to, ...(label ? { label } : {}) });
  }

  level(name: string): string {
    const l = this.levels.get(name);
    return this.node({
      id: `level:${name}`,
      kind: 'level',
      label: name,
      ...(l ? { detail: `${l.min}–${l.max}` } : { detail: 'missing: reads 0', faulted: true }),
    });
  }

  /** The node a signal call stands for, or null when `n` is not one. */
  signal(n: AstNode, code: string, path: string): string | null {
    const name = levelNameOf(n);
    if (name !== null) return this.level(name);
    const op = calleeOf(n);
    if (op === null || !OPS.has(op)) return null;
    const parts: string[] = [];
    const inputs: string[] = [];
    for (const [i, arg] of (n.arguments as AstNode[]).entries()) {
      const input = this.signal(arg, code, `${path}.${i}`);
      if (input === null) parts.push(argText(arg, code));
      else inputs.push(input);
    }
    const id = this.node({ id: `sig:${path}`, kind: 'signal', label: clip(`${op}(${parts.join(', ')})`) });
    for (const input of inputs) this.edge(input, id);
    return id;
  }

  /** Every outermost signal call under `root`. */
  inputs(root: AstNode, code: string, path: string): string[] {
    const found: string[] = [];
    let k = 0;
    const walk = (n: AstNode) => {
      const id = this.signal(n, code, `${path}.${k}`);
      if (id !== null) {
        k++;
        if (!found.includes(id)) found.push(id);
        return;
      }
      for (const v of Object.values(n)) {
        if (Array.isArray(v)) for (const c of v) isAst(c) && walk(c);
        else if (isAst(v)) walk(v);
      }
    };
    walk(root);
    return found;
  }

  field(v: Voice, field: (typeof FIELDS)[number], expr: Expr): string {
    const path = `${v.id}:${field}`;
    const root = parse(expr.code);
    const whole = root && this.signal(root, expr.code, `${path}:0`);
    if (whole) return whole;
    const id = this.node({
      id: `expr:${path}`,
      kind: 'expr',
      label: clip(bodyOf(expr.code)),
      ...(root ? {} : { faulted: true }),
    });
    if (root) for (const input of this.inputs(root, expr.code, `${path}:e`)) this.edge(input, id);
    return id;
  }
}

/** The signal flow of a composition: what feeds each voice, what each voice
 *  writes, and how each channel folds into the pose. `faulted` holds the ids
 *  of voices that failed to compile; they are drawn, marked. */
export function flowOf(comp: Composition, faulted: ReadonlySet<string> = new Set()): Flow {
  const b = new Builder(new Map(comp.levels.map((l) => [l.name, l])));
  for (const l of comp.levels) b.level(l.name);
  const written = new Set<ChannelName>();
  const writes: [string, ChannelName][] = [];
  for (const v of comp.voices) {
    const id = b.node({
      id: `voice:${v.id}`,
      kind: 'voice',
      label: v.name,
      detail: voiceDetail(v),
      hue: v.hue,
      ...(faulted.has(v.id) ? { faulted: true } : {}),
    });
    for (const field of FIELDS) {
      const e = v[field];
      if (isExpr(e)) b.edge(b.field(v, field, e), id, field);
    }
    for (const ch of writesOf(v.patch)) {
      written.add(ch);
      writes.push([id, ch]);
    }
  }
  for (const ch of CHANNELS) {
    if (written.has(ch)) b.node({ id: `ch:${ch}`, kind: 'channel', label: ch, detail: KIT[ch].kind ?? 'custom' });
  }
  for (const [id, ch] of writes) b.edge(id, `ch:${ch}`);
  const subjects = subjectsOf(comp.stage).length;
  b.node({
    id: 'pose',
    kind: 'pose',
    label: 'pose',
    detail: `× ${subjects} ${comp.stage.kind === 'dots' ? 'dots' : 'letters'}`,
  });
  for (const ch of CHANNELS) if (written.has(ch)) b.edge(`ch:${ch}`, 'pose');
  return { nodes: [...b.nodes.values()], edges: [...b.edges.values()] };
}
```

The signal id of a whole-field signal is `sig:<voice>:<field>:0`, which is what the test asserts for pointer glow. A nested signal appends `.<argIndex>`.

- [ ] **Step 5: Run the test**

Run: `npx vitest run apps/playground/test/flow.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/playground/src/widgets/FlowDiagram/types.ts apps/playground/src/blits/flow.ts apps/playground/test/flow.test.ts
git commit -m "add flowOf, a composition's signal flow from levels to the pose

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `foldOf`, one channel's fold

**Files:**
- Modify: `apps/playground/src/blits/flow.ts`
- Test: `apps/playground/test/flow.test.ts`

**Interfaces:**
- Consumes: `Flow`, `flowOf` (Task 5).
- Produces: `foldOf(flow: Flow, ch: ChannelName): Flow`, which is empty when nothing writes `ch`.

- [ ] **Step 1: Write the failing test**

Append to `apps/playground/test/flow.test.ts`:

```ts
import { foldOf } from '@pg/blits/flow';
import foldRules from '@pg/blits/presets/fold-rules';

describe('foldOf', () => {
  it('keeps only what reaches the channel', () => {
    const fold = foldOf(flowOf(crossfade), 'scale');
    expect(new Set(fold.nodes.map((n) => n.id))).toEqual(
      new Set(['ch:scale', 'voice:warm', 'voice:cool', 'expr:warm:weight', 'level:mix', 'rest:scale']),
    );
    expect(fold.edges.some((e) => e.to === 'pose')).toBe(false);
  });

  it('adds the rest the channel folds from, when it has one', () => {
    const fold = foldOf(flowOf(crossfade), 'scale');
    expect(fold.nodes.find((n) => n.id === 'rest:scale')).toMatchObject({ kind: 'rest', detail: String(KIT.scale.rest) });
    expect(fold.edges).toContainEqual(expect.objectContaining({ from: 'rest:scale', to: 'ch:scale' }));
  });

  it('has no rest node for a channel without a rest', () => {
    expect(foldOf(flowOf(crossfade), 'color').nodes.some((n) => n.kind === 'rest')).toBe(KIT.color.rest !== undefined);
  });

  it('is empty when nothing writes the channel', () => {
    expect(foldOf(flowOf(crossfade), 'turn')).toEqual({ nodes: [], edges: [] });
  });

  it('formats a vector rest', () => {
    const fold = foldOf(flowOf(foldRules), 'offset');
    if (KIT.offset.rest) expect(fold.nodes.find((n) => n.kind === 'rest')?.detail).toBe(`[${KIT.offset.rest.join(', ')}]`);
  });
});
```

Move the new imports to the top of the file with the others.

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run apps/playground/test/flow.test.ts`
Expected: fails, `foldOf` not exported.

- [ ] **Step 3: Write `foldOf`**

Append to `flow.ts`:

```ts
const restText = (rest: unknown) => (Array.isArray(rest) ? `[${rest.join(', ')}]` : String(rest));

/** What reaches one channel: its ancestors in `flow`, plus the rest it folds
 *  from when it has one. Empty when nothing writes the channel. */
export function foldOf(flow: Flow, ch: ChannelName): Flow {
  const root = `ch:${ch}`;
  if (!flow.nodes.some((n) => n.id === root)) return { nodes: [], edges: [] };
  const keep = new Set([root]);
  const queue = [root];
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    for (const e of flow.edges) {
      if (e.to === id && !keep.has(e.from)) {
        keep.add(e.from);
        queue.push(e.from);
      }
    }
  }
  const nodes = flow.nodes.filter((n) => keep.has(n.id));
  const edges = flow.edges.filter((e) => keep.has(e.from) && keep.has(e.to));
  const rest = KIT[ch].rest;
  if (rest !== undefined) {
    const id = `rest:${ch}`;
    nodes.push({ id, kind: 'rest', label: 'rest', detail: restText(rest) });
    edges.push({ id: `${id}->${root}`, from: id, to: root });
  }
  return { nodes, edges };
}
```

- [ ] **Step 4: Run it**

Run: `npx vitest run apps/playground/test/flow.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/playground/src/blits/flow.ts apps/playground/test/flow.test.ts
git commit -m "add foldOf, what reaches one channel and the rest it folds from

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Bring the local weasel-diagram into the playground

**Files:**
- Create: `apps/playground/scripts/link-diagram.sh`
- Modify: `apps/playground/.gitignore`, `apps/playground/package.json`, `package-lock.json`

**Interfaces:**
- Consumes: the worktree's built diagram package (Tasks 2–4).
- Produces: `@weasel-js/diagram` importable from playground code, from a tarball in `apps/playground/.weasel/`. Each pack overwrites the one file there (same name), which keeps that directory bounded. Task 11 deletes it.

- [ ] **Step 1: Write the link script**

`apps/playground/scripts/link-diagram.sh`:

```bash
#!/usr/bin/env bash
# Packs weasel-diagram from its worktree and installs the tarball, so the playground runs against
# unreleased diagram code with its own @weasel-js/core. Removed once weasel 1.9.0 is out.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
wt="${WEASEL_WT:-$HOME/src/weasel/.worktrees/diagram-from-data}"
mkdir -p "$here/.weasel"
(cd "$wt" && npm run build -w @weasel-js/diagram >/dev/null && npm pack -w @weasel-js/diagram --pack-destination "$here/.weasel" >/dev/null)
tgz="$(ls "$here/.weasel"/weasel-js-diagram-*.tgz | head -1)"
cd "$here/../.." && npm install --workspace @blits/playground "file:${tgz#$PWD/}"
```

Run `chmod +x apps/playground/scripts/link-diagram.sh`.

- [ ] **Step 2: Ignore the tarball directory**

Append `.weasel/` to `apps/playground/.gitignore`.

- [ ] **Step 3: Run it**

Run: `cd ~/src/blits && apps/playground/scripts/link-diagram.sh`
Expected: exits 0. `grep -c diagramScene node_modules/@weasel-js/diagram/dist/index.d.ts` prints at least `1`, and `grep '"@weasel-js/diagram"' apps/playground/package.json` shows a `file:` spec.

- [ ] **Step 4: Prove it resolves against the playground's own core**

Run: `ls node_modules/@weasel-js/diagram/node_modules/@weasel-js 2>/dev/null; npm run typecheck -w @blits/playground`
Expected: no nested `@weasel-js/core` copy, and typecheck passes. A nested copy means two cores and a broken `WeaselProvider` context. If one appears, the tarball's peer range doesn't match 1.8.1; widen `peerDependencies` in the worktree's `packages/diagram/package.json` to `^1.8.1`, commit that in weasel, and re-run the script.

- [ ] **Step 5: Commit**

```bash
git add apps/playground/scripts/link-diagram.sh apps/playground/.gitignore apps/playground/package.json package-lock.json
git commit -m "install weasel-diagram into the playground from a local pack, until 1.9.0 ships

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

The lockfile now records a `file:` path. It's unshippable until Task 11, which is why Task 11 exists.

---

### Task 8: `FlowDiagram` widget and its stories

**Files:**
- Create: `apps/playground/src/widgets/FlowDiagram/FlowDiagram.tsx`, `apps/playground/src/widgets/FlowDiagram/style.ts`, `apps/playground/src/widgets/FlowDiagram/index.ts`, `apps/playground/src/widgets/FlowDiagram/FlowDiagram.stories.tsx`
- Test: `apps/playground/test/flowStyle.test.ts`

**Interfaces:**
- Consumes: `Flow`, `FlowNode` (Task 5); `diagramScene`, `DiagramView`, `DataNode`, `NodeStyle`, `LayoutDirection` from `@weasel-js/diagram` (Tasks 2–4, linked in Task 7); `hueColor` from `@pg/widgets/hue`.
- Produces:

```ts
export interface FlowDiagramProps {
  flow: Flow;
  width: number;
  height: number;
  direction?: LayoutDirection; // default 'down'
  selected?: string | null;
  onSelect?: (id: string | null) => void;
}
export function FlowDiagram(props: FlowDiagramProps): JSX.Element;
export function linesOf(n: FlowNode): string[];
export function styleOf(n: FlowNode): NodeStyle;
```

- [ ] **Step 1: Write the failing test for the pure styling**

`apps/playground/test/flowStyle.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { FAULT, linesOf, styleOf } from '@pg/widgets/FlowDiagram/style';
import { hueColor } from '@pg/widgets/hue';

describe('FlowDiagram styling', () => {
  it('puts the label, then the detail, on lines', () => {
    expect(linesOf({ id: 'ch:color', kind: 'channel', label: 'color', detail: 'hex' })).toEqual(['color', 'hex']);
    expect(linesOf({ id: 'pose', kind: 'pose', label: 'pose' })).toEqual(['pose']);
  });

  it('strokes a voice in its hue', () => {
    expect(styleOf({ id: 'voice:a', kind: 'voice', label: 'a', hue: 200 }).stroke).toBe(hueColor(200));
  });

  it('strokes a faulted node in the fault color, heavier', () => {
    const s = styleOf({ id: 'level:x', kind: 'level', label: 'x', faulted: true });
    expect(s.stroke).toBe(FAULT);
    expect(s.strokeWidth).toBe(3);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run apps/playground/test/flowStyle.test.ts`
Expected: fails, module not found.

- [ ] **Step 3: Write `style.ts`**

```ts
import type { NodeStyle } from '@weasel-js/diagram';
import { hueColor } from '../hue';
import type { FlowKind, FlowNode } from './types';

export const FAULT = '#e5484d';
const FILL = '#16222c';
const TEXT = '#dbe7f2';
const STROKE: Record<FlowKind, string> = {
  level: '#5b84d6',
  signal: '#8a63d2',
  expr: '#8a63d2',
  voice: '#7ba7c7',
  channel: '#3f9a52',
  pose: '#c98a1c',
  rest: '#c98a1c',
};

export const linesOf = (n: FlowNode) => (n.detail ? [n.label, n.detail] : [n.label]);

export function styleOf(n: FlowNode): NodeStyle {
  if (n.faulted) return { fill: FILL, text: TEXT, stroke: FAULT, strokeWidth: 3 };
  const stroke = n.kind === 'voice' && n.hue !== undefined ? hueColor(n.hue) : STROKE[n.kind];
  return { fill: FILL, text: TEXT, stroke };
}
```

- [ ] **Step 4: Run it**

Run: `npx vitest run apps/playground/test/flowStyle.test.ts`
Expected: pass.

- [ ] **Step 5: Write the widget**

`FlowDiagram.tsx`:

```tsx
import { DiagramView, diagramScene, type LayoutDirection } from '@weasel-js/diagram';
import { useMemo } from 'react';
import { linesOf, styleOf } from './style';
import type { Flow } from './types';

export interface FlowDiagramProps {
  flow: Flow;
  width: number;
  height: number;
  direction?: LayoutDirection;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
}

export function FlowDiagram({ flow, width, height, direction = 'down', selected, onSelect }: FlowDiagramProps) {
  const specs = useMemo(() => {
    const byId = new Map(flow.nodes.map((n) => [n.id, n]));
    return diagramScene(
      { nodes: flow.nodes.map((n) => ({ id: n.id, lines: linesOf(n) })), edges: flow.edges },
      {
        layoutOptions: { direction, order: 'barycenter', nodeGap: 24, rankGap: 48 },
        nodeStyle: (d) => styleOf(byId.get(d.id)!),
      },
    );
  }, [flow, direction]);
  return <DiagramView specs={specs} width={width} height={height} selected={selected} onSelect={onSelect} />;
}
```

`index.ts`:

```ts
export { FlowDiagram, type FlowDiagramProps } from './FlowDiagram';
export type { Flow, FlowEdge, FlowKind, FlowNode } from './types';
```

- [ ] **Step 6: Write the stories**

`FlowDiagram.stories.tsx`:

```tsx
import { flowOf, foldOf } from '@pg/blits/flow';
import { PRESETS } from '@pg/blits/presets';
import type { Meta, StoryObj } from '@weasel-js/forge';
import { useState } from 'react';
import { FlowDiagram } from './index';

const meta: Meta<typeof FlowDiagram> = { title: 'playground/FlowDiagram', component: FlowDiagram };
export default meta;

type Story = StoryObj<typeof FlowDiagram>;

function Picking({ name }: { name: string }) {
  const comp = PRESETS.find((p) => p.name === name)!.comp;
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <div>
      <div>picked: {picked ?? 'none'}</div>
      <FlowDiagram flow={flowOf(comp)} width={360} height={560} selected={picked} onSelect={setPicked} />
    </div>
  );
}

export const Crossfade: Story = { render: () => <Picking name="crossfade" /> };
export const PointerGlow: Story = { render: () => <Picking name="pointer glow" /> };
export const FoldRules: Story = { render: () => <Picking name="fold rules" /> };
export const StaggerWave: Story = { render: () => <Picking name="stagger wave" /> };

/** Every preset's voices at once, to judge crossings in a crowded column. */
export const Crowded: Story = {
  render: () => {
    const voices = PRESETS.flatMap((p) => p.comp.voices.map((v) => ({ ...v, id: `${p.name}/${v.id}` })));
    const levels = [...new Map(PRESETS.flatMap((p) => p.comp.levels).map((l) => [l.name, l])).values()];
    const comp = { ...PRESETS[0]!.comp, voices, levels };
    return <FlowDiagram flow={flowOf(comp)} width={360} height={800} />;
  },
};

export const FoldOfScale: Story = {
  render: () => (
    <FlowDiagram
      flow={foldOf(flowOf(PRESETS.find((p) => p.name === 'crossfade')!.comp), 'scale')}
      width={360}
      height={400}
      direction="up"
    />
  ),
};
```

- [ ] **Step 7: See it**

The forge (`npm run stories -w @blits/playground`, port 4882) may already be running; reuse it, and check `lsof -iTCP:4882 -sTCP:LISTEN` first. Open each story headless, screenshot it, and `transom post` each shot to zone `blits`. Check that boxes don't overlap, every edge arrives at its node, labels sit on their edges, voice boxes show their hue, and `Crowded` stays readable. A pick should update "picked". If `hsl(...)` colors paint black, weasel's paint layer doesn't parse CSS color functions: convert `hueColor` output to hex in `style.ts` (add a small `hslToHex`) and note it in a weasel issue.

- [ ] **Step 8: Typecheck and commit**

Run: `npm run typecheck -w @blits/playground && npx vitest run apps/playground/test/flowStyle.test.ts`

```bash
git add apps/playground/src/widgets/FlowDiagram apps/playground/test/flowStyle.test.ts
git commit -m "add the FlowDiagram widget, a composition's flow drawn with weasel-diagram

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The screen: flow on the right, Plots | Voice in the middle

**Files:**
- Create: `apps/playground/src/app/VoiceColumn.tsx`, `apps/playground/src/app/FlowPanel.tsx`, `apps/playground/src/app/FlowPanel.module.css`, `apps/playground/src/app/useSize.ts`
- Modify: `apps/playground/src/app/App.tsx`, `apps/playground/src/app/App.module.css`
- Modify: `apps/playground/README.md`

**Interfaces:**
- Consumes: `FlowDiagram` (Task 8), `flowOf`/`foldOf` (Tasks 5–6), the `Tabs`/`TabList`/`Tab`/`TabPanel` from `@weasel-js/ui` (react-aria: `selectedKey`, `onSelectionChange`).
- Produces: `FlowPanel({ comp, faulted, selected, onVoice })`, `VoiceColumn(props)`, and `useSize(): [ { width, height } | null, (el: HTMLElement | null) => void ]`.

- [ ] **Step 1: Write `useSize.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';

/** The content box of the element the returned ref lands on, kept current. */
export function useSize(): [{ width: number; height: number } | null, (el: HTMLElement | null) => void] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      setSize((s) => (s && s.width === width && s.height === height ? s : { width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [size, useCallback((e: HTMLElement | null) => setEl(e), [])];
}
```

- [ ] **Step 2: Write `FlowPanel.tsx` and its CSS**

```tsx
import type { Composition } from '@pg/blits/composition';
import { flowOf, foldOf } from '@pg/blits/flow';
import type { ChannelName } from '@pg/blits/kit';
import { FlowDiagram } from '@pg/widgets/FlowDiagram';
import { useMemo, useState } from 'react';
import s from './FlowPanel.module.css';
import { useSize } from './useSize';

export interface FlowPanelProps {
  comp: Composition;
  /** Ids of voices that failed to compile. */
  faulted: ReadonlySet<string>;
  /** The selected voice's id. */
  selected: string | null;
  onVoice: (id: string) => void;
}

export function FlowPanel({ comp, faulted, selected, onVoice }: FlowPanelProps) {
  const [fold, setFold] = useState<ChannelName | null>(null);
  const flow = useMemo(() => flowOf(comp, faulted), [comp, faulted]);
  const shown = useMemo(() => (fold ? foldOf(flow, fold) : flow), [flow, fold]);
  const [size, ref] = useSize();
  const pick = (id: string | null) => {
    if (id?.startsWith('voice:')) onVoice(id.slice('voice:'.length));
    else if (id?.startsWith('ch:') && !fold) setFold(id.slice('ch:'.length) as ChannelName);
  };
  return (
    <section className={s.panel} aria-label="flow">
      <nav className={s.crumbs}>
        {fold ? (
          <>
            <button type="button" onClick={() => setFold(null)}>
              Flow
            </button>
            <span aria-hidden>›</span>
            <span>{fold}</span>
          </>
        ) : (
          <span>Flow</span>
        )}
      </nav>
      <div ref={ref} className={s.canvas}>
        {fold && shown.nodes.length === 0 ? (
          <p className={s.empty}>nothing writes {fold}</p>
        ) : (
          size && (
            <FlowDiagram
              flow={shown}
              width={size.width}
              height={size.height}
              direction={fold ? 'up' : 'down'}
              selected={selected ? `voice:${selected}` : null}
              onSelect={pick}
            />
          )
        )}
      </div>
    </section>
  );
}
```

`FlowPanel.module.css`:

```css
.panel {
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: var(--wzl-space-xs);
}

.crumbs {
  display: flex;
  align-items: center;
  gap: var(--wzl-space-xs);
  font-family: var(--wzl-font-ui);
  font-size: var(--wzl-font-size-xs);
  color: var(--wzl-fg);
}

.canvas {
  min-height: 0;
  overflow: hidden;
}

.empty {
  font-family: var(--wzl-font-ui);
  font-size: var(--wzl-font-size-xs);
  color: var(--wzl-fg-muted, var(--wzl-fg));
}
```

Check `--wzl-fg-muted` exists in `@weasel-js/theme`'s CSS. If it doesn't, use the muted token the theme does define.

- [ ] **Step 3: Move the right column's contents into `VoiceColumn.tsx`**

Cut everything inside `<aside className={s.side} …>` (the add/share row, the shared-link row, `LevelsPanel`, `VoicePanel`, `LivePanel`, `PatchPanel`) out of `App.tsx` and paste it into a new component, unchanged:

```tsx
import type { Composition, Voice } from '@pg/blits/composition';
import { MAX_VOICES } from '@pg/blits/composition';
import type { Player } from '@pg/blits/player';
import type { RefObject } from 'react';
import s from './App.module.css';
import { LevelsPanel } from './CompositionControls';
import { LivePanel } from './LivePanel';
import { PatchPanel } from './PatchPanel';
import { VoicePanel } from './VoicePanel';

export interface VoiceColumnProps {
  comp: Composition;
  onComp: (c: Composition) => void;
  voice: Voice | undefined;
  player: Player;
  live: boolean;
  shared: { copied: boolean; url: string } | null;
  linkRef: RefObject<HTMLInputElement | null>;
  onAddVoice: () => void;
  onDeleteVoice: (id: string) => void;
  onVoice: (v: Voice) => void;
  onShare: () => void;
  onCloseShare: () => void;
  onActed: () => void;
}

export function VoiceColumn(p: VoiceColumnProps) {
  return (
    <div className={s.side}>
      {/* the JSX cut from App's <aside>, with: comp → p.comp, set → p.onComp, addVoice → p.onAddVoice,
          copyLink → p.onShare, () => setShared(null) → p.onCloseShare, deleteVoice → p.onDeleteVoice,
          setVoice → p.onVoice, tick → p.onActed, and voice/player/live/shared/linkRef from p */}
    </div>
  );
}
```

Replace the placeholder comment with the cut JSX, renaming the identifiers as listed. Nothing else in it changes. Remove imports from `App.tsx` that are no longer used there (`LevelsPanel`, `LivePanel`, `PatchPanel`, `VoicePanel`).

- [ ] **Step 4: Rewire `App.tsx`**

Add the imports:

```tsx
import { Tab, TabList, TabPanel, Tabs } from '@weasel-js/ui';
import { FlowPanel } from './FlowPanel';
import { VoiceColumn } from './VoiceColumn';
```

Add state and the faulted set next to `selected`:

```tsx
  const [tab, setTab] = useState<'plots' | 'voice'>('plots');
  const faultKey = player.built.errors.map((e) => e.voice ?? '').join('|');
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed by the ids, not the array
  const faulted = useMemo(() => new Set(faultKey.split('|').filter(Boolean)), [faultKey]);
  const pickVoice = (id: string | null) => {
    setSelected(id);
    if (id !== null) setTab('voice');
  };
```

Replace the inspector section and the aside with:

```tsx
        <section className={s.inspector} aria-label="inspector">
          <Tabs selectedKey={tab} onSelectionChange={(k) => setTab(k as 'plots' | 'voice')}>
            <TabList aria-label="middle column">
              <Tab id="plots">Plots</Tab>
              <Tab id="voice">Voice</Tab>
            </TabList>
            <TabPanel id="plots">
              <Inspector player={player} comp={comp} />
            </TabPanel>
            <TabPanel id="voice">
              <VoiceColumn
                comp={comp}
                onComp={set}
                voice={voice}
                player={player}
                live={live}
                shared={shared}
                linkRef={linkRef}
                onAddVoice={addVoice}
                onDeleteVoice={deleteVoice}
                onVoice={setVoice}
                onShare={copyLink}
                onCloseShare={() => setShared(null)}
                onActed={tick}
              />
            </TabPanel>
          </Tabs>
        </section>
        <aside className={s.side} aria-label="flow">
          <FlowPanel comp={comp} faulted={faulted} selected={selected} onVoice={pickVoice} />
        </aside>
```

Change `ScoreLanes`'s `onSelect={setSelected}` to `onSelect={pickVoice}`, and `addVoice`'s `setSelected(v.id)` to `pickVoice(v.id)`, so selecting a clip by any route shows its Voice tab. If the biome-ignore isn't needed because biome accepts `faultKey` as the dependency, drop it.

- [ ] **Step 5: Fix the column CSS**

In `App.module.css`, the `.side` rule now serves two places. Keep `.side` for the right column, and give it `grid-template-rows: minmax(0, 1fr);` instead of `align-content: start` so the flow fills the height. `VoiceColumn` uses its own class: add

```css
.voiceColumn {
  display: grid;
  align-content: start;
  gap: var(--wzl-space-md);
}
```

and use `s.voiceColumn` in `VoiceColumn.tsx` instead of `s.side`. If `App.module.css` passes 300 lines, move `.voiceColumn` to `VoiceColumn.module.css`.

- [ ] **Step 6: See it**

The playground dev server may already be up on 4881; reuse it. Headless, load each preset, screenshot, and `transom post` the shots to zone `blits`. Check:

- The flow fills the right column.
- Clicking a voice node selects that clip on the score and shows the Voice tab.
- Clicking a clip on the score shows the Voice tab.
- Clicking a channel node shows its fold under `Flow › <channel>`, and the breadcrumb leads back.
- Deleting the only voice that writes the open fold's channel shows "nothing writes <channel>".
- A voice with a broken weight expression is outlined red.
- The console has no errors.

- [ ] **Step 7: README**

In `apps/playground/README.md`:

- In "The screen", replace the sentence about the levels, voice and patch panels running down the right. The right column holds the flow. The middle column has two tabs: **Plots**, the inspector, and **Voice**, which holds the levels, voice and patch panels. Selecting a clip, on the score or in the flow, opens Voice.
- Add a "The flow" section after "The score":

```markdown
## The flow

The right column draws the composition's signal flow, top to bottom: levels, the signal ops and
expressions they feed, the voices those weigh, the channels each voice writes with the rule each
folds by (`KIT[ch].kind`), and the pose. `flowOf` in `src/blits/flow.ts` builds it from the
composition alone, finding the levels and signal calls in each `weight`, `stagger` and `target`
with acorn; `FlowDiagram` draws it with `@weasel-js/diagram`. A voice that failed to compile, or a
level an expression names that the composition lacks, is outlined red. Clicking a channel shows its
fold: everything that reaches it, and the rest it folds from, under a breadcrumb back.
```

- Add `FlowDiagram` to the list of widgets under `src/widgets/`.

- [ ] **Step 8: Check and commit**

Run: `npm run lint && npm run playground:check`
Expected: pass.

```bash
git add apps/playground
git commit -m "show the signal flow in the playground's right column, with voice and patch under a Voice tab

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Smoke the flow

**Files:**
- Modify: `apps/playground/scripts/smoke.mjs`

**Interfaces:**
- Consumes: the `aria-label="flow"` section from Task 9.

- [ ] **Step 1: Add the check**

After the stage `drawn` check in the per-preset loop, add:

```js
    const flowDrawn = await page
      .locator('section[aria-label=flow] canvas')
      .first()
      .evaluate((c) => {
        const g = c.getContext('2d');
        if (!g) return true; // a WebGL canvas: trust the console check
        const d = g.getImageData(0, 0, c.width, c.height).data;
        for (let k = 3; k < d.length; k += 4) if (d[k] > 0) return true;
        return false;
      })
      .catch(() => false);
    if (!flowDrawn) errors.push('flow drew nothing');
```

- [ ] **Step 2: Run it**

Run: `npm run playground:smoke`
Expected: `ok` for every preset.
If `getContext('2d')` returns null because weasel draws with WebGL, the check falls back to the console check. That's fine; say so in the commit body.

- [ ] **Step 3: Commit**

```bash
git add apps/playground/scripts/smoke.mjs
git commit -m "fail the playground smoke run when a preset's flow draws nothing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Release and unlink (deferred until Mike asks for it)

**Not part of this run.** Mike deferred this task indefinitely on 2026-10-07 and will ask for it. Until
then the playground runs on the local pack from Task 7, and `HANDOFF.md` says so.

Also do this when 1.9.0 is pinned: pass `anchor="start"` from `FlowDiagram` to `DiagramView`. It
landed in weasel `1b228637c`, but it needs the branch's `@weasel-js/core`, which the local pack does
not carry, so a crowded flow opens centered until then. Before release, weasel's `check:bumps` needs
Mike's bump-approved marker on `.changeset/diagram-from-data.md`.

**Files:**
- Modify: `apps/playground/package.json`, `site/package.json`, `package.json`, `package-lock.json`
- Delete: `apps/playground/scripts/link-diagram.sh`, `apps/playground/.weasel/`
- Delete: `docs/superpowers/specs/2026-10-07-flow-diagram-design.md`, `docs/superpowers/plans/2026-10-07-flow-diagram.md`
- Modify: `HANDOFF.md`

- [ ] **Step 1: Stop and ask**

Tell Mike that weasel's `diagram-from-data` branch is ready to merge and release as 1.9.0, with links to the commits and the demo screenshot. Ask whether to merge it into weasel `main` and publish. Do nothing in this task until he says yes. Until then, add a HANDOFF.md entry saying that the playground runs on a local pack of weasel-diagram, and that Task 11 is what's left.

- [ ] **Step 2: After his yes, merge and release in weasel**

Follow weasel's own release flow (its `RELEASING.md` or CLAUDE.md, whichever exists; read it first). Expected: `npm view @weasel-js/diagram version` prints `1.9.0`.

Then remove the worktree: `git -C ~/src/weasel worktree remove .worktrees/diagram-from-data && git -C ~/src/weasel branch -d diagram-from-data`.

- [ ] **Step 3: Pin 1.9.0 everywhere in blits**

```bash
cd ~/src/blits
sed -i '' 's/"\(@weasel-js\/[a-z0-9-]*\)": "1\.8\.1"/"\1": "1.9.0"/' site/package.json apps/playground/package.json
sed -i '' 's/"@weasel-js\/history": "^1\.8\.1"/"@weasel-js\/history": "^1.9.0"/' package.json
```

In `apps/playground/package.json`, set `"@weasel-js/diagram": "1.9.0"`, replacing the `file:` spec. Then `rm -rf apps/playground/.weasel apps/playground/scripts/link-diagram.sh`, remove `.weasel/` from `apps/playground/.gitignore`, and run `npm install`.
Expected: `grep -rn 'file:' package-lock.json | grep weasel` prints nothing.

- [ ] **Step 4: Verify**

Run: `npm run lint && npm run typecheck && npm run playground:check && npm run site:build`
Expected: all pass.

- [ ] **Step 5: Retire the spec and the plan**

The README's "The flow" section is now the durable record of view A. Copy the spec's roadmap (views B, C, D and the mixer desk) into `HANDOFF.md` as the next work, then delete the spec and this plan.

- [ ] **Step 6: Commit, then start the full suite on the fleet**

```bash
git add -A package.json package-lock.json site/package.json apps/playground HANDOFF.md docs/superpowers
git commit -m "pin weasel 1.9.0 and drop the local diagram pack, and retire the flow diagram's spec and plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Then run `onto test` in the background (the `onto-test` skill) and read its exit code when it finishes.
