
POST = "Toshiba"
NQ = 4
AXES = "RRTR"
ROBOT = "Shibaura Machine THE1000"
P1 = "p(-607.85,543.849,363.215,150,50,-165)"
EXPS = [
    ("speeds", "\n".join("r.setSpeed(%s)" % v for v in [6000, 7500, 12345, 12399.99, 5000.01, 100000, -10]) + "\nr.setSpeedJoints(10)\nr.setAcceleration(5)\nr.setZoneData(3)"),
    ("hands", "\n".join("r.MoveL(%s,[10,%s,50,30],[0,0,0])" % (P1, j2) for j2 in ["0", "-0.0", "1e-9", "-1e-9", "200"])),
    ("angles", "\n".join("r.MoveL(p(1,2,3,%s),[1,2,3,4],[0,0,0])" % a for a in ["0,0,0", "180,0,0", "-90,0,0", "0,90,0", "0,0,180", "45,45,45", "-179.9999,0,0"])
     + '\nr.setFrame(p(1,2,3,-120,10,20),-1,r"""F""")\nr.setTool(p(1,2,3,0,-180,0),-1,r"""T""")'),
    ("io", "\n".join(["r.setDO(1,%s)" % v for v in ["2", "-1", "0.5", "'x'", "True"]] + ["r.setDO('V',0)", "r.setAO(2,0)", "r.setAO('A','y')"]
                     + ["r.waitDI(1,%s)" % v for v in ["2", "-1", "'x'"]] + ["r.waitDI(1,1,0)", "r.waitDI('V',0,1234.56)"])),
    ("pauses", "\n".join("r.Pause(%s)" % v for v in [0, -1, 0.4, 1234.5])),
    ("calls", "\n".join('r.RunCode(r"""%s""", True)' % c for c in ["My Prog", "a b(c, d)", "x.y"]) + '\nr.RunCode(r"""raw code""")\nr.RunMessage(r"""m "q" """)\nr.RunMessage(r"""c""", True)'),
    ("joint_targets", "r.MoveL(None,[1,2,3,4],None)\nr.MoveC(None,[1,2,3,4],None,[5,6,7,8],None,None)\nr.MoveC(%s,[1,-2,3,4],None,[5,6,7,8],[0,0,0],None)" % P1),
    ("axes6", "r.MoveL(%s,[1,-2,3,4,5,6],[0,0,0])\nr.MoveJ(None,[1,2,3,4,5,6],None)" % P1, None, "", None, "RRRRRR", 6),
    ("axes3", "r.MoveL(%s,[1,-2,3],[0,0,0])\nr.MoveJ(None,[1,2,3],None)" % P1, None, "", None, "RRT", 3),
]
