 
 

import "server-only";
import { libraryCatalog, libraryDownload, libraryMirrorStatus, searchCatalog, startLibraryMirror } from "./library";
import { createPostService, generateProgram } from "./post";
import { apiState } from "./rdkapi/context";
import type { ServerState } from "./store";
import { PythonRunner } from "./python-runner";
import { Runner } from "./runner";
import { DATA_DIR } from "./store";
import { startAutoBackup } from "./backup";
import { cadServiceIfBuilt } from "./cad";
import { createFileServices } from "./fileStore";
import { requestScreenshot, viewClients } from "./viewbridge";
import { attachTrace } from "./trace";
import { attachDecisionServices } from "./decisions";
import { attachScriptServices } from "./scripts/attach";
import { createExampleServices, visibleLibraryEntries } from "./examples";
import { attachPhysics } from "./physics";
import { attachSpray } from "./spray";
import { attachSimRecorder } from "./simRecorder";
import { attachSimReady } from "./simready/service";

export function attachServerServices(state: ServerState) {
  const s = state.services;

  s.library = {
    load: (file, kind) => libraryDownload(file, kind ?? "robot"),
    catalog: () => libraryCatalog(),
    search: async (q) => searchCatalog(visibleLibraryEntries(await libraryCatalog(), s.settings), q as Parameters<typeof searchCatalog>[1]),
    mirror: (opts) => startLibraryMirror(opts),
    mirrorStatus: () => libraryMirrorStatus(),
  };

  s.files = createFileServices(DATA_DIR);
  s.cad = cadServiceIfBuilt();

  const stack = () => state.undo.active(state.ws);
  s.undo = {
    undo() {
      const label = stack().undoLabel();
      const patch = stack().undo(state.ws);
      if (!patch) return { undone: null };
      state.ws.rev += 1;
      patch.rev = state.ws.rev;
      s.emit?.({ type: "patch", patch });
      return { undone: label };
    },
    redo() {
      const label = stack().redoLabel();
      const patch = stack().redo(state.ws);
      if (!patch) return { redone: null };
      state.ws.rev += 1;
      patch.rev = state.ws.rev;
      s.emit?.({ type: "patch", patch });
      return { redone: label };
    },
    list: () => stack().list(),
    clear() {
      stack().clear();
      s.emit?.({ type: "undo", undo: stack().list() });
    },
    drop: (station) => state.undo.drop(station),
    setLimit: (limit) => state.undo.setLimit(limit, state.ws),
    undoTo(index) {
      const before = stack().index;
      const patch = stack().undoTo(state.ws, index);
      if (patch) {
        state.ws.rev += 1;
        patch.rev = state.ws.rev;
        s.emit?.({ type: "patch", patch });
      }
      return { from: before, index: stack().index };
    },
    isClean: (station) => state.undo.stack(station).isClean(),
    setClean(station) {
      state.undo.stack(station).setClean();
      if (station === state.ws.activeStation) s.emit?.({ type: "undo", undo: stack().list() });
    },
  };

   
  const runner = new Runner(state);
  state.runner = runner;
  s.runner = {
    start: (id, opts) => runner.start(id, opts),
    stopAll: () => runner.stopAll(),
    moveRobot: (id, joints, kind) => runner.moveRobot(id, joints, kind),
    skipWait: (id) => runner.skipWait(id),
    moveRobotArc: (id, via, end) => runner.moveRobotArc(id, via, end),
    liveJoints: (id) => runner.liveJointsOf(id),
  };

  s.view = { clients: viewClients, screenshot: (o) => requestScreenshot(o), pose: () => apiState().viewPose };
  attachTrace(state);
  s.post = (req) => generateProgram(req);
  s.posts = createPostService((e) => s.emit?.(e));
  s.itemData = (id) => [...(apiState().itemData.get(id) ?? new Map<string, Buffer>()).entries()];
  s.ask = (html, buttons, title) => runner.ask(html, buttons, title);
  s.prompt = (html, buttons, title, input) => runner.prompt(html, buttons, title, input);
  s.progress = (html, title) => {
    let id = "";
    void runner.ask(html, ["Hide"], title, (dialogId) => (id = dialogId));
    return { close: () => void runner.answer(id, "Hide") };
  };

   
  s.python = new PythonRunner(state).service();
  startAutoBackup(state);
  attachDecisionServices(s);
   
  attachScriptServices(state);
   
  s.examples = createExampleServices();
   
  attachPhysics(state);
   
  attachSpray(state);
   
  attachSimRecorder(state);
   
  attachSimReady(s);
}
