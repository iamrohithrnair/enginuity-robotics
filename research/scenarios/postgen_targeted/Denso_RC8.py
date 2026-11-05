# Defines Denso RC8 probes for frame IDs, axis counts and motion/I/O formatting.
POST = "Denso_RC8"
NQ = 6
ROBOT = "Denso Cobotta PRO 900"
P1="p(-607.85,543.849,363.215,150,50,-165)"
J="[0,-10,20,0,30,0]"
ML="r.MoveL(%s,%s,[0,0,0])" % (P1, J)
EXPS=[("ids", 'r.setFrame(p(1,2,3,4,5,6),5,r"""F""")\nr.setTool(p(1,2,3,4,5,6),7,r"""T""")\nr.setFrame(p(1,2,3,4,5,6),0,r"""F""")\nr.setTool(p(1,2,3,4,5,6),0,r"""T""")')]
EXPS += [("zones", "\n".join("r.setZoneData(%s)\n%s" % (z, ML) for z in [1e-9, 0, -1, 100]))]
EXPS += [("io", "\n".join(["r.setDO(1,%s)" % v for v in ["2", "-1", "0.5", "'x'", "True"]] + ["r.setAO(2,%s)" % v for v in ["0", "'y'"]] + ["r.waitDI(1,%s)" % v for v in ["2", "-1", "'x'"]] + ["r.waitDI(1,1,0)", "r.waitDI(1,1,1234.56)"]))]
EXPS += [("speeds", "r.setSpeedJoints(0.1)\nr.MoveJ(None,%s,None)\nr.setSpeedJoints(1000)\nr.MoveJ(None,%s,None)\nr.setSpeed(1e6)\n%s\nr.setAcceleration(5)\nr.setAccelerationJoints(5)" % (J, J, ML))]
EXPS += [("pauses", "\n".join("r.Pause(%s)" % v for v in [0, -1, 0.4, 0.9999, 1234.9]))]
EXPS += [("ax4", "r.MoveJ(None,[1,2,3,4],None)\nr.MoveL(%s,[1,2,3,4],[0,0,0])" % P1, None, "", None, "RRTR", 4)]
EXPS += [("ax4R", "r.MoveJ(None,[1,2,3,4],None)\nr.MoveL(%s,[1,2,3,4],[0,0,0])" % P1, None, "", None, "RRRR", 4)]
EXPS += [("ax7", "r.MoveJ(None,[1,2,3,4,5,6,7],None)\nr.MoveL(%s,[1,2,3,4,5,6,7],[0,0,0])" % P1, None, "", None, "RRRRRRT", 7)]
EXPS += [("calls", 'r.RunCode(r"""a b(c, d)""", True)\nr.RunCode(r"""x.y""", True)\nr.RunMessage(r"""m "q" """)')]
EXPS += [("subprograms", "\n".join(["r.MoveJ(None,%s,None)" % J, 'r.RunCode(r"""S1""", True)', "r.ProgFinish(r'''TgtProg''')", "r.ProgStart(r'''S1''')", ML, "r.ProgFinish(r'''S1''')", "r.ProgStart(r'''S2''')"]))]
EXPS += [("joint_linear", "r.setSpeedJoints(33)\nr.setZoneData(1)\nr.MoveL(None,%s,None)\nr.MoveC(None,%s,None,%s,None,None)\nr.MoveC(%s,%s,%s,%s,[0,0,0],[0,0,0])" % (J, J, J, P1, J, P1, J))]
