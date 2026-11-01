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
}

const two: Dims = {
  n: 2,
  vector: (v) => ({ x: v[0] ?? 0, y: v[1] ?? 0 }),
  position: (b) => {
    const t = b.translation();
    return [t.x, t.y];
  },
  rotation: (b) => b.rotation() as number,
  torque: (b, t) => b.addTorque((typeof t === 'number' ? t : (t[0] ?? 0)) as never, true),
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
};

/** The 3D build where the module has `Vector3`, else the 2D. */
export function dimsOf(rapier: RapierModule): Dims {
  return 'Vector3' in rapier ? three : two;
}
