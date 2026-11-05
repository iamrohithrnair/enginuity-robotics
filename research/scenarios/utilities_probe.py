# Probes tool/frame calibration, mechanism building, camera output and connection helpers.








import json
import math
import os
import random
import struct
import sys
import time
import traceback

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, os.pardir, "python", "enginuity", "src"))  
from enginuity import robolink, robomath  # noqa: E402
from enginuity.robomath import Mat, rotx, roty, rotz, transl  # noqa: E402

PORT = int(sys.argv[1])
OUT = sys.argv[2]
WORK = sys.argv[3]
SECTIONS = set((sys.argv[4] if len(sys.argv) > 4 else "tcp,frame,mech,cam,conn,tt2").split(","))
os.makedirs(WORK, exist_ok=True)

ROBOT_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "data", "library", "files", "library-robots", "ABB-IRB-120-3-0-6.robot")

RDK = robolink.Robolink(port=PORT, args=[], quit_on_close=False)
res = {"build": None}


def reconnect():
    pass
    global RDK
    try:
        RDK.Disconnect()
    except Exception:  # noqa: BLE001
        pass
    RDK = robolink.Robolink(port=PORT, args=[], quit_on_close=False)


def rec(key, fn):
    try:
        res[key] = fn()
    except Exception as e:  # noqa: BLE001
        res[key] = {"error": str(e), "trace": traceback.format_exc().splitlines()[-1]}
        reconnect()
    with open(OUT, "w") as fh:
        json.dump(res, fh, indent=1, default=str)


def rec_partial(key, value):
    pass
    res[key] = dict(value)
    with open(OUT, "w") as fh:
        json.dump(res, fh, indent=1, default=str)


def ml(m):
    pass
    return [round(m[i, j], 9) for i in range(4) for j in range(4)]


def R(a, b, c):
    pass
    return rotz(math.radians(c)) * roty(math.radians(b)) * rotx(math.radians(a))


def T(x, y, z, a, b, c):
    return transl(x, y, z) * R(a, b, c)


def mat_list(m):
    if isinstance(m, Mat):
        return [[m[i, j] for j in range(m.size(1))] for i in range(m.size(0))]
    return m


