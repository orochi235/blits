// Plays a seek-replay fuzz program's host calls on a mix, or two on a transport.
import { createHistory as tape } from '@weasel-js/history';
import { mix } from '../../src/mixer.js';
import { transport } from '../../src/transport.js';
import type { Handle, Mix, MixOptions, VoiceSpec } from '../../src/types.js';
import { memoryStore } from '../store.js';
import {
  type CueOp,
  K,
  type Mode,
  makePatch,
  type Op,
  type Part,
  type PK,
  type Pose,
  SUBJ,
} from './replay-program.js';

export interface Env {
  mode: Mode;
  t?: ReturnType<typeof transport>;
  ms: Mix<Part, Pose>[];
  hs: Map<number, Handle<Part>>;
  spans: Set<number>;
  errs: string[];
}
const ball = { x: 1, y: 0, r: 1.6 };
const xy = new Float64Array([0, 0, 1, 0, 2, 0, 3, 0]);

export function build(mode: Mode): Env {
  const history: MixOptions['history'] = mode.store
    ? { ms: 150, every: 50, tape, store: memoryStore() }
    : { ms: 1e9, every: 50, tape };
  const base: MixOptions = { lanes: mode.lanes, stepMs: 4, keyOf: (p: Part) => p.id } as MixOptions;
  if (mode.transport) {
    const t = transport({ history });
    const ms = [0, 1].map((i) => mix<Part, Pose>(K(), { ...base, transport: t, name: `m${i}` }));
    for (const m of ms) m.plot(SUBJ, xy);
    return { mode, t, ms, hs: new Map(), spans: new Set(), errs: [] };
  }
  const m = mix<Part, Pose>(K(), { ...base, history, name: 'm0' });
  m.plot(SUBJ, xy);
  return { mode, ms: [m], hs: new Map(), spans: new Set(), errs: [] };
}

function specOf(e: Env, c: CueOp, m: Mix<Part, Pose>): VoiceSpec<Part, Pose> {
  const s: VoiceSpec<Part, Pose> = { patch: makePatch(c.patch), name: `v${c.id}` };
  const ownerH = c.owner !== undefined ? e.hs.get(c.owner) : undefined;
  if (c.loop !== undefined) s.loop = c.loop;
  if (c.fade) s.fade = c.fade;
  if (c.freeze) s.freeze = c.freeze;
  if (typeof c.weight === 'number') s.weight = c.weight;
  else if (c.weight === 'around') s.weight = m.around(ball);
  else if (c.weight === 'within') {
    s.weight = (p: Part) => 0.5 + 0.1 * p.id;
    s.within = ball;
  }
  if (c.rate !== undefined) s.rate = c.rate;
  if (c.seek !== undefined) s.seek = c.seek;
  if (c.start !== undefined) s.start = m.timestamp + c.start;
  if (c.stagger) {
    const st = c.stagger;
    s.stagger = (p) => p.id * st;
    if (c.named) s.subjects = SUBJ;
  }
  if (c.subjects) s.subjects = c.subjects.map((i) => SUBJ[i] as Part);
  if (c.role) s.role = c.role;
  if (ownerH) s.owner = ownerH;
  if (e.mode.transport) s.score = 's';
  if (c.anchor) {
    const { how, of, by } = c.anchor;
    const name = typeof of === 'string' ? of : `v${of}`;
    s.anchor = {
      start:
        how === 'after'
          ? { after: name, by }
          : how === 'with' || how === 'ann'
            ? { with: name, by }
            : { of: name, mark: how === 'hit' ? 'hit' : how, by },
    };
  }
  if (c.owner !== undefined && e.spans.has(c.owner)) {
    delete s.start;
    delete s.anchor;
    if (s.loop === true) s.loop = false;
  }
  if (c.marks) s.marks = { hit: 70 };
  if (c.hits) s.hits = [{ at: 40, event: 'h' }];
  if (c.stepMs !== undefined) s.stepMs = c.stepMs;
  return s;
}

