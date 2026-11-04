






import json
import math
import os
import re
import sys
import time

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 20523

ROBOT_DIR = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "library", "files", "library-robots")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, os.pardir, "python", "enginuity", "src"))  

from enginuity import robolink, robomath  # noqa: E402

ABB = os.path.join(ROBOT_DIR, "ABB-IRB-120-3-0-6.robot")
UR5E = os.path.join(ROBOT_DIR, "UR5e.robot")
KUKA = os.path.join(ROBOT_DIR, "KUKA-KR-6-R900-sixx.robot")


def fmt(v, nd=4):
    if isinstance(v, robomath.Mat):
        return fmt(v.rows, nd)
    if isinstance(v, float):
        r = round(v, nd)
        return "0.0" if r == 0 else repr(r)
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join(fmt(x, nd) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ", ".join("%s: %s" % (k, fmt(v[k], nd)) for k in sorted(v)) + "}"
    return repr(v)


def step(label, fn, nd=4):
    try:
        print(f"{label}: {fmt(fn(), nd)}", flush=True)
    except Exception as exc:  
        msg = str(exc).strip().splitlines()[0] if str(exc).strip() else type(exc).__name__
        print(f"{label}: ERROR {type(exc).__name__}: {msg}", flush=True)


PTR_KEYS = ("FramePtr", "ToolPtr", "TargetPtr", "ObjectList", "ParentList")


def norm_json(d):
    pass
    if not isinstance(d, dict):
        return d
    out = {}
    for k, v in d.items():
        if k in PTR_KEYS and isinstance(v, str):
            out[k] = "0" if v in ("", "0") else re.sub(r"\d+", "<ptr>", v)
        else:
            out[k] = v
    return out


def connect():
    RDK = robolink.Robolink(port=PORT, args=[], quit_on_close=False)
    RDK.setRunMode(robolink.RUNMODE_SIMULATE)
    return RDK


def close_all(RDK):
    for _ in range(60):
        if len(RDK.ItemList(robolink.ITEM_TYPE_STATION)) <= 1:
            break
        RDK.CloseStation()


def new_station(RDK, name, robot_file=ABB, tool_z=100.0):
    pass
    close_all(RDK)
    RDK.AddStation(name)
    robot = RDK.AddFile(robot_file)
    frame = RDK.AddFrame("F1")
    tool = robot.AddTool(robomath.transl(0, 0, tool_z), "T1")
    robot.setPoseFrame(frame)
    robot.setPoseTool(tool)
    return robot, frame, tool


def joint_target(RDK, robot, frame, name, joints):
    t = RDK.AddTarget(name, frame, robot)
    keep = robot.Joints()
    robot.setJoints(joints)
    t.setPose(robot.Pose())
    t.setJoints(joints)
    t.setAsJointTarget()
    robot.setJoints(keep)
    return t


def cart_target(RDK, robot, frame, name, pose):
    t = RDK.AddTarget(name, frame, robot)
    t.setPose(pose)
    return t


def box(RDK, name, size, pos_abs):
    pass
    sx, sy, sz = [s / 2.0 for s in size]
    v = [[-sx, -sy, -sz], [sx, -sy, -sz], [sx, sy, -sz], [-sx, sy, -sz],
         [-sx, -sy, sz], [sx, -sy, sz], [sx, sy, sz], [-sx, sy, sz]]
    faces = [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 1, 5), (0, 5, 4),
             (1, 2, 6), (1, 6, 5), (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7)]
    pts = [v[k] for f in faces for k in f]
    o = RDK.AddShape(pts)
    o.setName(name)
    o.setPoseAbs(robomath.transl(*pos_abs))
    return o


def trap(d, v, a):
    pass
    d = abs(d)
    if d <= 0:
        return 0.0
    if d >= v * v / a:
        return d / v + v / a
    return 2.0 * math.sqrt(d / a)


def wait_done(prog, maxwait=60.0, poll=0.02):
    t0 = time.time()
    while prog.Busy() and time.time() - t0 < maxwait:
        time.sleep(poll)
    return prog.Busy()
