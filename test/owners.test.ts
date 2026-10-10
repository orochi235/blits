import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// The mix's fields that are kept in step with its voice list, or with what `pull` last read, and
// the only modules that may assign each. A module that needs one changed calls its owner.
const owners: Record<string, string[]> = {
  named: ['roster.ts'],
  naming: ['roster.ts', 'chain.ts'],
  loci: ['roster.ts'],
  anchored: ['roster.ts'],
  general: ['roster.ts', 'move.ts'],
  sharers: ['roster.ts', 'move.ts'],
  owners: ['roster.ts', 'seek.ts'],
  detours: ['everyone.ts'],
  pulled: ['pull.ts'],
  pulledHeads: ['pull.ts'],
  pulledSlots: ['pull.ts'],
  pulledVersion: ['pull.ts'],
  pulledRelinks: ['pull.ts'],
};

const src = new URL('../src/', import.meta.url);

/** Every `field: module` where a module other than `mixer.ts` assigns a field of a mix. */
function assigned(): string[] {
  const out = new Set<string>();
  for (const file of readdirSync(src)) {
    if (!file.endsWith('.ts') || file === 'mixer.ts') continue;
    const text = readFileSync(new URL(file, src), 'utf8');
    const mixes = new Set([...text.matchAll(/\b(\w+)\??: (?:readonly )?Mixer</g)].map((m) => m[1]));
    for (const name of mixes) {
      const write = new RegExp(`\\b${name}\\.(\\w+)\\s*(?:[-+*/|&?]{0,2}=(?!=)|\\+\\+|--)`, 'g');
      for (const m of text.matchAll(write)) out.add(`${m[1]}: ${file}`);
    }
  }
  return [...out].sort();
}

test('a field of the mix with an owner is assigned by no other module', () => {
  const strays = assigned().filter((entry) => {
    const [field, file] = entry.split(': ') as [string, string];
    return owners[field] !== undefined && !owners[field].includes(file);
  });
  expect(strays).toEqual([]);
});

test('every owner named still assigns its field', () => {
  const found = new Set(assigned());
  const idle = Object.entries(owners).flatMap(([field, files]) =>
    files.filter((file) => !found.has(`${field}: ${file}`)).map((file) => `${field}: ${file}`),
  );
  expect(idle).toEqual([]);
});
