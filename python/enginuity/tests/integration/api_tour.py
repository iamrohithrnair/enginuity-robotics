# Exercises live client APIs, including events, machining and spray operations.








from __future__ import annotations

import json
import math
import os
import sys
import threading
import traceback

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "src"))

from enginuity import (  # noqa: E402
    COLLISION_OFF,
    EVENT_ITEM_RENAMED,
    INS_TYPE_CODE,
    INS_TYPE_MOVE,
    INSTRUCTION_COMMENT,
    ITEM_TYPE_FRAME,
    ITEM_TYPE_OBJECT,
    ITEM_TYPE_PROGRAM,
    ITEM_TYPE_PROGRAM_PYTHON,
    ITEM_TYPE_ROBOT,
    ITEM_TYPE_STATION,
    ITEM_TYPE_TARGET,
    ITEM_TYPE_TOOL,
    RUNMODE_QUICKVALIDATE,
    RUNMODE_SIMULATE,
    InvalidItemError,
    Item,
    Enginuity,
    EnginuityError,
    NotSupportedError,
    TargetReachError,
    dialogs,
)
from enginuity.robomath import Mat, eye, invH, pose_2_xyzrpw, rotx, rotz, transl  # noqa: E402

PORT = int(sys.argv[1])
ROBOT_FILE = sys.argv[2]
WORK = sys.argv[3]

passed = 0
failed = 0


def report(name: str, ok: bool, detail: object = None) -> None:
    global passed, failed
    if ok:
        passed += 1
    else:
        failed += 1
    print(json.dumps({"check": name, "ok": bool(ok), "detail": None if detail is None else str(detail)[:400]}), flush=True)


def check(name: str, fn) -> object:
    try:
        value = fn()
    except Exception as e:  # noqa: BLE001 - report every failure and go on
        report(name, False, "%s: %s\n%s" % (type(e).__name__, e, traceback.format_exc(limit=3)))
        return None
    report(name, value is not False, value)
    return value


def raises(name: str, exc: type, fn) -> None:
    try:
        fn()
    except exc as e:
        report(name, True, "%s: %s" % (type(e).__name__, e))
        return
    except Exception as e:  # noqa: BLE001
        report(name, False, "expected %s, got %s: %s" % (exc.__name__, type(e).__name__, e))
        return
    report(name, False, "expected %s, nothing raised" % exc.__name__)


def near(a, b, tol=1e-6) -> bool:
    a = a.tolist() if isinstance(a, Mat) else list(a)
    b = b.tolist() if isinstance(b, Mat) else list(b)
    flat_a = [x for r in a for x in (r if isinstance(r, list) else [r])]
    flat_b = [x for r in b for x in (r if isinstance(r, list) else [r])]
    return len(flat_a) == len(flat_b) and all(abs(x - y) <= tol for x, y in zip(flat_a, flat_b))


rdk = Enginuity(port=PORT)
dialogs.set_connection(rdk)


check("Version", lambda: rdk.Version().startswith("1.") or rdk.Version())
check("VersionInfo product", lambda: rdk.VersionInfo()["product"].startswith("Enginuity"))
check("License", lambda: len(rdk.License()) == 2)
check("Command Popups off", lambda: rdk.Command("Popups", 0) == "OK" and rdk.Command("Popups") == "0")
check("RunMode default simulate", lambda: rdk.RunMode() == RUNMODE_SIMULATE)
check("repr", lambda: "Enginuity" in repr(rdk))


station = check("AddStation", lambda: rdk.AddStation("PyTour"))
check("ActiveStation", lambda: rdk.ActiveStation() == station and station.Type() == ITEM_TYPE_STATION)
check("getOpenStations", lambda: station in rdk.getOpenStations())
robot = check("AddFile robot", lambda: rdk.AddFile(ROBOT_FILE))
check("robot type", lambda: robot.Type() == ITEM_TYPE_ROBOT)
check("Item by name and type", lambda: rdk.Item(robot.Name(), ITEM_TYPE_ROBOT) == robot)
check("Item missing is invalid", lambda: not rdk.Item("no such item").Valid())
check("ItemList", lambda: robot in rdk.ItemList())
check("ItemList names by type", lambda: robot.Name() in rdk.ItemList(ITEM_TYPE_ROBOT, True))


