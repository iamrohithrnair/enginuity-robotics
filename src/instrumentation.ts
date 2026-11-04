 
 
 

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
   
   
   
  const { getServer } = await import("./server/store");
  getServer();
  if (process.env.ROBOCRAFT_API === "0") return;
  const { ensureRdkApiServer } = await import("./server/rdkapi/server");
  try {
    await ensureRdkApiServer();
  } catch (err) {
    console.error(`[enginuity-api] ${err instanceof Error ? err.message : String(err)}`);
  }
}
