// Encodes PNG images and reads PNG dimensions and format metadata.
 
 
 

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

 
function zlibStored(data: Uint8Array): Uint8Array {
  const blocks = Math.max(1, Math.ceil(data.length / 65535));
  const out = new Uint8Array(2 + data.length + blocks * 5 + 4);
  out[0] = 0x78;
  out[1] = 0x01;
  let o = 2;
  for (let i = 0; i < blocks; i++) {
    const start = i * 65535;
    const len = Math.min(65535, data.length - start);
    out[o++] = i === blocks - 1 ? 1 : 0;
    out[o++] = len & 0xff;
    out[o++] = len >>> 8;
    out[o++] = ~len & 0xff;
    out[o++] = (~len >>> 8) & 0xff;
    out.set(data.subarray(start, start + len), o);
    o += len;
  }
  const ad = adler32(data);
  out[o++] = ad >>> 24;
  out[o++] = (ad >>> 16) & 0xff;
  out[o++] = (ad >>> 8) & 0xff;
  out[o++] = ad & 0xff;
  return out;
}

export type Deflate = (data: Uint8Array) => Uint8Array;

export interface PngInput {
  width: number;
  height: number;
   
  channels: 1 | 3 | 4;
   
  bitDepth?: 8 | 16;
   
  data: ArrayLike<number>;
}

 
function scanlines(img: PngInput): Uint8Array {
  const { width, height, channels } = img;
  const depth = img.bitDepth ?? 8;
  const stride = width * channels * (depth / 8);
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    raw[row] = 0;  
    for (let x = 0; x < width * channels; x++) {
      const v = img.data[y * width * channels + x];
      if (depth === 16) {
        raw[row + 1 + x * 2] = (v >>> 8) & 0xff;
        raw[row + 2 + x * 2] = v & 0xff;
      } else raw[row + 1 + x] = v;
    }
  }
  return raw;
}

function assemble(img: PngInput, idat: Uint8Array): Uint8Array {
  const { width, height, channels } = img;
  const colorType = channels === 1 ? 0 : channels === 3 ? 2 : 6;
  const chunks: [string, Uint8Array][] = [
    ["IHDR", new Uint8Array([width >>> 24, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff, height >>> 24, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff, img.bitDepth ?? 8, colorType, 0, 0, 0])],
    ["IDAT", idat],
    ["IEND", new Uint8Array(0)],
  ];
  const size = 8 + chunks.reduce((s, [, d]) => s + 12 + d.length, 0);
  const out = new Uint8Array(size);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  let o = 8;
  for (const [type, d] of chunks) {
    out[o] = d.length >>> 24;
    out[o + 1] = (d.length >>> 16) & 0xff;
    out[o + 2] = (d.length >>> 8) & 0xff;
    out[o + 3] = d.length & 0xff;
    for (let i = 0; i < 4; i++) out[o + 4 + i] = type.charCodeAt(i);
    out.set(d, o + 8);
    const crc = crc32(out, o + 4, o + 8 + d.length);
    const e = o + 8 + d.length;
    out[e] = crc >>> 24;
    out[e + 1] = (crc >>> 16) & 0xff;
    out[e + 2] = (crc >>> 8) & 0xff;
    out[e + 3] = crc & 0xff;
    o = e + 4;
  }
  return out;
}

export function encodePng(img: PngInput, deflate?: Deflate): Uint8Array {
  const raw = scanlines(img);
  return assemble(img, deflate ? deflate(raw) : zlibStored(raw));
}

 
async function deflateStream(data: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

 
export async function encodePngCompressed(img: PngInput): Promise<Uint8Array> {
  const raw = scanlines(img);
  return assemble(img, (await deflateStream(raw)) ?? zlibStored(raw));
}

 
export function pngInfo(bytes: Uint8Array): { width: number; height: number; bitDepth: number; colorType: number } | null {
  if (bytes.length < 33 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  const u32 = (o: number) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
  return { width: u32(16), height: u32(20), bitDepth: bytes[24], colorType: bytes[25] };
}

