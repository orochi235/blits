import { kit, mix, sum } from '@msb235/blits';
import { createHistory } from '@weasel-js/history';

interface Card {
  el: HTMLElement;
}
interface CardPose {
  y: number;
}
const CARD = kit<CardPose>({ y: sum() });
declare const scrubber: HTMLInputElement;
// ---
const m = mix<Card, CardPose>(CARD, {
  history: { ms: 10_000, tape: createHistory },
  stepMs: 5,
});

// The furthest the mix has played, so the scrubber covers the ten seconds behind it.
let latest = 0;
let dragging = false;
function frame(now: number) {
  m.sync(now);
  latest = Math.max(latest, m.now);
  scrubber.min = String(Math.max(0, latest - 10_000));
  scrubber.max = String(latest);
  if (!dragging) scrubber.value = String(m.now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Move the mix to wherever the thumb is. It plays on from there.
scrubber.addEventListener('pointerdown', () => {
  dragging = true;
});
scrubber.addEventListener('pointerup', () => {
  dragging = false;
});
scrubber.addEventListener('input', () => m.seek(Number(scrubber.value)));
