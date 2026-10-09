import { clone } from './clone.js';
import { fitsKit } from './cue.js';
import { same } from './history.js';
import type { Kit, Patch, Setting } from './types.js';

/**
 * A `Setting` for calling a patch's `at` or `step` outside a mix: `keep` holds per owner as a mix's
 * does, and `send` keeps what is sent in `sent`. Any field may be given; the rest read a voice at
 * full weight at the start of its first pass, 1/60 s after the last frame.
 *
 * @category patch
 */
export function setting<S = void, H = unknown>(
  fields: Partial<Omit<Setting<S, H>, 'keep' | 'send'>> = {},
): Setting<S, H> & { sent: unknown[] } {
  const kept = new Map<object, unknown>();
  const sent: unknown[] = [];
  return {
    timestamp: 0,
    dt: 1000 / 60,
    elapsed: 0,
    pass: 0,
    weight: 1,
    state: undefined as S,
    host: undefined as H,
    ...fields,
    keep<K>(owner: object, init: () => K): K {
      if (!kept.has(owner)) kept.set(owner, init());
      return kept.get(owner) as K;
    },
    send(event: unknown) {
      sent.push(event);
    },
    sent,
  };
}

/** @category patch */
export interface CheckOptions<I, O, H = unknown> {
  /** The subject to read the patch for. */
  subject: I;
  /** A kit the patch should play in: each channel it writes, of the kind it was written for. */
  kit?: Kit<O>;
  /** What the patch's `reads` find on `setting.host`. */
  host?: H;
  /** The interval `step` is given, as under `stepMs`. Default 1000 / 60. */
  stepMs?: number;
  /** How many steps to run before reading state. Default 30. */
  steps?: number;
}

/**
 * What a patch does that a mix cannot rely on, one sentence per problem; empty when none. It reads
 * `at` across its phase, twice from fresh state, and checks that it writes only its `writes`, gives
 * the same delta each time, and leaves the subject alone; that `state` makes a new value per call,
 * that `step` lands the same from the same start, and that `clone` and `pack`/`unpack` give back an
 * equal state; that every field it `reads` is on `host`; and, given a kit, that `cue` would
 * take it. Meant for a library's own tests: `expect(checkPatch(glow, { subject })).toEqual([])`.
 *
 * @category patch
 */
export function checkPatch<I, O, S = void, H = unknown>(
  patch: Patch<I, O, S, H>,
  opts: CheckOptions<I, O, H>,
): string[] {
  const problems: string[] = [];
  const { subject, host } = opts;
  const tick = opts.stepMs ?? 1000 / 60;
  const steps = opts.steps ?? 30;
  const writes = new Set<PropertyKey>(patch.writes as readonly PropertyKey[]);

  if (opts.kit !== undefined)
    try {
      fitsKit(patch, opts.kit);
    } catch (e) {
      problems.push((e as Error).message);
    }
  for (const field of patch.reads ?? [])
    if (typeof host !== 'object' || host === null || !(field in host))
      problems.push(`reads host.${field}, which the host given lacks`);

  const fresh = (): S => (patch.state ? patch.state(subject) : (undefined as S));
  if (patch.state) {
    const a = fresh();
    if (typeof a === 'object' && a !== null && a === fresh())
      problems.push('state() hands every subject the same object, so they share state');
  }

  /** The state after `steps` steps from fresh. */
  const stepped = (): S => {
    const state = fresh();
    if (patch.step)
      for (let n = 1; n <= steps; n++)
        patch.step(
          state,
          tick,
          subject,
          setting<S, H>({ state, host, dt: tick, timestamp: n * tick }),
        );
    return state;
  };

  const before = clone(subject);
  const phases = [0, 0.25, 0.5, 0.75, 1];
  const read = (state: S) =>
    phases.map((phase) =>
      clone(
        patch.at(phase, subject, setting<S, H>({ state, host, elapsed: phase * patch.duration })),
      ),
    );
  let first: Partial<O>[] = [];
  try {
    first = read(stepped());
    const second = read(stepped());
    const stray = new Set<string>();
    for (const delta of first)
      for (const key of Object.keys(delta)) if (!writes.has(key)) stray.add(key);
    for (const key of stray) problems.push(`at() writes ${key}, which is not in writes`);
    if (!same(first, second))
      problems.push('at() gives a different delta for the same phase, subject and state');
  } catch (e) {
    problems.push(`at() or step() threw: ${(e as Error).message}`);
  }
  if (!same(subject, before)) problems.push('at() or step() changed the subject');

  if (patch.step || patch.state) {
    const state = stepped();
    if (!same(state, stepped()))
      problems.push('step() lands somewhere else from the same start and steps');
    if (patch.clone) {
      const c = patch.clone(state);
      if (!same(c, state)) problems.push('clone() gives a state unequal to the one it was given');
      else if (typeof state === 'object' && state !== null && c === state)
        problems.push('clone() hands back the state itself, not a copy');
    }
    if ((patch.pack === undefined) !== (patch.unpack === undefined))
      problems.push('pack and unpack come as a pair');
    else if (patch.pack && patch.unpack) {
      const back = patch.unpack(JSON.parse(JSON.stringify(patch.pack(state))));
      if (!same(back, state)) problems.push('unpack(pack(state)) through JSON gives another state');
    }
  }
  return problems;
}
