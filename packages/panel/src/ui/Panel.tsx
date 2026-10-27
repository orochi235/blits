import { type ReactNode, useEffect, useReducer, useRef, useState } from 'react';
import type {
  Event,
  HoldInfo,
  MarkInfo,
  MixInfo,
  Source,
  SubjectInfo,
  VoiceInfo,
} from '../protocol.js';
import { Samples } from '../store.js';
import { Plots } from './Plots.js';
import { clockText } from './time.js';

interface State {
  mixes: MixInfo[];
  mix: number | null;
  subject: number | null;
  subjects: SubjectInfo[];
  voices: VoiceInfo[];
  marks: MarkInfo[];
  hold: HoldInfo;
  arming: boolean;
  circles: boolean;
  /** Bumped as samples arrive, so the plots draw again. */
  drawn: number;
}

const initial: State = {
  mixes: [],
  mix: null,
  subject: null,
  subjects: [],
  voices: [],
  marks: [],
  hold: { state: 'free', rate: 1, now: Number.NaN, reach: Number.NaN },
  arming: false,
  circles: false,
  drawn: 0,
};

type Action = Event | { kind: 'drawn' };

function reduce(s: State, a: Action): State {
  switch (a.kind) {
    case 'mixes':
      return { ...s, mixes: a.mixes };
    case 'picked':
      return { ...s, mix: a.mix, subject: a.subject, subjects: a.mix === s.mix ? s.subjects : [] };
    case 'subjects':
      return { ...s, subjects: a.subjects };
    case 'voices':
      return { ...s, voices: a.voices };
    case 'marks':
      return { ...s, marks: a.marks };
    case 'hold':
      return { ...s, hold: a.hold };
    case 'arming':
      return { ...s, arming: a.on };
    case 'circles':
      return { ...s, circles: a.on };
    case 'drawn':
      return { ...s, drawn: s.drawn + 1 };
    default:
      // An agent newer than this panel may send kinds it does not know.
      return s;
  }
}

const RATES = [0, 0.1, 0.25, 0.5, 1, 2];
const STEP_MS = 1000 / 60;
const PLACE = 'blits-panel:place';

/** Where the window was left, kept per viewer; the corner when nothing was kept. */
function placed(): { x: number; y: number; open: boolean } {
  try {
    const kept = JSON.parse(localStorage.getItem(PLACE) ?? 'null');
    if (kept && typeof kept.x === 'number' && typeof kept.y === 'number') return kept;
  } catch {}
  return { x: 16, y: 16, open: false };
}
function keep(p: { x: number; y: number; open: boolean }) {
  try {
    localStorage.setItem(PLACE, JSON.stringify(p));
  } catch {}
}

/** Keeps at least the panel's corner on screen, so a place kept from a larger window stays reachable. */
function onScreen(x: number, y: number): { x: number; y: number } {
  const w = typeof innerWidth === 'number' ? innerWidth : 1024;
  const h = typeof innerHeight === 'number' ? innerHeight : 768;
  return {
    x: Math.min(Math.max(0, x), Math.max(0, w - 120)),
    y: Math.min(Math.max(0, y), Math.max(0, h - 40)),
  };
}

export interface PanelProps {
  source: Source;
  /** Fills its container, with no pill and no dragging: for a host such as a DevTools tab. */
  docked?: boolean;
  /** More controls for the top bar, from the host. */
  bar?: ReactNode;
}

