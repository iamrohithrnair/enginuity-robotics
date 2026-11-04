 
 
 

import "server-only";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Services } from "@/engine/registry";

interface CadExports {
  memory: WebAssembly.Memory;
  rc_alloc(n: number): number;
  rc_free(p: number, n: number): void;
  rc_cad_load(p: number, len: number, kind: number, linearMm: number): number;
  rc_cad_variants(): number;
  rc_cad_face(i: number, variant: number): number;
  rc_cad_face_trapped(): void;
  rc_cad_finish(): number;
  rc_result_ptr(): number;
  rc_result_len(): number;
}

interface CadResult {
  meshes: { color: [number, number, number, number] | null; offset: number; count: number; part?: number }[];
   
  parts?: string[];
  faces: number;
  failed: number;
  skipped: Record<string, number>;
}

export const CAD_WASM = path.join(  process.cwd(), "public", "wasm", "rc_cad.wasm");

 
export const CAD_DEFAULT_COLOR: [number, number, number, number] = [0.8, 0.8, 0.8, 1];

 
export const CAD_LINEAR_ACCURACY = 1;

export function createCadService(wasmPath = CAD_WASM): NonNullable<Services["cad"]> {
  let compiled: Promise<WebAssembly.Module> | null = null;
  const wasmModule = () => (compiled ??= readFile(wasmPath).then((b) => WebAssembly.compile(b)));
  return {
    async importCad(bytes, ext) {
      const kind = /^(igs|iges)$/i.test(ext) ? 1 : 0;
      const inst = await WebAssembly.instantiate(await wasmModule(), {});
      const ex = inst.exports as unknown as CadExports;
      const text = () => new TextDecoder().decode(new Uint8Array(ex.memory.buffer, ex.rc_result_ptr(), ex.rc_result_len()));
      const p = ex.rc_alloc(bytes.length);
      new Uint8Array(ex.memory.buffer, p, bytes.length).set(bytes);
      const jobs = ex.rc_cad_load(p, bytes.length, kind, CAD_LINEAR_ACCURACY);
      ex.rc_free(p, bytes.length);
      if (jobs < 0) throw new Error(text());
       
      const variants = ex.rc_cad_variants();
      let last = Date.now();
      for (let i = 0; i < jobs; i++) {
        for (let v = 0; v < variants; v++) {
          try {
            if (ex.rc_cad_face(i, v) === 0) break;
          } catch {
            if (v === variants - 1) ex.rc_cad_face_trapped();
          }
        }
         
        if (Date.now() - last > 50) {
          await new Promise((r) => setImmediate(r));
          last = Date.now();
        }
      }
      if (ex.rc_cad_finish() < 0) throw new Error("CAD import failed");
      const buf = new Uint8Array(ex.memory.buffer, ex.rc_result_ptr(), ex.rc_result_len()).slice();
      const jsonLen = new DataView(buf.buffer).getUint32(0, true);
      const info = JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + jsonLen))) as CadResult;
      const start = (4 + jsonLen + 3) & ~3;
      const floats = new Float32Array(buf.buffer, start, (buf.length - start) / 4);
      return {
        meshes: info.meshes.map((m) => ({ triangles: floats.slice(m.offset, m.offset + m.count), color: m.color ?? CAD_DEFAULT_COLOR, part: m.part ?? 0 })),
        parts: info.parts ?? [],
        faces: info.faces,
        failed: info.failed,
      };
    },
  };
}

 
export function cadServiceIfBuilt(wasmPath = CAD_WASM): Services["cad"] {
  return existsSync(wasmPath) ? createCadService(wasmPath) : undefined;
}
