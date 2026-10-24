import { kit, mix, sum, ticker } from '@msb235/blits';

interface Card {
  el: HTMLElement;
}
interface CardPose {
  y: number;
}
const CARD = kit<CardPose>({ y: sum() });
declare const cards: Card[];
// ---
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const m = mix<Card, CardPose>(CARD, { reduce: () => reduced.matches });

const loop = ticker();
loop.add(m);

const pose = { y: 0 };
loop.after(() => {
  for (const card of cards) {
    m.probe(card, pose);
    card.el.style.transform = `translateY(${pose.y}px)`;
  }
});

document.addEventListener('visibilitychange', () => document.hidden || m.rebase());