export function apply(e: Env, op: Op): void {
  const m = 'mix' in op ? (e.ms[op.mix] as Mix<Part, Pose>) : (e.ms[0] as Mix<Part, Pose>);
  try {
    switch (op.k) {
      case 'cue':
        e.hs.set(op.id, m.cue(specOf(e, op, m)));
        break;
      case 'call': {
        const c = op.cue;
        m.call(`c${c.id}`, () => {
          try {
            e.hs.set(c.id, m.cue(specOf(e, c, m)));
          } catch (err) {
            e.errs.push(`call-inner: ${String(err).slice(0, 110)}`);
          }
        });
        break;
      }
      case 'owns': {
        const spec: Parameters<Mix<Part, Pose>['owns']>[0] = {
          rate: op.rate,
          weight: op.weight,
          name: `v${op.id}`,
        };
        if (op.fade) spec.fade = op.fade;
        if (op.start !== undefined) spec.start = m.timestamp + op.start;
        const o = op.owner !== undefined ? e.hs.get(op.owner) : undefined;
        if (o) spec.owner = o;
        if (e.mode.transport) spec.score = 's';
        e.hs.set(op.id, op.span ? m.span({ ...spec, ...op.span }) : m.owns(spec));
        if (op.span) e.spans.add(op.id);
        break;
      }
      case 'blend': {
        const members = Array.from({ length: op.n }, (_, q) => ({
          patch: makePatch((['wave', 'ramp', 'turn', 'pick'] as const)[q % 4] as PK),
          name: `v${op.id + q}`,
        }));
        const spec: VoiceSpec<Part, Pose> = { loop: op.loop } as VoiceSpec<Part, Pose>;
        if (op.fade) spec.fade = op.fade;
        const o = op.owner !== undefined ? e.hs.get(op.owner) : undefined;
        if (o) spec.owner = o;
        const hs = m.blend(members, (p: Part) => (p.id % 3) * 0.6, spec as never);
        for (const [q, h] of hs.entries()) e.hs.set(op.id + q, h);
        break;
      }
      case 'arc': {
        const h = m.arc({
          enter: { patch: makePatch('ramp') },
          active: { patch: makePatch('wave'), loop: true },
          exit: { patch: makePatch('pick') },
          hold: op.hold,
          name: `v${op.id}`,
        });
        e.hs.set(op.id, h);
        break;
      }
      case 'announce':
        if (e.t) e.t.announce(op.name, { at: e.t.timestamp + op.at, score: 's' });
        else m.announce(op.name, { at: m.timestamp + op.at });
        break;
      case 'h': {
        const h = e.hs.get(op.tgt);
        if (!h) return;
        const sub = SUBJ[op.sub] as Part;
        const { a, b } = op;
        switch (op.what) {
          case 'weight':
            h.weight = Math.round(a * 4) / 4;
            break;
          case 'rate':
            h.rate = [0, 0.5, 1, 2, -1][Math.floor(a * 5)] as number;
            break;
          case 'ramp':
            h.ramp(
              [0, 0.5, 2, -1][Math.floor(a * 4)] as number,
              [0, 100][Math.floor(b * 2)] as number,
            );
            break;
          case 'seek':
            h.seek(Math.round(a * 600));
            break;
          case 'seekKeep':
            h.seek(Math.round(a * 600), { state: 'keep' });
            break;
          case 'fade':
            h.fade({ over: [0, 80, 200][Math.floor(a * 3)] as number });
            break;
          case 'fadeAt':
            h.fade({ over: 80, at: m.now + (a < 0.5 ? -30 : 40) });
            break;
          case 'fadeSub':
            h.fade({ subject: sub, over: [0, 100][Math.floor(a * 2)] as number });
            break;
          case 'fadeRest':
            h.fade({ at: 'rest', deadline: 300 });
            break;
          case 'rise':
            h.rise({ over: [0, 60][Math.floor(a * 2)] as number });
            break;
          case 'release':
            (h as unknown as { release?: () => void }).release?.();
            break;
          case 'to':
            h.to(sub, MOTIONV(op.tgt, e, a * 4));
            break;
          case 'push':
            h.push(sub, MOTIONV(op.tgt, e, a * 4 - 2));
            break;
          case 'set':
            h.set(sub, MOTIONV(op.tgt, e, a * 2));
            break;
        }
        break;
      }
      case 'mute':
        m.mute({ over: op.over });
        break;
      case 'drop':
        m.drop(SUBJ[op.sub] as Part);
        break;
      case 'mrate':
        if (e.t) {
          if (op.over) e.t.ramp(op.v, op.over);
          else e.t.rate = op.v;
        } else if (op.over) m.ramp(op.v, op.over);
        else m.rate = op.v;
        break;
      case 'tdrop':
        e.t?.drop(m);
        break;
      case 'rebase':
        break;
    }
  } catch (err) {
    e.errs.push(`${op.k}${'what' in op ? `.${op.what}` : ''}: ${String(err).slice(0, 110)}`);
  }
}
// The vspring writes a 2-vector; every other motion a number.
export const vecVoices = new WeakMap<Env, Set<number>>();
function MOTIONV(id: number, e: Env, v: number): number | number[] {
  return vecVoices.get(e)?.has(id) ? [v, v / 2] : v;
}
