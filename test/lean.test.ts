import { createHistory as tape } from '@weasel-js/history';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix as lean } from '../src/lean.js';
import { mix } from '../src/mixer.js';
import { spring } from '../src/motion.js';
import { keys } from '../src/patch.js';

interface Pose {
  x: number;
  y: number;
}
const K = kit<Pose>({ x: sum(), y: sum() });
const dots = Array.from({ length: 12 }, (_, i) => ({ i }));

function play(make: typeof mix): number[] {
  const m = make<{ i: number }, Pose>(K, { history: { ms: 1000, tape }, stepMs: 5 });
  m.cue({
    patch: keys(400, [
      { at: 0, delta: { x: 0 } },
      { at: 1, delta: { x: 10 }, ease: 'ease-in-out' },
    ]),
    loop: true,
    stagger: (d) => d.i * 30,
  });
  m.cue({ patch: spring<{ i: number }, Pose>('y', { from: 0, to: 1 }) });
  const out: number[] = [];
  for (let t = 0; t <= 600; t += 16) {
    if (t === 320) m.seek(200);
    m.sync(t);
    for (const d of dots) {
      const p = m.probe(d);
      out.push(p.x, p.y);
    }
  }
  return out;
}

describe('the lean entry', () => {
  it('gives the poses the stock mix gives, through a seek back', () => {
    expect(play(lean)).toEqual(play(mix));
  });

  it('refuses lanes: true', () => {
    expect(() => lean<{ i: number }, Pose>(K, { lanes: true })).toThrow(/lean.*has no lanes/);
  });

  it("leaves the lanes' code out of a bundle", async () => {
    const inputs = async (entry: string) => {
      const out = await build({
        stdin: {
          contents: `import { mix } from './src/${entry}.ts'; console.log(mix);`,
          resolveDir: process.cwd(),
        },
        bundle: true,
        write: false,
        metafile: true,
        logLevel: 'silent',
      });
      const kept = Object.values(out.metafile.outputs)[0]?.inputs ?? {};
      return Object.keys(kept).filter((f) => (kept[f]?.bytesInOutput ?? 0) > 0);
    };
    // The stock entry is the control: were lanes dropped from it too, this test would prove nothing.
    expect(await inputs('index')).toContain('src/lanes.ts');
    const got = await inputs('lean');
    expect(got).toContain('src/mixer.ts');
    expect(got.filter((f) => /src\/(lanes|lane|qualify|fill)\.ts$/.test(f))).toEqual([]);
  });
});
