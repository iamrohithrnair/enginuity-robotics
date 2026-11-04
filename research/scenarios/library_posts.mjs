 
 
 
 
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const dir = process.argv[2] ?? path.join(ROOT, "data/library/files/library-robots");
const { instance } = await WebAssembly.instantiate(readFileSync(path.join(ROOT, "public/wasm/rc_core.wasm")), {});
const c = instance.exports;

function parse(bytes) {
  const p = c.rc_alloc(bytes.byteLength);
  new Uint8Array(c.memory.buffer, p, bytes.length).set(bytes);
  const n = c.rc_robotfile_parse(p, bytes.length);
  c.rc_free(p, bytes.byteLength);
  const buf = new Uint8Array(c.memory.buffer, c.rc_result_ptr(), c.rc_result_len()).slice();
  if (n < 0) return null;
  const jsonLen = new DataView(buf.buffer).getUint32(0, true);
  return JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + jsonLen)));
}

const robots = [];
for (const f of readdirSync(dir).filter((x) => /\.robot$/i.test(x)).sort()) {
  const j = parse(new Uint8Array(readFileSync(path.join(dir, f))));
  if (!j) continue;
  robots.push({ file: f, name: j.name, post: j.post_processor || "", nq: j.dof, mech: j.mech });
}
const byPost = {};
for (const r of robots) {
  const e = (byPost[r.post || "(none)"] ??= { count: 0, nq: {}, mech: {}, examples: [] });
  e.count++;
  e.nq[r.nq] = (e.nq[r.nq] ?? 0) + 1;
  e.mech[r.mech] = (e.mech[r.mech] ?? 0) + 1;
  if (e.examples.length < 3) e.examples.push(r.name);
}
console.log(JSON.stringify({ total: robots.length, byPost, robots }, null, 1));
