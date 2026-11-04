
POST = "Dobot_V3"
NQ = 6
ROBOT = "Dobot CR10"
P1="p(-607.85,543.849,363.215,150,50,-165)"
J="[0,-10,20,0,30,0]"
ML="r.MoveL(%s,%s,[0,0,0])" % (P1, J)
EXPS=[("io", "\n".join(["r.setDO(1,%s)" % v for v in ["2", "-1", "0.5", "True", "'1'"]] + ["r.setAO(2,%s)" % v for v in ["-1", "2", "'3'"]] + ["r.waitDI(1,%s)" % v for v in ["2", "-1", "'x'", "True"]] + ["r.waitDI(1,1,0)", "r.waitDI(1,1,1234.56)", "r.waitDI('V','x',5)"]))]
EXPS += [("speeds", "\n".join("r.setSpeed(%s)\nr.setSpeedJoints(%s)\nr.setAcceleration(%s)\nr.setAccelerationJoints(%s)" % (v, v, v, v) for v in [0.4, 0.5, 1.5, 99.5, 100.5, 1000, -5]))]
EXPS += [("zones", "\n".join("r.setZoneData(%s)" % z for z in [0.4, 0.5, 1.5, 2.5, 99.9, 1000, -1, -0.5, 0]))]
EXPS += [("pauses", "\n".join("r.Pause(%s)" % v for v in [0, -1, 0.4, 0.5, 1.5, 2.5, 1234.5]))]
EXPS += [("ax7", "r.MoveJ(None,[1,2,3,4,5,6,7],None)\n%s" % ML.replace(J, "[1,2,3,4,5,6,7]"), None, "", None, "RRRRRRT", 7)]
EXPS += [("subs", "\n".join(["r.MoveJ(None,%s,None)" % J, 'r.RunCode(r"""S1""", True)', "r.ProgFinish(r'''AdHoc''')", "r.ProgStart(r'''S1''')", ML, "r.ProgFinish(r'''S1''')", "r.ProgStart(r'''S2''')"]))]
EXPS += [("calls", 'r.RunCode(r"""a b(c, d)""", True)\nr.RunCode(r"""x.y""", True)\nr.RunMessage(r"""m "q" """)')]
EXPS += [("frames", 'r.setFrame(p(1,2,3,4,5,6),3,r"""F""")\nr.setTool(p(1,2,3,4,5,6),4,r"""T""")\n%s' % ML)]
EXPS += [("joint_targets", "r.MoveL(None,%s,None)\nr.MoveC(None,%s,None,%s,None,None)\nr.MoveJ(%s,%s,[0,0,0])\nr.MoveC(%s,%s,%s,%s,[0,0,0],[0,0,0])" % (J, J, J, P1, J, P1, J, P1, J))]
