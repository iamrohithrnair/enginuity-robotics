
POST = "Epson_RC"
NQ = 6
ROBOT = "Epson C12XL-A1401"
P1 = "p(-607.85,543.849,363.215,150,50,-165)"
J = "[0,-10,20,0,30,0]"
EXPS = [
    ("ids", 'r.setFrame(p(1,2,3,4,5,6),3,r"""F3""")\nr.setTool(p(1,2,3,4,5,6),5,r"""T5""")\nr.MoveL(%s,%s,[0,0,0])\nr.setFrame(p(1,2,3,4,5,6),-1,r"""F""")\n'
     'r.MoveL(%s,%s,[0,0,0])\nr.setFrame(p(1,2,3,4,5,6),0,r"""F0""")\nr.setTool(p(1,2,3,4,5,6),0,r"""T0""")\nr.MoveL(%s,%s,[0,0,0])' % (P1, J, P1, J, P1, J)),
    ("no_frame", "r.MoveL(%s,%s,[0,0,0])\nr.MoveL(None,%s,None)" % (P1, J, J)),
    ("zones", "\n".join("r.setZoneData(%s)\nr.MoveJ(None,%s,None)\nr.MoveL(None,%s,None)" % (z, J, J) for z in [0.0001, 0, -1, 1e-9, 5])),
    ("speeds", "r.setAcceleration(800)\nr.setAccelerationJoints(55.555)\nr.setSpeedJoints(1000)\nr.setSpeed(0.001)\nr.setSpeed(12.345)"),
    ("pauses", "\n".join("r.Pause(%s)" % v for v in [-1, -5, 0, 0.0004, 0.0005, 1234.5678])),
    ("inputs", "\n".join(["r.waitDI(1,1,0)", "r.waitDI(1,1,1234.56)", "r.waitDI(1,2)", "r.waitDI(1,-1)", "r.waitDI(1,True)", "r.waitDI('V','x',5)", "r.waitDI(1,0.5)"])),
    ("outputs", "\n".join(["r.setDO(1,%s)" % v for v in ["2", "-1", "0.5", "'x'", "True", "False", "0.0"]] + ["r.setAO(1,%s)" % v for v in ["0", "-2", "'y'"]] + ["r.setDO('V',1)"])),
    ("calls", "\n".join('r.RunCode(r"""%s""", True)' % c for c in ["My Prog", "a b(c, d)", "x.y"]) + '\nr.RunCode(r"""raw code 1""")'),
    ("messages", 'r.RunMessage(r"""q "x" y""")\nr.RunMessage(r"""c""", True)'),
    ("subprograms", "\n".join(["r.MoveJ(None,%s,None)" % J, 'r.RunCode(r"""S1""", True)', "r.ProgFinish(r'''TgtProg''')", "r.ProgStart(r'''S1''')",
                               "r.MoveL(%s,%s,[0,0,0])" % (P1, J), "r.ProgFinish(r'''S1''')", "r.ProgStart(r'''S2''')", "r.ProgFinish(r'''S2''')"])),
    ("axes7", "r.MoveL(%s,[1,-2,3,4,5,6,7],[0,0,0])\nr.MoveJ(None,[1,-2,3,4,5,6,7],None)" % P1, None, "", None, "RRRRRRR", 7),
    ("axes5", "r.MoveL(%s,[10,-20,50,30,4],[0,0,0])" % P1, None, "", None, "RRTRR", 5),
    ("axes3", "r.MoveL(%s,[10,-20,50],[0,0,0])" % P1, None, "", None, "RRT", 3),
    ("hand_conf", 'r.setFrame(p(1,2,3,4,5,6),2,r"""F""")\nr.setZoneData(1)\nr.MoveL(%s,[10,-20,50,30],[1,1,1])\nr.MoveL(%s,[10,20,50,30],[0,0,0])' % (P1, P1), None, "", None, "RRTR", 4),
]
for j2 in ["0", "-0.0", "1e-9", "-1e-9", "-180", "200"]:
    EXPS.append(("hand_%s" % j2, "r.MoveL(%s,[10,%s,50,30],[0,0,0])\nr.MoveC(%s,[10,%s,50,30],%s,[10,%s,50,30],[0,0,0],[0,0,0])" % (P1, j2, P1, j2, P1, j2), None, "", None, "RRTR", 4))
