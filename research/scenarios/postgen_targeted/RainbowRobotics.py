# Defines Rainbow Robotics probes for joint targets, frames, zones and I/O values.
POST = "RainbowRobotics"
NQ = 6
ROBOT = "RB10-1300"
P1="p(-607.85,543.849,363.215,150,50,-165)"
J="[0,-10,20,0,30,0]"
MJ="r.MoveJ(None,%s,None)" % J
ML="r.MoveL(%s,%s,[0,0,0])" % (P1, J)
EXPS=[("io", "\n".join(["r.setDO(1,%s)" % v for v in ["'x'", "2", "-1", "True", "0.5"]] + ["r.setAO(2,%s)" % v for v in ["'y'", "-1"]] + ["r.setAO('V',1)"] + ["r.waitDI(1,%s)" % v for v in ["2", "-1", "True", "0.5"]] + ["r.waitDI(1,1,0)", "r.waitDI(1,1,1234.5)", "r.waitDI('V',1,5)"]))]
EXPS += [("speeds", "r.setAccelerationJoints(500)\n%s\nr.setAccelerationJoints(5000)\nr.setAcceleration(20000)\nr.setSpeedJoints(-5)\n%s\n%s\nr.setSpeed(-5)\nr.setAcceleration(-5)\nr.setAccelerationJoints(-5)\n%s\n%s" % (MJ, MJ, ML, ML, MJ))]
EXPS += [("frames", 'r.setFrame(p(1,2,3,4,5,6),3,r"""F""")\nr.setTool(p(1,2,3,4,5,6),4,r"""T""")\n%s' % ML)]
EXPS += [("pauses", "\n".join("r.Pause(%s)" % v for v in [0, -1, -0.5, 0.4, 1234.5678]))]
EXPS += [("calls", "\n".join('r.RunCode(r"""%s""", True)' % c for c in ["My Prog", "a b(c, d)", "x.y"]) + '\nr.RunCode(r"""raw code""")\nr.RunMessage(r"""m "q" """)\nr.RunMessage(r"""c""",True)')]
EXPS += [("joints", "r.MoveL(None,%s,None)\nr.MoveC(None,%s,None,%s,None,None)\nr.MoveC(%s,%s,None,%s,[0,0,0],None)" % (J, J, J, P1, J, J))]
EXPS += [("ax7", "r.MoveJ(None,[1,2,3,4,5,6,7],None)\nr.MoveL(%s,[1,2,3,4,5,6,7],[0,0,0])\nr.MoveJ(%s,[1,2,3,4,5,6,7],[0,0,0])" % (P1, P1), None, "", None, "RRRRRRT", 7)]
EXPS += [("zones", "r.setZoneData(5)\n%s\nr.setZoneData(-1)\n%s" % (ML, ML))]
