/** A WebGPU device and the canvas format to draw to it in. */
export interface Gpu {
  readonly device: GPUDevice;
  readonly format: GPUTextureFormat;
  /** Settles when the device is lost or destroyed. Never rejects. */
  readonly lost: Promise<void>;
}

/** Asks the browser for a WebGPU device. Null where there is no WebGPU, no adapter or no device. */
export async function gpu(): Promise<Gpu | null> {
  const api = typeof navigator === 'undefined' ? undefined : navigator.gpu;
  if (!api) return null;
  try {
    const adapter = await api.requestAdapter();
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    return {
      device,
      format: api.getPreferredCanvasFormat(),
      lost: device.lost.then(
        () => {},
        () => {},
      ),
    };
  } catch {
    return null;
  }
}
