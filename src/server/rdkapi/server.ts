// Starts and reuses TCP API servers on configured listener ports.
 
 
 

import net from "node:net";
import "./cmd-items";
import "./cmd-robot";
import "./cmd-program";
import "./cmd-station";
import "./cmd-collision";
import "./events";
 
import "./cmd-curves";
 
import "./cmd-utilities";
import "./cmd-geometry";
 
import "./cmd-enginuity";
 
import "./cmd-spray";
 
import "./cmd-x1";
 
import "./unsupported";
import { getServer } from "@/server/store";
import { clearPath, setPendingRunMode } from "./runmode";
import { COMMANDS } from "./context";
import { Session, type SessionOptions } from "./session";

export interface RdkApiServer {
  host: string;
  port: number;
  close(): Promise<void>;
}

export interface StartOptions {
  host?: string;
   
  ports?: number[];
  unknownCommandDelayMs?: number;
  welcomeTimeoutMs?: number;
  log?: (msg: string) => void;
  debug?: boolean;
   
  ref?: boolean;
}

export const DEFAULT_PORTS = [20500, 20501, 20502];

function defaultPorts(): number[] {
  const env = Number(process.env.ROBOCRAFT_API_PORT);
  return Number.isInteger(env) && env > 0 ? [env] : DEFAULT_PORTS;
}

function listen(server: net.Server, host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const onError = () => {
      server.off("listening", onListening);
      resolve(false);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve(true);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

 
export async function startRdkApiServer(opts: StartOptions = {}): Promise<RdkApiServer> {
  const host = opts.host ?? "127.0.0.1";
  const log = opts.log ?? ((m: string) => console.log(`[enginuity-api] ${m}`));
  const sessionOpts: SessionOptions = {
    unknownCommandDelayMs: opts.unknownCommandDelayMs ?? Number(process.env.ROBOCRAFT_API_UNKNOWN_DELAY_MS ?? 25_000),
    welcomeTimeoutMs: opts.welcomeTimeoutMs ?? 10_000,
    log,
    debug: opts.debug ?? process.env.ROBOCRAFT_API_DEBUG === "1",
  };
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    void new Session(socket, sessionOpts).run();
  });
  const ports = opts.ports ?? defaultPorts();
  let port = -1;
  for (const p of ports) {
    if (await listen(server, host, p)) {
      port = (server.address() as net.AddressInfo).port;
      break;
    }
  }
  if (port < 0) {
    const msg = `Failed to setup server at ${host}:${ports.join("/")}`;
    log(msg);
    throw new Error(msg);
  }
  if (!opts.ref) server.unref();
  log(`Server is running at ${host === "127.0.0.1" ? "localhost" : host}:${port} (${COMMANDS.size} API commands)`);
  return {
    host,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

const KEY = "__robocraft_rdkapi_server";

 
export function ensureRdkApiServer(opts: StartOptions = {}): Promise<RdkApiServer> {
  const g = globalThis as unknown as Record<string, Promise<RdkApiServer> | undefined>;
  if (!g[KEY]) {
    g[KEY] = startRdkApiServer(opts)
      .then((srv) => {
         
        const services = getServer().services;
        services.settings.RC_API_PORT = srv.port;
         
        services.api = { setPendingRunMode, clearPath };
        return srv;
      })
      .catch((err) => {
        g[KEY] = undefined;
        throw err;
      });
  }
  return g[KEY]!;
}
