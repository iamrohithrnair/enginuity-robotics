# Defines URP probes for named waypoints, move grouping and program-size limits.

POST = "Universal_Robots_URP"
NQ = 6
ROBOT = "UR10"
J = "[0,-10,20,0,30,0]"
J2 = "[10,-10,20,0,30,5]"
JN = "r.MoveJ(None,[10,-10,20,0,30,0],None)"


def P(x, y, z, a=150, b=50, c=-165):
    return "p(%r,%r,%r,%r,%r,%r)" % (x, y, z, a, b, c)


def L(x, y, z):
    return "r.MoveL(%s,%s,[0,0,0])" % (P(x, y, z), J)


def MJ(x, y, z):
    return "r.MoveJ(%s,%s,[0,0,0])" % (P(x, y, z), J2)


def MC(v, e):
    return "r.MoveC(%s,%s,%s,%s,[0,0,0],[0,0,0])" % (P(*v), J, P(*e), J)


X0, Y0, Z0 = -640.0, 500.0, 370.0
TOOL = "r.setTool(p(0,0,100,0,0,0),-1,r\"\"\"T\"\"\")"

EXPS = [
    
    ("jblend", "\n".join(["r.setZoneData(5)", MJ(X0, Y0, Z0), MJ(X0 + 50, Y0, Z0), L(X0 + 100, Y0, Z0), L(X0 + 100, Y0 + 50, Z0), MJ(X0, Y0 + 50, Z0), JN, L(X0, Y0, Z0), L(X0 + 10, Y0, Z0)])),
    
    ("named", "\n".join([L(X0, Y0, Z0), 'r._TargetName=r"""MyTarget_1"""', L(X0 + 50, Y0, Z0), L(X0 + 100, Y0, Z0), 'r._TargetName=r"""JT"""', MJ(X0, Y0, Z0), MJ(X0 + 10, Y0, Z0)])),
    
    ("group", "\n".join([TOOL, L(X0, Y0, Z0), "r.setSpeed(100)", L(X0 + 50, Y0, Z0), "r.setSpeed(100)", L(X0 + 100, Y0, Z0), "r.setAcceleration(500)", L(X0 + 100, Y0 + 50, Z0), 'r.RunMessage(r"""note""",True)', L(X0, Y0 + 50, Z0), "r.MoveL(None,%s,None)" % J2, L(X0, Y0, Z0), "r.setZoneData(2)", L(X0 + 50, Y0, Z0), "r.setSpeedJoints(20)", L(X0 + 100, Y0, Z0)])),
    
    ("cfirst", "\n".join([MC((X0 + 50, Y0 + 20, Z0), (X0 + 100, Y0, Z0)), JN, MC((X0 + 50, Y0 + 20, Z0), (X0 + 100, Y0, Z0)), L(X0, Y0, Z0), MC((X0 + 50, Y0 + 20, Z0), (X0 + 100, Y0, Z0))])),
    
    ("io", "\n".join(["r.setDO(12,1)", "r.setDO(25,'true')", "r.setDO(3,'False')", "r.setDO(4,-1)", "r.waitDI(15,1)", "r.waitDI(22,'off')", "r.setAO(2,0.5)", "r.setAO(5,0)", 'r.RunCode(r"""Call_A""", True)', 'r.RunCode(r"""Call_B""", True)', 'r.RunCode(r"""Call_A""", True)'])),
    
    ("lines_big", "\n".join([L(X0, Y0, Z0), L(X0 + 10, Y0, Z0)]), None, ", lines_x_prog=50"),
    ("lines_small", "\n".join([L(X0, Y0, Z0), L(X0 + 10, Y0, Z0), L(X0 + 20, Y0, Z0)]), None, ", lines_x_prog=2"),
    ("lines_sub", "\n".join([L(X0, Y0, Z0), 'r.RunCode(r"""Sub2""", True)', 'r.ProgFinish(r"""TgtProg""")', 'r.ProgStart(r"""Sub2""")', L(X0 + 10, Y0, Z0), L(X0 + 20, Y0, Z0), L(X0 + 30, Y0, Z0), 'r.ProgFinish(r"""Sub2""")']), None, ", lines_x_prog=2"),
    
    ("lines_long", "\n".join(['r.setFrame(p(1234.57,-98.7654,50.5,30,0,0),-1,r"""Frame S""")', 'r.setTool(p(10,20,150,0,0,0),-1,r"""Tool S""")'] + ["r.MoveJ(p(-640.584,506.98,371.534,150,50,-165),[0,-10,20,0,30,3.13389e-14],[0,0,0])", "r.MoveJ(None,[20,-10,20,0,30,0],None)"] * 6), None, ", lines_x_prog=5"),
    ("lines_long_none", "\n".join(['r.setFrame(p(1234.57,-98.7654,50.5,30,0,0),-1,r"""Frame S""")', 'r.setTool(p(10,20,150,0,0,0),-1,r"""Tool S""")'] + ["r.MoveJ(p(-640.584,506.98,371.534,150,50,-165),[0,-10,20,0,30,3.13389e-14],[0,0,0])", "r.MoveJ(None,[20,-10,20,0,30,0],None)"] * 6)),
    
    ("misc", "\n".join(["r.Pause(0.4)", "r.Pause(0.6)", 'r.RunMessage(r"""a <b> & "c" """)', 'r.RunMessage(r"""x <y> & \'z\'""",True)', "r.setSpeed(5)", "r.setAcceleration(50000)", "r.setAccelerationJoints(5000)", L(X0, Y0, Z0), MJ(X0, Y0, Z0)])),
    
]
for _n in (3, 4, 5, 6, 7):
    EXPS.append(("lim5_jn%d" % _n, "\n".join([JN] * _n), None, ", lines_x_prog=5"))
    EXPS.append(("lim5_l%d" % _n, "\n".join([L(X0 + 10 * i, Y0, Z0) for i in range(_n)]), None, ", lines_x_prog=5"))
