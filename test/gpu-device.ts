import type { GpuBuffer, GpuDevice } from '../src/gpu/webgpu.js';

interface Fake extends GpuBuffer {
  readonly label: string;
  readonly data: ArrayBuffer;
  /** A map is pending. */
  mapping: boolean;
  mapped: boolean;
  destroyed: boolean;
}

type Command =
  | { kind: 'copy'; src: Fake; at: number; dst: Fake; to: number; size: number }
  | { kind: 'dispatch' };

const prefix = 'blits gpu ';

/**
 * A WebGPU device in memory, for unit tests. Buffers are backed by `ArrayBuffer`s, `submit` runs the
 * recorded copies in order, and maps stay pending until `settle()` (or `refuse()`). The `log`, `made`
 * and `destroyed` name buffers by their label less its `blits gpu ` prefix.
 */
export function fakeDevice(opts: { compile?: 'held' } = {}) {
  const log: string[] = [];
  const destroyed: string[] = [];
  const count = new Map<string, number>();
  const written = new Map<string, Float32Array>();
  const maps: { resolve: () => void; reject: (e: Error) => void; buffer: Fake }[] = [];
  const held: (() => void)[] = [];
  let dispatches: ((out: Float32Array, serial: number) => void)[] = [];
  let serial = 0;
  let out: Fake | null = null;
  let lose = () => {};
  const lost = new Promise<void>((resolve) => {
    lose = resolve;
  });

  const nameOf = (label: string | undefined) =>
    label === undefined ? '' : label.startsWith(prefix) ? label.slice(prefix.length) : label;

  /** Throws where WebGPU would refuse the submit: a destroyed buffer, or one mapped or mapping. */
  const usable = (b: Fake) => {
    if (b.destroyed) throw new Error(`a copy used ${b.label}, which was destroyed`);
    if (b.mapped || b.mapping) throw new Error(`a copy used ${b.label} while it was mapped`);
  };

  const run = (c: Command) => {
    if (c.kind === 'copy') {
      usable(c.src);
      usable(c.dst);
      log.push(`copy ${c.src.label}->${c.dst.label} ${c.at}+${c.size}`);
      new Uint8Array(c.dst.data, c.to, c.size).set(new Uint8Array(c.src.data, c.at, c.size));
      return;
    }
    log.push('dispatch');
    serial++;
    if (out !== null) for (const f of dispatches) f(new Float32Array(out.data), serial);
  };

  const pass = (commands: Command[]) => ({
    setPipeline() {},
    setBindGroup() {},
    dispatchWorkgroups() {
      commands.push({ kind: 'dispatch' });
    },
    end() {},
  });

  const device = {
    queue: {
      writeBuffer(b: GpuBuffer, at: number, data: ArrayBufferView) {
        const f = b as Fake;
        log.push(`write ${f.label}`);
        new Uint8Array(f.data, at, data.byteLength).set(
          new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
        );
        written.set(
          f.label,
          new Float32Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 4)).slice(),
        );
      },
      submit(commands: readonly unknown[]) {
        for (const list of commands) for (const c of list as Command[]) run(c);
        log.push('submit');
      },
      onSubmittedWorkDone: async () => {},
    },
    lost,
    createBuffer(desc: {
      size: number;
      usage: number;
      label?: string;
      mappedAtCreation?: boolean;
    }): GpuBuffer {
      const label = nameOf(desc.label);
      count.set(label, (count.get(label) ?? 0) + 1);
      const made: Fake = {
        label,
        data: new ArrayBuffer(desc.size),
        size: desc.size,
        mapping: false,
        mapped: desc.mappedAtCreation === true,
        destroyed: false,
        mapAsync() {
          log.push(`map ${label}`);
          if (made.destroyed || made.mapping || made.mapped)
            return Promise.reject(
              new Error(`${label} cannot map: it is destroyed, mapping or mapped`),
            );
          made.mapping = true;
          return new Promise<void>((resolve, reject) => {
            maps.push({
              resolve: () => {
                made.mapping = false;
                made.mapped = true;
                resolve();
              },
              reject: (e) => {
                made.mapping = false;
                reject(e);
              },
              buffer: made,
            });
          });
        },
        getMappedRange() {
          if (!made.mapped) throw new Error(`${label} is not mapped`);
          return made.data;
        },
        unmap() {
          made.mapped = false;
        },
        destroy() {
          made.destroyed = true;
          made.mapped = false;
          if (desc.label?.startsWith(prefix)) destroyed.push(label);
          for (let i = maps.length - 1; i >= 0; i--) {
            const m = maps[i] as (typeof maps)[number];
            if (m.buffer !== made) continue;
            maps.splice(i, 1);
            m.reject(new Error(`${label} was destroyed while mapping`));
          }
        },
      };
      if (desc.label === `${prefix}out`) out = made;
      return made;
    },
    createShaderModule: () => ({}),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createComputePipelineAsync: () =>
      new Promise((resolve) => {
        const done = () => resolve({ getBindGroupLayout: () => ({}) });
        if (opts.compile === 'held') held.push(done);
        else done();
      }),
    createBindGroup: () => ({}),
    createCommandEncoder() {
      const commands: Command[] = [];
      return {
        beginComputePass: () => pass(commands),
        copyBufferToBuffer(src: GpuBuffer, at: number, dst: GpuBuffer, to: number, size: number) {
          commands.push({ kind: 'copy', src: src as Fake, at, dst: dst as Fake, to, size });
        },
        finish: () => commands,
      };
    },
  } as unknown as GpuDevice;

  return {
    device,
    log,
    destroyed,
    /** Writes into a buffer's contents directly, as a kernel would. */
    fill(buffer: GpuBuffer, f: (data: Float32Array) => void) {
      f(new Float32Array((buffer as Fake).data));
    },
    onDispatch(f: (out: Float32Array, serial: number) => void) {
      dispatches = [...dispatches, f];
    },
    /** Resolves every pipeline held by `compile: 'held'`. */
    compiled() {
      for (const done of held.splice(0)) done();
    },
    /** Resolves every pending map in order, then lets their handlers run. */
    async settle() {
      for (const m of maps.splice(0)) m.resolve();
      await new Promise((r) => setTimeout(r, 0));
    },
    /** Rejects every pending map. */
    refuse() {
      for (const m of maps.splice(0)) m.reject(new Error('the map was refused'));
    },
    lose: () => lose(),
    /** How many buffers were made under `label`. */
    made: (label: string) => count.get(label) ?? 0,
    /** The last data written to the buffer labeled `label`. */
    written: (label: string) => written.get(label),
  };
}
