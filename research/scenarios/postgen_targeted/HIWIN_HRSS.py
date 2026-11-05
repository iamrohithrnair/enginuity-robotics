# Defines HIWIN HRSS probes for split boundaries, frame IDs and extra-axis motion.
POST = "HIWIN_HRSS"
NQ = 6
ROBOT = "HIWIN RA605-710-GB"
P1="p(-607.85,543.849,363.215,150,50,-165)"
J="[0,-10,20,0,30,0]"
MJ="r.MoveJ(None,%s,None)" % J
ML="r.MoveL(%s,%s,[0,0,0])" % (P1, J)
EXPS=[("ids", 'r.setFrame(p(1,2,3,4,5,6),3,r"""My Frame-1""")\nr.setTool(p(1,2,3,4,5,6),4,r"""T 2""")\n%s\n%s\nr.setFrame(p(1,2,3,4,5,6),0,r"""F0""")\n%s' % (MJ, ML, MJ))]
EXPS += [("noframe", "%s\n%s" % (MJ, ML))]
EXPS += [("zones", "\n".join("r.setZoneData(%s)\n%s\n%s" % (z, MJ, ML) for z in [5, -1, 0, -0.5, 1e-9]))]
EXPS += [("speeds", "\n".join("r.setSpeedJoints(%s)\n%s" % (v, MJ) for v in [0.5, 1.5, 299, 300, 600, -3]) + "\nr.setSpeed(0.04)\n%s\nr.setAcceleration(1234.5)\nr.setAccelerationJoints(1.23456789)" % ML)]
EXPS += [("io", "\n".join(["r.setDO(1,%s)" % v for v in ["2", "-1", "'x'", "True"]] + ["r.setAO(2,%s)" % v for v in ["0", "'y'", "1.5"]] + ["r.waitDI(1,%s)" % v for v in ["0", "'x'", "2"]] + ["r.waitDI(1,1,100)", "r.waitDI('V',0,5)"]))]
EXPS += [("pauses", "\n".join("r.Pause(%s)" % v for v in [0, -1, 0.4, 1234.5678]))]
EXPS += [("calls", "\n".join('r.RunCode(r"""%s""", True)' % c for c in ["My Prog", "a b(c, d)", "x.y"]) + '\nr.RunCode(r"""raw code""")\nr.RunMessage(r"""m "q" """)')]
EXPS += [("split_rem", "\n".join([MJ]*6), None, ", lines_x_prog=3")]
EXPS += [("split_exact", "\n".join([MJ]*7), None, ", lines_x_prog=3")]
EXPS += [("joint_lin", "r.MoveL(None,%s,None)\nr.MoveC(None,%s,None,%s,None,None)" % (J, J, J))]
EXPS += [("ax7", "r.MoveJ(None,[1,2,3,4,5,6,7],None)\n%s" % ML.replace(J, "[1,2,3,4,5,6,7]"), None, "", None, "RRRRRRT", 7)]
EXPS += [("ax4", "r.MoveJ(None,[1,2,3,4],None)\n%s" % ML.replace(J, "[1,2,3,4]"), None, "", None, "RRTR", 4)]
