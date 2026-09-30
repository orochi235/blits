/** The site's colors, read from its CSS tokens so a canvas follows light and dark with the page. */
export interface Ink {
  paper: string;
  ink: string;
  soft: string;
  rule: string;
  /** A voice's color: `v1`..`v3` name the three voice slots, anything else is used as given. */
  voice(color: string): string;
}

export function readInk(el: Element): Ink {
  const css = getComputedStyle(el);
  const get = (name: string) => css.getPropertyValue(name).trim();
  const slots: Record<string, string> = {
    v1: get('--voice-1'),
    v2: get('--voice-2'),
    v3: get('--voice-3'),
  };
  return {
    paper: get('--paper'),
    ink: get('--ink'),
    soft: get('--ink-soft'),
    rule: get('--rule'),
    voice: (color) => slots[color] ?? color,
  };
}
