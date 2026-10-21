import type { Easing } from '@msb235/blits';
import type { PatchSource } from '@pg/blits/composition';
import { writesOf } from '@pg/blits/flow';
import { withKey } from '@pg/blits/keyed';
import type { ChannelName } from '@pg/blits/kit';
import {
  ControlMatrix,
  type ControlRenderer,
  f,
  isAuto,
  resolveConfigSchema,
} from '@weasel-js/labkit';
import { docOf } from './docs';
import { EaseField, easeName } from './EaseField';

type Keys = Extract<PatchSource, { kind: 'keys' }>;

/** `by` with `ch` set to `x`, or without it; undefined once nothing is left. */
function within<V>(
  by: Partial<Record<ChannelName, V>> | undefined,
  ch: ChannelName,
  x: V | undefined,
): Partial<Record<ChannelName, V>> | undefined {
  const next = withKey(by ?? {}, ch, x);
  return Object.keys(next).length > 0 ? next : undefined;
}

const ROWS = [
  { key: 'delay', label: 'waits' },
  { key: 'ease', label: 'ease' },
];

/** Each keyed channel's own delay and curve, blits' `delayBy` and `easeBy`, inheriting the patch's until set. */
export function ChannelTiming({ patch: p, onChange }: { patch: Keys; onChange(p: Keys): void }) {
  const channels = writesOf(p);
  if (channels.length === 0) return null;
  const easeOf = (column: string): Easing | undefined =>
    column === 'patch' ? p.ease : (p.easeBy?.[column as ChannelName] ?? p.ease);
  const ease: ControlRenderer = (ctx) => {
    const column = ctx.path.split('.')[0] ?? 'patch';
    return (
      <EaseField
        label={column === 'patch' ? 'patch ease' : `${column} ease`}
        value={easeOf(column)}
        onChange={(e) => ctx.setValue(e)}
      />
    );
  };
  const column = (patch: boolean) =>
    f.group({
      delay: (patch ? f.number(0).enableIf(() => false) : f.number(0).range(0, 60000).input())
        .step(10)
        .suffix('ms')
        .describe(docOf('KeysOptions.delayBy') ?? ''),
      ease: f
        .custom<string>('ease', 'linear')
        .describe(docOf('KeysOptions.easeBy') ?? '')
        .render(ease),
    });
  const schema = resolveConfigSchema(
    f.schema({
      patch: column(true),
      ...Object.fromEntries(channels.map((ch) => [ch, column(false)])),
    }),
  );
  const config: Record<string, unknown> = { patch: { delay: 0, ease: easeName(p.ease) } };
  const auto = new Set<string>();
  for (const ch of channels) {
    const delay = p.delayBy?.[ch];
    const own = p.easeBy?.[ch];
    config[ch] = { delay: delay ?? 0, ease: easeName(own ?? p.ease) };
    if (delay === undefined) auto.add(`${ch}.delay`);
    if (own === undefined) auto.add(`${ch}.ease`);
  }
  const setConfig = (path: string, value: unknown) => {
    const [col, key] = path.split('.') as [string, 'delay' | 'ease'];
    if (col === 'patch') {
      if (key === 'ease') onChange(withKey(p, 'ease', value as Easing | undefined));
      return;
    }
    const ch = col as ChannelName;
    if (key === 'delay') {
      const n = isAuto(value) ? 0 : (value as number);
      if (!Number.isFinite(n) || n < 0) return;
      onChange(withKey(p, 'delayBy', within(p.delayBy, ch, n === 0 ? undefined : n)));
    } else {
      const e = isAuto(value) ? undefined : (value as Easing | undefined);
      onChange(withKey(p, 'easeBy', within(p.easeBy, ch, e)));
    }
  };
  return (
    <ControlMatrix
      title="per channel"
      schema={schema}
      columns={[
        { key: 'patch', label: 'patch' },
        ...channels.map((ch) => ({ key: ch, label: ch })),
      ]}
      rows={ROWS}
      config={config}
      auto={auto}
      setConfig={setConfig}
      inheritHint={() => 'from the patch'}
    />
  );
}
