




import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from programs_probe_common import *  # noqa: E402,F403

RDK = connect()
RDK.Command("Popups", "0")
robot, frame, tool = new_station(RDK, "PP2")
J0 = [0, 0, 0, 0, 30, 0]
robot.setJoints(J0)
P0 = robot.Pose()
tr, rx, ry, rz = robomath.transl, robomath.rotx, robomath.roty, robomath.rotz
errs = []


def upd(moves, start=J0, pre=None, **kw):
    pass
    robot.setJoints(start)
    p = RDK.AddProgram("tp", robot)
    p.setPoseFrame(frame)
    p.setPoseTool(tool)
    if pre:
        pre(p)
    for kind, val in moves:
        if kind == "J":
            p.MoveJ(val)
        elif kind == "L":
            p.MoveL(val)
        elif kind == "C":
            p.MoveC(val[0], val[1])
        elif kind == "R":
            p.setRounding(val)
        elif kind == "P":
            p.Pause(val)
        elif kind == "S":
            p.setSpeed(*val)
        elif kind == "CALL":
            p.RunInstruction(val, robolink.INSTRUCTION_CALL_PROGRAM)
    u = p.Update(**kw)
    p.Delete()
    return u


def check(label, got, model):
    e = got - model
    errs.append(abs(e))
    print("%s: update=%.4f model=%.4f err=%.5f" % (label, got, model, e), flush=True)


def jt(name, joints):
    return joint_target(RDK, robot, frame, name, joints)


def ct(name, pose):
    return cart_target(RDK, robot, frame, name, pose)



step("T0.from_home_to_J0", lambda: upd([("J", jt("tJ0", J0))], start=[0, 0, 0, 0, 0, 0]))
check("T0.from_home_to_J0(time)", upd([("J", jt("tJ0b", J0))], start=[0, 0, 0, 0, 0, 0])[1], trap(30, 200, 150))
step("T0.already_at_J0", lambda: upd([("J", jt("tJ0c", J0))]))


for d in [1, 2, 5, 10, 20, 45, 90]:
    j = list(J0); j[0] += d
    check("T1.MoveJ_J1+%g" % d, upd([("J", jt("a", j))])[1], trap(d, 200, 150))
for d in [100, 200, 300, 390]:
    j = list(J0); j[5] += d
    check("T1.MoveJ_J6+%g" % d, upd([("J", jt("b", j))])[1], trap(d, 200, 150))

for ax in range(6):
    j = list(J0); j[ax] += 10
    check("T2.MoveJ_axis%d+10" % (ax + 1), upd([("J", jt("c", j))])[1], trap(10, 200, 150))
check("T2.MoveJ_J1+90_J2+30", upd([("J", jt("d", [90, 30, 0, 0, 30, 0]))])[1], trap(90, 200, 150))
check("T2.MoveJ_J1+90_J2+30_J4-90_J6+90", upd([("J", jt("e", [90, 30, 0, -90, 30, 90]))])[1], trap(90, 200, 150))
step("T2.distance_is_tcp_path_mm(J1+90)", lambda: upd([("J", jt("f", [90, 0, 0, 0, 30, 0]))])[2])


for d in [1, 10, 50, 100, 200]:
    u = upd([("L", ct("g", P0 * tr(0, d, 0)))])
    check("T3.MoveL_%gmm" % d, u[1], trap(d, 1000, 1500))
    step("T3.MoveL_%gmm.distance" % d, lambda u=u: u[2])


for vj, aj in [(30, 100), (100, 1000), (10, 50)]:
    robot.setSpeed(-1, vj, -1, aj)
    for d in [5, 20, 90]:
        check("T4.robot(vj=%g,aj=%g).MoveJ_J1+%g" % (vj, aj, d), upd([("J", jt("h", [d, 0, 0, 0, 30, 0]))])[1], trap(d, vj, aj))
robot.setSpeed(-1, 200, -1, 150)
for v, a in [(100, 200), (50, 1000), (250, 500), (1000, 1e6)]:
    robot.setSpeed(v, -1, a, -1)
    for d in [10, 100]:
        check("T4.robot(v=%g,a=%g).MoveL_%gmm" % (v, a, d), upd([("L", ct("i", P0 * tr(0, d, 0)))])[1], trap(d, v, a))
robot.setSpeed(-1, 1e6 if False else -1, -1, 1e6)
check("T4.robot(aj=1e6).MoveJ_J1+90 -> vj=200", upd([("J", jt("k", [90, 0, 0, 0, 30, 0]))])[1], trap(90, 200, 1e6))
robot.setSpeed(1000, 200, 1500, 150)


L100 = ct("L100", P0 * tr(0, 100, 0))
check("T5.prog(setSpeed 50)+MoveL100, before run", upd([("S", (50,)), ("L", L100)])[1], trap(100, 1000, 1500))
check("T5.prog(setSpeed -1,10,-1,10)+MoveJ90", upd([("S", (-1, 10, -1, 10)), ("J", jt("m", [90, 0, 0, 0, 30, 0]))])[1], trap(90, 200, 150))
RDK.setSimulationSpeed(50)
robot.setJoints(J0)
runp = RDK.AddProgram("RunSpeed", robot)
runp.setPoseFrame(frame); runp.setPoseTool(tool)
runp.setSpeed(50, -1, 400, -1)
runp.MoveL(L100)
runp.RunCode(); wait_done(runp)
check("T5.after running a program with setSpeed(50, accel 400): plain MoveL100", upd([("L", L100)])[1], trap(100, 50, 400))
robot.setSpeed(1000, 200, 1500, 150)
check("T5.after robot.setSpeed(1000,200,1500,150): plain MoveL100", upd([("L", L100)])[1], trap(100, 1000, 1500))


