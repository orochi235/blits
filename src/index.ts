export type { LastOptions, NumberOptions, NumberTuple, Vec } from './channels.js';
export { kit, last, max, mul, sum, vec } from './channels.js';
export type { ColorOptions } from './color.js';
export { color, css, mixHex, oklab, toHex } from './color.js';
export type { Curve } from './easing.js';
export { curve } from './easing.js';
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