def png_pixels(b):
    pass
    import zlib
    if not isinstance(b, (bytes, bytearray)) or b[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    pos, idat, w = 8, b"", None
    while pos < len(b):
        n = struct.unpack(">I", b[pos:pos + 4])[0]
        t = b[pos + 4:pos + 8]
        d = b[pos + 8:pos + 8 + n]
        if t == b"IHDR":
            w, h, depth, ctype = struct.unpack(">IIBB", d[:10])
        elif t == b"IDAT":
            idat += d
        pos += 12 + n
    ch = {0: 1, 2: 3, 4: 2, 6: 4}[ctype]
    bpp = ch * depth // 8
    raw = zlib.decompress(idat)
    stride = w * bpp
    rows, prev, i = [], bytearray(stride), 0
    for _ in range(h):
        f = raw[i]
        line = bytearray(raw[i + 1:i + 1 + stride])
        i += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            up = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + up) & 255
            elif f == 3:
                line[x] = (line[x] + (a + up) // 2) & 255
            elif f == 4:
                pa, pb, pc = abs(up - c), abs(a - c), abs(a + up - 2 * c)
                pr = a if pa <= pb and pa <= pc else (up if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        rows.append(bytes(line))
        prev = line
    return w, h, ch, depth, rows


def png_summary(b):
    pass
    dec = png_pixels(b)
    if not dec:
        return {"type": str(type(b)), "len": len(b) if isinstance(b, (bytes, bytearray)) else None, "head": list(b[:16]) if isinstance(b, (bytes, bytearray)) else None}
    w, h, ch, depth, rows = dec
    bpp = ch * depth // 8

    def px(x, y):
        r = rows[y][x * bpp:(x + 1) * bpp]
        if depth == 16:
            return [struct.unpack(">H", r[k:k + 2])[0] for k in range(0, len(r), 2)]
        return list(r)
    bg = px(0, 0)
    xs, ys, n = [], [], 0
    for y in range(h):
        for x in range(w):
            if px(x, y) != bg:
                n += 1
                xs.append(x)
                ys.append(y)
    return {"w": w, "h": h, "channels": ch, "depth": depth, "len": len(b), "bg": bg, "center": px(w // 2, h // 2),
            "n": n, "bbox": [min(xs), min(ys), max(xs), max(ys)] if xs else None,
            "samples": {"%d,%d" % (x, y): px(x, y) for (x, y) in [(w // 2, h // 2), (w // 4, h // 2), (w // 2, h // 4), (3 * w // 4, h // 2), (w // 2, 3 * h // 4)]}}


def fresh(name):
    reconnect()
    for st in RDK.ItemList(robolink.ITEM_TYPE_STATION):
        st.Delete()
    RDK.AddStation(name)



TCP = [12.0, -25.0, 140.0]
S = [600.0, 50.0, 400.0]
ORIS = [(0, 0, 0), (20, 0, 0), (0, 25, 0), (0, 0, 30), (15, 15, 0), (-20, 10, 25), (10, -30, 40), (-25, -15, -35)]


def flange_for(a, b, c, tcp=TCP, s=S):
    Rm = R(a, b, c)
    rt = Rm * transl(*tcp)
    return transl(s[0] - rt[0, 3], s[1] - rt[1, 3], s[2] - rt[2, 3]) * Rm


def calib(rows, fmt, algo, robot=None, tool=None):
    tcp, stats, errors = RDK.CalibrateTool(rows, fmt, algo, robot, tool)
    return {"tcp": tcp, "stats": stats, "errors": errors}


def staubli(m):
    return robomath.Pose_2_Staubli(m)


def fmt_rows(poses, fmt):
    out = []
    for m in poses:
        if fmt == 0:
            out.append(robomath.Pose_2_Staubli(m))
        elif fmt == 1:
            out.append(robomath.Pose_2_KUKA(m))  
        elif fmt == 2:
            out.append(robomath.Pose_2_Adept(m))
        elif fmt == 3:
            out.append(robomath.Pose_2_Catia(m))
        elif fmt == 4:
            out.append(robomath.Pose_2_Fanuc(m))
        elif fmt == 5:
            v = robomath.Pose_2_Staubli(m.tr())  
            
            k = robomath.Pose_2_KUKA(m.tr())
            out.append([m[0, 3], m[1, 3], m[2, 3], -k[3], -k[4], -k[5]])
        elif fmt == 6:
            out.append(robomath.Pose_2_ABB(m))
    return out


if "tcp" in SECTIONS:
    fresh("ProbeTCP")
    poses = [flange_for(*o) for o in ORIS]
    res["tcp.inputs.staubli"] = [staubli(m) for m in poses]
    rec("tcp.exact.point.mats", lambda: calib(poses, robolink.EULER_RX_RYp_RZpp, robolink.CALIBRATE_TCP_BY_POINT))
    for f in range(7):
        rec("tcp.format%d" % f, lambda f=f: calib(fmt_rows(poses, f), f, robolink.CALIBRATE_TCP_BY_POINT))
    random.seed(7)
    noisy = []
    for (a, b, c) in ORIS:
        m = flange_for(a + random.uniform(-0.3, 0.3), b + random.uniform(-0.3, 0.3), c + random.uniform(-0.3, 0.3))
        m = transl(random.uniform(-0.5, 0.5), random.uniform(-0.5, 0.5), random.uniform(-0.5, 0.5)) * m
        noisy.append(m)
    res["tcp.noisy.inputs"] = [staubli(m) for m in noisy]
    rec("tcp.noisy.point", lambda: calib(fmt_rows(noisy, 0), 0, robolink.CALIBRATE_TCP_BY_POINT))
    close = poses + [flange_for(2, 0, 0)]
    res["tcp.close.inputs"] = [staubli(m) for m in close]
    rec("tcp.close.point", lambda: calib(fmt_rows(close, 0), 0, robolink.CALIBRATE_TCP_BY_POINT))
    rec("tcp.minangle10", lambda: calib(fmt_rows(poses, 0), 0, [robolink.CALIBRATE_TCP_BY_POINT, 22]))
    rec("tcp.n3", lambda: calib(fmt_rows(poses[:3], 0), 0, robolink.CALIBRATE_TCP_BY_POINT))
    rec("tcp.n2", lambda: calib(fmt_rows(poses[:2], 0), 0, robolink.CALIBRATE_TCP_BY_POINT))
    rec("tcp.allclose", lambda: calib(fmt_rows([flange_for(0, 0, 0), flange_for(1, 0, 0), flange_for(0, 1, 0), flange_for(0, 0, 1)], 0), 0, robolink.CALIBRATE_TCP_BY_POINT))
    
    plane = []
    random.seed(11)
    for k, (a, b, c) in enumerate(ORIS):
        Rm = R(a, b, c)
        rt = Rm * transl(*TCP)
        q = [100 + 40 * k, -60 + 15 * k, 100.0]
        plane.append(transl(q[0] - rt[0, 3], q[1] - rt[1, 3], q[2] - rt[2, 3]) * Rm)
    res["tcp.plane.inputs"] = [staubli(m) for m in plane]
    rec("tcp.plane", lambda: calib(fmt_rows(plane, 0), 0, robolink.CALIBRATE_TCP_BY_PLANE))
    scara = []
    for k, c in enumerate([0, 30, 60, 90, 120, 150]):
        Rm = R(0, 0, c)
        rt = Rm * transl(*TCP)
        q = [200 + 30 * k, 50 - 20 * k, 100.0]
        scara.append(transl(q[0] - rt[0, 3], q[1] - rt[1, 3], q[2] - rt[2, 3]) * Rm)
    res["tcp.scara.inputs"] = [staubli(m) for m in scara]
    rec("tcp.plane_scara", lambda: calib(fmt_rows(scara, 0), 0, robolink.CALIBRATE_TCP_BY_PLANE_SCARA))
    
    robot = RDK.AddFile(ROBOT_FILE)
    robot.setPoseTool(robomath.eye(4))
    base_s = [350.0, 0.0, 300.0]
    joints = []
    for (a, b, c) in ORIS[:6]:
        Rm = rotx(math.pi) * R(a * 0.8, b * 0.8, c)
        rt = Rm * transl(*TCP)
        m = transl(base_s[0] - rt[0, 3], base_s[1] - rt[1, 3], base_s[2] - rt[2, 3]) * Rm
        q = robot.SolveIK(m)
        joints.append(q.list())
    res["tcp.joints.inputs"] = joints
    rec("tcp.joints", lambda: calib(joints, robolink.JOINT_FORMAT, robolink.CALIBRATE_TCP_BY_POINT, robot))
    tool = robot.AddTool(transl(1, 2, 3), "ProbeTool")
    rec("tcp.with_tool", lambda: calib(fmt_rows(poses, 0), 0, robolink.CALIBRATE_TCP_BY_POINT, robot, tool))
    rec("tcp.with_tool.after", lambda: ml(RDK.Item("ProbeTool").PoseTool()))
    rec("tcp.with_tool.joints", lambda: calib(joints, robolink.JOINT_FORMAT, robolink.CALIBRATE_TCP_BY_POINT, RDK.Item("", robolink.ITEM_TYPE_ROBOT), RDK.Item("ProbeTool")))
    rec("tcp.with_tool.joints.after", lambda: ml(RDK.Item("ProbeTool").PoseTool()))
    rec("tcp.joints.outside", lambda: calib(joints + [[0, 0, 0, 0, 999, 0]], robolink.JOINT_FORMAT, robolink.CALIBRATE_TCP_BY_POINT, RDK.Item("", robolink.ITEM_TYPE_ROBOT)))
    rec("tcp.joints.norobot", lambda: calib(joints, robolink.JOINT_FORMAT, robolink.CALIBRATE_TCP_BY_POINT))
    rec("tcp.method2", lambda: calib(fmt_rows(poses, 0), 0, 2))
    rec("tcp.method9", lambda: calib(fmt_rows(poses, 0), 0, 9))

if "frame" in SECTIONS:
    fresh("ProbeFrame")
    F = T(300, -150, 50, 5, -3, 30)

    def P(x, y, z):
        v = F * transl(x, y, z)
        return [v[0, 3], v[1, 3], v[2, 3]]

    def cf(points, method, use_joints=False, robot=None):
        out = RDK.CalibrateReference(points, method, use_joints, robot)
        if isinstance(out, tuple):
            return {"pose": ml(out[0]), "stats": out[1]}
        return {"pose": ml(out)}

    res["frame.truth"] = ml(F)
    sets = {
        "m1": ([P(0, 0, 0), P(100, 0, 0), P(30, 80, 0)], 1),
        "m0": ([P(20, 0, 0), P(120, 0, 0), P(0, 90, 0)], 0),
        "m0_offaxis": ([P(20, 0, 0), P(120, 0, 0), P(15, 90, 0)], 0),
        "m0_extra": ([P(20, 0, 0), P(120, 0, 0), P(0, 90, 0), P(50, 50, 0)], 0),
        "m2": ([P(10, 10, 0), P(90, 20, 0), P(30, 80, 0), P(20, 0, -10), P(100, 0, -10), P(0, 50, -10)], 2),
        "m2_five": ([P(10, 10, 0), P(90, 20, 0), P(30, 80, 0), P(20, 0, -10), P(100, 0, -10)], 2),
        "collinear": ([P(0, 0, 0), P(100, 0, 0), P(200, 0, 0)], 1),
        "close": ([P(0, 0, 0), P(0.5, 0, 0), P(30, 80, 0)], 1),
        "two": ([P(0, 0, 0), P(100, 0, 0)], 1),
    }
    for k, (pts, m) in sets.items():
        res["frame.%s.inputs" % k] = pts
        rec("frame.%s" % k, lambda pts=pts, m=m: cf(pts, m))
    random.seed(5)
    tt = []
    for ang in [0, 40, 80, 120, 160, 200, 240]:
        v = F * rotz(math.radians(ang)) * transl(200, 0, 30)
        tt.append([v[0, 3] + random.uniform(-0.2, 0.2), v[1, 3] + random.uniform(-0.2, 0.2), v[2, 3] + random.uniform(-0.2, 0.2)])
    res["frame.turntable.inputs"] = tt
    rec("frame.turntable", lambda: cf(tt, 3))
    tt2 = tt + [[p[0], p[1], p[2] + 100] for p in tt[:5]]
    res["frame.turntable2.inputs"] = tt2
    rec("frame.turntable2", lambda: cf(tt2, 4))
    robot = RDK.AddFile(ROBOT_FILE)
    js = [robot.SolveIK(transl(*p) * rotx(math.pi)).list() for p in [P(0, 0, 0), P(100, 0, 0), P(30, 80, 0)]]
    res["frame.joints.inputs"] = js
    rec("frame.joints", lambda: cf(js, 1, True, robot))
    rec("frame.joints.norobot", lambda: cf(js, 1, True, None))

if "mech" in SECTIONS:
    fresh("ProbeMech")
    PARAMS = {
        1: [], 2: [90, 100], 3: [], 4: [], 5: [10, 20, 30, 40], 6: [10, 20, 30, 40, 50, 60],
        7: [330, 50, 0, 330, 35, 335, 80, 0, -90, 0, 0, 0, 0],
        8: [340, 400, 400, 126, 0, 0, 0, 0, 0, 0, 0],
        9: [250, 200, 50], 10: [0.5],
        11: [162.5, 425, 392.2, 133.3, 99.7, 99.6, 0, 0, 0, 0, 0, 0],
        12: [100, 10, 20], 13: [100, 200, 300, 10, 20, 30, 40, 0], 14: [250, 200, 300],
        15: [100, 200, 300, 10, 20], 16: [], 17: [250, 200, 300],
        18: [330, 50, 0, 330, 35, 335, 80, 0, -90, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4],
        19: [100, 200, 300, 10, 20, 30, 5, 6, 7, 8, 9, 10],
        20: [10, 20, 30, 40, 50, 60, 70, 0, 1, 0],
        21: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 0, 0, 1, 0],
        22: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 0, 0, 0, 1, 0, 0],
        23: [300, -90, 50, 0, 10, 0, 300, 0, 0, -90, 30, 0, 300, 90, 0, 0, 0, -90, 0, 0, 80],
        24: [340, -90, 0, 0, 0, 90, 0, 0, 400, -90, 0, 0, 0, 90, 0, 0, 400, -90, 0, 0, 0, 90, 0, 0, 126],
        25: [300, -90, 50, 0, 10, 0, 300, 0, 0, -90, 30, 0, 300, 90, 0, 0, 0, -90, 0, 0, 80],
    }
    NDOF = {1: 1, 2: 2, 3: 3, 4: 1, 5: 2, 6: 3, 7: 6, 8: 7, 9: 4, 10: 1, 11: 6, 12: 2, 13: 5, 14: 4, 15: 4, 16: 6, 17: 4, 18: 6, 19: 6, 20: 3, 21: 4, 22: 5, 23: 6, 24: 7, 25: 6}
    tri = [[0, 0, 0], [40, 0, 0], [0, 40, 0]]
    only = [int(x) for x in os.environ.get('MECH_TYPES', '').split(',') if x]
    for t, params in PARAMS.items():
        if only and t not in only:
            continue
        res['mech.trying'] = t
        with open(OUT, 'w') as fh:
            json.dump(res, fh, indent=1, default=str)
        n = NDOF[t]
        objs = []
        for i in range(n + 1):
            o = RDK.AddShape(tri)
            o.setName("Mech%d_%d" % (t, i))
            o.setPose(T(1000 * t, 100 * i, 50 * i, 0, 0, 10 * i))
            objs.append(o)
        senses = [1] * n
        if t == 7:
            senses = [1, 1, -1, -1, -1, -1, -1]
        if t == 2:
            senses = [1, -1]
        build = [0] * n
        if t in (1, 2, 7):
            build = [10 * (k + 1) for k in range(n)]
        home = [5 * (k + 1) for k in range(n)]
        low = [-170 - k for k in range(n)]
        high = [170 + k for k in range(n)]
        key = "mech.%d" % t
        try:
            robot = RDK.BuildMechanism(t, objs, list(params), list(build), list(home), list(senses), low, high, robomath.eye(4), robomath.eye(4), "Built%d" % t)
            if not robot.Valid():
                res[key] = {"invalid": True}
                continue
            q = [((k * 37) % 50) - 20.0 + 3 * k for k in range(n)]
            out = {
                "name": robot.Name(),
                "parent": robot.Parent().Name(),
                "parent_pose": ml(robot.Parent().Pose()),
                "joints": robot.Joints().list(),
                "home": robot.JointsHome().list(),
                "limits": [l.list() for l in robot.JointLimits()[:2]],
                "fk_q": q,
                "fk": ml(robot.SolveFK(q)),
                "fk_build": ml(robot.SolveFK(build)),
                "jointposes": [ml(m) for m in robot.JointPoses(q)],
                "objects_valid": [o.Valid() for o in objs],
                "children": [c.Name() for c in robot.Childs()],
            }
            path = os.path.join(WORK, "mech-%d.robot" % t)
            robot.Save(path)
            out["saved"] = os.path.exists(path)
            res[key] = out
        except Exception as e:  # noqa: BLE001
            res[key] = {"error": str(e)}
            reconnect()
        with open(OUT, "w") as fh:
            json.dump(res, fh, indent=1, default=str)

if "mech2" in SECTIONS:
    
    
    fresh("ProbeMech2")
    PARAMS2 = {
        13: [100, 200, 300, 10, 20, 30, 40, 0], 14: [250, 200, 300], 15: [100, 200, 300, 10, 20], 16: [], 17: [250, 200, 300],
        19: [100, 200, 300, 10, 20, 30, 5, 6, 7, 8, 9, 10], 20: [10, 20, 30, 40, 50, 60, 70, 0, 1, 0],
        21: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 0, 0, 1, 0], 22: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 0, 0, 0, 1, 0, 0],
        23: [300, -90, 50, 0, 10, 0, 300, 0, 0, -90, 30, 0, 300, 90, 0, 0, 0, -90, 0, 0, 80], 24: [340, -90, 0, 0, 0, 90, 0, 0, 400, -90, 0, 0, 0, 90, 0, 0, 400, -90, 0, 0, 0, 90, 0, 0, 126],
        25: [300, -90, 50, 0, 10, 0, 300, 0, 0, -90, 30, 0, 300, 90, 0, 0, 0, -90, 0, 0, 80],
        10: [0.5], 12: [100, 10, 20],
    }
    
    
    NDOF2 = {13: 5, 14: 4, 15: 4, 16: 6, 17: 4, 19: 6, 20: 3, 21: 4, 22: 5, 23: 6, 24: 7, 25: 6, 10: 2, 12: 2}
    only = [int(x) for x in os.environ.get("MECH_TYPES", "").split(",") if x]
    shape = RDK.AddShape([[0, 0, 0], [40, 0, 0], [0, 40, 0]])
    shape.setPose(T(500, 100, 50, 0, 0, 10))
    for t, params in PARAMS2.items():
        if only and t not in only:
            continue
        n = NDOF2[t]
        q = [((k * 37) % 50) - 20.0 + 3 * k for k in range(n)]

        def build(t=t, params=params, n=n, q=q):
            robot = RDK.BuildMechanism(t, [shape] * (n + 1), list(params), [0] * n, [5 * (k + 1) for k in range(n)], [1] * n, [-170 - k for k in range(n)], [170 + k for k in range(n)], robomath.eye(4), robomath.eye(4), "Built%d" % t)
            out = {"parent_pose": ml(robot.Parent().Pose()), "fk_q": q, "fk": ml(robot.SolveFK(q)), "limits": [l.list() for l in robot.JointLimits()[:2]]}
            path = os.path.join(WORK, "mech-%d.robot" % t)
            robot.Save(path)
            out["saved"] = os.path.exists(path)
            return out
        rec("mech.%d" % t, build)

if "cam" in SECTIONS:
    fresh("ProbeCam")
    res["cam.as_item"] = getattr(RDK, "CAMERA_AS_ITEM", None)
    frame = RDK.AddFrame("CamFrame")
    
    frame.setPose(T(0, 0, 1000, 180, 0, 0))
    
    sq = RDK.AddShape([[0, -100, 0], [200, -100, 0], [200, 100, 0], [0, -100, 0], [200, 100, 0], [0, 100, 0]])
    sq.setName("Square")
    sq.setColor([1, 0, 0, 1])

    def camtest():
        
        cam = RDK.Cam2D_Add(frame, "")
        out = {"name": cam.Name(), "type": cam.Type(), "parent": cam.Parent().Name(), "pose_abs": ml(cam.PoseAbs())}
        rec_partial("cam", out)
        out["snap"] = png_summary(RDK.Cam2D_Snapshot("", cam))
        out["snap_gray"] = png_summary(RDK.Cam2D_Snapshot("", cam, "Grayscale"))
        out["snap_depth"] = png_summary(RDK.Cam2D_Snapshot("", cam, "Depth"))
        rec_partial("cam", out)
        for k in ("Settings", "IsOpen", "Params"):
            try:
                out["param_" + k] = cam.setParam(k)
            except Exception as e:  # noqa: BLE001
                out["param_" + k] = "error: %s" % e
        out["setparams"] = RDK.Cam2D_SetParams("SIZE=320x240 FOV=40 FAR_LENGTH=3000 BG_COLOR=black", cam)
        out["snap_after"] = png_summary(RDK.Cam2D_Snapshot("", cam))
        out["snap_after_depth"] = png_summary(RDK.Cam2D_Snapshot("", cam, "Depth"))
        rec_partial("cam", out)
        cam2 = RDK.Cam2D_Add(frame, "SIZE=100x80 Closed")
        out["cam2"] = {"name": cam2.Name(), "snap": png_summary(RDK.Cam2D_Snapshot("", cam2))}
        RDK.setSelection([])
        cam3 = RDK.Cam2D_Add(None, "")
        out["cam3"] = {"valid": cam3.Valid(), "name": cam3.Name() if cam3.Valid() else None}
        rec_partial("cam", out)
        file = os.path.join(WORK, "snap.png")
        out["snap_file"] = RDK.Cam2D_Snapshot(file, cam)
        out["snap_file_exists"] = os.path.exists(file)
        out["close"] = RDK.Cam2D_Close(cam)
        out["close_all"] = RDK.Cam2D_Close()
        return out

    rec("cam", camtest)

if "conn" in SECTIONS:
    fresh("ProbeConn")
    robot = RDK.AddFile(ROBOT_FILE)

    def conntest():
        out = {"params0": list(robot.ConnectionParams()), "state0": list(robot.ConnectedState())}
        robot.setConnectionParams("127.0.0.1", 1, "/", "anonymous", "")
        out["params1"] = list(robot.ConnectionParams())
        out["state1"] = list(robot.ConnectedState())
        t0 = time.time()
        RDK.COM.settimeout(90)
        out["connect"] = robot.Connect("127.0.0.1", True)
        out["connect_s"] = round(time.time() - t0, 2)
        out["state2"] = list(robot.ConnectedState())
        time.sleep(3)
        out["state3"] = list(robot.ConnectedState())
        out["disconnect"] = robot.Disconnect()
        out["state4"] = list(robot.ConnectedState())
        return out

    rec("conn", conntest)
    rec("conn.frame", lambda: list(RDK.AddFrame("F").ConnectedState()))

if "tt2" in SECTIONS:
    fresh("ProbeTT2")
    random.seed(7)
    
    A1 = T(300, -150, 400, 0, 90, 0)
    A2 = T(300, -150, 500, 0, 0, 0)
    pts = []
    for ang in [0, 30, 60, 90, 120, 150]:
        v = A1 * rotz(math.radians(ang)) * transl(150, 0, 40)
        pts.append([v[0, 3] + random.uniform(-0.05, 0.05), v[1, 3] + random.uniform(-0.05, 0.05), v[2, 3] + random.uniform(-0.05, 0.05)])
    for ang in [0, 50, 100, 150, 200]:
        v = A2 * rotz(math.radians(ang)) * transl(180, 0, 60)
        pts.append([v[0, 3] + random.uniform(-0.05, 0.05), v[1, 3] + random.uniform(-0.05, 0.05), v[2, 3] + random.uniform(-0.05, 0.05)])
    res["tt2.perp.inputs"] = pts

    def tt2():
        out = RDK.CalibrateReference(pts, 4, False, None)
        if isinstance(out, tuple):
            return {"pose": ml(out[0]), "stats": out[1]}
        return {"pose": ml(out)}
    rec("tt2.perp", tt2)

with open(OUT, "w") as fh:
    json.dump(res, fh, indent=1, default=str)
print("written", OUT, len(res), flush=True)

os._exit(0)
