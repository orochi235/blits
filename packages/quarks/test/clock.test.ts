import { kit, mix, patch, transport } from '@msb235/blits';
import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { channels, drive, type Emission } from '../src/index.js';
import { hold, type Spot, system } from './fixtures.js';

const K = kit<Emission>(channels);
const a: Spot = { id: 'a' };

/** Sends a burst of one at every step. */
const tick = () =>
  patch<Spot, Emission, { n: number }>(0, () => ({}), {
    writes: [],
    state: () => ({ n: 0 }),
    step: (st, _dt, _subject, setting) => {
      st.n++;
      setting.send({ count: 1 });
    },
  });

describe('the clock', () => {
  it('emits on a shared transport, by its time and its rate', () => {
    const t = transport();
    const m = mix<Spot, Emission>(K, { transport: t, name: 'sparks' });
    const s = system();
    m.cue({ patch: hold({ rate: 10 }), subjects: [a] });
    const q = drive(m, { kit: K });
    q.attach(a, s, { at: [0, 0, 0] });
    for (let f = 0; f <= 10; f++) {
      t.sync(f * 100);
      q.write();
    }
    expect(s.particleNum).toBe(10);
    t.rate = 0.5;
    for (let f = 11; f <= 20; f++) {
      t.sync(f * 100);
      q.write();
    }
    expect(s.particleNum).toBe(15);
    t.rate = 0;
    for (let f = 21; f <= 30; f++) {
      t.sync(f * 100);
      q.write();
    }
    expect(s.particleNum).toBe(15);
  });

  it('catches a long frame up in full, past the mix’s maxDt', () => {
    const m = mix<Spot, Emission>(K, { maxDt: 50 });
    const s = system();
    m.cue({ patch: hold({ rate: 10 }), subjects: [a] });
    const q = drive(m, { kit: K });
    q.attach(a, s, { at: [0, 0, 0] });
    m.sync(0);
    q.write();
    m.sync(2000);
    q.write();
    expect(s.particleNum).toBe(20);
  });
});

describe('a seek', () => {
  function setup(rate: number) {
    const m = mix<Spot, Emission>(K, { history: { ms: 60_000, tape } });
    const s = system();
    m.cue({ patch: hold({ rate }), subjects: [a] });
    const q = drive(m, { kit: K });
    q.attach(a, s, { at: [0, 0, 0] });
    for (let f = 0; f <= 10; f++) {
      m.sync(f * 100);
      q.write();
    }
    return { m, s, q };
  }

  it('back leaves particles alive, and owes the frame after it when written at the seek', () => {
    const { m, s, q } = setup(10);
    expect(s.particleNum).toBe(10);
    m.seek(500);
    q.write();
    expect(s.particleNum).toBe(10);
    m.sync(1100);
    q.write();
    expect(s.particleNum).toBe(11);
  });

  it('ahead, while the host is not syncing, owes nothing when written at the seek', () => {
    const { m, s, q } = setup(10);
    m.seek(m.now + 5000);
    q.write();
    m.rebase();
    m.sync(60_000);
    q.write();
    expect(s.particleNum).toBe(10);
  });

  it('back plays the bursts patches send again', () => {
    const m = mix<Spot, Emission>(K, { history: { ms: 60_000, tape } });
    const s = system();
    m.cue({ patch: tick(), subjects: [a], tags: ['sparks'] });
    const q = drive(m, { kit: K, bursts: 'sparks' });
    q.attach(a, s, { at: [0, 0, 0] });
    for (let f = 0; f <= 5; f++) {
      m.sync(f * 100);
      q.write();
    }
    const before = s.particleNum;
    m.seek(200);
    q.write();
    for (let f = 6; f <= 8; f++) {
      m.sync(f * 100);
      q.write();
    }
    expect(s.particleNum).toBe(before + 3);
  });
});
