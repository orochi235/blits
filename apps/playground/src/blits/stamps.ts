import type { Flow, FlowNode } from '@pg/widgets/FlowDiagram/types';
import type { Composition } from './composition';
import { compileExpr, scopeOf } from './expr';
import { itemOf } from './flow';
import { type Subject, subjectsOf } from './stage';

/** How finely a stamp follows its weight: a stamp is redrawn only when this much has changed. */
const STAMP_STEP = 0.1;

/** `flow` with each stamped channel drawn at the weight of the strongest voice writing it now, by
 *  `weights` (a voice's `weightOf` by its id), to a tenth; the same flow when nothing moved. */
export function stampWeights(flow: Flow, weights: ReadonlyMap<string, number>): Flow {
  const strongest = new Map<string, number>();
  for (const e of flow.edges) {
    if (!e.to.startsWith('ch:')) continue;
    const item = itemOf(flow, e.from);
    if (!item.startsWith('voice:')) continue;
    const w = weights.get(item.slice('voice:'.length)) ?? 0;
    strongest.set(e.to, Math.max(strongest.get(e.to) ?? 0, w));
  }
  let moved = false;
  const nodes = flow.nodes.map((n) => {
    if (n.stamp === undefined) return n;
    const w =
      Math.round(Math.min(Math.max(strongest.get(n.id) ?? 0, 0), 1) / STAMP_STEP) * STAMP_STEP;
    const stampWeight = Number(w.toFixed(1));
    if (n.stampWeight === stampWeight) return n;
    moved = true;
    return { ...n, stampWeight };
  });
  return moved ? { ...flow, nodes } : flow;
}

/** The stage laid out as a grid, and a number for each of its subjects in the stage's order. */
export interface Grid {
  cols: number;
  rows: number;
  values: readonly number[];
}

/** What `stagger` gives each subject of `comp`'s stage, ms, as the mix runs it: a subject it throws
 *  on gets 0, and a result that is not a number NaN. Null when the expression does not compile. */
export function delaysOf(comp: Composition, code: string): Grid | null {
  const compiled = compileExpr<(s: Subject) => number>({ code }, scopeOf(comp.levels), 0);
  if ('error' in compiled) return null;
  const subjects = subjectsOf(comp.stage);
  const values = subjects.map((s) => {
    const d = Number(compiled.fn(s));
    return Number.isFinite(d) ? d : Number.NaN;
  });
  const cols = comp.stage.kind === 'dots' ? comp.stage.cols : subjects.length;
  const rows = comp.stage.kind === 'dots' ? comp.stage.rows : 1;
  return { cols, rows, values };
}

const ms = (n: number) => `${Math.round(n)} ms`;

/** `flow` with each voice's stagger step drawn as its stage, every subject shaded by its delay,
 *  and the delays' spread as a parameter beside it. */
export function stampDelays(flow: Flow, comp: Composition): Flow {
  const voices = new Map(comp.voices.map((v) => [`step:voice:${v.id}:stagger`, v]));
  let moved = false;
  const nodes = flow.nodes.map((n): FlowNode => {
    const code = voices.get(n.id)?.stagger?.code;
    if (code === undefined) return n;
    const grid = delaysOf(comp, code);
    if (grid === null) return n;
    const known = grid.values.filter(Number.isFinite);
    const spread: [string, string][] = known.length
      ? [['spread', `${ms(Math.min(...known))}–${ms(Math.max(...known))}`]]
      : [];
    moved = true;
    return { ...n, grid, params: [...(n.params ?? []), ...spread] };
  });
  return moved ? { ...flow, nodes } : flow;
}
