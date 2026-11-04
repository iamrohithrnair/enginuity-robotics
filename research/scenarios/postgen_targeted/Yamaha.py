
POST = "Yamaha"
NQ = 4
ROBOT = "Yamaha YK400XR-S-150"
AXES = "RRTR"
EXPS = [("speeds", "\n".join(["r.setSpeed(%s)" % v for v in ["4999", "5000", "7499", "7500", "9999", "10000", "24999.9", "0", "-1", "100000", "600000"]]))]
EXPS += [("accels", "\n".join(["r.setAcceleration(%s)" % v for v in ["499", "500", "749", "750", "999", "1000", "1499.9", "0", "-1", "60000"]]))]
EXPS += [("waits", "\n".join(["r.waitDI(1,1,0)", "r.waitDI(1,1,0.5)", "r.waitDI(1,1,-0.5)", "r.waitDI('V','x',12.25)", "r.setDO(1,-1)", "r.setDO(1,True)", "r.setAO(2,0)"]))]
