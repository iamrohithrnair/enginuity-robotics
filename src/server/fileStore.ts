 
 

import "server-only";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import type { Services } from "@/engine/registry";
import { backupFileName } from "./backup";
import { isStationFile, stationFileName } from "@/engine/stationFile";

export function createFileServices(dataDir: string): NonNullable<Services["files"]> {
  const stationsDir = path.join(dataDir, "stations");
  mkdirSync(stationsDir, { recursive: true });
  const backupsDir = path.join(dataDir, "backups");
  const exportsDir = path.join(dataDir, "exports");
  const recentFile = path.join(dataDir, "recent-files.json");
   
  const stationPath = (nameOrPath: string) => {
    if (path.isAbsolute(nameOrPath)) return nameOrPath;
    if (/\.(mech|json|rdk|rdka|rdkbak)$/i.test(nameOrPath)) return path.join(stationsDir, nameOrPath);
    const safe = nameOrPath.replace(/[^\w .()-]+/g, "_").trim() || "Station";
    const file = path.join(stationsDir, stationFileName(safe));
     
    const legacy = path.join(stationsDir, `${safe}.rcstation.json`);
    return !existsSync(file) && existsSync(legacy) ? legacy : file;
  };
  const readRecent = (): string[] => {
    try {
      const v = JSON.parse(readFileSync(recentFile, "utf8"));
      return Array.isArray(v) ? v.map(String) : [];
    } catch {
      return [];
    }
  };

  return {
    async saveStation(name, data) {
      const file = stationPath(name);
      if (!/\.mech$/i.test(file)) throw new Error(`Unable to access file ${file}`);
      mkdirSync(path.dirname(file), { recursive: true });
      try {
        writeFileSync(file, JSON.stringify(data));
      } catch {
        throw new Error(`Unable to save file. Did you run out of disk space? (${file})`);
      }
      return file;
    },
    async loadStation(p) {
      const file = path.isAbsolute(p) ? p : isStationFile(p) || p.endsWith(".json") ? path.join(stationsDir, p) : stationPath(p);
      return JSON.parse(readFileSync(file, "utf8"));
    },
    async listStations() {
      return readdirSync(stationsDir).filter(isStationFile);
    },
    stationPath,
    async readFile(p) {
      if (!path.isAbsolute(p) || !existsSync(p)) throw new Error(`File doesn't exist: ${p}`);
      return new Uint8Array(readFileSync(p));
    },
     
    recent: readRecent,
    pushRecent(p) {
      const norm = p.replace(/\\/g, "/");
      writeFileSync(recentFile, JSON.stringify([norm, ...readRecent().filter((f) => f !== norm)].slice(0, 20), null, 2));
    },
    clearRecent() {
      writeFileSync(recentFile, "[]");
    },
    listBackups() {
      if (!existsSync(backupsDir)) return [];
      return readdirSync(backupsDir)
        .filter(isStationFile)
        .map((f) => ({ file: f, path: path.join(backupsDir, f), mtime: statSync(path.join(backupsDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
    },
    writeBackup(stationName, data) {
      mkdirSync(backupsDir, { recursive: true });
      const file = path.join(backupsDir, backupFileName(stationName, new Date()));
      writeFileSync(file, JSON.stringify(data));
      return file;
    },
    deleteBackups(stationName) {
      if (!existsSync(backupsDir)) return 0;
      const prefix = `${stationName.replace(/[^\w .()-]+/g, "_")} - Auto saved on `;
      let n = 0;
      for (const f of readdirSync(backupsDir)) {
        if (!f.startsWith(prefix)) continue;
        unlinkSync(path.join(backupsDir, f));
        n++;
      }
      return n;
    },
    async loadBackup(p) {
      const file = path.isAbsolute(p) ? p : path.join(backupsDir, p);
      if (!file.startsWith(backupsDir)) throw new Error("Backups can only be recovered from the Enginuity backup folder");
      return JSON.parse(readFileSync(file, "utf8"));
    },
    reveal(p) {
      const target = existsSync(p) ? p : stationsDir;
      const [cmd, args] =
        process.platform === "darwin" ? ["open", existsSync(p) ? ["-R", target] : [target]] : process.platform === "win32" ? ["explorer", [`/select,${target}`]] : ["xdg-open", [path.dirname(target)]];
      spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => undefined).unref();
      return target;
    },
    writeStationFile(nameOrPath, bytes, opts) {
      const file = stationPath(nameOrPath);
      if (existsSync(file) && !opts?.overwrite) throw new Error(`“${path.basename(file)}” already exists. Do you want to replace it?`);
      mkdirSync(path.dirname(file), { recursive: true });
      try {
        writeFileSync(file, bytes);
      } catch {
        throw new Error(`Unable to save file. Did you run out of disk space? (${file})`);
      }
      return file;
    },
    exists(nameOrPath) {
      return existsSync(stationPath(nameOrPath));
    },
    writeExport(fileName, bytes) {
      mkdirSync(exportsDir, { recursive: true });
      const file = path.join(exportsDir, path.basename(fileName));
      writeFileSync(file, bytes);
      return file;
    },
  };
}
