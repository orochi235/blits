import type { Value } from '@msb235/blits';
import {
  type Composition,
  isMotion,
  type Level,
  type Motion,
  type PatchSource,
} from '@pg/blits/composition';
import { compileExpr, scopeOf } from '@pg/blits/expr';
import type { Player } from '@pg/blits/player';
import { refusalOf } from '@pg/blits/spec';
import type { Subject } from '@pg/blits/stage';
import { ExprInput } from '@pg/widgets/ExprInput';
import { Button } from '@weasel-js/ui';
import { useState } from 'react';

export interface AimFieldProps {
  comp: Composition;
  player: Player;
  /** The motion voice's id. */
  id: string;
  patch: Motion;
  act: Player['live'];
}

/**
 * `src` run for each subject as a motion's `to`, or a glide's `velocity`: the error to show, and the
 * values to send unless it did not compile. A blank `src` sends nothing and clears the error.
 */
export function aimOf(
  p: PatchSource,
  levels: readonly Level[],
  subjects: readonly Subject[],
  src: string,
): { error: string | null; values?: (Value | undefined)[] } {
  if (!isMotion(p) || src.trim() === '') return { error: null };
  const key = p.kind === 'glide' ? 'velocity' : 'to';
  const r = compileExpr<(s: Subject) => unknown>({ code: src }, scopeOf(levels), undefined);
  if ('error' in r) return { error: r.error };
  const refuse = refusalOf(p.channel, key);
  let wrong: string | null = null;
  const values = subjects.map((subject) => {
    const out = r.fn(subject);
    const why = out === undefined ? null : refuse(out);
    wrong ??= why;
    return why === null ? (out as Value | undefined) : undefined;
  });
  return { error: wrong ? `${key} ${wrong}` : r.faults.first, values };
}

/** A per-subject `to` for a motion voice as it runs, or a glide's `velocity` by `push`. */
export function AimField({ comp, player, id, patch: p, act }: AimFieldProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const key = p.kind === 'glide' ? 'velocity' : 'to';
  const aim = (src: string) => {
    const { error, values } = aimOf(p, comp.levels, player.subjects, src);
    setError(error);
    if (!values) return;
    act(id, (handle) => {
      player.subjects.forEach((subject, i) => {
        const value = values[i];
        if (value === undefined) return;
        if (key === 'to') handle.to(subject, value);
        else handle.push(subject, value);
      });
    });
  };
  return (
    <>
      <ExprInput
        label={key === 'to' ? 'retarget' : 'push'}
        placeholder={key === 'to' ? '(s) => [0, 40]' : '(s) => [200, 0]'}
        value={code}
        error={error}
        onCommit={(next) => {
          setCode(next);
          aim(next);
        }}
      />
      <Button size="sm" disabled={code.trim() === ''} onClick={() => aim(code)}>
        {key === 'to' ? 'retarget' : 'push'} again
      </Button>
    </>
  );
}
