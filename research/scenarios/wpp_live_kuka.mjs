// Exercises KUKA assembly scripts and programs over HTTP, recording events and station state.
 
 
 
 
 
import { writeFileSync } from "node:fs";

const OUT = process.argv[2];
const PORT = process.argv[3] ?? "3200";
const BASE = `http://localhost:${PORT}`;
const STATION = "Assembly-and-Material-Handling-with-KUKA-KR-3-R540.rdk";

async function cmd(name, params = {}) {
  const res = await fetch(`${BASE}/api/command`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, params }) });
  const j = await res.json();
  if (!j.ok) throw new Error(`${name}: ${j.error}`);
  return j.result;
}
async function state() {
  return (await (await fetch(`${BASE}/api/state`)).json()).ws;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

 
const events = [];
const ctrl = new AbortController();
(async () => {
  const res = await fetch(`${BASE}/api/events`, { signal: ctrl.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (!chunk.startsWith("data: ")) continue;
      const e = JSON.parse(chunk.slice(6));
      if (e.type === "status" || e.type === "dialog") {
        events.push({ t: Date.now(), ...e, ...(e.type === "dialog" ? {} : {}) });
        if (e.type === "dialog") {
           
          setTimeout(() => fetch(`${BASE}/api/dialog`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: e.id, button: e.buttons.at(-1) }) }).catch(() => undefined), 300);
        }
      }
    }
  }
})().catch(() => undefined);

function find(ws, name, type) {
  const inStation = (it) => {
    for (let cur = it; cur; cur = cur.parent ? ws.items[cur.parent] : undefined) if (cur.id === ws.activeStation) return true;
    return false;
  };
  return Object.values(ws.items).find((it) => it.name === name && (!type || it.type === type) && inStation(it));
}

async function waitIdle(ms = 600_000) {
  const t0 = Date.now();
  await sleep(300);
  for (;;) {
    const s = await cmd("sim.status");
    const ws = await state();
    const py = Object.values(ws.items).filter((it) => it.type === "python" && (ws.busy ?? []).includes(it.id));
    if (!s.busy.length && !py.length) return Date.now() - t0;
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for the simulation");
    await sleep(250);
  }
}

const report = { station: STATION, port: PORT, steps: [] };
const mark = () => events.length;
const since = (n) => events.slice(n);
const summarize = (evs) => ({
  dialogs: evs.filter((e) => e.type === "dialog").map((e) => ({ title: e.title, html: String(e.html).slice(0, 400), buttons: e.buttons })),
  pythonStatuses: evs.filter((e) => e.type === "status" && /python/i.test(String(e.text))).map((e) => e.text),
});

try {
  await sleep(500);
  const opened = await cmd("station.openRdk", { file: STATION });
  let ws = await state();
  const stationId = ws.activeStation;
  report.opened = { station: ws.items[stationId]?.name, result: opened?.name ?? null };
  const mech = find(ws, "O-RingDistributor_Mech", "robot");
  const main = find(ws, "Main", "program");
   
  const tubeParents = () => {
    const out = {};
    for (let k = 1; k <= 12; k++) {
      for (const n of [`TubeType1-${k}`, `Tube2-${k}`, `O-ring${k}`]) {
        const it = find(ws, n, "object");
        const p = it ? ws.items[it.parent]?.name : null;
        out[p] = (out[p] ?? 0) + 1;
      }
    }
    return out;
  };
  report.before = { oring: ws.items[mech.id].robot.joints, parents: tubeParents() };

   
  for (const name of ["Reset_Mechanisms", "Next_O-Ring", "PickUp_Assembly", "Place_Assembly"]) {
    const n = mark();
    const py = find(ws, name, "python");
    const r = await cmd("python.run", { item: py.id });
    await waitIdle(60_000);
    await sleep(400);
    ws = await state();
    report.steps.push({ step: `python.run ${name}`, started: r.started, oring: ws.items[mech.id].robot.joints, ...summarize(since(n)) });
  }

   
  await cmd("sim.setSpeed", { factor: 100 });
  const n = mark();
  const t0 = Date.now();
  await cmd("program.run", { program: main.id });
  const took = await waitIdle();
  await sleep(500);
  ws = await state();
  const finishRefs = Object.values(ws.items).filter((it) => /^Tube_Finish_Ref\d+$/.test(it.name) && find(ws, it.name));
  report.main = {
    secondsReal: (Date.now() - t0) / 1000,
    waitedMs: took,
    oring: ws.items[mech.id].robot.joints,
    parentsAfter: tubeParents(),
    finishRefsWithParts: finishRefs.filter((f) => f.children.some((k) => ws.items[k]?.type === "object" || ws.items[k]?.type === "frame")).map((f) => f.name).sort(),
    ...summarize(since(n)),
    statusTail: since(n).filter((e) => e.type === "status").slice(-12).map((e) => e.text),
  };
  await cmd("station.close", { station: stationId, ifUnsaved: "discard" });
  report.closed = true;
} catch (e) {
  report.error = String(e?.stack ?? e);
} finally {
  ctrl.abort();
   
  writeFileSync(OUT, JSON.stringify(report, null, 1).split(process.cwd()).join("<repo>"));
  console.log(JSON.stringify({ steps: report.steps.map((s) => ({ step: s.step, dialogs: s.dialogs.length, py: s.pythonStatuses.at(-1) })), main: report.main && { dialogs: report.main.dialogs.length, oring: report.main.oring, finish: report.main.finishRefsWithParts.length, secs: report.main.secondsReal }, error: report.error ?? null }, null, 1));
  process.exit(0);
}
