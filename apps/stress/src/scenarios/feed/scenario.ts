import { type Handle, keys, kit, mix, mul, spring, sum } from '@msb235/blits';
import { type Rng, rng } from '@stress/rng';
import type { Finding, Make, Scenario } from '@stress/scenario';
import { poisson } from './poisson';
import { draw } from './view';

interface Pose {
  y: number;
  alpha: number;
}
interface Item {
  id: number;
  score: number;
  /** Index in `list`, or -1 while filtered out. */
  row: number;
  /** Index in `all`. */
  at: number;
  gone: boolean;
  entrance?: Handle<Item>;
}

const ITEM = kit<Pose>({ y: sum(), alpha: mul() });
const FRAME_MS = 1000 / 60;
const PER_SIZE = 100;
const TARGET = 400;
const ROWS = 500;
const ROW_PX = 20;
const EVENT_FRAMES = 180;
const FADE_MS = 200;
const GRACE_FRAMES = 60;
const KEEP_DROPPED = 64;
const SLACK = 10;

const entrance = keys<Item, Pose>(
  300,
  [
    { at: 0, delta: { y: -ROW_PX, alpha: 0 } },
    { at: 1, delta: { y: 0, alpha: 1 } },
  ],
  {},
);

export const feed: Make = ({ seed, size, lanes }) => {
  const rand: Rng = rng(seed);
  const perFrame = (size * PER_SIZE * FRAME_MS) / 1000;
  const m = mix<Item, Pose>(ITEM, { name: 'feed', lanes });
  m.sync(0);
  const move = spring<Item, Pose>('y', {
    from: (it) => it.row * ROW_PX,
    to: (it) => it.row * ROW_PX,
  });
  m.cue({ patch: move, target: (it) => !it.gone });

  const all: Item[] = [];
  let list: Item[] = [];
  const leaving: Item[] = [];
  const pulled: Item[] = [];
  const dropped: Item[] = [];
  const y = new Float64Array(ROWS);
  const alpha = new Float64Array(ROWS);
  const share = new Float64Array(ROWS);
  let nextId = 0;
  let events = 0;
  let frame = -1;
  let filled = false;
  let maxVoices = 0;
  let overBudget: Finding | undefined;
  let resolved = 0;
  let doubled = 0;
  let retargets = 0;

  const retarget = (it: Item, row: number) => {
    it.row = row;
    move.to(it, row * ROW_PX);
    retargets++;
  };

  function arrive(): void {
    const it: Item = {
      id: nextId++,
      score: rand.next(),
      row: list.length,
      at: all.length,
      gone: false,
    };
    all.push(it);
    list.push(it);
    it.entrance = m.cue({
      patch: entrance,
      subjects: [it],
      freeze: 'after',
      fade: { out: FADE_MS },
    });
  }

  function depart(): void {
    const i = rand.int(all.length);
    const it = all[i] as Item;
    const last = all.pop() as Item;
    if (last !== it) {
      all[i] = last;
      last.at = i;
    }
    if (it.row >= 0) {
      const tail = list.pop() as Item;
      if (tail !== it) {
        list[it.row] = tail;
        retarget(tail, it.row);
      }
      it.row = -1;
    }
    const h = it.entrance as Handle<Item>;
    let n = 0;
    void h.done.then(() => {
      resolved++;
      if (++n > 1) doubled++;
    });
    h.fade({ over: FADE_MS });
    it.gone = true;
    leaving.push(it);
  }

  function reshuffle(): void {
    events++;
    const filter = events % 2 === 0;
    for (const it of all) {
      it.score += rand.next() - 0.5;
      it.row = -1;
    }
    list = filter ? all.filter(() => rand.next() >= 1 / 3) : all.slice();
    list.sort((a, b) => b.score - a.score || a.id - b.id);
    for (let row = 0; row < list.length; row++) retarget(list[row] as Item, row);
  }

  function release(): void {
    for (let i = leaving.length - 1; i >= 0; i--) {
      const it = leaving[i] as Item;
      if ((it.entrance as Handle<Item>).state !== 'done') continue;
      m.drop(it);
      leaving[i] = leaving[leaving.length - 1] as Item;
      leaving.pop();
      dropped.push(it);
      if (dropped.length > KEEP_DROPPED) dropped.shift();
    }
  }

  function advance(f: number, churn: boolean): void {
    frame = f;
    if (churn) {
      const arrivals = poisson(rand, perFrame);
      for (let k = 0; k < arrivals && all.length < ROWS - leaving.length; k++) arrive();
      if (all.length >= TARGET) filled = true;
      if (filled) {
        const due = Math.max(0, perFrame + (all.length - TARGET) * 0.05);
        const out = Math.min(poisson(rand, due), all.length);
        for (let k = 0; k < out; k++) depart();
      }
      if (f > 0 && f % EVENT_FRAMES === 0) reshuffle();
    }
    release();
    m.sync(f * FRAME_MS);
    const voices = m.voices().length;
    if (voices > maxVoices) maxVoices = voices;
    const budget = (all.length + leaving.length) * 3 + SLACK;
    if (voices > budget && !overBudget) {
      overBudget = {
        kind: 'fail',
        at: f,
        what: `${voices} voices for ${all.length + leaving.length} items, over the budget of ${budget}`,
      };
    }
  }

  function check(): Finding[] {
    for (let g = 1; g <= GRACE_FRAMES; g++) advance(frame + 1, false);
    const found: Finding[] = overBudget ? [overBudget] : [];
    if (leaving.length > 0) {
      found.push({
        kind: 'fail',
        at: frame,
        what: `${leaving.length} departed items still not done ${GRACE_FRAMES} frames after the last departure`,
      });
    }
    if (doubled > 0) {
      found.push({ kind: 'fail', at: frame, what: `${doubled} done promises resolved twice` });
    }
    const rest = { y: 0, alpha: 0 };
    const ghost: Item = { id: -1, score: 0, row: 0, at: 0, gone: true };
    m.probe(ghost, rest);
    m.drop(ghost);
    const pose = { y: 0, alpha: 0 };
    for (const it of dropped) {
      m.probe(it, pose);
      m.drop(it);
      if (pose.alpha !== 0 && (pose.alpha !== rest.alpha || pose.y !== rest.y)) {
        found.push({
          kind: 'fail',
          at: frame,
          what: `dropped item ${it.id} probes y ${pose.y}, alpha ${pose.alpha}; a stranger probes y ${rest.y}, alpha ${rest.alpha}`,
        });
        break;
      }
    }
    return found;
  }

  const scenario: Scenario = {
    name: 'feed',
    frameMs: FRAME_MS,
    width: ROWS * 2,
    step: (f) => advance(f, true),
    read: (out) => {
      pulled.length = 0;
      for (const it of list) pulled.push(it);
      for (const it of leaving) pulled.push(it);
      if (pulled.length > ROWS) pulled.length = ROWS;
      m.pull(pulled, { y, alpha });
      y.fill(Number.NaN, pulled.length);
      alpha.fill(Number.NaN, pulled.length);
      out.set(y, 0);
      out.set(alpha, ROWS);
    },
    stats: () => ({
      voices: m.voices().length,
      items: list.length,
      pending: leaving.length,
      resolved,
      maxVoices,
      retargets,
    }),
    check,
    draw: (ctx, w, h) => {
      const rows = [...list, ...leaving].slice(0, ROWS);
      m.pull(rows, { y, alpha });
      for (let i = 0; i < rows.length; i++) share[i] = (((rows[i] as Item).id * 37) % 97) / 97;
      draw(ctx, w, h, rows.length, { y, alpha, share }, ROW_PX, list.length);
    },
    close: () => m.close(),
  };
  return scenario;
};
