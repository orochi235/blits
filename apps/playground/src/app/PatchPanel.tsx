import type { FieldError } from '@pg/blits/compile';
import type { Expr, PatchSource, Voice } from '@pg/blits/composition';
import { stopsOf, tracksOf } from '@pg/blits/keys';
import { CHANNELS, type ChannelName, KIT } from '@pg/blits/kit';
import { CodePane } from '@pg/widgets/CodePane';
import { ExprInput } from '@pg/widgets/ExprInput';
import type { SampledTrack } from '@weasel-js/core';
import { EasingPicker, type KeyEditorCtx, Timeline } from '@weasel-js/ui';
import { useState } from 'react';
import s from './App.module.css';

type Kind = PatchSource['kind'];
type Motion = Extract<PatchSource, { kind: 'spring' | 'glide' | 'tween' }>;

const KINDS: readonly Kind[] = ['keys', 'fn', 'spring', 'glide', 'tween'];

/** Every option each motion takes, required ones first; an empty field leaves blits' default. */
const OPTIONS: Record<Motion['kind'], readonly string[]> = {
  spring: ['to', 'from', 'velocity', 'stiffness', 'damping', 'mass', 'settle'],
  glide: ['from', 'velocity', 'ms', 'settle'],
  tween: ['from', 'to', 'ms'],
};

const NAMED_EASES = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'] as const;

/** Errors on the patch as a whole, which no single field shows. */
const WHOLE = new Set(['stops', 'writes', 'opts']);

function blank(kind: Kind): PatchSource {
  if (kind === 'keys')
    return {
      kind,
      period: 1000,
      stops: [
        { at: 0, delta: { scale: 1 } },
        { at: 1, delta: { scale: 1.5 } },
      ],
    };
  if (kind === 'fn')
    return { kind, period: 1000, writes: ['turn'], at: '(phase) => ({ turn: phase * 360 })' };
  if (kind === 'spring')
    return {
      kind,
      channel: 'offset',
      opts: { from: [0, -40], to: [0, 0], stiffness: 170, damping: 26 },
    };
  if (kind === 'glide')
    return { kind, channel: 'offset', opts: { from: [0, 0], velocity: [200, 0], ms: 325 } };
  return { kind, channel: 'offset', opts: { from: [0, 0], to: [40, 0], ms: 600 } };
}

const textOf = (v: number | number[] | Expr | undefined) =>
  v === undefined ? '' : typeof v === 'object' && !Array.isArray(v) ? v.code : JSON.stringify(v);

/** A number or a list of numbers stays a literal; anything else is an expression. */
function parsed(text: string): number | number[] | Expr | undefined {
  const t = text.trim();
  if (t === '') return undefined;
  try {
    const v: unknown = JSON.parse(t);
    if (typeof v === 'number' || (Array.isArray(v) && v.every((x) => typeof x === 'number')))
      return v as number | number[];
  } catch {}
  return { code: t };
}

const hexOf = (n: number) => `#${(n >>> 0).toString(16).padStart(6, '0').slice(-6)}`;

/** The selected key's value as inputs shaped to its channel, and the curve into it. */
function KeyEditor({ key: k, track, commit, setEasing }: KeyEditorCtx) {
  const ch = track.label as ChannelName;
  const set = (value: unknown) => commit({ ...k, value });
  const num = (value: number, on: (n: number) => void, label: string) => (
    <input
      key={label}
      type="number"
      step="any"
      aria-label={label}
      value={value}
      onChange={(e) => {
        if (Number.isFinite(e.target.valueAsNumber)) on(e.target.valueAsNumber);
      }}
    />
  );
  return (
    <div className={s.field}>
      <div className={s.row}>
        {ch} at {Math.round(k.t)} ms
        {ch === 'color' ? (
          <input
            type="color"
            aria-label="color"
            value={hexOf(k.value as number)}
            onChange={(e) => set(Number.parseInt(e.target.value.slice(1), 16))}
          />
        ) : Array.isArray(k.value) ? (
          (k.value as number[]).map((x, i) =>
            num(
              x,
              (n) => set((k.value as number[]).map((y, j) => (j === i ? n : y))),
              `${ch} ${i}`,
            ),
          )
        ) : (
          num(k.value as number, set, ch)
        )}
      </div>
      <EasingPicker value={k.easing} onChange={setEasing} />
    </div>
  );
}

export interface PatchPanelProps {
  voice: Voice;
  errors: FieldError[];
  /** Score time, ms. */
  playhead: number;
  onChange(v: Voice): void;
}

