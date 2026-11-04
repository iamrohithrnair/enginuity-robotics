










import hashlib
import io
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
SUITE = sys.argv[4]
OUT = sys.argv[5]
from programs_probe_common import *  # noqa: E402,F403

buf = io.StringIO()
_real_stdout = sys.stdout
sys.stdout = buf

RDK = connect()
RDK.Command("Popups", "0")
tr, rx, ry, rz = robomath.transl, robomath.rotx, robomath.roty, robomath.rotz


def fresh(name):
    close_all(RDK)
    RDK.AddStation(name)


def names(items):
    return [i.Name() for i in items]


def pos(item):
    return [round(v, 3) for v in item.Pose().Pos()]


if SUITE == "tree":
    fresh("ParityTree")
    f = [RDK.AddFrame("") for _ in range(3)]
    step("frames.names", lambda: names(f))
    step("frames.positions", lambda: [pos(x) for x in f])
    f[1].setName("Renamed")
    step("frame.after_rename", lambda: RDK.AddFrame("").Name())
    f[0].Delete()
    step("frame.after_delete", lambda: RDK.AddFrame("").Name())
    step("frames.all", lambda: names(RDK.ItemList(robolink.ITEM_TYPE_FRAME)))
    f[2].setPose(tr(0, 5000, 0))
    nxt = RDK.AddFrame("Next")
    step("frame.next_after_move.pos", lambda: pos(nxt))
    robot = RDK.AddFile(ABB)
    step("robot.name", lambda: robot.Name())
    step("robot.base", lambda: [robot.Parent().Name(), robot.Parent().Type(), pos(robot.Parent())])
    step("robot.active_frame_after_load", lambda: robot.getLink(robolink.ITEM_TYPE_FRAME).Valid())
    work = RDK.AddFrame("Work")
    step("robot.active_frame_after_new_frame", lambda: robot.getLink(robolink.ITEM_TYPE_FRAME).Name())
    a = RDK.AddFrame("A")
    a.setPose(tr(100, 0, 0))
    b = RDK.AddFrame("B")
    b.setPose(tr(0, 500, 0) * rz(math.radians(90)))
    c = RDK.AddFrame("C", a)
    c.setPose(tr(10, 20, 30))
    c.setParent(b)
    step("setParent.keeps_relative", lambda: [pos(c), [round(v, 3) for v in c.PoseAbs().Pos()]])
    c.setParentStatic(a)
    step("setParentStatic.keeps_absolute", lambda: [pos(c), [round(v, 3) for v in c.PoseAbs().Pos()]])
    t = RDK.AddTarget("T explicit", work, robot)
    step("target.parent_robot", lambda: [t.Parent().Name(), t.getLink(robolink.ITEM_TYPE_ROBOT).Name()])
    p = RDK.AddProgram("P1", robot)
    step("program.parent_robot", lambda: [p.Parent().Name(), p.getLink(robolink.ITEM_TYPE_ROBOT).Name()])
    work.Copy()
    pasted = RDK.Paste(a)
    step("paste.name_parent_pos", lambda: [pasted.Name(), pasted.Parent().Name(), pos(pasted)])
    base = robot.Parent()
    robot.Delete()
    step("delete_robot.base_valid", lambda: base.Valid())
    step("delete_robot.target_robot_link", lambda: t.getLink(robolink.ITEM_TYPE_ROBOT).Valid())
    step("station.items", lambda: sorted(names(RDK.ItemList())))

