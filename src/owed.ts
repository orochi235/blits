/**
 * By subject number, the laned voices whose first meeting with the subject its probes fold on the
 * general path this fill, after the lanes' values. Subjects meeting the same voices share one list.
 */
export class Owed {
  /** By subject number, the fill it owes in, and which of `lists` it owes. */
  private fill = new Int32Array(0);
  private at = new Int32Array(0);
  private readonly lists: number[][] = [];
  /** The fill now under way. */
  private now = 0;

  /** A fill begins: nobody owes anything. */
  begin(fill: number): void {
    this.now = fill;
    this.lists.length = 0;
  }

  /** Makes room for subject numbers below `cap`. */
  grow(cap: number): void {
    const fill = new Int32Array(cap);
    fill.set(this.fill);
    this.fill = fill;
    const at = new Int32Array(cap);
    at.set(this.at);
    this.at = at;
  }

  /** Whether the subject at `slot` owes some laned voice this fill. */
  owes(slot: number): boolean {
    return this.lists.length > 0 && this.fill[slot] === this.now;
  }

  /** Whether the subject at `slot` owes voice `id` this fill. */
  owesVoice(slot: number, id: number): boolean {
    return (this.lists[this.at[slot] as number] as number[]).includes(id);
  }

  /** The subject at `slot` owes the voices `met`, which the caller may reuse after. */
  owe(slot: number, met: readonly number[]): void {
    if (!this.last(met)) this.lists.push(met.slice());
    this.fill[slot] = this.now;
    this.at[slot] = this.lists.length - 1;
  }

  /** Whether `met` is the last list a subject came to owe this fill. */
  last(met: readonly number[]): boolean {
    const last = this.lists[this.lists.length - 1];
    if (last === undefined || last.length !== met.length) return false;
    for (let i = 0; i < met.length; i++) if (last[i] !== met[i]) return false;
    return true;
  }
}
