import type { Placement } from '@msb235/blits';
import { blendOf } from '@pg/blits/blend';
import type { Composition, Expr, Voice } from '@pg/blits/composition';
import type { Faults } from '@pg/blits/expr';
import { withKey } from '@pg/blits/keyed';
import type { FieldError } from '@pg/blits/spec';
import { ControlPanel, f } from '@weasel-js/labkit';
import { anchorRow } from './AnchorRow';
import s from './App.module.css';
import { blendRow } from './BlendField';
import { docOf } from './docs';
import { hintsConfig, hintsGroup, writtenHints } from './HintsFields';
import { marksConfig, marksNodes, writtenMarks } from './MarksFields';
import { ownerRow } from './OwnerField';
import {
  deleteRow,
  exprRow,
  faultsRow,
  looseErrorsRow,
  noted,
  optional,
  optionalNumber,
  rowErrors,
  SpecProvider,
  sharedConfig,
  sharedNodes,
  specSchema,
  when,
  writtenShared,
} from './SpecFields';
import { weightRow } from './WeightField';

/** What the panel's conditional rows turn on. */
interface Is {
  /** Under a span, which places it. */
  spanned: boolean;
  /** Its patch has a `step`, so its own interval and catch-up apply. */
  stepped: boolean;
  /** It has a role, which may be blended. */
  role: boolean;
  /** Its role is a blend, whose signal stands in for its weight. */
  blended: boolean;
}
const is = (test: (i: Is) => boolean) => when<{ is: Is }>((c) => test(c.is));

const doc = (member: string) => docOf(`VoiceSpec.${member}`);
const d = (member: string) => doc(member) ?? '';
const shared = sharedNodes(doc);
/** Errors on fields that have no row of their own, shown in a list at the top. */
/** Errors on fields with a plain row, by the row's path; the rest are listed loose. */
const ROWED = { name: 'name', start: 'start', loop: 'repeat', role: 'role' };
const LOOSE = new Set(['cue', 'anchor']);

const SCHEMA = specSchema({
  name: shared.name,
  errors: f.label('voice errors').render(looseErrorsRow(LOOSE)),
  start: shared.start
    .section('timing')
    .enableIf(is((i) => !i.spanned))
    .render(noted(undefined, 'a span places it')),
  // A voice plays backward below 0.
  rate: f.number(1).range(-4, 4).step(0.05).describe(d('rate')).section('timing'),
  repeat: f.boolean(true).describe(d('loop')).section('timing'),
  passes: f.number(1).step(1).describe(d('loop')).section('timing'),
  seek: shared.seek.section('timing').render(
    optionalNumber({
      placeholder: ({ x }) => (x.rate < 0 ? 'its end' : '0'),
      hint: ({ x }) => `voice ms it starts at${x.rate < 0 ? ', playing back to 0' : ''}`,
      step: 10,
    }),
  ),
  stepMs: optional()
    .label('stepMs')
    .describe(d('stepMs'))
    .section('timing')
    .showIf(is((i) => i.stepped))
    .render(
      optionalNumber({
        placeholder: "the mix's",
        hint: 'its own step interval; 0 steps by the frame',
        min: 0,
        step: 1,
      }),
    ),
  catchUp: f
    .enum('exact', [
      { value: 'exact', label: 'exact (default)' },
      { value: 'fresh', label: 'fresh' },
    ])
    .label('catchUp')
    .describe(d('catchUp'))
    .section('timing')
    .showIf(is((i) => i.stepped))
    .render(noted('from its origin, or from first sight')),
  fadeIn: shared.fadeIn.section('fade'),
  fadeOut: shared.fadeOut.section('fade'),
  fadeEase: shared.fadeEase.section('fade'),
  freeze: shared.freeze.section('blending'),
  role: f.string('').describe(d('role')).section('blending'),
  fromCurrent: f.boolean(false).label("from: 'current'").describe(d('from')).section('blending'),
  blend: f
    .custom<Expr | undefined>('blend', undefined)
    .label('blend')
    .describe(docOf('Mix.blend') ?? '')
    .section('blending')
    .showIf(is((i) => i.role))
    .render(blendRow),
  weight: f
    .custom<number | Expr>('weight', 1)
    .label('weight')
    .describe(d('weight'))
    .section('blending')
    .showIf(is((i) => !i.blended))
    .render(weightRow),
  stagger: f
    .string('')
    .describe(d('stagger'))
    .section('subjects')
    .render(exprRow('(s) => s.col * 80')),
  target: f
    .string('')
    .describe(d('target'))
    .section('subjects')
    .render(exprRow('(s) => s.row === 0')),
  faults: f.label('faults').section('subjects').render(faultsRow),
  owner: f.string('').describe(d('owner')).section('placement').render(ownerRow),
  anchor: f
    .custom<Placement | undefined>('anchor', undefined)
    .label('anchor')
    .describe(d('anchor'))
    .section('placement')
    .render(anchorRow),
  hints: hintsGroup(is((i) => i.spanned)).section('placement'),
  ...Object.fromEntries(
    Object.entries(marksNodes(true, doc)).map(([k, n]) => [k, n.section('tags and marks')]),
  ),
  delete: f
    .action(() => {})
    .label('delete voice')
    .section('tags and marks')
    .render(deleteRow('delete voice')),
});

