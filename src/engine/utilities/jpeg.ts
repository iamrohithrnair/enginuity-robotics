// Encodes RGB image pixels into baseline JPEG data.
 
 
 

const ZIGZAG = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63];

const DC_LUM_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_CHR_BITS = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const DC_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_LUM_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_LUM_VALUES = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62,
  0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56,
  0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97,
  0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5,
  0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
];
const AC_CHR_BITS = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
const AC_CHR_VALUES = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72,
  0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55,
  0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95,
  0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3,
  0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa,
];

type Code = [code: number, length: number];

 
function huffman(bits: number[], values: number[]): Code[] {
  const out: Code[] = [];
  let code = 0;
  let k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < bits[len - 1]; i++) out[values[k++]] = [code++, len];
    code <<= 1;
  }
  return out;
}

const DC_LUM = huffman(DC_LUM_BITS, DC_VALUES);
const DC_CHR = huffman(DC_CHR_BITS, DC_VALUES);
const AC_LUM = huffman(AC_LUM_BITS, AC_LUM_VALUES);
const AC_CHR = huffman(AC_CHR_BITS, AC_CHR_VALUES);

 
const COS = (() => {
  const c = new Float64Array(64);
  for (let u = 0; u < 8; u++) for (let x = 0; x < 8; x++) c[u * 8 + x] = ((u === 0 ? Math.SQRT1_2 : 1) / 2) * Math.cos(((2 * x + 1) * u * Math.PI) / 16);
  return c;
})();

class BitWriter {
  bytes: number[] = [];
  private acc = 0;
  private n = 0;
  write(code: number, length: number) {
    for (let i = length - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((code >> i) & 1);
      if (++this.n === 8) this.flushByte();
    }
  }
  private flushByte() {
    this.bytes.push(this.acc);
    if (this.acc === 0xff) this.bytes.push(0);  
    this.acc = 0;
    this.n = 0;
  }
   
  finish() {
    while (this.n !== 0) this.write(1, 1);
  }
}

 
function category(v: number): [number, number] {
  const a = Math.abs(v);
  let cat = 0;
  while (a >> cat) cat++;
  return [cat, v < 0 ? v + (1 << cat) - 1 : v];
}

 
export function encodeJpeg(width: number, height: number, rgb: ArrayLike<number>): Uint8Array {
  const bw = new BitWriter();
  const prevDC = [0, 0, 0];
  const block = new Float64Array(64);
  const tmp = new Float64Array(64);
  const px = (x: number, y: number) => (Math.min(height - 1, y) * width + Math.min(width - 1, x)) * 3;
  for (let by = 0; by < height; by += 8)
    for (let bx = 0; bx < width; bx += 8)
      for (let comp = 0; comp < 3; comp++) {
        for (let y = 0; y < 8; y++)
          for (let x = 0; x < 8; x++) {
            const i = px(bx + x, by + y);
            const r = rgb[i];
            const g = rgb[i + 1];
            const b = rgb[i + 2];
            const v = comp === 0 ? 0.299 * r + 0.587 * g + 0.114 * b : comp === 1 ? -0.168736 * r - 0.331264 * g + 0.5 * b + 128 : 0.5 * r - 0.418688 * g - 0.081312 * b + 128;
            block[y * 8 + x] = v - 128;
          }
         
        for (let y = 0; y < 8; y++)
          for (let u = 0; u < 8; u++) {
            let s = 0;
            for (let x = 0; x < 8; x++) s += COS[u * 8 + x] * block[y * 8 + x];
            tmp[y * 8 + u] = s;
          }
        const coef = new Int32Array(64);
        for (let v = 0; v < 8; v++)
          for (let u = 0; u < 8; u++) {
            let s = 0;
            for (let y = 0; y < 8; y++) s += COS[v * 8 + y] * tmp[y * 8 + u];
            coef[v * 8 + u] = Math.round(s);  
          }
        const dc = comp === 0 ? DC_LUM : DC_CHR;
        const ac = comp === 0 ? AC_LUM : AC_CHR;
        const diff = coef[0] - prevDC[comp];
        prevDC[comp] = coef[0];
        const [dcCat, dcBits] = category(diff);
        bw.write(...dc[dcCat]);
        if (dcCat) bw.write(dcBits, dcCat);
        let run = 0;
        for (let k = 1; k < 64; k++) {
          const c = coef[ZIGZAG[k]];
          if (c === 0) {
            run++;
            continue;
          }
          while (run > 15) {
            bw.write(...ac[0xf0]);
            run -= 16;
          }
          const [cat, bits] = category(c);
          bw.write(...ac[(run << 4) | cat]);
          bw.write(bits, cat);
          run = 0;
        }
        if (run > 0) bw.write(...ac[0x00]);
      }
  bw.finish();

  const out: number[] = [0xff, 0xd8];
  const seg = (marker: number, data: number[]) => out.push(0xff, marker, (data.length + 2) >> 8, (data.length + 2) & 0xff, ...data);
  seg(0xe0, [0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const ones = new Array(64).fill(1);
  seg(0xdb, [0x00, ...ones, 0x01, ...ones]);
  seg(0xc0, [8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]);
  seg(0xc4, [0x00, ...DC_LUM_BITS, ...DC_VALUES, 0x10, ...AC_LUM_BITS, ...AC_LUM_VALUES, 0x01, ...DC_CHR_BITS, ...DC_VALUES, 0x11, ...AC_CHR_BITS, ...AC_CHR_VALUES]);
  seg(0xda, [3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]);
  const head = Uint8Array.from(out);
  const body = Uint8Array.from(bw.bytes);
  const res = new Uint8Array(head.length + body.length + 2);
  res.set(head, 0);
  res.set(body, head.length);
  res[res.length - 2] = 0xff;
  res[res.length - 1] = 0xd9;
  return res;
}
