import { keys } from '@msb235/blits';
import { type CardPose, useStage } from './stage';

const lift = keys<HTMLElement, CardPose>(
  400,
  [
    { at: 0, delta: { y: 0, scale: 1 } },
    { at: 0.4, delta: { y: -12, scale: 1.06 }, ease: 'ease-out' },
    { at: 1, delta: { y: 0, scale: 1 }, ease: 'ease-in' },
  ],
  {},
);

export function Card({ title }: { title: string }) {
  const stage = useStage();
  return (
    <button
      type="button"
      className="card"
      ref={stage.track}
      onClick={(e) => stage.mix?.cue({ patch: lift, subjects: [e.currentTarget] })}
    >
      {title}
    </button>
  );
}