/** The panel's values for `v`. */
function configOf(v: Voice, comp: Composition, spanned: boolean) {
  return {
    ...sharedConfig(v),
    repeat: v.loop === true,
    passes: typeof v.loop === 'number' ? v.loop : 1,
    stepMs: v.stepMs,
    catchUp: v.catchUp ?? 'exact',
    role: v.role ?? '',
    fromCurrent: v.from === 'current',
    weight: v.weight,
    stagger: v.stagger?.code ?? '',
    target: v.target?.code ?? '',
    owner: v.owner ?? '',
    anchor: v.anchor,
    hints: hintsConfig(v.hints),
    ...marksConfig(v),
    is: {
      spanned,
      stepped: v.patch.kind === 'fn' && v.patch.step !== undefined,
      role: v.role !== undefined,
      blended: blendOf(comp, v) !== undefined,
    } satisfies Is,
  };
}

const code = (text: unknown): Expr | undefined => (text ? { code: text as string } : undefined);

/** One edited row, written back into the voice it came from. */
function written(v: Voice, path: string, value: unknown): Voice {
  const shared = writtenShared(v, path, value) ?? writtenMarks(v, path, value);
  if (shared) return shared;
  if (path.startsWith('hints.'))
    return withKey(v, 'hints', writtenHints(v.hints, path.slice('hints.'.length), value));
  switch (path) {
    case 'repeat':
      return { ...v, loop: value ? true : typeof v.loop === 'number' ? v.loop : 1 };
    case 'passes':
      return Number.isFinite(value) ? { ...v, loop: Math.max(1, Math.round(value as number)) } : v;
    case 'stepMs': {
      const ms = value as number | undefined;
      return withKey(v, 'stepMs', ms !== undefined && ms >= 0 ? ms : undefined);
    }
    case 'catchUp':
      return withKey(v, 'catchUp', value === 'fresh' ? ('fresh' as const) : undefined);
    case 'role':
      return withKey(v, 'role', (value as string) || undefined);
    case 'fromCurrent':
      return withKey(v, 'from', value ? ('current' as const) : undefined);
    case 'weight':
      return { ...v, weight: value as number | Expr };
    case 'stagger':
      return withKey(v, 'stagger', code(value));
    case 'target':
      return withKey(v, 'target', code(value));
    case 'anchor':
      return withKey(v, 'anchor', value as Placement | undefined);
    default:
      return v;
  }
}

export interface VoicePanelProps {
  voice: Voice;
  comp: Composition;
  /** Under a span, which places it: no start of its own, and hints for the span's fit. */
  spanned: boolean;
  onJoin(owner: string | null): void;
  /** Blends the voice's role by a signal, or unblends it. */
  onBlend(by: Expr | undefined): void;
  errors: FieldError[];
  faults: Faults | undefined;
  onChange(v: Voice): void;
  onDelete(): void;
}

export function VoicePanel(p: VoicePanelProps) {
  const { voice: v, spanned } = p;
  const write = (path: string, value: unknown) => {
    if (path === 'owner') p.onJoin((value as string) || null);
    else if (path === 'blend') p.onBlend(value as Expr | undefined);
    else p.onChange(written(v, path, value));
  };
  return (
    <section className={s.panel} aria-label={`voice ${v.name}`}>
      <SpecProvider
        value={{
          x: v,
          comp: p.comp,
          spanned,
          errors: p.errors,
          faultsOf: (key) => (key === v.id ? p.faults : undefined),
          onDelete: p.onDelete,
        }}
      >
        <ControlPanel
          title={`voice · ${v.name}`}
          schema={SCHEMA}
          config={configOf(v, p.comp, spanned)}
          setConfig={write}
          errors={rowErrors(p.errors, v.id, ROWED)}
        />
      </SpecProvider>
    </section>
  );
}
