# Probes spray geometry, multiple emitters and deposition rate through the raw API.









import json
import math
import os
import socket
import struct
import subprocess
import sys
import threading
import time

MODE = sys.argv[1]
OUT = sys.argv[2]
PORT = 20523
RDK = "/workspace/src/RoboDK/RoboDK.app/Contents/MacOS/RoboDK"
ROBOT = "/workspace/src/AI/experiments/Robocraft/data/library/files/library-robots/ABB-IRB-120-3-0-6.robot"  
WINLIST = "/workspace/src/AI/experiments/Robocraft/research/tools/winlist"
os.makedirs(OUT, exist_ok=True)
threading.Timer(420, lambda: os._exit(3)).start()  


class Wire:
    def __init__(self, port):
        self.s = socket.create_connection(("127.0.0.1", port), timeout=120)
        self.buf = b""
        self.raw = b""

    
    @staticmethod
    def line(t):
        return (t.replace("\n", "<br>") + "\n").encode()

    @staticmethod
    def i32(v):
        return struct.pack(">i", v)

    @staticmethod
    def item(h):
        return struct.pack(">Q", h)

    @staticmethod
    def f64(vs):
        return b"".join(struct.pack(">d", float(v)) for v in vs)

    def arr(self, vs):
        return self.i32(len(vs)) + self.f64(vs)

    def mat(self, rows, cols, colmajor):
        return self.i32(rows) + self.i32(cols) + self.f64(colmajor)

    def send(self, *parts):
        self.raw = b""
        self.s.sendall(b"".join(parts))

    
    def take(self, n):
        while len(self.buf) < n:
            d = self.s.recv(65536)
            if not d:
                raise ConnectionError("closed")
            self.buf += d
        out, self.buf = self.buf[:n], self.buf[n:]
        self.raw += out
        return out

    def r_line(self):
        while b"\n" not in self.buf:
            d = self.s.recv(65536)
            if not d:
                raise ConnectionError("closed")
            self.buf += d
        i = self.buf.index(b"\n")
        out, self.buf = self.buf[: i + 1], self.buf[i + 1 :]
        self.raw += out
        return out[:-1].decode("utf-8", "replace")

    def r_i32(self):
        return struct.unpack(">i", self.take(4))[0]

    def r_item(self):
        h = struct.unpack(">Q", self.take(8))[0]
        t = self.r_i32()
        return h, t

    def r_mat(self):
        r = self.r_i32()
        c = self.r_i32()
        data = list(struct.unpack(">%dd" % (r * c), self.take(8 * r * c))) if r * c > 0 else []
        return r, c, data

    def r_status(self):
        c = self.r_i32()
        if c == 2 or c == 3 or 10 <= c < 100:
            return c, self.r_line()
        return c, None

    def close(self):
        try:
            self.s.close()
        except OSError:
            pass


LOG = []
CALLS = [0]


def rec(key, value, raw=None):
    entry = {"step": key, "value": value}
    if raw is not None:
        entry["hex"] = raw.hex()
    LOG.append(entry)
    print(key, "->", json.dumps(value)[:300], flush=True)


def handshake(w):
    w.send(w.line("RDK_API"), w.arr([1, 0, 0]))
    out = [w.r_line(), w.r_i32(), w.r_i32(), w.r_i32()]
    CALLS[0] += 1
    return out


def cmd(w, key, name, *payload, reply):
    CALLS[0] += 1
    t0 = time.time()
    w.send(w.line(name), *payload)
    v = reply(w)
    rec(key, {"reply": v, "ms": round((time.time() - t0) * 1000, 1), "call": CALLS[0]}, w.raw)
    return v


R_ITEM = lambda w: [w.r_item(), w.r_status()]
R_STATUS = lambda w: [w.r_status()]
R_INT = lambda w: [w.r_i32(), w.r_status()]
R_LINE = lambda w: [w.r_line(), w.r_status()]
R_STATS = lambda w: [w.r_line(), w.r_mat(), w.r_status()]
R_ARRAY = lambda w: [(lambda n: list(struct.unpack(">%dd" % n, w.take(8 * n))) if n else [])(w.r_i32()), w.r_status()]
R_MOVEB = lambda w: [w.r_status(), w.r_status()]


def colmajor(rowmajor16):
    return [rowmajor16[r * 4 + c] for c in range(4) for r in range(4)]


def pose(rot, t):
    m = [rot[0][0], rot[0][1], rot[0][2], t[0], rot[1][0], rot[1][1], rot[1][2], t[1], rot[2][0], rot[2][1], rot[2][2], t[2], 0, 0, 0, 1]
    return colmajor(m)


