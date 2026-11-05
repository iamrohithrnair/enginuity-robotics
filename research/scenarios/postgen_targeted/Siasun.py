# Defines Siasun probes for I/O formatting, speed/zone settings and axis counts.
POST = "Siasun"
NQ = 6
ROBOT = "DUCO GCR10-1300"
P1 = "p(-607.85,543.849,363.215,150,50,-165)"
J = "[0,-10,20,0,30,0]"
EXPS = [
    ("outputs", "\n".join(["r.setDO(1,%s)" % v for v in ["'ON'", "'1'", "'2.5'", "1.5", "True", "-1", "1.0", "0.0", "False", "0", "1", "2", "' 1'"]]
                          + ["r.setDO('V','ON')", "r.setDO('V',0)", "r.setAO(1,'x')", "r.setAO(1,'2.5')", "r.setAO('V',1)", "r.setAO(2,-0.5)"])),
    ("inputs", "\n".join(["r.waitDI(1,'x',100)", "r.waitDI('V',0)", "r.waitDI(3,1,-1)"])),
    ("pauses", "\n".join("r.Pause(%s)" % v for v in [0, -1, 0.5, 2.5, 1.4999, 999.5, 1234.5])),
    ("calls", "\n".join('r.RunCode(r"""%s""", True)' % c for c in ["My Prog", "a b(c, d)", "x.y"]) + '\nr.RunCode(r"""raw(1, 2)""")'),
    ("messages", 'r.RunMessage(r"""q "x" y""")\nr.RunMessage(r"""c""", True)\nr.RunMessage(r"""""")'),
    ("axes7", "r.MoveJ(None,[1,2,3,4,5,6,7],None)\nr.MoveL(p(1,2,3,4,5,6),[1,2,3,4,5,6,7],[0,0,0])", None, "", None, "RRRRRRR", 7),
    ("axes4", "r.MoveJ(None,[1,2,3,4],None)\nr.MoveL(p(1,2,3,4,5,6),[1,2,3,4],[0,0,0])", None, "", None, "RRTR", 4),
    ("frames", 'r.setFrame(p(1,2,3,4,5,6),-1,r"""F""")\nr.setTool(p(1,2,3,4,5,6),3,r"""T""")\nr.MoveL(p(1,2,3,4,5,6),[1,2,3,4,5,6],[0,0,0])'),
    ("speeds", "\n".join(["r.setSpeed(%s)\nr.MoveL(%s,%s,[0,0,0])" % (v, P1, J) for v in [0.5, 1.5, 2.5, 99.5, 12345.678]]
                         + ["r.setSpeedJoints(%s)\nr.MoveJ(None,%s,None)" % (v, J) for v in [0.6, 0.59, 3, 37.5, 1000]]
                         + ["r.setAcceleration(2.5)", "r.setAccelerationJoints(3.5)", "r.setZoneData(0.5)", "r.MoveJ(None,%s,None)" % J, "r.MoveL(%s,%s,[0,0,0])" % (P1, J),
                            "r.MoveC(%s,%s,%s,%s,[0,0,0],[0,0,0])" % (P1, J, P1, J), "r.setZoneData(-3.5)", "r.MoveL(%s,%s,[0,0,0])" % (P1, J)])),
]
