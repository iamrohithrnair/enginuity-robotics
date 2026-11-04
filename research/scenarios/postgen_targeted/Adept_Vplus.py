
POST = "Adept_Vplus"
NQ = 6
ROBOT = "Adept Six 300"
P1="p(-607.85,543.849,363.215,150,50,-165)"
J="[0,-10,20,0,30,0]"
MJP="r.MoveJ(%s,%s,[0,0,0])" % (P1, J)
ML="r.MoveL(%s,%s,[0,0,0])" % (P1, J)
EXPS=[("accel", "r.setAcceleration(800)\nr.setAcceleration(12345)\nr.setAcceleration(-5)\nr.setAccelerationJoints(120)\nr.setAccelerationJoints(12345)\nr.setSpeedJoints(10)\nr.setSpeed(-5)\nr.setSpeed(123456)")]
EXPS += [("noframe", "%s\n%s" % (MJP, ML))]
EXPS += [("frames", 'r.setFrame(p(1,2,3,4,5,6),3,r"""F""")\nr.setTool(p(1,2,3,4,5,6),4,r"""T""")\n%s\n%s' % (MJP, ML))]
EXPS += [("io", "\n".join(["r.setDO(1,%s)" % v for v in ["2", "-1", "'x'", "True"]] + ["r.setAO(2,%s)" % v for v in ["0", "'y'"]] + ["r.waitDI(1,%s)" % v for v in ["0", "'x'", "2"]] + ["r.waitDI(1,1,0)", "r.waitDI('V',0,5)"]))]
EXPS += [("pauses", "\n".join("r.Pause(%s)" % v for v in [0, -1, 0.4, 1234.5678]))]
EXPS += [("calls", "\n".join('r.RunCode(r"""%s""", True)' % c for c in ["My Prog", "a b(c, d)", "x.y"]) + '\nr.RunCode(r"""raw code""")\nr.RunMessage(r"""m "q" """)')]
EXPS += [("zones", "r.setZoneData(5)\n%s\nr.setZoneData(-1)\n%s" % (ML, ML))]
EXPS += [("ax7", "r.MoveJ(None,[1,2,3,4,5,6,7],None)\n%s" % ML.replace(J, "[1,2,3,4,5,6,7]"), None, "", None, "RRRRRRT", 7)]
EXPS += [("mc", "r.MoveC(%s,%s,%s,%s,[0,0,0],[0,0,0])\nr.MoveC(None,%s,None,%s,None,None)" % (P1, J, P1, J, J, J))]