ROTX180 = [[1, 0, 0], [0, -1, 0], [0, 0, -1]]


def tri_matrix(tris):
    pts = [p for t in tris for p in t]
    return 3, len(pts), [v for p in pts for v in p]


def plate(x0, x1, y0, y1, z=0.0):
    a, b, c, d = (x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)
    return tri_matrix([(a, b, c), (a, c, d)])


def window_id(pid):
    try:
        out = subprocess.run([WINLIST, "RoboDK"], capture_output=True).stdout.decode(errors="replace")
    except OSError:
        return None
    best = None
    for l in out.splitlines():
        parts = l.split("\t")
        if len(parts) >= 5 and parts[0] == str(pid) and parts[4].startswith("RoboDK"):
            best = parts[1]
    return best


def shot(pid, name):
    time.sleep(0.8)
    wid = window_id(pid)
    if not wid:
        rec("shot-" + name, "no-window")
        return
    path = os.path.join(OUT, f"{MODE}-{name}.png")
    subprocess.run(["screencapture", "-x", "-o", "-l", wid, path], check=False)
    rec("shot-" + name, os.path.basename(path))


def launch():
    logf = open(os.path.join(OUT, f"{MODE}-robodk-stdout.log"), "w")
    p = subprocess.Popen([RDK, f"-PORT={PORT}", "-NEWINSTANCE", "-SKIPINI", "-DEBUG", "-EXIT_LAST_COM"], stdout=logf, stderr=subprocess.STDOUT)
    for _ in range(240):
        try:
            s = socket.create_connection(("127.0.0.1", PORT), timeout=1)
            s.close()
            break
        except OSError:
            time.sleep(0.5)
    time.sleep(3.0)  
    return p


def mode_geom(w, pid):
    plate_m = plate(-30, 270, -150, 150)
    gun_m = tri_matrix([((0, 0, 0), (10, 0, 0), (0, 10, 0))])
    (plate_h, plate_t), _ = cmd(w, "AddShape3.plate", "AddShape3", w.mat(*plate_m), w.item(0), w.i32(0), w.arr([0.7, 0.7, 0.7, 1]), reply=R_ITEM)
    (gun_h, gun_t), _ = cmd(w, "AddShape3.gun", "AddShape3", w.mat(*gun_m), w.item(0), w.i32(0), w.arr([0.2, 0.2, 0.2, 1]), reply=R_ITEM)
    cmd(w, "S_Hlocal.gun.P1", "S_Hlocal", w.item(gun_h), w.f64(pose(ROTX180, (0, 0, 300))), reply=R_STATUS)
    cmd(w, "SCMD.FitAll", "SCMD", w.line("TriggerAction"), w.line("actionFit_All"), reply=R_LINE)
    vol1 = [0, 0, 0, 0, 0, 0, 0, 0, 0] + [0, 0, 600, 200, 0, 600, 0, 100, 600]
    cmd(w, "Gun_Add.ellipse", "Gun_Add", w.item(gun_h), w.item(plate_h), w.line("ELLYPSE PROJECT STEP=8x4 RAND=0 PARTICLE=SPHERE(5,8)"), w.mat(9, 2, vol1), w.mat(0, 0, []), reply=R_INT)
    cmd(w, "Gun_Stats.initial", "Gun_Stats", w.i32(-1), reply=R_STATS)
    cmd(w, "Gun_SetState.on", "Gun_SetState", w.i32(-1), w.i32(1), reply=R_INT)
    cmd(w, "Gun_Stats.after_on", "Gun_Stats", w.i32(-1), reply=R_STATS)
    cmd(w, "Gun_Stats.second", "Gun_Stats", w.i32(-1), reply=R_STATS)
    cmd(w, "G_Name.plate", "G_Name", w.item(plate_h), reply=R_LINE)
    cmd(w, "Gun_Stats.after_G_Name", "Gun_Stats", w.i32(-1), reply=R_STATS)
    
    w2 = Wire(PORT)
    rec("conn2.handshake", handshake(w2))
    w2.close()
    time.sleep(0.5)
    cmd(w, "Gun_Stats.after_conn2", "Gun_Stats", w.i32(-1), reply=R_STATS)
    cmd(w, "S_Hlocal.gun.P2", "S_Hlocal", w.item(gun_h), w.f64(pose(ROTX180, (200, 0, 300))), reply=R_STATUS)
    cmd(w, "Gun_Stats.after_move", "Gun_Stats", w.i32(-1), reply=R_STATS)
    shot(pid, "particles-on")
    cmd(w, "Gun_SetState.hidden2", "Gun_SetState", w.i32(-1), w.i32(2), reply=R_INT)
    cmd(w, "Gun_Stats.state2_a", "Gun_Stats", w.i32(-1), reply=R_STATS)
    shot(pid, "state2")
    cmd(w, "Gun_Stats.state2_b", "Gun_Stats", w.i32(-1), reply=R_STATS)
    cmd(w, "Gun_SetState.off", "Gun_SetState", w.i32(-1), w.i32(0), reply=R_INT)
    cmd(w, "Gun_Stats.off_a", "Gun_Stats", w.i32(-1), reply=R_STATS)
    shot(pid, "off")
    cmd(w, "Gun_Stats.off_b", "Gun_Stats", w.i32(-1), reply=R_STATS)
    cmd(w, "Gun_Clear.all", "Gun_Clear", w.i32(-1), reply=R_INT)
    cmd(w, "Gun_Stats.empty", "Gun_Stats", w.i32(-1), reply=R_STATS)
    cmd(w, "Gun_Clear.again", "Gun_Clear", w.i32(-1), reply=R_INT)
    shot(pid, "cleared")


