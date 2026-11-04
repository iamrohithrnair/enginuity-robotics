











import os
import shutil
import sys

PORT = int(sys.argv[1])
OUT_DIR = sys.argv[2]
TMPDIR = sys.argv[3]
ROBOT_FILE = sys.argv[4]
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, os.pardir, "python", "enginuity", "src"))  

from enginuity import robolink, robomath  # noqa: E402

POSTS = ["ABB_RAPID_IRC5", "KUKA_KRC4", "Universal_Robots", "Fanuc_R30i"]
PROG = "PgProg"


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


def make_with_capture(prog, post, folder):
    pass
    os.makedirs(folder, exist_ok=True)
    tmp = os.path.join(TMPDIR, "Post" + prog.Name() + ".py")
    link = os.path.join(folder, ".link_intermediate.py")
    for p in (tmp, link):
        if os.path.exists(p):
            os.remove(p)
    with open(tmp, "w") as f:
        f.write("# placeholder written by postgen_probe before MakeProgram\n")
    os.link(tmp, link)
    result = prog.MakeProgram(folder)
    dest = os.path.join(folder, "intermediate_Post" + prog.Name() + ".py")
    shutil.copyfile(link, dest)
    os.remove(link)
    return result


RDK = robolink.Robolink(port=PORT, args=[], quit_on_close=False)
RDK.setRunMode(robolink.RUNMODE_SIMULATE)


step("version", lambda: RDK.Version())
step("new_station", lambda: RDK.AddStation("PostgenStation").Name())
step("cmd_path_post", lambda: RDK.Command("PathPostProcessor"))
step("cmd_path_programs_get", lambda: RDK.Command("PathPrograms", ""))
step("param_unknown", lambda: RDK.getParam("NoSuchParam_xyz"))
for c in ["ProgramsShow", "Popups", "ProgMoveJType", "ProgMoveLType", "ProgMoveCType", "ProgMoveNames",
          "ProgRecalc", "ProgMaxLines", "ProgInlineSubprogs", "ProgMoveExtAxesPoses"]:
    step(f"cmd_default[{c}]", lambda c=c: RDK.Command(c, ""))

step("cmd_programs_show_0", lambda: RDK.Command("ProgramsShow", "0"))

robot = RDK.AddFile(ROBOT_FILE)
step("robot_name", lambda: robot.Name())
step("robot_default_post", lambda: robot.setParam("PostProcessor", ""))
base = robot.Parent()
step("robot_base_name", lambda: base.Name())
step("robot_base_pose", lambda: base.Pose())

frame = RDK.AddFrame("Frame Pg")
step("frame_set_pose", lambda: frame.setPose(robomath.transl(1234.56789, -98.7654321, 50.5) * robomath.rotz(30 * robomath.pi / 180)) and None)
step("frame_pose", lambda: frame.Pose())
frame2 = RDK.AddFrame("Frame Child")
step("frame2_set_parent", lambda: frame2.setParent(frame).Name())
step("frame2_parent_name", lambda: frame2.Parent().Name())
step("frame2_set_pose", lambda: frame2.setPose(robomath.transl(-300, 400, 20) * robomath.rotz(-30 * robomath.pi / 180)) and None)
step("frame2_pose_rel_parent", lambda: frame2.Pose())

tool = robot.AddTool(robomath.transl(10, 20, 150) * robomath.rotx(robomath.pi / 12), "Tool Pg")
tool2 = robot.AddTool(robomath.transl(0, 0, 200), "Tool2")
robot.setPoseTool(tool)
step("robot_pose_tool", lambda: robot.PoseTool())

robot.setJoints([0, -10, 20, 0, 30, 0])
t1 = RDK.AddTarget("Target 1", frame, robot)
step("t1_pose", lambda: t1.Pose())
step("t1_joints", lambda: t1.Joints())
t2 = RDK.AddTarget("Target 2", frame, robot)
t2.setPose(t1.Pose() * robomath.transl(0, 50, 0))
t3 = RDK.AddTarget("Target 3", frame, robot)
t3.setJoints([20, -10, 20, 0, 30, 0])
t3.setAsJointTarget()
t4 = RDK.AddTarget("Target Arc Mid", frame, robot)
t4.setPose(t1.Pose() * robomath.transl(50, 100, 0))
t5 = RDK.AddTarget("Target Arc End", frame, robot)
t5.setPose(t1.Pose() * robomath.transl(100, 50, 0))
t6 = RDK.AddTarget("Target Precise", frame, robot)
t6.setPose(t1.Pose() * robomath.transl(12.3456789, -7.654321, 3.14159265))
step("t6_pose", lambda: t6.Pose())
robot.setJoints([-5, -5, 15, 10, 40, -10])
t7 = RDK.AddTarget("Target In Child Frame", frame2, robot)
step("t7_pose_rel_child", lambda: t7.Pose())
step("t7_joints", lambda: t7.Joints())
robot.setJoints([0, -10, 20, 0, 30, 0])

