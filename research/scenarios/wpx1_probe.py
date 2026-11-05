# Probes raw protocol geometry, measurement, calibration and binary-export commands.









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


def probe(w):
    st = cmd(w, "Add.station", "Add", w.line(R540), w.item(0), reply=ITEM)
    robot = cmd(w, "G_Item2.robot", "G_Item2", w.line("KUKA KR 3 R540"), w.i32(2), reply=ITEM)[0][0]
    frame = cmd(w, "G_Item2.frame", "G_Item2", w.line("TubeType1-1"), w.i32(3), reply=ITEM)[0][0]
    cmd(w, "S_Frame_ptr", "S_Frame_ptr", w.item(frame), w.item(robot), reply=STATUS)
    prog = cmd(w, "G_Item2.pick", "G_Item2", w.line("Pick_TubeType1"), w.i32(8), reply=ITEM)[0][0]
    cmd(w, "G_ProgJointList.pick", "G_ProgJointList", w.item(prog), w.arr([1000, 1000, 0, 0, 0.1]), w.line(""),
        reply=lambda w: [w.r_mat(), w.r_i32(), w.r_line(), w.r_status()])
    cmd(w, "G_List_Items_Tree3", "G_List_Items_Tree3", reply=tree(3))
    cmd(w, "G_List_Items_WASM", "G_List_Items_WASM", reply=tree(4))
    for preset in (3, 1, 7, 0):
        cmd(w, f"G_ViewPose2.{preset}", "G_ViewPose2", w.i32(preset), reply=POSE)
    cmd(w, "G_ViewPose", "G_ViewPose", reply=POSE)
    cmd(w, "Proj2d3d.center", "Proj2d3d", w.i32(400), w.i32(300), reply=lambda w: [w.r_i32(), w.r_item(), w.r_f64(3), w.r_status()])
    cmd(w, "MeasLT2", "MeasLT2", w.f64([0, 0, 0]), w.i32(0), reply=ARR)
    cmd(w, "MeasPose4", "MeasPose4", w.arr([0, 0]), reply=lambda w: [w.r_pose(), w.r_arr(), w.r_status()])
    cmd(w, "MeasPose", "MeasPose", reply=lambda w: [w.r_pose(), w.r_pose(), w.r_i32(), w.r_i32(), w.r_i32(), w.r_i32(), w.r_status()])
    cmd(w, "S_Gen_Mat.frame", "S_Gen_Mat", w.item(frame), w.line("CALIB_TARGETS"), w.mat(1, 1, [0]), reply=STATUS)
    cmd(w, "S_ValueMat.frame", "S_ValueMat", w.item(frame), w.line("CALIB_TARGETS"), w.mat(1, 1, [0]), reply=lambda w: [w.r_mat(), w.r_status()])
    cmd(w, "BinSave.empty", "BinSave", w.line(""), w.item(0), reply=lambda w: [w.r_bytes(), w.r_status()])
    cmd(w, "RobotBin", "RobotBin", reply=lambda w: [(lambda a: [len(a), a[:12]])(w.r_arr()), w.r_status()])
    cmd(w, "CalibTCP.invalid", "CalibTCP", w.mat(3, 3, [0] * 9), w.i32(0), w.i32(0), reply=lambda w: [w.r_arr(), w.r_arr(), w.r_mat(), w.r_status()])
    rows = [[490, 120, 150, 0, 180, 0], [470, 120, 160, 20, 180, 0], [490, 140, 155, 0, 160, 10], [480, 110, 150, -15, 170, 30]]
    cmd(w, "CalibTCP.points", "CalibTCP", w.mat(6, 4, [v for r in rows for v in r]), w.i32(0), w.i32(0), reply=lambda w: [w.r_arr(), w.r_arr(), w.r_mat(), w.r_status()])
    cmd(w, "G_License", "G_License", reply=LINE)
    cmd(w, "S_Thetas2.mode2.out", "S_Thetas2", w.arr([0, -90, 90, 0, 0, 9999]), w.item(robot), w.i32(2), reply=INT)
    obj = cmd(w, "G_Item2.object", "G_Item2", w.line(""), w.i32(5), reply=ITEM)[0][0]
    cmd(w, "S_Gen_Str.display", "S_Gen_Str", w.item(obj), w.line("Display"), w.line("LINEW=4 POINTSIZE=6 COLOR=#ff0000"), reply=STATUS)
    cmd(w, "S_Gen_Str.unknown", "S_Gen_Str", w.item(obj), w.line("Colour"), w.line("x"), reply=STATUS)
    cmd(w, "AddShape.2x3", "AddShape", w.mat(2, 3, [0, 0, 1, 1, 2, 2]), w.item(0), reply=ITEM)
    cmd(w, "Copy.null", "Copy", w.item(0), reply=STATUS)
    cmd(w, "MakeProg.null", "MakeProg", w.item(0), w.line(""), reply=LINE)
    cmd(w, "InsCustom.null", "InsCustom", w.item(0), w.line("X"), w.line(""), w.line(""), w.i32(0), reply=STATUS)
    cmd(w, "FitAll", "FitAll", reply=STATUS)


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
    with open(os.path.join(OUT, "wpx1-probe.json"), "w") as fh:
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
