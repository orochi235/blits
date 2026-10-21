import type { Hints } from '@pg/blits/composition';
import { withKey } from '@pg/blits/keyed';
import { f } from '@weasel-js/labkit';
import { docOf } from './docs';

const d = (key: keyof Hints) => docOf(`SpanHints.${key}`) ?? '';
const factor = (key: 'faster' | 'slower') => f.number(1).step(0.05).describe(d(key));

/** How a voice or group under a span may give way, blits' `SpanHints`, at `hints.<key>`. */
export const hintsGroup = (spanned: (c: Record<string, unknown>) => boolean) =>
  f
    .group({
      faster: factor('faster'),
      slower: factor('slower'),
      overlap: f.boolean(false).describe(d('overlap')),
      ballast: f.boolean(false).describe(d('ballast')),
      priority: f
        .enum('', [
          { value: '', label: 'default (weak)' },
          { value: 'weak', label: 'weak' },
          { value: 'strong', label: 'strong' },
          { value: 'required', label: 'required' },
        ])
        .describe(d('priority')),
    })
    .label('hints')
    .showIf(spanned);

/** The hint rows' values. */
export const hintsConfig = (h: Hints | undefined) => ({
  faster: h?.faster ?? 1,
  slower: h?.slower ?? 1,
  overlap: h?.overlap === true,
  ballast: h?.ballast === true,
  priority: h?.priority ?? '',
});

/** `hints` with the row at `hints.<key>` written, or undefined once nothing is left set. */
export function writtenHints(h: Hints | undefined, key: string, value: unknown): Hints | undefined {
  const at = <K extends keyof Hints>(k: K, v: Hints[K] | undefined) => withKey(h ?? {}, k, v);
  let next: Hints;
  switch (key) {
    case 'faster':
    case 'slower': {
      const n = value as number;
      if (!Number.isFinite(n)) return h;
      next = at(key, n <= 1 ? undefined : n);
      break;
    }
    case 'overlap':
    case 'ballast':
      next = at(key, value === true || undefined);
      break;
    case 'priority':
      next = at('priority', (value || undefined) as Hints['priority']);
      break;
    default:
      return h;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}
