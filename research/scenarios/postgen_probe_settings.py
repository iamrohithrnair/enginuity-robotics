










import os
import shutil
import sys

PORT = int(sys.argv[1])
OUT_DIR = sys.argv[2]
TMPDIR = sys.argv[3]
ROBOT_FILE = sys.argv[4]
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, os.pardir, "python", "enginuity", "src"))  

from enginuity import robolink, robomath  # noqa: E402


def fmt(v):
    if isinstance(v, robomath.Mat):
        return fmt(v.rows)
    if isinstance(v, float):
        r = round(v, 3)
        return "0.0" if r == 0 else repr(r)
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join(fmt(x) for x in v) + "]"
    return repr(v)


def step(label, fn):
    try:
        out = fn()
        print(f"{label}: {fmt(out)}", flush=True)
        return out
    except Exception as exc:
        msg = str(exc).strip().splitlines()[0] if str(exc).strip() else type(exc).__name__
        print(f"{label}: ERROR {type(exc).__name__}: {msg}", flush=True)
        return None


def make_with_capture(prog, folder):
    os.makedirs(folder, exist_ok=True)
    tmp = os.path.join(TMPDIR, "Post" + prog.Name() + ".py")
    link = os.path.join(folder, ".link_intermediate.py")
    for p in (tmp, link):
        if os.path.exists(p):
            os.remove(p)
    with open(tmp, "w") as f:
        f.write("# placeholder written by postgen_probe_settings before MakeProgram\n")
    os.link(tmp, link)
    result = prog.MakeProgram(folder)
    shutil.copyfile(link, os.path.join(folder, "intermediate_Post" + prog.Name() + ".py"))
    os.remove(link)
    return result


def listing(folder):
    return sorted((f, os.path.getsize(os.path.join(folder, f))) for f in os.listdir(folder) if not f.startswith("."))


def calls(folder, prog_name):
    pass
    path = os.path.join(folder, "intermediate_Post" + prog_name + ".py")
    out = []
    for line in open(path):
        line = line.strip()
        if line.startswith(("r.Move", "r.setFrame", "r.setTool", "r.Pause", "r = RobotPost", "print(")):
            out.append(line[:160])
    return out


RDK = robolink.Robolink(port=PORT, args=[], quit_on_close=False)
RDK.setRunMode(robolink.RUNMODE_SIMULATE)
step("cmd_programs_show_0", lambda: RDK.Command("ProgramsShow", "0"))
step("new_station", lambda: RDK.AddStation("PostgenSettings").Name())
robot = RDK.AddFile(ROBOT_FILE)
frame = RDK.AddFrame("Frame S")
frame.setPose(robomath.transl(1234.56789, -98.7654321, 50.5) * robomath.rotz(30 * robomath.pi / 180))
tool = robot.AddTool(robomath.transl(10, 20, 150), "Tool S")
robot.setPoseTool(tool)
robot.setJoints([0, -10, 20, 0, 30, 0])
t1 = RDK.AddTarget("T1", frame, robot)
t2 = RDK.AddTarget("T2 stale joints", frame, robot)
t2.setPose(t1.Pose() * robomath.transl(0, 50, 0))
t3 = RDK.AddTarget("T3 joint", frame, robot)
t3.setJoints([20, -10, 20, 0, 30, 0])
t3.setAsJointTarget()
t4 = RDK.AddTarget("T4 arc mid", frame, robot)
t4.setPose(t1.Pose() * robomath.transl(50, 100, 0))
t5 = RDK.AddTarget("T5 arc end", frame, robot)
t5.setPose(t1.Pose() * robomath.transl(100, 50, 0))
robot.setJoints([30, -20, 40, 60, -45, -100])
tf = RDK.AddTarget("T6 flip", frame, robot)
step("tf_joints", lambda: tf.Joints())
step("tf_config", lambda: robot.JointsConfig(tf.Joints()))
robot.setJoints([0, -10, 20, 0, 30, 0])

prog = RDK.AddProgram("SetProg", robot)
prog.setPoseFrame(frame)
prog.setPoseTool(tool)
prog.MoveJ(t1)
prog.MoveL(t2)
prog.MoveC(t4, t5)
prog.MoveJ(t3)
prog.Pause(250)
prog.MoveJ(tf)

