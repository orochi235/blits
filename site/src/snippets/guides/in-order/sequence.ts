import { kit, mix, type Patch, sum } from '@msb235/blits';

interface Pose {
  reveal: number;
  glow: number;
}
declare const typeIn: Patch<HTMLElement, Pose>;
declare const underline: Patch<HTMLElement, Pose>;
declare const shine: Patch<HTMLElement, Pose>;
declare const heading: HTMLElement;
declare const lines: HTMLElement[];
declare const badge: HTMLElement;
const m = mix<HTMLElement, Pose>(kit<Pose>({ reveal: sum(), glow: sum() }));
// ---
// At a time: now, unless the spec gives a `start` on the host's clock.
const title = m.cue({ patch: typeIn, name: 'title', subjects: [heading] });

// Against another voice's mark: 200 ms after the title has gone.
m.cue({
  patch: underline,
  subjects: [heading],
  anchor: { start: { after: 'title', by: 200 } },
});

// A span fits what it holds into a budget, one after another by default.
const intro = m.span({ name: 'intro', duration: 2000, anchor: { start: { with: 'title' } } });
for (const line of lines) m.cue({ patch: typeIn, owner: intro, subjects: [line], faster: 3 });

// Against a moment only the host knows.
m.cue({ patch: shine, subjects: [badge], anchor: { start: { with: 'loaded' } } });
fetch('/data.json').then(() => m.announce('loaded'));

// When it has finished.
if (await title.played) heading.dataset.shown = '';
await intro.done;
