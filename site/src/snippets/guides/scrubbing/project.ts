import { kit, mix, sum } from '@msb235/blits';

interface Card {
  el: HTMLElement;
}
interface CardPose {
  y: number;
}
const m = mix<Card, CardPose>(kit<CardPose>({ y: sum() }));
declare const card: Card;
declare function drawGhost(card: Card, pose: CardPose): void;
// ---
// Where the card will be half a second from now, with nothing in the mix moved.
const ahead = m.project(m.now + 500);
drawGhost(card, ahead.probe(card));

// How sure that is, per channel: 'exact', 'stepped', or 'held'.
if (ahead.assess(card).y === 'held') card.el.classList.add('unsure');