variants = [
    ("v00_baseline", {}),
    ("v01_MaxDecimalsPost_10", {"MaxDecimalsPost": "10"}),
    ("v02_ProgMoveJType_1", {"ProgMoveJType": "1"}),
    ("v03_ProgMoveJType_2", {"ProgMoveJType": "2"}),
    ("v04_ProgMoveLType_1", {"ProgMoveLType": "1"}),
    ("v05_ProgMoveLType_2", {"ProgMoveLType": "2"}),
    ("v06_ProgMoveCType_1", {"ProgMoveCType": "1"}),
    ("v07_ProgMoveCType_2", {"ProgMoveCType": "2"}),
    ("v08_ProgMoveNames_1", {"ProgMoveNames": "1"}),
    ("v09_ProgRecalc_1", {"ProgRecalc": "1"}),
]
for name, cmds in variants:
    olds = {}
    for k, v in cmds.items():
        olds[k] = RDK.Command(k, "")
        step(f"{name}.set[{k}={v}] (was {olds[k]!r})", lambda k=k, v=v: RDK.Command(k, v))
    folder = os.path.join(OUT_DIR, name)
    step(f"{name}.make", lambda folder=folder: make_with_capture(prog, folder))
    for i, line in enumerate(calls(folder, prog.Name())):
        print(f"{name}.call[{i}]: {line}", flush=True)
    for k, v in olds.items():
        RDK.Command(k, v)


long_prog = RDK.AddProgram("LongProg", robot)
long_prog.setPoseFrame(frame)
long_prog.setPoseTool(tool)
for i in range(12):
    long_prog.MoveJ(t1 if i % 2 == 0 else t3)
step("maxlines.old", lambda: RDK.Command("ProgMaxLines", ""))
step("maxlines.set5", lambda: RDK.Command("ProgMaxLines", "5"))


for post in ["ABB_RAPID_IRC5", "KUKA_KRC4", "Universal_Robots"]:
    robot.setParam("PostProcessor", post)
    folder = os.path.join(OUT_DIR, "v10_ProgMaxLines_5", post)
    step(f"maxlines.{post}.make", lambda folder=folder: make_with_capture(long_prog, folder))
    step(f"maxlines.{post}.files", lambda folder=folder: listing(folder))
step("maxlines.reset", lambda: RDK.Command("ProgMaxLines", "-1"))
robot.setParam("PostProcessor", "ABB_RAPID_IRC5")
folder = os.path.join(OUT_DIR, "v10_ProgMaxLines_default", "ABB_RAPID_IRC5")
step("maxlines.default.make", lambda: make_with_capture(long_prog, folder))


sub = RDK.AddProgram("SubProg2", robot)
sub.setPoseFrame(frame)
sub.MoveJ(t3)
main = RDK.AddProgram("MainCall", robot)
main.setPoseFrame(frame)
main.MoveJ(t1)
main.RunInstruction("SubProg2", robolink.INSTRUCTION_CALL_PROGRAM)
main.RunInstruction("NotAProgram", robolink.INSTRUCTION_CALL_PROGRAM)
folder = os.path.join(OUT_DIR, "v11_subprogram_call")
step("subcall.make", lambda: make_with_capture(main, folder))
step("subcall.files", lambda: listing(folder))
step("inline.set", lambda: RDK.Command("ProgInlineSubprogs", "1"))
folder = os.path.join(OUT_DIR, "v12_subprogram_inline")
step("inline.make", lambda: make_with_capture(main, folder))
step("inline.files", lambda: listing(folder))
RDK.Command("ProgInlineSubprogs", "0")


for label, build in [
    ("only_movec", lambda p: p.MoveC(t4, t5)),
    ("only_pause", lambda p: p.Pause(100)),
    ("only_setdo", lambda p: p.setDO(1, 1)),
    ("two_movej", lambda p: (p.MoveJ(t1), p.MoveJ(t3))),
]:
    p = RDK.AddProgram("Count_" + label, robot)
    build(p)
    folder = os.path.join(OUT_DIR, "v13_count", label)
    step(f"count.{label}.make", lambda p=p, folder=folder: make_with_capture(p, folder))
    for line in calls(folder, p.Name()):
        if line.startswith("print("):
            print(f"count.{label}: {line}", flush=True)


bare = RDK.AddProgram("Bare Prog-1 (x)", robot)
bare.MoveJ(t3)
bare.MoveJ(t1)
step("bare.name", lambda: bare.Name())
folder = os.path.join(OUT_DIR, "v14_bare_special_name")
step("bare.make", lambda: make_with_capture(bare, folder))
step("bare.files", lambda: listing(folder))

RDK.Disconnect()
print("done", flush=True)
