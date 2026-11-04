
POST = "KEBA_KAIRO"
NQ = 6
ROBOT = "autonox Robotics articc6-1557-3kg (AT_00004)"
P1 = "p(-607.85,543.849,363.215,150,50,-165)"
P2 = "p(-640.584,506.98,371.534,150,50,-165)"
J = "[0,-10,20,0,30,0]"
MJ = "r.MoveJ(%s,%s,[0,0,0])" % (P1, J)
MJN = "r.MoveJ(None,%s,None)" % J
ML = "r.MoveL(%s,%s,[0,0,0])" % (P1, J)
MC = "r.MoveC(%s,%s,%s,%s,[0,0,0],[0,0,0])" % (P1, J, P2, J)
EXPS = [
    ("outs", "r.setDO(1,1)\nr.setDO(1,0)\nr.setAO(1,0.5)\nr.setDO('a b-c',1)\nr.setAO(2,0)\nr.setAO(2,-1)\nr.setDO(3,True)\nr.setDO(3,2)\nr.setDO(3,'x')\nr.setAO(4,'1.5')\n" + MJ),
    ("names", 'r.setFrame(p(1.5,2.5,3.5,10,20,30),-1,r"""1 Frame-x.y""")\nr.setTool(p(1.5,2.5,3.5,10,20,30),-1,r"""T ä_1""")\n%s\nr.setTool(p(4.5,2.5,3.5,10,20,30),-1,r"""T ä_1""")\n%s\nr.setFrame(p(1.5,2.5,3.5,10,20,30),-1,r"""1 Frame-x.y""")\n%s' % (MJ, ML, MJ)),
    ("tnames", 'r._TargetName=r"""A b"""\n%s\n%s\n%s\nr._TargetName=r"""A b"""\n%s\nr._TargetNameVia=r"""V"""\nr._TargetName=r"""E"""\n%s\n%s' % (MJ, MJ, ML, ML, MC, MJN)),
    ("speeds", "r.setSpeedJoints(600)\nr.setSpeedJoints(-5)\nr.setAccelerationJoints(10)\nr.setAccelerationJoints(1000)\nr.setSpeed(-5)\nr.setAcceleration(0.5)\nr.setZoneData(0.04)\nr.setZoneData(-0.06)\n" + MJ),
    ("msgs", 'r.RunMessage(r"""a "b" \\c""")\nr.RunCode(r"""1a b-c""", True)\nr.RunCode(r"""raw""")\nr.Pause(-0.5)\nr.Pause(0.0004)\n' + MJ),
    ("frame_noname", 'r.setFrame(p(1,2,3,0,0,0),2,None)\n' + MJ),
    ("tool_noname", 'r.setTool(p(1,2,3,0,0,0),2,None)\n' + MJ),
    ("progs", "%s\nr.RunCode(r'''Sub1''', True)\nr.ProgFinish(r'''TgtProg''')\nr.ProgStart(r'''Sub1''')\nr.setDO(1,1)\n%s\n%s\nr.ProgFinish(r'''Sub1''')" % (ML, ML, MJ)),
]