EXPS.append(("lim5_msg6", "\n".join(['r.RunMessage(r"""m""",True)'] * 6), None, ", lines_x_prog=5"))
EXPS.append(("lim5_wait6", "\n".join(["r.Pause(10)"] * 6), None, ", lines_x_prog=5"))
for _n in (9, 10):
    EXPS.append(("lim5_jn%d" % _n, "\n".join([JN] * _n), None, ", lines_x_prog=5"))
EXPS.append(("lim2_jn1", JN, None, ", lines_x_prog=2"))
EXPS.append(("lim5_wait_jn", "r.waitDI(1,1)\n" + JN, None, ", lines_x_prog=5"))
EXPS.append(("lim5_sub", "\n".join([JN, JN, 'r.RunCode(r"""Sub2""", True)', 'r.ProgFinish(r"""TgtProg""")', 'r.ProgStart(r"""Sub2""")', JN, JN, JN, 'r.ProgFinish(r"""Sub2""")']), None, ", lines_x_prog=5"))
EXPS.append(("unnamed", "\n".join([L(X0, Y0, Z0), 'r._TargetName=r"""Named"""', L(X0 + 10, Y0, Z0), "r._TargetName=None", L(X0 + 20, Y0, Z0)])))
EXPS.append(("params", "\n".join(["r.setSpeed(123.456)", L(X0, Y0, Z0), "r.setSpeedJoints(33.333)", L(X0 + 10, Y0, Z0), "r.setAccelerationJoints(77.7)", L(X0 + 20, Y0, Z0), "r.setAcceleration(1234.5)", L(X0 + 30, Y0, Z0), "r.setZoneData(12.5)", "r.setAcceleration(10)", L(X0 + 40, Y0, Z0), L(X0 + 50, Y0, Z0), "r.setSpeedJoints(400)", "r.setZoneData(0.3)", L(X0 + 60, Y0, Z0)])))