/** The panel: a pill in a corner that opens into a window over the page, or docked, the window alone. */
export function Panel({ source, docked = false, bar }: PanelProps) {
  const [s, dispatch] = useReducer(reduce, initial);
  const samples = useRef(new Samples());
  const [place, setPlace] = useState(() => {
    const p = placed();
    return { ...p, ...onScreen(p.x, p.y) };
  });
  const [query, setQuery] = useState('');
  const [hovered, setHovered] = useState<number | null>(null);
  // A row can vanish under the pointer, which then never leaves it: clear its outline here.
  useEffect(() => {
    if (hovered !== null && !s.subjects.some((x) => x.id === hovered)) {
      setHovered(null);
      source.send({ kind: 'outline', subject: null });
    }
  }, [hovered, s.subjects, source]);
  const frontier = useRef(Number.NEGATIVE_INFINITY);

  useEffect(() => {
    // Samples and the clock come every frame of the mix; both are drawn at most once a frame here.
    let queued = 0;
    let hold: HoldInfo | null = null;
    const draw = () => {
      queued = 0;
      if (hold !== null) dispatch({ kind: 'hold', hold });
      hold = null;
      dispatch({ kind: 'drawn' });
    };
    const later = () => {
      if (queued === 0) queued = requestAnimationFrame(draw);
    };
    const off = source.subscribe((e) => {
      if (e.kind === 'samples') {
        if (e.reset) samples.current.reset();
        for (const x of e.samples) samples.current.push(x);
        later();
      } else if (e.kind === 'hold') {
        hold = e.hold;
        later();
      } else dispatch(e);
    });
    return () => {
      off();
      if (queued !== 0) cancelAnimationFrame(queued);
    };
  }, [source]);

  const send = source.send.bind(source);
  const mix = s.mixes.find((m) => m.id === s.mix);
  const held = s.hold.state === 'held';
  if (held && s.hold.now > frontier.current) frontier.current = s.hold.now;
  if (!held) frontier.current = Number.NEGATIVE_INFINITY;

  const move = (open: boolean, x = place.x, y = place.y) => {
    const next = { ...onScreen(x, y), open };
    setPlace(next);
    keep(next);
  };

  const drag = (ev: React.PointerEvent) => {
    if ((ev.target as Element).closest('button, select, input')) return;
    const from = { x: ev.clientX - place.x, y: ev.clientY - place.y };
    const target = ev.currentTarget as HTMLElement;
    target.setPointerCapture(ev.pointerId);
    const open = place.open;
    const onMove = (e: PointerEvent) => move(open, e.clientX - from.x, e.clientY - from.y);
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      target.removeEventListener('lostpointercapture', onUp);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
    target.addEventListener('lostpointercapture', onUp);
  };

  const clock = (
    <>
      <button
        type="button"
        className={held ? 'bp-on' : ''}
        disabled={mix === undefined}
        title={
          s.hold.state === 'elsewhere'
            ? 'held elsewhere: try again'
            : held
              ? 'free the clock'
              : 'hold the clock'
        }
        onClick={() => send({ kind: 'hold', on: !held })}
      >
        {held ? '▶' : '⏸'}
      </button>
      <button
        type="button"
        disabled={!held}
        title="step one frame"
        onClick={() => send({ kind: 'step', ms: STEP_MS })}
      >
        ⏭
      </button>
      <input
        type="range"
        className="bp-scrub"
        aria-label="scrub"
        disabled={!held || !(frontier.current > s.hold.reach)}
        min={held ? s.hold.reach : 0}
        max={held ? frontier.current : 1}
        step="any"
        value={held ? s.hold.now : 0}
        onChange={(e) => send({ kind: 'seek', to: Number(e.currentTarget.value) })}
      />
    </>
  );

  if (!docked && !place.open)
    return (
      <div className="bp-pill" style={{ left: place.x, top: place.y }} onPointerDown={drag}>
        <span className="bp-name">{mix?.name ?? 'blits'}</span>
        {clock}
        <button type="button" title="open" onClick={() => move(true)}>
          ⤢
        </button>
        <span className="bp-time">{clockText(s.hold.now)}</span>
      </div>
    );

  const shown = s.subjects.filter((x) => x.label.toLowerCase().includes(query.toLowerCase()));
  return (
    <div
      className={docked ? 'bp-window bp-docked' : 'bp-window'}
      style={docked ? undefined : { left: place.x, top: place.y }}
    >
      <div className="bp-bar" onPointerDown={docked ? undefined : drag}>
        <select
          aria-label="mix"
          value={s.mix ?? ''}
          onChange={(e) =>
            send({
              kind: 'mix',
              id: e.currentTarget.value === '' ? null : Number(e.currentTarget.value),
            })
          }
        >
          <option value="">pick a mix</option>
          {s.mixes.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        {clock}
        <select
          aria-label="rate"
          disabled={!held}
          value={s.hold.rate}
          onChange={(e) => send({ kind: 'rate', rate: Number(e.currentTarget.value) })}
        >
          {RATES.map((r) => (
            <option key={r} value={r}>
              ×{r}
            </option>
          ))}
        </select>
        {bar}
        {!docked && (
          <button type="button" title="collapse" onClick={() => move(false)}>
            ⤡
          </button>
        )}
        <span className="bp-time">{clockText(s.hold.now)}</span>
      </div>
      {mix !== undefined && <Notes mix={mix} hold={s.hold} />}
      <div className="bp-body">
        <div className="bp-side">
          <div className="bp-row">
            <button
              type="button"
              className={s.arming ? 'bp-on' : ''}
              disabled={mix === undefined && s.mixes.length === 0}
              title="pick a subject on the page"
              onClick={() => send({ kind: 'arm', on: !s.arming })}
            >
              ◎ pick
            </button>
            <input
              className="bp-search"
              placeholder="subjects"
              aria-label="filter subjects"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
            />
          </div>
          <ul className="bp-list" aria-label="subjects">
            {shown.map((x) => (
              <li key={x.id}>
                <button
                  type="button"
                  className={x.id === s.subject ? 'bp-item bp-on' : 'bp-item'}
                  onClick={() => send({ kind: 'subject', id: x.id })}
                  onPointerEnter={() => {
                    setHovered(x.id);
                    send({ kind: 'outline', subject: x.id });
                  }}
                  onPointerLeave={() => {
                    setHovered(null);
                    send({ kind: 'outline', subject: null });
                  }}
                >
                  {x.label}
                </button>
              </li>
            ))}
          </ul>
          <div className="bp-row">
            <h3 className="bp-head">voices</h3>
            <button
              type="button"
              className={s.circles ? 'bp-on' : ''}
              disabled={!s.circles && !s.voices.some((v) => v.bounded)}
              title="draw each bounded voice's circle on the page"
              onClick={() => send({ kind: 'circles', on: !s.circles })}
            >
              ◯ circles
            </button>
          </div>
          <ul className="bp-list" aria-label="voices">
            {s.voices.map((v) => (
              <li key={v.id} className="bp-voice">
                <span>
                  {v.name ?? `#${v.id}`}
                  {v.bounded && (
                    <span className="bp-muted" title="bounded to a circle">
                      {' ◯'}
                    </span>
                  )}
                </span>
                <span className="bp-muted">{v.state}</span>
                <span className="bp-num">
                  {Number.isFinite(v.weight) ? v.weight.toFixed(2) : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <Plots
          samples={samples.current}
          drawn={s.drawn}
          voices={s.voices}
          marks={s.marks}
          playhead={s.hold.now}
          picked={s.subject !== null}
          mix={mix !== undefined}
        />
      </div>
    </div>
  );
}

function Notes({ mix, hold }: { mix: MixInfo; hold: HoldInfo }) {
  const h = mix.history;
  const note =
    h === null
      ? 'no history: made before the panel, or the panel was told not to add it, so it only pauses and steps forward'
      : !h.tape
        ? 'no tape: it only pauses and steps forward'
        : h.added
          ? `history: ${(h.ms / 1000).toFixed(0)} s, added by the debugger`
          : `history: ${(h.ms / 1000).toFixed(0)} s, its own`;
  return (
    <p className="bp-note">
      {note}
      {hold.state === 'elsewhere' && ' · its clock is held elsewhere'}
    </p>
  );
}
