# Probes attach/detach events, target types and target behavior under frame changes.




import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from programs_probe_common import *  # noqa: E402,F403

SAMPLE = sys.argv[4] if len(sys.argv) > 4 else None
RDK = connect()
RDK.Command("Popups", "0")
RDK.setCollisionActive(robolink.COLLISION_OFF)
robot, frame, tool = new_station(RDK, "PP6")
J0 = [0, 0, 0, 0, 30, 0]
robot.setJoints(J0)
RDK.setSimulationSpeed(20)
c = (frame.PoseAbs() * robot.Pose()).Pos()
step("tcp_abs_xyz", lambda: c, nd=1)


def attach_prog(strategy=0, dist=200):
    p = RDK.AddProgram("Att", robot)
    p.setParam("Add", {"Type": 7})
    p.setParam(0, {"Behavior": 0, "ToolPtr": str(tool.item), "AttachStrategy": strategy, "AttachDistance": dist})
    return p


def run(p):
    p.RunCode()
    wait_done(p, 10)


def parents(objs):
    return [(o.Name(), o.Parent().Name()) for o in objs]



objs = [box(RDK, "Obj50", [10, 10, 10], [c[0], c[1], c[2] - 50]),
        box(RDK, "Obj120", [10, 10, 10], [c[0] + 120, c[1], c[2]]),
        box(RDK, "Obj195", [10, 10, 10], [c[0], c[1] + 195, c[2]]),
        box(RDK, "Obj205", [10, 10, 10], [c[0], c[1] - 205, c[2]])]
att = attach_prog()
step("attach.event_json", lambda: norm_json(att.setParam(0)))
for k in range(1, 5):
    run(att)
    step("attach.after_run_%d" % k, lambda: parents(objs))
step("attach.object_pose_kept_abs(Obj50)", lambda: [round(x, 2) for x in objs[0].PoseAbs().Pos()])
robot.setJoints([30, 0, 0, 0, 30, 0])
step("attach.attached_object_moves_with_tool(Obj50 abs xyz)", lambda: [round(x, 1) for x in objs[0].PoseAbs().Pos()])
robot.setJoints(J0)
det = RDK.AddProgram("Det", robot)
det.setParam("Add", {"Type": 7})
det.setParam(0, {"Behavior": 1, "ToolPtr": str(tool.item), "FramePtr": str(frame.item)})
step("detach.event_json", lambda: norm_json(det.setParam(0)))
run(det)
step("detach.after_run(all to F1)", lambda: parents(objs))
for o in objs:
    o.Delete()
for dist in (100, 300):
    near = box(RDK, "N150", [10, 10, 10], [c[0], c[1] + 150, c[2]])
    far_ = box(RDK, "N250", [10, 10, 10], [c[0], c[1] - 250, c[2]])
    p = attach_prog(0, dist)
    run(p); run(p)
    step("attach.strategy0_AttachDistance=%d(150mm,250mm)" % dist, lambda: parents([near, far_]))
    run(det)
    near.Delete(); far_.Delete(); p.Delete()


robot.setJoints([10, -10, 20, 0, 30, 0])
t = RDK.AddTarget("Target A", frame, robot)
step("target.cart.isJointTarget", lambda: t.isJointTarget())
step("target.cart.joints(=robot joints at creation)", lambda: t.Joints().list(), nd=3)
step("target.cart.pose_equals_robot_TCP_wrt_frame", lambda: max(abs(a - b) for a, b in zip(sum(t.Pose().rows, []), sum(robot.Pose().rows, []))) < 1e-6)
tj = RDK.AddTarget("Target B", frame, robot)
tj.setAsJointTarget()
step("target.joint.isJointTarget", lambda: tj.isJointTarget())
step("target.IsJointTarget_cmd", lambda: [t.setParam("IsJointTarget"), tj.setParam("IsJointTarget")])
frame.setPose(frame.Pose() * robomath.transl(20, 0, 0))
step("frame_moved.cart_target.joints(stored, not yet recalculated)", lambda: t.Joints().list(), nd=3)
step("frame_moved.cart_target.Recalculate", lambda: (t.setParam("Recalculate"), t.Joints().list())[1], nd=3)
step("frame_moved.joint_target.joints(unchanged)", lambda: tj.Joints().list(), nd=3)
step("target.Reachable_cmd", lambda: [t.setParam("Reachable"), tj.setParam("Reachable")])
far_t = RDK.AddTarget("Far", frame, robot)
far_t.setPose(far_t.Pose() * robomath.transl(0, 0, -2000))
step("target.Reachable_far", lambda: far_t.setParam("Reachable"))


RDK.setSelection([])
names_before = [x.Name() for x in RDK.ItemList(robolink.ITEM_TYPE_TARGET)]
robot.setJoints([20, -10, 20, 0, 30, 0])
step("teach.nothing_selected", lambda: (RDK.Command("TriggerAction", "actionTeach_Target"), time.sleep(0.4), [(x.Name(), x.Parent().Name(), x.isJointTarget(), [round(v, 2) for v in x.Joints().list()]) for x in RDK.ItemList(robolink.ITEM_TYPE_TARGET) if x.Name() not in names_before])[2])
step("teach.selection_after", lambda: [(x.Name(), x.Type()) for x in RDK.Selection()])
names_before = [x.Name() for x in RDK.ItemList(robolink.ITEM_TYPE_TARGET)]
robot.setJoints([25, -10, 20, 0, 30, 0])
step("teach.target_selected(creates new, does not modify)", lambda: (RDK.setSelection([t]), RDK.Command("TriggerAction", "actionTeach_Target"), time.sleep(0.4), [x.Name() for x in RDK.ItemList(robolink.ITEM_TYPE_TARGET) if x.Name() not in names_before], [round(v, 2) for v in t.Joints().list()])[3:])
prog = RDK.AddProgram("TeachProg", robot)
names_before = [x.Name() for x in RDK.ItemList(robolink.ITEM_TYPE_TARGET)]
step("teach.program_selected[new targets, program instructions]", lambda: (RDK.setSelection([prog]), RDK.Command("TriggerAction", "actionTeach_Target"), time.sleep(0.4), [x.Name() for x in RDK.ItemList(robolink.ITEM_TYPE_TARGET) if x.Name() not in names_before], prog.InstructionCount())[3:])
RDK.setSelection([])


if SAMPLE:
    close_all(RDK)
    RDK.AddFile(SAMPLE)
    for pr in RDK.ItemList(robolink.ITEM_TYPE_PROGRAM):
        for i in range(pr.InstructionCount()):
            d = pr.setParam(i)
            if d.get("Type") == 7:
                step("sample.%s.ins%d" % (pr.Name(), i), lambda d=d: [d["Name"], d["Behavior"], d["AttachStrategy"], d["AttachDistance"], len([x for x in d["ObjectList"].split(",") if x])])
RDK.Disconnect()
print("done", flush=True)
