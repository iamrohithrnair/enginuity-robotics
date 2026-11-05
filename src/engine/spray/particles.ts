// Packs spray particle transforms and colors into binary buffers.
 
 
 
 
 
 

export const PARTICLE_BYTES = 32;

export class ParticleBuffer {
  private buf: ArrayBuffer;
  private f32: Float32Array;
  private u8: Uint8Array;
  count = 0;

  constructor(capacity = 256) {
    this.buf = new ArrayBuffer(Math.max(1, capacity) * PARTICLE_BYTES);
    this.f32 = new Float32Array(this.buf);
    this.u8 = new Uint8Array(this.buf);
  }

  get capacity() {
    return this.buf.byteLength / PARTICLE_BYTES;
  }

  private grow(min: number) {
    let cap = this.capacity;
    while (cap < min) cap *= 2;
    const next = new ArrayBuffer(cap * PARTICLE_BYTES);
    new Uint8Array(next).set(this.u8.subarray(0, this.count * PARTICLE_BYTES));
    this.buf = next;
    this.f32 = new Float32Array(next);
    this.u8 = new Uint8Array(next);
  }

  push(pos: ArrayLike<number>, quat: ArrayLike<number>, rgba: ArrayLike<number>) {
    if (this.count + 1 > this.capacity) this.grow(this.count + 1);
    const i = this.count++;
    const o = i * 8;
    this.f32[o] = pos[0];
    this.f32[o + 1] = pos[1];
    this.f32[o + 2] = pos[2];
    this.f32[o + 3] = quat[0];
    this.f32[o + 4] = quat[1];
    this.f32[o + 5] = quat[2];
    this.f32[o + 6] = quat[3];
    const c = i * PARTICLE_BYTES + 28;
    for (let k = 0; k < 4; k++) this.u8[c + k] = Math.max(0, Math.min(255, Math.round((rgba[k] ?? 0) * 255)));
  }

   
  bytes(from = 0, to = this.count): Uint8Array {
    const a = Math.max(0, Math.min(from, this.count));
    const b = Math.max(a, Math.min(to, this.count));
    return this.u8.slice(a * PARTICLE_BYTES, b * PARTICLE_BYTES);
  }

   
  get(i: number): { pos: [number, number, number]; quat: [number, number, number, number]; rgba: [number, number, number, number] } {
    const o = i * 8;
    const c = i * PARTICLE_BYTES + 28;
    return {
      pos: [this.f32[o], this.f32[o + 1], this.f32[o + 2]],
      quat: [this.f32[o + 3], this.f32[o + 4], this.f32[o + 5], this.f32[o + 6]],
      rgba: [this.u8[c] / 255, this.u8[c + 1] / 255, this.u8[c + 2] / 255, this.u8[c + 3] / 255],
    };
  }
}

 
export function decodeParticles(bytes: Uint8Array): { count: number; pos: Float32Array; quat: Float32Array; rgba: Uint8Array } {
  const count = Math.floor(bytes.byteLength / PARTICLE_BYTES);
  const aligned = bytes.byteOffset % 4 === 0 ? bytes : bytes.slice();
  const f = new Float32Array(aligned.buffer, aligned.byteOffset, count * 8);
  const pos = new Float32Array(count * 3);
  const quat = new Float32Array(count * 4);
  const rgba = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = f[i * 8];
    pos[i * 3 + 1] = f[i * 8 + 1];
    pos[i * 3 + 2] = f[i * 8 + 2];
    quat.set(f.subarray(i * 8 + 3, i * 8 + 7), i * 4);
    rgba.set(aligned.subarray(i * PARTICLE_BYTES + 28, i * PARTICLE_BYTES + 32), i * 4);
  }
  return { count, pos, quat, rgba };
}

 
export function quatFromPose(m: ArrayLike<number>, stride = 4): [number, number, number, number] {
  const r = (i: number, j: number) => m[i * stride + j];
  const m00 = r(0, 0);
  const m11 = r(1, 1);
  const m22 = r(2, 2);
  const tr = m00 + m11 + m22;
  let x: number;
  let y: number;
  let z: number;
  let w: number;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = 0.25 * s;
    x = (r(2, 1) - r(1, 2)) / s;
    y = (r(0, 2) - r(2, 0)) / s;
    z = (r(1, 0) - r(0, 1)) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (r(2, 1) - r(1, 2)) / s;
    x = 0.25 * s;
    y = (r(0, 1) + r(1, 0)) / s;
    z = (r(0, 2) + r(2, 0)) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (r(0, 2) - r(2, 0)) / s;
    x = (r(0, 1) + r(1, 0)) / s;
    y = 0.25 * s;
    z = (r(1, 2) + r(2, 1)) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (r(1, 0) - r(0, 1)) / s;
    x = (r(0, 2) + r(2, 0)) / s;
    y = (r(1, 2) + r(2, 1)) / s;
    z = 0.25 * s;
  }
  const n = Math.hypot(x, y, z, w) || 1;
  return [x / n, y / n, z / n, w / n];
}
