import type { FitResult, Placement } from '@msb235/blits';
import type { Composition, Expr, Group } from '@pg/blits/composition';
import type { Faults } from '@pg/blits/expr';
import { withKey } from '@pg/blits/keyed';
import type { FieldError } from '@pg/blits/spec';
import { ControlPanel, type ControlRenderer, f } from '@weasel-js/labkit';
import { type PrefRenderContext, PropertyControl } from '@weasel-js/ui';
import { anchorRow } from './AnchorRow';
import s from './App.module.css';
import { docOf } from './docs';
import { hintsConfig, hintsGroup, writtenHints } from './HintsFields';
import { marksConfig, marksNodes, writtenMarks } from './MarksFields';
import { ownerRow } from './OwnerField';
import { spanConfig, spanGroup, writtenSpan } from './SpanFields';
import {
  deleteRow,
  faultsRow,
  looseErrorsRow,
  optionalNumber,
  Row,
  rowErrors,
  SpecProvider,
  sharedConfig,
  sharedNodes,
  specSchema,
  useSpec,
  when,
  writtenShared,
} from './SpecFields';
import { weightRow } from './WeightField';

const spanned = when<{ spanned: boolean }>((c) => c.spanned);
const unspanned = when<{ spanned: boolean }>((c) => !c.spanned);
/** Errors on fields that have no row of their own, shown in a list at the top. */
/** Errors on fields with a plain row, by the row's path; the rest are listed loose. A span's start
 *  and anchor rows hide under the span that refuses them. */
const ROWED = { name: 'name', rate: 'rate' };
const LOOSE = new Set(['cue', 'start', 'anchor']);

/** Owner or span; a span holds no owner, and a group under a span can only be a span. */
const kindRow: ControlRenderer = (row) => <KindRow row={row} />;

function KindRow({ row }: { row: PrefRenderContext }) {
  const { x, comp, spanned } = useSpec();
  const holdsOwner = comp.groups?.some((o) => o.owner === x.id && o.kind === 'owner') ?? false;
  return (
    <Row row={row}>
      <PropertyControl
        kind="enum"
        name={row.pref.name}
        value={row.value as Group['kind']}
        options={[
          {
            value: 'owner',
            label: spanned ? 'owner (a span holds only spans and voices)' : 'owner',
            disabled: spanned,
          },
          {
            value: 'span',
            label: holdsOwner ? 'span (a span cannot hold an owner)' : 'span',
            disabled: holdsOwner,
          },
        ]}
        onChange={(kind) => row.setValue(kind)}
      />
    </Row>
  );
}

/** The panel's schema for a group of `kind`, whose doc comments come from its own spec type. */
function schemaOf(kind: Group['kind']) {
  const doc = (member: string) => docOf(`${kind === 'span' ? 'SpanSpec' : 'OwnerSpec'}.${member}`);
  const d = (member: string) => doc(member) ?? '';
  const shared = sharedNodes(doc);
  return specSchema({
    name: shared.name,
    kind: f.enum(kind, ['owner', 'span']).render(kindRow),
    errors: f.label('group errors').render(looseErrorsRow(LOOSE)),
    // Under a span, which places it, a group has no start of its own.
    start: shared.start.section('timing').showIf(unspanned),
    // An owner runs back below 0, and its members with it; a span lays them out forward only.
    rate: f
      .number(1)
      .range(kind === 'owner' ? -4 : 0, 4)
      .step(0.05)
      .describe(d('rate'))
      .section('timing'),
    seek: shared.seek.section('timing').render(
      optionalNumber({
        placeholder: '0',
        hint: ({ x }) => `ms its clock starts at${x.rate < 0 ? ', running back to 0' : ''}`,
        step: 10,
      }),
    ),
    fadeIn: shared.fadeIn.section('fade'),
    fadeOut: shared.fadeOut.section('fade'),
    fadeEase: shared.fadeEase.section('fade'),
    freeze: shared.freeze.section('blending'),
    weight: f
      .custom<number | Expr>('weight', 1)
      .label('weight')
      .describe(d('weight'))
      .section('blending')
      .render(weightRow),
    faults: f.label('faults').section('blending').render(faultsRow),
    owner: f.string('').describe(d('owner')).section('placement').render(ownerRow),
    anchor: f
      .custom<Placement | undefined>('anchor', undefined)
      .label('anchor')
      .describe(d('anchor'))
      .section('placement')
      .showIf(unspanned)
      .render(anchorRow),
    hints: hintsGroup(spanned).section('placement'),
    ...(kind === 'span' ? { span: spanGroup.section('span') } : {}),
    ...Object.fromEntries(
      Object.entries(marksNodes(false, doc)).map(([k, n]) => [k, n.section('tags and marks')]),
    ),
    delete: f
      .action(() => {})
      .label('delete group')
      .section('tags and marks')
      .render(deleteRow('delete group')),
  });
}
const SCHEMAS = { owner: schemaOf('owner'), span: schemaOf('span') };

/** The panel's values for `g`. */
const configOf = (g: Group, spanned: boolean) => ({
  ...sharedConfig(g),
  kind: g.kind,
  weight: g.weight,
  owner: g.owner ?? '',
  anchor: g.anchor,
  hints: hintsConfig(g.hints),
  span: spanConfig(g.span ?? {}),
  ...marksConfig(g),
  spanned,
});

/** One edited row, written back into the group it came from. */
function written(g: Group, path: string, value: unknown): Group {
  const shared = writtenShared(g, path, value) ?? writtenMarks(g, path, value);
  if (shared) return shared;
  if (path.startsWith('hints.'))
    return withKey(g, 'hints', writtenHints(g.hints, path.slice('hints.'.length), value));
  if (path.startsWith('span.'))
    return { ...g, span: writtenSpan(g.span ?? {}, path.slice('span.'.length), value) };
  switch (path) {
    case 'kind':
      return { ...g, kind: value as Group['kind'] };
    case 'weight':
      return { ...g, weight: value as number | Expr };
    case 'anchor':
      return withKey(g, 'anchor', value as Placement | undefined);
    default:
      return g;
  }
}

export interface GroupPanelProps {
  group: Group;
  comp: Composition;
  /** Under a span, which places it: no start or anchor of its own, and hints for the span's fit. */
  spanned: boolean;
  errors: FieldError[];
  /** Faults by voice or group id, and by `fitFaultKey` for each code fit step. */
  faultsOf(key: string): Faults | undefined;
  /** For a running span, how it last fitted its children. */
  result: FitResult | undefined;
  onChange(g: Group): void;
  onJoin(owner: string | null): void;
  onDelete(): void;
}

export function GroupPanel(p: GroupPanelProps) {
  const { group: g, spanned } = p;
  const write = (path: string, value: unknown) => {
    if (path === 'owner') p.onJoin((value as string) || null);
    else p.onChange(written(g, path, value));
  };
  return (
    <section className={s.panel} aria-label={`group ${g.name}`}>
      <SpecProvider
        value={{
          x: g,
          comp: p.comp,
          spanned,
          errors: p.errors,
          faultsOf: p.faultsOf,
          result: p.result,
          onDelete: p.onDelete,
        }}
      >
        <ControlPanel
          title={`${g.kind} · ${g.name}`}
          schema={SCHEMAS[g.kind]}
          config={configOf(g, spanned)}
          setConfig={write}
          errors={rowErrors(p.errors, g.id, ROWED)}
        />
      </SpecProvider>
    </section>
  );
}
