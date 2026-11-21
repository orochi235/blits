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
  name: 'cards',
  history: { ms: 10_000, tape: createHistory },
  stepMs: 5,
});

// While the thumb is held the mix isn't synced, so each move seeks it and nothing new is recorded.
let held = false;
function frame(now: number) {
  if (!held) {
    m.sync(now);
    scrubber.min = String(Math.max(0, m.now - 10_000));
    scrubber.max = String(m.now);
    scrubber.value = String(m.now);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

scrubber.addEventListener('pointerdown', () => {
  held = true;
});
scrubber.addEventListener('input', () => {
  held = true;
  m.seek(Number(scrubber.value));
});
// Letting go leaves the time held out of the clock, and the mix plays on from the thumb.
scrubber.addEventListener('change', () => {
  held = false;
  m.rebase();
});
