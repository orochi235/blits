import type { GpuDevice } from '../../src/gpu/webgpu.js';

type Test = { name: string; fn: (device: GpuDevice) => Promise<void> };
const tests: Test[] = [];
const say = (e: object) => console.log(`__gpu__ ${JSON.stringify(e)}`);

/** Registers a test; it runs with the page's one device. */
export function test(name: string, fn: Test['fn']): void {
  tests.push({ name, fn });
}

/** Throws where `got` is not within f32 tolerance of `want`. */
export function close(got: number, want: number, what: string): void {
  if (!(Math.abs(got - want) <= 1e-5 + 1e-4 * Math.abs(want)))
    throw new Error(`${what}: GPU ${got}, CPU ${want}`);
}

export async function runAll(): Promise<void> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<any> } }).gpu;
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
  buffer: any,
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
