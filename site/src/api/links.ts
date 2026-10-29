import { type Entry, entries } from './entries';

const byName = new Map(entries.map((e) => [e.name, e]));

/** What a code span names, if it names an export: `Mix`, `cue()`, `Mix.cue`, or `mix.cue` for an instance. */
export function resolve(code: string): { entry: Entry; anchor: string } | undefined {
  const text = code.trim().replace(/\(.*\)$/, '');
  const whole = byName.get(text);
  if (whole) return { entry: whole, anchor: `api-${whole.name}` };
  const dotted = /^(\w+)\.(\w+)$/.exec(text);
  if (!dotted) return undefined;
  const [, owner = '', key] = dotted;
  for (const name of [owner, owner[0]?.toUpperCase() + owner.slice(1)]) {
    const entry = byName.get(name);
    if (entry?.members.some((m) => m.key === key))
      return { entry, anchor: `api-${entry.name}.${key}` };
  }
  return undefined;
}

/**
 * Where a code span or type name links: its entry on this page, or on the page that files it. `here`
 * is `reference`, a word's slug, or empty on a page with no entries. `self` is the anchor being
 * described, which never links to itself.
 */
export function hrefFor(
  code: string,
  here: string,
  base: string,
  self?: string,
): string | undefined {
  const hit = resolve(code);
  if (!hit || hit.anchor === self) return undefined;
  const local = here === 'reference' || here === hit.entry.word;
  return local ? `#${hit.anchor}` : `${base}${hit.entry.word}/#${hit.anchor}`;
}
