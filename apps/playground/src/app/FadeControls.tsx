import type { FadeOptions } from '@msb235/blits';
import type { Subject } from '@pg/blits/stage';
import { f } from '@weasel-js/labkit';
import { docOf } from './docs';

type When = 'now' | 'rest' | 'at';

/** What the fade rows hold, under `fade` in the live panel's config. */
export interface FadeConfig {
  over: number;
  one: boolean;
  when: When;
  at: number;
  deadline: number;
}

export const FADE: FadeConfig = { over: 300, one: false, when: 'now', at: 0, deadline: 1000 };

/** The fade rows left auto at the start, which leave blits' default for the option. */
export const FADE_AUTO = ['fade.over', 'fade.deadline'];

const BLITS_DEFAULT = "Click the label to leave it auto, which is blits' default.";
/** A fade option's blits doc comment, then `note`. */
const described = (key: string, note = '') =>
  [docOf(`FadeOptions.${key}`), note].filter(Boolean).join(' ');

export interface FadeNodesProps {
  /** An owner fades as a whole: neither by subject nor at rest. */
  whole: boolean;
  /** Whether a subject is picked on the stage, which a fade can take out of the voice alone. */
  picked: boolean;
  onFade(): void;
  onRise(): void;
}

/** `handle.fade` with every option it takes, and `rise` to turn a fade back, as a group of live panel rows. */
export function fadeNodes({ whole, picked, onFade, onRise }: FadeNodesProps) {
  // An empty `all` holds: a whole owner has no `one` row to read.
  const many = whole ? { all: [] } : { path: 'fade.one', is: false };
  return f
    .group({
      over: f
        .number(FADE.over)
        .label('over')
        .range(0, 1e6)
        .input()
        .step(50)
        .suffix('ms')
        .describe(described('over', BLITS_DEFAULT)),
      ...(whole
        ? {}
        : {
            one: f
              .boolean(false)
              .label('only the picked subject')
              .describe(described('subject'))
              .manual()
              .enableIf(() => picked),
          }),
      when: f
        .enum<When>('now', [
          { value: 'now', label: 'now' },
          ...(whole ? [] : [{ value: 'rest', label: 'at rest, per subject' }]),
          { value: 'at', label: 'at mix time' },
        ])
        .label('when')
        .describe(described('at'))
        .manual()
        .showIf(many),
      at: f
        .number(FADE.at)
        .label('at')
        .manual()
        .range(0, 1e9)
        .input()
        .step(50)
        .suffix('ms')
        .showIf({ all: [many, { path: 'fade.when', is: 'at' }] }),
      ...(whole
        ? {}
        : {
            deadline: f
              .number(FADE.deadline)
              .label('deadline')
              .range(0, 1e9)
              .input()
              .step(50)
              .suffix('ms')
              .describe(described('deadline', BLITS_DEFAULT))
              .showIf({ all: [many, { path: 'fade.when', is: 'rest' }] }),
          }),
      act: f
        .group({
          fade: f
            .action(onFade)
            .label('fade')
            .describe(docOf('Handle.fade') ?? ''),
          rise: f
            .action(onRise)
            .label('rise')
            .describe(docOf('Handle.rise') ?? ''),
        })
        .as('bar'),
    })
    .label('fade')
    .section('fade', { pack: 'one-up' });
}

/** The options `handle.fade` takes from the rows; an auto row leaves its option out. */
export function fadeOptions(
  c: FadeConfig,
  auto: ReadonlySet<string>,
  subject: Subject | undefined,
): FadeOptions<Subject> {
  const over = auto.has('fade.over') ? {} : { over: c.over };
  if (c.one && subject !== undefined) return { subject, ...over };
  return {
    ...over,
    ...(c.when === 'rest' ? { at: 'rest' as const } : {}),
    ...(c.when === 'at' ? { at: c.at } : {}),
    ...(c.when === 'rest' && !auto.has('fade.deadline') ? { deadline: c.deadline } : {}),
  };
}

/** The options `handle.rise` takes: only `over`. */
export const riseOptions = (c: FadeConfig, auto: ReadonlySet<string>) =>
  auto.has('fade.over') ? {} : { over: c.over };
