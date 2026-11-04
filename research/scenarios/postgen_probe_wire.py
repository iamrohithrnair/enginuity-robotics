






import socket
import struct
import sys
import time

PORT = int(sys.argv[1])
ROBOT_FILE = sys.argv[2]


class Conn:
    def __init__(self, label):
        self.label = label
        self.s = socket.create_connection(("127.0.0.1", PORT), timeout=5)

    def send(self, b):
        self.s.sendall(b)

    def line(self, text):
        self.send(text.encode() + b"\n")

    def i32(self, v):
        self.send(struct.pack(">i", v))

    def item(self, h):
        self.send(struct.pack(">Q", h))

    def arr(self, vals):
        self.send(struct.pack(">i", len(vals)) + struct.pack(">%dd" % len(vals), *vals))

    def pose(self, rows):  
        self.send(struct.pack(">16d", *[rows[r][c] for c in range(4) for r in range(4)]))

    def recv_exact(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.s.recv(n - len(buf))
            if not chunk:
                raise EOFError("closed")
            buf += chunk
        return buf

    def rline(self):
        buf = b""
        while True:
            c = self.recv_exact(1)
            if c == b"\n":
                return buf.decode()
            buf += c

    def ri32(self):
        return struct.unpack(">i", self.recv_exact(4))[0]

    def ritem(self):
        h = struct.unpack(">Q", self.recv_exact(8))[0]
        return h, self.ri32()

    def status(self):
        st = self.ri32()
        if st in (2, 3) or 10 <= st < 100:
            return st, self.rline()
        return st, None

    def drain(self, wait=1.5):
        self.s.settimeout(wait)
        try:
            data = self.s.recv(4096)
            return data
        except socket.timeout:
            return None
        finally:
            self.s.settimeout(5)

    def hello(self, flags=(1.0, 0.0, 0.0)):
        self.line("RDK_API")
        self.arr(list(flags))
        return self.rline(), self.ri32(), self.ri32(), self.status()


def show(label, fn):
    try:
        print(f"{label}: {fn()!r}", flush=True)
    except Exception as exc:
        print(f"{label}: ERROR {type(exc).__name__}: {exc}", flush=True)


A = Conn("A")
show("A.hello", lambda: A.hello())
A.line("Version")
show("A.version", lambda: (A.rline(), A.ri32(), A.rline(), A.rline(), A.status()))


L = Conn("L")
L.line("CMD_START")
L.line("1 0")
show("L.legacy_reply", lambda: L.rline())
show("L.extra_bytes", lambda: L.drain(0.5))
L.line("G_Item")
L.line("")
show("L.G_Item_empty_name", lambda: (L.ritem(), L.status()))


U = Conn("U")
U.line("HELLO")
show("U.reply_within_1.5s", lambda: U.drain())
U.line("RDK_API")
U.arr([1.0, 0.0, 0.0])
show("U.after_bad_hello_reply", lambda: U.drain())


A.line("NewStation")
A.line("WireProbe")
show("A.new_station", lambda: (A.ritem(), A.status()))
A.line("Add")
A.line("/nonexistent/file.robot")
A.item(0)
show("A.add_missing_file", lambda: (A.ritem(), A.status()))
A.line("Add")
A.line(ROBOT_FILE)
A.item(0)
robot = A.ritem()
show("A.add_robot", lambda: (robot, A.status()))
A.line("G_Name")
A.item(0x1234560)
show("A.G_Name_invalid_handle", lambda: (A.drain(),))
A.line("G_Name")
A.item(0)
show("A.G_Name_null_handle", lambda: (A.drain(),))
A.line("G_Name")
A.item(robot[0])
show("A.G_Name_robot", lambda: (A.rline(), A.status()))
A.line("S_Thetas")
A.arr([0, 0, 0, 0, 0, 9999])
A.item(robot[0])
show("A.S_Thetas_out_of_limits", lambda: A.status())
A.line("S_Thetas")
A.arr([1, 2])
A.item(robot[0])
show("A.S_Thetas_too_few", lambda: A.status())
A.line("G_Param")
A.line("NoSuchParam")
show("A.G_Param_unknown", lambda: (A.rline(), A.status()))
A.line("G_Item2")
A.line("ABB IRB 120-3/0.6")
A.i32(2)
show("A.G_Item2_robot", lambda: (A.ritem()[1], A.status()))


S = Conn("S")
show("S.hello_skipstatus", lambda: S.hello((1.0, 0.0, 1.0)))
S.line("S_Name")
S.item(robot[0])
S.line("Renamed By S")
show("S.S_Name_reply_bytes", lambda: S.drain())
S.line("G_Name")
S.item(robot[0])
show("S.G_Name", lambda: (S.rline(), S.status()))


B = Conn("B")
show("B.hello", lambda: B.hello())
A.line("G_Name")
A.item(robot[0])
B.line("G_Name")
B.item(robot[0])
show("B.G_Name", lambda: (B.rline(), B.status()))
show("A.G_Name", lambda: (A.rline(), A.status()))


X = Conn("X")
show("X.hello", lambda: X.hello())
X.line("NoSuchCommand")
show("X.unknown_cmd_bytes_within_1.5s", lambda: X.drain())
t0 = time.time()
X.line("Version")
X.s.settimeout(30)
def after_unknown():
    first = X.recv_exact(1)
    dt = round(time.time() - t0)
    return dt, first
show("X.first_byte_after_Version_s", after_unknown)
X.s.settimeout(5)
X.line("Version")
show("X.version_second_try", lambda: (X.rline(), X.ri32(), X.rline(), X.rline(), X.status()))

for c in (A, L, U, S, B, X):
    c.s.close()
print("done", flush=True)
