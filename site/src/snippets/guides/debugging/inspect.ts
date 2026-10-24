import { type Kit, mix, watched } from '@msb235/blits';

interface Part {
  id: string;
  el: HTMLElement;
}
interface Pose {
  y: number;
}
declare const PART: Kit<Pose>;
declare const part: Part;
// ---
// A name for the mix and a label for each subject, for debuggers and error messages.
const m = mix<Part, Pose>(PART, { name: 'sign: letters', labelOf: (p: Part) => `letter ${p.id}` });

// Every voice still in the mix, and what each gives one subject.
for (const h of m.voices()) {
  console.log(h.id, h.state, h.weightOf(part));
}

// Every mix on the page, whichever copy of blits made it.
for (const entry of watched().entries()) {
  console.log(entry.id, entry.name, entry.channels, entry.label(part));
}
