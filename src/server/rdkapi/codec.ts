 
 
 
 
 
 
 

import type { Mat } from "@/engine/math";

export class ConnectionClosed extends Error {
  constructor(message = "connection closed") {
    super(message);
  }
}

type Pending = { want: () => unknown; resolve: (v: unknown) => void; reject: (e: Error) => void };

 
export class WireReader {
  private buf: Buffer = Buffer.alloc(0);
  private pending: Pending | null = null;
  private closedWith: Error | null = null;
   
  lastData = 0;

  push(chunk: Buffer) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    this.lastData = Date.now();
    this.pump();
  }

  close(err: Error = new ConnectionClosed()) {
    if (!this.closedWith) this.closedWith = err;
    this.pump();
  }

  get closed() {
    return this.closedWith !== null;
  }

  get buffered() {
    return this.buf.length;
  }

   
  discard(): number {
    const n = this.buf.length;
    this.buf = Buffer.alloc(0);
    return n;
  }

  private pump() {
    const p = this.pending;
    if (!p) return;
    const v = p.want();
    if (v !== undefined) {
      this.pending = null;
      p.resolve(v);
    } else if (this.closedWith) {
      this.pending = null;
      p.reject(this.closedWith);
    }
  }

  private wait<T>(want: () => T | undefined): Promise<T> {
    const v = want();
    if (v !== undefined) return Promise.resolve(v);
    if (this.closedWith) return Promise.reject(this.closedWith);
    return new Promise<T>((resolve, reject) => {
      this.pending = { want, resolve: resolve as (v: unknown) => void, reject };
    });
  }

  private consume(n: number): Buffer {
    const out = Buffer.from(this.buf.subarray(0, n));
    this.buf = this.buf.subarray(n);
    return out;
  }

  take(n: number): Promise<Buffer> {
    return this.wait(() => (this.buf.length >= n ? this.consume(n) : undefined));
  }

   
  line(): Promise<string> {
    return this.wait(() => {
      const i = this.buf.indexOf(10);
      if (i < 0) return undefined;
      const s = this.buf.subarray(0, i).toString("utf8");
      this.buf = this.buf.subarray(i + 1);
      return s;
    });
  }

  async int(): Promise<number> {
    return (await this.take(4)).readInt32BE(0);
  }

  async uint(): Promise<number> {
    return (await this.take(4)).readUInt32BE(0);
  }

   
  async handle(): Promise<number> {
    const v = (await this.take(8)).readBigUInt64BE(0);
    return v > BigInt(Number.MAX_SAFE_INTEGER) ? -1 : Number(v);
  }

  async doubles(n: number): Promise<number[]> {
    if (n <= 0) return [];
    const b = await this.take(8 * n);
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) out[i] = b.readDoubleBE(8 * i);
    return out;
  }

   
  async pose(): Promise<Mat> {
    return colMajorToMat(await this.doubles(16));
  }

  async array(): Promise<number[]> {
    const n = await this.int();
    if (n < 0 || n > 10_000_000) throw new Error(`invalid array size ${n}`);
    return this.doubles(n);
  }

   
  async matrix(): Promise<{ rows: number; cols: number; data: number[] }> {
    const rows = await this.int();
    const cols = await this.int();
    if (rows < 0 || cols < 0 || rows * cols > 50_000_000) throw new Error(`invalid matrix size ${rows}x${cols}`);
    return { rows, cols, data: await this.doubles(rows * cols) };
  }

  async floats(n: number): Promise<number[]> {
    if (n <= 0) return [];
    const b = await this.take(4 * n);
    const out = new Array<number>(n);
    for (let i = 0; i < n; i++) out[i] = b.readFloatBE(4 * i);
    return out;
  }

   
  async arrayF(): Promise<number[]> {
    const n = await this.int();
    if (n < 0 || n > 10_000_000) throw new Error(`invalid array size ${n}`);
    return this.floats(n);
  }

   
  async matrixF(): Promise<{ rows: number; cols: number; data: number[] }> {
    const rows = await this.int();
    const cols = await this.int();
    if (rows < 0 || cols < 0 || rows * cols > 50_000_000) throw new Error(`invalid matrix size ${rows}x${cols}`);
    return { rows, cols, data: await this.floats(rows * cols) };
  }

  async bytes(): Promise<Buffer> {
    const n = await this.uint();
    if (n > 512 * 1024 * 1024) throw new Error(`invalid byte length ${n}`);
    return n ? this.take(n) : Buffer.alloc(0);
  }

  xyz(): Promise<number[]> {
    return this.doubles(3);
  }
}

 
export class WireWriter {
  private parts: Buffer[] = [];
   
