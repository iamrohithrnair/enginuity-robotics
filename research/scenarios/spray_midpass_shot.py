# Pauses a spray simulation mid-pass and captures its view and spray state.
import json, subprocess, sys, time, urllib.request
BASE="http://localhost:3200"; FILE, PROG, RATIO, AT, OUT = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4]), sys.argv[5]
def cmd(name, params=None):
    body=json.dumps({"name":name,"params":params or {}}).encode()
    return json.load(urllib.request.urlopen(urllib.request.Request(BASE+"/api/command",data=body,headers={"content-type":"application/json"}),timeout=600))
r=cmd("station.openRdk",{"file":FILE}); st=r["result"].get("station") or r["result"].get("id")
cmd("sim.setSpeed",{"factor":RATIO}); cmd("program.run",{"program":PROG})
time.sleep(AT)
cmd("sim.pause",{"paused":True})
print(json.dumps(cmd("spray.list")["result"]["guns"])[:400])
subprocess.run(["node","research/tools/shot.mjs",BASE,OUT,"9000","key:Alt+7","wait:2500"],cwd="/workspace/src/AI/experiments/Robocraft",capture_output=True,timeout=180)
cmd("sim.pause",{"paused":False})
while True:
    ws=json.load(urllib.request.urlopen(BASE+"/api/state"))["ws"]
    if not ws.get("running") and not [b for b in (ws.get("busy") or []) if b in ws["items"]]: break
    time.sleep(1)
cmd("station.close",{"station":st,"ifUnsaved":"discard"})
