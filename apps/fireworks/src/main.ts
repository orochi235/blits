import './app.css';
import { mount } from '@msb235/blits-panel';
import { drive as driveSparks } from '@msb235/blits-quarks';
import { drive as driveSound } from '@msb235/blits-tone';
import * as Tone from 'tone';
import { createFrame } from './frame';
import { createLauncher } from './launch';
import {
  AUTO,
  BURSTS,
  createShow,
  KIT,
  keepLaunching,
  launching,
  type Pose,
  type Shell,
  type Sound,
  shell,
} from './show';
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

  const launcher = createLauncher(m, {
    sparks: {
      attach: (s) => sparks.attach(s, sky.system, { at: [s.x, 0, 0] }),
      detach: (s) => sparks.detach(s),
    },
    sound,
    whistles: sounds,
  });
  const launch = (s: Shell) => {
    launcher.launch(s);
  };

  launchButton.disabled = false;
  launchButton.addEventListener('click', () => launch(shell()));
  canvas.addEventListener('click', (event) => {
    const { x, y } = sky.toWorld(event.clientX, event.clientY);
    launch(shell(x, Math.max(2.5, y)));
  });
  // The slider shows the mix's rate, which a seek back or the panel also sets, except mid-drag
  // and while its own ramp runs, when the live rate would snap the thumb back a step.
  const RAMP_MS = 200;
  let dragging = false;
  let ramping = Number.NEGATIVE_INFINITY;
  rate.addEventListener('pointerdown', () => {
    dragging = true;
  });
  const drop = () => {
    dragging = false;
  };
  window.addEventListener('pointerup', drop);
  window.addEventListener('pointercancel', drop);
  rate.addEventListener('input', () => {
    ramping = performance.now() + RAMP_MS;
    m.ramp(Number(rate.value), RAMP_MS);
  });
  const showRate = () => {
    rateOut.value = `${m.rate.toFixed(2)}×`;
    const settled = !dragging && performance.now() >= ramping;
    if (settled && rate.valueAsNumber !== m.rate) rate.valueAsNumber = m.rate;
  };

  // The box shows whether the voice that keeps launching plays, which a seek back also sets.
  const showAuto = () => {
    const on = launching(m);
    if (auto.checked !== on) auto.checked = on;
  };
  auto.addEventListener('change', () => {
    if (auto.checked) keepLaunching(m);
    else for (const h of m.voices(AUTO)) if (h.state !== 'fading') h.fade({ over: 1 });
  });

  const step = createFrame(m);
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    const seconds = step(now);
    launcher.tend();
    showAuto();
    showRate();
    sparks.write();
    sound.write();
    sky.render(seconds);
  };
  start.hidden = true;
  // Synced at this frame's time first, so the pacer starts its first pass here rather than at 0.
  m.sync(Number(document.timeline.currentTime ?? performance.now()));
  if (auto.checked) keepLaunching(m);
  requestAnimationFrame(frame);
});