export function PatchPanel({ voice: v, errors, playhead, onChange }: PatchPanelProps) {
  const p = v.patch;
  const [mode, setMode] = useState<'dope' | 'graph'>('dope');
  const set = (patch: PatchSource) => onChange({ ...v, patch });
  const mine = errors.filter((e) => e.voice === v.id);
  const err = (field: string) => mine.find((e) => e.field === field);
  const whole = mine.filter((e) => WHOLE.has(e.field));
  const phase =
    'period' in p && p.period > 0 ? Math.max(0, (playhead - v.start) * v.rate) % p.period : 0;

  return (
    <section className={s.panel} aria-label="patch">
      <div className={s.row}>
        <label className={s.row}>
          patch
          <select value={p.kind} onChange={(e) => set(blank(e.target.value as Kind))}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        {(p.kind === 'keys' || p.kind === 'fn') && (
          <label className={s.row}>
            period
            <input
              type="number"
              min={0}
              step={50}
              value={p.period}
              onChange={(e) => {
                const n = e.target.valueAsNumber;
                if (Number.isFinite(n) && n >= 0) set({ ...p, period: n });
              }}
            />
          </label>
        )}
        {p.kind !== 'keys' && p.kind !== 'fn' && (
          <label className={s.row}>
            channel
            <select
              value={p.channel}
              onChange={(e) => set({ ...p, channel: e.target.value as ChannelName })}
            >
              {CHANNELS.map((ch) => (
                <option key={ch} value={ch}>
                  {ch}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {whole.length > 0 && (
        <ul className={s.errors} role="alert" aria-label="patch errors">
          {whole.map((e) => (
            <li key={e.field}>
              {e.field}: {e.error}
            </li>
          ))}
        </ul>
      )}
      {p.kind === 'keys' && (
        <div className={s.timeline}>
          <Timeline
            tracks={tracksOf(p.stops, p.period)}
            duration={p.period}
            playhead={phase}
            mode={mode}
            onModeChange={setMode}
            transport={false}
            onScrub={() => {}}
            renderKeyEditor={KeyEditor}
            onChange={(tracks) =>
              set({
                ...p,
                stops: stopsOf(tracks as SampledTrack<unknown>[], p.period, p.stops),
              })
            }
          />
        </div>
      )}
      {p.kind === 'fn' && (
        <>
          <fieldset className={s.row}>
            <legend>writes</legend>
            {CHANNELS.map((ch) => (
              <label key={ch} className={s.row}>
                <input
                  type="checkbox"
                  checked={p.writes.includes(ch)}
                  onChange={(e) =>
                    set({
                      ...p,
                      writes: e.target.checked
                        ? CHANNELS.filter((x) => x === ch || p.writes.includes(x))
                        : p.writes.filter((x) => x !== ch),
                    })
                  }
                />
                {ch}
              </label>
            ))}
          </fieldset>
          <CodePane
            label="at (phase, s, setting) => delta"
            value={p.at}
            error={err('at')?.error ?? null}
            errorLine={err('at')?.line ?? null}
            onCommit={(at) => set({ ...p, at })}
          />
          <CodePane
            label="state (s) => initial"
            rows={2}
            value={p.state ?? ''}
            error={err('state')?.error ?? null}
            errorLine={err('state')?.line ?? null}
            onCommit={(x) => set({ ...p, state: x.trim() ? x : undefined })}
          />
          <CodePane
            label="step (state, dt, s, setting) => void"
            rows={3}
            value={p.step ?? ''}
            error={err('step')?.error ?? null}
            errorLine={err('step')?.line ?? null}
            onCommit={(x) => set({ ...p, step: x.trim() ? x : undefined })}
          />
        </>
      )}
      {p.kind !== 'keys' && p.kind !== 'fn' && (
        <>
          {OPTIONS[p.kind].map((k) => (
            <ExprInput
              key={k}
              label={k}
              placeholder={
                k === 'to' || k === 'from' || k === 'velocity'
                  ? `${JSON.stringify(KIT[p.channel].rest)} or (s) => …`
                  : 'default'
              }
              value={textOf(p.opts[k])}
              error={err(`opts.${k}`)?.error ?? null}
              onCommit={(text) => {
                const { [k]: _, ...rest } = p.opts;
                const next = parsed(text);
                set({ ...p, opts: next === undefined ? rest : { ...rest, [k]: next } });
              }}
            />
          ))}
          {p.kind === 'tween' && (
            <label className={s.row}>
              ease
              <select
                value={typeof p.ease === 'string' ? p.ease : 'ease'}
                onChange={(e) =>
                  set({ ...p, ease: e.target.value as (typeof NAMED_EASES)[number] })
                }
              >
                {NAMED_EASES.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
    </section>
  );
}
