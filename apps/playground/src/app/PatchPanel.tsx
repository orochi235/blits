import type { Kit } from '@msb235/blits';
import {
  type Expr,
  isMotion,
  type Motion,
  type PatchSource,
  periodOf,
  type Voice,
} from '@pg/blits/composition';
import { withKey } from '@pg/blits/keyed';
import { stopsOf, tracksOf } from '@pg/blits/keys';
import { CHANNELS, type ChannelName, type Mixed } from '@pg/blits/kit';
import type { FieldError } from '@pg/blits/spec';
import { CodePane } from '@pg/widgets/CodePane';
import { ExprInput } from '@pg/widgets/ExprInput';
import type { SampledTrack } from '@weasel-js/core';
import { Timeline } from '@weasel-js/ui';
import { useState } from 'react';
import s from './App.module.css';
import { ChannelTiming } from './ChannelTiming';
import { EaseField } from './EaseField';
import { KeyEditor } from './KeyEditor';
import { WaveFields } from './WaveFields';

type Kind = PatchSource['kind'];

const KINDS: readonly Kind[] = ['keys', 'fn', 'wave', 'spring', 'glide', 'tween'];

/** Every option each motion takes, required ones first; an empty field leaves blits' default. */
const OPTIONS: Record<Motion['kind'], readonly string[]> = {
  spring: ['to', 'from', 'velocity', 'stiffness', 'damping', 'mass', 'settle'],
  glide: ['from', 'velocity', 'ms', 'settle'],
  tween: ['from', 'to', 'ms'],
};

/** Errors on the patch as a whole, which no single field shows; so are errors on options it has no field for. */
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
  if (kind === 'wave')
    return { kind, period: 1000, shape: 'sine', cycles: 1, phase: 0, depth: { scale: 0.25 } };
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

export interface PatchPanelProps {
  voice: Voice;
  /** The composition's kit, whose rests the fields show. */
  kit: Kit<Mixed>;
  errors: FieldError[];
  /** Score time, ms. */
  playhead: number;
  onChange(v: Voice): void;
}

export function PatchPanel({ voice: v, kit, errors, playhead, onChange }: PatchPanelProps) {
  const p = v.patch;
  const [mode, setMode] = useState<'dope' | 'graph'>('dope');
  const set = (patch: PatchSource) => onChange({ ...v, patch });
  const mine = errors.filter((e) => e.voice === v.id);
  const err = (field: string) => mine.find((e) => e.field === field);
  const shown = isMotion(p) ? OPTIONS[p.kind] : [];
  const whole = mine.filter(
    (e) =>
      WHOLE.has(e.field) ||
      (e.field.startsWith('opts.') && !shown.includes(e.field.slice('opts.'.length))),
  );
  const period = periodOf(p) ?? 0;
  const phase = period > 0 ? Math.max(0, (playhead - v.start) * v.rate) % period : 0;

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
        {!isMotion(p) && (
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
        {isMotion(p) && (
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
        <>
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
          <EaseField
            label="ease, every segment no stop overrides"
            value={p.ease}
            onChange={(ease) => set(withKey(p, 'ease', ease))}
          />
          <ChannelTiming patch={p} onChange={set} />
        </>
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
      {p.kind === 'wave' && <WaveFields patch={p} kit={kit} onChange={set} />}
      {isMotion(p) && (
        <>
          {OPTIONS[p.kind].map((k) => (
            <ExprInput
              key={k}
              label={k}
              placeholder={
                k === 'to' || k === 'from' || k === 'velocity'
                  ? `${JSON.stringify(kit[p.channel].rest ?? 0)} or (s) => …`
                  : 'default'
              }
              value={textOf(p.opts[k])}
              error={err(`opts.${k}`)?.error ?? null}
              onCommit={(text) => {
                set({ ...p, opts: withKey(p.opts, k, parsed(text)) });
              }}
            />
          ))}
          {p.kind === 'tween' && (
            <EaseField
              label="ease"
              value={p.ease}
              onChange={(ease) => set(withKey(p, 'ease', ease))}
            />
          )}
        </>
      )}
    </section>
  );
}
