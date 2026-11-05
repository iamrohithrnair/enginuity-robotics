# Probes conveyor programs, object creation/deletion events and reset behavior.
















import json
import os
import sys
import threading
import time

PORT = int(sys.argv[1])
STATION_DIR = sys.argv[2]
PHASE = sys.argv[3]
OUT = sys.argv[4]
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, os.pardir, "python", "enginuity", "src"))  

from enginuity import robolink  # noqa: E402

RDK_PATH = "/workspace/src/RoboDK/RoboDK.app/Contents/MacOS/RoboDK"
threading.Timer(420, lambda: os._exit(3)).start()  

R = {"phase": PHASE, "steps": []}
CALLS = [0]


def rnd(v):
    if isinstance(v, robolink.Item):
        return "item:%d" % v.item
    if hasattr(v, "rows"):
        return rnd(v.rows)
    if isinstance(v, (list, tuple)):
        return [rnd(x) for x in v]
    return round(v, 4) if isinstance(v, float) else v


def step(label, fn, calls):
    CALLS[0] += calls
    try:
        val = fn()
        R["steps"].append([label, rnd(val)])
        print(label, json.dumps(rnd(val))[:400], flush=True)
        return val
    except Exception as exc:  
        msg = str(exc).strip().splitlines()[0] if str(exc).strip() else ""
        R["steps"].append([label, "ERROR %s: %s" % (type(exc).__name__, msg)])
        print(label, "ERROR", type(exc).__name__, msg, flush=True)
        return None


def ptrs(items):
    return [it.item for it in items]


RDK = robolink.Robolink(port=PORT, args=["-NEWINSTANCE", "-NOUI", "-SKIPINI", "-EXIT_LAST_COM"], robodk_path=RDK_PATH)
try:
    step("version", RDK.Version, 1)
    OBJ = robolink.ITEM_TYPE_OBJECT
    if PHASE == "conv04":
        step("open", lambda: RDK.AddFile(os.path.join(STATION_DIR, "Conveying-04.rdk")) and "ok", 1)
        step("speed", lambda: RDK.setSimulationSpeed(50) or 50, 1)
        o0 = step("objects.before", lambda: ptrs(RDK.ItemList(OBJ)), 1) or []
        main = step("main", lambda: RDK.Item("Main", robolink.ITEM_TYPE_PROGRAM), 1)
        step("main.update", lambda: list(main.Update()), 1)
        step("main.run", lambda: main.RunProgram(), 1)
        time.sleep(4)
        step("main.busy_after_4s", lambda: main.Busy(), 1)
        conv = step("conveyor", lambda: RDK.Item("Box Conveyor", robolink.ITEM_TYPE_ROBOT), 1)
        step("conveyor.joints_after_main", lambda: conv.Joints().list(), 1)
        o1 = step("objects.after_main", lambda: ptrs(RDK.ItemList(OBJ)), 1) or []
        new = [robolink.Item(RDK, p) for p in o1 if p not in set(o0)]
        R["new_after_main"] = len(new)
        if new:
            c = new[0]
            step("copy.name", c.Name, 1)
            par = step("copy.parent", c.Parent, 1)
            step("copy.parent.name", lambda: par.Name(), 1)
            step("copy.poseabs", lambda: c.PoseAbs(), 1)
            step("copy.pose", lambda: c.Pose(), 1)
            step("copy.visible", c.Visible, 1)
        reset = step("reset", lambda: RDK.Item("Reset", robolink.ITEM_TYPE_PROGRAM), 1)
        step("reset.run", lambda: reset.RunProgram(), 1)
        time.sleep(3)
        o2 = step("objects.after_reset", lambda: ptrs(RDK.ItemList(OBJ)), 1) or []
        R["survivors_of_initial"] = [i for i, p in enumerate(o0) if p in set(o2)]
        R["created_by_main_survives"] = [p in set(o2) for p in (x.item for x in new)]
        new2 = [p for p in o2 if p not in set(o0) and p not in set(x.item for x in new)]
        R["new_after_reset"] = len(new2)
        step("conveyor.joints_after_reset", lambda: conv.Joints().list(), 1)
        if new2:
            c2 = robolink.Item(RDK, new2[0])
            step("reset_copy.name", c2.Name, 1)
            par2 = step("reset_copy.parent", c2.Parent, 1)
            step("reset_copy.parent.name", lambda: par2.Name(), 1)
            step("reset_copy.poseabs", lambda: c2.PoseAbs(), 1)
        
        p = step("nomech.prog", lambda: RDK.AddProgram("NoMech"), 1)
        step("nomech.add", lambda: p.setParam("Add", {"Type": 7}), 1)
        step("nomech.set", lambda: p.setParam(0, {"Behavior": 7, "ObjectList": str(o2[0]), "AttachDistance": 100}), 1)
        step("nomech.json", lambda: p.setParam(0), 1)
        step("nomech.run", lambda: p.RunProgram(), 1)
        time.sleep(2)
        step("nomech.busy_after_2s", lambda: p.Busy(), 1)
        step("nomech.stop", lambda: p.Stop() and "ok", 1)
    elif PHASE == "crb":
        step("open", lambda: RDK.AddFile(os.path.join(STATION_DIR, "Conveying-with-ABB-CRB-1300-7-1-4.rdk")) and "ok", 1)
        step("speed", lambda: RDK.setSimulationSpeed(20) or 20, 1)
        o0 = step("objects.before", lambda: ptrs(RDK.ItemList(OBJ)), 1) or []
        feeder = step("feeder", lambda: RDK.Item("BoxFeeder", robolink.ITEM_TYPE_PROGRAM), 1)
        step("feeder.run", lambda: feeder.RunProgram(), 1)
        time.sleep(1.5)
        step("feeder.busy_after_1.5s", lambda: feeder.Busy(), 1)
        o1 = step("objects.after_feeder", lambda: ptrs(RDK.ItemList(OBJ)), 1) or []
        new = [p for p in o1 if p not in set(o0)]
        R["new_after_feeder"] = len(new)
        if new:
            b = robolink.Item(RDK, new[0])
            step("box.name", b.Name, 1)
            par = step("box.parent", b.Parent, 1)
            step("box.parent.name", lambda: par.Name(), 1)
            step("box.poseabs", lambda: b.PoseAbs(), 1)
            step("box.visible", b.Visible, 1)
        dele = step("deleterA", lambda: RDK.Item("BoxDeleterA", robolink.ITEM_TYPE_PROGRAM), 1)
        step("deleterA.update", lambda: list(dele.Update()), 1)
        step("deleterA.run", lambda: dele.RunProgram(), 1)
        time.sleep(1)
        step("deleterA.busy_waiting", lambda: dele.Busy(), 1)
        mv = step("convA", lambda: RDK.Item("ConveyorMoveA", robolink.ITEM_TYPE_PROGRAM), 1)
        step("convA.run", lambda: mv.RunProgram(), 1)
        time.sleep(12)
        step("deleterA.busy_after_12s", lambda: dele.Busy(), 1)
        o2 = step("objects.after_conveyor", lambda: ptrs(RDK.ItemList(OBJ)), 1) or []
        R["box_still_there"] = [p in set(o2) for p in new]
        robA = step("conveyorA", lambda: RDK.Item("ConveyorA", robolink.ITEM_TYPE_ROBOT), 1)
        step("conveyorA.joints", lambda: robA.Joints().list(), 1)
        step("convA.stop", lambda: mv.Stop() and "ok", 1)
    R["calls"] = CALLS[0]
finally:
    with open(OUT, "w") as f:
        json.dump(R, f, indent=1)
    os._exit(0)
