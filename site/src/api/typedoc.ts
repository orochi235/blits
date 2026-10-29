import api from '../../.generated/api.json';

/** TypeDoc's JSON, typed only as far as the reference reads it. */
export interface Part {
  kind: string;
  text: string;
}
export interface Comment {
  summary?: Part[];
  blockTags?: { tag: string; content: Part[] }[];
}
export interface Type {
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
export interface TypeParam {
  name: string;
  type?: Type;
}
export interface Param {
  name: string;
  type?: Type;
  comment?: Comment;
  flags?: { isOptional?: boolean; isRest?: boolean };
  defaultValue?: string;
}
export interface Signature {
  name: string;
  comment?: Comment;
  parameters?: Param[];
  type?: Type;
  typeParameters?: TypeParam[];
}
export interface Node {
  name: string;
  kind: number;
  flags?: { isOptional?: boolean; isReadonly?: boolean };
  comment?: Comment;
  children?: Node[];
  signatures?: Signature[];
  indexSignatures?: Signature[];
  type?: Type;
  typeParameters?: TypeParam[];
  extendedTypes?: Type[];
  inheritedFrom?: unknown;
}

export const KIND: Record<number, string> = {
  32: 'const',
  64: 'function',
  128: 'class',
  256: 'interface',
  1024: 'property',
  2048: 'method',
  262144: 'accessor',
  2097152: 'type',
};

export const CONSTRUCTOR = 512;

export const exports: Node[] = (api as unknown as Node).children ?? [];

/** Every exported name, so a printed type can tell which of its names have an entry to link to. */
export const exported = new Set(exports.map((n) => n.name));
