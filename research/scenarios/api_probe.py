# Exercises robot loading, motion, kinematics and post generation through the client API.








import os
import sys

PORT = int(sys.argv[1])
ROBOT_FILE = sys.argv[2]
OUT_DIR = sys.argv[3]
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
        print(f"{label}: {fmt(fn())}", flush=True)
    except Exception as exc:  
        msg = str(exc).strip().splitlines()[0] if str(exc).strip() else type(exc).__name__
        print(f"{label}: ERROR {type(exc).__name__}: {msg}", flush=True)


RDK = robolink.Robolink(port=PORT, args=[], quit_on_close=False)
RDK.setRunMode(robolink.RUNMODE_SIMULATE)

step("new_station", lambda: RDK.AddStation("ProbeStation").Name())
step("item_list_names_initial", lambda: sorted(RDK.ItemList(list_names=True)))

frame = RDK.AddFrame("ProbeFrame")
step("frame_name", lambda: frame.Name())
step("frame_type", lambda: frame.Type())
step("frame_set_pose", lambda: frame.setPose(robomath.transl(100, 200, 300) * robomath.rotz(robomath.pi / 2)) and None)
step("frame_pose", lambda: frame.Pose())
step("frame_rename", lambda: frame.setName("ProbeFrame Renamed") and frame.Name())
step("frame_parent_type", lambda: frame.Parent().Type())

robot = RDK.AddFile(ROBOT_FILE)
step("robot_valid", lambda: robot.Valid())
step("robot_type", lambda: robot.Type())
step("robot_name", lambda: robot.Name())
step("robot_joints_home", lambda: robot.JointsHome())
step("robot_joint_limits", lambda: robot.JointLimits())
step("robot_joints", lambda: robot.Joints())
step("robot_set_joints", lambda: robot.setJoints([10, -20, 30, -40, 50, -60]) and None)
step("robot_joints_after", lambda: robot.Joints())
step("robot_pose_fk", lambda: robot.SolveFK([10, -20, 30, -40, 50, -60]))
step("robot_pose", lambda: robot.Pose())
step("robot_config", lambda: robot.JointsConfig([10, -20, 30, -40, 50, -60]))
step("robot_ik", lambda: robot.SolveIK(robot.SolveFK([10, -20, 30, -40, 50, -60])))
step("robot_ik_all_count", lambda: len(robot.SolveIK_All(robot.SolveFK([10, -20, 30, -40, 50, -60]))))
step("robot_ik_unreachable", lambda: robot.SolveIK(robomath.transl(5000, 0, 0)))
step("robot_set_joints_out_of_limits", lambda: robot.setJoints([0, 0, 0, 0, 0, 9999]) and robot.Joints())

tool = robot.AddTool(robomath.transl(0, 0, 100), "ProbeTool")
step("tool_name", lambda: tool.Name())
step("tool_type", lambda: tool.Type())
step("tool_pose_tcp", lambda: tool.PoseTool())
step("robot_pose_tool", lambda: robot.PoseTool())

robot.setJoints([0, -10, 20, 0, 30, 0])
t1 = RDK.AddTarget("Target 1", frame, robot)
step("target1_name", lambda: t1.Name())
step("target1_isjoint", lambda: t1.isJointTarget())
step("target1_pose", lambda: t1.Pose())
step("target1_joints", lambda: t1.Joints())
t2 = RDK.AddTarget("Target 2", frame, robot)
step("target2_set_pose", lambda: t2.setPose(t1.Pose() * robomath.transl(0, 50, 0)) and None)
t3 = RDK.AddTarget("Target 3", frame, robot)
step("target3_set_joints", lambda: t3.setJoints([20, -10, 20, 0, 30, 0]) and t3.setAsJointTarget() and None)
step("target3_isjoint", lambda: t3.isJointTarget())

prog = RDK.AddProgram("ProbeProg", robot)
step("prog_type", lambda: prog.Type())
step("prog_set_frame", lambda: prog.setPoseFrame(frame) and None)
step("prog_set_tool", lambda: prog.setPoseTool(tool) and None)
step("prog_set_speed", lambda: prog.setSpeed(250) and None)
step("prog_set_rounding", lambda: prog.setRounding(5) and None)
step("prog_movej", lambda: prog.MoveJ(t1) and None)
step("prog_movel", lambda: prog.MoveL(t2) and None)
step("prog_movej_joint_target", lambda: prog.MoveJ(t3) and None)
step("prog_pause", lambda: prog.Pause(500) and None)
step("prog_message", lambda: prog.RunInstruction("Hello from probe", robolink.INSTRUCTION_SHOW_MESSAGE) and None)
step("prog_comment", lambda: prog.RunInstruction("a comment", robolink.INSTRUCTION_COMMENT) and None)
step("prog_setdo", lambda: prog.setDO(1, 1) and None)
step("prog_waitdi", lambda: prog.waitDI(2, 1, 1000) and None)
step("prog_call", lambda: prog.RunInstruction("SubProgram", robolink.INSTRUCTION_CALL_PROGRAM) and None)
step("prog_ins_count", lambda: prog.InstructionCount())
for i in range(16):
    step(f"prog_ins_{i}", lambda i=i: prog.Instruction(i)[:2])
step("prog_update", lambda: prog.Update())



run = RDK.AddProgram("RunProg", robot)
run.setPoseFrame(frame)
run.setPoseTool(tool)
run.MoveJ(t1)
run.MoveL(t2)
run.MoveJ(t3)
step("run_update", lambda: run.Update())
step("run_program_result", lambda: run.RunProgram())
step("run_busy_wait_joints", lambda: (run.WaitFinished(), robot.Joints())[1])

os.makedirs(OUT_DIR, exist_ok=True)
step("prog_make", lambda: prog.MakeProgram(OUT_DIR))
step("generated_files", lambda: sorted(os.listdir(OUT_DIR)))

step("param_path_library_isdir", lambda: os.path.isdir(RDK.getParam("PATH_LIBRARY")))
step("param_set_get", lambda: (RDK.setParam("ProbeParam", "42"), RDK.getParam("ProbeParam"))[1])
step("collision_active_default", lambda: RDK.Collisions())
step("collision_set_on", lambda: RDK.setCollisionActive(robolink.COLLISION_ON))
step("collisions_count", lambda: RDK.Collisions())
step("collision_set_off", lambda: RDK.setCollisionActive(robolink.COLLISION_OFF))
step("item_by_name_missing", lambda: RDK.Item("DoesNotExist").Valid())
step("item_by_name_type", lambda: RDK.Item("ProbeFrame Renamed", robolink.ITEM_TYPE_FRAME).Name())
step("item_list_types", lambda: sorted((i.Type(), i.Name()) for i in RDK.ItemList()))
step("copy_paste", lambda: (RDK.Copy(t1), RDK.Paste(frame).Name())[1])
step("delete_target2", lambda: (t2.Delete(), t2.Valid())[1])
step("final_item_count", lambda: len(RDK.ItemList()))
RDK.Disconnect()
print("done", flush=True)