  private payload = false;

  get empty() {
    return this.parts.length === 0;
  }

  get statusOnly() {
    return !this.payload;
  }

  reset() {
    this.parts = [];
    this.payload = false;
  }

   
  line(s: string): this {
    this.payload = true;
    this.parts.push(Buffer.from(`${s.replace(/\r?\n/g, "<br>")}\n`, "utf8"));
    return this;
  }

  int(n: number): this {
    this.payload = true;
    const b = Buffer.alloc(4);
    b.writeInt32BE(clampInt32(n), 0);
    this.parts.push(b);
    return this;
  }

  uint(n: number): this {
    this.payload = true;
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n >>> 0, 0);
    this.parts.push(b);
    return this;
  }

  handle(h: number): this {
    this.payload = true;
    const b = Buffer.alloc(8);
    b.writeBigUInt64BE(BigInt(Math.max(0, Math.trunc(h))), 0);
    this.parts.push(b);
    return this;
  }

   
  item(handle: number, type: number): this {
    return this.handle(handle).int(type);
  }

  nullItem(): this {
    return this.item(0, -1);
  }

  doubles(v: number[]): this {
    this.payload = true;
    const b = Buffer.alloc(8 * v.length);
    v.forEach((x, i) => b.writeDoubleBE(Number.isFinite(x) ? x : 0, 8 * i));
    this.parts.push(b);
    return this;
  }

   
  pose(m: Mat): this {
    return this.doubles(matToColMajor(m));
  }

  array(v: number[]): this {
    return this.int(v.length).doubles(v);
  }

   
  matrix(rows: number, cols: number, colMajor: number[]): this {
    this.int(rows).int(cols);
    return rows * cols ? this.doubles(colMajor.slice(0, rows * cols)) : this;
  }

  bytes(b: Uint8Array): this {
    this.uint(b.length);
    this.payload = true;
    this.parts.push(Buffer.from(b));
    return this;
  }

  xyz(v: number[]): this {
    return this.doubles([v[0] ?? 0, v[1] ?? 0, v[2] ?? 0]);
  }

  




  status(code: number, message = ""): this {
    const b = Buffer.alloc(4);
    b.writeInt32BE(code, 0);
    this.parts.push(b);
    if (code === 2 || code === 3 || (code >= 10 && code < 100)) this.parts.push(Buffer.from(`${message.replace(/\r?\n/g, "<br>")}\n`, "utf8"));
    return this;
  }

  toBuffer(): Buffer {
    return Buffer.concat(this.parts);
  }
}

function clampInt32(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const v = Math.round(n);
  return Math.max(-2147483648, Math.min(2147483647, v));
}

export function matToColMajor(m: Mat): number[] {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) out[c * 4 + r] = m[r * 4 + c] ?? 0;
  return out;
}

export function colMajorToMat(v: number[]): Mat {
  const m = new Array<number>(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) m[r * 4 + c] = v[c * 4 + r] ?? 0;
  return m;
}






export function writePlaceholder(w: WireWriter, schema: string) {
  for (const f of schema) {
    switch (f) {
      case "L":
        w.line("");
        break;
      case "I":
        w.int(0);
        break;
      case "T":
        w.nullItem();
        break;
      case "P":
        w.handle(0);
        break;
      case "H":
        w.pose([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
        break;
      case "A":
        w.int(0);
        break;
      case "M":
        w.int(0).int(0);
        break;
      case "B":
        w.uint(0);
        break;
      case "X":
        w.xyz([0, 0, 0]);
        break;
      default:
        break;
    }
  }
}
