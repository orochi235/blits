/** Labels a play/pause button for what a click does, with the glyph `glyph.css` draws. */
export function showPlay(button: HTMLElement, paused: boolean): void {
  button.textContent = paused ? 'Play' : 'Pause';
  button.dataset.glyph = paused ? 'play' : 'pause';
}
