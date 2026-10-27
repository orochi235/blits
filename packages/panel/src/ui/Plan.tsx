import type { MarkInfo, VoiceInfo } from '../protocol.js';
import { hueColor } from './hue.js';
import { type Lane, lanesOf } from './lanes.js';
import { clockText } from './time.js';

const LANE = 30;
const MAX_LANES = 12;
/** Roughly how wide one character of a 9 px label draws, for keeping labels apart. */
const CHAR_PX = 5.2;

const CSS = `
.bp-plan { margin: 0 0 8px; display: grid; gap: 2px; font-variant-numeric: tabular-nums; }
.bp-plan svg { display: block; overflow: visible; }
.bp-plan-text { font-family: var(--wzl-font-ui); font-size: 9px; fill: var(--wzl-fg-muted); }
.bp-plan-name { font-family: var(--wzl-font-ui); font-size: 10px; fill: var(--wzl-fg); }
.bp-plan-ahead { fill: var(--wzl-fg); opacity: 0.05; }
.bp-plan-bar { opacity: 0.4; }
.bp-plan-tick { stroke-width: 1.5; }
.bp-plan-said { stroke: var(--wzl-fg-muted); stroke-dasharray: 3 3; stroke-width: 1; }
.bp-plan-playhead { stroke: var(--wzl-danger); stroke-width: 1; }
`;

export interface PlanProps {
  marks: readonly MarkInfo[];
  voices: readonly VoiceInfo[];
  range: readonly [number, number];
  playhead: number;
  width?: number;
}

/**
 * The plan on the plots' time axis: a lane per voice from its start to its end, an arrow where
 * no end is known, a tick at each mark, and what the host announced across them all.
 */
export function Plan({ marks, voices, range, playhead, width = 320 }: PlanProps) {
  const [xMin, xMax] = range;
  const { lanes, announced: all } = lanesOf(marks, voices);
  const announced = all.filter((m) => m.at >= xMin && m.at <= xMax);
  const shown = lanes.slice(0, MAX_LANES);
  const x = (t: number) => ((Math.min(xMax, Math.max(xMin, t)) - xMin) / (xMax - xMin)) * width;
  const rows = shown.length + (announced.length > 0 ? 1 : 0);
  const height = Math.max(1, rows) * LANE;
  const head = Number.isFinite(playhead) ? x(playhead) : null;
  const ahead = Number.isFinite(playhead) ? xMax - playhead : 0;
  return (
    <figure className="bp-plan" aria-label="plan">
      <style>{CSS}</style>
      <figcaption className="bp-plot-label">
        plan{ahead > 0 ? `, ${clockText(ahead)} ahead` : ''}
        {lanes.length > shown.length && ` · ${lanes.length - shown.length} more voices`}
      </figcaption>
      <svg width={width} height={height} role="img" aria-label="plan">
        {head !== null && (
          <rect className="bp-plan-ahead" x={head} y={0} width={width - head} height={height} />
        )}
        {rows === 0 && (
          <text className="bp-plan-text" x={4} y={LANE / 2 + 3}>
            nothing planned
          </text>
        )}
        {shown.map((l, i) => (
          <LaneRow key={l.voice} lane={l} y={i * LANE} x={x} xMin={xMin} xMax={xMax} />
        ))}
        {announced.map((m) => (
          <line
            key={`said-${m.name}-${m.at}`}
            className="bp-plan-said"
            x1={x(m.at)}
            x2={x(m.at)}
            y1={0}
            y2={height}
          >
            <title>{markTitle(m)}</title>
          </line>
        ))}
        {announced.length > 0 && (
          <g transform={`translate(0 ${shown.length * LANE})`}>
            <text className="bp-plan-name" x={2} y={10}>
              announced
            </text>
            {labels(announced, x).map(({ m, show }) => (
              <g key={`a-${m.name}-${m.at}`}>
                <path
                  d={`M${x(m.at)} 12l4 4l-4 4l-4 -4z`}
                  fill="var(--wzl-fg)"
                  aria-label={markTitle(m)}
                >
                  <title>{markTitle(m)}</title>
                </path>
                {show && (
                  <text className="bp-plan-text" x={x(m.at) + 6} y={LANE - 2}>
                    {m.name ?? ''}
                  </text>
                )}
              </g>
            ))}
          </g>
        )}
        {head !== null && (
          <line className="bp-plan-playhead" x1={head} x2={head} y1={0} y2={height} />
        )}
      </svg>
    </figure>
  );
}

function LaneRow({
  lane,
  y,
  x,
  xMin,
  xMax,
}: {
  lane: Lane;
  y: number;
  x: (t: number) => number;
  xMin: number;
  xMax: number;
}) {
  const color = hueColor(lane.hue);
  const x0 = x(lane.from);
  const open = !(lane.to <= xMax);
  const x1 = open ? x(xMax) - 6 : x(lane.to);
  const ends =
    lane.to === Number.POSITIVE_INFINITY
      ? 'no end known: plays on'
      : `gone at ${clockText(lane.to)}`;
  return (
    <g transform={`translate(0 ${y})`} aria-label={`${lane.label}: ${ends}`}>
      <text className="bp-plan-name" x={Math.max(2, Math.min(x0, x(xMax) - 60)) + 2} y={9}>
        {lane.label}
      </text>
      {x1 > x0 && (
        <rect className="bp-plan-bar" x={x0} y={13} width={x1 - x0} height={5} fill={color} />
      )}
      {open && (
        <path d={`M${x1} 10l6 5.5l-6 5.5z`} fill={color}>
          <title>{ends}</title>
        </path>
      )}
      {labels(
        lane.marks.filter((m) => m.at >= xMin && m.at <= xMax),
        x,
      ).map(({ m, show }) => (
        <g key={`${m.mark}-${m.at}`}>
          <line className="bp-plan-tick" x1={x(m.at)} x2={x(m.at)} y1={10} y2={21} stroke={color}>
            <title>{markTitle(m)}</title>
          </line>
          {show && (
            <text className="bp-plan-text" x={x(m.at) + 2} y={LANE - 2}>
              {m.mark ?? ''}
            </text>
          )}
        </g>
      ))}
    </g>
  );
}

/** Which marks have room for their label beside them, left to right. */
function labels(marks: readonly MarkInfo[], x: (t: number) => number) {
  let free = Number.NEGATIVE_INFINITY;
  return marks.map((m) => {
    const at = x(m.at);
    const text = (m.voice === null ? m.name : m.mark) ?? '';
    const show = at >= free;
    if (show) free = at + 4 + text.length * CHAR_PX;
    return { m, show };
  });
}

function markTitle(m: MarkInfo): string {
  const what =
    m.voice === null ? `announced ${m.name ?? ''}` : `${m.name ?? `#${m.voice}`} ${m.mark}`;
  return `${what} at ${clockText(m.at)}`;
}
