import { color, type Handle, kit, mix, mul, patch, toHex } from '@msb235/blits';
import { checkPatch } from '@msb235/blits/testing';
import { createHistory } from '@weasel-js/history';
import {
  type GlowHost,
  type GlowPose,
  glowChannels,
  type Lamp,
  near,
  pulse,
} from '../../snippets/guides/patch-library/glow';
import { loop } from '../loop';

interface Bulb extends Lamp {
  el: HTMLElement;
}
interface Flicker {
  phase: number;
}

type Fault = 'undeclared' | 'shared' | 'subject' | 'unpack';
const FAULTS: [Fault, string][] = [
  ['undeclared', 'Write tint, undeclared'],
  ['shared', 'Share one state'],
  ['subject', 'Change the subject'],
  ['unpack', 'Drop unpack'],
];

/** A stateful flicker in the glow library's shape, with whichever faults are switched on. */
function flicker(faults: ReadonlySet<Fault>) {
  const shared: Flicker = { phase: 0 };
  return patch<Lamp, GlowPose, Flicker>(
    0,
    (_phase, lamp, setting) => {
      if (faults.has('subject')) (lamp as Lamp & { seen?: number }).seen = setting.state.phase;
      const glow = 0.4 * (0.5 - 0.5 * Math.cos(2 * Math.PI * setting.state.phase));
      return faults.has('undeclared') ? { glow, tint: [0.6, 0.1, 0.1, 1] } : { glow };
    },
    {
      writes: ['glow'],
      kit: glowChannels,
      state: () => (faults.has('shared') ? shared : { phase: 0 }),
      step: (state, dt, lamp) => {
        state.phase = (state.phase + (dt * (1 + lamp.x / 400)) / 900) % 1;
      },
      pack: (state) => state.phase,
      unpack: faults.has('unpack') ? undefined : (data) => ({ phase: data as number }),
    },
  );
}

const COUNT = 5;
const FAR = -10_000;
/** Lines the checkPatch readout holds room for. */
const LINES = 6;

export default function run(root: HTMLElement): () => void {
  const wrap = document.createElement('div');
  wrap.className = 'rig';
  const stage = document.createElement('div');
  stage.className = 'glow-lamps';
  const bulbs: Bulb[] = Array.from({ length: COUNT }, () => {
    const el = document.createElement('span');
    el.className = 'glow-lamp';
    stage.append(el);
    return { x: 0, y: 0, el };
  });
  const faultRow = document.createElement('div');
  faultRow.className = 'rig-row';
  const toggles = FAULTS.map(([fault, text]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    b.setAttribute('aria-pressed', 'false');
    faultRow.append(b);
    return [fault, b] as const;
  });
  const checked = document.createElement('p');
  checked.className = 'rig-read';
  const clashRow = document.createElement('div');
  clashRow.className = 'rig-row';
  const clashButton = document.createElement('button');
  clashButton.type = 'button';
  clashButton.textContent = 'Cue pulse where glow is mul()';
  clashRow.append(clashButton);
  const refused = document.createElement('p');
  refused.className = 'rig-read glow-refused';
  wrap.append(stage, faultRow, checked, clashRow, refused);
  root.append(wrap);

  // The host's own kit, the library's channels spread into it, and the host object patches read.
  const host: GlowHost = { pointer: { x: FAR, y: 0 } };
  const m = mix<Bulb, GlowPose, GlowHost>(kit<GlowPose>({ ...glowChannels }), {
    name: 'patch-library: lamps',
    labelOf: (b: Bulb) => `lamp ${bulbs.indexOf(b) + 1}`,
    host,
    history: { ms: 10_000, every: 250, tape: createHistory },
  });
  m.cue({ patch: pulse, subjects: bulbs, loop: true, weight: 0.5, name: 'pulse' });
  m.cue({ patch: near, subjects: bulbs, name: 'near' });

  // Every place is measured from the stage's center, the lamps' from where the layout put them.
  const measure = () => {
    const box = stage.getBoundingClientRect();
    for (const b of bulbs) {
      const r = b.el.getBoundingClientRect();
      b.x = r.left + r.width / 2 - box.left - box.width / 2;
      b.y = r.top + r.height / 2 - box.top - box.height / 2;
    }
    return box;
  };
  measure();
  stage.addEventListener('pointermove', (e) => {
    const box = measure();
    host.pointer.x = e.clientX - box.left - box.width / 2;
    host.pointer.y = e.clientY - box.top - box.height / 2;
    m.touch();
  });
  stage.addEventListener('pointerleave', () => {
    host.pointer.x = FAR;
    m.touch();
  });

  const faults = new Set<Fault>();
  let flickering: Handle<Bulb> | undefined;
  const recue = () => {
    const p = flicker(faults);
    const problems = checkPatch(p, { subject: { x: 0, y: 0 }, kit: glowChannels });
    const lines = [
      'checkPatch(flicker, { subject, kit: glowChannels })',
      ...(problems.length === 0 ? ['  []'] : problems.map((s) => `  ${s}`)),
    ];
    for (let i = lines.length; i < LINES; i++) lines.push(' ');
    checked.textContent = lines.join('\n');
    flickering?.fade({ over: 300 });
    flickering = m.cue({ patch: p, subjects: bulbs, fade: { in: 300 }, name: 'flicker' });
  };
  for (const [fault, b] of toggles)
    b.addEventListener('click', () => {
      if (faults.has(fault)) faults.delete(fault);
      else faults.add(fault);
      b.setAttribute('aria-pressed', String(faults.has(fault)));
      recue();
    });
  recue();

  const clashKit = kit<GlowPose>({ glow: mul(), tint: color() });
  clashButton.addEventListener('click', () => {
    const other = mix<Bulb, GlowPose>(clashKit, { name: 'patch-library: mul host' });
    try {
      other.cue({ patch: pulse, loop: true });
      refused.textContent = 'cue took it';
    } catch (e) {
      refused.textContent = (e as Error).message;
    } finally {
      other.close();
    }
  });
  refused.textContent = ' ';

  const pose = m.pose();
  const stop = loop(m, root, (now) => {
    m.sync(now);
    for (const b of bulbs) {
      m.probe(b, pose);
      b.el.style.setProperty('--glow', Math.min(1, pose.glow).toFixed(3));
      b.el.style.setProperty(
        '--tint',
        `#${toHex(pose.tint, 0xffffff).toString(16).padStart(6, '0')}`,
      );
    }
  });

  return () => {
    stop();
    m.close();
  };
}
