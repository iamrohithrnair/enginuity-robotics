









import json
import os
import socket
import struct
import subprocess
import sys
import threading
import time

OUT = sys.argv[1]
PORT = 20523
RDK = "/workspace/src/RoboDK/RoboDK.app/Contents/MacOS/RoboDK"
R540 = "/workspace/src/AI/experiments/Robocraft/data/library/files/library-stations/Assembly-and-Material-Handling-with-KUKA-KR-3-R540.rdk"
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

    def r_f64(self, n):
        return list(struct.unpack(">%dd" % n, self.take(8 * n))) if n else []

    def r_item(self):
        h = struct.unpack(">Q", self.take(8))[0]
        return [h, self.r_i32()]

    def r_arr(self):
        return self.r_f64(self.r_i32())

    def r_mat(self):
        r = self.r_i32()
        c = self.r_i32()
        return [r, c, self.r_f64(r * c)]

    def r_pose(self):
        return self.r_f64(16)

    def r_bytes(self):
        n = struct.unpack(">I", self.take(4))[0]
        return self.take(n).hex()[:200] if n else ""

    def r_status(self):
        c = self.r_i32()
        if c == 2 or c == 3 or 10 <= c < 100:
            return [c, self.r_line()]
        return [c, None]


LOG = []
CALLS = [0]


def rec(key, value, raw=None):
    entry = {"step": key, "value": value}
    if raw is not None and len(raw) < 4096:
        entry["hex"] = raw.hex()
    LOG.append(entry)
    print(key, "->", json.dumps(value)[:400], flush=True)


def cmd(w, key, name, *payload, reply):
    CALLS[0] += 1
    t0 = time.time()
    w.send(w.line(name), *payload)
    v = reply(w)
    rec(key, {"reply": v, "ms": round((time.time() - t0) * 1000, 1), "call": CALLS[0]}, w.raw)
    return v


def tree(kind):
    def read(w):
        n = w.r_i32()
        rows = []
        for _ in range(n):
            row = {}
            if kind == 3:
                row["five"] = w.r_i32()
            row["item"] = w.r_item()
            row["name"] = w.r_line()
            row["parent"] = w.r_item()
            if kind >= 2:
                row["expanded"] = w.r_i32()
            if kind >= 3:
                row["visible"] = w.r_i32()
            if kind == 4:
                row["loop"] = w.r_i32()
                row["list"] = w.r_line()
            rows.append(row)
        return [rows, w.r_status()]

    return read


ITEM = lambda w: [w.r_item(), w.r_status()]
STATUS = lambda w: [w.r_status()]
INT = lambda w: [w.r_i32(), w.r_status()]
LINE = lambda w: [w.r_line(), w.r_status()]
POSE = lambda w: [w.r_pose(), w.r_status()]
ARR = lambda w: [w.r_arr(), w.r_status()]


def launch():
    logf = open(os.path.join(OUT, "wpx1-robodk-stdout.log"), "w")
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


UR5E = "/workspace/src/AI/experiments/Robocraft/data/library/files/library-robots/UR5e.robot"
IRB120 = "/workspace/src/AI/experiments/Robocraft/data/library/files/library-robots/ABB-IRB-120-3-0-6.robot"


def param_all(w):
    out = {"poses": [w.r_pose(), w.r_pose(), w.r_pose()]}
    n = w.r_i32()
    out["n1"] = n
    out["joints1"] = [w.r_arr() for _ in range(n)]
    out["poses2"] = [w.r_pose(), w.r_pose()]
    n2 = w.r_i32()
    out["n2"] = n2
    out["joints2"] = [w.r_arr() for _ in range(n2)]
    out["a10"] = w.r_arr()
    out["aN"] = w.r_arr()
    return [out, w.r_status()]


def probe(w):
    ur = cmd(w, "Add.ur5e", "Add", w.line(UR5E), w.item(0), reply=ITEM)[0][0]
    abb = cmd(w, "Add.irb120", "Add", w.line(IRB120), w.item(0), reply=ITEM)[0][0]
    cmd(w, "G_RobotParamAll.ur5e", "G_RobotParamAll", w.item(ur), reply=param_all)
    cmd(w, "G_RobotParamAll.irb120", "G_RobotParamAll", w.item(abb), reply=param_all)
    cmd(w, "G_RobotParamAll.null", "G_RobotParamAll", w.item(0), reply=param_all)
    cmd(w, "UpdateKinematicsUR.zeros", "UpdateKinematicsUR", w.item(ur), w.mat(6, 4, [0] * 24), w.arr([]),
        reply=lambda w: [w.r_i32(), w.r_line(), w.r_arr(), w.r_arr(), w.r_status()])
    cmd(w, "G_RobotParamAll.ur5e.after", "G_RobotParamAll", w.item(ur), reply=param_all)
    cmd(w, "UpdateKinematicsUR.frame", "UpdateKinematicsUR", w.item(0), w.mat(6, 4, [0] * 24), w.arr([]),
        reply=lambda w: [w.r_i32(), w.r_line(), w.r_arr(), w.r_arr(), w.r_status()])
    cmd(w, "S_AbsAccParam.null", "S_AbsAccParam", w.item(0) + w.f64([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]) * 3 + w.i32(0) + w.f64([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]) * 2 + w.i32(0) + w.arr([]) + w.arr([]), reply=STATUS)
    cmd(w, "G_Thetas.ur5e", "G_Thetas", w.item(ur), reply=ARR)


proc = launch()
rec("launch", {"pid": proc.pid})
w = None
try:
    w = Wire(PORT)
    w.send(w.line("RDK_API"), w.arr([1, 0, 0]))
    rec("handshake", [w.r_line(), w.r_i32(), w.r_i32(), w.r_i32()])
    CALLS[0] += 1
    probe(w)
except Exception as exc:  
    rec("error", f"{type(exc).__name__}: {exc}")
finally:
    rec("api_calls", CALLS[0])
    with open(os.path.join(OUT, os.environ.get("WPX1_OUT", "wpx1-probe.json")), "w") as fh:
        json.dump(LOG, fh, indent=1)
    try:
        if w:
            w.s.close()
    except OSError:
        pass
    time.sleep(1.5)
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
    print("done", flush=True)
    os._exit(0)
