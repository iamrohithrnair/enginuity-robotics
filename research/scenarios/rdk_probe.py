#!/usr/bin/env python3








import argparse
import struct
import zlib

TYPES = {1: "station", 2: "robot", 3: "frame", 4: "tool", 5: "object", 6: "target", 7: "curve", 8: "program",
         9: "instruction", 10: "python", 11: "machining", 16: "object*", 17: "folder", 22: "notes"}

ap = argparse.ArgumentParser()
ap.add_argument("file")
ap.add_argument("--records", type=int, default=60)
ap.add_argument("--instructions", action="store_true")
ns = ap.parse_args()

data = open(ns.file, "rb").read()
if len(data) > 6 and data[4] == 0x78:
    data = zlib.decompress(data[4:])
b = data


def qstr(o):
    n = struct.unpack_from("<I", b, o)[0]
    if n == 0xFFFFFFFF:
        return None, o + 4
    return b[o + 4:o + 4 + n].decode("utf-16-le", "replace"), o + 4 + n


def header_name(p):
    rows = int(struct.unpack_from("<d", b, p + 16)[0])
    s = ""
    for k in range(100):
        v = struct.unpack_from("<d", b, p + 8 * (90 * rows + k))[0]
        if v <= 0:
            break
        s += chr(int(v))
    return s


def name_of(typ, p, end):
    if p == end:
        return ""
    try:
        if typ == 1:
            return qstr(p + 1)[0]
        if typ == 3:
            return qstr(qstr(p)[1])[0]
        if typ in (2, 4, 5, 16):
            return header_name(p)
        return qstr(p)[0]
    except (struct.error, UnicodeDecodeError, ValueError):
        return "?"


head, o = qstr(0)
print("header:", head, "stream bytes:", len(b))
records = []
while True:
    tag, o2 = qstr(o)
    if tag != "lvl":
        break
    typ, depth, end = struct.unpack_from("<iiq", b, o2)
    records.append((len(records), typ, depth, o2 + 16, end))
    o = end
print("records:", len(records))
for i, typ, depth, p, end in records[:ns.records]:
    print(f"{i:4d} {'  ' * depth}{TYPES.get(typ, typ)} {name_of(typ, p, end)!r} ({end - p} bytes)")

if ns.instructions:
    for i, typ, depth, p, end in records:
        if typ != 8:
            continue
        name, q = qstr(p)
        _, q = qstr(q)
        q += 5
        robot, count = struct.unpack_from("<ii", b, q)
        q += 8
        print(f"program {name!r} robot_ref={robot} instructions={count}")
        for _ in range(count):
            _, q = qstr(q)  
            idx, ityp, iend = struct.unpack_from("<iiq", b, q)
            q += 16
            label, r = qstr(q)
            fields = ""
            if ityp == 0:
                move_type, mode = struct.unpack_from("<ii", b, r)
                fields = f"move_type={move_type} " + (f"target_ref={struct.unpack_from('<i', b, r + 8)[0]}" if mode == 1 else "embedded target")
            elif ityp in (3, 4):
                fields = f"ref={struct.unpack_from('<i', b, r)[0]}"
            elif ityp in (6, 10):
                fields = f"value={struct.unpack_from('<d', b, r)[0]}"
            elif ityp == 8:
                fields = f"code_type={struct.unpack_from('<i', b, r)[0]} text={qstr(r + 4)[0]!r}"
            print(f"   [{idx}] type {ityp} {label!r} {fields}")
            q = iend