elif SUITE == "kin":
    fresh("ParityKin")
    abb = RDK.AddFile(ABB)
    for q in ([0, 0, 0, 0, 30, 0], [10, -20, 30, -40, 50, -60], [90, 45, -45, 120, -90, 270]):
        step("abb.fk%s" % q, lambda q=q: abb.SolveFK(q))
        step("abb.config%s" % q, lambda q=q: abb.JointsConfig(q).list())
    pose = abb.SolveFK([10, -20, 30, -40, 50, -60])
    step("abb.ik_closest", lambda: abb.SolveIK(pose, [0, 0, 0, 0, 30, 0]).list())
    step("abb.ik_all_count", lambda: len(abb.SolveIK_All(pose).list()) // 8 if abb.SolveIK_All(pose).list() else 0)
    step("abb.ik_unreachable", lambda: abb.SolveIK(tr(5000, 0, 0)).list())
    for q in ([9999], [200] * 6, [1, 2, 3]):
        abb.setJoints(q)
        step("abb.setJoints%s" % q, lambda: abb.Joints().list())
    step("abb.limits", lambda: [l.list() for l in abb.JointLimits()[:2]])
    ur = RDK.AddFile(UR5E)
    step("ur5e.base_pos", lambda: pos(ur.Parent()))
    for q in ([0, -90, -90, 0, 90, 0], [30, -60, 80, -110, -90, 45]):
        step("ur5e.fk%s" % q, lambda q=q: ur.SolveFK(q))
    upose = ur.SolveFK([30, -60, 80, -110, -90, 45])
    step("ur5e.ik_closest", lambda: ur.SolveIK(upose, [0, -90, -90, 0, 90, 0]).list())
    kuka = RDK.AddFile(KUKA)
    step("kuka.base_pos", lambda: pos(kuka.Parent()))
    for q in ([0, -90, 90, 0, 0, 0], [20, -70, 100, 30, 40, -50]):
        step("kuka.fk%s" % q, lambda q=q: kuka.SolveFK(q))

elif SUITE == "prog":
    robot, frame, tool = new_station(RDK, "ParityProg")
    J0 = [0, 0, 0, 0, 30, 0]
    robot.setJoints(J0)
    P0 = robot.Pose()
    p = RDK.AddProgram("Names", robot)
    for v in (250, 0.05, 250.25, 600.05, 99.95):
        p.setSpeed(v)
    p.setSpeed(-1, 30, 800, -1)
    for r in (-2, 0, 0.4, 0.5, 2.5, 10.75):
        p.setRounding(r)
    for ms in (500, 999.5, 1000, 1050, 61000):
        p.Pause(ms)
    p.setDO(5, 1)
    p.setDO("Valve", 0)
    p.setAO(3, 2.5)
    p.waitDI(2, 1)
    p.waitDI(4, 0, 1500)
    p.waitDI(6, 1, 999)
    p.RunInstruction("Sub(1,2)", robolink.INSTRUCTION_CALL_PROGRAM)
    p.RunInstruction("hello", robolink.INSTRUCTION_SHOW_MESSAGE)
    p.RunInstruction("a comment", robolink.INSTRUCTION_COMMENT)
    step("instructions", lambda: [list(p.Instruction(i)[:2]) for i in range(p.InstructionCount())])

    def upd(moves, start=J0):
        robot.setJoints(start)
        q = RDK.AddProgram("tp", robot)
        q.setPoseFrame(frame)
        q.setPoseTool(tool)
        for kind, val in moves:
            if kind == "J":
                q.MoveJ(val)
            elif kind == "L":
                q.MoveL(val)
            elif kind == "P":
                q.Pause(val)
        u = q.Update()
        q.Delete()
        return u

    def jt(name, joints):
        return joint_target(RDK, robot, frame, name, joints)

    def ct(name, pose_):
        return cart_target(RDK, robot, frame, name, pose_)

    for d in (1, 10, 45, 90):
        step("update.MoveJ_J1+%d" % d, lambda d=d: upd([("J", jt("j", [d, 0, 0, 0, 30, 0]))]))
    for d in (1, 50, 200):
        step("update.MoveL_%dmm" % d, lambda d=d: upd([("L", ct("c", P0 * tr(0, d, 0)))]))
    step("update.MoveL_rotz90", lambda: upd([("L", ct("r", P0 * rz(math.radians(90))))]))
    step("update.pause", lambda: upd([("L", ct("c2", P0 * tr(0, 100, 0))), ("P", 1234)]))
    step("update.unreachable", lambda: upd([("J", jt("j0", J0)), ("J", ct("far", P0 * tr(0, 0, -2000)))]))
    step("update.wrist_MoveL", lambda: upd([("J", jt("w1", [0, 0, 0, 0, 10, 0])), ("L", jt("w2", [0, 0, 0, 0, -10, 0]))]))
    step("update.wrist_MoveJ", lambda: upd([("J", jt("w3", [0, 0, 0, 0, 10, 0])), ("J", jt("w4", [0, 0, 0, 0, -10, 0]))]))

elif SUITE == "coll":
    robot, frame, tool = new_station(RDK, "ParityColl")
    J0 = [0, 0, 0, 0, 30, 0]
    robot.setJoints(J0)
    c = (frame.PoseAbs() * robot.Pose()).Pos()
    step("collisions.none", lambda: RDK.Collisions())
    hit = box(RDK, "HitBox", [250, 250, 250], [c[0], c[1], c[2]])
    step("collisions.box_at_tcp", lambda: RDK.Collisions())
    step("collision.robot_vs_box", lambda: RDK.Collision(robot, hit))
    robot.setJoints([90, 0, 0, 0, 30, 0])
    step("collisions.after_turn", lambda: RDK.Collisions())
    step("collision.robot_vs_box_after_turn", lambda: RDK.Collision(robot, hit))
    far = box(RDK, "FarBox", [100, 100, 100], [3000, 3000, 0])
    step("collision.far_box", lambda: RDK.Collision(robot, far))

elif SUITE == "run":
    robot, frame, tool = new_station(RDK, "ParityRun")
    J0 = [0, 0, 0, 0, 30, 0]
    robot.setJoints(J0)
    RDK.setSimulationSpeed(50)
    sub = RDK.AddProgram("Sub", robot)
    sub.MoveJ([45, 0, 0, 0, 30, 0])
    main = RDK.AddProgram("Main", robot)
    main.setDO("a", 0)
    main.RunInstruction("Sub", robolink.INSTRUCTION_CALL_PROGRAM)
    main.RunInstruction("Missing", robolink.INSTRUCTION_CALL_PROGRAM)
    main.setDO("a", 1)
    main.RunCode()
    main.WaitFinished()
    step("run.final_joints", lambda: robot.Joints().list(), nd=2)
    step("run.param_a", lambda: RDK.getParam("IO_a") if RDK.getParam("IO_a") is not None else RDK.getParam("a"))
    step("run.busy_after", lambda: [main.Busy(), sub.Busy()])
    sp = RDK.AddProgram("SpeedRun", robot)
    sp.setSpeed(50, -1, 400, -1)
    sp.MoveJ([0, 0, 0, 0, 30, 0])
    sp.RunCode()
    sp.WaitFinished()
    est = RDK.AddProgram("Est", robot)
    est.MoveJ([10, 0, 0, 0, 30, 0])
    robot.setJoints(J0)
    step("run.speed_state_persists_in_update", lambda: est.Update())

sys.stdout = _real_stdout
text = buf.getvalue()
with open(OUT, "w") as fh:
    fh.write(text)
lines = text.count("\n")
print("parity %s: lines=%d sha256=%s" % (SUITE, lines, hashlib.sha256(text.encode()).hexdigest()), flush=True)
RDK.Disconnect()
