
POST = "Kassow"
NQ = 7
ROBOT = "Kassow Robots KR0810"
P1 = "p(-607.85,543.849,363.215,150,50,-165)"
P2 = "p(-602.951,596.788,316.595,150,50,-165)"
J = "[0,-10,20,0,30,0,15]"
ML = "r.MoveL(%s,%s,[0,0,0])" % (P1, J)
MJ = "r.MoveJ(%s,%s,[0,0,0])" % (P1, J)
MC = "r.MoveC(%s,%s,%s,%s,[0,0,0],[0,0,0])" % (P1, J, P2, J)
FR = 'r.setFrame(p(1,2,3,4,5,6),-1,r"""F A""")'
EXPS = [("noframe", "\n".join([MJ, ML, "r.MoveJ(None,%s,None)" % J]))]
EXPS += [("names", "\n".join([
    FR,
    "r._TargetName = r'''AB'''", ML,
    "r._TargetNameVia = r'''XYZ'''", "r._TargetName = r'''QRS'''", MC,
    "r._TargetName = r'''Tgt-1.2 x'''", MJ,
    "r._TargetName = r'''AB'''", ML,
    "r._TargetName = r'''Jt one'''", "r.MoveJ(None,%s,None)" % J,
    "r._TargetNameVia = r'''Via 9'''", "r._TargetName = r'''End 8'''", MC,
    MC,
    "r._TargetName = r'''Lin j'''", "r.MoveL(None,%s,None)" % J,
    ML,
]))]
EXPS += [("repeats", "\n".join([
    FR, 'r.setTool(p(0,0,100,0,0,0),-1,r"""T 1""")', MJ,
    'r.setTool(p(0,0,100,0,0,0),-1,r"""T 1""")', 'r.setTool(p(0,0,50,0,0,0),-1,r"""T-2.b""")',
    'r.setFrame(p(5,6,7,0,0,0),-1,r"""F B""")', ML, FR, ML,
    "r.setDO(5,1)", "r.setDO(5,0)", "r.setDO('5',1)", "r.setDO(15,True)", "r.setAO(5,0.5)", "r.setAO(2,'x')",
    "r.waitDI(3,1,0)", "r.waitDI('In 1','ON',1234.56)", "r.waitDI(3,0,-5)",
    "r.Pause(-1)", "r.Pause(-1)", 'r.RunMessage(r"""Hi""")', "r.Pause(12)", "r.Pause(0.4)",
]))]
EXPS += [("codes", "\n".join([
    'r.RunCode(r"""a b(c, d)""", True)', 'r.RunCode(r"""x.y""", True)', 'r.RunCode(r"""raw code""")',
    'r.RunCode(r"""Prog-2 ok""", True)', 'r.RunCode(r"""f(a,b)""", True)', 'r.RunMessage(r"""m "q" """)',
    'r.RunMessage(r"""c "q" ; x""", True)',
    "r.ProgFinish(r'''TgtProg''')", "r.ProgStart(r'''Sub A''')", MJ, "r.setZoneData(3)", ML,
    "r.ProgFinish(r'''Sub A''')", "r.ProgStart(r'''S2''')", 'r.RunMessage(r"""c2""", True)',
]))]
EXPS += [("speeds", "\n".join([
    "r.setZoneData(0.5)", "r.setSpeed(-5)", "r.setSpeedJoints(0)", ML, "r.setZoneData(-0.5)", "r.setAcceleration(0)", MJ,
    "r.setZoneData(0)", "r.setSpeed(0.001)", "r.setAccelerationJoints(1e-5)", MC,
]))]
