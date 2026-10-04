import { useEffect, useRef, useState } from 'react';
import type { StageSpec } from '../composition';
import type { Columns } from '../player';
import type { Subject } from '../stage';
import { drawDots, drawLetters, pickAt } from './draw';
import s from './Stage.module.css';

export interface StageProps {
  stage: StageSpec;
  subjects: readonly Subject[];
  columns: Columns;
  /** The player mutates `columns` in place; a new frame number is what triggers a redraw. */
  frame: number;
  picked: number | null;
  onPick(i: number | null): void;
}

export function Stage({ stage, subjects, columns, frame, picked, onPick }: StageProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: frame stands in for the in-place column writes
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx || box.w === 0 || box.h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(box.w * dpr);
    const ph = Math.round(box.h * dpr);
    if (el.width !== pw) el.width = pw;
    if (el.height !== ph) el.height = ph;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (stage.kind === 'dots') drawDots(ctx, stage, columns, box.w, box.h, picked);
    else drawLetters(ctx, subjects, columns, box.w, box.h, picked);
  }, [stage, subjects, columns, frame, picked, box]);

  return (
    <canvas
      ref={canvas}
      className={s.stage}
      aria-label="stage"
      onPointerDown={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onPick(pickAt(stage, subjects, e.clientX - r.left, e.clientY - r.top, r.width, r.height));
      }}
    />
  );
}
