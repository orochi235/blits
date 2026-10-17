import { MAX_PASSES, type Scale, shownEnd } from './geometry';
import type { Clip, ScoreMark } from './index';
import s from './ScoreLanes.module.css';

/** Named times down the whole score, each labeled on the ruler. */
export function MarkLines(p: {
  marks: readonly ScoreMark[];
  scale: Scale;
  duration: number;
  height: number;
}) {
  return (
    <g className={s.mark} aria-hidden>
      {p.marks
        .filter((m) => m.at >= 0 && m.at <= p.duration)
        .map((m) => (
          <g key={`${m.label} ${m.at}`}>
            <line x1={p.scale.x(m.at)} x2={p.scale.x(m.at)} y1={0} y2={p.height} />
            <text x={p.scale.x(m.at) - 3} y={15}>
              {m.label}
            </text>
          </g>
        ))}
    </g>
  );
}

/** When each of a clip's ticks falls, every pass, up to `viewEnd`. */
export function tickTimes(c: Clip, viewEnd: number): number[] {
  const ticks = c.ticks ?? [];
  const end = Math.min(shownEnd(c), viewEnd);
  const out: number[] = [];
  const first = c.start - (c.into ?? 0);
  const passes = c.pass > 0 ? Math.min(c.passes + 1, MAX_PASSES) : 1;
  for (let i = 0; i < passes && first + i * c.pass <= end; i++)
    for (const at of ticks) {
      const t = first + i * c.pass + at;
      if (t >= c.start - 1e-9 && t < end - 1e-9 && out.length < MAX_PASSES) out.push(t);
    }
  return out;
}

/** A clip's ticks: a notch on its top edge wherever one falls. */
export function ClipTicks(p: { clip: Clip; scale: Scale; top: number; duration: number }) {
  return <Notches times={tickTimes(p.clip, p.duration)} scale={p.scale} top={p.top} />;
}

/** A notch hanging from `top` at each of `times`, score ms. */
export function Notches(p: { times: readonly number[]; scale: Scale; top: number }) {
  return (
    <>
      {p.times.map((t) => {
        const x = p.scale.x(t);
        return (
          <path
            key={t}
            className={s.tick}
            d={`M${x - 3} ${p.top} L${x} ${p.top + 6} L${x + 3} ${p.top} Z`}
          />
        );
      })}
    </>
  );
}

/** Named times inside a clip or a header's bar: a line across it from `top`, `h` tall, labeled. */
export function InnerMarks(p: {
  marks: readonly ScoreMark[];
  scale: Scale;
  top: number;
  h: number;
  duration: number;
}) {
  return (
    <g className={s.inner} aria-hidden>
      {p.marks
        .filter((m) => m.at >= 0 && m.at <= p.duration)
        .map((m) => {
          const x = p.scale.x(m.at);
          return (
            <g key={m.label}>
              <line x1={x} x2={x} y1={p.top} y2={p.top + p.h} />
              <text x={x + 2} y={p.top + p.h - 2}>
                {m.label}
              </text>
            </g>
          );
        })}
    </g>
  );
}
