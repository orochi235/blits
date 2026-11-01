import { type Entry, entries } from './entries';

const byName = new Map(entries.map((e) => [e.name, e]));

/** Each method name, mapped to the entries that have one by that name. */
const methods = new Map<string, Entry[]>();
for (const e of entries)
  for (const m of e.members)
    if (m.method && m.key) methods.set(m.key, [...(methods.get(m.key) ?? []), e]);

const member = (entry: Entry, key: string) =>
  entry.members.some((m) => m.key === key)
    ? { entry, anchor: `api-${entry.name}.${key}` }
    : undefined;

/**
 * What a code span names, if it names an export: `Mix`, `cue()`, `Mix.cue`, or `mix.cue` for an
 * instance. A bare member name resolves against `owner`, the entry whose doc it appears in, then
 * as a method only one entry has, or `Mix`'s where several do. A bare field name never resolves
 * outside its owner: `x` or `end` is too common a word to guess at.
 */
export function resolve(
  code: string,
  owner?: string,
): { entry: Entry; anchor: string } | undefined {
  const text = code.trim().replace(/\(.*\)$/, '');
  const whole = byName.get(text);
  if (whole) return { entry: whole, anchor: `api-${whole.name}` };
  if (/^\w+$/.test(text)) {
    const own = owner ? byName.get(owner) : undefined;
    const hit = own && member(own, text);
    if (hit) return hit;
    const has = methods.get(text) ?? [];
    const one = has.length === 1 ? has[0] : has.find((e) => e.name === 'Mix');
    return one && member(one, text);
  }
  const dotted = /^(\w+)\.(\w+)$/.exec(text);
  if (!dotted) return undefined;
  const [, name = '', key = ''] = dotted;
  for (const n of [name, name[0]?.toUpperCase() + name.slice(1)]) {
    const entry = byName.get(n);
    const hit = entry && member(entry, key);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Where a code span or type name links: its entry on this page, or on the page that files it. `here`
 * is `reference`, a word's slug, or empty on a page with no entries. `self` is the anchor being
 * described, which never links to itself, and whose entry a bare member name resolves against.
 */
export function hrefFor(
  code: string,
  here: string,
  base: string,
  self?: string,
): string | undefined {
  const owner = self && /^api-(\w+)/.exec(self)?.[1];
  const hit = resolve(code, owner || undefined);
  if (!hit || hit.anchor === self) return undefined;
  const local = here === 'reference' || here === hit.entry.word;
  return local ? `#${hit.anchor}` : `${base}${hit.entry.word}/#${hit.anchor}`;
}
