import type { PatchSource } from '@pg/blits/composition';
import { writesOf } from '@pg/blits/flow';
import { withKey } from '@pg/blits/keyed';
import type { ChannelName } from '@pg/blits/kit';
import s from './App.module.css';
import { EaseField } from './EaseField';

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

/** Each keyed channel's own delay and curve: blits' `delayBy` and `easeBy`. */
export function ChannelTiming({ patch: p, onChange }: { patch: Keys; onChange(p: Keys): void }) {
  const channels = writesOf(p);
  if (channels.length === 0) return null;
  return (
    <fieldset className={s.field}>
      <legend>per channel</legend>
      {channels.map((ch) => {
        const delay = p.delayBy?.[ch];
        return (
          <div key={ch} className={s.field}>
            <label className={s.row}>
              {ch} waits
              <input
                type="number"
                min={0}
                step="any"
                aria-label={`${ch} delay`}
                value={delay ?? 0}
                onChange={(e) => {
                  const n = e.target.valueAsNumber;
                  if (!Number.isFinite(n) || n < 0) return;
                  onChange(withKey(p, 'delayBy', within(p.delayBy, ch, n === 0 ? undefined : n)));
                }}
              />
              ms
            </label>
            <EaseField
              label={`${ch} ease`}
              inherit="the patch's ease"
              value={p.easeBy?.[ch]}
              onChange={(ease) => onChange(withKey(p, 'easeBy', within(p.easeBy, ch, ease)))}
            />
          </div>
        );
      })}
    </fieldset>
  );
}
