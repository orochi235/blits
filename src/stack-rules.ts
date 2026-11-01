import { rule, type StackOptions } from './stacked-modes.js';
import type { Channel } from './types.js';

/**
 * Overlay, for `color(overlay())` or `ink(overlay())`: each layer multiplies where what is under it is dark and screens where it is light, so it lifts contrast and keeps the base's lights and darks.
 *
 * @category channel
 */
export function overlay(opts?: StackOptions): Channel<number> {
  return rule('overlay', opts);
}

/**
 * Soft light, for `color(softLight())` or `ink(softLight())`: a gentler overlay, the layer dodging or burning what is under it, as the W3C compositing spec defines it.
 *
 * @category channel
 */
export function softLight(opts?: StackOptions): Channel<number> {
  return rule('softLight', opts);
}

/**
 * Hard light, for `color(hardLight())` or `ink(hardLight())`: overlay with layer and base swapped, the layer multiplying where it is dark and screening where it is light.
 *
 * @category channel
 */
export function hardLight(opts?: StackOptions): Channel<number> {
  return rule('hardLight', opts);
}

/**
 * Difference, for `color(difference())` or `ink(difference())`: each axis the distance between the layer and what is under it, so white inverts and black changes nothing.
 *
 * @category channel
 */
export function difference(opts?: StackOptions): Channel<number> {
  return rule('difference', opts);
}

/**
 * Color dodge, for `color(colorDodge())` or `ink(colorDodge())`: brightens what is under the layer by dividing it by the layer's inverse, so black changes nothing and white blows out to white.
 *
 * @category channel
 */
export function colorDodge(opts?: StackOptions): Channel<number> {
  return rule('colorDodge', opts);
}

/**
 * Color burn, for `color(colorBurn())` or `ink(colorBurn())`: darkens what is under the layer, the inverse of color dodge, so white changes nothing and black burns to black.
 *
 * @category channel
 */
export function colorBurn(opts?: StackOptions): Channel<number> {
  return rule('colorBurn', opts);
}

/**
 * Exclusion, for `color(exclusion())` or `ink(exclusion())`: a softer difference, `b + s - 2·b·s`: white inverts, black changes nothing, and middle gray grays everything.
 *
 * @category channel
 */
export function exclusion(opts?: StackOptions): Channel<number> {
  return rule('exclusion', opts);
}

/**
 * Subtract, for `color(subtract())` or `ink(subtract())`: each axis what is under the layer minus the layer, stopping at black. CSS has no such mode, so `blendMode` gives `normal`.
 *
 * @category channel
 */
export function subtract(opts?: StackOptions): Channel<number> {
  return rule('subtract', opts);
}

/**
 * Divide, for `color(divide())` or `ink(divide())`: each axis what is under the layer divided by the layer, stopping at white, so white changes nothing. CSS has no such mode, so `blendMode` gives `normal`.
 *
 * @category channel
 */
export function divide(opts?: StackOptions): Channel<number> {
  return rule('divide', opts);
}

/**
 * Linear burn, for `color(linearBurn())` or `ink(linearBurn())`: each axis the layer and what is under it added, less 1, stopping at black. CSS has no such mode, so `blendMode` gives `normal`.
 *
 * @category channel
 */
export function linearBurn(opts?: StackOptions): Channel<number> {
  return rule('linearBurn', opts);
}

/**
 * Vivid light, for `color(vividLight())` or `ink(vividLight())`: color burn where the layer is darker than middle, color dodge where it is lighter, each at twice the strength. CSS has no such mode, so `blendMode` gives `normal`.
 *
 * @category channel
 */
export function vividLight(opts?: StackOptions): Channel<number> {
  return rule('vividLight', opts);
}

/**
 * Linear light, for `color(linearLight())` or `ink(linearLight())`: linear burn where the layer is darker than middle, an add where it is lighter: `b + 2·s - 1`. CSS has no such mode, so `blendMode` gives `normal`.
 *
 * @category channel
 */
export function linearLight(opts?: StackOptions): Channel<number> {
  return rule('linearLight', opts);
}

/**
 * Pin light, for `color(pinLight())` or `ink(pinLight())`: darken where the layer is darker than middle, lighten where it is lighter, each against twice the layer. CSS has no such mode, so `blendMode` gives `normal`.
 *
 * @category channel
 */
export function pinLight(opts?: StackOptions): Channel<number> {
  return rule('pinLight', opts);
}

/**
 * Hard mix, for `color(hardMix())` or `ink(hardMix())`: each axis full on where the layer and what is under it add up to 1 or more, and off otherwise, so every color goes to one of the eight corners. CSS has no such mode, so `blendMode` gives `normal`.
 *
 * @category channel
 */
export function hardMix(opts?: StackOptions): Channel<number> {
  return rule('hardMix', opts);
}

/**
 * Hue, for `color(hue())` or `ink(hue())`: the layer's hue at the chroma and lightness of what is under it, in OKLab, so it differs from CSS's `hue`, which works in an HSL-like space. A gray layer or base has no hue to give or keep, and gives gray.
 *
 * @category channel
 */
export function hue(opts?: StackOptions): Channel<number> {
  return rule('hue', opts);
}

/**
 * Saturation, for `color(saturation())` or `ink(saturation())`: the layer's chroma at the hue and lightness of what is under it, in OKLab, so it differs from CSS's `saturation`.
 *
 * @category channel
 */
export function saturation(opts?: StackOptions): Channel<number> {
  return rule('saturation', opts);
}

/**
 * Color, for `color(colorMode())` or `ink(colorMode())`: the layer's hue and chroma at the lightness of what is under it, in OKLab, so it differs from CSS's `color`; named `colorMode` because `color` is the channel it goes in.
 *
 * @category channel
 */
export function colorMode(opts?: StackOptions): Channel<number> {
  return rule('colorMode', opts);
}

/**
 * Luminosity, for `color(luminosity())` or `ink(luminosity())`: the layer's lightness at the hue and chroma of what is under it, in OKLab, so it differs from CSS's `luminosity`.
 *
 * @category channel
 */
export function luminosity(opts?: StackOptions): Channel<number> {
  return rule('luminosity', opts);
}

/**
 * Darker color, for `color(darkerColor())` or `ink(darkerColor())`: whichever whole color is darker in OKLab, the layer or what is under it, so no axis mixes with another. CSS has no such mode, so `blendMode` gives `normal`.
 *
 * @category channel
 */
export function darkerColor(opts?: StackOptions): Channel<number> {
  return rule('darkerColor', opts);
}

/**
 * Lighter color, for `color(lighterColor())` or `ink(lighterColor())`: whichever whole color is lighter in OKLab, the layer or what is under it. CSS has no such mode, so `blendMode` gives `normal`.
 *
 * @category channel
 */
export function lighterColor(opts?: StackOptions): Channel<number> {
  return rule('lighterColor', opts);
}
