# Records API status and error behavior for unreachable moves and invalid inputs.



import os
import sys

PORT = int(sys.argv[1])
ROBOT_FILE = sys.argv[2]
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, os.pardir, "python", "enginuity", "src"))  
from enginuity import robolink, robomath  # noqa: E402


def step(label, fn):
    try:
        print(f"{label}: {fn()!r}", flush=True)
    except Exception as exc:
        msg = str(exc).strip().splitlines()[0] if str(exc).strip() else ""
        print(f"{label}: ERROR {type(exc).__name__}: {msg}", flush=True)


RDK = robolink.Robolink(port=PORT, args=[], quit_on_close=False)
RDK.setRunMode(robolink.RUNMODE_SIMULATE)
RDK.Command("Popups", "0")
RDK.AddStation("StatusProbe")
robot = RDK.AddFile(ROBOT_FILE)
robot.setJoints([0, -10, 20, 0, 30, 0])
step("movel_unreachable", lambda: robot.MoveL(robomath.transl(5000, 0, 0), True))
step("movej_joints_out_of_limits", lambda: robot.MoveJ([0, 0, 0, 0, 0, 9999], True))
step("movej_ok", lambda: robot.MoveJ([0, -10, 20, 0, 30, 10], True))
step("movel_through_singularity", lambda: robot.MoveL(robot.SolveFK([0, -10, 20, 0, -30, 10]), True))
step("instruction_invalid_index", lambda: RDK.AddProgram("P", robot).Instruction(5))
step("item_invalid_name", lambda: RDK.Item("nope").Name())
step("add_target_no_parent", lambda: RDK.AddTarget("T", 0, robot).Name())
step("setparam_post_on_frame", lambda: RDK.AddFrame("F").setParam("PostProcessor", "KUKA_KRC4"))
step("joints_config_bad", lambda: robot.JointsConfig([1, 2]))
step("solve_fk_bad_len", lambda: robot.SolveFK([1, 2]))
RDK.Disconnect()
print("done", flush=True)
