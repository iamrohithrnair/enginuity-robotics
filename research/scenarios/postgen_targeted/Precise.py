
POST = "Precise"
NQ = 4
AXES = "RRTR"
ROBOT = "Brooks PreciseFlex 3400-1160"
J = "[10,-20,50,30]"
P1 = "p(-607.85,543.849,363.215,150,50,-165)"
EXPS = []
for ax, nq, j in [("TRRR", 4, "[50,10,-20,30]"), ("RRRT", 4, "[10,-20,30,50]"), ("RTRR", 4, "[10,50,-20,30]"), ("RRRR", 4, "[10,-20,30,50]"), ("TTT", 3, "[10,20,30]"),
                  ("RRR", 3, "[10,20,30]"), ("RRRRRR", 6, "[1,2,3,4,5,6]"), ("RRTRR", 5, "[1,2,3,4,5]"), ("TR", 2, "[1,2]"), ("RRTT", 4, "[1,2,3,4]"),
                  ("T", 1, "[250]"), ("RRRRRRR", 7, "[1,2,3,4,5,6,7]")]:
    EXPS.append(("axes_" + ax, "r.MoveJ(None,%s,None)" % j, None, "", None, ax, nq))
EXPS += [
    ("zones", "\n".join("r.setZoneData(%s)" % z for z in [5, 5, 0, -1, -0.5, 0.0001, 1e-9, 100, -100, -0.0])),
    ("waits", "\n".join(["r.waitDI(1,%s)" % v for v in ["1", "0", "'1'", "'x'", "'True'", "2", "-1", "True", "'on'"]]
                        + ["r.waitDI('V',1)", "r.waitDI(1,1,1000)", "r.waitDI(1,1,0)", "r.waitDI(1,'x',100)", "r.waitDI(1,0,1234.5)"])),
    ("outputs", "\n".join(["r.setDO(1,%s)" % v for v in ["1", "0", "'1'", "'x'", "'True'", "2", "-1", "True", "0.5"]]
                          + ["r.setDO('V',1)", "r.setDO('V','w')", "r.setAO(1,1)", "r.setAO('V','w')"])),
    ("speeds", "\n".join(["r.setSpeed(%s)" % v for v in [500, 499, 2.5, 5, 4.99, 5.01, 0, 499.8, 499.74, 0.25, 250.25, 250.75]]
                         + ["r.setSpeedJoints(%s)" % v for v in [720, 7.2, 7.19, 0, 45, 33.333]]
                         + ["r.setAcceleration(%s)" % v for v in [4000, 5000, 40, 39, 0, 4, 2000]]
                         + ["r.setAccelerationJoints(%s)" % v for v in [4000, 8000, 40, 20, 500]])),
    ("pauses", "\n".join("r.Pause(%s)" % v for v in [0, -1, -0.5, 0.04, 1, 1234.56, 100000, 500.0])),
    ("messages", "\n".join(['r.RunMessage(r"""%s""")' % m for m in ["a", 'q"q', ""]] + ['r.RunMessage(r"""%s""", True)' % m for m in ["c", ""]])),
    ("calls", "\n".join(['r.RunCode(r"""%s""", True)' % c for c in ["My Prog", "a b(c, d)", "x(1)", "N-W.D", "P 2 ()"]] + ['r.RunCode(r"""raw code(1, 2)""")'])),
    ("names", "\n".join(['r._TargetName=r"""My Target-1 (x)"""', "r.MoveJ(None,%s,None)" % J, 'r._TargetName=r"""My Target-1 (x)"""', "r.MoveJ(None,[1,2,3,4],None)",
                         'r._TargetName=r"""9lives"""', "r.MoveL(%s,%s,[0,0,0])" % (P1, J), "r.MoveL(%s,%s,[0,0,0])" % (P1, J), 'r._TargetName=r""""""',
                         "r.MoveJ(None,%s,None)" % J, 'r._TargetName=r"""9lives"""', "r.MoveJ(None,%s,None)" % J])),
    ("configs", "\n".join(["r.MoveJ(%s,%s,%s)" % (P1, J, c) for c in ["[0,0,0]", "[1,0,0]", "[0,1,0]", "[0,0,1]", "[1,1,1]"]]
                          + ["r.MoveL(%s,%s,%s)" % (P1, J, c) for c in ["[1,0,0]", "[0,1,1]"]])),
    ("frames", "\n".join(['r.setFrame(p(1,2,3,4,5,6),-1,r"""F""")', 'r.setTool(p(1,2,3,4,5,6),-1,r"""T""")', "r.MoveJ(None,%s,None)" % J,
                          "r.MoveL(%s,%s,[0,0,0])" % (P1, J), 'r.setTool(p(0,0,200,0,0,0),-1,r"""T2""")', "r.MoveL(%s,%s,[0,0,0])" % (P1, J)])),
    ("subprograms", "\n".join(["r.MoveJ(None,%s,None)" % J, 'r.RunCode(r"""S1""", True)', "r.ProgFinish(r'''TgtProg''')", "r.ProgStart(r'''S1''')",
                               "r.MoveL(%s,%s,[0,0,0])" % (P1, J), "r.waitDI(1,1,100)", "r.Pause(-1)", "r.ProgFinish(r'''S1''')", "r.ProgStart(r'''S2''')",
                               "r.ProgFinish(r'''S2''')"])),
]
