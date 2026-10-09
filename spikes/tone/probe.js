// Throwaway spike: a blits mix driving Tone.js, read ahead onto the audio clock (`project` and
// `book`) against a host writing values each frame. Every parameter renders as a Signal straight to
// an output channel, so the rendered buffer is the curve, compared against the mix's own values.
import { keys, kit, mix, mul, patch, sum } from '/dist/index.js';

const SR = 48000;
const DUR = 4000;
const SUBJECT = 'tone';
const HITS = [0, 250, 500, 750];
// What the host does mid-flight, at the first frame at or after each time.
const RETIME = 1500;
const SEEK = 2500;

const makeKit = () => kit({ freq: sum(), gain: mul() });

function scene(m) {
  return {
    sweep: m.cue({
      patch: keys(2000, [
        { at: 0, delta: { freq: 200 } },
        { at: 0.5, delta: { freq: 800 }, ease: 'ease-in-out' },
        { at: 1, delta: { freq: 200 } },
      ]),
      start: 0,
    }),
    swell: m.cue({
      patch: patch(1000, (p) => ({ gain: 0.5 + 0.5 * Math.sin(2 * Math.PI * p) }), { writes: ['gain'] }),
      start: 0,
    }),
    notes: m.cue({
      patch: patch(1000, () => ({}), { writes: [] }),
      start: 0,
      hits: HITS.map((at) => ({ at, event: 'note' })),
    }),
  };
}

function act(h, t, done) {
  if (!done.retime && t >= RETIME) {
    h.notes.rate = 1.5;
    h.sweep.ramp(0.5, 300);
    done.retime = t;
  }
  if (!done.seek && t >= SEEK) {
    h.notes.seek(100);
    h.sweep.seek(0);
    done.seek = t;
  }
}

/** 60 fps with ±1.5 ms of jitter, a 120 ms stall at 1 s and a 200 ms one at 3.2 s. */
function frameTimes() {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const out = [];
  let stalled1 = false;
  let stalled2 = false;
  for (let f = 0; f < DUR; ) {
    out.push(f);
    let gap = 1000 / 60 + rand() * 1.5;
    if (!stalled1 && f >= 1000) (gap = 120), (stalled1 = true);
    if (!stalled2 && f >= 3200) (gap = 200), (stalled2 = true);
    f += gap;
  }
  return out;
}

/** When each note should sound, from the notes voice's clock as the host changed it. */
function truthHits(done) {
  const out = [];
  const segments = [
    { from: 0, to: done.retime, e0: 0, rate: 1 },
    { from: done.retime, to: done.seek, e0: done.retime, rate: 1.5 },
    { from: done.seek, to: DUR, e0: 100, rate: 1.5 },
  ];
  for (const s of segments) {
    const eEnd = s.e0 + (s.to - s.from) * s.rate;
    for (let pass = Math.floor(s.e0 / 1000); pass * 1000 < eEnd; pass++)
      for (const at of HITS) {
        const e = pass * 1000 + at;
        if (e < s.e0 || e >= eEnd) continue;
        // A hit exactly where a seek lands is not one the voice passes.
        if (s.from === done.seek && e === s.e0) continue;
        out.push(s.from + (e - s.e0) / s.rate);
      }
  }
  return out;
}

/** The mix's own values each ms, the host's changes made at the moments the live run made them. */
function reference(done) {
  const m = mix(makeKit());
  const h = scene(m);
  const values = [];
  const state = {};
  const changes = [done.retime, done.seek];
  const at = (c) => act(h, c === done.retime ? RETIME : SEEK, state);
  for (let t = 0; t < DUR; t++) {
    for (const c of changes)
      if (c > t - 1 && c < t) {
        m.sync(c);
        at(c);
      }
    m.sync(t);
    for (const c of changes) if (c === t) at(c);
    values.push({ ...m.probe(SUBJECT) });
  }
  return values;
}

function impulse(raw, merge, when) {
  const src = raw.createConstantSource();
  Tone.connect(src, merge, 0, 2);
  src.start(when / 1000);
  src.stop(when / 1000 + 2 / SR);
  return src;
}

