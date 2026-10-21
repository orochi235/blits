import type { Composition, MixSettings } from '@pg/blits/composition';
import { FRAME } from '@pg/blits/frame';
import { withKey } from '@pg/blits/keyed';
import { ControlPanel, f, resolveConfigSchema } from '@weasel-js/labkit';
import s from './App.module.css';
import { docOf } from './docs';

/** What maxDt turns on at, having no value of its own until one is typed. */
const MAX_DT = 50;
const FRAME_MS = Math.round(FRAME * 100) / 100;

const SCHEMA = resolveConfigSchema(
  f.schema({
    step: f
      .boolean(true)

      .label('fixed step')
      .describe(docOf('MixOptions.stepMs') ?? ''),
    stepMs: f
      .number(FRAME_MS)
      .label('step every')
      .suffix('ms')
      .describe(docOf('MixOptions.stepMs') ?? '')
      .enableIf((c) => c.step === true),
    capped: f
      .boolean(false)

      .label('cap dt')
      .describe(docOf('MixOptions.maxDt') ?? ''),
    maxDt: f
      .number(MAX_DT)
      .label('maxDt')
      .suffix('ms')
      .describe(docOf('MixOptions.maxDt') ?? '')
      .enableIf((c) => c.capped === true),
    reduce: f
      .boolean(false)

      .label('reduced motion')
      .describe(docOf('MixOptions.reduce') ?? ''),
    lanes: f
      .boolean(true)

      .label('lanes')
      .describe(docOf('MixOptions.lanes') ?? ''),
  }),
);

/** The `MixOptions` a composition sets for every mix it plays in. */
export function MixPanel({
  comp,
  onChange,
}: {
  comp: Composition;
  onChange(c: Composition): void;
}) {
  const m = comp.mix ?? {};
  const set = <K extends keyof MixSettings>(key: K, value: MixSettings[K] | undefined) => {
    const next = withKey(m, key, value);
    onChange(withKey(comp, 'mix', Object.keys(next).length > 0 ? next : undefined));
  };
  const positive = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const config = {
    step: m.stepMs !== 'off',
    stepMs: typeof m.stepMs === 'number' ? m.stepMs : FRAME_MS,
    capped: m.maxDt !== undefined,
    maxDt: m.maxDt ?? MAX_DT,
    reduce: m.reduce === true,
    lanes: m.lanes !== false,
  };
  const write = (path: string, value: unknown) => {
    switch (path) {
      case 'step':
        return set('stepMs', value ? undefined : 'off');
      case 'stepMs':
        return positive(value) && set('stepMs', value as number);
      case 'capped':
        return set('maxDt', value ? MAX_DT : undefined);
      case 'maxDt':
        return positive(value) && set('maxDt', value as number);
      case 'reduce':
        return set('reduce', value === true || undefined);
      case 'lanes':
        return set('lanes', value ? undefined : false);
    }
  };
  return (
    <section className={s.panel} aria-label="mix">
      <ControlPanel title="mix" collapsible schema={SCHEMA} config={config} setConfig={write} />
    </section>
  );
}
