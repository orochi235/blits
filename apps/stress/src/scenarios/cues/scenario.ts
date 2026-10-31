import {
  type Handle,
  keys,
  kit,
  type Level,
  level,
  max,
  mix,
  patch,
  sum,
  type VoiceSpec,
} from '@msb235/blits';
import type { Finding, Make, Scenario } from '@stress/scenario';
import { handover } from './handover';
import { model } from './model';
import { BACK_MS, type Cue, FRAME_MS, GROUPS, groupOf, recent, show } from './script';
import { draw } from './view';

interface Fixture {
  i: number;
}
interface Pose {
  level: number;
  hue: number;
}

const STAGE = kit<Pose>({ level: max(), hue: sum() });
const TOLERANCE = 1e-6;

/** One cue on stage: a voice per distinct level, all under one name. */
interface Playing {
  index: number;
  handles: Handle<Fixture>[];
}

export const cues: Make = ({ seed, size, lanes }) => {
  const sheet = show(seed, size);
  const n = sheet.fixtures;
  const count = sheet.cues.length;
  const fixtures: Fixture[] = Array.from({ length: n }, (_, i) => ({ i }));
  const m = mix<Fixture, Pose>(STAGE, { name: 'cues', lanes });
  const columns = { level: new Float64Array(n), hue: new Float64Array(n) };
  const recorded = new Map<number, Float64Array>();
  const faders: Level<Fixture>[] = [];
  for (let g = 0; g < GROUPS; g++) {
    const fader = level<Fixture>(0);
    faders.push(fader);
    const preset = sheet.presets[g] as Float64Array;
    m.cue({
      patch: patch<Fixture, Pose>(1000, (_p, x) => ({ level: preset[x.i] as number }), {
        writes: ['level'],
      }),
      subjects: fixtures.filter((x) => groupOf(x.i) === g),
      loop: true,
      weight: fader,
      name: `fader${g}`,
    });
  }
  let running: Handle<Fixture>[] = [];
  let chain: Playing[] = [];
  let current = -1;
  let gos = 0;
  let backs = 0;
  /** GOs pressed while a fade still ran, and follows that went by themselves. */
  let mid = 0;
  let follows = 0;
  let played = 0;

  /** Cues `cue` as one voice per distinct level among its fixtures. */
  function place(
    cue: Cue,
    name: string,
    how: (level: number, hue: number) => VoiceSpec<Fixture, Pose>,
  ) {
    const by = new Map<number, Fixture[]>();
    for (const x of fixtures) {
      const l = cue.levels[x.i] as number;
      const at = by.get(l);
      if (at) at.push(x);
      else by.set(l, [x]);
    }
    const handles: Handle<Fixture>[] = [];
    for (const [l, subjects] of by) {
      const h = m.cue({ ...how(l, cue.hue), subjects, loop: false, freeze: 'after', name });
      handles.push(h);
      running.push(h);
    }
    return handles;
  }

  /** The cue the stack last started: the latest in the chain that is no longer waiting. */
  function live(): number {
    for (let j = chain.length - 1; j > 0; j--) {
      const p = chain[j] as Playing;
      if (p.handles[0]?.state !== 'pending') return p.index;
    }
    return chain[0]?.index ?? current;
  }

  function go(): void {
    gos++;
    current = live();
    if (running.some((h) => h.state === 'live' || h.state === 'fading')) mid++;
    for (const p of chain.slice(1)) if (p.handles[0]?.state !== 'pending') follows++;
    for (const h of running) {
      if (h.state === 'fading') h.weight = 0;
      else if (h.state !== 'done') h.fade({ over: 0 });
    }
    running = [];
    const k = (current + 1) % count;
    const names: string[] = [];
    const ks: number[] = [];
    for (let j = k; ; j = (j + 1) % count) {
      names.push(`go${gos}q${j}`);
      ks.push(j);
      const next = (j + 1) % count;
      if (next === k || (sheet.cues[next] as Cue).follow === undefined) break;
    }
    chain = ks.map((j, a) => {
      const cue = sheet.cues[j] as Cue;
      const handles = place(cue, names[a] as string, (l, hue) => ({
        patch: keys<Fixture, Pose>(cue.fadeMs, [{ at: 1, delta: { level: l, hue } }], {
          ease: 'linear',
        }),
        from: 'current',
        anchor: {
          ...(a > 0
            ? { start: { of: names[a - 1] as string, mark: 'coast', by: cue.follow as number } }
            : {}),
          // By tag: the same out by name is refused (see `handover`).
          ...(a < ks.length - 1
            ? { out: { of: { tag: names[a + 1] as string }, mark: 'start' } }
            : {}),
        },
        tags: [names[a] as string],
      }));
      return { index: j, handles };
    });
    current = k;
  }

  function back(): void {
    current = live();
    if (current <= 0) return;
    backs++;
    for (const h of running) {
      if (h.state === 'pending') h.fade({ over: 0 });
      else if (h.state === 'live' || h.state === 'frozen') h.fade({ over: BACK_MS });
    }
    running = running.filter((h) => h.state !== 'done');
    current--;
    const cue = sheet.cues[current] as Cue;
    const name = `back${backs}q${current}`;
    const handles = place(cue, name, (l, hue) => ({
      patch: keys<Fixture, Pose>(BACK_MS, [
        { at: 0, delta: { level: l, hue } },
        { at: 1, delta: { level: l, hue } },
      ]),
      fade: { in: BACK_MS },
    }));
    chain = [{ index: current, handles }];
  }

  /** The desk sends every frame, as DMX goes out, so what a fade reads it left from is the same however the page draws. */
  function step(f: number): void {
    for (const op of sheet.at(f)) {
      if (op.kind === 'fader') faders[op.group]?.set(op.to);
      else if (op.kind === 'back') back();
      else go();
    }
    m.sync(f * FRAME_MS);
    m.pull(fixtures, columns);
    played = f + 1;
    const v = new Float64Array(n * 2);
    readInto(v);
    recorded.set(f, v);
    if (f % 600 === 0) running = running.filter((h) => h.state !== 'done');
  }

  function readInto(out: Float64Array): void {
    out.set(columns.level, 0);
    out.set(columns.hue, n);
  }

  const at = (k: number) => `fixture ${k % n} ${k < n ? 'level' : 'hue'}`;

  /**
   * Replays the sheet through the model under both readings of `from: 'current'`. Blits is held to
   * the one it implements, `carry`; where it departs from the docs' reading, that is said once.
   */
  function check(): Finding[] {
    const docs = model(sheet, 'docs');
    const carry = model(sheet, 'carry');
    const found: Finding[] = handover();
    const failed = new Set<number>();
    let departed = false;
    const near = (v: number, want: number) =>
      Math.abs(v - want) <= TOLERANCE * Math.max(1, Math.abs(want));
    const value = (r: ReturnType<typeof model>, k: number) =>
      (k < n ? r.level[k] : r.hue[k - n]) as number;
    for (let f = 0; f < played; f++) {
      docs.step(f);
      carry.step(f);
      const got = recorded.get(f);
      if (!got) continue;
      for (let k = 0; k < n * 2; k++) {
        const v = got[k] as number;
        const want = value(carry, k);
        if (!departed && near(v, want) && !near(v, value(docs, k))) {
          departed = true;
          found.push({
            kind: 'fail',
            key: 'cues/from-current-speed',
            at: f,
            what:
              `a from: 'current' fade leaves at the speed the fixture had (CHANGELOG 0.2.0), where blending.mdx says it carries position, not speed; ` +
              `a still fixture's fade then eases in though the cue's keys say linear, which a desk would not do, and the first fade a mix plays runs straight since no poses are kept yet. ` +
              `Frame ${f}, ${at(k)}: blits ${v}, straight ${value(docs, k)}; recent: ${recent(sheet, f).join('; ')}`,
          });
        }
        if (failed.has(k) || near(v, want)) continue;
        failed.add(k);
        found.push({
          kind: 'fail',
          at: f,
          what: `frame ${f}, ${at(k)}: blits ${v}, model ${want}; recent: ${recent(sheet, f).join('; ')}`,
        });
      }
    }
    return found;
  }

  const scenario: Scenario = {
    name: 'cues',
    frameMs: FRAME_MS,
    width: n * 2,
    step,
    read: readInto,
    stats: () => ({ voices: m.voices().length, cue: live(), gos, backs, mid, follows }),
    check,
    draw: (ctx, w, h) => draw(ctx, w, h, columns.level, columns.hue),
    close: () => m.close(),
  };
  return scenario;
};
