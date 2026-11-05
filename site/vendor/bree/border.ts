import { type Handle, type Mix, oklab, patch } from '@msb235/blits';
import type { Board, Pose, Subject } from './board.js';
import { chase } from './modulators/chase.js';
import { cueLayer } from './program.js';

/**
 * How the border's bulbs light: dark, all lit, or in a theater chase stepping every `beat` ms with
 * the bulbs between the lit ones at `dim`.
 */
export interface Border {
  readonly bulbs: 'unlit' | 'lit' | 'chase';
  readonly beat?: number;
  readonly dim?: number;
}

/** Every bulb lit, in the chase's warm white. */
const STEADY = patch<Subject, Pose>(
  1000,
  (_phase, s) => (s.kind === 'cell' ? { lit: 1, tint: oklab(0xffe2b0) } : {}),
  { writes: ['lit', 'tint'] },
);

/** A sign's border, which lights its bulbs as asked until told otherwise. */
export interface BorderVoice {
  set(border: Border): void;
}

/** Lights `b`'s bulbs on `m` as `border` asks; a board with no bulbs ignores it. */
export function cueBorder(m: Mix<Subject, Pose>, b: Board, border: Border): BorderVoice {
  let voice: Handle<Subject> | null = null;
  const set = (next: Border) => {
    voice?.fade({ over: 0 });
    voice = null;
    if (b.bulbs.length === 0 || next.bulbs === 'unlit') return;
    if (next.bulbs === 'lit') {
      voice = m.cue({ name: 'border lit', patch: STEADY, subjects: b.cells, loop: true });
      return;
    }
    const params = {
      beat: next.beat ?? chase.params.beat.value,
      dim: next.dim ?? chase.params.dim.value,
    };
    voice = cueLayer(m, b, { mod: 'chase', params }, 1);
  };
  set(border);
  return { set };
}
