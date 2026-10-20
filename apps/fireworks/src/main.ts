import './app.css';
import { mix } from '@msb235/blits';
import { mount } from '@msb235/blits-panel';
import { drive as driveSparks } from '@msb235/blits-quarks';
import { drive as driveSound } from '@msb235/blits-tone';
import * as Tone from 'tone';
import { BURSTS, cue, KIT, type Pose, type Shell, type Sound, shell } from './show';
import { createSky } from './sky';
import { createSounds } from './sound';

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const canvas = el<HTMLCanvasElement>('sky');
const start = el<HTMLButtonElement>('start');
const launchButton = el<HTMLButtonElement>('launch');
const auto = el<HTMLInputElement>('auto');
const rate = el<HTMLInputElement>('rate');
const rateOut = el<HTMLOutputElement>('rate-out');

/** A gap between frames this long is a hidden tab coming back, and is left out of the show. */
const AWAY_MS = 250;

// The debugger panel, in dev only; mounted before the mix so the mix can scrub back. `?nopanel`
// leaves it off, for the DevTools extension alone.
if (import.meta.env.DEV && !new URLSearchParams(location.search).has('nopanel')) mount();

const m = mix<Shell, Pose>(KIT, {
  name: 'show',
  labelOf: (s: Shell) => `shell at x ${s.x.toFixed(1)}`,
});
const sky = createSky(canvas);
const sparks = driveSparks(m, { kit: KIT, bursts: BURSTS });

start.addEventListener('click', async () => {
  await Tone.start();
  const sounds = createSounds();
  const sound = driveSound<Shell, Pose, Sound>(m, {
    take: (item, time) => {
      if ('hit' in item) sounds.play(item.event, time);
      return undefined;
    },
  });

  const launch = (s: Shell) => {
    sparks.attach(s, sky.system, { at: [s.x, 0, 0] });
    const whistle = sounds.borrow();
    if (whistle) sound.attach(s, whistle);
    cue(m, s).done.then(() => {
      sparks.detach(s);
      if (whistle) {
        sound.detach(s);
        sounds.giveBack(whistle);
      }
      m.drop(s);
    });
  };

  launchButton.disabled = false;
  launchButton.addEventListener('click', () => launch(shell()));
  canvas.addEventListener('click', (event) => {
    const { x, y } = sky.toWorld(event.clientX, event.clientY);
    launch(shell(x, Math.max(2.5, y)));
  });
  rate.addEventListener('input', () => {
    m.ramp(Number(rate.value), 200);
    rateOut.value = `${Number(rate.value).toFixed(2)}×`;
  });

  let last = performance.now();
  let next = last;
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    let gap = now - last;
    last = now;
    if (gap > AWAY_MS) {
      m.rebase();
      gap = 0;
    }
    if (auto.checked && now >= next) {
      launch(shell());
      next = now + (350 + Math.random() * 900) / Math.max(m.rate, 0.1);
    }
    m.sync(now);
    const dt = gap * m.rate;
    sparks.write();
    sound.write();
    sky.render(dt / 1000);
  };
  start.hidden = true;
  requestAnimationFrame(frame);
});