prog = RDK.AddProgram(PROG, robot)
step("p_frame", lambda: prog.setPoseFrame(frame) and None)
step("p_tool", lambda: prog.setPoseTool(tool) and None)
step("p_speed", lambda: prog.setSpeed(250) and None)
step("p_rounding", lambda: prog.setRounding(5) and None)
step("p_movej_t1", lambda: prog.MoveJ(t1) and None)
step("p_movel_t2", lambda: prog.MoveL(t2) and None)
step("p_movec_t4_t5", lambda: prog.MoveC(t4, t5) and None)
step("p_movej_t3_joint", lambda: prog.MoveJ(t3) and None)
step("p_speed4", lambda: prog.setSpeed(100, 60, 800, 120) and None)
step("p_movel_t6", lambda: prog.MoveL(t6) and None)
step("p_rounding0", lambda: prog.setRounding(0) and None)
step("p_movel_t1", lambda: prog.MoveL(t1) and None)
step("p_pause_500", lambda: prog.Pause(500) and None)
step("p_pause_stop", lambda: prog.Pause() and None)
step("p_message", lambda: prog.RunInstruction("Hello from postgen", robolink.INSTRUCTION_SHOW_MESSAGE))
step("p_comment", lambda: prog.RunInstruction("a comment", robolink.INSTRUCTION_COMMENT))
step("p_call", lambda: prog.RunInstruction("SubProgram", robolink.INSTRUCTION_CALL_PROGRAM))
step("p_code", lambda: prog.RunInstruction("CustomCode(42)", robolink.INSTRUCTION_INSERT_CODE))
step("p_thread", lambda: prog.RunInstruction("ThreadProg", robolink.INSTRUCTION_START_THREAD))
step("p_setdo", lambda: prog.setDO(1, 1) and None)
step("p_setdo_named", lambda: prog.setDO("Valve", 0) and None)
step("p_setao", lambda: prog.setAO(3, 2.5) and None)
step("p_waitdi", lambda: prog.waitDI(2, 1) and None)
step("p_waitdi_timeout", lambda: prog.waitDI(4, 0, 1500) and None)
step("p_tool2", lambda: prog.setPoseTool(tool2) and None)
step("p_movej_t2_tool2", lambda: prog.MoveJ(t2) and None)
step("p_movej_joints_list", lambda: prog.MoveJ([10, -15, 25, 5, 35, 5]) and None)
step("p_movel_child_frame_target", lambda: prog.MoveL(t7) and None)
n = step("p_ins_count", lambda: prog.InstructionCount())
for i in range(n or 0):
    step(f"p_ins_{i}", lambda i=i: prog.Instruction(i)[:4])
step("p_update", lambda: prog.Update())


for post in POSTS:
    step(f"set_post_{post}", lambda post=post: robot.setParam("PostProcessor", post))
    step(f"get_post_{post}", lambda: robot.setParam("PostProcessor", ""))
    folder = os.path.join(OUT_DIR, post) + "/"
    step(f"make_{post}", lambda post=post, folder=folder: make_with_capture(prog, post, folder))
    step(f"files_{post}", lambda folder=folder: sorted((f, os.path.getsize(folder + f)) for f in os.listdir(folder) if not f.startswith(".")))


lib = "/workspace/src/RoboDK/RoboDK.app/Contents/Library/"
others = {
    "KUKA KR 6 R900 sixx": os.path.join(os.path.dirname(ROBOT_FILE), "KUKA-KR-6-R900-sixx.robot"),
    "UR5e": os.path.join(os.path.dirname(ROBOT_FILE), "UR5e.robot"),
    "Fanuc ARC Mate 120iB": lib + "04-Robot arc welding - CFP/Parts/Fanuc-ARC-Mate-120iB-10L.robot",
    "Motoman GP8": lib + "03-Glue dispensing - CFP/Parts/Motoman-GP8.robot",
    "Kawasaki RS006L": lib + "15-Grinding car rim with a turntable - CFP/Parts/Kawasaki-RS006L.robot",
    "Comau Smart5 NJ": lib + "Add-in - Collision-free path - Spot Welding with Comau/Parts/Comau-Smart5-NJ-130-2-6.robot",
    "KUKA KR 10 R900 sixx": lib + "02-Robot drilling x2 coordinate systems/Parts/KUKA-KR-10-R900-sixx.robot",
    "UR10": lib + "01-Robot painting/Parts/UR10.robot",
}
for label, path in others.items():
    r = RDK.AddFile(path)
    step(f"default_post[{label}]", lambda r=r: (r.Name(), r.setParam("PostProcessor", "")))

RDK.Disconnect()
print("done", flush=True)
