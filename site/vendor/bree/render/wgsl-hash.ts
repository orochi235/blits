/**
 * `hash` in `hash.ts`, in WGSL: `bree_hash_u32` gives the 32 bits TS divides by 2^32, bit for bit,
 * and `bree_hash` that value as f32, which rounds to 24 bits. A threshold test that must agree
 * with TS compares the bits against `hashThreshold` rather than comparing the f32.
 */
export const HASH_WGSL = `fn bree_hash_u32(x: i32, y: i32, z: i32) -> u32 {
  var h = (bitcast<u32>(x + 1) * 0x27d4eb2du) ^ (bitcast<u32>(y + 1) * 0x165667b1u) ^ (bitcast<u32>(z) * 0x9e3779b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  return h ^ (h >> 13u);
}
fn bree_hash(x: i32, y: i32, z: i32) -> f32 {
  return f32(bree_hash_u32(x, y, z)) * 2.3283064365386963e-10;
}`;

/**
 * The least `bree_hash_u32` at which `hash` reaches `p`. Above 0xffffffff, as it is for any `p`
 * within 2^-32 of 1 or past it, no hash reaches `p`; that value does not fit a u32.
 */
export function hashThreshold(p: number): number {
  return Math.max(0, Math.ceil(p * 0x1_0000_0000));
}
