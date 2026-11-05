// Processes socket API handshakes, command dispatch and protocol status replies.
 

import type { Socket } from "node:net";
import { ApiError, safeModeClearUndo, settle } from "./bridge";
import { ConnectionClosed, WireReader, WireWriter, writePlaceholder } from "./codec";
import { COMMAND_HOOKS, COMMANDS, withApiLock, type ConnInfo, type Ctx } from "./context";
import { API_COMPAT_BUILD } from "./cmd-station";
import { startEventChannel } from "./events";
import { connectionRunMode, finishProgram } from "./runmode";

export interface SessionOptions {
   
  unknownCommandDelayMs: number;
   
  welcomeTimeoutMs: number;
  log: (msg: string) => void;
  debug: boolean;
}

let nextId = 1;

export class Session {
  readonly reader = new WireReader();
  readonly info: ConnInfo;
  private events = false;

  constructor(
    private socket: Socket,
    private opts: SessionOptions,
  ) {
    this.info = { id: nextId++, remote: `${socket.remoteAddress ?? "?"}:${socket.remotePort ?? 0}`, safeMode: true, autoUpdate: 0, skipStatus: false, ...connectionRunMode() };
    socket.setNoDelay(true);
    socket.on("data", (d: Buffer) => this.reader.push(d));
    socket.on("end", () => this.reader.close());
    socket.on("close", () => this.reader.close());
    socket.on("error", (e) => this.reader.close(e));
  }

  private send(buf: Buffer) {
    if (buf.length && !this.socket.destroyed) this.socket.write(buf);
  }

  async run() {
    this.opts.log(`New connection from: ${this.info.remote}`);
    try {
      if (!(await this.welcome())) return;
      if (this.events) return;  
      for (;;) {
        const name = await this.reader.line();
        if (this.events) return;
        await this.command(name);
        if (this.events) return;
      }
    } catch (err) {
      if (!(err instanceof ConnectionClosed)) this.opts.log(`API connection error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      if (!this.events) {
        this.socket.destroy();
        this.opts.log("Deleted connection");
         
        await withApiLock(() => finishProgram(this.info)).catch((e: unknown) => this.opts.log(`Program generation failed: ${e instanceof Error ? e.message : String(e)}`));
      }
    }
  }

   
  private async welcome(): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), this.opts.welcomeTimeoutMs);
    });
    const line = this.reader.line();
    line.catch(() => undefined);  
    const first = await Promise.race([line, timeout]);
    if (timer) clearTimeout(timer);
    if (first === null) {
      this.opts.log("No welcome message received");
      return false;
    }
    if (first === "RDK_API") {
      await this.handshake();
      return true;
    }
    if (first === "CMD_START") {
      const line = await this.reader.line();
      const [safe, auto, skip] = line.trim().split(/\s+/).map(Number);
      this.info.safeMode = (safe ?? 1) !== 0;
      this.info.autoUpdate = auto ?? 0;
      this.info.skipStatus = (skip ?? 0) !== 0;
      if (!this.info.skipStatus) this.send(Buffer.from("READY\n"));
      return true;
    }
    if (first === "RDK_EVT" || first === "RDK_EVT_FILTER") {
      await this.command(first);
      return true;
    }
    this.opts.log(`Unknown welcome message: ${JSON.stringify(first)}`);
    return false;
  }

   
  private async handshake() {
    const flags = await this.reader.array();
    this.info.safeMode = (flags[0] ?? 1) !== 0;
    this.info.autoUpdate = Math.trunc(flags[1] ?? 0);
     
    if (flags.length > 2) {
      this.info.skipStatus = flags[2] !== 0;
      if (this.info.skipStatus) this.opts.log("Warning! Skipping API status flag");
    }
    this.send(new WireWriter().line("RDK_API").int(1).int(API_COMPAT_BUILD).status(0).toBuffer());
  }

  private async command(name: string) {
    if (name === "RDK_API") {
      await this.handshake();
      return;
    }
    const spec = COMMANDS.get(name);
    if (!spec) {
      await this.unknown(name);
      return;
    }
    if (this.opts.debug) this.opts.log(`Running API Command: ${name}`);
    for (const h of COMMAND_HOOKS.values()) h.before?.(name, this.info);
    const w = new WireWriter();
    const ctx: Ctx = {
      r: this.reader,
      w,
      conn: this.info,
      exec: (fn) =>
        withApiLock(async () => {
          await settle();
          return fn();
        }),
      flush: () => {
        this.send(w.toBuffer());
        w.reset();
      },
      startEvents: (filter) => {
        this.events = true;
        startEventChannel(this.socket, filter, this.opts.log);
      },
    };
    let raw = false;
    try {
      raw = (await spec.run(ctx)) === "raw";
    } catch (err) {
      if (err instanceof ConnectionClosed) throw err;
      const e = err instanceof ApiError ? err : new ApiError(3, err instanceof Error ? err.message : String(err));
      w.reset();
      if (e.placeholder) e.placeholder(w);
      else writePlaceholder(w, spec.resp.replace(/S.*$/, ""));
      w.status(e.status, e.message);
      raw = true;
      if (this.opts.debug) this.opts.log(`API command ${name} failed with status ${e.status}: ${e.message}`);
    }
    if (!raw) w.status(0);
     
    if (!(this.info.skipStatus && w.statusOnly)) this.send(w.toBuffer());
    for (const h of COMMAND_HOOKS.values()) await Promise.resolve(h.after?.(name, this.info, w)).catch(() => undefined);
    if (this.info.safeMode) safeModeClearUndo();
    if (this.opts.debug) this.opts.log(`Done with API Command: ${name}`);
  }

  




  private async unknown(name: string) {
    const delay = this.opts.unknownCommandDelayMs;
    let deadline = Date.now() + delay;
    const quiet = Math.min(delay, 15_000);
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, Math.max(1, Math.min(100, deadline - Date.now()))));
      if (this.reader.closed) throw new ConnectionClosed();
      if (this.reader.buffered) {
        this.reader.discard();
        deadline = Math.max(deadline, this.reader.lastData + quiet);
      }
    }
    this.opts.log(`Problems with command: ${JSON.stringify(name)}`);
    this.send(new WireWriter().int(-1).toBuffer());
  }
}
