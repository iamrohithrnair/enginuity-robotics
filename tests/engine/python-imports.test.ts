 
 
 
 
 
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { initKinematics, parseRdkFile } from "@/engine/kinematics";
import { rewritePythonImports as rw } from "@/engine/python-imports";
import { LIBRARY_KIND_DIR } from "../library";

 
const P = ["robo", "dk"].join("");
const PRODUCT = ["Robo", "DK"].join("");

describe("from <pkg> ... import", () => {
  it.each([
    [`from ${P}.robolink import *`, "from enginuity.robolink import *"],
    [`from ${P}.robomath import *`, "from enginuity.robomath import *"],
    [`from ${P}.robolink import Robolink, ITEM_TYPE_ROBOT`, "from enginuity.robolink import Robolink, ITEM_TYPE_ROBOT"],
    [`from ${P}.robodialogs import mbox`, "from enginuity.dialogs import mbox"],
    [`from ${P}.robofileio import *`, "from enginuity.fileio import *"],
    [`from ${P}.robolinkutils import getAncestors`, "from enginuity.utils import getAncestors"],
    [`from ${P}.robolink import Robolink as RL`, "from enginuity.robolink import Robolink as RL"],
    [`from ${P} import robolink`, "from enginuity import robolink"],
    [`from ${P} import robomath`, "from enginuity import robomath"],
    [`from ${P} import robolink, robomath`, "from enginuity import robolink, robomath"],
    [`from ${P} import robolink, robodialogs, robomath`, "from enginuity import robolink, dialogs as robodialogs, robomath"],
    [`from ${P} import robolink, robomath, robolinkutils, robodialogs, robofileio`, "from enginuity import robolink, robomath, utils as robolinkutils, dialogs as robodialogs, fileio as robofileio"],
    [`from ${P} import robolinkutils`, "from enginuity import utils as robolinkutils"],
    [`from ${P} import robodialogs as dlg`, "from enginuity import dialogs as dlg"],
    [`from ${P} import robolink as rl, robomath as rm`, "from enginuity import robolink as rl, robomath as rm"],
    [`from ${P} import *`, "from enginuity.prelude import *"],
    [`from ${P} import transl, Mat`, "from enginuity.prelude import transl, Mat"],
    [`from ${P} import robolink, transl`, "from enginuity.prelude import robolink, transl"],
     
    [`from ${P} import robolink, robodialog`, "from enginuity.prelude import robolink, robodialog"],
    ["from robolink import *", "from enginuity.robolink import *"],
    ["from robomath import transl, rotz", "from enginuity.robomath import transl, rotz"],
    ["from robodialogs import *", "from enginuity.dialogs import *"],
    ["from robofileio import LoadList", "from enginuity.fileio import LoadList"],
    ["from robolinkutils import *", "from enginuity.utils import *"],
  ])("%s", (src, out) => {
    expect(rw(src)).toBe(out);
    expect(rw(src + "\n")).toBe(out + "\n");
  });

  it("keeps indentation, trailing comments and the other statements of the line", () => {
    expect(rw(`try:\n    from ${P}.robolink import Robolink  # API\nexcept ImportError:\n    pass\n`)).toBe("try:\n    from enginuity.robolink import Robolink  # API\nexcept ImportError:\n    pass\n");
    expect(rw(`import sys; from ${P} import robolink; x = 1`)).toBe("import sys; from enginuity import robolink; x = 1");
    expect(rw(`if True: from ${P} import robodialogs`)).toBe("if True: from enginuity import dialogs as robodialogs");
    expect(rw(`from ${P} import robolink    \r\nfrom robolink import *\r\n`)).toBe("from enginuity import robolink    \r\nfrom enginuity.robolink import *\r\n");
  });

  it("rewrites parenthesised multi-line imports in place (line numbers kept)", () => {
    const src = `from ${P}.robolink import (\n    Robolink,\n    ITEM_TYPE_ROBOT,\n)\nprint(1)\n`;
    expect(rw(src)).toBe("from enginuity.robolink import (\n    Robolink,\n    ITEM_TYPE_ROBOT,\n)\nprint(1)\n");
    const src2 = `from ${P} import (robolink,\n    robodialogs)\n`;
    expect(rw(src2)).toBe("from enginuity import (robolink,\n    dialogs as robodialogs)\n");
  });

  it("leaves relative imports, other packages and look-alike names alone", () => {
    for (const src of ["from . import robolink", "from .robolink import x", "from mypkg.robolink import x", `from ${P}x import y`, "import robolinker", "from enginuity.robolink import *", "import numpy as np"]) expect(rw(src)).toBe(src);
  });
});

