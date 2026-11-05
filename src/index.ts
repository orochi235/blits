export type { MatrixParts } from './affine.js';
export { affine, matrix, partsOf } from './affine.js';
export type { BlendMode } from './blend-modes.js';
export { add, blendMode, darken, lighten, multiply, screen } from './blend-modes.js';
export type { LastOptions, NumberOptions, NumberTuple, Vec } from './channels.js';
export { kit, last, max, mul, sum, vec } from './channels.js';
export type { ColorOptions } from './color.js';
export { color, css, ink, mixHex, oklab, toHex } from './color.js';
export type { Curve } from './easing.js';
export { curve } from './easing.js';
export type { NormOptions } from './extremes.js';
export { min, norm } from './extremes.js';
export type {
  Claim,
  Fit,
  FitPlan,
  Layout,
  Order,
  OverrunOptions,
  SpanClaim,
  Strength,
} from './fit.js';
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
export type {
  Glide,
  GlideOptions,
  Motion,
  MotionOptions,
  Moving,
  PerSubject,
  Spring,
  SpringOptions,
  Tween,
  TweenOptions,
  Value,
} from './motion.js';
export { glide, spring, tween } from './motion.js';
export { HistoryMiss } from './paging.js';
export type { KeysOptions, PatchOptions } from './patch.js';
export { keys, patch } from './patch.js';
export type { AngleOptions } from './rotation.js';
export { angle, quat } from './rotation.js';
export type { Input, LagOptions, Level, SlewOptions } from './signals.js';
export { gate, input, lag, level, peak, share, slew } from './signals.js';
export { fold } from './stack.js';
export {
  colorBurn,
  colorDodge,
  colorMode,
  darkerColor,
  difference,
  divide,
  exclusion,
  hardLight,
  hardMix,
  hue,
  lighterColor,
  linearBurn,
  linearLight,
  luminosity,
  overlay,
  pinLight,
  saturation,
  softLight,
  subtract,
  vividLight,
} from './stack-rules.js';
export type { OrderedMode, StackOptions } from './stacked-modes.js';
export { layersOf } from './stacked-modes.js';
export type { Ticked, Ticker, TickerOptions } from './ticker.js';
export { ticker } from './ticker.js';
export { transport } from './transport.js';
export type {
  Anchor,
  AnnounceOptions,
  ArcHandle,
  ArcPart,
  ArcSpec,
  ArcVoice,
  Band,
  Bend,
  BlendMember,
  BookedHit,
  Booker,
  BookOptions,
  Channel,
  Circle,
  Columns,
  Described,
  Doubt,
  Easing,
  Engine,
  FadeOptions,
  FadeSpec,
  Finder,
  FitResult,
  GlideSpec,
  Handle,
  HistoryOptions,
  HistoryStore,
  Hit,
  Hold,
  Keyframe,
  Kit,
  Mark,
  Marked,
  MarkName,
  Mix,
  MixOptions,
  MotionSpec,
  NumberChannel,
  OwnerSpec,
  Paged,
  PagedStream,
  Patch,
  Placement,
  Probed,
  Projection,
  Pulled,
  Query,
  Registry,
  RegistryChange,
  Run,
  SeekOptions,
  Sent,
  Setting,
  Signal,
  Sought,
  SpanHandle,
  SpanHints,
  SpanSpec,
  SpringSpec,
  SubjectFade,
  Taken,
  Tape,
  TapeBranch,
  TapeMaker,
  TapeOp,
  TapeOptions,
  Trace,
  TraceOptions,
  Transport,
  TransportOptions,
  TransportProjection,
  TweenSpec,
  VoiceFade,
  VoiceSpec,
  Watched,
  WatchedFrame,
  WatchedHistory,
  WatchedVoice,
} from './types.js';
export { watched } from './watch.js';
export type { WaveOptions, WaveShape } from './wave.js';
export { wave, waveAt } from './wave.js';
