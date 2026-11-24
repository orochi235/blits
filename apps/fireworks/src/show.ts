import { type Handle, type Hit, kit, type Mix, mix, patch, sum } from '@msb235/blits';
import { channels, type Emission } from '@msb235/blits-quarks';
import { createHistory } from '@weasel-js/history';

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

/** What a hit sounds. */
export type Sound = 'bang' | 'crackle';

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

function hits(): Hit<Sound>[] {
  const crackles = Array.from({ length: 6 }, (_, k) => ({
    at: 220 + k * 105 + Math.random() * 60,
    event: 'crackle' as const,
  }));
  return [{ at: 0, event: 'bang' }, ...crackles];
}

/** Where across the stereo field a shell sounds, -1 left to 1 right. */
export const panOf = (shell: Shell): number => shell.x / HALF_WIDTH;

/** How big a shell's bang is, about 0.5 to 1.25. */
export const sizeOf = (shell: Shell): number => shell.stars / 160;

/** How far back the show's history reaches, so the panel or the DevTools extension can seek it. */
export const HISTORY_MS = 30_000;

/** The subject the show's own launches are paced on. It is never launched, and draws nothing. */
export const PACER: Shell = { x: 0, apex: 0, color: [0, 0, 0], stars: 0 };

/** The tag of the voice that keeps launching, whose events are the launches. */
export const AUTO = 'auto';

/** Mean ms between the shells the show launches on its own. */
const PACE_MS = 800;

/** Where in pass `pass` the pacer launches, 0 to 1: fixed per pass, so a replay of it agrees. */
const beat = (pass: number): number => {
  const x = Math.sin(pass * 12.9898 + 4.1414) * 43758.5453;
  return 0.15 + 0.7 * (x - Math.floor(x));
};

/** Sends its pass number once a pass, at that pass's beat: one launch each. */
const pace = patch<Shell, Pose, { sent: number }>(PACE_MS, () => ({}), {
  writes: [],
  state: () => ({ sent: Number.NaN }),
  step: (state, _dt, _shell, setting) => {
    const { pass } = setting;
    if (state.sent === pass || setting.elapsed - pass * PACE_MS < beat(pass) * PACE_MS) return;
    state.sent = pass;
    setting.send(pass);
  },
});

/** Cues the voice that keeps launching shells, looping on the pacer until it is faded. */
export function keepLaunching(m: Mix<Shell, Pose>): Handle<Shell> {
  return m.cue({
    patch: pace,
    subjects: [PACER],
    loop: true,
    name: 'keep launching',
    tags: [AUTO],
  });
}

/** Whether the show keeps launching shells, read from the mix, which a seek back puts as it was. */
export const launching = (m: Mix<Shell, Pose>): boolean =>
  m.voices(AUTO).some((h) => h.state !== 'fading');

/** The show's mix, named and with history whether or not a panel is mounted. */
export function createShow(): Mix<Shell, Pose> {
  return mix<Shell, Pose>(KIT, {
    name: 'show',
    labelOf: (s: Shell) => (s === PACER ? 'pacer' : `shell at x ${s.x.toFixed(1)}`),
    history: { ms: HISTORY_MS, tape: createHistory },
  });
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
    hits: hits(),
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
