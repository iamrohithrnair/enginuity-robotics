







import os
import sys

PORT = int(sys.argv[1])
ROBOT_FILE, TOOL_FILE, STL_FILE = sys.argv[2], sys.argv[3], sys.argv[4]
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, os.pardir, "python", "enginuity", "src"))  

from enginuity import robolink, robomath  # noqa: E402
from enginuity.robomath import transl, rotz, rotx  # noqa: E402


def fmt(v):
    if isinstance(v, robomath.Mat):
        return fmt(v.rows)
    if isinstance(v, robolink.Item):
        return "<null>" if not v.Valid() else f"<{v.Name()}|t{v.Type()}>"
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


def xyzrpw(pose):
    return [round(v, 3) for v in robomath.Pose_2_TxyzRxyz(pose)]


RDK = robolink.Robolink(port=PORT, args=[], quit_on_close=False)
RDK.setRunMode(robolink.RUNMODE_SIMULATE)
RDK.Command("Popups", "0")


st = RDK.AddStation("ExtProbe")
step("S01_active_station", lambda: RDK.ActiveStation().Name())
step("S02_open_stations_contains", lambda: "ExtProbe" in [s.Name() for s in RDK.getOpenStations()])
step("S03_station_parent", lambda: st.Parent())


A = RDK.AddFrame("A")
B = RDK.AddFrame("B")
step("F01_auto_poses", lambda: [xyzrpw(A.Pose()), xyzrpw(B.Pose())])
A.setPose(transl(100, 0, 0))
B.setPose(transl(0, 500, 0) * rotz(robomath.pi / 2))
C = RDK.AddFrame("C", A)
C.setPose(transl(10, 20, 30))
step("F02_child_rel_abs", lambda: [xyzrpw(C.Pose()), xyzrpw(C.PoseAbs())])
C.setParent(B)
step("F03_setParent_keeps_relative", lambda: [C.Parent().Name(), xyzrpw(C.Pose()), xyzrpw(C.PoseAbs())])
C.setParentStatic(A)
step("F04_setParentStatic_keeps_absolute", lambda: [C.Parent().Name(), xyzrpw(C.Pose()), xyzrpw(C.PoseAbs())])
step("F05_parent_into_own_child", lambda: (A.setParent(C), A.Parent().Name())[1])
step("F06_childs", lambda: [c.Name() for c in A.Childs()])
step("F07_setPoseAbs", lambda: (C.setPoseAbs(transl(1, 2, 3)), xyzrpw(C.Pose()))[1])
step("F08_empty_name_frame", lambda: RDK.AddFrame("").Name())
step("F09_item_by_type", lambda: [RDK.Item("A", robolink.ITEM_TYPE_FRAME).Name(), RDK.Item("A", robolink.ITEM_TYPE_ROBOT).Valid()])
step("F10_frames_list", lambda: RDK.ItemList(robolink.ITEM_TYPE_FRAME, True))


B.setVisible(False)
step("V01_visible", lambda: [A.Visible(), B.Visible()])
RDK.setSelection([A, B])
step("V02_selection", lambda: [i.Name() for i in RDK.Selection()])
RDK.setSelection([])
step("V03_selection_cleared", lambda: len(RDK.Selection()))


robot = RDK.AddFile(ROBOT_FILE)
step("R01_robot_parent", lambda: [robot.Parent().Name(), robot.Parent().Type(), xyzrpw(robot.Parent().Pose())])
step("R02_active_frame_after_load", lambda: robot.getLink(robolink.ITEM_TYPE_FRAME))
robot.setPoseFrame(A)
step("R03_active_frame", lambda: robot.getLink(robolink.ITEM_TYPE_FRAME).Name())
step("R04_pose_frame", lambda: xyzrpw(robot.PoseFrame()))
robot.setJoints([0, -10, 20, 0, 30, 0])
step("R05_pose_wrt_frame", lambda: xyzrpw(robot.Pose()))
t1 = robot.AddTool(transl(0, 0, 100), "T1")
t2 = robot.AddTool(transl(0, 0, 200), "T2")
step("R06_active_tool_stays_first", lambda: [robot.getLink(robolink.ITEM_TYPE_TOOL).Name(), xyzrpw(robot.PoseTool())])
robot.setPoseTool(t2)
step("R07_setPoseTool_item", lambda: [robot.getLink(robolink.ITEM_TYPE_TOOL).Name(), xyzrpw(robot.PoseTool())])
step("R08_tool_parent", lambda: [t2.Parent().Name(), t2.Parent().Type()])
step("R09_solveik_approx", lambda: [round(v, 3) for v in robot.SolveIK(robot.SolveFK([10, -10, 20, 40, 30, 0]), [10, -10, 20, 40, 30, 0]).list()][:6])
step("R10_joint_poses_count", lambda: len(robot.JointPoses()))
robot.setJointsHome([0, -5, 5, 0, 10, 0])
step("R11_home", lambda: robot.JointsHome())
step("R12_short_joints", lambda: (robot.setJoints([1, 2, 3]), robot.Joints())[1])
tool_file = RDK.AddFile(TOOL_FILE, robot)
step("R13_tool_file", lambda: [tool_file.Name(), tool_file.Type(), tool_file.Parent().Name()])
obj = RDK.AddFile(STL_FILE)
step("R14_object_file", lambda: [obj.Type(), obj.Parent().Name()])


