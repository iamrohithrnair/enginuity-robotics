# Defines Denso RC9 probes for numeric precision, target names and acceleration settings.
POST = "Denso_RC9"
NQ = 6
ROBOT = "Denso Cobotta PRO 1300"
J = "[0,-10,20,0,30,0]"
P1 = "p(-607.85,543.849,363.215,150,50,-165)"
MJ = "r.MoveJ(None,%s,None)" % J
ML = "r.MoveL(%s,%s,[0,0,0])" % (P1, J)
EXPS = [("numbers", "\n".join(['r.setFrame(p(1234.56789,-0.000001,1e-7,12.3456789,-0.0000004,100000.5),-1,r"""F""")', "r.MoveJ(None,[1234.56789,-0.000001,1e-7,-1e-7,123456.7,0.1234567],None)", "r.setSpeed(333.3333333)", "r.setSpeedJoints(0.0000001)", ML, MJ]))]
EXPS += [("names", "\n".join(['r._TargetName=r"""A"""', MJ, MJ, ML, 'r._TargetName=r"""B"""', ML, "r.MoveL(None,%s,None)" % J, 'r._TargetNameVia=r"""V"""', "r.MoveC(%s,%s,%s,%s,[0,0,0],[0,0,0])" % (P1, J, P1, J), "r.MoveC(%s,%s,%s,%s,[0,0,0],[0,0,0])" % (P1, J, P1, J)]))]
EXPS += [("accel_l", "\n".join([MJ, ML, "r.setAcceleration(50)", MJ, ML, "r.setAcceleration(150.5)", ML]))]
EXPS += [("accel_j", "\n".join([MJ, ML, "r.setAccelerationJoints(30)", MJ, ML, "r.setAccelerationJoints(250)", MJ]))]
EXPS += [("zones", "\n".join(["r.setZoneData(%s)\n%s" % (z, MJ) for z in ("0.999", "1", "1.999", "0.001", "0", "-0.5", "100.7")]))]
EXPS += [("io", "\n".join(["r.setDO(1,%s)" % v for v in ["0.4", "-1", "True", "False", "'0'", "'1'", "'x'"]] + ["r.setAO(2,0.4)"] + ["r.waitDI(1,%s)" % v for v in ["0.4", "-1", "'1'", "'x'"]] + ["r.waitDI(1,1,0)", "r.waitDI(1,1,1234.56)", "r.waitDI('V',1,50)", "r.Pause(0.4)", "r.Pause(-0.5)"]))]
EXPS += [("joints_c", "r.MoveC(None,%s,None,%s,None,None)\nr.MoveC(%s,%s,None,%s,[0,0,0],None)" % (J, J, P1, J, J))]
