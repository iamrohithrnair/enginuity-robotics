











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
threading.Timer(420, lambda: os._exit(3)).start()  

CASES = json.loads(os.environ.get("WPQ_CASES", "[]"))
R = {"cases": []}


def err(exc):
    msg = str(exc).strip().splitlines()[0] if str(exc).strip() else ""
    return "ERROR %s: %s" % (type(exc).__name__, msg)


def rnd(v):
    if isinstance(v, (list, tuple)):
        return [rnd(x) for x in v]
    return round(v, 4) if isinstance(v, float) else v


RDK = robolink.Robolink(port=PORT, args=["-NEWINSTANCE", "-NOUI", "-SKIPINI", "-EXIT_LAST_COM"], robodk_path=RDK_PATH)
try:
    R["version"] = RDK.Version()  
    for station, programs in CASES:
        case = {"station": station, "update": {}}
        try:
            RDK.AddFile(os.path.join(STATION_DIR, station))  
            for name in programs:
                try:
                    p = RDK.Item(name, robolink.ITEM_TYPE_PROGRAM)  
                    case["update"][name] = rnd(list(p.Update()))  
                except Exception as exc:
                    case["update"][name] = err(exc)
            RDK.CloseStation()  
        except Exception as exc:
            case["error"] = err(exc)
        R["cases"].append(case)
        print(json.dumps(case), flush=True)
finally:
    with open(OUT, "w") as f:
        json.dump(R, f, indent=1)
    os._exit(0)
