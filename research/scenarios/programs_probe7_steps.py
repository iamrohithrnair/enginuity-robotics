# Probes path-step and motion-splitting settings during program generation and execution.




import glob
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from programs_probe_common import *  # noqa: E402,F403

OUT = sys.argv[4] if len(sys.argv) > 4 else "/tmp/programs_probe7"
RDK = connect()
RDK.Command("Popups", "0")
KEYS = ["MoveLSplitMM", "MoveLSplitDeg", "MoveLSplitMinMM", "MoveJSplitDeg", "MoveCSplitMM", "MoveCSplitDeg",
        "MoveCSplitMinMM", "PathStepMM", "PathStepCollisionMM", "PathStepCollisionDeg", "SimulationSpeed",
        "CollisideOneStop", "ToleranceSingularityWrist", "ToleranceSingularityElbow", "ToleranceSingularityBack",
        "ToleranceTurn180", "ProgMoveJType", "ProgMoveLType", "ProgMoveCType"]
for k in KEYS:
    step("setting.%s" % k, lambda k=k: RDK.Command(k))

robot, frame, tool = new_station(RDK, "PP7")
J0 = [0, 0, 0, 0, 30, 0]
robot.setJoints(J0)
P0 = robot.Pose()
tr = robomath.transl
S0 = cart_target(RDK, robot, frame, "S0", P0)
S1 = cart_target(RDK, robot, frame, "S1", P0 * tr(0, 100, 0))
C1 = cart_target(RDK, robot, frame, "C1", P0 * tr(50, 150, 0))
C2 = cart_target(RDK, robot, frame, "C2", P0 * tr(0, 200, 0))
p = RDK.AddProgram("SplitP", robot)
p.setPoseFrame(frame)
p.setPoseTool(tool)
p.MoveJ(S0)
p.MoveL(S1)
p.MoveC(C1, C2)


def gen(tag):
    d = os.path.join(OUT, tag)
    os.makedirs(d, exist_ok=True)
    for f in glob.glob(d + "/*"):
        os.remove(f)
    p.MakeProgram(d)
    f = glob.glob(d + "/*.mod")[0]
    moves = [l.strip().split(" ")[0] for l in open(f).read().splitlines() if l.strip().startswith(("MoveL", "MoveJ", "MoveC", "MoveAbsJ"))]
    ys = [l.strip().split("[[")[1].split("]")[0].split(",")[1] for l in open(f).read().splitlines() if l.strip().startswith("MoveL")]
    return [moves, ys]


step("gen.default", lambda: gen("default"))
RDK.Command("MoveLSplitMM", "30")
step("gen.MoveLSplitMM=30", lambda: gen("split30"))
RDK.Command("MoveLSplitMM", "-1")
RDK.Command("MoveCSplitDeg", "45")
step("gen.MoveCSplitDeg=45", lambda: gen("csplit45"))
RDK.Command("MoveCSplitDeg", "270")

for step_mm in ["1", "5"]:
    RDK.Command("PathStepMM", step_mm)
    RDK.setSimulationSpeed(1)
    robot.setJoints(J0)
    q = RDK.AddProgram("Q" + step_mm, robot)
    q.setPoseFrame(frame); q.setPoseTool(tool)
    q.setSpeed(50)
    q.MoveL(S1)
    q.RunCode()
    ys = set()
    t0 = time.time()
    while q.Busy() and time.time() - t0 < 6:
        ys.add(round(robot.Pose()[1, 3] - P0[1, 3], 3))
        time.sleep(0.01)
    ys = sorted(ys)
    step("sim.PathStepMM=%s.all_sampled_offsets_are_multiples" % step_mm, lambda ys=ys, s=float(step_mm): all(abs(y / s - round(y / s)) < 1e-6 for y in ys))
    step("sim.PathStepMM=%s.first_offsets" % step_mm, lambda ys=ys: ys[:8])
RDK.Command("PathStepMM", "1")
RDK.setSimulationSpeed(5)
RDK.Disconnect()
print("done", flush=True)
