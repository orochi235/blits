import api from '../.generated/api.json';
import { words } from './nav';

/** TypeDoc's JSON, typed only as far as the reference reads it. */
interface Part {
  kind: string;
  text: string;
}
interface Comment {
  summary?: Part[];
  blockTags?: { tag: string; content: Part[] }[];
}
interface Type {
  type: string;
  name?: string;
  value?: unknown;
  types?: Type[];
  elements?: Type[];
  elementType?: Type;
  target?: Type | number | { qualifiedName?: string };
  typeArguments?: Type[];
  operator?: string;
  declaration?: Node;
  objectType?: Type;
  indexType?: Type;
  element?: Type;
  isOptional?: boolean;
  parameter?: string;
  parameterType?: Type;
  templateType?: Type;
  readonlyModifier?: string;
  optionalModifier?: string;
}
interface Param {
  name: string;
  type?: Type;
  flags?: { isOptional?: boolean; isRest?: boolean };
  defaultValue?: string;
}
interface Signature {
  name: string;
  comment?: Comment;
  parameters?: Param[];
  type?: Type;
  typeParameters?: { name: string }[];
}
interface Node {
  name: string;
  kind: number;
  flags?: { isOptional?: boolean; isReadonly?: boolean };
  comment?: Comment;
  children?: Node[];
  signatures?: Signature[];
  indexSignatures?: Signature[];
  type?: Type;
  typeParameters?: { name: string }[];
}

const KIND: Record<number, string> = {
  32: 'const',
  64: 'function',
  256: 'interface',
  1024: 'property',
  2048: 'method',
  262144: 'accessor',
  2097152: 'type',
};

export interface Member {
  name: string;
  signature: string;
  summary: Part[];
}

export interface Entry {
  name: string;
  kind: string;
  word: string;
  signature: string;
  summary: Part[];
  members: Member[];
}

function params(ps: Param[] | undefined): string {
  return (ps ?? [])
    .map(
      (p) =>
        `${p.flags?.isRest ? '...' : ''}${p.name}${p.flags?.isOptional || p.defaultValue ? '?' : ''}: ${show(p.type)}`,
    )
    .join(', ');
}

function generics(tp: { name: string }[] | undefined): string {
  return tp?.length ? `<${tp.map((t) => t.name).join(', ')}>` : '';
}

function signature(s: Signature, arrow = false): string {
  const head = `${generics(s.typeParameters)}(${params(s.parameters)})`;
  return arrow ? `${head} => ${show(s.type)}` : `${head}: ${show(s.type)}`;
}

function objectType(d: Node): string {
  if (d.signatures?.length && !d.children?.length)
    return signature(d.signatures[0] as Signature, true);
  const fields = (d.children ?? []).map((c) => {
    const ro = c.flags?.isReadonly ? 'readonly ' : '';
    const opt = c.flags?.isOptional ? '?' : '';
    if (c.signatures?.length) return `${c.name}${signature(c.signatures[0] as Signature)}`;
    return `${ro}${c.name}${opt}: ${show(c.type)}`;
  });
  const calls = (d.signatures ?? []).map((s) => signature(s));
  return `{ ${[...calls, ...fields].join('; ')} }`;
}

/** Prints a TypeDoc type back as TypeScript, closely enough to read. */
export function show(t: Type | undefined): string {
  if (!t) return 'unknown';
  switch (t.type) {
    case 'intrinsic':
      return t.name ?? 'unknown';
    case 'reference':
      return `${t.name}${t.typeArguments?.length ? `<${t.typeArguments.map(show).join(', ')}>` : ''}`;
    case 'union':
      return (t.types ?? []).map(show).join(' | ');
    case 'intersection':
      return (t.types ?? []).map(show).join(' & ');
    case 'array': {
      const inner = show(t.elementType);
      return /[|&( ]/.test(inner) ? `(${inner})[]` : `${inner}[]`;
    }
    case 'literal':
      return typeof t.value === 'string' ? `'${t.value}'` : String(t.value);
    case 'tuple':
      return `[${(t.elements ?? []).map(show).join(', ')}]`;
    case 'namedTupleMember':
      return `${t.name}${t.isOptional ? '?' : ''}: ${show(t.element)}`;
    case 'typeOperator':
      return `${t.operator} ${show(t.target as Type)}`;
    case 'indexedAccess':
      return `${show(t.objectType)}[${show(t.indexType)}]`;
    case 'reflection':
      return t.declaration ? objectType(t.declaration) : '{}';
    case 'mapped':
      return `{ ${t.readonlyModifier === '+' ? 'readonly ' : ''}[${t.parameter} in ${show(t.parameterType)}]${t.optionalModifier === '-' ? '-?' : ''}: ${show(t.templateType)} }`;
    case 'query':
      return `typeof ${show(t.target as Type)}`;
    default:
      return t.name ?? t.type;
  }
}

function wordOf(c: Comment | undefined): string | undefined {
  const tag = c?.blockTags?.find((b) => b.tag === '@category');
  return tag?.content
    .map((p) => p.text)
    .join('')
    .trim();
}

function member(c: Node): Member {
  const sig = c.signatures?.[0];
  const opt = c.flags?.isOptional ? '?' : '';
  const ro = c.flags?.isReadonly ? 'readonly ' : '';
  return {
    name: c.name,
    signature: sig ? `${c.name}${signature(sig)}` : `${ro}${c.name}${opt}: ${show(c.type)}`,
    summary: sig?.comment?.summary ?? c.comment?.summary ?? [],
  };
}

function entry(n: Node): Entry {
  const kind = KIND[n.kind] ?? 'export';
  const sig = n.signatures?.[0];
  const comment = sig?.comment ?? n.comment;
  const word = wordOf(n.comment) ?? wordOf(sig?.comment);
  if (!word) throw new Error(`site: ${n.name} has no @category, so the reference cannot file it`);
  if (!words.some((w) => w.slug === word))
    throw new Error(`site: ${n.name} is filed under ${word}, which is not a page`);
  let signatureText: string;
  if (kind === 'function' && sig) signatureText = `function ${n.name}${signature(sig)}`;
  else if (kind === 'type')
    signatureText = `type ${n.name}${generics(n.typeParameters)} = ${show(n.type)}`;
  else if (kind === 'const') signatureText = `const ${n.name}: ${show(n.type)}`;
  else signatureText = `interface ${n.name}${generics(n.typeParameters)}`;
  const members = kind === 'interface' ? (n.children ?? []).map(member) : [];
  return {
    name: n.name,
    kind,
    word,
    signature: signatureText,
    summary: comment?.summary ?? [],
    members,
  };
}

export const entries: Entry[] = ((api as unknown as Node).children ?? [])
  .map(entry)
  .sort((a, b) => a.name.localeCompare(b.name));

export const entriesFor = (word: string): Entry[] => entries.filter((e) => e.word === word);