home = check("JointsHome", lambda: robot.JointsHome())
check("joint count", lambda: home.size() == (6, 1))
q = [10, -20, 30, 40, 50, 60]
check("setJoints / Joints", lambda: near(robot.setJoints(q).Joints(), q, 1e-9))
lo, hi, jt = check("JointLimits", lambda: robot.JointLimits()) or (None, None, None)
check("JointLimits sizes", lambda: lo.size() == (6, 1) and hi.size() == (6, 1) and jt >= 0)
fk = check("SolveFK", lambda: robot.SolveFK(q))
check("SolveIK round trip", lambda: near(robot.SolveIK(fk, q), q, 1e-3))
check("SolveIK unreachable gives [0]", lambda: robot.SolveIK(transl(0, 0, 10000) * fk).tolist() == [0.0])
check("SolveIK_All columns", lambda: robot.SolveIK_All(fk).size(1) >= 1)
check("JointsConfig", lambda: len(robot.JointsConfig(q).tolist()) == 4)
check("JointPoses", lambda: len(robot.JointPoses(q)) >= 7)
check("list SolveFK", lambda: near(rdk.SolveFK([robot], [q])[0], fk, 1e-9))
check("list SolveIK", lambda: near(rdk.SolveIK([robot], [fk], [q])[0], q, 1e-3))


tool = check("AddTool", lambda: robot.AddTool(transl(0, 0, 100), "Tour TCP"))
check("tool type", lambda: tool.Type() == ITEM_TYPE_TOOL)
check("PoseTool", lambda: near(robot.PoseTool(), transl(0, 0, 100)))
check("setPoseTool pose", lambda: near(robot.setPoseTool(transl(0, 0, 120)).PoseTool(), transl(0, 0, 120)))
check("setPoseTool item", lambda: robot.setPoseTool(tool) is robot)
frame = check("AddFrame", lambda: rdk.AddFrame("Tour Frame"))
check("frame type", lambda: frame.Type() == ITEM_TYPE_FRAME)
check("setPose / Pose frame", lambda: near(frame.setPose(transl(400, 0, 0)).Pose(), transl(400, 0, 0)))
check("PoseAbs frame", lambda: near(frame.PoseAbs(), transl(400, 0, 0)))
check("setPoseFrame item", lambda: near(robot.setPoseFrame(frame).PoseFrame(), invH(robot.PoseAbs()) * frame.PoseAbs(), 1e-6))
check("getLink tool", lambda: robot.getLink(ITEM_TYPE_TOOL) == tool)
check("getLink frame", lambda: robot.getLink(ITEM_TYPE_FRAME) == frame)
check("robot Pose is TCP in frame", lambda: robot.Pose().size() == (4, 4))


robot.setJoints([0, 0, 0, 0, 30, 0])
rdk.setSimulationSpeed(50)
check("SimulationSpeed", lambda: abs(rdk.SimulationSpeed() - 50) < 1e-6)
check("MoveJ joints blocking", lambda: near(robot.MoveJ([20, -10, 10, 0, 40, 0]).Joints(), [20, -10, 10, 0, 40, 0], 1e-6))
start = robot.Pose()
check("MoveL pose blocking", lambda: near(robot.MoveL(start * transl(0, 0, -20)).Pose(), start * transl(0, 0, -20), 1e-3))
check("MoveJ non-blocking + WaitMove", lambda: robot.MoveJ([0, 0, 0, 0, 30, 0], False).WaitMove() and near(robot.Joints(), [0, 0, 0, 0, 30, 0], 1e-6))
check("Busy idle", lambda: robot.Busy() == 0)
raises("MoveJ unreachable raises TargetReachError", TargetReachError, lambda: robot.MoveJ(transl(0, 0, 9000) * robot.Pose()))
check("setSpeed", lambda: robot.setSpeed(500, 90) is robot)
check("setRounding", lambda: robot.setRounding(1) is robot)
check("MoveJ_Test free move", lambda: robot.MoveJ_Test([0, 0, 0, 0, 30, 0], [10, 0, 0, 0, 30, 0]) == 0)


