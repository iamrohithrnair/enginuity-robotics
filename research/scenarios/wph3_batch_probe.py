# Batch-probes program updates and simulated execution at configurable speed ratios.
















import json
import os
import sys
import threading
import time

PORT = int(sys.argv[1])
STATION_DIR = sys.argv[2]
OUT = sys.argv[3]
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, os.pardir, "python", "enginuity", "src"))  

from enginuity import robolink  # noqa: E402

RDK_PATH = "/workspace/src/RoboDK/RoboDK.app/Contents/MacOS/RoboDK"
threading.Timer(600, lambda: os._exit(3)).start()  

CASES = json.loads(os.environ.get("WPH3_CASES", "[]"))
SIM = json.loads(os.environ.get("WPH3_SIM", "null"))
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
    if SIM:
        sim = {"station": SIM["station"], "program": SIM["program"], "ratio": SIM["ratio"], "expect": SIM["expect"]}
        try:
            RDK.AddFile(os.path.join(STATION_DIR, SIM["station"]))  
            prog = RDK.Item(SIM["program"], robolink.ITEM_TYPE_PROGRAM)  
            RDK.setSimulationSpeed(SIM["ratio"])  
            t0 = time.time()
            sim["run"] = prog.RunProgram()  
            before = (SIM["expect"] - 0.4) / SIM["ratio"]
            time.sleep(max(0.0, t0 + before - time.time()))
            sim["busy_before"] = prog.Busy()  
            sim["t_before"] = round((time.time() - t0) * SIM["ratio"], 3)
            after = (SIM["expect"] + 0.4) / SIM["ratio"]
            time.sleep(max(0.0, t0 + after - time.time()))
            sim["busy_after"] = prog.Busy()  
            sim["t_after"] = round((time.time() - t0) * SIM["ratio"], 3)
            sim["update_after_run"] = rnd(list(prog.Update()))  
            RDK.CloseStation()  
        except Exception as exc:
            sim["error"] = err(exc)
        R["sim"] = sim
        print(json.dumps(sim), flush=True)
    for station, programs in CASES:
        case = {"station": station, "update": {}}
        try:
            RDK.AddFile(os.path.join(STATION_DIR, station))  
            if len(programs) > 1:
                items = RDK.ItemList(robolink.ITEM_TYPE_PROGRAM)  
                names = RDK.ItemList(robolink.ITEM_TYPE_PROGRAM, True)  
                found = {n: it for n, it in zip(names, items)}
            else:
                found = {programs[0]: RDK.Item(programs[0], robolink.ITEM_TYPE_PROGRAM)}  
            for name in programs:
                try:
                    case["update"][name] = rnd(list(found[name].Update()))  
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
