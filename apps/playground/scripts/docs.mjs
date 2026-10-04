import { mkdirSync, writeFileSync } from 'node:fs';

const out = new URL('../src/generated/', import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL('docs.json', out), '{}\n');
