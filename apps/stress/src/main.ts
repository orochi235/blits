import './app.css';
import { grid } from '@stress/grid';
import { scenarios } from '@stress/registry';
import type { Entry, Scenario } from '@stress/scenario';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const pick = $<HTMLSelectElement>('pick');
const seedIn = $<HTMLInputElement>('seed');
const sizeIn = $<HTMLInputElement>('size');
const stage = $<HTMLCanvasElement>('stage');
const readout = $<HTMLOutputElement>('readout');
const blurb = $<HTMLElement>('blurb');
const ctx = stage.getContext('2d') as CanvasRenderingContext2D;

const SHOW_EVERY = 6;
let live: Scenario | undefined;
let entry: Entry;
let frame = 0;
let ms = 0;
let buffer = new Float64Array(0);

for (const name of Object.keys(scenarios)) pick.add(new Option(name, name));
pick.value = new URLSearchParams(location.search).get('s') ?? 'heatmap';
if (!(pick.value in scenarios)) pick.value = 'heatmap';

function start(resetSize: boolean): void {
  live?.close();
  entry = scenarios[pick.value] as Entry;
  if (resetSize || !sizeIn.value) sizeIn.value = String(entry.size);
  blurb.textContent = entry.blurb;
  live = entry.make({ seed: Number(seedIn.value) || 0, size: Number(sizeIn.value) || entry.size });
  buffer = new Float64Array(live.width);
  frame = 0;
  ms = 0;
}

function fit(): { w: number; h: number } {
  const dpr = window.devicePixelRatio || 1;
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  if (stage.width !== Math.round(w * dpr) || stage.height !== Math.round(h * dpr)) {
    stage.width = Math.round(w * dpr);
    stage.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h };
}

function show(): void {
  const f = String(frame).padStart(7);
  readout.value = `frame ${f}  step ${ms.toFixed(2).padStart(6)} ms`;
}

function tick(): void {
  const s = live as Scenario;
  const t0 = performance.now();
  s.step(frame);
  const spent = performance.now() - t0;
  ms = frame === 0 ? spent : ms * 0.95 + spent * 0.05;
  const { w, h } = fit();
  ctx.clearRect(0, 0, w, h);
  if (s.draw) s.draw(ctx, w, h);
  else {
    s.read(buffer);
    grid(ctx, buffer, w, h);
  }
  if (frame % SHOW_EVERY === 0) show();
  frame++;
  if (frame >= entry.frames) start(false);
  requestAnimationFrame(tick);
}

pick.addEventListener('change', () => start(true));
$('restart').addEventListener('click', () => start(false));
seedIn.addEventListener('change', () => start(false));
sizeIn.addEventListener('change', () => start(false));
start(true);
requestAnimationFrame(tick);
