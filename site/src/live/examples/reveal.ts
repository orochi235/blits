import { keys, kit, max, mix, sum } from '@msb235/blits';
import { demo } from '../demo';
import { frameTime } from '../loop';

interface Letter {
  el: HTMLElement;
  index: number;
}
interface LetterPose {
  rise: number;
  show: number;
}

const LETTER = kit<LetterPose>({ rise: sum(), show: max() });

const reveal = keys<Letter, LetterPose>(
  600,
  [
    { at: 0, delta: { rise: 18, show: 0 } },
    { at: 1, delta: { rise: 0, show: 1 }, ease: 'ease-out' },
  ],
  {},
);

export default demo((d) => {
  const { root } = d;
  const line = document.createElement('p');
  line.className = 'reveal';
  root.append(line);
  const letters: Letter[] = [...'Concurrent effects, mixed.'].map((ch, index) => {
    const el = document.createElement('span');
    el.textContent = ch;
    line.append(el);
    return { el, index };
  });

  const m = mix<Letter, LetterPose>(LETTER, d.options('reveal'));
  d.closes(m);
  // Synced once before the first cue, or its one pass is over by the first frame.
  m.sync(frameTime());
  let stopped = false;
  let round = 0;

  // Each letter waits its turn and holds its last frame. Each pass starts 2.2 s after the one
  // before has landed, and that one fades out 700 ms before it.
  const play = () => {
    round += 1;
    const h = m.cue({
      patch: reveal,
      name: `pass ${round}`,
      stagger: (letter) => letter.index * 40,
      freeze: 'after',
      fade: { out: 500 },
      anchor: {
        ...(round > 1 ? { start: { of: `pass ${round - 1}`, mark: 'coast', by: 2200 } } : {}),
        out: { before: `pass ${round + 1}`, by: 700 },
      },
    });
    void h.played.then(() => {
      if (!stopped) play();
    });
  };
  play();

  const pose = { rise: 0, show: 0 };
  d.frame(m, (now) => {
    m.sync(now);
    for (const letter of letters) {
      m.probe(letter, pose);
      letter.el.style.opacity = String(pose.show);
      letter.el.style.transform = `translateY(${pose.rise}px)`;
    }
  });
  d.stops(() => {
    stopped = true;
  });
});
