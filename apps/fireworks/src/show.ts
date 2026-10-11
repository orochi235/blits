import { type Handle, type Hit, kit, type Mix, patch, sum } from '@msb235/blits';
import { channels, type Emission } from '@msb235/blits-quarks';

/** What a shell's pose holds: what its sparks do, and what its whistle sounds like. */
export interface Pose extends Emission {
  freq: number;
  gain: number;
}

export const KIT = kit<Pose>({ ...channels, freq: sum(), gain: sum() });

/** One firework, and the subject its voices play on. Positions are in the sky's units. */
export interface Shell {
  x: number;
  apex: number;
  color: readonly [number, number, number];
  stars: number;
}

/** What a hit hands the sound: where across the sky, and for a bang how big. */
export type Sound = { kind: 'bang'; pan: number; size: number } | { kind: 'crackle'; pan: number };

/** The tag a burst is sent under, which the quarks driver drains. */
export const BURSTS = 'bursts';

const RISE_MS = 1100;
const BLOOM_MS = 900;
const HALF_WIDTH = 8;

const rise = patch<Shell, Pose>(
  RISE_MS,
  (phase, shell) => ({
    offset: [0, shell.apex * (1 - (1 - phase) ** 2), 0],
    rate: 140 * (1 - phase),
    speed: 0.05,
    size: 0.55,
    life: 0.3,
    tint: [1, 0.75, 0.4, 1],
    freq: 700 + 1100 * phase,
    gain: 0.07 * Math.sin(Math.PI * phase),
  }),
  { writes: ['offset', 'rate', 'speed', 'size', 'life', 'tint', 'freq', 'gain'] },
);

const bloom = patch<Shell, Pose, { sent: boolean }>(
  BLOOM_MS,
  (_phase, shell) => ({ offset: [0, shell.apex, 0], tint: [...shell.color, 1] }),
  {
    writes: ['offset', 'tint'],
    state: () => ({ sent: false }),
    step: (state, _dt, shell, setting) => {
      if (state.sent) return;
      state.sent = true;
      setting.send({ count: shell.stars });
    },
  },
);

function hits(shell: Shell): Hit<Sound>[] {
  const pan = shell.x / HALF_WIDTH;
  const crackles = Array.from({ length: 6 }, (_, k) => ({
    at: 220 + k * 105 + Math.random() * 60,
    event: { kind: 'crackle', pan } as const,
  }));
  return [{ at: 0, event: { kind: 'bang', pan, size: shell.stars / 160 } }, ...crackles];
}

/** Cues a shell: it rises, then blooms. The handle is the bloom's, done when the shell is over. */
export function cue(m: Mix<Shell, Pose>, shell: Shell): Handle<Shell> {
  const owner = m.owns({});
  m.cue({ owner, patch: rise, subjects: [shell] });
  return m.cue({
    owner,
    start: RISE_MS,
    patch: bloom,
    subjects: [shell],
    tags: [BURSTS],
    hits: hits(shell),
  });
}

const COLORS: readonly (readonly [number, number, number])[] = [
  [1, 0.35, 0.3],
  [1, 0.8, 0.3],
  [0.4, 1, 0.55],
  [0.4, 0.75, 1],
  [0.85, 0.5, 1],
  [1, 1, 1],
];

/** A shell at `x` bursting at `apex`, or somewhere in the sky where neither is given. */
export function shell(x?: number, apex?: number): Shell {
  return {
    x: x ?? (Math.random() * 2 - 1) * (HALF_WIDTH - 1.5),
    apex: apex ?? 4.5 + Math.random() * 3,
    color: COLORS[Math.floor(Math.random() * COLORS.length)] ?? [1, 1, 1],
    stars: 90 + Math.floor(Math.random() * 110),
  };
}