async function render(mode, { step = 5, ahead = 150 } = {}) {
  const frames = frameTimes();
  const done = {};
  const buffer = await Tone.Offline(
    () => {
      const freq = new Tone.Signal(0);
      const gain = new Tone.Signal(0);
      const merge = new Tone.Merge({ channels: 3 });
      freq.connect(merge, 0, 0);
      gain.connect(merge, 0, 1);
      merge.toDestination();
      const raw = Tone.getContext().rawContext;
      const m = mix(makeKit());
      const h = scene(m);
      let audioNow = 0;
      if (mode === 'ahead')
        m.book({
          clock: () => audioNow,
          ahead,
          late: 50,
          take: (item, when) => {
            if (!('hit' in item)) return undefined;
            const src = impulse(raw, merge, when);
            return { stop: () => src.disconnect() };
          },
        });
      let prev = Number.NEGATIVE_INFINITY;
      const naiveHits = [];
      for (const f of frames) {
        audioNow = f;
        m.sync(f);
        act(h, f, done);
        if (mode === 'ahead') {
          freq.cancelAndHoldAtTime(f / 1000);
          gain.cancelAndHoldAtTime(f / 1000);
          for (let t = f; t <= f + ahead + 1e-9; t += step) {
            const p = m.project(t).probe(SUBJECT);
            freq.linearRampToValueAtTime(p.freq, t / 1000);
            gain.linearRampToValueAtTime(p.gain, t / 1000);
          }
        } else {
          const p = m.probe(SUBJECT);
          freq.setValueAtTime(p.freq, f / 1000);
          gain.setValueAtTime(p.gain, f / 1000);
          naiveHits.push([prev, f]);
        }
        prev = f;
      }
      // A frame-driven host sounds a note at the first frame past it.
      if (mode === 'frame') {
        const truth = truthHits(done);
        for (const [a, b] of naiveHits) for (const t of truth) if (t > a && t <= b) impulse(raw, merge, b);
      }
    },
    DUR / 1000,
    3,
    SR,
  );
  return { buffer, done };
}

function measure(buffer, done) {
  const ref = reference(done);
  const freq = buffer.getChannelData(0);
  const gain = buffer.getChannelData(1);
  const notes = buffer.getChannelData(2);
  const err = { freq: [], gain: [] };
  for (let t = 20; t < DUR - 1; t++) {
    const i = Math.round((t * SR) / 1000);
    err.freq.push([Math.abs(freq[i] - ref[t].freq), t]);
    err.gain.push([Math.abs(gain[i] - ref[t].gain), t]);
  }
  const stats = (list) => {
    const sorted = [...list].sort((a, b) => b[0] - a[0]);
    const rms = Math.sqrt(list.reduce((s, [e]) => s + e * e, 0) / list.length);
    return { max: sorted[0][0], rms, worstAt: sorted.slice(0, 4).map(([, t]) => t) };
  };
  let jump = 0;
  for (let i = 1; i < freq.length; i++) jump = Math.max(jump, Math.abs(freq[i] - freq[i - 1]));
  const onsets = [];
  for (let i = 0; i < notes.length; i++) if (notes[i] > 0.5 && (i === 0 || notes[i - 1] <= 0.5)) onsets.push((i * 1000) / SR);
  const truth = truthHits(done);
  const off = truth.map((t) => Math.min(...onsets.map((o) => Math.abs(o - t))));
  // The 200 ms stall at 3.2 s outlasts what was read ahead; the rest is what reading ahead covers.
  const covered = (list) => list.filter(([, t]) => t < 3200 || t > 3420);
  const stalled = (list) => list.filter(([, t]) => t >= 3200 && t <= 3420);
  return {
    freqHz: { covered: stats(covered(err.freq)), stall: stats(stalled(err.freq)) },
    gain: { covered: stats(covered(err.gain)), stall: stats(stalled(err.gain)) },
    maxFreqJumpPerSample: jump,
    notes: {
      expected: truth.length,
      sounded: onsets.length,
      meanOffMs: off.reduce((s, x) => s + x, 0) / off.length,
      maxOffMs: Math.max(...off),
      worst: truth
        .map((t, k) => [off[k], t])
        .sort((a, b) => b[0] - a[0])
        .slice(0, 3)
        .map(([o, t]) => `${t.toFixed(1)} off ${o.toFixed(2)}`),
    },
  };
}

window.probe = async (mode, opts) => {
  const { buffer, done } = await render(mode, opts);
  return measure(buffer, done);
};
window.ready = true;
