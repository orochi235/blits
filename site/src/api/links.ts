import { type Entry, entries } from './entries';
import { exports } from './typedoc';

const byName = new Map(entries.map((e) => [e.name, e]));

/** Each export's reflection id, and each of its members', mapped to the entry and anchor it links to. */
const byId = new Map<number, { entry: Entry; anchor: string }>();
for (const n of exports) {
  const entry = byName.get(n.name);
  if (!entry) continue;
  byId.set(n.id, { entry, anchor: `api-${entry.name}` });
  for (const c of n.children ?? [])
    if (entry.members.some((m) => m.key === c.name))
      byId.set(c.id, { entry, anchor: `api-${entry.name}.${c.name}` });
}
// TypeDoc may resolve `Glide.push` to the copy Glide inherits, which has no row; link the original.
for (const n of exports)
  for (const c of n.children ?? []) {
    const from = c.inheritedFrom?.target;
    const hit = from === undefined || byId.has(c.id) ? undefined : byId.get(from);
    if (hit) byId.set(c.id, hit);
  }

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
 * as a method only one entry has. Anything else takes an explicit link: `{@link Mix.seek | seek}`
 * in a doc comment, ``[`seek`](Mix.seek)`` on a page.
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
    return has.length === 1 && has[0] ? member(has[0], text) : undefined;
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

/** What a link names when its target is an export, `Mix`, or one of its members, `Mix.seek`. */
export function target(name: string): { entry: Entry; anchor: string } | undefined {
  const [owner = '', key] = name.split('.');
  const entry = byName.get(owner);
  if (!entry || name.split('.').length > 2) return undefined;
  return key === undefined ? { entry, anchor: `api-${owner}` } : member(entry, key);
}

/** Where a hit links from page `here`: its entry on this page, or on the page that files it. */
function href(hit: { entry: Entry; anchor: string }, here: string, base: string): string {
  const local = here === 'reference' || here === hit.entry.word;
  return local ? `#${hit.anchor}` : `${base}${hit.entry.word}/#${hit.anchor}`;
}

/** Where a `{@link}` in a doc comment links, by its target's reflection id; a URL target is its own. */
export function hrefForLink(to: number | string, here: string, base: string): string {
  if (typeof to === 'string') return to;
  const hit = byId.get(to);
  if (!hit) throw new Error(`a {@link} targets reflection ${to}, which has no entry to link to`);
  return href(hit, here, base);
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
  return href(hit, here, base);
}