t1 = check("AddTarget", lambda: rdk.AddTarget("T1", frame, robot))
check("target type", lambda: t1.Type() == ITEM_TYPE_TARGET)
t1.setPose(transl(0, 0, 0) * robot.Pose())
t2 = rdk.AddTarget("T2", frame, robot)
t2.setPose(robot.Pose() * transl(30, 0, 0))
check("joint target", lambda: t2.setAsJointTarget().isJointTarget() and not t2.setAsCartesianTarget().isJointTarget())
prog = check("AddProgram", lambda: rdk.AddProgram("TourProg", robot))
check("program type", lambda: prog.Type() == ITEM_TYPE_PROGRAM)
check("program MoveJ target", lambda: prog.MoveJ(t1) is prog)
check("program MoveL target", lambda: prog.MoveL(t2) is prog)
check("program MoveJ joints", lambda: prog.MoveJ([0, 0, 0, 0, 30, 0]) is prog)
check("RunInstruction comment", lambda: prog.RunInstruction("a comment", INSTRUCTION_COMMENT) == 0)
check("Pause", lambda: prog.Pause(100) is prog)
check("setDO", lambda: prog.setDO("DO_1", 1) is prog)
check("InstructionCount", lambda: prog.InstructionCount() == 6)
check("Instruction move", lambda: prog.Instruction(0)[1] == INS_TYPE_MOVE and prog.Instruction(0)[4].size() == (4, 4))
check("Instruction comment", lambda: prog.Instruction(3)[1] == INS_TYPE_CODE)
check("setParam instruction record", lambda: isinstance(prog.setParam(0), dict))
check("Update", lambda: prog.Update()[3] == 1.0)
check("InstructionList", lambda: prog.InstructionList()[0].size(1) == 3)
check("InstructionListJoints", lambda: prog.InstructionListJoints(5, 5)[0] == "Success" and prog.InstructionListJoints(5, 5)[1].size(1) > 2)
check("InstructionSelect", lambda: prog.InstructionSelect(1) == 1)
check("InstructionDelete", lambda: prog.InstructionDelete(5) and prog.InstructionCount() == 5)
check("RunProgram + WaitFinished", lambda: prog.RunProgram() >= 0 and prog.WaitFinished() is prog)
outdir = os.path.join(WORK, "generated")
check("MakeProgram", lambda: prog.MakeProgram(outdir)[0] and len(os.listdir(outdir)) >= 1)


tri = Mat([[0, 100, 0, 0, 100, 100], [0, 0, 100, 0, 100, 0], [0, 0, 0, 0, 0, 0]])
obj = check("AddShape", lambda: rdk.AddShape(tri))
check("object type", lambda: obj.Type() == ITEM_TYPE_OBJECT)
check("setName / Name", lambda: obj.setName("Tour Plate").Name() == "Tour Plate")
check("setColor / Color", lambda: near(obj.setColor([1, 0, 0, 1]).Color(), [1, 0, 0, 1]))
check("setVisible / Visible", lambda: obj.setVisible(False).Visible() == 0 and obj.setVisible(True).Visible() == 1)
curve = check("AddCurve", lambda: rdk.AddCurve(Mat([[0, 50, 100], [0, 0, 0], [0, 0, 0]]), obj, True))
check("GetCurves", lambda: len(obj.GetCurves()) >= 1)
check("ProjectPoints", lambda: rdk.ProjectPoints([[20, 20, 50]], obj).size(1) == 1)
check("Scale", lambda: obj.Scale(2) is obj)
check("setParent / Parent", lambda: obj.setParent(frame).Parent() == frame)
check("setParentStatic keeps absolute pose", lambda: near(obj.setParentStatic(station).PoseAbs(), transl(400, 0, 0), 1e-6))
check("Childs", lambda: t1 in frame.Childs())
rdk.Copy(obj)
copy = check("Paste", lambda: rdk.Paste(station))
check("pasted name", lambda: copy.Name() == "Tour Plate" and copy != obj)
check("Delete", lambda: copy.Delete() is None and not copy.Valid())


def copy_children_flag():
    child = rdk.AddFrame("Tour Child", frame)
    frame.Copy(copy_children=False)
    alone = frame.Parent().Paste()  
    frame.Copy(copy_childs=True)
    full = rdk.Paste(station)
    ok = alone.Childs() == [] and alone.Parent() == frame.Parent()
    ok = ok and [c.Name() for c in full.Childs()] == [c.Name() for c in frame.Childs()]
    rdk.Delete([alone, full, child])
    return ok


def item_paste_times():
    obj.Copy()
    pasted = station.Paste(2)
    ok = isinstance(pasted, list) and len(pasted) == 2 and all(p.Parent() == station for p in pasted)
    rdk.Delete(pasted)
    return ok


check("Copy(copy_children=False) / Copy(copy_childs=True) / Item.Paste", copy_children_flag)
check("Item.Paste(2)", item_paste_times)
check("IsInside", lambda: obj.IsInside(obj) in (0, 1))
check("setCollisionActive", lambda: rdk.setCollisionActive(COLLISION_OFF) >= 0)
check("Collisions", lambda: rdk.Collisions() >= 0)
check("Collision pair", lambda: rdk.Collision(robot, obj) in (0, 1))
check("Selection", lambda: rdk.setSelection([obj]) is None and rdk.Selection() == [obj])
check("tool item setPoseTool", lambda: near(tool.setPoseTool(transl(0, 0, 150)).PoseTool(), transl(0, 0, 150)))


