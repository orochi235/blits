import { type RefObject, useEffect, useState } from 'react';
import type { Size } from './Explainer';

export function useReducedMotion(): boolean {
  const [r] = useState(
    () =>
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  return r;
}

/** A stage, its controls, and its caption fit a window about 800 px tall together. */
const MAX_STAGE_H = 400;

export function useWidth(ref: RefObject<HTMLElement | null>, aspect: number): Size {
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry?.contentRect.width ?? 0);
      setSize({ w, h: Math.min(MAX_STAGE_H, Math.round(w * aspect)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, aspect]);
  return size;
}

/** Whether the window has focus: a page behind another app stops playing, as one scrolled away does. */
export function useFocused(): boolean {
  const [on, setOn] = useState(() => typeof document === 'undefined' || document.hasFocus());
  useEffect(() => {
    const focus = () => setOn(true);
    const blur = () => setOn(false);
    window.addEventListener('focus', focus);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('focus', focus);
      window.removeEventListener('blur', blur);
    };
  }, []);
  return on;
}

export function useVisible(ref: RefObject<HTMLElement | null>): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setOn(entry?.isIntersecting ?? true));
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return on;
}
