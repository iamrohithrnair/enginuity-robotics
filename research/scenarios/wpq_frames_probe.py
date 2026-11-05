# Probes how frame reassignment affects KUKA program updates and joint lists.













import json
import os
import sys
import threading

PORT = int(sys.argv[1])
STATION_DIR = sys.argv[2]
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, os.pardir, "python", "enginuity", "src"))  
OUT = sys.argv[4]

from enginuity import robolink  # noqa: E402

RDK_PATH = "/workspace/src/RoboDK/RoboDK.app/Contents/MacOS/RoboDK"
threading.Timer(300, lambda: os._exit(3)).start()  

R540 = os.path.join(STATION_DIR, "Assembly-and-Material-Handling-with-KUKA-KR-3-R540.rdk")
SCARA = os.path.join(STATION_DIR, "Assembly-and-Material-Handling-with-KUKA-KR5-scara-R550-Z200.rdk")
R = {"r540": {}, "scara": {}}


def err(exc):
    msg = str(exc).strip().splitlines()[0] if str(exc).strip() else ""
    return "ERROR %s: %s" % (type(exc).__name__, msg)


def rnd(v):
    if isinstance(v, (list, tuple)):
        return [rnd(x) for x in v]
    return round(v, 4) if isinstance(v, float) else v


def update(out, name):
    try:
        p = RDK.Item(name, robolink.ITEM_TYPE_PROGRAM)  
        out["update:" + name] = rnd(list(p.Update()))  
        return p
    except Exception as exc:
        out["update:" + name] = err(exc)
        return None


def joint_list(prog):
    msg, mat, status = prog.InstructionListJoints(1000, 1000)  
    cols = [rnd(list(c)) for c in mat.tr().rows] if mat is not None and mat.size(1) else []
    return {"status": status, "msg": msg, "first": cols[0] if cols else None, "n": len(cols)}


RDK = robolink.Robolink(port=PORT, args=["-NEWINSTANCE", "-NOUI", "-SKIPINI", "-EXIT_LAST_COM"], robodk_path=RDK_PATH)
try:
    R["version"] = RDK.Version()  
    out = R["r540"]
    RDK.AddFile(R540)  
    robot = RDK.Item("KUKA KR 3 R540", robolink.ITEM_TYPE_ROBOT)  
    try:
        out["robot_frame"] = robot.getLink(robolink.ITEM_TYPE_FRAME).Name()  
    except Exception as exc:
        out["robot_frame"] = err(exc)
    for name in ("GripperOpen", "TubeAssembly_Part1", "Tube1", "Main"):
        update(out, name)  
    pick = update(out, "Pick_TubeType1")  
    try:
        f1 = RDK.Item("TubeType1-1", robolink.ITEM_TYPE_FRAME)  
        f2 = RDK.Item("TubeType1-2", robolink.ITEM_TYPE_FRAME)  
        robot.setPoseFrame(f1)  
        out["pick_list_frame_TubeType1-1"] = joint_list(pick)  
        robot.setPoseFrame(f2)  
        out["pick_list_frame_TubeType1-2"] = joint_list(pick)  
    except Exception as exc:
        out["pick_lists"] = err(exc)
    print(json.dumps(out), flush=True)

    RDK.CloseStation()  
    out = R["scara"]
    RDK.AddFile(SCARA)  
    try:
        robot = RDK.Item("KUKA KR5 scara R550 Z200", robolink.ITEM_TYPE_ROBOT)  
        out["robot_frame"] = robot.getLink(robolink.ITEM_TYPE_FRAME).Name()  
    except Exception as exc:
        out["robot_frame"] = err(exc)
    for name in ("Pick_TubeType1", "TubeAssembly_Part1", "Tube1"):
        update(out, name)  
    print(json.dumps(out), flush=True)
finally:
    with open(OUT, "w") as f:
        json.dump(R, f, indent=1)
    os._exit(0)
