# Probes post-generation failures for invalid names, output paths and split programs.

















import os
import stat
import sys

PORT = int(sys.argv[1])
OUT_DIR = sys.argv[2]
TMPDIR = sys.argv[3]
ROBOT_FILE = sys.argv[4]
CASE = sys.argv[5]
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


def listing(folder):
    if not os.path.isdir(folder):
        return "<no folder>"
    return sorted(f for f in os.listdir(folder) if not f.startswith("."))


RDK = robolink.Robolink(port=PORT, args=[], quit_on_close=False)
RDK.setRunMode(robolink.RUNMODE_SIMULATE)
step("cmd_programs_show_0", lambda: RDK.Command("ProgramsShow", "0"))
step("cmd_popups_get", lambda: RDK.Command("Popups", ""))
if CASE not in ("readonly_dir", "fanuc_split"):
    step("cmd_popups_0", lambda: RDK.Command("Popups", "0"))
step("new_station", lambda: RDK.AddStation("PostgenErrors_" + CASE).Name())
robot = RDK.AddFile(ROBOT_FILE)
frame = RDK.AddFrame("Frame E")
robot.setJoints([0, -10, 20, 0, 30, 0])
t1 = RDK.AddTarget("T1", frame, robot)
prog = RDK.AddProgram("ErrProg", robot)
prog.setPoseFrame(frame)
prog.MoveJ(t1)
cases = ["unreachable", "empty_folder"] if CASE == "all" else [CASE]

for case in cases:
    folder = os.path.join(OUT_DIR, case) + "/"
    os.makedirs(folder, exist_ok=True)
    if case == "missing_post":
        step(f"{case}.set", lambda: robot.setParam("PostProcessor", "Fanuc_R30iA"))
        step(f"{case}.get", lambda: robot.setParam("PostProcessor", ""))
        step(f"{case}.make", lambda: prog.MakeProgram(folder))
        step(f"{case}.files", lambda: listing(folder))
        robot.setParam("PostProcessor", "ABB_RAPID_IRC5")
    elif case.startswith("bad_post_"):
        name = {"bad_post_dot_py": "ABB_RAPID_IRC5.py", "bad_post_space": "ABB RAPID IRC5",
                "bad_post_lower": "abb_rapid_irc5"}[case]
        step(f"{case}.set", lambda: robot.setParam("PostProcessor", name))
        step(f"{case}.get", lambda: robot.setParam("PostProcessor", ""))
        step(f"{case}.make", lambda: prog.MakeProgram(folder))
        step(f"{case}.files", lambda: listing(folder))
        robot.setParam("PostProcessor", "ABB_RAPID_IRC5")
    elif case == "unreachable":
        far = RDK.AddTarget("T far", frame, robot)
        far.setPose(robomath.transl(5000, 0, 0) * robomath.rotx(robomath.pi))
        bad = RDK.AddProgram("UnreachProg", robot)
        bad.setPoseFrame(frame)
        bad.MoveJ(t1)
        bad.MoveL(far)
        bad.MoveJ(t1)
        step(f"{case}.update", lambda: bad.Update())
        step(f"{case}.make", lambda: bad.MakeProgram(folder))
        step(f"{case}.files", lambda: listing(folder))
    elif case == "readonly_dir":
        os.chmod(folder, stat.S_IRUSR | stat.S_IXUSR)
        step(f"{case}.make", lambda: prog.MakeProgram(folder))
        os.chmod(folder, stat.S_IRWXU)
        step(f"{case}.files", lambda: listing(folder))
    elif case == "empty_folder":
        step(f"{case}.cmd_path_programs", lambda: RDK.Command("PATH_PROGRAMS", folder))
        step(f"{case}.make", lambda: prog.MakeProgram(""))
        step(f"{case}.files", lambda: listing(folder))
    elif case == "fanuc_split":
        robot.setParam("PostProcessor", "Fanuc_R30i")
        RDK.Command("ProgMaxLines", "5")
        lp = RDK.AddProgram("LongProg", robot)
        lp.setPoseFrame(frame)
        for i in range(12):
            lp.MoveJ(t1)
        step(f"{case}.make", lambda: lp.MakeProgram(folder))
        step(f"{case}.files", lambda: listing(folder))

RDK.Disconnect()
print("done", flush=True)
