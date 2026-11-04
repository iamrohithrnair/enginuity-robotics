
POST = "Elite_Robots_CS"
NQ = 6
ROBOT = "Elite Robots CS530H"
P1 = "p(-607.85,543.849,363.215,150,50,-165)"
P2 = "p(-640.584,506.98,371.534,150,50,-165)"
J = "[0,-10,20,0,30,0]"
MJ = "r.MoveJ(None,%s,None)" % J
ML = "r.MoveL(%s,%s,[0,0,0])" % (P1, J)
EXPS = [
    ("do_int", "r.setDO(1,1)\nr.setDO(2,0)\nr.setDO(3,'ON')\n" + MJ),
    ("do_str", "r.setDO('Valve',0)\n" + MJ),
    ("ao_num", "r.setAO(3,0.5)\n" + MJ),
    ("ao_str", "r.setAO(3,'2.5')\n" + MJ),
    ("ao_name", "r.setAO('Pressure',0.75)\n" + MJ),
    ("di_int", "r.waitDI(2,1,-1)\nr.waitDI(4,0)\n" + MJ),
    ("di_timeout", "r.waitDI(4,0,1500)\n" + MJ),
    ("di_str", "r.waitDI('PartPresent',1,250)\n" + MJ),
    ("di_strval", "r.waitDI(7,'1',-1)\n" + MJ),
    ("code", 'r.RunCode(r"""CustomCode(42)""")\n' + MJ),
    ("code_call", 'r.RunCode(r"""Sub Prog-1(2)""", True)\n' + MJ),
    ("pause", "r.Pause(-1)\n" + MJ + "\nr.Pause(0.4)\n" + MJ),
    ("tools", 'r.setTool(p(1.5,2.5,3.5,0,0,0),-1,r"""T1""")\n%s\nr.setTool(p(4.5,5.5,6.5,0,0,90),-1,r"""T2""")\n%s\nr.setFrame(p(7.5,8.5,9.5,0,0,0),-1,r"""F2""")\n%s\nr.setTool(p(1.5,2.5,3.5,0,0,0),-1,r"""T1""")\n%s\nr.setTool(p(9.5,9.5,9.5,0,0,0),-1,r"""T1""")\n%s' % (MJ, MJ, ML, MJ, MJ)),
    ("tool_noname", 'r.setTool(p(1,2,3,0,0,0),5,None)\nr.setFrame(p(1,2,3,0,0,0),2,None)\n%s' % MJ),
    ("fmt", 'r.setFrame(p(12345678.9,1.23456789,-0.000012345,0,0,0),-1,r"""F a-b.c#d""")\nr.setTool(p(1e-07,100000.5,0.30000000000000004,0,0,0),-1,r"""T ä/x""")\n%s' % ML),
    ("arczone", "r.setZoneData(5)\nr.MoveC(%s,%s,%s,%s,[0,0,0],[0,0,0])\n%s" % (P1, J, P2, J, ML)),
    ("noframe", "%s\n%s" % (ML, MJ)),
    ("twoprogs", "%s\nr.ProgFinish(r'''TgtProg''')\nr.ProgStart(r'''Other''')\n%s" % (MJ, ML)),
    ("msgs", 'r.RunMessage(r"""Popup <b>&"x"</b>""")\nr.RunMessage(r"""line1\nline2""", True)\n' + MJ),
]
EXPS += [
    ("timers2", "r.waitDI(4,0,1500)\nr.waitDI(5,1,250)\n" + MJ + "\nr.waitDI(6,1,2000.5)"),
    ("do_vals", "r.setDO(1,2)\nr.setDO(2,True)\nr.setDO(3,0.5)\nr.setDO(4,'0')\nr.setDO('5',1)\nr.setDO(6,-1)\n" + MJ),
    ("zone0", "r.setZoneData(0)\n%s\nr.setZoneData(0.001)\n%s" % (ML, ML)),
    ("dupframe", 'r.setFrame(p(1.5,2.5,3.5,10,20,30),-1,r"""F""")\n%s\nr.setFrame(p(4.5,2.5,3.5,10,20,30),-1,r"""F""")\n%s\nr.setFrame(p(1.5,2.5,3.5,10,20,30),-1,r"""F""")\n%s' % (ML, ML, ML)),
    ("subcalls", "%s\nr.RunCode(r'''Sub1''', True)\nr.RunCode(r'''Sub1''', True)\nr.ProgFinish(r'''TgtProg''')\nr.ProgStart(r'''Sub1''')\nr.waitDI(4,0,1500)\n%s\nr.ProgFinish(r'''Sub1''')" % (MJ, MJ)),
]
EXPS += [("do_v_%s" % k, "r.setDO(%s,%s)\n%s" % (n, v, MJ)) for k, n, v in [("true", 1, "True"), ("half", 1, "0.5"), ("one_f", 1, "1.0"), ("str0", 1, "'0'"), ("strname", "'5'", 1), ("neg", 1, -1), ("high", 1, "'HIGH'"), ("float_name", "2.0", 1)]]
EXPS += [("di_v_%s" % k, "r.waitDI(%s,%s)\n%s" % (n, v, MJ)) for k, n, v in [("two", 1, 2), ("on", 1, "'ON'"), ("true", 1, "True"), ("strname", "'3'", 1), ("str0", 1, "'0'")]]
EXPS += [("do_v_%s" % k, "r.setDO(%s,%s)\n%s" % (n, v, MJ)) for k, n, v in [("false", 1, "False"), ("strTrue", 1, "'True'"), ("lowtrue", 1, "'true'"), ("name05", "'05'", 1), ("namebig", 123, 0)]]
EXPS += [("do_n%s" % n, "r.setDO(%s,1)\n%s" % (n, MJ)) for n in [0, 7, 8, 15, 16, 17, 31, 32]]
EXPS += [("di_n%s" % n, "r.waitDI(%s,1)\n%s" % (n, MJ)) for n in [0, 8, 15, 16, 32]]
EXPS += [("do_n%s" % n, "r.setDO(%s,1)\n%s" % (n, MJ)) for n in [9, 10, 11, 12, 13, 14]]
EXPS += [("di_n%s" % n, "r.waitDI(%s,1)\n%s" % (n, MJ)) for n in [9, 10, 12, 14]]
EXPS += [
    ("frame_noname", 'r.setFrame(p(1,2,3,0,0,0),2,None)\n%s' % MJ),
    ("subcall_stop", "%s\nr.RunCode(r'''Sub1''', True)\n%s\nr.ProgFinish(r'''TgtProg''')\nr.ProgStart(r'''Sub1''')\nr.setDO(20,1)\n%s\nr.ProgFinish(r'''Sub1''')" % (MJ, ML, MJ)),
    ("di_timeout_bad", "r.waitDI(20,1,100)\n" + MJ),
    ("di_timeout0", "r.waitDI(2,1,0)\n" + MJ),
]
EXPS += [
    ("empty_sub", "%s\nr.RunCode(r'''Sub1''', True)\nr.ProgFinish(r'''TgtProg''')\nr.ProgStart(r'''Sub1''')\nr.ProgFinish(r'''Sub1''')" % MJ),
    ("nested_stop", "r.RunCode(r'''Sub1''', True)\nr.ProgFinish(r'''TgtProg''')\nr.ProgStart(r'''Sub1''')\n%s\nr.RunCode(r'''Sub2''', True)\nr.ProgFinish(r'''Sub1''')\nr.ProgStart(r'''Sub2''')\nr.setDO('x',1)\nr.ProgFinish(r'''Sub2''')" % MJ),
    ("stop_first", "r.setDO('x',1)\n" + MJ, None, "", None, None, None, None),
]
EXPS += [("rt_%s" % k, MJ, rb) for k, rb in [("cs612", "Elite Robots CS612"), ("cs620", "Elite Robots CS620"), ("cs625", "Elite Robots CS625"), ("cs63", "Elite Robots CS63"), ("cs66", "Elite Robots CS66"), ("other", "My Robot")]]
EXPS += [("rt_native", MJ, "Elite Robots CS620", "", "Elite Robots CS66")]