describe("import ...", () => {
  it.each([
    ["import robolink", "from enginuity import robolink"],
    ["import robomath", "from enginuity import robomath"],
    ["import robodialogs", "from enginuity import dialogs as robodialogs"],
    ["import robomath as rm", "from enginuity import robomath as rm"],
    ["import robomath as rm2, robolink as rl2", "from enginuity import robomath as rm2; from enginuity import robolink as rl2"],
    ["import os, robolink, sys", "import os; from enginuity import robolink; import sys"],
    [`import ${P} as rdkpkg`, "import enginuity.prelude as rdkpkg"],
    [`import ${P}.robolink as rl`, "import enginuity.robolink as rl"],
    [`import ${P}.robodialogs as d`, "import enginuity.dialogs as d"],
  ])("%s", (src, out) => expect(rw(src)).toBe(out));

  it("`import <pkg>` rewrites the later uses of the package name", () => {
    const src = [`import ${P}`, `import ${P}.robolink, ${P}.robomath`, `RDK = ${P}.robolink.Robolink()`, `pose = ${P}.robomath.transl(1, 2, 3)`, `${P}.robodialogs.mbox("hi")`, `m = ${P}.transl(0, 0, 1)`, `pkg = ${P}`, `s = "${P}.robolink"  # ${P} in a comment`, `obj.${P}_attr = 1`, ""].join("\n");
    expect(rw(src)).toBe(
      [
        "import enginuity.prelude",
        "import enginuity.prelude",
        "RDK = enginuity.robolink.Robolink()",
        "pose = enginuity.robomath.transl(1, 2, 3)",
        'enginuity.dialogs.mbox("hi")',
        "m = enginuity.prelude.transl(0, 0, 1)",
        "pkg = enginuity.prelude",
        `s = "${P}.robolink"  # ${P} in a comment`,
        `obj.${P}_attr = 1`,
        "",
      ].join("\n"),
    );
  });

  it("without `import <pkg>` a variable of that name is not touched", () => {
    const src = `${P} = 3\nprint(${P})\n`;
    expect(rw(src)).toBe(src);
  });

  it("backslash-continued imports keep their line count", () => {
    const src = "import os, \\\n    robolink\nprint(2)\n";
    const out = rw(src);
    expect(out.split("\n")).toHaveLength(src.split("\n").length);
    expect(out).toBe("import os; from enginuity import robolink \\\n\nprint(2)\n");
  });
});

describe("API names spelled with the old product name", () => {
  it("renames the methods, functions, constants and connection keyword arguments", () => {
    const src = [
      `RDK = Robolink(${P}_path="/opt/app", ${P}_ip="localhost")`,
      `RDK.Show${PRODUCT}()`,
      `RDK.Hide${PRODUCT}()`,
      `RDK.Close${PRODUCT}()`,
      `RDK.setFlags${PRODUCT}(FLAG_${PRODUCT.toUpperCase()}_ALL & ~FLAG_${PRODUCT.toUpperCase()}_TREE_ACTIVE)`,
      `print(getPath${PRODUCT}())`,
      `${P}_path = "kept: a variable of the script"`,
      `msg = "Show${PRODUCT} stays in a string"`,
      "",
    ].join("\n");
    expect(rw(src)).toBe(
      [
        'RDK = Robolink(app_path="/opt/app", ip="localhost")',
        "RDK.ShowEnginuity()",
        "RDK.HideEnginuity()",
        "RDK.CloseEnginuity()",
        "RDK.setFlagsEnginuity(FLAG_ENGINUITY_ALL & ~FLAG_ENGINUITY_TREE_ACTIVE)",
        "print(getPathEnginuity())",
        `${P}_path = "kept: a variable of the script"`,
        `msg = "Show${PRODUCT} stays in a string"`,
        "",
      ].join("\n"),
    );
  });

  it("renames constants in import lists too", () => {
    expect(rw(`from ${P}.robolink import FLAG_${PRODUCT.toUpperCase()}_ALL`)).toBe("from enginuity.robolink import FLAG_ENGINUITY_ALL");
  });
});

