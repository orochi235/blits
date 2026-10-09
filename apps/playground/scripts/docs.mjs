// Pulls the doc comments of VoiceSpec, Handle and MixOptions members out of blits' types for field tooltips.
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
for (const name of ['VoiceSpec', 'Handle', 'MixOptions']) {
  const decl = project?.getChildByName(name);
  for (const child of decl?.children ?? []) {
    const text = textOf(child.comment) ?? textOf(child.signatures?.[0]?.comment);
    if (text) out[`${name}.${child.name}`] = text;
  }
}
const dir = new URL('../src/generated/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('docs.json', dir), `${JSON.stringify(out, null, 2)}\n`);
console.log(`docs: ${Object.keys(out).length} fields`);