def mode_multi(w, pid):
    plate_m = plate(-30, 270, -150, 150)
    gun_m = tri_matrix([((0, 0, 0), (10, 0, 0), (0, 10, 0))])
    (plate_h, _), _ = cmd(w, "AddShape3.plate", "AddShape3", w.mat(*plate_m), w.item(0), w.i32(0), w.arr([0.7, 0.7, 0.7, 1]), reply=R_ITEM)
    (gun_h, _), _ = cmd(w, "AddShape3.gun", "AddShape3", w.mat(*gun_m), w.item(0), w.i32(0), w.arr([0.2, 0.2, 0.2, 1]), reply=R_ITEM)
    cmd(w, "S_Hlocal.gun.P1", "S_Hlocal", w.item(gun_h), w.f64(pose(ROTX180, (0, 0, 300))), reply=R_STATUS)
    cmd(w, "SCMD.FitAll", "SCMD", w.line("TriggerAction"), w.line("actionFit_All"), reply=R_LINE)
    vol2 = [0, 0, 0, 0, 0, 0, 0, 0, 0] + [-200, -100, 600, 200, -100, 600, -200, 100, 600]
    cmd(w, "Gun_Add.rect", "Gun_Add", w.item(gun_h), w.item(plate_h), w.line("RECTANGLE PROJECT STEP=2x2 RAND=0 PARTICLE=CUBE(6,6,6) COLOR=#ff00a000"), w.mat(9, 2, vol2), w.mat(0, 0, []), reply=R_INT)
    cmd(w, "Gun_Add.noproject", "Gun_Add", w.item(gun_h), w.item(plate_h), w.line("NO_PROJECT STEP=2x1 RAND=0 COLOR=blue"), w.mat(0, 0, []), w.mat(0, 0, []), reply=R_INT)
    cmd(w, "Gun_SetState.on_all", "Gun_SetState", w.i32(-1), w.i32(1), reply=R_INT)
    cmd(w, "Gun_Stats.a", "Gun_Stats", w.i32(-1), reply=R_STATS)
    cmd(w, "Gun_Stats.b", "Gun_Stats", w.i32(0), reply=R_STATS)
    shot(pid, "rect-noproject")
    cmd(w, "Gun_SetState.id5_off", "Gun_SetState", w.i32(5), w.i32(0), reply=R_INT)
    cmd(w, "Gun_Stats.c", "Gun_Stats", w.i32(1), reply=R_STATS)
    cmd(w, "Gun_Stats.d", "Gun_Stats", w.i32(-1), reply=R_STATS)
    cmd(w, "Gun_SetState.id1_on", "Gun_SetState", w.i32(1), w.i32(1), reply=R_INT)
    cmd(w, "Gun_Stats.e", "Gun_Stats", w.i32(-1), reply=R_STATS)
    cmd(w, "Gun_Stats.f", "Gun_Stats", w.i32(-1), reply=R_STATS)
    cmd(w, "Gun_Clear.id7", "Gun_Clear", w.i32(7), reply=R_INT)
    cmd(w, "Gun_Stats.after_clear", "Gun_Stats", w.i32(-1), reply=R_STATS)
    cmd(w, "Gun_Add.auto_no_robot", "Gun_Add", w.item(0), w.item(0), w.line(""), w.mat(0, 0, []), w.mat(0, 0, []), reply=R_INT)
    cmd(w, "Gun_Add.bad_handle", "Gun_Add", w.item(123456789), w.item(plate_h), w.line(""), w.mat(0, 0, []), w.mat(0, 0, []), reply=R_INT)
    cmd(w, "Gun_Add.tool_is_plate", "Gun_Add", w.item(plate_h), w.item(plate_h), w.line("STEP=1x0"), w.mat(0, 0, []), w.mat(0, 0, []), reply=R_INT)


