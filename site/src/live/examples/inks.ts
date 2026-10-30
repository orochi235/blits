import { color, css, ink, keys, kit, mix, oklab, patch } from '@msb235/blits';
import { loop } from '../loop';

interface Swatch {
  name: string;
}
interface SwatchPose {
  color: number[];
  ink: number[];
}

// The same voices write both channels; only the channel's arithmetic differs.
const KIT = kit<SwatchPose>({ color: color(), ink: ink() });

const RED = oklab(0xe0303a);
const BLUE = oklab(0x2f56d8);
const NONE = [0, 0, 0, 0];
const both = (c: number[]) => ({ color: c, ink: c });

const travel = keys<Swatch, SwatchPose>(4000, [
  { at: 0, delta: both(RED) },
  { at: 0.5, delta: both(BLUE), ease: 'ease-in-out' },
  { at: 1, delta: both(RED), ease: 'ease-in-out' },
]);

const red = patch<Swatch, SwatchPose>(0, () => both(RED), { writes: ['color', 'ink'] });
const blue = keys<Swatch, SwatchPose>(4000, [
  { at: 0, delta: both(NONE) },
  { at: 0.5, delta: both(BLUE), ease: 'ease-in-out' },
  { at: 1, delta: both(NONE), ease: 'ease-in-out' },
]);

export default function run(root: HTMLElement): () => void {
  const grid = document.createElement('div');
  grid.className = 'inks';
  root.append(grid);
  for (const text of ['', 'red ⇄ blue', 'red + blue']) {
    const head = document.createElement('span');
    head.textContent = text;
    grid.append(head);
  }
  const swatches: Swatch[] = [{ name: 'travel' }, { name: 'overlap' }];
  const cells = (['color', 'ink'] as const).map((channel) => {
    const label = document.createElement('code');
    label.textContent = `${channel}()`;
    grid.append(label);
    return swatches.map(() => {
      const el = document.createElement('div');
      el.className = 'dot';
      grid.append(el);
      return el;
    });
  });

  const [colored, inked] = cells as [HTMLElement[], HTMLElement[]];

  const m = mix<Swatch, SwatchPose>(KIT, { name: 'inks' });
  const [moving, mixed] = swatches as [Swatch, Swatch];
  m.cue({ patch: travel, subjects: [moving], loop: true });
  m.cue({ patch: red, subjects: [mixed] });
  m.cue({ patch: blue, subjects: [mixed], loop: true });

  const pose: SwatchPose = { color: [0, 0, 0, 0], ink: [0, 0, 0, 0, 0] };
  const stop = loop(m, (now) => {
    m.sync(now);
    swatches.forEach((s, i) => {
      m.probe(s, pose);
      (colored[i] as HTMLElement).style.background = css(pose.color);
      (inked[i] as HTMLElement).style.background = css(pose.ink);
    });
  });

  return () => {
    stop();
    m.close();
  };
}
