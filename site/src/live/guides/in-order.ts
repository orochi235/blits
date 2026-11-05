import { kit, mix, patch, sum } from '@msb235/blits';
import { createHistory } from '@weasel-js/history';
import { loop } from '../loop';

interface Part {
  el: HTMLElement;
}
interface Pose {
  reveal: number;
  under: number;
  glow: number;
}

const POSE = kit<Pose>({ reveal: sum(), under: sum(), glow: sum() });
/** Typing speed at the line's own rate, ms a character. */
const PER_CHAR = 35;
/** How far back the scrubber and the debug panel can seek, ms. */
const KEPT = 60_000;

const HEADING = 'Quarterly report';
const LINES = [
  'Revenue rose twelve percent on the quarter.',
  'Churn held flat for the third quarter running.',
  'Two new regions opened in October.',
  'Hiring slows until the spring.',
];

// Reveal runs 0 to 1 over the text; the frame loop shows that share of its characters.
const typeIn = (text: string) =>
  patch<Part, Pose>(text.length * PER_CHAR, (phase) => ({ reveal: phase }), {
    writes: ['reveal'],
  });
const underline = patch<Part, Pose>(400, (phase) => ({ under: 1 - (1 - phase) ** 3 }), {
  writes: ['under'],
});
const shine = patch<Part, Pose>(
  900,
  (phase) => ({ reveal: Math.min(1, phase * 4), glow: Math.sin(phase * Math.PI) }),
  { writes: ['reveal', 'glow'] },
);

/** A line of text that types in: the typed part, and the rest kept in place but unseen. */
function typed(el: HTMLElement, text: string) {
  const shown = document.createElement('span');
  const rest = document.createElement('span');
  rest.className = 'in-order-rest';
  el.append(shown, rest);
  let count = -1;
  return (reveal: number) => {
    const n = Math.round(reveal * text.length);
    if (n === count) return;
    count = n;
    shown.textContent = text.slice(0, n);
    rest.textContent = text.slice(n);
  };
}

const pad = (n: number) => String(Math.round(n)).padStart(4);

export default function run(root: HTMLElement): () => void {
  const wrap = document.createElement('div');
  wrap.className = 'rig';
  const card = document.createElement('article');
  card.className = 'in-order';
  const head = document.createElement('div');
  head.className = 'in-order-head';
  const h = document.createElement('h3');
  h.className = 'in-order-heading';
  const rule = document.createElement('span');
  rule.className = 'in-order-rule';
  const badge = document.createElement('span');
  badge.className = 'in-order-badge';
  badge.textContent = 'live';
  head.append(h, badge);
  card.append(head, rule);
  const heading: Part = { el: h };
  const underlined: Part = { el: rule };
  const flagged: Part = { el: badge };
  const drawHeading = typed(h, HEADING);
  const lines = LINES.map((text) => {
    const el = document.createElement('p');
    el.className = 'in-order-line';
    card.append(el);
    return { part: { el } as Part, text, draw: typed(el, text) };
  });

  const controls = document.createElement('div');
  controls.className = 'rig-row';
  const load = document.createElement('button');
  load.type = 'button';
  load.textContent = 'Data loaded';
  const scrub = document.createElement('input');
  scrub.type = 'range';
  scrub.min = '0';
  scrub.max = '0';
  scrub.ariaLabel = 'Time';
  controls.append(load, scrub);
  const read = document.createElement('p');
  read.className = 'rig-read';
  wrap.append(card, controls, read);
  root.append(wrap);

  const m = mix<Part, Pose>(POSE, { name: 'in-order', history: { ms: KEPT, tape: createHistory } });
  m.sync(0);
  m.cue({ patch: typeIn(HEADING), name: 'title', subjects: [heading], freeze: 'after' });
  // Frozen on its last frame, the title has no end until it fades, so the underline waits on its
  // coast, where its one pass ends.
  m.cue({
    patch: underline,
    subjects: [underlined],
    anchor: { start: { of: 'title', mark: 'coast', by: 200 } },
    freeze: 'after',
  });
  const intro = m.span({
    name: 'intro',
    duration: 2000,
    anchor: { start: { with: 'title' } },
    freeze: 'after',
  });
  for (const line of lines)
    m.cue({ patch: typeIn(line.text), owner: intro, subjects: [line.part], faster: 3 });
  m.cue({
    patch: shine,
    subjects: [flagged],
    anchor: { start: { with: 'loaded' } },
    freeze: 'after',
  });

  const onLoad = () => {
    m.announce('loaded');
    load.disabled = true;
  };
  load.addEventListener('click', onLoad);

  // Scrubbing holds the mix by not syncing it, and seeks it; letting go rebases and plays on.
  let held = false;
  const onInput = () => {
    held = true;
    m.seek(Number(scrub.value));
  };
  const onRelease = () => {
    held = false;
    m.rebase();
  };
  scrub.addEventListener('input', onInput);
  scrub.addEventListener('change', onRelease);

  const pose: Pose = { reveal: 0, under: 0, glow: 0 };
  let first = Number.NaN;
  let far = 0;
  const stop = loop(
    m,
    root,
    (now) => {
      if (Number.isNaN(first)) first = now;
      if (!held) {
        m.sync(now - first);
        far = Math.max(far, m.now);
        scrub.min = String(Math.max(0, far - KEPT));
        scrub.max = String(far);
        scrub.value = String(m.now);
      }
      m.probe(heading, pose);
      drawHeading(pose.reveal);
      m.probe(underlined, pose);
      rule.style.setProperty('--under', String(pose.under));
      for (const line of lines) {
        m.probe(line.part, pose);
        line.draw(pose.reveal);
      }
      m.probe(flagged, pose);
      badge.style.setProperty('--show', String(pose.reveal));
      badge.style.setProperty('--glow', String(pose.glow));
      const r = intro.result;
      read.textContent = `budget ${pad(r.budget)} ms  length ${pad(r.length)} ms  over ${pad(r.over)} ms  skipped ${r.skipped}`;
    },
    { settle: false },
  );

  return () => {
    stop();
    load.removeEventListener('click', onLoad);
    scrub.removeEventListener('input', onInput);
    scrub.removeEventListener('change', onRelease);
    m.close();
  };
}
