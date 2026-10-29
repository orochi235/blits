import {
  exported,
  type Node,
  type Param,
  type Signature,
  type Type,
  type TypeParam,
} from './typedoc';

/** A run of signature text, kinded so the page can color it and link the names that have entries. */
export interface Tok {
  kind: 'kw' | 'name' | 'type' | 'ref' | 'lit' | 'param' | 'punct';
  text: string;
}

/** Past this many characters a signature puts each parameter, or each union arm, on its own line. */
const WIDE = 72;

export const tok = (kind: Tok['kind'], text: string): Tok => ({ kind, text });
const p = (text: string): Tok => tok('punct', text);

export const width = (ts: Tok[]): number => ts.reduce((n, t) => n + t.text.length, 0);

export function join(parts: Tok[][], sep: string): Tok[] {
  return parts.flatMap((part, i) => (i ? [p(sep), ...part] : part));
}

/** Prints a TypeDoc type back as TypeScript, closely enough to read. */
export function type(t: Type | undefined): Tok[] {
  if (!t) return [tok('type', 'unknown')];
  switch (t.type) {
    case 'intrinsic':
      return [tok('type', t.name ?? 'unknown')];
    case 'reference': {
      const name = t.name ?? '?';
      const args = t.typeArguments?.length
        ? [p('<'), ...join(t.typeArguments.map(type), ', '), p('>')]
        : [];
      return [tok(exported.has(name) ? 'ref' : 'type', name), ...args];
    }
    case 'union':
      return join((t.types ?? []).map(type), ' | ');
    case 'intersection':
      return join((t.types ?? []).map(type), ' & ');
    case 'array': {
      const inner = type(t.elementType);
      const bare =
        t.elementType?.type === 'union' ||
        t.elementType?.type === 'intersection' ||
        t.elementType?.type === 'reflection';
      return bare ? [p('('), ...inner, p(')[]')] : [...inner, p('[]')];
    }
    case 'literal':
      return [tok('lit', typeof t.value === 'string' ? `'${t.value}'` : String(t.value))];
    case 'tuple':
      return [p('['), ...join((t.elements ?? []).map(type), ', '), p(']')];
    case 'namedTupleMember':
      return [tok('param', `${t.name}${t.isOptional ? '?' : ''}`), p(': '), ...type(t.element)];
    case 'typeOperator':
      return [tok('kw', t.operator ?? ''), p(' '), ...type(t.target as Type)];
    case 'indexedAccess':
      return [...type(t.objectType), p('['), ...type(t.indexType), p(']')];
    case 'reflection':
      return t.declaration ? object(t.declaration) : [p('{}')];
    case 'mapped':
      return [
        p(`{ ${t.readonlyModifier === '+' ? 'readonly ' : ''}[`),
        tok('param', t.parameter ?? ''),
        p(' in '),
        ...type(t.parameterType),
        p(`]${t.optionalModifier === '-' ? '-?' : ''}: `),
        ...type(t.templateType),
        p(' }'),
      ];
    case 'query':
      return [tok('kw', 'typeof'), p(' '), ...type(t.target as Type)];
    default:
      return [tok('type', t.name ?? t.type)];
  }
}

function object(d: Node): Tok[] {
  if (d.signatures?.length && !d.children?.length) return arrow(d.signatures[0] as Signature);
  const fields = (d.children ?? []).map((c) => {
    const ro = c.flags?.isReadonly ? 'readonly ' : '';
    const opt = c.flags?.isOptional ? '?' : '';
    if (c.signatures?.length) return [tok('param', c.name), ...call(c.signatures[0] as Signature)];
    return [p(ro), tok('param', `${c.name}${opt}`), p(': '), ...type(c.type)];
  });
  const calls = (d.signatures ?? []).map(call);
  return [p('{ '), ...join([...calls, ...fields], '; '), p(' }')];
}

export function generics(tp: TypeParam[] | undefined): Tok[] {
  if (!tp?.length) return [];
  const each = tp.map((t) => [
    tok('type', t.name),
    ...(t.type ? [p(' '), tok('kw', 'extends'), p(' '), ...type(t.type)] : []),
  ]);
  return [p('<'), ...join(each, ', '), p('>')];
}

function param(x: Param): Tok[] {
  const opt = x.flags?.isOptional || x.defaultValue ? '?' : '';
  return [
    p(x.flags?.isRest ? '...' : ''),
    tok('param', `${x.name}${opt}`),
    p(': '),
    ...type(x.type),
  ];
}

/** `<T>(a: A, b: B)`, broken one parameter per line when `lead` plus the flat form runs wide. */
function head(s: Signature, lead = 0): Tok[] {
  const ps = (s.parameters ?? []).map(param);
  const flat = [...generics(s.typeParameters), p('('), ...join(ps, ', '), p(')')];
  if (ps.length < 2 || lead + width(flat) + width(type(s.type)) <= WIDE) return flat;
  return [...generics(s.typeParameters), p('(\n  '), ...join(ps, ',\n  '), p(',\n)')];
}

/** A method's call shape: `(a: A): R`. */
export function call(s: Signature, lead = 0): Tok[] {
  return [...head(s, lead), p(': '), ...type(s.type)];
}

/** A function type: `(a: A) => R`. */
export function arrow(s: Signature): Tok[] {
  return [...head(s), p(' => '), ...type(s.type)];
}

/** A type alias's body, one union arm per line when it runs wide. */
export function body(t: Type | undefined, lead: number): Tok[] {
  const flat = type(t);
  if (t?.type !== 'union' || lead + width(flat) <= WIDE) return flat;
  return (t.types ?? []).flatMap((arm) => [p('\n  | '), ...type(arm)]);
}
