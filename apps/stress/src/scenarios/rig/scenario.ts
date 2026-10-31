import { input, mix, patch, type Vec } from '@msb235/blits';
import { rng } from '@stress/rng';
import type { Finding, Make, Scenario } from '@stress/scenario';
import {
  ARM,
  axisAngle,
  BONES,
  type Bone,
  CLIPS,
  clip,
  isArm,
  type Pose,
  RIG,
  type Track,
  track,
  unitAxis,
} from './clips';
import { angle, type Member, meanBlend, posBlend, roleBlend, sample, samplePos } from './expect';
import { draw } from './view';

const FRAME_MS = 1000 / 60;
const PER_SIZE = 10;
const CROSSFADE_MS = 400;
const REACH = { rise: 300, hold: 800, fall: 300 };
const CHECKS = 30;
/** Radians a bone's rotation may stand off its role's blend. */
const TOL = 1e-6;
const POS_TOL = 1e-9;
const MAX_FAILS = 10;
const HOLD_GAP =
  "a voice's weight covers every component of a vec channel, so a hold cannot take some components of a vec(3) and leave the others to what it is blended with, as an IK arm holding a bone's height while clips keep its x and z; the rig cues each arm bone's clips twice, once for rot and once for pos, and applies the IK y-hold itself after reading";

