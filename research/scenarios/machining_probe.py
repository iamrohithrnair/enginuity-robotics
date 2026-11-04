


















import json
import os
import sys
import threading
import traceback

MODE = sys.argv[1]
PORT = int(sys.argv[2])
ROBOT_DIR = sys.argv[3]
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, os.pardir, "python", "enginuity", "src"))  
OUT = sys.argv[5]
SCRATCH = sys.argv[6]

from enginuity import robolink, robomath  # noqa: E402

RDK_PATH = "/workspace/src/RoboDK/RoboDK.app/Contents/MacOS/RoboDK"
threading.Timer(300, lambda: os._exit(3)).start()  

R = {"mode": MODE}


def rows(m):
    if m is None:
        return None
    try:
        return [[round(v, 4) for v in row] for row in m.rows]
    except Exception:
        return str(m)


def step(key, fn):
    try:
        v = fn()
        R[key] = v.decode("utf-8", "replace") if isinstance(v, (bytes, bytearray)) else v
    except Exception as exc:
        msg = str(exc).strip().splitlines()[0] if str(exc).strip() else ""
        R[key] = {"error": "%s: %s" % (type(exc).__name__, msg)}
    print(key, "->", json.dumps(R[key])[:400], flush=True)


def dump_prog(prog, limit=99):
    out = []
    n = prog.InstructionCount()
    for i in range(min(n, limit)):
        name, itype, movetype, isjoint, pose, joints = prog.Instruction(i)
        row = {"i": i, "name": name, "type": itype}
        if itype == 0:
            row["move"] = movetype
            row["isjoint"] = isjoint
            row["pose"] = rows(pose)
        out.append(row)
    return {"count": n, "ins": out}


def box_part(frame):
    pass
    sx, sy, sz = 100.0, 75.0, 25.0
    v = [[-sx, -sy, -sz], [sx, -sy, -sz], [sx, sy, -sz], [-sx, sy, -sz], [-sx, -sy, sz], [sx, -sy, sz], [sx, sy, sz], [-sx, sy, sz]]
    faces = [(0, 2, 1), (0, 3, 2), (4, 5, 6), (4, 6, 7), (0, 1, 5), (0, 5, 4), (1, 2, 6), (1, 6, 5), (2, 3, 7), (2, 7, 6), (3, 0, 4), (3, 4, 7)]
    part = RDK.AddShape([v[k] for f in faces for k in f])
    part.setParent(frame)
    part.setPose(robomath.transl(0, 0, 25))
    return part


def cell(active_frame=True):
    pass
    RDK.AddStation("MachProbe")
    robot = RDK.AddFile(os.path.join(ROBOT_DIR, "UR5e.robot"))
    frame = RDK.AddFrame("Part Frame")
    frame.setPose(robomath.transl(450, 0, 0))
    tool = robot.AddTool(robomath.transl(0, 0, 100), "T1")
    if active_frame:
        robot.setPoseFrame(frame)
    robot.setPoseTool(tool)
    part = box_part(frame)
    return robot, frame, tool, part



TOP_UP = [[x, -30.0, 50.0, 0.0, 0.0, 1.0] for x in (-80.0, 0.0, 80.0)]

