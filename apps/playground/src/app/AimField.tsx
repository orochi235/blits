import type { Moving, spring, Value } from '@msb235/blits';
import { type Composition, isMotion, type Motion } from '@pg/blits/composition';
import { compileExpr, scopeOf } from '@pg/blits/expr';
import type { Mixed } from '@pg/blits/kit';
import type { Player } from '@pg/blits/player';
import { refusalOf } from '@pg/blits/spec';
import type { Subject } from '@pg/blits/stage';
import { ExprInput } from '@pg/widgets/ExprInput';
import { useState } from 'react';

/** A spring's or a tween's patch, which take `to`; a glide takes only `push`, which every one does. */
type Aimed = ReturnType<typeof spring<Subject, Mixed, Value>>;

export interface AimFieldProps {
  comp: Composition;
  player: Player;
  /** The motion voice's id. */
  id: string;
  patch: Motion;
  act: Player['live'];
}

/** A per-subject `to` for a motion voice as it runs, or a glide's `velocity` by `push`. */
export function AimField({ comp, player, id, patch: p, act }: AimFieldProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const key = p.kind === 'glide' ? 'velocity' : 'to';
  const aim = (src: string) => {
    if (!isMotion(p) || src.trim() === '') return;
    const r = compileExpr<(s: Subject) => unknown>({ code: src }, scopeOf(comp.levels), undefined);
    if ('error' in r) return setError(r.error);
    const refuse = refusalOf(p.channel, key);
    let wrong: string | null = null;
    const values = player.subjects.map((subject) => {
      const out = r.fn(subject);
      const why = out === undefined ? null : refuse(out);
      wrong ??= why;
      return why === null ? out : undefined;
    });
    setError(wrong ? `${key} ${wrong}` : r.faults.first);
    act(id, (_, patch) => {
      player.subjects.forEach((subject, i) => {
        const value = values[i] as Value | undefined;
        if (value === undefined) return;
        if (key === 'to') (patch as unknown as Aimed).to(subject, value);
        else (patch as unknown as Moving<Subject, Mixed, Value>).push(subject, value);
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
      <button type="button" disabled={code.trim() === ''} onClick={() => aim(code)}>
        {key === 'to' ? 'retarget' : 'push'} again
      </button>
    </>
  );
}
