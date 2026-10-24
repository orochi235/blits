import { kit, mix, sum } from '@msb235/blits';

interface Card {
  el: HTMLElement;
}
interface CardPose {
  y: number;
}
const m = mix<Card, CardPose>(kit<CardPose>({ y: sum() }));
declare function draw(): void;
// ---
let frame = 0;

function tick(now: number) {
  m.sync(now);
  draw();
  frame = m.inert ? 0 : requestAnimationFrame(tick);
}

m.onWake(() => {
  if (frame === 0) frame = requestAnimationFrame(tick);
});
frame = requestAnimationFrame(tick);
