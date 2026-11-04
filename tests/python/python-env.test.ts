 
 
 
 
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { engine } from "../helpers";

const ROOT = path.resolve(__dirname, "../..");
const ENV_TOOLS = path.join(ROOT, "python/env");
const allow = JSON.parse(readFileSync(path.join(ENV_TOOLS, "allowlist.json"), "utf8")) as {
  modules: Record<string, { packages: string[] }>;
  packages: Record<string, { license: string; pins: { version: string; marker?: string }[] }>;
};
const requirements = readFileSync(path.join(ENV_TOOLS, "requirements.txt"), "utf8");

 
const fake = vi.hoisted(() => ({ installs: [] as { modules: string[]; base: string }[], ok: true, markers: "" }));
vi.mock("@/server/python-env", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/server/python-env")>();
  if (process.env.ENGINUITY_PYENV_NET === "1") return real;
  return {
    ...real,
    installModules: async (modules: string[], base: string, onLine: (l: string) => void) => {
      fake.installs.push({ modules, base });
      onLine(`Collecting ${modules.join(" ")}`);
      await new Promise((r) => setTimeout(r, 300));
      if (fake.ok) for (const m of modules) writeFileSync(path.join(fake.markers, m), "");
      return { ok: fake.ok, log: fake.ok ? "Successfully installed" : "ERROR: Could not find a version that satisfies the requirement (network unreachable)" };
    },
  };
});
const installs = fake.installs;

let mod: typeof import("@/server/python-runner");
beforeAll(async () => {
  process.env.ROBOCRAFT_DATA_DIR = mkdtempSync(path.join(tmpdir(), "mb-pyenv-"));
  fake.markers = mkdtempSync(path.join(tmpdir(), "mb-pyenv-markers-"));
  mod = await import("@/server/python-runner");
});

describe("allowlist and requirements", () => {
  it("lists only MIT/BSD packages (plus the user-approved OpenCV), each pinned with sha256 hashes in requirements.txt", () => {
    for (const [name, pkg] of Object.entries(allow.packages)) {
      expect(name === "opencv-python-headless" ? ["Apache-2.0"] : ["MIT", "BSD-3-Clause", "BSD-2-Clause"]).toContain(pkg.license);
      for (const pin of pkg.pins) {
        const start = requirements.indexOf(`\n${name}==${pin.version}`);
        expect(start, `${name}==${pin.version}`).toBeGreaterThan(0);
        const block = requirements.slice(start + 1).split(/\n(?=\S)/)[0];
        expect(block).toContain(pin.marker ?? `${name}==${pin.version} \\`);
        expect(block).toMatch(/--hash=sha256:[0-9a-f]{64}/);
      }
    }
     
    const reqs = requirements.split("\n").filter((l) => /^[A-Za-z]/.test(l));
    for (const r of reqs) expect(r).toMatch(/^[a-z0-9_-]+==[0-9.]+( ; python_version [<>=]+ "3\.\d+")? \\$/);
    for (const m of Object.values(allow.modules)) for (const p of m.packages) expect(allow.packages[p]).toBeDefined();
    expect(Object.keys(allow.modules)).not.toEqual(expect.arrayContaining(["robo" + "dk"]));
    expect(requirements).not.toMatch(/^robo/m);
  });

  it("setup_env.py installs a module with the packages it needs and refuses anything else", () => {
    const dry = spawnSync("python3", ["-I", path.join(ENV_TOOLS, "setup_env.py"), "--dry-run", "--env", path.join(tmpdir(), "x-env"), "svgpathtools"], { encoding: "utf8" });
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain("packages: svgpathtools svgwrite numpy scipy");
    expect(dry.stdout).toContain("--require-hashes --only-binary :all:");
    const refused = spawnSync("python3", ["-I", path.join(ENV_TOOLS, "setup_env.py"), "sklearn"], { encoding: "utf8" });
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain("Not on Enginuity's list of packages it installs: sklearn");
  });
});

async function setup() {
  const e = await engine();
  const asks: { html: string; title?: string }[] = [];
  const progress: { html: string; closed: boolean }[] = [];
  e.services.ask = async (html, _buttons, title) => {
    asks.push({ html, title });
    return "OK";
  };
  e.services.progress = (html) => {
    const p = { html, closed: false };
    progress.push(p);
    return { close: () => void (p.closed = true) };
  };
  const runner = new mod.PythonRunner(e, () => undefined);
  e.services.python = runner.service();
  const statuses = () => e.events.filter((x) => x.type === "status").map((x) => String(x.text));
  return { e, runner, asks, progress, statuses };
}

