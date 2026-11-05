# Defines Hans probes for target formats, motion settings, Unicode and empty programs.





POST = "Hans"
NQ = 6
ROBOT = "Huayan E03"
P1 = "p(-607.85,543.849,363.215,0,0,0)"
P2 = "p(-640.584,506.98,371.534,0,0,0)"
J = "[0,-10,20,0,30,0]"
ML = "r.MoveL(%s,%s,[0,0,0])" % (P1, J)
EXPS = [
    ("io", "\n".join(["r.setDO(1,%s)" % v for v in ["0.4", "2", "-1", "True", "'x'", "1.5", "0", "False", "'0'"]]
                     + ["r.setAO(2,%s)" % v for v in ["0.4", "0.75", "2", "2.5", "3.5", "-1", "'x'", "'0.75'", "0", "'0'", "-0.5"]]
                     + ["r.setAO('A',1)"]
                     + ["r.waitDI(1,%s)" % v for v in ["2", "'x'"]] + ["r.waitDI(1,1,0)", "r.waitDI('V',0,1234.56)"])),
    ("messages", 'r.RunCode(r"""raw code""")\nr.RunMessage(r"""m "q" """)\nr.RunMessage(r"""c "q" """, True)\nr.RunMessage(r"""x""", False)\nr.Pause(0)\nr.Pause(-1)'),
    ("subs", "\n".join([ML, "r.ProgFinish(r'''TgtProg''')", "r.ProgStart(r'''S1''')", ML,
                        "r.setSpeed(10)", ML, "r.setFrame(%s,-1,r'''F''')" % P2, "r.ProgFinish(r'''S1''')", "r.ProgStart(r'''S2''')", ML])),
    ("speeds", "\n".join(["r.setSpeed(0.12345)", "r.setAcceleration(1.23456)", "r.setZoneData(0.12345)", ML,
                          "r.setSpeedJoints(5.55555)", "r.setAccelerationJoints(7.77777)", "r.MoveJ(%s,%s,[0,0,0])" % (P1, J),
                          "r.MoveC(%s,%s,%s,%s,[0,0,0],[0,0,0])" % (P1, J, P2, J), "r.setZoneData(-1)", ML, "r.setSpeed(-5)", ML])),
    ("targets", "\n".join(["r.MoveC(None,%s,None,%s,None,None)" % (J, J), "r.MoveC(%s,%s,None,%s,[0,0,0],None)" % (P1, J, J),
                           "r.MoveC(None,%s,%s,%s,None,[0,0,0])" % (J, P2, J),
                           "r.MoveL(%s,[1.23456789,-0.00004,0.00005,1e-9,-1e-9,123456.123456],[0,0,0])" % P1])),
    ("blank", "r.setTool(%s,-1,r'''T''')\nr.setFrame(%s,-1,r'''F''')\nr.setTool(%s,-1,r'''T''')\nr.setFrame(%s,-1,r'''F''')\n%s" % (P1, P2, P2, P1, ML)),
    ("noframe", ML + "\nr.setTool(%s,-1,r'''T''')" % P1),
    ("unicode", 'r.RunMessage(r"""Grüße ° µ \\ /""", True)\nr.RunCode(r"""ü = 1""")'),
    ("axes7", "r.MoveJ(%s,[1,2,3,4,5,6,7],[0,0,0])\nr.MoveL(%s,[1,2,3,4,5,6,7],[0,0,0])" % (P1, P1), None, "", None, "RRRRRRR", 7),
]
