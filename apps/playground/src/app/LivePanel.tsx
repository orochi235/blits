import type { Moving, spring, Value } from '@msb235/blits';
import { refusalOf } from '@pg/blits/compile';
import type { Composition, Voice } from '@pg/blits/composition';
import { compileExpr, scopeOf } from '@pg/blits/expr';
import type { Pose } from '@pg/blits/kit';
import type { Player } from '@pg/blits/player';
import type { Subject } from '@pg/blits/stage';
import { ExprInput } from '@pg/widgets/ExprInput';
import { useState } from 'react';
import s from './App.module.css';
import { docOf } from './docs';

/** A spring's or a tween's patch, which take `to`; a glide takes only `push`, which every one does. */
type Aimed = ReturnType<typeof spring<Subject, Pose, Value>>;

export interface LivePanelProps {
  player: Player;
  comp: Composition;
  voice: Voice;
  /** Called after each live change, so the panel and the badge redraw. */
  onActed(): void;
}

export function LivePanel({ player, comp, voice: v, onActed }: LivePanelProps) {
  const [seekMs, setSeekMs] = useState(0);
  const [rampTo, setRampTo] = useState(0.25);
  const [rampOver, setRampOver] = useState(500);
  const [aimCode, setAimCode] = useState('');
  const [aimError, setAimError] = useState<string | null>(null);
  const handle = player.built.handles.get(v.id);
  if (!handle) return <p className={s.row}>{v.name} is not running: fix its errors first.</p>;
  const act: Player['live'] = (id, fn) => {
    player.live(id, fn);
    onActed();
  };
  const motion = v.patch.kind === 'spring' || v.patch.kind === 'glide' || v.patch.kind === 'tween';
  const aimKey = v.patch.kind === 'glide' ? 'velocity' : 'to';
  const aim = (code: string) => {
    const p = v.patch;
    if (p.kind === 'keys' || p.kind === 'fn' || code.trim() === '') return;
    const channel = p.channel;
    const r = compileExpr<(s: Subject) => unknown>({ code }, scopeOf(comp.levels), undefined);
    if ('error' in r) return setAimError(r.error);
    const refuse = refusalOf(channel, aimKey);
    let wrong: string | null = null;
    const values = player.subjects.map((subject) => {
      const out = r.fn(subject);
      const why = out === undefined ? null : refuse(out);
      wrong ??= why;
      return why === null ? out : undefined;
    });
    setAimError(wrong ? `${aimKey} ${wrong}` : r.faults.first);
    act(v.id, (_, patch) => {
      player.subjects.forEach((subject, i) => {
        const value = values[i] as Value | undefined;
        if (value === undefined) return;
        if (aimKey === 'to') (patch as unknown as Aimed).to(subject, value);
        else (patch as unknown as Moving<Subject, Pose, Value>).push(subject, value);
      });
    });
  };
  return (
    <section className={s.panel} aria-label={`live ${v.name}`}>
      <p className={s.row}>
        live · {v.name} · {handle.state}
      </p>
      <label className={s.row} title={docOf('Handle.weight')}>
        weight
        <input
          type="range"
          min={0}
          max={2}
          step={0.01}
          value={handle.weight}
          onChange={(e) => {
            const w = Number(e.target.value);
            // Elsewhere the voice plays silent beside another's solo, and must stay so.
            act(v.id, (h, _, heard) => {
              if (heard) h.weight = w;
            });
          }}
        />
        <output className={s.readout}>{handle.weight.toFixed(2)}</output>
      </label>
      <div className={s.row}>
        <button type="button" onClick={() => act(v.id, (h) => h.fade())}>
          fade
        </button>
        <label className={s.row} title={docOf('Handle.seek')}>
          seek
          <input
            type="number"
            min={0}
            step={50}
            value={seekMs}
            onChange={(e) => setSeekMs(e.target.valueAsNumber || 0)}
          />
        </label>
        <button type="button" onClick={() => act(v.id, (h) => h.seek(seekMs))}>
          go
        </button>
      </div>
      <div className={s.row} title={docOf('Handle.ramp')}>
        <label className={s.row}>
          ramp to
          <input
            type="number"
            min={0}
            step={0.05}
            value={rampTo}
            onChange={(e) => setRampTo(e.target.valueAsNumber || 0)}
          />
        </label>
        <label className={s.row}>
          over
          <input
            type="number"
            min={0}
            step={50}
            value={rampOver}
            onChange={(e) => setRampOver(e.target.valueAsNumber || 0)}
          />
        </label>
        <button type="button" onClick={() => act(v.id, (h) => h.ramp(rampTo, rampOver))}>
          ramp
        </button>
      </div>
      {motion && (
        <ExprInput
          label={aimKey === 'to' ? 'retarget' : 'push'}
          placeholder={aimKey === 'to' ? '(s) => [0, 40]' : '(s) => [200, 0]'}
          value={aimCode}
          error={aimError}
          onCommit={(code) => {
            setAimCode(code);
            aim(code);
          }}
        />
      )}
      {motion && (
        <button type="button" disabled={aimCode.trim() === ''} onClick={() => aim(aimCode)}>
          {aimKey === 'to' ? 'retarget' : 'push'} again
        </button>
      )}
    </section>
  );
}
