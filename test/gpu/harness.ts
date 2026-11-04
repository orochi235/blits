import type { GpuBuffer, GpuDevice } from '../../src/gpu/webgpu.js';

type Test = { name: string; fn: (device: GpuDevice) => Promise<void> };
const tests: Test[] = [];
const say = (e: object) => console.log(`__gpu__ ${JSON.stringify(e)}`);

/** Registers a test; it runs with the page's one device. */
export function test(name: string, fn: Test['fn']): void {
  tests.push({ name, fn });
}

/** Throws where `got` is not within f32 tolerance of `want`. */
export function close(got: number, want: number, what: string, absolute = 1e-5): void {
  if (!(Math.abs(got - want) <= absolute + 1e-4 * Math.abs(want)))
    throw new Error(`${what}: GPU ${got}, CPU ${want}`);
}

const f32 = new Float32Array(1);
const bits = new Uint32Array(f32.buffer);

/** The f32 `step` places from `t` (negative for down), as the GPU might have rounded it. */
function nudge(t: number, step: number): number {
  f32[0] = Math.fround(t);
  if (f32[0] === 0) return step > 0 ? 2 ** -149 : -(2 ** -149);
  const b = bits[0] as number;
  bits[0] = (f32[0] as number) > 0 === step > 0 ? b + 1 : b - 1;
  return f32[0] as number;
}

/**
 * Like `close`, but a branchy case (a `steps` jump) also passes where the CPU, evaluated at `t`
 * moved one f32 step either way, would have given `got`.
 */
export function closeNear(
  got: number,
  cpuAt: (t: number) => number,
  t: number,
  what: string,
): void {
  const tries = [t, nudge(t, -1), nudge(t, 1)];
  for (const at of tries) {
    try {
      close(got, cpuAt(at), what);
      return;
    } catch {}
  }
  throw new Error(`${what}: GPU ${got}, CPU ${cpuAt(t)} at ${t} (and one f32 step either way)`);
}

export async function runAll(): Promise<void> {
  type Adapter = {
    info?: { vendor?: string; architecture?: string };
    requestDevice(): Promise<unknown>;
  };
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<Adapter | null> } }).gpu;
  const adapter = await gpu?.requestAdapter();
  if (!adapter) {
    say({ kind: 'result', i: 1, n: 1, ok: false, name: 'WebGPU adapter', error: 'none' });
    say({ kind: 'done' });
    return;
  }
  say({ kind: 'adapter', info: `${adapter.info?.vendor} ${adapter.info?.architecture}` });
  const device = (await adapter.requestDevice()) as GpuDevice;
  for (const [k, t] of tests.entries()) {
    try {
      await t.fn(device);
      say({ kind: 'result', i: k + 1, n: tests.length, ok: true, name: t.name });
    } catch (e) {
      say({
        kind: 'result',
        i: k + 1,
        n: tests.length,
        ok: false,
        name: t.name,
        error: String((e as Error)?.stack ?? e),
      });
    }
  }
  say({ kind: 'done' });
}

/** Reads `bytes` of a GPU buffer from `offset` back into floats. */
export async function readBack(
  device: GpuDevice,
  buffer: GpuBuffer,
  offset: number,
  bytes: number,
): Promise<Float32Array> {
  const read = device.createBuffer({ size: bytes, usage: 0x0001 | 0x0008 });
  const enc = device.createCommandEncoder();
  enc.copyBufferToBuffer(buffer, offset, read, 0, bytes);
  device.queue.submit([enc.finish()]);
  await read.mapAsync(1);
  const out = new Float32Array(read.getMappedRange().slice(0));
  read.unmap();
  read.destroy();
  return out;
}
