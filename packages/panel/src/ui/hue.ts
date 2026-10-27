export const hueColor = (hue: number) => `hsl(${hue} 70% 62%)`;

/** A voice's hue, the same in every view that draws it. */
export const voiceHue = (id: number) => (id * 67) % 360;