async function until(f: () => boolean, ms = 30000) {
  const t0 = Date.now();
  while (!f()) {
    if (Date.now() - t0 > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

 
const needs = (module: string) =>
  `import os\nif not os.path.exists(${JSON.stringify(path.join(fake.markers, module))}):\n    raise ModuleNotFoundError("No module named '${module}'")\nprint("${module} ok")\n`;

describe.skipIf(process.env.ENGINUITY_PYENV_NET === "1")("runner: missing modules", () => {
  it("an allowlisted module is installed once, with a progress dialog, and the script runs again", async () => {
    const { runner, asks, progress, statuses } = await setup();
    installs.length = 0;
    let end: import("@/server/python-runner").PythonResult | undefined;
    runner.start("k1", "NeedsNumpy", needs("numpy"), { onEnd: (r) => (end = r) });
    await until(() => !!end);
    expect(installs).toEqual([{ modules: ["numpy"], base: "python3" }]);
    expect(progress).toHaveLength(1);
    expect(progress[0].html).toContain("Installing numpy for this script…");
    expect(progress[0].closed).toBe(true);
    expect(end!.exitCode).toBe(0);
    expect(end!.out).toContain("numpy ok");
    expect(statuses()).toContain("numpy is installed in Enginuity's Python environment. Running NeedsNumpy again.");
    expect(statuses().at(-1)).toBe("Python script finished successfully");
    expect(asks).toHaveLength(0);
    expect(runner.isRunning("k1")).toBe(false);
  });

  it("a failed installation reports why, with the original error, and does not loop", async () => {
    const { runner, asks } = await setup();
    installs.length = 0;
    fake.ok = false;
    let end: import("@/server/python-runner").PythonResult | undefined;
    runner.start("k2", "NeedsScipy", needs("scipy"), { onEnd: (r) => (end = r) });
    await until(() => !!end);
    fake.ok = true;
    expect(installs).toHaveLength(1);
    expect(end!.exitCode).not.toBe(0);
    expect(asks[0].html).toContain("No module named 'scipy'");
    expect(asks[0].html).toContain("Enginuity could not install scipy");
  });

  it("a module that is not on the list is named, with the line that installs it, and nothing is installed", async () => {
    const { runner, asks } = await setup();
    installs.length = 0;
    let end: import("@/server/python-runner").PythonResult | undefined;
    runner.start("k3", "NeedsSklearn", "import sklearn\n", { onEnd: (r) => (end = r) });
    await until(() => !!end);
    expect(installs).toHaveLength(0);
    expect(asks[0].html).toContain('The script needs the Python package "scikit-learn" (module sklearn), which Enginuity does not install by itself.');
    expect(asks[0].html).toContain("-m pip install --user scikit-learn");
    expect(asks[0].html).not.toMatch(new RegExp(`install[^<]*${"robo" + "dk"}`, "i"));
  });

  it("the API's own module names never lead to an installation", async () => {
    const { runner, asks } = await setup();
    installs.length = 0;
    let end: import("@/server/python-runner").PythonResult | undefined;
     
    runner.start("k4", "Api", `raise ModuleNotFoundError("No module named '${"robo" + "dk"}.robosomething'")\n`, { onEnd: (r) => (end = r) });
    await until(() => !!end);
    expect(installs).toHaveLength(0);
    expect(asks[0].html).not.toContain("pip install");
  });

  it("an interpreter chosen in the options gets nothing installed into it", async () => {
    const { e, runner, asks } = await setup();
    installs.length = 0;
     
    e.services.settings.Path_PythonRun2 = spawnSync("python3", ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" }).stdout.trim();
    let end: import("@/server/python-runner").PythonResult | undefined;
    runner.start("k5", "Custom", needs("svgwrite"), { onEnd: (r) => (end = r) });
    await until(() => !!end);
    delete e.services.settings.Path_PythonRun2;
    expect(installs).toHaveLength(0);
    expect(asks[0].html).toContain('The script needs the Python package "svgwrite". Install it for this interpreter with:');
  });

  it("Stop during the installation ends the run as interrupted", async () => {
    const { runner } = await setup();
    installs.length = 0;
    let end: import("@/server/python-runner").PythonResult | undefined;
    runner.start("k6", "Stopped", needs("svgpathtools"), { onEnd: (r) => (end = r) });
    await until(() => installs.length === 1);
    expect(runner.isRunning("k6")).toBe(true);
    runner.stop("k6");
    await until(() => !!end);
    expect(end!.interrupted).toBe(true);
  });

  it("the hint names the environment's interpreter without --user", () => {
    expect(mod.missingPackageHint("ModuleNotFoundError: No module named 'cv2'", "/data/python-env/bin/python3", true)).toContain("/data/python-env/bin/python3 -m pip install opencv-python");
    expect(mod.missingModule("ModuleNotFoundError: No module named 'a'\n...\nModuleNotFoundError: No module named 'numpy.linalg'")).toBe("numpy");
  });
});

describe.skipIf(process.env.ENGINUITY_PYENV_NET !== "1")("runner: real installation (network)", () => {
  it("installs svgwrite into a new environment and runs the script again with it", async () => {
    const { runner, progress } = await setup();
    const envMod = await import("@/server/python-env");
    expect(existsSync(envMod.envPython())).toBe(false);
    let end: import("@/server/python-runner").PythonResult | undefined;
    runner.start("n1", "UsesSvgwrite", "import svgwrite, sys\nprint('svgwrite', svgwrite.__file__.startswith(sys.prefix))\n", { onEnd: (r) => (end = r) });
    await until(() => !!end, 300_000);
    expect(end!.exitCode).toBe(0);
    expect(end!.out).toContain("svgwrite True");
    expect(progress[0]?.closed).toBe(true);
    expect(existsSync(envMod.envPython())).toBe(true);
  }, 300_000);
});
