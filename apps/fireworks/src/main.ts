import './app.css';
import { mount } from '@msb235/blits-panel';
import { drive as driveSparks } from '@msb235/blits-quarks';
import { drive as driveSound } from '@msb235/blits-tone';
import * as Tone from 'tone';
import { createFrame } from './frame';
import { BURSTS, createShow, cue, KIT, type Pose, type Shell, type Sound, shell } from './show';
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

// The debugger panel, in dev only. `?nopanel` leaves it off, for the DevTools extension alone.
if (import.meta.env.DEV && !new URLSearchParams(location.search).has('nopanel')) mount();

const m = createShow();
const sky = createSky(canvas);
const sparks = driveSparks(m, { kit: KIT, bursts: BURSTS });

start.addEventListener('click', async () => {
  // A second click while the audio context resumes would start a second show.
  start.disabled = true;
  try {
    await Tone.start();
  } catch (error) {
    start.disabled = false;
    throw error;
  }
  const sounds = createSounds();
  const sound = driveSound<Shell, Pose, Sound>(m, {
    take: (item, time) => {
      if (!('hit' in item)) return undefined;
      // A hit is the bloom's, whose one subject is the shell.
      const fired = item.subjects?.[0];
      if (fired !== undefined) sounds.play(item.event, fired, time);
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
  // The slider shows the mix's rate, which a seek back or the panel also sets, except mid-drag.
  let dragging = false;
  rate.addEventListener('pointerdown', () => {
    dragging = true;
  });
  window.addEventListener('pointerup', () => {
    dragging = false;
  });
  rate.addEventListener('input', () => m.ramp(Number(rate.value), 200));
  const showRate = () => {
    rateOut.value = `${m.rate.toFixed(2)}×`;
    if (!dragging && rate.valueAsNumber !== m.rate) rate.valueAsNumber = m.rate;
  };

  const step = createFrame(m, { launch: () => launch(shell()), auto: () => auto.checked });
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const seconds = step(now);
    showRate();
    sparks.write();
    sound.write();
    sky.render(seconds);
  };
  start.hidden = true;
  requestAnimationFrame(frame);
});