RDK = robolink.Robolink(port=PORT, args=["-NEWINSTANCE", "-NOUI", "-SKIPINI", "-EXIT_LAST_COM"], robodk_path=RDK_PATH)
try:
    if MODE == "curves":
        robot, frame, tool, part = cell(active_frame=False)  
        up = [[x, 40.0, 60.0, 0.0, 0.0, 1.0] for x in (-50.0, 50.0)]
        step("addpoints_ref_returns", lambda: part.AddPoints(up, True).Name())  
        step("getpoints_point0", lambda: list(part.GetPoints(robolink.FEATURE_POINT, 0)))  
        step("getpoints_point1", lambda: list(part.GetPoints(robolink.FEATURE_POINT, 1)))  
        pobj = RDK.AddPoints(up, part, False, robolink.PROJECTION_ALONG_NORMAL_RECALC)  
        step("addpoints_newobj_name_parent", lambda: [pobj.Name(), pobj.Parent().Name()])  
        step("addpoints_newobj_points", lambda: list(pobj.GetPoints(robolink.FEATURE_POINT, 0)))  
        probe_pts = [[10.0, 10.0, 60.0, 0.0, 0.0, 1.0], [10.0, 10.0, 60.0, 0.0, 0.0, -1.0], [130.0, 0.0, 0.0, 1.0, 0.0, 0.0], [10.0, 10.0, 60.0, 0.3, 0.0, 0.954]]
        for t in range(6):
            step("project_%d" % t, lambda t=t: rows(part.ProjectPoints(probe_pts, t)))  
        step("project_xyz_default", lambda: rows(part.ProjectPoints([[10.0, 10.0, 60.0], [10.0, 10.0, -60.0]])))  
        step("addcurve_closest", lambda: part.AddCurve([[10.0, 10.0, 70.0, 0, 0, 1], [130.0, 0.0, 0.0, 0, 0, 1]], True, robolink.PROJECTION_CLOSEST).Name())  
        step("curves_after_closest", lambda: [[rows(m), n] for m, n in part.GetCurves()])  
        cobj = RDK.AddCurve(TOP_UP, part, False)  
        step("addcurve_newobj_name_parent_pose", lambda: [cobj.Name(), cobj.Parent().Name(), rows(cobj.Pose())])  
        step("addcurve_newobj2_name", lambda: RDK.AddCurve(TOP_UP, part, False).Name())  
        step("addpoints_free_name_parent", lambda: (lambda o: [o.Name(), o.Parent().Name(), rows(o.Pose())])(RDK.AddPoints(up)))  
        step("addcurve_free_name_parent", lambda: (lambda o: [o.Name(), o.Parent().Name(), [[rows(m), n] for m, n in o.GetCurves()]])(RDK.AddCurve(TOP_UP)))  
    elif MODE == "follow":
        robot, frame, tool, part = cell()  
        cobj = RDK.AddCurve(TOP_UP, part, False)  
        proj = RDK.AddMachiningProject("ProbeCurve settings", robot)  
        for key in ("Machining", "ProgEvents", "OptimAxes", "Approach", "Retract"):
            step("get_" + key, lambda key=key: proj.getParam(key))  
        res = proj.setMachiningParameters(part=cobj)  
        prog = res[0]
        step("status", lambda: res[1])
        step("names", lambda: [prog.Name(), proj.Name()])  
        step("prog", lambda: dump_prog(prog))  
        step("update", lambda: list(prog.Update()))  
        step("get_Machining_after", lambda: proj.getParam("Machining"))  
    elif MODE == "defaults":
        RDK.AddStation("MachProbe")
        robot = RDK.AddFile(os.path.join(ROBOT_DIR, "UR5e.robot"))  
        proj = RDK.AddMachiningProject("ProbeDefaults settings", robot)  
        step("name_type_parent", lambda: [proj.Name(), proj.Type(), proj.Parent().Name()])  
        for key in ("Machining", "ProgEvents", "OptimAxes", "Approach", "Retract", "PathDisplay", "PointApproach", "OperationSpeed",
                    "RangeRotZ", "StepRotZ", "NormalApproach", "JoinCurveTol", "SelectAlgorithm", "ApproachRetractAllCurves", "OffsetRail", "OffsetTurntable"):
            step("get_" + key, lambda key=key: proj.getParam(key))  
        step("proj2", lambda: [RDK.AddMachiningProject().Name(), RDK.AddMachiningProject("", robot).Name()])  
    elif MODE == "points":
        robot, frame, tool, part = cell()  
        pobj = RDK.AddPoints([[-40.0, 0.0, 50.0, 0.0, 0.0, 1.0], [40.0, 0.0, 50.0, 0.0, 0.0, 1.0]], part, False)  
        proj = RDK.AddMachiningProject("ProbePoint settings", robot)  
        res = proj.setMachiningParameters(part=pobj)  
        prog = res[0]
        step("status", lambda: res[1])
        step("names", lambda: [prog.Name(), proj.Name()])  
        step("prog", lambda: dump_prog(prog))  
        step("get_PointApproach", lambda: proj.getParam("PointApproach"))  
    elif MODE == "approach":
        robot, frame, tool, part = cell()  
        cobj = RDK.AddCurve([[-40.0, -30.0, 50.0, 0, 0, 1], [40.0, -30.0, 50.0, 0, 0, 1]], part, False)  
        proj = RDK.AddMachiningProject("ProbeApp settings", robot)  
        step("set_tangent", lambda: proj.setParam("ApproachRetract", "Tangent 30"))  
        res = proj.setMachiningParameters(part=cobj)  
        step("prog_tangent", lambda: dump_prog(res[0]))  
        step("set_side", lambda: [proj.setParam("Approach", "Side 20"), proj.setParam("Retract", "XYZ 10 20 30"), proj.setParam("UpdatePath")])  
        step("prog_side", lambda: dump_prog(res[0], 9))  
        step("get_Approach_Retract", lambda: [proj.getParam("Approach"), proj.getParam("Retract")])  
    elif MODE == "gcode":
        RDK.AddStation("MachProbe")
        robot = RDK.AddFile(os.path.join(ROBOT_DIR, "UR5e.robot"))
        tool = robot.AddTool(robomath.transl(0, 0, 100), "T1")  
        os.makedirs(SCRATCH, exist_ok=True)
        gpath = os.path.join(SCRATCH, "probe-square 1.nc")
        with open(gpath, "w") as fh:
            fh.write("G21 G90\nG0 X0 Y0 Z10\nG1 Z0 F300\nG1 X50 Y0\nG1 X50 Y30\nG0 Z10\n")
        proj = RDK.AddMachiningProject("G settings", robot)  
        res = proj.setMachiningParameters(ncfile=gpath)  
        step("status", lambda: res[1])
        step("names", lambda: [res[0].Name(), proj.Name()])  
        step("prog", lambda: dump_prog(res[0]))  
        step("programs", lambda: [i.Name() for i in RDK.ItemList(robolink.ITEM_TYPE_PROGRAM)])  
    elif MODE == "display":
        keys = ("DisplayCurves", "DisplayPoints", "ShowCurveNormals", "DisplayCurveNormalsOnSelect", "ShowCurvePoints", "SizeCurvePoints",
                "ShowPointNormals", "ShowSelectedPointNormals", "SizeCurveArrow", "SizeRatioCurves", "TolerancePickCurve", "TolerancePickPoint")
        for key in keys:
            step("get_" + key, lambda key=key: RDK.Command(key))  
        for key, value in (("SizeCurvePoints", "7.5"), ("DisplayCurves", "0"), ("TolerancePickCurve", "-1"), ("ShowCurveNormals", "1")):
            step("set_%s_%s" % (key, value), lambda key=key, value=value: RDK.Command(key, value))  
            step("get_%s_after" % key, lambda key=key: RDK.Command(key))  
        step("set_DisplayCurves_bad", lambda: RDK.Command("DisplayCurves", "maybe"))  
        step("get_DisplayCurves_after_bad", lambda: RDK.Command("DisplayCurves"))  
    elif MODE == "types":
        RDK.AddStation("MachProbe")  
        cobj = RDK.AddCurve(TOP_UP)  
        step("curve_object_name_type", lambda: [cobj.Name(), cobj.Type()])  
        pobj = RDK.AddPoints(TOP_UP)  
        step("points_object_name_type", lambda: [pobj.Name(), pobj.Type()])  
        step("curve_items", lambda: [i.Name() for i in RDK.ItemList(robolink.ITEM_TYPE_CURVE)])  
        step("get_SizeNormals", lambda: RDK.Command("SizeNormals"))  
        step("get_DisplayCurves", lambda: RDK.Command("DisplayCurves"))  
    elif MODE == "apt":
        RDK.AddStation("MachProbe")
        robot = RDK.AddFile(os.path.join(ROBOT_DIR, "UR5e.robot"))
        tool = robot.AddTool(robomath.transl(0, 0, 100), "T1")  
        os.makedirs(SCRATCH, exist_ok=True)
        apath = os.path.join(SCRATCH, "probe-apt.apt")
        with open(apath, "w") as fh:
            fh.write("UNITS/MM\nFEDRAT/MMPM,300\nGOTO/0,0,10,0,0,1\nGOTO/50,0,0,0,0,1\nGOTO/50,30,0,0,0,1\n")
        proj = RDK.AddMachiningProject("A settings", robot)  
        res = proj.setMachiningParameters(ncfile=apath)  
        step("status", lambda: res[1])
        step("names", lambda: [res[0].Name(), proj.Name()])  
        step("prog", lambda: dump_prog(res[0]))  
        bpath = os.path.join(SCRATCH, "probe-bad.apt")
        with open(bpath, "w") as fh:
            fh.write("UNITS/FEET\nGOTO/0,0\n")
        proj2 = RDK.AddMachiningProject("B settings", robot)  
        step("bad", lambda: (lambda r: [r[0].Name() if r[0].Valid() else None, r[1]])(proj2.setMachiningParameters(ncfile=bpath)))  
        hpath = os.path.join(SCRATCH, "probe-helix.nc")
        with open(hpath, "w") as fh:
            fh.write("G21 G90\nG0 X0 Y0 Z10\nG1 Z0 F300\nG2 X10 Y0 Z-5 I5 J0\n")
        proj3 = RDK.AddMachiningProject("H settings", robot)  
        step("helix", lambda: (lambda r: [r[0].Name() if r[0].Valid() else None, r[1]])(proj3.setMachiningParameters(ncfile=hpath)))  
except Exception:
    R["fatal"] = traceback.format_exc()
    print(R["fatal"], flush=True)
finally:
    with open(OUT, "w") as fh:
        json.dump(R, fh, indent=1)
    os._exit(0)