def mode_rate(w, pid):
    (robot_h, robot_t), _ = cmd(w, "Add.robot", "Add", w.line(ROBOT), w.item(0), reply=R_ITEM)
    (tool_h, _), _ = cmd(w, "AddToolEmpty", "AddToolEmpty", w.item(robot_h), w.f64(pose([[1, 0, 0], [0, 1, 0], [0, 0, 1]], (0, 0, 100))), w.line("T1"), reply=R_ITEM)
    obj_m = tri_matrix([((300, -200, 0), (500, -200, 0), (300, 200, 0)), ((500, -200, 0), (500, 200, 0), (300, 200, 0))])
    (obj_h, _), _ = cmd(w, "AddShape3.part", "AddShape3", w.mat(*obj_m), w.item(0), w.i32(0), w.arr([0.7, 0.7, 0.7, 1]), reply=R_ITEM)
    cmd(w, "S_Speed4", "S_Speed4", w.item(robot_h), w.arr([100, 30, 1000, 300]), reply=R_STATUS)
    opts = "NO_PROJECT PARTICLE=SPHERE(3) COLOR=white STEP=1x0 RAND=0"
    cmd(w, "Gun_Add.auto", "Gun_Add", w.item(0), w.item(0), w.line(opts), w.mat(0, 0, []), w.mat(0, 0, []), reply=R_INT)
    cmd(w, "Gun_Add.explicit", "Gun_Add", w.item(tool_h), w.item(obj_h), w.line(opts), w.mat(0, 0, []), w.mat(0, 0, []), reply=R_INT)
    cmd(w, "Gun_SetState.on", "Gun_SetState", w.i32(-1), w.i32(1), reply=R_INT)
    jstart = [-21.09, 25.74, 2.24, 0.0, 62.02, -21.09]
    cmd(w, "MoveXb.J.start", "MoveXb", w.i32(1), w.i32(1), w.arr(jstart), w.item(0), w.item(robot_h), reply=R_MOVEB)
    rot = [[-1, 0, 0], [0, 1, 0], [0, 0, -1]]
    for ratio, y in ((1, 150), (5, -150), (20, 150)):
        cmd(w, f"SimulateSpeed.{ratio}", "SimulateSpeed", w.i32(ratio * 1000), reply=R_STATUS)
        cmd(w, f"Gun_Stats.before_r{ratio}", "Gun_Stats", w.i32(-1), reply=R_STATS)
        cmd(w, f"MoveXb.L.r{ratio}", "MoveXb", w.i32(2), w.i32(2), w.arr(pose(rot, (388.8851, y, 281.3388))), w.item(0), w.item(robot_h), reply=R_MOVEB)
        cmd(w, f"Gun_Stats.after_r{ratio}", "Gun_Stats", w.i32(-1), reply=R_STATS)
    cmd(w, "S_Thetas", "S_Thetas", w.arr(jstart), w.item(robot_h), reply=R_STATUS)
    cmd(w, "Gun_Stats.after_S_Thetas", "Gun_Stats", w.i32(-1), reply=R_STATS)
    cmd(w, "G_Thetas", "G_Thetas", w.item(robot_h), reply=R_ARRAY)
    cmd(w, "Gun_Stats.after_G_Thetas", "Gun_Stats", w.i32(-1), reply=R_STATS)
    cmd(w, "SCMD.FitAll", "SCMD", w.line("TriggerAction"), w.line("actionFit_All"), reply=R_LINE)
    shot(pid, "bead")
    cmd(w, "Gun_SetState.off", "Gun_SetState", w.i32(-1), w.i32(0), reply=R_INT)


proc = launch()
rec("launch", {"pid": proc.pid})
w = None
try:
    w = Wire(PORT)
    rec("handshake", handshake(w))
    {"geom": mode_geom, "multi": mode_multi, "rate": mode_rate}[MODE](w, proc.pid)
except Exception as exc:  
    rec("error", f"{type(exc).__name__}: {exc}")
finally:
    rec("api_calls", CALLS[0])
    with open(os.path.join(OUT, f"{MODE}-transcript.json"), "w") as fh:
        json.dump(LOG, fh, indent=1)
    if w:
        w.close()
    time.sleep(1.5)
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
    print("done", flush=True)
    os._exit(0)
