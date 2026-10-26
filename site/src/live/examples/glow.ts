import { input, kit, lag, mix, patch, sum } from '@msb235/blits';
import { loop } from '../loop';

interface Card {
  el: HTMLElement;
}
interface CardPose {
  lift: number;
  glow: number;
}

const CARD = kit<CardPose>({ lift: sum(), glow: sum() });

// Duration 0 holds for good; the voice's weight does all the moving.
const raised = patch<Card, CardPose>(0, () => ({ lift: 1, glow: 1 }), { writes: ['lift', 'glow'] });

export default function run(root: HTMLElement): () => void {
  const row = document.createElement('div');
  row.className = 'cards';
  root.append(row);
  const cards: Card[] = ['Channel', 'Patch', 'Voice', 'Mix'].map((name) => {
    const el = document.createElement('div');
    el.className = 'card';
    el.textContent = name;
    row.append(el);
    return { el };
  });

  let hovered: Card | undefined;
  const over = input<Card>((card) => (card === hovered ? 1 : 0));
  const onOver = (e: PointerEvent) => {
    hovered = cards.find((c) => c.el === e.target);
    over.touch();
  };
  const onLeave = () => {
    hovered = undefined;
    over.touch();
  };
  row.addEventListener('pointerover', onOver);
  row.addEventListener('pointerleave', onLeave);

  // Quick to rise, slow to settle: lag eases each card's weight toward the pointer's 0 or 1.
  const m = mix<Card, CardPose>(CARD, { name: 'glow' });
  m.cue({ patch: raised, weight: lag(over, { riseMs: 80, fallMs: 350 }) });

  const pose = { lift: 0, glow: 0 };
  const stop = loop(m, (now) => {
    m.sync(now);
    for (const card of cards) {
      m.probe(card, pose);
      card.el.style.transform = `translateY(${-8 * pose.lift}px)`;
      card.el.style.setProperty('--glow', String(pose.glow));
    }
  });

  return () => {
    stop();
    row.removeEventListener('pointerover', onOver);
    row.removeEventListener('pointerleave', onLeave);
    m.close();
  };
}
