import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '@stress/run';
import { afterEach, expect, test } from 'vitest';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const scratch = () => {
  const d = mkdtempSync(join(tmpdir(), 'stress-'));
  dirs.push(d);
  return d;
};

test('writes a header, one record per frame, and findings', async () => {
  const root = scratch();
  const out = await run({ name: 'idle', size: 1, frames: 30, seed: 1, root, quiet: true });
  const lines = readFileSync(join(out, 'frames.jsonl'), 'utf8').trim().split('\n');
  expect(JSON.parse(lines[0] as string).header.name).toBe('idle');
  expect(lines).toHaveLength(31);
  expect(JSON.parse(readFileSync(join(out, 'findings.json'), 'utf8'))).toEqual([]);
});

test('windows aggregate frames', async () => {
  const root = scratch();
  const out = await run({
    name: 'idle',
    size: 1,
    frames: 30,
    seed: 1,
    root,
    window: 10,
    quiet: true,
  });
  const lines = readFileSync(join(out, 'frames.jsonl'), 'utf8').trim().split('\n');
  expect(lines).toHaveLength(4);
  expect(JSON.parse(lines[1] as string)).toMatchObject({ from: 0, to: 9 });
});

test('keeps the newest five runs of a scenario', async () => {
  const root = scratch();
  for (let s = 1; s <= 7; s++) {
    await run({ name: 'idle', size: 1, frames: 2, seed: s, root, quiet: true });
  }
  expect(readdirSync(root).filter((d) => d.includes('-idle-'))).toHaveLength(5);
});
