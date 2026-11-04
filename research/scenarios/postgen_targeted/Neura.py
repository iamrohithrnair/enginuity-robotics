
POST = "Neura"
NQ = 6
ROBOT = "Delta Electronics DC06"
J = "[0,-10,20,0,30,0]"
MJ = "r.MoveJ(None,%s,None)" % J
EXPS = [("zones", "\n".join([MJ, "r.setZoneData(0)", MJ, "r.setZoneData(5)", MJ, "r.setZoneData(0)", MJ, "r.setZoneData(-1)", MJ, "r.setZoneData(0.5)", MJ, "r.setZoneData(-1)", MJ]))]
EXPS += [("io", "\n".join(["r.setDO(1,%s)" % v for v in ["0.4", "2", "-1", "True", "'0'", "'1'"]] + ["r.setDO('V',1)"] + ["r.setAO(2,%s)" % v for v in ["0.4", "2", "-1", "'2.5'"]] + ["r.setAO('V',1)"] + ["r.waitDI(1,%s)" % v for v in ["0.4", "2", "-1", "'1'"]] + ["r.waitDI(1,1,0)", "r.waitDI(1,1,1234.56)", "r.waitDI('V',1,50)"]))]
EXPS += [("io_text_do", "r.setDO(1,'x')"), ("io_text_ao", "r.setAO(2,'x')"), ("io_text_di", "r.waitDI(1,'x')")]
EXPS += [("msgs", 'r.RunMessage(r"""m "q" """)\nr.RunCode(r"""a b(c, d)""", True)\nr.RunCode(r"""x.y""", True)\nr.RunCode(r"""9go""", True)\nr.RunCode(r"""raw code""")\nr.Pause(-0.5)\nr.Pause(0.4)')]
EXPS += [("speeds", "r.setSpeed(1000.5)\nr.setSpeedJoints(100.5)\nr.setAcceleration(999)\nr.setAccelerationJoints(99.5)\nr.setSpeed(-5)")]
