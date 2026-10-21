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
import type { SampledTrack } from '@weasel-js/animator';
import { ControlPanel, type ControlRenderer, f, resolveConfigSchema } from '@weasel-js/labkit';
import { Timeline } from '@weasel-js/ui';
import { type CSSProperties, useMemo, useState } from 'react';
import s from './App.module.css';
import { ChannelTiming } from './ChannelTiming';
import { docOf } from './docs';
import { EaseField } from './EaseField';
import { KeyEditor } from './KeyEditor';
import m from './PatchLive.module.css';
import { ExprRow, Row } from './SpecFields';
import { depthRenderers, waveConfig, waveNodes, writtenWave } from './WaveFields';

type Kind = PatchSource['kind'];

const KINDS: readonly Kind[] = ['keys', 'fn', 'wave', 'spring', 'glide', 'tween'];
const MOTIONS: readonly Motion['kind'][] = ['spring', 'glide', 'tween'];

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

const MOTION = { path: 'kind', in: MOTIONS } as const;
const isKind = (kind: Kind) => ({ path: 'kind', is: kind });

/** Every patch kind's rows; a kind's own show only while it is picked. */
function schemaOf() {
  const custom = (kind: string) => f.custom<null>(kind, null);
  return resolveConfigSchema(
    f.schema({
      kind: f
        .enum<Kind>('keys', KINDS)
        .label('kind')
        .describe('Switching starts a blank patch of that kind.'),
      period: f
        .number(1000)
        .label('period')

        .range(0, 1e9)
        .input()
        .step(10)
        .suffix('ms')
        .showIf({ not: MOTION }),
      channel: f.enum<ChannelName>('offset', CHANNELS).label('channel').showIf(MOTION),
      keys: f
        .group({
          timeline: custom('timeline'),
          ease: custom('ease').describe(docOf('KeysOptions.ease') ?? ''),
          timing: custom('timing'),
        })
        .as('fragment')
        .showIf(isKind('keys')),
      fn: f
        .group({
          writes: f
            .group(Object.fromEntries(CHANNELS.map((ch) => [ch, f.boolean(false).label(ch)])))
            .label('writes'),
          at: custom('code'),
          state: custom('code'),
          step: custom('code'),
        })
        .as('fragment')
        .showIf(isKind('fn')),
      wave: waveNodes().showIf(isKind('wave')),
      ...Object.fromEntries(
        MOTIONS.map((kind) => [
          kind,
          f
            .group({
              ...Object.fromEntries(
                OPTIONS[kind].map((k) => [
                  k,
                  custom('expr')
                    .label(k)
                    .describe(docOf(`${kind}.${k}`) ?? ''),
                ]),
              ),
              ...(kind === 'tween'
                ? { ease: custom('ease').describe(docOf('tween.ease') ?? '') }
                : {}),
            })
            .as('fragment')
            .showIf(isKind(kind)),
        ]),
      ),
    }),
  );
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
  const schema = useMemo(schemaOf, []);
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

  const config = {
    kind: p.kind,
    period: isMotion(p) ? 1000 : p.period,
    channel: isMotion(p) ? p.channel : 'offset',
    fn: {
      writes: Object.fromEntries(
        CHANNELS.map((ch) => [ch, p.kind === 'fn' && p.writes.includes(ch)]),
      ),
    },
    ...(p.kind === 'wave' ? { wave: waveConfig(p) } : {}),
  };

  const setConfig = (path: string, value: unknown) => {
    const [head, ...rest] = path.split('.');
    if (path === 'kind') return set(blank(value as Kind));
    if (path === 'period' && !isMotion(p)) {
      if (Number.isFinite(value) && (value as number) >= 0) set({ ...p, period: value as number });
      return;
    }
    if (path === 'channel' && isMotion(p)) return set({ ...p, channel: value as ChannelName });
    if (head === 'fn' && p.kind === 'fn') {
      const ch = rest[1] as ChannelName;
      return set({
        ...p,
        writes: value
          ? CHANNELS.filter((x) => x === ch || p.writes.includes(x))
          : p.writes.filter((x) => x !== ch),
      });
    }
    if (head === 'wave' && p.kind === 'wave') set(writtenWave(p, rest.join('.'), value));
  };

  const code =
    (field: 'at' | 'state' | 'step', label: string, rows?: number): ControlRenderer =>
    () => {
      if (p.kind !== 'fn') return null;
      const optional = field !== 'at';
      return (
        <div className={m.wide}>
          <CodePane
            label={label}
            rows={rows}
            value={p[field] ?? ''}
            error={err(field)?.error ?? null}
            errorLine={err(field)?.line ?? null}
            onCommit={(x) => set({ ...p, [field]: optional && !x.trim() ? undefined : x })}
          />
        </div>
      );
    };

  const renderers: Record<string, ControlRenderer> = {};
  if (p.kind === 'keys') {
    const tracks = tracksOf(p.stops, p.period);
    renderers['keys.timeline'] = () => (
      <div className={m.timeline} style={{ '--tracks': tracks.length } as CSSProperties}>
        <Timeline
          tracks={tracks}
          duration={p.period}
          playhead={phase}
          mode={mode}
          onModeChange={setMode}
          transport={false}
          onScrub={() => {}}
          renderKeyEditor={KeyEditor}
          onChange={(tracks) =>
            set({ ...p, stops: stopsOf(tracks as SampledTrack<unknown>[], p.period, p.stops) })
          }
        />
      </div>
    );
    renderers['keys.ease'] = () => (
      <EaseField
        label="ease"
        description="Every segment no stop overrides."
        value={p.ease}
        onChange={(ease) => set(withKey(p, 'ease', ease))}
      />
    );
    renderers['keys.timing'] = () => (
      <div className={m.wide}>
        <ChannelTiming patch={p} onChange={set} />
      </div>
    );
  }
  if (p.kind === 'fn') {
    renderers['fn.at'] = code('at', 'at (phase, s, setting) => delta');
    renderers['fn.state'] = code('state', 'state (s) => initial', 2);
    renderers['fn.step'] = code('step', 'step (state, dt, s, setting) => void', 3);
  }
  if (p.kind === 'wave') Object.assign(renderers, depthRenderers(p, kit, set));
  if (isMotion(p)) {
    for (const k of OPTIONS[p.kind])
      renderers[`${p.kind}.${k}`] = (row) => (
        <Row row={row} wide>
          <ExprRow
            row={row}
            placeholder={
              k === 'to' || k === 'from' || k === 'velocity'
                ? `${JSON.stringify(kit[p.channel].rest ?? 0)} or (s) => …`
                : 'default'
            }
            value={textOf(p.opts[k])}
            error={err(`opts.${k}`)?.error ?? null}
            onCommit={(text) => set({ ...p, opts: withKey(p.opts, k, parsed(text)) })}
          />
        </Row>
      );
    if (p.kind === 'tween')
      renderers['tween.ease'] = () => (
        <EaseField label="ease" value={p.ease} onChange={(ease) => set(withKey(p, 'ease', ease))} />
      );
  }

  return (
    <section className={s.panel} aria-label="patch">
      {whole.length > 0 && (
        <ul className={m.errors} role="alert" aria-label="patch errors">
          {whole.map((e) => (
            <li key={e.field}>
              {e.field}: {e.error}
            </li>
          ))}
        </ul>
      )}
      <ControlPanel
        title="patch"
        schema={schema}
        config={config}
        setConfig={setConfig}
        renderers={renderers}
        pack="auto"
      />
    </section>
  );
}
