import type { Composition } from './composition';
import { load } from './load';

/** A file name for the composition, from its title. */
export function fileName(c: Composition): string {
  const stem = c.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${stem || 'composition'}.blits.json`;
}

export function toFile(c: Composition): string {
  return `${JSON.stringify(c, null, 2)}\n`;
}

/** The composition a file's text holds, or null where it holds none `load` accepts. */
export function fromFile(text: string): Composition | null {
  try {
    return load(JSON.parse(text));
  } catch {
    return null;
  }
}
