/** The words in reading order. Each is a page at `/<slug>/` and a TypeDoc `@category`. */
export const words = [
  { slug: 'channel', title: 'Channel and kit' },
  { slug: 'patch', title: 'Patch' },
  { slug: 'voice', title: 'Voice' },
  { slug: 'mix', title: 'Mix' },
  { slug: 'signal', title: 'Signal' },
  { slug: 'time', title: 'Time' },
  { slug: 'blending', title: 'Blending' },
  { slug: 'locus', title: 'Locus' },
  { slug: 'score', title: 'Score' },
  { slug: 'state', title: 'Patch state' },
  { slug: 'engine', title: 'Engine' },
] as const;

export type Word = (typeof words)[number]['slug'];

export const extra = [
  { slug: 'reference', title: 'Reference' },
  { slug: 'klieg', title: 'klieg' },
] as const;