describe("what stays", () => {
  it("leaves strings, docstrings and comments as written", () => {
    const src = `"""Docs: from ${P}.robolink import *"""\nx = 'import robolink'\n# from ${P} import robomath\ny = f"{1}from ${P} import *"\nz = rb'\\'from robolink import *'\n`;
    expect(rw(src)).toBe(src);
  });

  it("is idempotent and returns code without such imports unchanged", () => {
    const src = `from ${P} import robolink, robodialogs\nimport ${P}\nprint(${P}.robolink.Robolink)\n`;
    const once = rw(src);
    expect(rw(once)).toBe(once);
    expect(rw("print('hello')\n")).toBe("print('hello')\n");
    expect(rw("")).toBe("");
  });
});

 
const LIB = LIBRARY_KIND_DIR("stations");
const hasMirror = existsSync(LIB) && readdirSync(LIB).some((f) => /\.rdk$/i.test(f));
const hasPython = spawnSync("python3", ["-c", "1"]).status === 0;




const CHECK = `
import io, json, sys, tokenize
P = sys.argv[1]
pairs = json.load(sys.stdin)
bad = []
def compiles(src):
    try:
        compile(src, "s", "exec")
        return "ok"
    except SyntaxError as e:
        return "syntax-error line %s" % e.lineno
    except Exception as e:
        return type(e).__name__
for name, a, b in pairs:
    if compiles(a) != compiles(b):
        bad.append([name, "compile", compiles(a), compiles(b)])
    if a.count("\\n") != b.count("\\n"):
        bad.append([name, "lines"])
    try:
        toks = list(tokenize.generate_tokens(io.StringIO(b).readline))
    except Exception:
        continue
    for t in toks:
        if t.type == tokenize.NAME and (t.string == P or t.string.startswith("FLAG_" + P.upper())):
            bad.append([name, "token", t.string, t.start[0]])
            break
print(json.dumps(bad))
`;

describe.skipIf(!hasMirror || !hasPython)("library example scripts", () => {
  let scripts: { name: string; code: string }[] = [];
  beforeAll(async () => {
    await initKinematics();
    for (const f of readdirSync(LIB).filter((x) => /\.rdk$/i.test(x))) {
      let items: { kind: string; name: string; code?: string }[];
      try {
        items = (parseRdkFile(readFileSync(path.join(LIB, f))).json as { items: typeof items }).items;
      } catch {
        continue;
      }
      for (const it of items) if (it.kind === "python") scripts.push({ name: `${f}/${it.name}`, code: it.code ?? "" });
    }
  }, 300_000);

  it("rewrites every Python program of the example stations (same compile outcome, line numbers kept, nothing of the old package left)", () => {
    expect(scripts.length).toBeGreaterThan(600);
    const pairs = scripts.map((s) => [s.name, s.code, rw(s.code)]);
    const importsOld = new RegExp(`^\\s*(from|import)\\s+${P}\\b`, "m");
    expect(pairs.filter(([, a]) => importsOld.test(a)).length).toBeGreaterThan(600);
    const r = spawnSync("python3", ["-I", "-c", CHECK, P], { input: JSON.stringify(pairs), encoding: "utf8", maxBuffer: 64 << 20 });
    expect(r.stderr).toBe("");
    expect(JSON.parse(r.stdout)).toEqual([]);
    for (const [, , b] of pairs) expect(rw(b)).toBe(b);
    scripts = [];
  }, 120_000);
});
