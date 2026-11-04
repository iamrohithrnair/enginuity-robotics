











import json
import os
import sys
import threading

PORT = int(sys.argv[1])
STATION_DIR = sys.argv[2]
OUT = sys.argv[3]
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, os.pardir, "python", "enginuity", "src"))  

from enginuity import robolink  # noqa: E402

RDK_PATH = "/workspace/src/RoboDK/RoboDK.app/Contents/MacOS/RoboDK"
threading.Timer(600, lambda: os._exit(3)).start()  

CASES = [
    
    ("Synchronization-and-Welding-with-ABB-02.rdk", ["Path1", "Path2", "Path3"], "ABB IRB 2600ID-8/2.00", "Path2"),
    ("Bending-Palletizing-and-Synchronization-with-Yaskawa-MH24.rdk", ["Bend1 Sheet1", "TurnSheet1"], None, None),
    ("Milling-and-Synchronization-with-KUKA-02.rdk", ["SyncMoveRail"], None, None),
    ("Mixed-Applications-with-Multiple-Robots.rdk", ["Machining"], None, None),
    ("Synchronization-and-Washing-with-Fanuc-M-710iC-45M.rdk", ["L-Transfer", "L-FrontWingUp"], None, None),
    ("Synchronization-and-Welding-with-KUKA-02.rdk", ["Weld2"], None, None),
]
R = {"cases": []}


def err(exc):
    msg = str(exc).strip().splitlines()[0] if str(exc).strip() else ""
    return "ERROR %s: %s" % (type(exc).__name__, msg)


def rnd(v):
    if isinstance(v, (list, tuple)):
        return [rnd(x) for x in v]
    return round(v, 4) if isinstance(v, float) else v


def mat_rows(m):
    pass
    try:
        return [list(r) for r in m.rows]
    except Exception:
        try:
            return [list(r) for r in m]
        except Exception:
            return str(m)


RDK = robolink.Robolink(port=PORT, args=["-NEWINSTANCE", "-NOUI", "-SKIPINI", "-EXIT_LAST_COM"], robodk_path=RDK_PATH)
try:
    R["version"] = RDK.Version()  
    for station, programs, robot_name, list_prog in CASES:
        case = {"station": station, "update": {}}
        try:
            RDK.AddFile(os.path.join(STATION_DIR, station))  
            items = {}
            for name in programs:
                try:
                    p = RDK.Item(name, robolink.ITEM_TYPE_PROGRAM)  
                    items[name] = p
                    case["update"][name] = rnd(list(p.Update()))  
                except Exception as exc:
                    case["update"][name] = err(exc)
            if robot_name:
                try:
                    r = RDK.Item(robot_name, robolink.ITEM_TYPE_ROBOT)  
                    case["joints"] = rnd(list(r.Joints().list()))  
                except Exception as exc:
                    case["joints"] = err(exc)
            if list_prog and list_prog in items:
                try:
                    msg, jl, status = items[list_prog].InstructionListJoints(mm_step=50, deg_step=10)  
                    case["joint_list"] = {"msg": msg, "status": status, "rows": rnd(mat_rows(jl))}
                except Exception as exc:
                    case["joint_list"] = err(exc)
            RDK.CloseStation()  
        except Exception as exc:
            case["error"] = err(exc)
        R["cases"].append(case)
        print(json.dumps(case)[:2000], flush=True)
finally:
    with open(OUT, "w") as f:
        json.dump(R, f, indent=1)
    os._exit(0)
