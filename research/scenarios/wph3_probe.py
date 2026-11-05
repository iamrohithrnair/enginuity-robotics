# Probes program-update edge cases for rounding, missing robots and subprogram execution.




















import json
import os
import sys
import threading
import time

PORT = int(sys.argv[1])
STATION_DIR = sys.argv[2]
ROBOT_DIR = sys.argv[3]
OUT = sys.argv[4]
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, os.pardir, "python", "enginuity", "src"))  

from enginuity import robolink  # noqa: E402

RDK_PATH = "/workspace/src/RoboDK/RoboDK.app/Contents/MacOS/RoboDK"
threading.Timer(480, lambda: os._exit(3)).start()  

R = {}


def err(exc):
    msg = str(exc).strip().splitlines()[0] if str(exc).strip() else ""
    return "ERROR %s: %s" % (type(exc).__name__, msg)


def rnd(v):
    if isinstance(v, (list, tuple)):
        return [rnd(x) for x in v]
    if hasattr(v, "list"):
        return rnd(v.list())
    return round(v, 4) if isinstance(v, float) else v


def rec(key, fn):
    try:
        R[key] = rnd(fn())
    except Exception as exc:  
        R[key] = err(exc)
    print(key, json.dumps(R[key]), flush=True)


RDK = robolink.Robolink(port=PORT, args=["-NEWINSTANCE", "-NOUI", "-SKIPINI", "-EXIT_LAST_COM"], robodk_path=RDK_PATH)
try:
    rec("version", RDK.Version)  

    
    rec("A.addfile", lambda: RDK.AddFile(os.path.join(STATION_DIR, "Inspection-with-UR10.rdk")).Valid())  
    shot = RDK.Item("PictureShot", robolink.ITEM_TYPE_PROGRAM)  
    rec("A.PictureShot.update", lambda: list(shot.Update()))  
    rec("A.close", RDK.CloseStation)  

    
    rec("D.addfile", lambda: RDK.AddFile(os.path.join(STATION_DIR, "Curve-Following-with-Omron-TM5-700.rdk")).Valid())  
    outline = RDK.Item("Outline", robolink.ITEM_TYPE_PROGRAM)  
    tm5 = RDK.Item("Omron TM5-700", robolink.ITEM_TYPE_ROBOT)  
    rec("D.Outline.update.saved_state", lambda: list(outline.Update()))  
    rec("D.setRounding(-1)", lambda: tm5.setRounding(-1) and None)  
    rec("D.Outline.update.rounding_-1", lambda: list(outline.Update()))  
    rec("D.close", RDK.CloseStation)  

    
    RDK.AddStation("WPH3")  
    nr = RDK.AddProgram("NR")  
    nrm = RDK.AddProgram("NRMove")  
    robot = RDK.AddFile(os.path.join(ROBOT_DIR, "ABB-IRB-120-3-0-6.robot"))  
    sub = RDK.AddProgram("Sub", robot)  
    robot.setJoints([30, 0, 0, 0, 30, 0])  
    target = RDK.AddTarget("T1", 0, robot)  
    robot.setJoints([0, 0, 0, 0, 30, 0])  
    sub.addMoveJ(target)  
    nr.RunInstruction("Sub", robolink.INSTRUCTION_CALL_PROGRAM)  
    nrm.addMoveJ(target)  
    rec("S.NR.update", lambda: list(nr.Update()))  
    rec("S.NRMove.update", lambda: list(nrm.Update()))  
    rec("S.Sub.update", lambda: list(sub.Update()))  
    rec("S.NR.run", lambda: nr.RunProgram())  
    time.sleep(3.0)
    rec("S.NR.busy_after_3s", nr.Busy)  
    rec("S.robot.joints_after_NR", lambda: robot.Joints())  
    robot.setJoints([0, 0, 0, 0, 30, 0])  
    rec("S.NRMove.run", lambda: nrm.RunProgram())  
    time.sleep(3.0)
    rec("S.NRMove.busy_after_3s", nrm.Busy)  
    rec("S.robot.joints_after_NRMove", lambda: robot.Joints())  
    rec("S.NRMove.stop", lambda: nrm.Stop() and None)  
    rec("S.NRMove.busy_after_stop", nrm.Busy)  
finally:
    with open(OUT, "w") as f:
        json.dump(R, f, indent=1)
    os._exit(0)
