import { useEffect, useRef, useState } from 'react';
import type { StageSpec } from '../composition';
import type { Columns } from '../player';
import type { Subject } from '../stage';
import { DEFAULT_PALETTE, drawDots, drawLetters, type Palette, pickAt } from './draw';
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

interface Box {
  w: number;
  h: number;
  palette: Palette;
}

function measure(el: HTMLCanvasElement): Box {
  const r = el.getBoundingClientRect();
  const css = getComputedStyle(el);
  const token = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    w: r.width,
    h: r.height,
    palette: {
      base: token('--wzl-accent', DEFAULT_PALETTE.base),
      pick: token('--wzl-danger', DEFAULT_PALETTE.pick),
    },
  };
}

export function Stage({ stage, subjects, columns, frame, picked, onPick }: StageProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const update = () => setBox(measure(el));
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const scheme = window.matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', update);
    return () => {
      ro.disconnect();
      scheme.removeEventListener('change', update);
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: frame stands in for the in-place column writes
  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx || !box || box.w === 0 || box.h === 0) return;
    const { w, h, palette } = box;
    const dpr = window.devicePixelRatio || 1;
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (el.width !== pw) el.width = pw;
    if (el.height !== ph) el.height = ph;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (stage.kind === 'dots') drawDots(ctx, stage, columns, w, h, picked, palette);
    else drawLetters(ctx, subjects, columns, w, h, picked, palette);
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
