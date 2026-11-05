# Sweeps robot joint values to probe limit enforcement and kinematic class behavior.
















import json
import os
import sys
import threading

SET = sys.argv[1]
PORT = int(sys.argv[2])
ROBOT_DIR = sys.argv[3]
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, os.pardir, "python", "enginuity", "src"))  
OUT = sys.argv[5]

from enginuity import robolink  # noqa: E402

RDK_PATH = "/workspace/src/RoboDK/RoboDK.app/Contents/MacOS/RoboDK"
threading.Timer(300, lambda: os._exit(3)).start()  


PROBES = {"senses": [
    
    ("Gudel-FP-6-300.robot", [[0, 1000, 0]]),
    
    ("Yaskawa-Motoman-MH12.robot", [[0, 0, 220, 0, 0, 0], [0, 0, -200, 0, 0, 0]]),
    
    ("Denso-HS045A1.robot", [[0, 0, 100, 0]]),
    
    ("ABB-IRB-260.robot", [[0, 60, 10, 0]]),
    
    ("Fanuc-ARC-Mate-120iB.robot", [[0, 0, 200, 0, 0, 0]]),
    
    ("Niryo-NED.robot", [[0, -100, 0, 0, 0, 0]]),
], "classes": [
    
    ("Gudel-FP-1-300.robot", [[0, 500, 0], [0, -500, 0]]),
    
    ("NEWKer-NEW2006B.robot", [[0, -150, 0, 0, 0, 0]]),
    
    ("Hyundai-YS080L.robot", [[0, 0, 150, 0, 0, 0]]),
    
    ("RealMan-GEN72-B.robot", [[0, 0, 0, -150, 0, 0, 0]]),
    
    ("ABB-IRB-2400-10.robot", [[0, 100, 150, 0, 0, 0]]),
]}[SET]

R = {"set": SET, "probes": []}


def err(exc):
    msg = str(exc).strip().splitlines()[0] if str(exc).strip() else ""
    return "%s: %s" % (type(exc).__name__, msg)


RDK = robolink.Robolink(port=PORT, args=["-NEWINSTANCE", "-NOUI", "-SKIPINI", "-EXIT_LAST_COM"], robodk_path=RDK_PATH)
try:
    R["version"] = RDK.Version()  
    for fname, qs in PROBES:
        robot = RDK.AddFile(os.path.join(ROBOT_DIR, fname))  
        for q in qs:
            row = {"robot": fname, "q": q}
            try:
                robot.SolveFK(q)  
                row["solve_fk"] = "ok"
            except Exception as exc:
                row["solve_fk"] = err(exc)
            try:
                robot.setJoints(q)  
                row["set_joints"] = [round(v, 4) for v in robot.Joints().list()]  
            except Exception as exc:
                row["set_joints"] = err(exc)
            R["probes"].append(row)
            print(json.dumps(row), flush=True)
finally:
    with open(OUT, "w") as f:
        json.dump(R, f, indent=1)
    try:
        RDK.CloseRoboDK()
    except Exception:
        pass
    os._exit(0)
