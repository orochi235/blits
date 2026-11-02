import { kit, mix, patch, sum, watched } from '@msb235/blits';
import { createHistory } from '@weasel-js/history';
import { loop } from '../loop';

interface Pose {
  y: number;
  glow: number;
}

const LAMP = kit<Pose>({ y: sum(), glow: sum() });
const NAMES = ['A', 'B', 'C', 'D'];
/** Voice rows the readout holds room for. */
const ROWS = 5;

const bob = patch<HTMLElement, Pose>(1800, (phase) => ({ y: 6 * Math.sin(2 * Math.PI * phase) }), {
  writes: ['y'],
});
const pulse = patch<HTMLElement, Pose>(
  1200,
  (phase) => ({ glow: 0.5 - 0.5 * Math.cos(2 * Math.PI * phase) }),
  { writes: ['glow'] },
);
const hop = patch<HTMLElement, Pose>(700, (phase) => ({ y: -28 * Math.sin(Math.PI * phase) }), {
  writes: ['y'],
});

const pad = (s: string, n: number) => s.padEnd(n);

export default function run(root: HTMLElement): () => void {
  const wrap = document.createElement('div');
  wrap.className = 'rig';
  const stage = document.createElement('div');
  stage.className = 'debug-lamps';
  const lamps: HTMLElement[] = NAMES.map((name) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'debug-lamp';
    el.dataset.name = name;
    el.textContent = name;
    stage.append(el);
    return el;
  });
  const controls = document.createElement('div');
  controls.className = 'rig-row';
  const button = (text: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    controls.append(b);
    return b;
  };
  const hopButton = button('Hop');
  const idleButton = button('Stop idle');
  const panelButton = button('Open the debug panel');
  const read = document.createElement('p');
  read.className = 'rig-read';
  wrap.append(stage, controls, read);
  root.append(wrap);

  const m = mix<HTMLElement, Pose>(LAMP, {
    name: 'debugging: lamps',
    labelOf: (el: HTMLElement) => `lamp ${el.dataset.name}`,
    history: { ms: 10_000, every: 250, tape: createHistory },
  });

  // `watched()` is what the panel reads, and it knows each voice's name and tags.
  const entry = watched()
    .entries()
    .find((e) => e.mix === m);
  const idle = () => {
    m.cue({
      patch: bob,
      subjects: lamps,
      loop: true,
      stagger: (el) => lamps.indexOf(el) * 150,
      fade: { in: 800 },
      name: 'bob',
      tags: ['idle'],
    });
    m.cue({
      patch: pulse,
      subjects: [lamps[0] as HTMLElement, lamps[2] as HTMLElement],
      loop: true,
      fade: { in: 800 },
      name: 'pulse',
      tags: ['idle', 'glow'],
    });
  };
  idle();

  let picked = lamps[1] as HTMLElement;
  const pick = (el: HTMLElement) => {
    picked = el;
    for (const l of lamps) l.setAttribute('aria-pressed', String(l === el));
  };
  for (const el of lamps) el.addEventListener('click', () => pick(el));
  pick(picked);

  // Starts 400 ms from now, so it is listed as pending first.
  hopButton.addEventListener('click', () => {
    m.cue({
      patch: hop,
      subjects: [picked],
      start: m.timestamp + 400,
      name: 'hop',
      tags: ['hop'],
    });
  });
  let idling = true;
  idleButton.addEventListener('click', () => {
    idling = !idling;
    if (idling) idle();
    else for (const h of m.voices('idle')) h.fade({ over: 1200 });
    idleButton.textContent = idling ? 'Stop idle' : 'Start idle';
  });

  // The site mounts the panel at page load for `?panel`, before any mix is made, so it can scrub.
  const panelOn = () => document.querySelector('[data-blits-panel]') !== null;
  const showPanel = () => {
    const on = panelOn();
    panelButton.disabled = on;
    panelButton.textContent = on ? 'The debug panel is on' : 'Open the debug panel';
  };
  panelButton.addEventListener('click', () => {
    if (panelOn()) return showPanel();
    const url = new URL(location.href);
    url.searchParams.set('panel', 'on');
    location.assign(url);
  });
  showPanel();
  const panelCheck = setTimeout(showPanel, 1000);

  const pose = m.pose();
  const stop = loop(m, (now) => {
    m.sync(now);
    for (const el of lamps) {
      m.probe(el, pose);
      el.style.setProperty('--y', `${pose.y.toFixed(2)}px`);
      el.style.setProperty('--glow', Math.min(1, pose.glow).toFixed(3));
    }
    const label = `lamp ${picked.dataset.name}`;
    const lines = [
      `${pad(' id', 4)}${pad('voice', 7)}${pad('tags', 10)}${pad('state', 9)}weightOf(${label})`,
    ];
    const voices = m.voices();
    for (const [i, h] of voices.entries()) {
      if (i === ROWS - 1 && voices.length > ROWS) {
        lines.push(`    and ${voices.length - i} more`);
        break;
      }
      const v = entry?.voice(h);
      lines.push(
        `${String(h.id).padStart(3)} ${pad(v?.name ?? '?', 7)}${pad(v?.tags.join(',') ?? '', 10)}${pad(h.state, 9)}${h.weightOf(picked).toFixed(2).padStart(4)}`,
      );
    }
    for (let i = lines.length; i <= ROWS; i++) lines.push('');
    lines.push(`m.atRest(${label})  ${pad(String(m.atRest(picked)), 5)}   m.inert  ${m.inert}`);
    read.textContent = lines.join('\n');
  });

  return () => {
    stop();
    clearTimeout(panelCheck);
    m.close();
  };
}
