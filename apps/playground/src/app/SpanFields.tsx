import type { FitStep, SpanSettings } from '@pg/blits/composition';
import { withKey } from '@pg/blits/keyed';
import { f } from '@weasel-js/labkit';
import { docOf } from './docs';
import { resultRow } from './FitReadout';
import { fitRow } from './FitSteps';
import { optional, optionalNumber } from './SpecFields';

const d = (key: string) => docOf(`SpanSpec.${key}`) ?? '';
/** A choice whose blank leaves blits' default, named in its label. */
const choice = (key: string, options: readonly string[], fallback: string) =>
  f
    .enum('', [
      { value: '', label: `default (${fallback})` },
      ...options.map((value) => ({ value, label: value })),
    ])
    .describe(d(key));

/** A span's own settings, at `span.<key>`: its budget, how it lays out and fits what it holds, and how it last fitted. */
export const spanGroup = f
  .group({
    duration: optional()
      .describe(d('duration'))
      .render(optionalNumber({ placeholder: 'none', min: 0, step: 10, unit: 'ms' })),
    priority: choice('priority', ['weak', 'strong', 'required'], 'strong'),
    order: choice('order', ['queue', 'stagger', 'together'], 'queue'),
    share: f
      .number(0.5)
      .range(0, 1)
      .step(0.05)
      .describe(d('share'))
      .showIf({ path: 'span.order', is: 'stagger' }),
    spill: choice('spill', ['instant', 'overrun'], 'instant'),
    fit: f.custom<FitStep[] | undefined>('fit', undefined).describe(d('fit')).render(fitRow),
    result: f.label('fit result').render(resultRow),
  })
  .label('span');

/** The span rows' values. */
export const spanConfig = (sp: SpanSettings) => ({
  duration: sp.duration,
  priority: sp.priority ?? '',
  order: sp.order ?? '',
  share: sp.share ?? 0.5,
  spill: sp.spill ?? '',
  fit: sp.fit,
});

/** `sp` with the row at `span.<key>` written. */
export function writtenSpan(sp: SpanSettings, key: string, value: unknown): SpanSettings {
  switch (key) {
    case 'duration': {
      const n = value as number | undefined;
      return withKey(
        sp,
        'duration',
        n !== undefined && Number.isFinite(n) && n >= 0 ? n : undefined,
      );
    }
    case 'priority':
    case 'order':
    case 'spill':
      return withKey(sp, key, (value || undefined) as SpanSettings[typeof key]);
    case 'share':
      return withKey(sp, 'share', value as number);
    case 'fit':
      return withKey(sp, 'fit', value as FitStep[] | undefined);
    default:
      return sp;
  }
}
