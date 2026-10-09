import { type Handle, type Mix, type MixOptions, mix, type Patch } from '@msb235/blits';
import { createHistory as tape } from '@weasel-js/history';
import type { Composition, MixSettings } from './composition';
import { cueAll, type Voices } from './cueGroups';
import { type Faults, scopeOf } from './expr';
import { FRAME } from './frame';
import { kitOf, type Mixed } from './kit';
import type { FieldError } from './spec';
import type { Subject } from './stage';

export interface Built {
  mix: Mix<Subject, Mixed>;
  solos: Map<string, Mix<Subject, Mixed>>;
  /** Every voice and group cued in each solo mix, by solo then id, so a live change can reach them. */
  soloVoices: Map<string, Voices>;
  handles: Map<string, Handle<Subject>>;
  patches: Map<string, Patch<Subject, Mixed, unknown>>;
  /** Each group's handle in the full mix; a span's is a `SpanHandle`. */
  groupHandles: Map<string, Handle<Subject>>;
  levels: Map<string, { set(v: number): void }>;
  /** By voice or group id. */
  faults: Map<string, Faults>;
  errors: FieldError[];
}

/** History kept past the composition's length, ms, so a seek to its end never falls short. */
const HISTORY_SLACK = 1000;

/** The options every mix of a composition is made with. */
export function mixOptionsOf(s: MixSettings = {}): MixOptions {
  return {
    ...(s.stepMs !== 'off' ? { stepMs: s.stepMs ?? FRAME } : {}),
    ...(s.maxDt !== undefined ? { maxDt: s.maxDt } : {}),
    ...(s.reduce !== undefined ? { reduce: s.reduce } : {}),
    ...(s.lanes !== undefined ? { lanes: s.lanes } : {}),
  };
}

export function compile(
  c: Composition,
  subjects: readonly Subject[],
  opts: { solos?: boolean } = {},
): Built {
  const scope = scopeOf(c.levels);
  const kit = kitOf(c.rules);
  const errors: FieldError[] = [];
  const faults = new Map<string, Faults>();

  // Specs are built afresh per mix: a motion patch keeps its state on itself and plays on one voice.
  const make = (only: string | null) => {
    // History lets the player seek back with blits' own `seek` rather than replaying from 0.
    const m = mix<Subject, Mixed>(kit, {
      ...mixOptionsOf(c.mix),
      history: { ms: c.length + HISTORY_SLACK, inputs: true, tape },
    });
    return { m, ...cueAll(c, m, { scope, kit, only, errors, faults }) };
  };
  const full = make(null);
  const solos = new Map<string, Mix<Subject, Mixed>>();
  const soloVoices = new Map<string, Voices>();
  if (opts.solos)
    for (const id of full.handles.keys()) {
      const made = make(id);
      solos.set(id, made.m);
      soloVoices.set(id, made);
    }
  void subjects;
  return {
    mix: full.m,
    solos,
    soloVoices,
    handles: full.handles,
    patches: full.patches,
    groupHandles: full.groupHandles,
    levels: scope.levels,
    faults,
    errors,
  };
}
