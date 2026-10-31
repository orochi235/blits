import { rng } from '@stress/rng';

export const FRAME_MS = 1000 / 60;
export const GROUPS = 4;
/** How long BACK takes to cross back to the cue before. */
export const BACK_MS = 1500;
const LEVELS = [0, 0.15, 0.3, 0.5, 0.65, 0.8, 1];

export interface Cue {
  /** One level per fixture. */
  levels: Float64Array;
  hue: number;
  fadeMs: number;
  /** Ms after the cue before's fade ends that this one goes by itself; absent for a cue the operator takes. */
  follow?: number;
}

export type Op = { kind: 'go' } | { kind: 'back' } | { kind: 'fader'; group: number; to: number };

export interface Show {
  fixtures: number;
  cues: Cue[];
  /** What fader group `g` brings up, per fixture; 0 for a fixture not in the group. */
  presets: Float64Array[];
  /** Operator actions at frame `f`, made before that frame's sync. Drawn as play reaches them. */
  at(f: number): readonly Op[];
}

export const groupOf = (i: number) => i % GROUPS;

export const describe = (op: Op) =>
  op.kind === 'fader' ? `fader ${op.group} → ${op.to.toFixed(3)}` : op.kind.toUpperCase();

/** How far ahead of the frame asked for the operator's hands are drawn. */
const AHEAD = 600;

/**
 * The cue sheet and the operator's hands, drawn from the seed. Fades end a quarter ms off the
 * whole and follow delays 0.37 ms off it, so no follow lands exactly on a frame.
 */
export function show(seed: number, size: number): Show {
  const r = rng(seed ^ 0x1b873593);
  const fixtures = Math.max(GROUPS * 2, Math.round(48 * size));
  const count = Math.max(20, Math.round(500 * size));
  const cues: Cue[] = [];
  let prev = new Float64Array(fixtures);
  for (let k = 0; k < count; k++) {
    const levels = prev.slice();
    for (let i = 0; i < fixtures; i++) if (k === 0 || r.next() < 0.3) levels[i] = r.pick(LEVELS);
    const cue: Cue = { levels, hue: Math.round(r.next() * 360), fadeMs: 300 + r.int(5000) + 0.25 };
    if (k > 0 && r.next() < 1 / 6) cue.follow = r.int(2000) + 0.37;
    cues.push(cue);
    prev = levels;
  }
  const presets = Array.from({ length: GROUPS }, (_, g) => {
    const p = new Float64Array(fixtures);
    for (let i = 0; i < fixtures; i++) if (groupOf(i) === g) p[i] = 0.3 + r.next() * 0.7;
    return p;
  });

  const ops = new Map<number, Op[]>();
  const add = (f: number, op: Op) => {
    const at = ops.get(f);
    if (at) at.push(op);
    else ops.set(f, [op]);
  };

  // The buttons, timed by where the operator thinks the stack is.
  const hands = rng(seed ^ 0x2c1b3c6d);
  let next = 60;
  let pointer = -1;
  function press(): void {
    let ms: number;
    if (hands.next() < 0.1 && pointer > 0) {
      add(next, { kind: 'back' });
      pointer--;
      ms = BACK_MS + 500 + hands.int(3000);
    } else {
      add(next, { kind: 'go' });
      pointer = (pointer + 1) % count;
      let total = (cues[pointer] as Cue).fadeMs;
      while (cues[(pointer + 1) % count]?.follow !== undefined) {
        pointer = (pointer + 1) % count;
        const c = cues[pointer] as Cue;
        total += (c.follow as number) + c.fadeMs;
      }
      ms = hands.next() < 0.2 ? total * (0.1 + 0.8 * hands.next()) : total + 300 + hands.int(3000);
    }
    next += Math.max(1, Math.round(ms / FRAME_MS));
  }

  // The faders: each moved by hand now and then, a set every frame of the move.
  const sliders = Array.from({ length: GROUPS }, (_, g) => {
    const own = rng(seed * 31 + g);
    return { own, next: 120 + own.int(600), at: 0 };
  });
  function slide(g: number): void {
    const s = sliders[g] as (typeof sliders)[number];
    const to = s.own.next() < 0.3 ? 0 : s.own.next();
    const n = 10 + s.own.int(90);
    for (let j = 1; j <= n; j++)
      add(s.next + j, { kind: 'fader', group: g, to: s.at + ((to - s.at) * j) / n });
    s.at = to;
    s.next += n + 120 + s.own.int(360);
  }

  let drawn = -1;
  return {
    fixtures,
    cues,
    presets,
    at(f) {
      if (f + AHEAD > drawn) {
        drawn = f + AHEAD * 2;
        while (next <= drawn) press();
        for (let g = 0; g < GROUPS; g++) while ((sliders[g]?.next ?? drawn) <= drawn) slide(g);
      }
      return ops.get(f) ?? [];
    },
  };
}

/** The last few actions at or before frame `f`, newest last, faders folded to their latest set. */
export function recent(s: Show, f: number, n = 6): string[] {
  const out: string[] = [];
  const faders = new Set<number>();
  for (let g = f; g >= 0 && out.length < n; g--) {
    const ops = s.at(g);
    if (ops.length === 0) continue;
    for (const op of [...ops].reverse()) {
      if (op.kind === 'fader') {
        if (faders.has(op.group)) continue;
        faders.add(op.group);
      }
      out.unshift(`f${g} ${describe(op)}`);
    }
  }
  return out.slice(-n);
}
