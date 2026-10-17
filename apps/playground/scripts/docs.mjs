// Pulls the doc comments of blits' option and spec members out of its types for field tooltips:
// interfaces by member, a union's members by name, and a motion patch's options by `spring.stiffness`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Application } from 'typedoc';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const app = await Application.bootstrap({
  entryPoints: [`${root}src/index.ts`],
  tsconfig: `${root}tsconfig.json`,
  excludePrivate: true,
  logLevel: 'Warn',
});
const project = await app.convert();
const textOf = (comment) =>
  comment?.summary
    ?.map((part) => part.text)
    .join('')
    .trim();
const out = {};
/** An object type's members, through unions and intersections. */
const membersIn = (type) =>
  type?.type === 'reflection'
    ? (type.declaration.children ?? [])
    : type?.type === 'union' || type?.type === 'intersection'
      ? type.types.flatMap(membersIn)
      : type?.type === 'reference'
        ? (type.reflection?.children ?? [])
        : [];
/** A declaration's members: an interface's own, a type alias's object types', a function's options'. */
const membersOf = (decl) => {
  if (decl === undefined) return [];
  if (decl.children) return decl.children;
  if (decl.type) return membersIn(decl.type);
  const params = decl.signatures?.[0]?.parameters ?? [];
  return params.flatMap((p) => membersIn(p.type));
};
for (const name of [
  'VoiceSpec',
  'Handle',
  'Mix',
  'MixOptions',
  'BookOptions',
  'SpanHints',
  'OwnerSpec',
  'SpanSpec',
  'FitResult',
  'KeysOptions',
  'WaveOptions',
  'SeekOptions',
  'FadeOptions',
  'spring',
  'glide',
  'tween',
]) {
  const decl = project?.getChildByName(name);
  for (const child of membersOf(decl)) {
    const key = `${name}.${child.name}`;
    const text = textOf(child.comment) ?? textOf(child.signatures?.[0]?.comment);
    if (text && !(key in out)) out[key] = text;
  }
}
const dir = new URL('../src/generated/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('docs.json', dir), `${JSON.stringify(out, null, 2)}\n`);
console.log(`docs: ${Object.keys(out).length} fields`);
