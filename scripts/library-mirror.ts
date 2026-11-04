 
 
 
 
 
 
 
 
 
 

import { libraryDir, mirrorLibrary, mirrorSummary, verifyMirror } from "../src/server/library-core";

const args = process.argv.slice(2);
const has = (flag: string) => args.includes(flag);
const valueOf = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const gb = (n: number) => `${(n / 1e9).toFixed(2)} GB`;
const tty = !!process.stdout.isTTY;

async function main(): Promise<number> {
  if (has("--help") || has("-h")) {
    console.log("usage: npm run library:mirror -- [--refresh] [--verify] [--concurrency N]");
    return 0;
  }
  if (has("--verify")) {
    const r = verifyMirror((done, total) => {
      if (tty) process.stdout.write(`\rverifying ${done}/${total}`);
    });
    if (tty) process.stdout.write("\n");
    console.log(`${r.ok} of ${r.checked} mirrored files intact · ${r.missing.length} missing · ${r.corrupt.length} corrupt · ${r.notMirrored} catalog files not mirrored yet`);
    for (const f of [...r.missing, ...r.corrupt].slice(0, 20)) console.log(`  ${f}`);
    if (r.missing.length || r.corrupt.length) console.log("Run `npm run library:mirror` to fetch them again.");
    return r.missing.length || r.corrupt.length ? 1 : 0;
  }
  const concurrency = Number(valueOf("--concurrency") ?? 2);
  console.log(`Mirroring the robot library into ${libraryDir()} (${concurrency} parallel downloads${has("--refresh") ? ", refresh" : ""})`);
  let printed = 0;
  const r = await mirrorLibrary({
    refresh: has("--refresh"),
    concurrency,
    onProgress: (p) => {
      const line = `${p.done}/${p.total} checked · ${p.downloaded} downloaded (${gb(p.bytes)}) · ${p.unchanged} unchanged · ${p.failed} failed`;
      if (tty) process.stdout.write(`\r${line}  `);
      else if (p.done - printed >= 100 || p.done === p.total) {
        printed = p.done;
        console.log(line);
      }
    },
  });
  if (tty) process.stdout.write("\n");
  const s = mirrorSummary();
  console.log(
    `Done in ${r.seconds} s: ${r.items} catalog items · ${s.files} files and ${s.images} thumbnails stored (${gb(s.bytes)}) · ` +
      `this run downloaded ${r.downloaded} (${gb(r.bytes)}), ${r.unchanged} unchanged, ${r.failures.length} failed`,
  );
  for (const f of r.failures.slice(0, 20)) console.log(`  failed: ${f.path} (${f.error})`);
  if (r.aborted) {
    console.error(`Stopped early: ${r.aborted}. Run the command again to resume.`);
    return 2;
  }
  return r.failures.length ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(2);
  },
);
