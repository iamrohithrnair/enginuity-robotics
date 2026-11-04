



import json
import socket
import struct
import sys

PORT = 20610
EVID = "/workspace/src/AI/experiments/Robocraft/research/evidence/spray/probe-geom.json"
PHASE = sys.argv[1]


class W:
    def __init__(self):
        self.s = socket.create_connection(("127.0.0.1", PORT), timeout=60)
        self.buf = b""
        self.raw = b""

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

    def line_(self):
        while b"\n" not in self.buf:
            self.buf += self.s.recv(65536)
        i = self.buf.index(b"\n")
        out, self.buf = self.buf[: i + 1], self.buf[i + 1 :]
        self.raw += out
        return out[:-1].decode()

    def i32(self):
        return struct.unpack(">i", self.take(4))[0]

    def item(self):
        return struct.unpack(">Q", self.take(8))[0], self.i32()

    def status(self):
        c = self.i32()
        if c in (2, 3) or 10 <= c < 100:
            return c, self.line_()
        return c, None


L = lambda t: (t + "\n").encode()
I = lambda v: struct.pack(">i", v)
H = lambda h: struct.pack(">Q", h)
D = lambda vs: b"".join(struct.pack(">d", float(v)) for v in vs)
A = lambda vs: I(len(vs)) + D(vs)
M = lambda r, c, d: I(r) + I(c) + D(d)


def pose(t, flip=True):
    rot = [[1, 0, 0], [0, -1, 0], [0, 0, -1]] if flip else [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
    m = [rot[0][0], rot[0][1], rot[0][2], t[0], rot[1][0], rot[1][1], rot[1][2], t[1], rot[2][0], rot[2][1], rot[2][2], t[2], 0, 0, 0, 1]
    return D([m[r * 4 + c] for c in range(4) for r in range(4)])


def tris(t):
    pts = [p for tri in t for p in tri]
    return M(3, len(pts), [v for p in pts for v in p])


PLATE = [[(-30, -150, 0), (270, -150, 0), (270, 150, 0)], [(-30, -150, 0), (270, 150, 0), (-30, 150, 0)]]
GUN = [[(0, 0, 0), (10, 0, 0), (0, 10, 0)]]

w = W()
w.send(L("RDK_API"), A([1, 0, 0]))
print(w.line_(), w.i32(), w.i32(), w.i32())

w.send(L("NewStation"), L("WPU Spray Check" if PHASE == "probe" else "WPU Spray Paint"))
print("NewStation", w.item(), w.status())
w.send(L("AddShape3"), tris(PLATE), H(0), I(0), A([0.78, 0.8, 0.84, 1]))
plate, _ = w.item()
w.status()
w.send(L("AddShape3"), tris(GUN), H(0), I(0), A([0.25, 0.25, 0.3, 1]))
gun, _ = w.item()
w.status()
w.send(L("S_Hlocal"), H(gun), pose((0, 0, 300)))
w.status()

if PHASE == "probe":
    rows = json.load(open(EVID))
    hexof = {r["step"]: r.get("hex") for r in rows}
    vol = [0] * 9 + [0, 0, 600, 200, 0, 600, 0, 100, 600]
    w.send(L("Gun_Add"), H(gun), H(plate), L("ELLYPSE PROJECT STEP=8x4 RAND=0 PARTICLE=SPHERE(5,8)"), M(9, 2, vol), M(0, 0, []))
    w.i32(), w.status()
    print("Gun_Add", w.raw.hex() == hexof["Gun_Add.ellipse"])

    def stats(key):
        w.send(L("Gun_Stats"), I(-1))
        w.line_()
        r, c = w.i32(), w.i32()
        w.take(8 * r * c)
        w.status()
        print(key, "matches RoboDK" if w.raw.hex() == hexof[key] else "DIFFERS " + w.raw.hex())

    stats("Gun_Stats.initial")
    w.send(L("Gun_SetState"), I(-1), I(1))
    w.i32(), w.status()
    stats("Gun_Stats.after_on")
    stats("Gun_Stats.second")
    w.send(L("G_Name"), H(plate))
    w.line_(), w.status()
    stats("Gun_Stats.after_G_Name")
    w2 = W()
    w2.send(L("RDK_API"), A([1, 0, 0]))
    w2.line_(), w2.i32(), w2.i32(), w2.i32()
    w2.s.close()
    stats("Gun_Stats.after_conn2")
    w.send(L("S_Hlocal"), H(gun), pose((200, 0, 300)))
    w.status()
    stats("Gun_Stats.after_move")
else:
    
    near = [0, 0, -200, 5, 0, -200, 0, 10, -200, 1, 0, 0, 1]
    far = [0, 0, 50, 60, 0, 50, 0, 120, 50, 0, 0, 1, 0.2]
    w.send(L("S_Hlocal"), H(gun), pose((120, -120, 30)))
    w.status()
    w.send(L("Gun_Add"), H(gun), H(plate), L("ELLYPSE PROJECT PARTICLE=SPHERE(4,8,1,1,0.5) STEP=8x8 RAND=2"), M(13, 2, near + far), M(0, 0, []))
    gid = w.i32()
    w.status()
    w.send(L("Gun_SetState"), I(gid), I(1))
    w.i32(), w.status()
    for k in range(25):
        w.send(L("S_Hlocal"), H(gun), pose((120 + (k % 2) * 40, -120 + k * 10, 30)))
        w.status()
    w.send(L("Gun_SetState"), I(-1), I(0))
    w.i32(), w.status()
    w.send(L("Gun_Stats"), I(-1))
    info = w.line_()
    r, c = w.i32(), w.i32()
    data = struct.unpack(">%dd" % (r * c), w.take(8 * r * c))
    print("stats", info, r, c, [round(v, 2) for v in data], w.status())
w.s.close()
