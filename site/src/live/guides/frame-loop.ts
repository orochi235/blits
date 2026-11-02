import { kit, mix, patch, sum, ticker } from '@msb235/blits';
import { createHistory } from '@weasel-js/history';

interface Bar {
  el: HTMLElement;
}
interface BarPose {
  x: number;
}

const BAR = kit<BarPose>({ x: sum() });
/** One trip across the lane and back, in ms. */
const TRIP = 4000;
/** How long Hide stands in for a hidden tab, in ms. */
const AWAY = 1500;

const trip = patch<Bar, BarPose>(TRIP, (phase) => ({ x: Math.sin(Math.PI * phase) }), {
  writes: ['x'],
});

function button(label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  return b;
}

export default function run(root: HTMLElement): () => void {
  const lanes = document.createElement('div');
  lanes.className = 'lanes';
  const lane = document.createElement('div');
  lane.className = 'lane';
  const el = document.createElement('div');
  el.className = 'bar';
  el.textContent = 'trip';
  lane.append(el);
  lanes.append(lane);
  const bar: Bar = { el };

  const cue = button('Cue a trip');
  const hide = button(`Hide ${AWAY / 1000} s`);
  const actions = document.createElement('div');
  actions.className = 'rig-row';
  const read = document.createElement('p');
  read.className = 'rig-read';
  actions.append(cue, hide, read);

  const back = document.createElement('div');
  back.className = 'rig-row';
  const tag = document.createElement('span');
  tag.className = 'rig-label';
  tag.textContent = 'On return';
  const catchUp = button('Catch up');
  const pickUp = button('Pick up');
  back.append(tag, catchUp, pickUp);

  const rig = document.createElement('div');
  rig.className = 'rig';
  rig.append(actions, back);
  root.append(lanes, rig);

  const m = mix<Bar, BarPose>(BAR, {
    name: 'frame-loop',
    history: { ms: 10_000, tape: createHistory },
  });
  const frames = ticker();
  const remove = frames.add(m);

  let count = 0;
  let state: 'awake' | 'asleep' | 'hidden' | 'paused' = 'awake';
  let hiding = 0;
  let away = !document.hasFocus();
  let rebase = true;

  const show = () => {
    read.textContent = `${state.padEnd(6)}  frames ${String(count).padStart(6)}`;
    cue.disabled = state === 'awake' || hiding !== 0;
    hide.disabled = hiding !== 0;
    catchUp.ariaPressed = String(!rebase);
    pickUp.ariaPressed = String(rebase);
  };

  const pose = { x: 0 };
  const unafter = frames.after(() => {
    count++;
    m.probe(bar, pose);
    el.style.left = `calc(${pose.x} * (100% - 6rem))`;
    state = away ? 'paused' : m.inert ? 'asleep' : 'awake';
    show();
  });
  const unwake = m.onWake(() => {
    state = 'awake';
    show();
  });

  cue.addEventListener('click', () => m.cue({ patch: trip, subjects: [bar], name: 'trip' }));
  // A hidden tab gets no frames, so stopping the ticker for a while stands in for one.
  hide.addEventListener('click', () => {
    frames.stop();
    state = 'hidden';
    hiding = window.setTimeout(() => {
      hiding = 0;
      if (rebase) m.rebase();
      if (!away) frames.wake();
      show();
    }, AWAY);
    show();
  });
  catchUp.addEventListener('click', () => {
    rebase = false;
    show();
  });
  pickUp.addEventListener('click', () => {
    rebase = true;
    show();
  });

  // Out of focus it waits, as `loop.ts` does, and always takes the time away off the clock.
  const blur = () => {
    away = true;
    frames.stop();
    if (hiding === 0) state = 'paused';
    show();
  };
  const focus = () => {
    if (!away) return;
    away = false;
    m.rebase();
    if (hiding === 0) frames.wake();
  };
  window.addEventListener('blur', blur);
  window.addEventListener('focus', focus);

  if (away) state = 'paused';
  else m.cue({ patch: trip, subjects: [bar], name: 'trip' });
  show();

  return () => {
    window.clearTimeout(hiding);
    window.removeEventListener('blur', blur);
    window.removeEventListener('focus', focus);
    unwake();
    unafter();
    remove();
    frames.stop();
    m.close();
  };
}
