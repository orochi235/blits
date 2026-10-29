import { words } from '../nav';
import { arrow, body, call, generics, join, type Tok, tok, type as typeOf, width } from './print';
import {
  CONSTRUCTOR,
  type Comment,
  exports,
  KIND,
  type Node,
  type Part,
  type Signature,
} from './typedoc';

/** A doc comment split for display: the first sentence, then the rest as paragraphs behind "more". */
export interface Doc {
  lead: Part[];
  rest: Part[][];
}

/** One row of a field or parameter table. */
export interface Row {
  name: string;
  type: Tok[];
  doc: Doc;
  deprecated: boolean;
}

export interface Entry {
  name: string;
  kind: string;
  word: string;
  signature: Tok[];
  doc: Doc;
  deprecated: boolean;
  members: Row[];
  params: Row[];
}

/** Breaks parts into paragraphs at blank lines, keeping code spans whole. */
function paragraphs(parts: Part[]): Part[][] {
  const out: Part[][] = [[]];
  for (const part of parts) {
    if (part.kind !== 'text') {
      out[out.length - 1]?.push(part);
      continue;
    }
    part.text.split(/\n{2,}/).forEach((text, i) => {
      if (i) out.push([]);
      if (text) out[out.length - 1]?.push({ kind: 'text', text });
    });
  }
  return out.filter((para) => para.some((x) => x.text.trim()));
}

/** Splits at the end of the first sentence: a period, question or exclamation mark before a space. */
export function split(parts: Part[]): Doc {
  const [first = [], ...later] = paragraphs(parts);
  for (const [i, part] of first.entries()) {
    if (part.kind !== 'text') continue;
    const end = /[.!?](?=\s)/.exec(part.text);
    if (!end) continue;
    const cut = end.index + 1;
    const lead = [...first.slice(0, i), { kind: 'text', text: part.text.slice(0, cut) }];
    const tail = [{ kind: 'text', text: part.text.slice(cut).trimStart() }, ...first.slice(i + 1)];
    const rest = tail.some((x) => x.text.trim()) ? [tail, ...later] : later;
    return { lead, rest };
  }
  return { lead: first, rest: later };
}

const deprecated = (c: Comment | undefined) => !!c?.blockTags?.some((b) => b.tag === '@deprecated');

function wordOf(c: Comment | undefined): string | undefined {
  const tag = c?.blockTags?.find((b) => b.tag === '@category');
  return tag?.content
    .map((p) => p.text)
    .join('')
    .trim();
}

function member(c: Node): Row {
  const sig = c.signatures?.[0];
  const comment = sig?.comment ?? c.comment;
  return {
    name: `${c.flags?.isReadonly ? 'readonly ' : ''}${c.name}${c.flags?.isOptional ? '?' : ''}`,
    type: sig ? arrow(sig) : typeOf(c.type),
    doc: split(comment?.summary ?? []),
    deprecated: deprecated(comment),
  };
}

/** A function's parameters worth a table: those with their own doc, and the fields of any inline object. */
function params(sig: Signature): Row[] {
  return (sig.parameters ?? []).flatMap((x): Row[] => {
    const fields = x.type?.type === 'reflection' ? (x.type.declaration?.children ?? []) : [];
    if (fields.length)
      return fields.map((f) => ({ ...member(f), name: `${x.name}.${member(f).name}` }));
    if (!x.comment) return [];
    const opt = x.flags?.isOptional || x.defaultValue ? '?' : '';
    return [
      {
        name: `${x.name}${opt}`,
        type: typeOf(x.type),
        doc: split(x.comment.summary ?? []),
        deprecated: false,
      },
    ];
  });
}

function signature(n: Node, kind: string): Tok[] {
  const sig = n.signatures?.[0];
  const intro = (kw: string) => [tok('kw', kw), tok('punct', ' '), tok('name', n.name)];
  if (kind === 'function' && sig) {
    const lead = intro('function');
    return [...lead, ...call(sig, width(lead))];
  }
  if (kind === 'type') {
    const lead = [...intro('type'), ...generics(n.typeParameters), tok('punct', ' = ')];
    return [...lead, ...body(n.type, width(lead))];
  }
  if (kind === 'const') return [...intro('const'), tok('punct', ': '), ...typeOf(n.type)];
  const ext = n.extendedTypes?.length
    ? [
        tok('punct', ' '),
        tok('kw', 'extends'),
        tok('punct', ' '),
        ...join(n.extendedTypes.map(typeOf), ', '),
      ]
    : [];
  return [
    ...intro(kind === 'class' ? 'class' : 'interface'),
    ...generics(n.typeParameters),
    ...ext,
  ];
}

function entry(n: Node): Entry {
  const kind = KIND[n.kind] ?? 'export';
  const sig = n.signatures?.[0];
  const comment = sig?.comment ?? n.comment;
  const word = wordOf(n.comment) ?? wordOf(sig?.comment);
  if (!word) throw new Error(`site: ${n.name} has no @category, so the reference cannot file it`);
  if (!words.some((w) => w.slug === word))
    throw new Error(`site: ${n.name} is filed under ${word}, which is not a page`);
  const hasMembers = kind === 'interface' || kind === 'class';
  return {
    name: n.name,
    kind,
    word,
    signature: signature(n, kind),
    doc: split(comment?.summary ?? []),
    deprecated: deprecated(comment),
    members: hasMembers
      ? (n.children ?? []).filter((c) => c.kind !== CONSTRUCTOR && !c.inheritedFrom).map(member)
      : [],
    params: kind === 'function' && sig ? params(sig) : [],
  };
}

export const entries: Entry[] = exports.map(entry).sort((a, b) => a.name.localeCompare(b.name));

export const entriesFor = (word: string): Entry[] => entries.filter((e) => e.word === word);

const byName = new Map(entries.map((e) => [e.name, e]));

/** Where a linked type name points: its entry on this page, or on the page that files it. */
export function hrefFor(name: string, here: string, base: string): string | undefined {
  const e = byName.get(name);
  if (!e) return undefined;
  return here === 'reference' || here === e.word ? `#api-${name}` : `${base}${e.word}/#api-${name}`;
}
