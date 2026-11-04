 
 
 

import "server-only";
import { LibraryError, lockHolder, mirrorLibrary, mirrorSummary, offlineOnly, type MirrorProgress, type MirrorResult } from "./library-core";

export { libraryCatalog, libraryDownload, libraryFileUrl, libraryImage, LibraryError, searchCatalog } from "./library-core";

interface MirrorJob {
  state: "running" | "done" | "error";
  startedAt: string;
  finishedAt?: string;
  progress?: MirrorProgress;
  result?: MirrorResult;
  error?: string;
}

 
const KEY = "__robocraft_library_mirror";
const jobs = globalThis as unknown as Record<string, MirrorJob | undefined>;





export function startLibraryMirror(opts: { refresh?: boolean; concurrency?: number }) {
  if (offlineOnly()) throw new LibraryError("Mirroring needs the network: unset ROBOCRAFT_LIBRARY_OFFLINE", 409);
  if (jobs[KEY]?.state !== "running" && !lockHolder()) {
    const job: MirrorJob = { state: "running", startedAt: new Date().toISOString() };
    jobs[KEY] = job;
    mirrorLibrary({ ...opts, onProgress: (p) => (job.progress = p) })
      .then((result) => Object.assign(job, { state: "done", result }))
      .catch((err) => Object.assign(job, { state: "error", error: err instanceof Error ? err.message : String(err) }))
      .finally(() => (job.finishedAt = new Date().toISOString()));
  }
  return libraryMirrorStatus();
}

 
export function libraryMirrorStatus() {
  const job = jobs[KEY];
  if (job?.state === "running") return { state: "running" as const, startedAt: job.startedAt, progress: job.progress ?? null };
  const lastRun = job && {
    state: job.state,
    finishedAt: job.finishedAt,
    error: job.error,
    downloaded: job.result?.downloaded,
    bytes: job.result?.bytes,
    failed: job.result?.failed,
    aborted: job.result?.aborted,
  };
  return { state: job?.state ?? ("idle" as const), ...mirrorSummary(), ...(lastRun ? { lastRun } : {}) };
}
