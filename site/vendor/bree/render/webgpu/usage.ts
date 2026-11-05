// The DOM types declare WebGPU's interfaces but not its flag namespaces, so the spec's values are here.

export const BUFFER = { MAP_READ: 0x1, COPY_SRC: 0x4, COPY_DST: 0x8, UNIFORM: 0x40, STORAGE: 0x80 };
export const TEXTURE = { TEXTURE_BINDING: 0x4, RENDER_ATTACHMENT: 0x10 };
export const STAGE = { VERTEX: 0x1, FRAGMENT: 0x2, COMPUTE: 0x4 };
