
POST = "HCR"
NQ = 6
ROBOT = "Hanwha HCR-10L"
P1="p(-607.85,543.849,363.215,150,50,-165)"
P2="p(-602.951,596.788,316.595,150,50,-165)"
J="[0,-10,20,0,30,0]"
ML="r.MoveL(%s,%s,[0,0,0])" % (P1, J)
EXPS=[("io", "\n".join(["r.setDO(1,%s)" % v for v in ["0.4", "2", "-1", "True", "'x'", "1.5"]] + ["r.setAO(2,%s)" % v for v in ["0.4", "0.5", "1.5", "2.5", "-0.7", "2", "'x'"]] + ["r.waitDI(5,%s)" % v for v in ["0.4", "2", "-1", "'x'"]] + ["r.waitDI('V',1)", "r.waitDI(1,1,0)", "r.waitDI(1,1,1234.56)", "r.waitDI('V',1,50)"]))]
EXPS += [("msgs", 'r.RunMessage(r"""m "q" """)\nr.RunCode(r"""a b(c, d)""", True)\nr.RunCode(r"""x.y""", True)\nr.RunCode(r"""raw code""")')]
EXPS += [("frames", 'r.setFrame(p(1,2,3,4,5,6),3,r"""F""")\n%s\nr.setFrame(p(0,0,0,0,0,0),-1,r"""F0""")\n%s\nr.setTool(p(1,2,3,4,5,6),4,r"""T""")\nr.MoveC(%s,%s,%s,%s,[0,0,0],[0,0,0])\n%s' % (ML, ML, P1, J, P2, J, ML))]
EXPS += [("speeds", "r.setSpeed(10)\nr.setSpeedJoints(5)\nr.setAcceleration(-5)\nr.setAccelerationJoints(7)\nr.setZoneData(3)\n%s\nr.MoveJ(%s,%s,[0,0,0])\nr.Pause(-0.5)\nr.Pause(0.0004)" % (ML, P1, J))]
EXPS += [("subs", "\n".join([ML, 'r.RunCode(r"""S1""", True)', "r.ProgFinish(r'''AdHoc''')", "r.ProgStart(r'''S1''')", ML, "r.ProgFinish(r'''S1''')", "r.ProgStart(r'''S2''')", ML]))]
EXPS += [("ax7", "r.MoveJ(None,[1,2,3,4,5,6,7],None)\n%s" % ML.replace(J, "[1,2,3,4,5,6,7]"), None, "", None, "RRRRRRR", 7)]
EXPS += [("wait0", "\n".join("r.waitDI(5,%s)" % v for v in ["0", "False", "'0'", "1"]))]