RDK.setSimulationSpeed(100)
step("M01_sim_speed", lambda: RDK.SimulationSpeed())
robot.setPoseTool(t1)
robot.setJoints([0, -10, 20, 0, 30, 0])
step("M02_movej_joints", lambda: (robot.MoveJ([10, -10, 20, 0, 30, 0]), robot.Joints())[1])
step("M03_movej_outside_limits", lambda: robot.MoveJ([0, 0, 0, 0, 0, 9999]))
step("M04_movej_unreachable_pose", lambda: robot.MoveJ(transl(5000, 0, 0)))
step("M05_movel_tool_z", lambda: (robot.MoveL(robot.Pose() * transl(0, 0, 20)), [round(v, 2) for v in robot.Joints().list()])[1])
step("M06_movel_half_turn", lambda: robot.MoveL(robot.Pose() * rotx(robomath.pi)))
step("M07_busy_after_wait", lambda: (robot.MoveJ([0, -10, 20, 0, 30, 0], False), robot.WaitMove(), robot.Busy())[2])
step("M08_joints_after_nonblocking", lambda: robot.Joints())


robot.setJoints([0, -10, 20, 0, 30, 0])
T1 = RDK.AddTarget("T1", A, robot)
step("T01_target", lambda: [T1.Parent().Name(), T1.isJointTarget(), xyzrpw(T1.Pose())])
T2 = RDK.AddTarget("", A, robot)
step("T02_empty_name_target", lambda: T2.Name())
T2.setJoints([20, -10, 20, 0, 30, 0])
step("T03_setJoints_keeps_pose", lambda: [xyzrpw(T2.Pose()) == xyzrpw(T1.Pose()), T2.Joints()])
T2.setAsJointTarget()
step("T04_joint_target", lambda: T2.isJointTarget())
T2.setAsCartesianTarget()
step("T05_cartesian_again", lambda: T2.isJointTarget())
step("T06_movej_target", lambda: (robot.MoveJ(T1), [round(v, 3) for v in robot.Joints().list()])[1])


P = RDK.AddProgram("P", robot)
P.Pause(100)
P.Pause(200)
P.Pause(300)
P.InstructionSelect(0)
P.Pause(400)
P.Pause(500)
step("P01_insert_after_selected", lambda: [P.Instruction(i)[0] for i in range(P.InstructionCount())])
step("P02_instruction_delete", lambda: (P.InstructionDelete(1), P.InstructionCount())[1])
step("P03_select_idle", lambda: P.InstructionSelect())
step("P04_post_get", lambda: P.setParam("PostProcessor"))
step("P05_post_set_py", lambda: (robot.setParam("PostProcessor", "KUKA_KRC4.py"), robot.setParam("PostProcessor"))[1])
step("P06_post_on_frame", lambda: A.setParam("PostProcessor", "KUKA_KRC4"))
R = RDK.AddProgram("R", robot)
R.setPoseFrame(A)
R.setPoseTool(t1)
R.MoveJ(T1)
R.MoveJ(T2)
R.setSpeed(-1, 30)
R.setRounding(-1)
R.RunInstruction("Hi", robolink.INSTRUCTION_SHOW_MESSAGE)
R.RunInstruction("Thr", robolink.INSTRUCTION_START_THREAD)
R.RunInstruction("x = 1", robolink.INSTRUCTION_INSERT_CODE)
R.setAO(3, 2.5)
R.setDO("Valve", 0)
step("P07_names", lambda: [R.Instruction(i)[:2] for i in range(R.InstructionCount())])
step("P08_update", lambda: R.Update())
step("P09_run_and_wait", lambda: (R.RunProgram(), R.WaitFinished(), [round(v, 3) for v in robot.Joints().list()])[2])
step("P10_io_param_after_run", lambda: [RDK.getParam("AO_3"), RDK.getParam("Valve")])


RDK.Copy(A, False)
step("K01_paste_without_children", lambda: (lambda p: [p.Name(), len(p.Childs()), p.Parent().Name()])(RDK.Paste(B)))
step("K02_paste_twice", lambda: [p.Name() for p in RDK.Paste(B, 2)])
RDK.Copy(T1)
step("K03_paste_target_keeps_robot_link", lambda: (lambda p: [p.Name(), p.Parent().Name(), p.getLink(robolink.ITEM_TYPE_ROBOT).Name()])(RDK.Paste(A)))
X = RDK.AddFrame("X")
Y = RDK.AddFrame("Y", X)
RDK.Delete([X, Y])
step("K04_delete_list", lambda: [X.Valid(True), Y.Valid(True)])


RDK.setParam("ExtParam", "7")
step("C01_params_contains", lambda: ["ExtParam", 7.0] in [list(p) for p in RDK.getParams()])
step("C02_cmd_get_default", lambda: [RDK.Command("ProgMoveJType", ""), RDK.Command("PathStepMM", "")])
step("C03_cmd_set", lambda: (RDK.Command("ProgMoveNames", "1"), RDK.Command("ProgMoveNames", ""), RDK.Command("ProgMoveNames", "0"))[:2])
step("C04_cmd_unknown_is_help", lambda: RDK.Command("NoSuchCommandX", "").startswith("(Command)"))
step("C05_popups_get", lambda: RDK.Command("Popups", ""))
step("C06_collisions", lambda: RDK.Collisions())
step("C07_item_list_types", lambda: sorted(set(i.Type() for i in RDK.ItemList())))

RDK.Command("Popups", "1")
RDK.Disconnect()
print("done", flush=True)
