export type { NumberOptions } from './channels.js';
export { kit, last, max, mul, sum, vec } from './channels.js';
export type { ColorOptions } from './color.js';
export { color, css, hex, mixHex, oklab, toHex } from './color.js';
export type { Claim, Fit, FitPlan, Order, SpanClaim, Strength } from './fit.js';
export {
  chain,
  collapse,
  compress,
  layout,
  lenient,
  overlap,
  overrun,
  plain,
  skip,
  stretch,
} from './fit.js';
export { mix, mixer } from './mixer.js';
export type { Motion, Moving, PerSubject, Value } from './motion.js';
export { glide, spring, tween } from './motion.js';
export type { KeysOptions, PatchOptions } from './patch.js';
export { keys, patch } from './patch.js';
export { gate, lag, level, peak, slew } from './signals.js';
export type { Ticked, Ticker, TickerOptions } from './ticker.js';
export { ticker } from './ticker.js';
export { transport } from './transport.js';
export type {
  Anchor,
  BookedHit,
  Booker,
  BookOptions,
  Channel,
  Columns,
  Doubt,
  Easing,
  Engine,
  FadeOptions,
  FadeSpec,
  Fitted,
  Handle,
  Hit,
  Keyframe,
  Kit,
  Mark,
  Marked,
  Mix,
  MixOptions,
  MotionSpec,
  OwnerSpec,
  Patch,
  Placement,
  Projection,
  Query,
  Sent,
  Setting,
  Signal,
  SpanHandle,
  SpanHints,
  SpanSpec,
  Tape,
  TapeBranch,
  TapeMaker,
  TapeOp,
  Transport,
  TransportOptions,
  TransportProjection,
  VoiceSpec,
} from './types.js';