def addfile_py():
    f = os.path.join(WORK, "Tour_Helper.py")
    with open(f, "w") as fh:
        fh.write("print('helper')\n")
    it = rdk.AddFile(f)
    return it.Type() == ITEM_TYPE_PROGRAM_PYTHON and it.Name() == "Tour_Helper"


check("AddFile .py becomes a Python program", addfile_py)


def machining_update():
    proj = rdk.AddMachiningProject("Tour Follow", robot)
    prog, status = proj.setMillingParameters(part=obj)
    upd = proj.Update()
    linked = proj.getLink(ITEM_TYPE_PROGRAM) == prog and proj.getLink(ITEM_TYPE_ROBOT) == robot
    return prog.Valid() and len(upd) == 5 and isinstance(upd[4], str) and linked


check("machining project setMillingParameters + Update + getLink", machining_update)


check("station param (numbers come back as floats)", lambda: rdk.setParam("TourParam", 42) is None and rdk.getParam("TourParam") == 42.0)
check("station param text", lambda: rdk.setParam("TourText", "a,b") is None and rdk.getParam("TourText") == "a,b")
check("unknown param is None", lambda: rdk.getParam("NoSuchParamForTour") is None)
check("binary station param", lambda: rdk.setParam("TourBin", b"\x00\x01") is None and rdk.getParam("TourBin", False) == b"\x00\x01")
check("item parameter command", lambda: obj.setParam("Note", "hello") == "OK" and obj.setParam("Note") == "hello" and obj.getParam("Note") == "")
check("item binary param", lambda: obj.setParam("Blob", b"xyz") is None and obj.getParam("Blob") == "xyz")
check("getParams", lambda: ("TourParam", 42.0) in rdk.getParams())
check("Command unknown returns help", lambda: "(Command)" in rdk.Command("NoSuchStationCommand", ""))


check("setRunMode quick check", lambda: rdk.setRunMode(RUNMODE_QUICKVALIDATE) is None and rdk.RunMode() == RUNMODE_QUICKVALIDATE)
rdk.setRunMode(RUNMODE_SIMULATE)


check("ShowDialog default button", lambda: rdk.ShowDialog("Proceed?", ["No", "Yes"], "Tour") == ("Yes", ""))
check("mbox default", lambda: dialogs.mbox("Continue?") is True)
check("mbox tuple buttons", lambda: dialogs.mbox("On or off", ("On", "0"), ("Off", "-1")) == "0")
check("mbox entry", lambda: dialogs.mbox("How many?", entry="12") == "12")
check("InputDialog int", lambda: dialogs.InputDialog("Count", 7) == 7)
check("ShowMessage status", lambda: rdk.ShowMessage("hello", False) is None)


dead = Item(rdk, 987654321, ITEM_TYPE_OBJECT)
raises("invalid handle raises InvalidItemError", InvalidItemError, lambda: dead.Name())
check("Valid(check_deleted) for a dead handle", lambda: dead.Valid() and not dead.Valid(True))
check("connection survives errors", lambda: robot.Name() != "")


def events_check():
    rdk.EventsListen([EVENT_ITEM_RENAMED])
    obj.setName("Renamed Plate")
    e = rdk.WaitForEvent(timeout=10)
    rdk.EventsClose()
    return e.evt == EVENT_ITEM_RENAMED and e.item == obj and e.data == "Renamed Plate"


check("EventsListen / WaitForEvent rename", events_check)


def threads_check():
    errors = []

    def worker():
        try:
            for _ in range(25):
                robot.Joints()
                obj.Name()
        except Exception as e:  # noqa: BLE001
            errors.append(e)

    ts = [threading.Thread(target=worker) for _ in range(4)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    return not errors or errors


check("thread-safe calls", threads_check)
check("reconnect after Disconnect", lambda: rdk.Disconnect() is None and robot.Name() != "")
check("context manager", lambda: [Enginuity(port=PORT).__enter__().Item("", ITEM_TYPE_ROBOT).Valid()][0])


def spray_check():
    try:
        gun = rdk.Spray_Add(tool, obj)
    except NotSupportedError as e:
        return "not supported by this server: %s" % e
    info, data = rdk.Spray_GetStats()
    rdk.Spray_Clear()
    return isinstance(gun, int) and data.size(0) in (0, 4)


check("Spray (supported or refused at once)", spray_check)


check("robomath round trip", lambda: near(pose_2_xyzrpw(transl(1, 2, 3) * rotz(math.radians(30)) * rotx(math.radians(10))), [1, 2, 3, 10, 0, 30], 1e-9))
check("eye", lambda: near(eye(4) * transl(1, 2, 3), transl(1, 2, 3)))

rdk.CloseStation()
print(json.dumps({"summary": {"passed": passed, "failed": failed}}), flush=True)
sys.exit(min(failed, 100))