for lab, pose in [("rotz45", P0 * rz(math.radians(45))), ("rotz90", P0 * rz(math.radians(90))),
                  ("rotx10", P0 * rx(math.radians(10))), ("roty30", P0 * ry(math.radians(30)))]:
    jend = robot.SolveIK(pose, J0, tool.PoseTool(), frame.Pose()).list()
    dj = max(abs(a - b) for a, b in zip(jend, J0))
    check("T6.MoveL_%s(max dJ=%.3f)" % (lab, dj), upd([("L", ct("n", pose))])[1], trap(dj, 200, 150))
for dy in [0.001, 0.0011, 0.01, 1.0, 100.0]:
    got = upd([("L", ct("o", P0 * tr(0, dy, 0) * rz(math.radians(90))))])[1]
    model = trap(90, 200, 150) if dy <= 0.001 else trap(dy, 1000, 1500)
    check("T6.MoveL_dy=%g_plus_rotz90" % dy, got, model)


A = ct("A", P0 * tr(0, 50, 0)); B = ct("B", P0 * tr(50, 100, 0)); C = ct("C", P0 * tr(0, 150, 0))
u = upd([("L", A), ("C", (B, C))])
check("T7.MoveL50+MoveC_semicircle_r50", u[1], trap(50, 1000, 1500) + trap(math.pi * 50, 1000, 1500))
step("T7.distance", lambda: u[2])


sq = [ct("s1", P0 * tr(0, 100, 0)), ct("s2", P0 * tr(100, 100, 0)), ct("s3", P0 * tr(100, 0, 0)), ct("s4", P0)]
for rnd in [-1, 5, 50]:
    check("T8.square_400mm_rounding_%g" % rnd, upd([("R", rnd)] + [("L", s) for s in sq])[1], 4 * trap(100, 1000, 1500))


for pz in [500, 1234, 0, -1]:
    check("T9.MoveL100+Pause(%g)" % pz, upd([("L", L100), ("P", pz)])[1], trap(100, 1000, 1500) + max(pz, 0) / 1000.0)


sub = RDK.AddProgram("SubT", robot)
sub.MoveJ(jt("sj", [45, 0, 0, 0, 30, 0]))
u = upd([("CALL", "SubT")])
step("T10.prog_with_call.Update", lambda: u)
check("T10.call_time", u[1], trap(45, 200, 150))
u = upd([("CALL", "NoSuchProgram")])
step("T10.prog_with_missing_call.Update", lambda: u)


for kw in [dict(), dict(mm_step=1, deg_step=1), dict(mm_step=50, deg_step=20)]:
    step("T11.Update(%s).time" % kw, lambda kw=kw: upd([("J", jt("p", [90, 0, 0, 0, 30, 0])), ("L", ct("q", P0 * tr(0, 100, 0)))], **kw)[1])


ur, fur, tur = new_station(RDK, "PP2b", UR5E)
JU = [0, -60, 60, 0, 30, 0]
ur.setJoints(JU)
PU = ur.Pose()


def upd_ur(kind, val):
    ur.setJoints(JU)
    p = RDK.AddProgram("tu", ur)
    p.setPoseFrame(fur); p.setPoseTool(tur)
    t = RDK.AddTarget("u", fur, ur)
    if kind == "J":
        ur.setJoints(val); t.setPose(ur.Pose()); t.setJoints(val); t.setAsJointTarget(); ur.setJoints(JU)
        p.MoveJ(t)
    else:
        t.setPose(val)
        p.MoveL(t)
    u = p.Update(); p.Delete(); t.Delete()
    return u[1]


check("T12.UR5e.MoveJ_J1+10 (aj=400)", upd_ur("J", [10, -60, 60, 0, 30, 0]), trap(10, 200, 400))
check("T12.UR5e.MoveJ_J1+90 (aj=400)", upd_ur("J", [90, -60, 60, 0, 30, 0]), trap(90, 200, 400))
check("T12.UR5e.MoveL_50mm (a=2000)", upd_ur("L", PU * tr(0, 0, 50)), trap(50, 1000, 2000))
ur.setSpeed(-1, -1, 1e6, 1e6)
check("T12.UR5e.MoveJ_J1+90 huge accel -> vj=200", upd_ur("J", [90, -60, 60, 0, 30, 0]), trap(90, 200, 1e6))
check("T12.UR5e.MoveL_50mm huge accel -> v=1000", upd_ur("L", PU * tr(0, 0, 50)), trap(50, 1000, 1e6))

print("SUMMARY: cases=%d max_abs_err_s=%.5f" % (len(errs), max(errs)), flush=True)
RDK.setSimulationSpeed(5)
RDK.Disconnect()
print("done", flush=True)
