/** A vector as Rapier takes and gives it: `z` in 3D only. */
export interface RapierVector {
  x: number;
  y: number;
  z?: number;
}

/** What blits-rapier uses of a Rapier rigid body, in either build. */
export interface RapierBody {
  readonly handle: number;
  translation(): RapierVector;
  rotation(): number | { x: number; y: number; z: number; w: number };
  addForce(force: RapierVector, wake: boolean): void;
  addTorque(torque: never, wake: boolean): void;
  applyImpulse(impulse: RapierVector, wake: boolean): void;
  resetForces(wake: boolean): void;
  resetTorques(wake: boolean): void;
  setTranslation(v: RapierVector, wake: boolean): void;
  setRotation(r: never, wake: boolean): void;
  setLinvel(v: RapierVector, wake: boolean): void;
  setAngvel(v: never, wake: boolean): void;
  setNextKinematicTranslation(v: RapierVector): void;
  setNextKinematicRotation(r: never): void;
}

/** What blits-rapier uses of a Rapier world, in either build. */
export interface RapierWorld {
  timestep: number;
  step(): void;
  takeSnapshot(): Uint8Array;
  createRigidBody(desc: never): RapierBody;
  createCollider(desc: never, parent?: never): unknown;
  getRigidBody(handle: number): RapierBody;
  removeRigidBody(body: never): void;
  free(): void;
}

/**
 * A Rapier module, `@dimforge/rapier2d-compat` or `@dimforge/rapier3d-compat` or a build like
 * them, already initialized. Which one is passed decides the dimensions.
 */
export interface RapierModule {
  World: {
    new (gravity: never): RapierWorld;
    restoreSnapshot(data: Uint8Array): RapierWorld;
  };
}

/** The arithmetic that differs between the 2D and 3D builds, behind one shape. */
export interface Dims {
  readonly n: 2 | 3;
  vector(v: readonly number[]): RapierVector;
  position(body: RapierBody): number[];
  /** An angle in 2D, `[x, y, z, w]` in 3D: what the `rotation` channel holds. */
  rotation(body: RapierBody): number | number[];
  /** Adds `torque`, a number in 2D and three numbers in 3D. */
  torque(body: RapierBody, torque: number | readonly number[]): void;
  /** Puts the body at a pose, moving at the speed it took to get there from `before` over `dt` ms. */
  place(body: RapierBody, now: Placed, before: Placed | undefined, dt: number): void;
  /** Moves a kinematic body to whichever of a position and rotation is given, over the next step. */
  aim(body: RapierBody, goal: Goal): void;
}

/** Where a kinematic body's controls ask it to be: either part may be absent. */
export interface Goal {
  position?: readonly number[];
  rotation?: number | readonly number[];
}

/** A body's position and rotation as the channels hold them. */
export interface Placed {
  position: readonly number[];
  rotation: number | readonly number[];
}

const speed = (now: readonly number[], before: readonly number[] | undefined, dt: number) =>
  now.map((x, i) => (before === undefined || dt <= 0 ? 0 : (x - (before[i] ?? x)) / (dt / 1000)));

const two: Dims = {
  n: 2,
  vector: (v) => ({ x: v[0] ?? 0, y: v[1] ?? 0 }),
  position: (b) => {
    const t = b.translation();
    return [t.x, t.y];
  },
  rotation: (b) => b.rotation() as number,
  torque: (b, t) => b.addTorque((typeof t === 'number' ? t : (t[0] ?? 0)) as never, true),
  place: (b, now, before, dt) => {
    const r = now.rotation as number;
    b.setTranslation(two.vector(now.position), true);
    b.setRotation(r as never, true);
    b.setLinvel(two.vector(speed(now.position, before?.position, dt)), true);
    let turn = before === undefined ? 0 : r - (before.rotation as number);
    turn -= 2 * Math.PI * Math.round(turn / (2 * Math.PI));
    b.setAngvel((dt > 0 ? turn / (dt / 1000) : 0) as never, true);
  },
  aim: (b, goal) => {
    if (goal.position !== undefined) b.setNextKinematicTranslation(two.vector(goal.position));
    if (goal.rotation !== undefined) b.setNextKinematicRotation(goal.rotation as never);
  },
};

const three: Dims = {
  n: 3,
  vector: (v) => ({ x: v[0] ?? 0, y: v[1] ?? 0, z: v[2] ?? 0 }),
  position: (b) => {
    const t = b.translation();
    return [t.x, t.y, t.z ?? 0];
  },
  rotation: (b) => {
    const q = b.rotation() as { x: number; y: number; z: number; w: number };
    return [q.x, q.y, q.z, q.w];
  },
  torque: (b, t) => b.addTorque(three.vector(typeof t === 'number' ? [0, 0, t] : t) as never, true),
  place: (b, now, before, dt) => {
    const [x, y, z, w] = now.rotation as readonly number[];
    b.setTranslation(three.vector(now.position), true);
    b.setRotation({ x, y, z, w } as never, true);
    b.setLinvel(three.vector(speed(now.position, before?.position, dt)), true);
    b.setAngvel(
      three.vector(
        spin(now.rotation as number[], before?.rotation as number[] | undefined, dt),
      ) as never,
      true,
    );
  },
  aim: (b, goal) => {
    if (goal.position !== undefined) b.setNextKinematicTranslation(three.vector(goal.position));
    if (goal.rotation === undefined) return;
    const [x, y, z, w] = goal.rotation as [number, number, number, number];
    // A keyed facing need not be unit length, and Rapier takes it as given.
    const n = Math.hypot(x, y, z, w) || 1;
    b.setNextKinematicRotation({ x: x / n, y: y / n, z: z / n, w: w / n } as never);
  },
};

/** The angular velocity turning `before` into `now` over `dt` ms, both `[x, y, z, w]`. */
function spin(now: readonly number[], before: readonly number[] | undefined, dt: number): number[] {
  if (before === undefined || dt <= 0) return [0, 0, 0];
  const [ax, ay, az, aw] = now as [number, number, number, number];
  const [bx, by, bz, bw] = before as [number, number, number, number];
  // now · conj(before), taken the short way round.
  let x = bw * ax - bx * aw - by * az + bz * ay;
  let y = bw * ay - by * aw - bz * ax + bx * az;
  let z = bw * az - bz * aw - bx * ay + by * ax;
  let w = bw * aw + bx * ax + by * ay + bz * az;
  if (w < 0) [x, y, z, w] = [-x, -y, -z, -w];
  const s = Math.hypot(x, y, z);
  if (s < 1e-12) return [0, 0, 0];
  const k = (2 * Math.atan2(s, w)) / s / (dt / 1000);
  return [x * k, y * k, z * k];
}

/** The 3D build where the module has `Vector3`, else the 2D. */
export function dimsOf(rapier: RapierModule): Dims {
  return 'Vector3' in rapier ? three : two;
}
