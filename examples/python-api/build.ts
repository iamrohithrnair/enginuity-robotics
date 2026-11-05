// Builds a UR3e drawing cell whose Python program creates square and circular paths.
 
 
 

import { box, C, rbox, type ExampleBuilder, type Part } from "../lib/builder";
import type { ExampleSpec } from "../lib/spec";

const TABLE_Z = 750;
const BOARD: [number, number] = [270, 0];

export const DRAW_SCRIPT = `"""Draw on the board with the Enginuity Python API.

Run it (double-click) to rebuild the program Drawing: a square drawn with MoveL and a circle
drawn with two MoveC moves, on the Board frame, lifting the pencil between the shapes.
The enginuity package ships with Enginuity, which also tells it where its API is.
"""
import math

from enginuity import ITEM_TYPE_FRAME, ITEM_TYPE_PROGRAM, ITEM_TYPE_ROBOT, ITEM_TYPE_TARGET, ITEM_TYPE_TOOL, Enginuity
from enginuity.robomath import rotx, rotz, transl

rdk = Enginuity()
robot = rdk.Item("UR3e", ITEM_TYPE_ROBOT)
board = rdk.Item("Board", ITEM_TYPE_FRAME)
pencil = rdk.Item("Pencil", ITEM_TYPE_TOOL)

# start over: remove what an earlier run made
old = rdk.Item("Drawing", ITEM_TYPE_PROGRAM)
if old.Valid():
    old.Delete()
for t in rdk.ItemList(ITEM_TYPE_TARGET):
    if t.Name().startswith("Draw "):
        t.Delete()

LIFT = 30  # pencil lift between the shapes (mm)


def target(name, x, y, z=0.0):
    """A target on the board: the pencil tip at x, y (mm), pointing into the board."""
    t = rdk.AddTarget("Draw " + name, board, robot)
    t.setPose(transl(x, y, z) * rotz(0) * rotx(math.pi))
    return t


prog = rdk.AddProgram("Drawing", robot)
prog.setPoseFrame(board)
prog.setPoseTool(pencil)
prog.setSpeed(150)

# a 120 mm square
s = 60
corners = [(-s, -s), (s, -s), (s, s), (-s, s), (-s, -s)]
prog.MoveJ(target("Square Above", -s, -s, LIFT))
for i, (x, y) in enumerate(corners):
    prog.MoveL(target("Square %d" % (i + 1), x, y))
prog.MoveL(target("Square Lift", -s, -s, LIFT))

# a circle inside it: two half circles
r = 45
prog.MoveJ(target("Circle Above", r, 0, LIFT))
prog.MoveL(target("Circle Start", r, 0))
prog.MoveC(target("Circle Via 1", 0, r), target("Circle Half", -r, 0))
prog.MoveC(target("Circle Via 2", 0, -r), target("Circle End", r, 0))
prog.MoveL(target("Circle Lift", r, 0, LIFT))

valid, seconds, length, ratio, message = prog.Update()
print("Drawing: %d instructions, %.1f s, %.0f mm, %s" % (valid, seconds, length, message or "ok"))
`;

const spec: ExampleSpec = {
  name: "Python API Drawing",
  description:
    "A UR3e draws a square and a circle on a board. The drawing program was made by the Python program DrawOnBoard with Enginuity's own enginuity package (robolink style: targets, MoveJ, MoveL, MoveC); run it again to rebuild the program, or change it to draw something else.",
  features: ["Python API", "enginuity package", "MoveC", "MoveJ", "MoveL", "Program calls"],
  mainProgram: "Main",
  view: { azimuth: -55, elevation: 36, zoom: 1.1 },
  async build(b: ExampleBuilder) {
    const table: Part[] = [rbox([900, 700, 40], 8, [150, 0, TABLE_Z - 40], C.light)];
    for (const x of [-250, 550]) for (const y of [-300, 300]) table.push(box([50, 50, TABLE_Z - 40], [x, y, 0], C.steel));
    for (const y of [-300, 300]) table.push(box([800, 30, 30], [150, y, 180], C.steel));
    await b.assembly("Table", table);
    await b.shape("Robot Riser", rbox([200, 200, 20], 6, [0, 0, TABLE_Z], C.dark));
    const home = [0, -100, -110, -60, 90, 0];
    const robot = await b.robot("UR3e.robot", [0, 0, TABLE_Z + 20], { home });
    await b.tool("Generic-Pencil-Tool.tool", robot, { name: "Pencil" });
    await b.assembly("Drawing Board", [rbox([300, 260, 12], 4, [0, 0, 0], C.base), rbox([280, 240, 2], 2, [0, 0, 12], C.white)], [BOARD[0], BOARD[1], TABLE_Z]);
    await b.frame("Board", [BOARD[0], BOARD[1], TABLE_Z + 14]);

     
    const py = await b.cmd<{ id: string }>("python.add", { name: "DrawOnBoard", code: DRAW_SCRIPT });
    const { startRdkApiServer } = await import("@/server/rdkapi/server");
    const { getServer } = await import("@/server/store");
    const s = getServer();
    const api = await startRdkApiServer({ ports: [0], log: () => undefined });
    const port = s.services.settings.RC_API_PORT;
    s.services.settings.RC_API_PORT = api.port;
    const statuses: string[] = [];
    const listen = (e: { type: string; [k: string]: unknown }) => {
      if (e.type === "status") statuses.push(String(e.text));
    };
    s.listeners.add(listen);
    try {
      await b.cmd("robot.setJoints", { robot, joints: [0, -90, -120, -60, 90, 0] });
      await b.cmd("python.run", { item: py.id });
      const t0 = Date.now();
      await new Promise((r) => setTimeout(r, 200));
      while (s.services.python?.isRunning(py.id) && Date.now() - t0 < 120_000) await new Promise((r) => setTimeout(r, 50));
    } finally {
      s.listeners.delete(listen);
      if (port === undefined) delete s.services.settings.RC_API_PORT;
      else s.services.settings.RC_API_PORT = port;
      await api.close();
    }
    if (!statuses.some((t) => /finished successfully/.test(t))) throw new Error(`DrawOnBoard did not finish:\n  ${statuses.join("\n  ")}`);
    if (!Object.values(b.ws.items).some((i) => i.type === "program" && i.name === "Drawing")) throw new Error("DrawOnBoard made no Drawing program");

    const homeT = await b.jointTarget("Home", b.item(robot).parent!, robot, home);
    const main = await b.program("Main", robot);
    await main.speed(250, 90);
    await main.moveJ(homeT);
    await main.call("Drawing");
    await main.moveJ(homeT);
    await main.message("Drawing finished");

    await b.cmd("robot.setJoints", { robot, joints: home });
    await b.notes(
      "About this cell",
      "<p><b>Python API Drawing</b> — run <b>Main</b>, or double-click <b>DrawOnBoard</b> to run the Python program that makes <b>Drawing</b>.</p><p>DrawOnBoard uses the <code>enginuity</code> package that ships with Enginuity: <code>Enginuity()</code>, <code>Item</code>, <code>AddTarget</code>, <code>AddProgram</code>, <code>MoveJ</code> / <code>MoveL</code> / <code>MoveC</code> and <code>Update</code>, the same calls robolink scripts use.</p>",
    );
  },
};

export default spec;
