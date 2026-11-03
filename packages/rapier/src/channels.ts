import { angle, type Channel, last, quat, sum, type Vec, vec } from '@msb235/blits';

/** The channels a 2D world reads and writes: a body's pose, and the push on its controls. */
export interface Pose2 {
  position: Vec<2>;
  rotation: number;
  force: Vec<2>;
  torque: number;
}

/** The channels a 3D world reads and writes: a body's pose, and the push on its controls. */
export interface Pose3 {
  position: Vec<3>;
  rotation: Vec<4>;
  force: Vec<3>;
  torque: Vec<3>;
}

/** A 2D world's channels, to spread into a kit. */
export const channels2: { [K in keyof Pose2]: Channel<Pose2[K]> } = {
  position: vec(2, sum()),
  rotation: angle(),
  force: vec(2, sum()),
  torque: sum(),
};

/** A 3D world's channels, to spread into a kit. */
export const channels3: { [K in keyof Pose3]: Channel<Pose3[K]> } = {
  position: vec(3, sum()),
  rotation: quat(),
  force: vec(3, sum()),
  torque: vec(3, sum()),
};

/**
 * Where a voice on a kinematic 2D body's controls moves it: a position and an angle in radians. Each
 * has no rest, so a body with no voice writing it stays where it is. A voice's weight only switches
 * its goal on or off, and of the voices writing one, the last cued wins.
 */
export interface Kinematic2 {
  goal?: Vec<2>;
  facing?: number;
}

/** Where a voice on a kinematic 3D body's controls moves it: a position and an `[x, y, z, w]` quaternion. See `Kinematic2`. */
export interface Kinematic3 {
  goal?: Vec<3>;
  facing?: Vec<4>;
}

const along = (a: number, b: number, u: number) => a + (b - a) * u;

/** A kinematic 2D body's channels, to spread into a kit beside `channels2`. */
export const kinematic2: { [K in keyof Kinematic2]-?: Channel<NonNullable<Kinematic2[K]>> } = {
  goal: vec(2, last({ lerp: along })),
  facing: last({ lerp: angle({ turn: 2 * Math.PI }).lerp }),
};

/** A kinematic 3D body's channels, to spread into a kit beside `channels3`. */
export const kinematic3: { [K in keyof Kinematic3]-?: Channel<NonNullable<Kinematic3[K]>> } = {
  goal: vec(3, last({ lerp: along })),
  facing: last({ lerp: quat().lerp }),
};
