import { useCallback, useEffect, useState } from 'react';

/** The content box of the element the returned ref lands on, kept current. */
export function useSize(): [
  { width: number; height: number } | null,
  (el: HTMLElement | null) => void,
] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      setSize((s) => (s && s.width === width && s.height === height ? s : { width, height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [size, useCallback((e: HTMLElement | null) => setEl(e), [])];
}
