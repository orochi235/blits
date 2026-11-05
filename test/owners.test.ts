import { readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

// The mix's fields that are kept in step with its voice list, or with what `pull` last read, and
// the only modules that may assign each. A module that needs one changed calls its owner.
const owners: Record<string, string[]> = {
  named: ['roster.ts', 'chain.ts'],
  naming: ['roster.ts', 'chain.ts'],
  roleVoices: ['roster.ts'],
  anchored: ['roster.ts'],
  general: ['roster.ts', 'move.ts', 'chain.ts'],
  sharers: ['roster.ts', 'move.ts', 'everyone.ts'],
  owners: ['roster.ts', 'seek.ts'],
  detours: ['roster.ts'],
  pulled: ['pull.ts'],
  pulledHeads: ['pull.ts'],
  pulledSlots: ['pull.ts'],
  pulledVersion: ['pull.ts'],
  pulledRelinks: ['pull.ts'],
};

/** Methods that change an array, a `Map` or a `Set` in place. */
const mutators = 'push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin|set|add|delete|clear';

const src = new URL('../src/', import.meta.url);

/** Every `field: module` where a module other than `mixer.ts` assigns or mutates a field of a mix. */
function assigned(): string[] {
  const out = new Set<string>();
  for (const file of readdirSync(src)) {
    if (!file.endsWith('.ts') || file === 'mixer.ts') continue;
    const text = readFileSync(new URL(file, src), 'utf8');
    const mixes = new Set([...text.matchAll(/\b(\w+)\??: (?:readonly )?Mixer</g)].map((m) => m[1]));
    for (const name of mixes) {
      const field = `\\b${name}\\.(\\w+)`;
      const assign = new RegExp(
        `${field}(?:\\[[^\\]]*\\])?\\s*(?:[-+*/|&?]{0,2}=(?!=)|\\+\\+|--)`,
        'g',
      );
      const call = new RegExp(`${field}\\??\\.(?:${mutators})\\(`, 'g');
      for (const m of [...text.matchAll(assign), ...text.matchAll(call)])
        out.add(`${m[1]}: ${file}`);
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
