import { angle, type Channel, quat, sum, type Vec, vec } from '@msb235/blits';

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
