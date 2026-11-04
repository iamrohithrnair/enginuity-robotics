
POST = "Rokae"
NQ = 6
ROBOT = "Rokae XB4"
P1="p(-607.85,543.849,363.215,150,50,-165)"
J="[0,-10,20,0,30,0]"
ML="r.MoveL(%s,%s,[0,0,0])" % (P1, J)
EXPS=[("subs", "\n".join([ML, 'r.RunCode(r"""S1""", True)', "r.ProgFinish(r'''AdHoc''')", "r.ProgStart(r'''S1''')", ML, "r.setSpeed(10)", ML, "r.ProgFinish(r'''S1''')", "r.ProgStart(r'''S2''')", ML]))]
EXPS += [("io", "\n".join(["r.setDO(1,%s)" % v for v in ["0.4", "2", "-1", "True", "'x'", "1.5"]] + ["r.setAO(2,%s)" % v for v in ["0.4", "2", "-1", "'x'"]] + ["r.waitDI(1,%s)" % v for v in ["0.4", "2", "-1", "'x'"]] + ["r.waitDI(1,1,0)", "r.waitDI(1,1,1234.56)", "r.waitDI('V',1,50)"]))]
EXPS += [("dropped", "\n".join(["r.MoveL(None,%s,None)" % J, "r.MoveC(None,%s,None,%s,None,None)" % (J, J), "r.MoveJ(None,%s,None)" % J, 'r.RunMessage(r"""c""", True)', "r.Pause(-1)", "r.Pause(0)", "r.Pause(0.4)", ML]))]
EXPS += [("confs", "\n".join("r.MoveL(%s,%s,%s)" % (P1, j, c) for j, c in [("[0,-10,20,0,30,0]", "[1,0,0]"), ("[0,-10,20,0,30,0]", "[0,1,0]"), ("[0,-10,20,0,30,0]", "[1,1,1]"), ("[-90,0,0,-90,0,-90]", "[0,0,0]"), ("[-90.0001,0,0,270,0,180]", "[0,0,0]"), ("[180,0,0,360,0,-180]", "None")]))]
EXPS += [("ax7", "r.MoveL(%s,[1,2,3,4,5,6,7],[0,0,0])" % P1, None, "", None, "RRRRRRT", 7)]
EXPS += [("speeds", "r.setSpeed(0.999)\n%s\nr.setZoneData(0.999)\n%s\nr.setZoneData(-0.5)\n%s\nr.setZoneData(0)\n%s\nr.setSpeedJoints(5)\nr.setAcceleration(5)\nr.MoveJ(%s,%s,[0,0,0])" % (ML, ML, ML, ML, P1, J))]
EXPS += [("frames", 'r.setFrame(p(1.23456,2,3,4,5,6),-1,r"""F""")\nr.setFrame(p(-0.0,2,3,4,5,6),-1,r"""F""")\nr.setFrame(p(12345678.9,2,3,4,5,6),-1,r"""F""")\nr.setTool(p(1.23456,2,3,4,5,6),-1,r"""T""")')]
EXPS += [("tool_quaternion", 'r.setTool(p(0.125,-0.375,123.457,0.0001,0,-45.25),-1,r"""T""")\nr.setTool(p(0,0,0,180,0,0),-1,r"""T""")\nr.setTool(p(0,0,0,0,180,0),-1,r"""T""")\nr.setTool(p(0,0,0,0,0,180),-1,r"""T""")')]
EXPS += [("msgs", 'r.RunMessage(r"""m "q" """)\nr.RunCode(r"""a b(c, d)""", True)\nr.RunCode(r"""x.y""", True)\nr.RunCode(r"""raw code""")')]
