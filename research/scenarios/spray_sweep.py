# Runs spray programs at chosen simulation speeds and records statistics and screenshots.






import json
import os
import subprocess
import sys
import time
import urllib.request

BASE = "http://localhost:3200"
FILE, PROGRAM, RATIO, OUT = sys.argv[1], sys.argv[2], float(sys.argv[3]), os.path.abspath(sys.argv[4])
os.makedirs(OUT, exist_ok=True)
slug = FILE.replace(".rdk", "")


def cmd(name, params=None, timeout=600):
    body = json.dumps({"name": name, "params": params or {}}).encode()
    req = urllib.request.Request(BASE + "/api/command", data=body, headers={"content-type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=timeout))


def state():
    return json.load(urllib.request.urlopen(BASE + "/api/state", timeout=60))["ws"]


log = {"file": FILE, "program": PROGRAM, "ratio": RATIO}
t0 = time.time()
r = cmd("station.openRdk", {"file": FILE})
log["open"] = {k: r.get(k) for k in ("ok", "error")}
log["open_s"] = round(time.time() - t0, 1)
if not r.get("ok"):
    print(json.dumps(log))
    sys.exit(1)
station = r["result"].get("station") or r["result"].get("id")
cmd("sim.setSpeed", {"factor": RATIO})
t1 = time.time()
r = cmd("program.run", {"program": PROGRAM})
log["run"] = {k: r.get(k) for k in ("ok", "error")}
time.sleep(2.0)
deadline = time.time() + 900
idle_since = None
while time.time() < deadline:
    ws = state()
    busy = [b for b in (ws.get("busy") or []) if b in ws["items"]]
    if not ws.get("running") and not busy:
        idle_since = idle_since or time.time()
        if time.time() - idle_since > 4:
            break
    else:
        idle_since = None
    time.sleep(1.5)
log["run_s"] = round(time.time() - t1, 1)
log["timed_out"] = time.time() >= deadline
log["spray_list"] = cmd("spray.list")["result"]
log["spray_stats"] = cmd("spray.stats")["result"]
shot = os.path.join(OUT, f"{slug}.png")
subprocess.run(["node", "research/tools/shot.mjs", BASE, shot, "9000", "key:Alt+7", "wait:3000"], cwd="/workspace/src/AI/experiments/Robocraft", capture_output=True, timeout=180)
log["shot"] = shot

guns = log["spray_list"]["guns"]
if guns:
    cmd("edit.select", {"items": [guns[0]["object"]]})
    zoom = os.path.join(OUT, f"{slug}-zoom.png")
    out = subprocess.run(["node", "research/tools/shot.mjs", BASE, zoom, "9000", "key:Alt+0", "wait:3000"], cwd="/workspace/src/AI/experiments/Robocraft", capture_output=True, text=True, timeout=180)
    log["zoom"] = zoom
    log["browser_log"] = out.stdout[-800:]
close = cmd("station.close", {"station": station, "ifUnsaved": "discard"})
log["close"] = {k: close.get(k) for k in ("ok", "error")}
with open(os.path.join(OUT, f"{slug}.json"), "w") as fh:
    json.dump(log, fh, indent=1)
summary = {k: log[k] for k in ("file", "program", "ratio", "open_s", "run_s", "timed_out")}
summary["guns"] = [{k: g.get(k) for k in ("id", "tool", "object", "state", "options", "updates", "in", "out", "total", "percentIn", "stored")} for g in log["spray_list"]["guns"]]
print(json.dumps(summary, indent=1))
