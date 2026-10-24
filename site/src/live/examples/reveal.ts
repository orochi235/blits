import { keys, kit, max, mix, sum } from '@msb235/blits';

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

export default function run(root: HTMLElement): () => void {
  const line = document.createElement('p');
  line.className = 'reveal';
  root.append(line);
  const letters: Letter[] = [...'Concurrent effects, mixed.'].map((ch, index) => {
    const el = document.createElement('span');
    el.textContent = ch;
    line.append(el);
    return { el, index };
  });

  const m = mix<Letter, LetterPose>(LETTER, { name: 'reveal' });
  let timer = 0;
  let stopped = false;

  // Each letter waits its turn, holds its last frame, and fades out with the rest.
  const play = () => {
    const h = m.cue({
      patch: reveal,
      stagger: (letter) => letter.index * 40,
      freeze: 'both',
      fade: { out: 500 },
    });
    void h.played.then(() => {
      if (stopped) return;
      timer = window.setTimeout(() => {
        h.fade();
        timer = window.setTimeout(play, 700);
      }, 1500);
    });
  };
  play();

  const pose = { rise: 0, show: 0 };
  let id = requestAnimationFrame(function frame(now) {
    m.sync(now);
    for (const letter of letters) {
      m.probe(letter, pose);
      letter.el.style.opacity = String(pose.show);
      letter.el.style.transform = `translateY(${pose.rise}px)`;
    }
    id = requestAnimationFrame(frame);
  });

  return () => {
    stopped = true;
    clearTimeout(timer);
    cancelAnimationFrame(id);
    m.close();
  };
}
