# Defines Sinumerik probes for modal motion state, frames, I/O and subprograms.
POST = "Siemens_Sinumerik"
NQ = 6
ROBOT = "MABI Robotic MAX-100-2.25-P"
P1="p(-607.85,543.849,363.215,150,50,-165)"
P2="p(-602.951,596.788,316.595,150,50,-165)"
PY="p(-607.85,500,363.215,150,50,-165)"
PZ="p(-607.85,500,100,150,50,-165)"
PX="p(-1,500,100,150,50,-165)"
J="[0,-10,20,0,30,0]"
def ML(p): return "r.MoveL(%s,%s,[0,0,0])" % (p, J)
EXPS=[("modal", "\n".join([ML(P1), ML(PY), ML(PZ), ML(PX), ML(PX), "r.MoveC(%s,%s,%s,%s,[0,0,0],[0,0,0])" % (P1, J, P2, J), ML(P2), "r.MoveJ(%s,%s,[0,0,0])" % (P2, J), ML(P2), "r.MoveL(None,%s,None)" % J, ML(P2)]))]
EXPS += [("io", "\n".join(["r.setDO(1,%s)" % v for v in ["0.4", "2", "-1", "True", "'x'", "1.5", "0"]] + ["r.setAO('A',%s)" % v for v in ["0.4", "-1", "'3'"]] + ["r.waitDI(5,%s)" % v for v in ["0.4", "2", "-1", "0", "True", "'x'"]] + ["r.waitDI('V',1)", "r.waitDI(1,1,0)", "r.waitDI(1,0,1234.56)", "r.waitDI('V',1,50)"]))]
EXPS += [("msgs", 'r.RunMessage(r"""m "q" """)\nr.RunCode(r"""a b(c, d)""", True)\nr.RunCode(r"""x.y""", True)\nr.RunCode(r"""raw code""")')]
EXPS += [("frames", 'r.setFrame(p(1,2,3,4,5,6),3,r"""F""")\nr.setTool(p(1,2,3,4,5,6),4,r"""T""")\nr.setFrame(p(1,2,3,0,90,0),-1,r"""G""")\nr.setTool(p(1,2,3,0,-90,0),-1,r"""G""")\n%s' % ML(P1))]
EXPS += [("pauses", "\n".join("r.Pause(%s)" % v for v in [499, 500, 501, 1500, 2500, 3500, -0.5]))]
EXPS += [("speeds", "\n".join(["r.setZoneData(0)", "r.setZoneData(-0.5)", "r.setSpeed(0.001)", "r.setSpeedJoints(0.001)", "r.setAcceleration(-1)", "r.setAccelerationJoints(0.0004)", ML(P1), "r.MoveJ(None,%s,None)" % J]))]
EXPS += [("subs", "\n".join([ML(P1), 'r.RunCode(r"""S1""", True)', "r.ProgFinish(r'''AdHoc''')", "r.ProgStart(r'''S1''')", ML(P1), "r.ProgFinish(r'''S1''')", "r.ProgStart(r'''S2''')", ML(P1)]))]
EXPS += [("ax7", "r.MoveJ(%s,[1,-2,3,4,5,6,-7],[0,0,0])\n%s" % (P1, ML(P1).replace(J, "[1,2,3,4,5,6,7]")), None, "", None, "RRRRRRR", 7)]
EXPS += [("conf", "\n".join("r.MoveJ(%s,%s,%s)" % (P1, J, c) for c in ["[1,0,0]", "[0,1,0]", "[0,0,1]", "None"]))]
