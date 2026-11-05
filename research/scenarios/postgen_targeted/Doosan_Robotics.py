# Defines Doosan probes for I/O values, blending, pauses and tool changes.
POST = "Doosan_Robotics"
NQ = 6
ROBOT = "Doosan Robotics A0509 White"
J = "[0,-10,20,0,30,0]"
MJ = "r.MoveJ(None,%s,None)" % J
EXPS = [("lines_x_prog_%s" % n, MJ, None, ", lines_x_prog=%s" % n) for n in [1, 3, 4, 100, -1, 0]]
EXPS += [
    ("io", "\n".join(["r.setDO(1,%s)" % v for v in ["True", "1.5", "'x'", "-1"]] + ["r.waitDI(1,%s)" % v for v in ["True", "'x'", "0.5"]]
                     + ["r.waitDI(1,1,0)", "r.waitDI(1,1,1234.5678)", "r.waitDI('V',0,10)", "r.setAO(1,'y')", "r.setAO('V',2)"])),
    ("blending", "\n".join(["r.setZoneData(5)", MJ, 'r.RunCode(r"""S1""", True)', "r.ProgFinish(r'''TgtProg''')", "r.ProgStart(r'''S1''')", MJ,
                            "r.setZoneData(-1)", MJ, "r.setZoneData(3)", "r.ProgFinish(r'''S1''')", "r.ProgStart(r'''S2''')", MJ])),
    ("blend_negative", "\n".join(["r.setZoneData(-1)", MJ, "r.setZoneData(-2)", MJ, "r.setZoneData(0)", MJ])),
    ("pauses", "\n".join("r.Pause(%s)" % v for v in [0, -1, 0.4, 1234.5])),
    ("calls", "\n".join('r.RunCode(r"""%s""", True)' % c for c in ["My Prog", "a b(c, d)", "x.y"]) + '\nr.RunCode(r"""raw code""")\nr.RunMessage(r"""m "q" """)\nr.RunMessage(r"""c""", True)'),
    ("tools", 'r.setTool(p(1,2,3,4,5,6),3,r"""My Tool-1""")\nr.setTool(p(1,2,3,4,5,6),-1,r"""""")\nr.setFrame(p(1,2,3,4,5,6),2,r"""F""")'),
    ("axes7", "r.MoveJ(None,[1,2,3,4,5,6,7],None)\nr.MoveL(p(1,2,3,4,5,6),[1,2,3,4,5,6,7],[0,0,0])", None, "", None, "RRRRRRT", 7),
    ("speeds", "r.setSpeed(0.0004)\nr.setSpeedJoints(1e6)\nr.setAcceleration(-1)\nr.setAccelerationJoints(12.3456)"),
]
