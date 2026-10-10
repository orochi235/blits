export type { NumberOptions, Vec } from './channels.js';
export { kit, last, max, mul, sum, vec } from './channels.js';
export type { ColorOptions } from './color.js';
export { color, css, hex, mixHex, oklab, toHex } from './color.js';
export type { Claim, Fit, FitPlan, Order, SpanClaim, Strength } from './fit.js';
export {
  conclude,
  condense,
  lax,
  layout,
  overrun,
  pipe,
  plain,
  shed,
} from './fit.js';
export { mix, mixer } from './mixer.js';
export type { Motion, Moving, PerSubject, Value } from './motion.js';
export { glide, spring, tween } from './motion.js';
export { HistoryMiss } from './paging.js';
export type { KeysOptions, PatchOptions } from './patch.js';
export { keys, patch } from './patch.js';
export type { AngleOptions } from './rotation.js';
export { angle, quat } from './rotation.js';
export { gate, input, lag, level, peak, slew } from './signals.js';
export { fold } from './stack.js';
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
  Described,
  Doubt,
  Easing,
  Engine,
  FadeOptions,
  FadeSpec,
  FitResult,
  Handle,
  HistoryOptions,
  HistoryStore,
  Hit,
  Keyframe,
  Kit,
  Mark,
  Marked,
  Mix,
  MixOptions,
  MotionSpec,
  OwnerSpec,
  Paged,
  PagedStream,
  Patch,
  Placement,
  Projection,
  Query,
  SeekOptions,
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
export type { WaveOptions, WaveShape } from './wave.js';
export { wave, waveAt, waveOptionsOf } from './wave.js';
