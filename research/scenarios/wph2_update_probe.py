# Measures program updates across station, program and reference-frame combinations.













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
threading.Timer(480, lambda: os._exit(3)).start()  

CASES = json.loads(os.environ.get("WPH2_CASES", "[]"))
R = {"cases": []}


def err(exc):
    msg = str(exc).strip().splitlines()[0] if str(exc).strip() else ""
    return "ERROR %s: %s" % (type(exc).__name__, msg)


def rnd(v):
    if isinstance(v, (list, tuple)):
        return [rnd(x) for x in v]
    return round(v, 4) if isinstance(v, float) else v


RDK = robolink.Robolink(port=PORT, args=["-NEWINSTANCE", "-NOUI", "-SKIPINI", "-EXIT_LAST_COM"], robodk_path=RDK_PATH)
calls = 1
try:
    R["version"] = RDK.Version()  
    for station, programs in CASES:
        case = {"station": station, "update": {}}
        robots = {}
        try:
            RDK.AddFile(os.path.join(STATION_DIR, station))  
            calls += 1
            for entry in programs:
                name = entry["program"]
                key = name
                try:
                    if entry.get("frame"):
                        rname, fname = entry["frame"]
                        key = "%s @ %s" % (name, fname)
                        if rname not in robots:
                            robots[rname] = RDK.Item(rname, robolink.ITEM_TYPE_ROBOT)  
                            calls += 1
                        fr = RDK.Item(fname, robolink.ITEM_TYPE_FRAME)  
                        robots[rname].setPoseFrame(fr)  
                        calls += 2
                    p = RDK.Item(name, robolink.ITEM_TYPE_PROGRAM)  
                    case["update"][key] = rnd(list(p.Update()))  
                    calls += 2
                except Exception as exc:
                    case["update"][key] = err(exc)
            RDK.CloseStation()  
            calls += 1
        except Exception as exc:
            case["error"] = err(exc)
        case["calls_so_far"] = calls
        R["cases"].append(case)
        print(json.dumps(case), flush=True)
finally:
    with open(OUT, "w") as f:
        json.dump(R, f, indent=1)
    os._exit(0)
