// The part of WebGPU the gpu engine calls, declared here so the core needs no DOM library and its
// types no @webgpu/types: a host's real GPUDevice satisfies these structurally.

export interface GpuBuffer {
  readonly size: number;
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}

export interface GpuBindGroupLayout {
  readonly __brand?: 'GPUBindGroupLayout';
}

export interface GpuComputePipeline {
  getBindGroupLayout(index: number): GpuBindGroupLayout;
}

export interface GpuBindGroup {
  readonly __brand?: 'GPUBindGroup';
}

export interface GpuComputePass {
  setPipeline(pipeline: GpuComputePipeline): void;
  setBindGroup(index: number, group: GpuBindGroup): void;
  dispatchWorkgroups(x: number): void;
  end(): void;
}

export interface GpuCommandEncoder {
  beginComputePass(): GpuComputePass;
  copyBufferToBuffer(
    src: GpuBuffer,
    srcOffset: number,
    dst: GpuBuffer,
    dstOffset: number,
    size: number,
  ): void;
  finish(): unknown;
}

export interface GpuShaderModule {
  getCompilationInfo?(): Promise<{
    readonly messages: readonly {
      readonly type: string;
      readonly message: string;
      readonly lineNum: number;
    }[];
  }>;
}

/** The device a host hands the gpu engine: `await adapter.requestDevice()`. */
export interface GpuDevice {
  readonly queue: {
    writeBuffer(buffer: GpuBuffer, offset: number, data: ArrayBufferView): void;
    submit(commands: readonly unknown[]): void;
    onSubmittedWorkDone(): Promise<void>;
  };
  readonly lost: Promise<unknown>;
  readonly limits?: { readonly maxStorageBufferBindingSize?: number };
  createBuffer(desc: { size: number; usage: number; label?: string }): GpuBuffer;
  createShaderModule(desc: { code: string; label?: string }): GpuShaderModule;
  createBindGroupLayout(desc: {
    entries: readonly { binding: number; visibility: number; buffer: { type: string } }[];
  }): GpuBindGroupLayout;
  createPipelineLayout(desc: { bindGroupLayouts: readonly GpuBindGroupLayout[] }): unknown;
  createComputePipelineAsync(desc: {
    layout: unknown;
    compute: { module: GpuShaderModule; entryPoint: string };
    label?: string;
  }): Promise<GpuComputePipeline>;
  createBindGroup(desc: {
    layout: GpuBindGroupLayout;
    entries: readonly { binding: number; resource: { buffer: GpuBuffer } }[];
  }): GpuBindGroup;
  createCommandEncoder(): GpuCommandEncoder;
}

/** The least `maxStorageBufferBindingSize` WebGPU lets a device have, for one that does not say. */
export const STORAGE_LIMIT = 2 ** 27;

/** GPUBufferUsage's flags, which a page without WebGPU does not define. */
export const Usage = {
  MAP_READ: 0x0001,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
} as const;

/** GPUMapMode.READ. */
export const MAP_READ = 0x0001;
