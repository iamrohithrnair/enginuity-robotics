# Batch-probes station loading, item deletion and remaining program-update results.












import json
import os
import sys
import threading

PORT = int(sys.argv[1])
OUT = sys.argv[2]
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, os.pardir, "python", "enginuity", "src"))  

from enginuity import robolink  # noqa: E402

RDK_PATH = "/workspace/src/RoboDK/RoboDK.app/Contents/MacOS/RoboDK"
threading.Timer(480, lambda: os._exit(3)).start()  

CASES = json.loads(os.environ.get("WPK2_CASES", "[]"))
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
    for entry in CASES:
        path, programs = entry[0], entry[1]
        deletes = entry[2] if len(entry) > 2 else []
        case = {"file": os.path.basename(path), "update": {}, "deleted": deletes}
        try:
            st = RDK.AddFile(path)  
            calls += 1
            case["opened"] = bool(st.Valid())
            names = RDK.ItemList(list_names=True)  
            calls += 1
            case["items"] = len(names)
            case["names"] = sorted(names)
            for name in deletes:
                RDK.Item(name).Delete()  
                calls += 2
            for name in programs:
                try:
                    p = RDK.Item(name, robolink.ITEM_TYPE_PROGRAM)  
                    case["update"][name] = rnd(list(p.Update()))  
                    calls += 2
                except Exception as exc:
                    case["update"][name] = err(exc)
            RDK.CloseStation()  
            calls += 1
        except Exception as exc:
            case["error"] = err(exc)
        case["calls_so_far"] = calls
        R["cases"].append(case)
        print(json.dumps({k: v for k, v in case.items() if k != "names"}), flush=True)
finally:
    R["calls"] = calls
    with open(OUT, "w") as f:
        json.dump(R, f, indent=1)
    try:
        RDK.CloseRoboDK()
    except Exception:
        pass
    os._exit(0)
