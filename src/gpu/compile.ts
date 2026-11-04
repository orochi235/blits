import { type Kernel, kernel } from './kernel.js';
import type { Runner } from './runner.js';
import type { GpuBindGroupLayout, GpuComputePipeline, GpuDevice } from './webgpu.js';
import type { ChannelCode } from './wgsl/channels.js';

declare const console: { error(message: string): void };

/** A kernel and its pipeline, null until it compiles. */
export interface Built {
  readonly kernel: Kernel;
  pipeline: GpuComputePipeline | null;
  failed: boolean;
}

const layouts = new WeakMap<GpuDevice, GpuBindGroupLayout>();

/**
 * The kernel's bindings, given outright: 'auto' would drop a buffer a kernel never reads, such as
 * the values of runners with no parameters.
 */
export function layoutOf(device: GpuDevice): GpuBindGroupLayout {
  let made = layouts.get(device);
  if (made === undefined) {
    const COMPUTE = 4;
    const type = [
      'read-only-storage',
      'read-only-storage',
      'read-only-storage',
      'uniform',
      'storage',
      'read-only-storage',
    ];
    made = device.createBindGroupLayout({
      entries: type.map((t, binding) => ({ binding, visibility: COMPUTE, buffer: { type: t } })),
    });
    layouts.set(device, made);
  }
  return made;
}

/** Builds the kernel and starts compiling it; `compiled` settles when its pipeline is ready. */
export function compile(
  device: GpuDevice,
  key: string,
  runners: readonly Runner[],
  channels: ReadonlyMap<string, ChannelCode>,
  n: number,
  types: ReadonlyMap<string, ChannelCode>,
): { built: Built; compiled: Promise<void> } {
  const k = kernel(runners, channels, n, types);
  const built: Built = { kernel: k, pipeline: null, failed: false };
  const module = device.createShaderModule({ code: k.code, label: `blits gpu ${key}` });
  const compiled = device
    .createComputePipelineAsync({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layoutOf(device)] }),
      compute: { module, entryPoint: 'main' },
      label: key,
    })
    .then(
      (p) => {
        built.pipeline = p;
      },
      async (err: unknown) => {
        built.failed = true;
        const info = await module.getCompilationInfo?.();
        const said =
          info?.messages.map((m) => `line ${m.lineNum}: ${m.message}`).join('\n') ?? String(err);
        console.error(
          `blits: the gpu engine's kernel did not compile; its channels stay on the CPU\n${said}`,
        );
        throw err;
      },
    );
  return { built, compiled };
}
