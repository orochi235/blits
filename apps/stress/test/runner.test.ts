import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { digest } from '@stress/digest';
import { parse } from '@stress/flags';
import { main, run } from '@stress/run';
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

test('keeps the newest five runs of a scenario, and any still in flight', async () => {
  const root = scratch();
  const dirs: string[] = [];
  for (let s = 1; s <= 7; s++) {
    dirs.push(await run({ name: 'idle', size: 1, frames: 2, seed: s, root, quiet: true }));
  }
  const idle = () => readdirSync(root).filter((d) => d.includes('-idle-'));
  expect(idle()).toHaveLength(7);
  const old = Date.now() / 1000 - 3600;
  dirs.forEach((d, k) => {
    utimesSync(d, old + k, old + k);
  });
  await run({ name: 'idle', size: 1, frames: 2, seed: 8, root, quiet: true });
  expect(idle()).toHaveLength(5);
});

test('names a run by size and lanes, so variants run at once land apart', async () => {
  const root = scratch();
  const on = await run({ name: 'idle', size: 2, frames: 2, seed: 3, root, quiet: true });
  const off = await run({
    name: 'idle',
    size: 2,
    frames: 2,
    seed: 3,
    root,
    lanes: false,
    quiet: true,
  });
  expect(on).toMatch(/-idle-s2-3$/);
  expect(off).toMatch(/-idle-s2-off-3$/);
});

test('refuses flags it does not know or cannot read', async () => {
  expect(parse(['--frames', '30', '--seed', '0', '--lanes', 'off'])).toEqual({
    frames: 30,
    seed: 0,
    lanes: false,
  });
  for (const bad of [
    ['--frame', '30'],
    ['--frames=30'],
    ['--frames'],
    ['--frames', '--seed', '1'],
    ['--frames', 'NaN'],
    ['--size', 'Infinity'],
    ['--seed', '-1'],
    ['--lanes', 'no'],
  ]) {
    expect(typeof parse(bad)).toBe('string');
  }
  const err = console.error;
  console.error = () => {};
  try {
    expect(await main(['idle', '--seed', 'NaN'])).toBe(2);
  } finally {
    console.error = err;
  }
});

test('digests windows as the maxima and quantiles of window figures', async () => {
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
  const text = digest(out);
  expect(text).toMatch(/step max, max of windows/);
  expect(text).toMatch(/step p50, median of windows/);
});