export const rig: Make = ({ seed, size, lanes, frames = 3600 }) => {
  const chars = Math.max(1, Math.round(size * PER_SIZE));
  const n = chars * BONES;
  const rand = rng(seed);
  const pick = rng(seed ^ 0x5bd1e995);
  const during = new Set<number>();
  for (let k = 0; k < CHECKS; k++) during.add(pick.int(frames));
  const bones: Bone[] = Array.from({ length: n }, (_, i) => ({
    char: Math.floor(i / BONES),
    bone: i % BONES,
    i,
  }));
  const tracks: Track[][] = CLIPS.map((c) =>
    Array.from({ length: BONES }, () => track(rand, c.swing)),
  );
  const offsets = CLIPS.map((c) => Array.from({ length: chars }, () => rand.next() * c.ms));

  const W = new Float64Array(chars * CLIPS.length);
  const H = new Float64Array(chars);
  const gait = new Int32Array(chars);
  const nextGait = new Float64Array(chars);
  const reachAt = new Float64Array(chars);
  const ikRot: number[][] = [];
  const ikY = new Float64Array(chars * ARM.length);
  const reach = (c: number, at: number) => {
    reachAt[c] = at;
    for (let k = 0; k < ARM.length; k++) {
      ikRot[c * ARM.length + k] = axisAngle(unitAxis(rand), (rand.next() - 0.5) * 2);
      ikY[c * ARM.length + k] = 0.5 + rand.next();
    }
  };
  for (let c = 0; c < chars; c++) {
    gait[c] = rand.int(CLIPS.length);
    W[c * CLIPS.length + (gait[c] as number)] = 1;
    nextGait[c] = 500 + rand.next() * 2500;
    reach(c, rand.next() * 3000);
  }

  const m = mix<Bone, Pose>(RIG, { name: 'rig', lanes });
  const body = CLIPS.map((_, c) => input<Bone>((b) => W[b.char * CLIPS.length + c] as number));
  const armRot = CLIPS.map((_, c) =>
    input<Bone>((b) => (W[b.char * CLIPS.length + c] as number) * (1 - (H[b.char] as number))),
  );
  const ik = input<Bone>((b) => H[b.char] as number);
  CLIPS.forEach((c, k) => {
    for (let bone = 0; bone < BONES; bone++) {
      const t = tracks[k]?.[bone] as Track;
      const spec = {
        subjects: bones.filter((b) => b.bone === bone),
        loop: true,
        start: 0,
        seek: c.ms,
        stagger: (b: Bone) => offsets[k]?.[b.char] as number,
      };
      if (!isArm(bone)) {
        m.cue({ ...spec, patch: clip(t, c.ms, ['rot', 'pos']), role: 'pose', weight: body[k] });
        continue;
      }
      m.cue({ ...spec, patch: clip(t, c.ms, ['rot']), role: 'rot', weight: armRot[k] });
      m.cue({ ...spec, patch: clip(t, c.ms, ['pos']), role: 'pos', weight: body[k] });
    }
  });
  const hold = patch<Bone, Pose>(
    0,
    (_, b) => ({ rot: ikRot[b.char * ARM.length + b.bone - (ARM[0] as number)] as Vec<4> }),
    { writes: ['rot'] },
  );
  m.cue({ patch: hold, subjects: bones.filter((b) => isArm(b.bone)), role: 'rot', weight: ik });

  const found: Finding[] = [];
  let last = -1;
  let held = 0;
  let threeWay = 0;
  let checked = 0;
  let checkedDuring = 0;
  let fails = 0;
  let posFails = 0;
  let posWorst = 0;
  let meanWorst = 0;
  let rotWorst = 0;

  function drive(t: number): void {
    const fall = FRAME_MS / CROSSFADE_MS;
    for (let c = 0; c < chars; c++) {
      if (t >= (nextGait[c] as number)) {
        gait[c] = ((gait[c] as number) + 1 + rand.int(CLIPS.length - 1)) % CLIPS.length;
        const quick = rand.next() < 0.4;
        nextGait[c] = t + (quick ? 100 + rand.next() * 150 : 1200 + rand.next() * 2000);
      }
      let total = 0;
      for (let k = 0; k < CLIPS.length; k++) {
        const j = c * CLIPS.length + k;
        const goal = k === gait[c] ? 1 : 0;
        const w = W[j] as number;
        W[j] = w + Math.max(-fall, Math.min(fall, goal - w));
        total += W[j] as number;
      }
      for (let k = 0; k < CLIPS.length; k++)
        W[c * CLIPS.length + k] = (W[c * CLIPS.length + k] as number) / total;
      let s = t - (reachAt[c] as number);
      if (s >= REACH.rise + REACH.hold + REACH.fall) {
        reach(c, t + 1000 + rand.next() * 2000);
        s = t - (reachAt[c] as number);
      }
      H[c] =
        s < 0
          ? 0
          : s < REACH.rise
            ? s / REACH.rise
            : s < REACH.rise + REACH.hold
              ? 1
              : (REACH.rise + REACH.hold + REACH.fall - s) / REACH.fall;
      if ((H[c] as number) > 0) held++;
    }
    ik.touch();
  }

  function step(f: number): void {
    last = f;
    const t = f * FRAME_MS;
    drive(t);
    m.sync(t);
    if (during.has(f)) {
      checkedDuring++;
      checkpoint(f);
    }
  }

  const phaseOf = (b: Bone, k: number, t: number) => {
    const ms = (CLIPS[k] as (typeof CLIPS)[number]).ms;
    return ((((t + ms - (offsets[k]?.[b.char] as number)) / ms) % 1) + 1) % 1;
  };

  /** The members of a bone's `rot` role, in cue order, as the frame at `t` weighs them. */
  function members(b: Bone, t: number): Member[] {
    const h = isArm(b.bone) ? (H[b.char] as number) : 0;
    const out: Member[] = CLIPS.map((_, k) => ({
      q: sample(tracks[k]?.[b.bone] as Track, phaseOf(b, k, t)),
      w: (W[b.char * CLIPS.length + k] as number) * (1 - h),
    }));
    if (isArm(b.bone))
      out.push({ q: ikRot[b.char * ARM.length + b.bone - (ARM[0] as number)] as number[], w: h });
    return out;
  }

  /** A bone's `pos` as its role blends the clips, then held at the IK height as `pulled` does. */
  function wantPos(b: Bone, t: number): number[] {
    const p = posBlend(
      CLIPS.map((_, k) => ({
        p: samplePos(tracks[k]?.[b.bone] as Track, phaseOf(b, k, t)),
        w: W[b.char * CLIPS.length + k] as number,
      })),
    );
    const h = H[b.char] as number;
    if (isArm(b.bone) && h > 0) {
      const y = ikY[b.char * ARM.length + b.bone - (ARM[0] as number)] as number;
      p[1] = (p[1] as number) + (y - (p[1] as number)) * h;
    }
    return p;
  }

  function checkpoint(f: number): void {
    const t = f * FRAME_MS;
    checked++;
    pulled();
    for (const b of bones) {
      const want = wantPos(b, t);
      let off = 0;
      for (let j = 0; j < 3; j++)
        off = Math.max(off, Math.abs((pos[b.i * 3 + j] as number) - (want[j] as number)));
      posWorst = Math.max(posWorst, off);
      if (off <= POS_TOL) continue;
      if (++posFails > MAX_FAILS) continue;
      found.push({
        kind: 'fail',
        at: f,
        what: `character ${b.char} bone ${b.bone}: pos reads [${Array.from(pos.subarray(b.i * 3, b.i * 3 + 3)).join(', ')}]; its role's blend of the clips, with the IK height held, makes [${want.join(', ')}]`,
      });
    }
    for (const b of bones) {
      const ms = members(b, t);
      if (ms.filter((x, k) => k < CLIPS.length && x.w > 0).length === CLIPS.length) threeWay++;
      const want = roleBlend(ms);
      const got = m.probe(b).rot as number[];
      meanWorst = Math.max(meanWorst, angle(got, meanBlend(ms)));
      const off = angle(got, want);
      rotWorst = Math.max(rotWorst, off);
      if (off <= TOL) continue;
      if (++fails > MAX_FAILS) continue;
      found.push({
        kind: 'fail',
        at: f,
        what: `character ${b.char} bone ${b.bone}: rot reads [${got.join(', ')}], ${off} rad off; its role's members (${ms.map((x) => x.w.toFixed(4)).join(', ')}) blended as role.mdx says make [${want.join(', ')}]`,
      });
    }
  }

  const rot = new Float64Array(n * 4);
  const pos = new Float64Array(n * 3);
  /** Pulls every bone's pose, with the IK arm's height applied as the rig does after reading. */
  function pulled(): void {
    m.pull(bones, { rot, pos });
    for (let c = 0; c < chars; c++) {
      const h = H[c] as number;
      if (!(h > 0)) continue;
      for (let k = 0; k < ARM.length; k++) {
        const y = (c * BONES + (ARM[k] as number)) * 3 + 1;
        pos[y] =
          (pos[y] as number) + ((ikY[c * ARM.length + k] as number) - (pos[y] as number)) * h;
      }
    }
  }

  const scenario: Scenario = {
    name: 'rig',
    frameMs: FRAME_MS,
    width: n * 7,
    step,
    read: (out) => {
      pulled();
      out.set(rot, 0);
      out.set(pos, n * 4);
    },
    stats: () => ({
      voices: m.voices().length,
      gaps: held > 0 ? 1 : 0,
      held,
      threeWay,
      checked,
      checkedDuring,
      meanWorst,
      rotWorst,
      posWorst,
    }),
    check: () => {
      for (let k = 0; k < CHECKS; k++) {
        const gap = 1 + pick.int(12);
        for (let g = 0; g < gap; g++) step(last + 1);
        checkpoint(last);
      }
      if (fails > MAX_FAILS)
        found.push({
          kind: 'fail',
          what: `${fails - MAX_FAILS} more bones read a rot off their role's blend`,
        });
      if (posFails > MAX_FAILS)
        found.push({
          kind: 'fail',
          what: `${posFails - MAX_FAILS} more bones read a pos off their role's blend`,
        });
      if (held > 0) found.push({ kind: 'gap', what: HOLD_GAP });
      return found;
    },
    draw: (ctx, w, h) => {
      pulled();
      draw(ctx, w, h, chars, pos);
    },
    close: () => m.close(),
  };
  return scenario;
};
