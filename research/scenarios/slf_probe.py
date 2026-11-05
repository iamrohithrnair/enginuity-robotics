# Probes station save/load and library URL handling while recording loaded item trees.







import math
import os
import sys
import time

PORT = int(sys.argv[1])
SAMPLE = sys.argv[2]
OUT = sys.argv[3]
DL = sys.argv[4]
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, os.pardir, "python", "enginuity", "src"))  
from enginuity import robolink, robomath  # noqa: E402

RDK = robolink.Robolink(port=PORT, args=[], quit_on_close=False)


def pose6(m):
    v = robomath.Pose_2_TxyzRxyz(m)
    return [round(x, 3) + 0.0 for x in v[:3]] + [round(math.degrees(a), 3) + 0.0 for a in v[3:]]


def tree(tag):
    for it in RDK.ItemList():
        typ = it.Type()
        par = it.Parent()
        ps = pose6(it.Pose()) if typ in (3, 4, 5, 6) else ""
        print("%s|%d|%s|%s|%s" % (tag, typ, it.Name(), par.Name() if par.Valid() else "-", ps), flush=True)


def wait_more(n0, timeout=120):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if len(RDK.ItemList()) > n0:
            time.sleep(1.5)
            return True
        time.sleep(0.5)
    return False



stn = RDK.AddFile(SAMPLE)
print("sample_loaded:", stn.Valid(), stn.Type(), flush=True)
tree("SAMPLE")
print("sample_params:", RDK.getParams(), flush=True)
RDK.CloseStation()


s2 = RDK.AddStation("MinStation")
fr = RDK.AddFrame("FrameA")
fr.setPose(robomath.transl(100, 200, 300) * robomath.rotz(robomath.pi / 2))
tg = RDK.AddTarget("TargetB", fr)
tg.setPose(robomath.transl(10, 20, 30))
os.makedirs(OUT, exist_ok=True)
p = os.path.join(OUT, "minimal.rdk")
RDK.Save(p, s2)
print("minimal_saved_bytes:", os.path.getsize(p), flush=True)
RDK.CloseStation()


RDK.AddStation("LibProbe")
os.makedirs(DL, exist_ok=True)
print("PATH_LIB_LOCAL:", RDK.Command("PATH_LIB_LOCAL", DL.rstrip("/") + "/"), flush=True)
base = "http://cdn.robodk.com/downloads-library/"
for label, url in (("robot", base + "library-robots/UR5e.robot"),
                   ("tool", base + "library-tools/Generic-Laser-Cutter.tool"),
                   ("robot2", base + "library-robots/UR5e.robot")):
    n0 = len(RDK.ItemList())
    print("OpenURL_%s:" % label, RDK.Command("OpenURL", url), flush=True)
    print("OpenURL_%s_loaded:" % label, wait_more(n0), flush=True)
    tree("LIB_" + label)
print("downloaded_files:", sorted(os.listdir(DL)), flush=True)
