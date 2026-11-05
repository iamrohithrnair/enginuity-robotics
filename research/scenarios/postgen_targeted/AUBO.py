# Defines AUBO probes for UUID allocation, subprogram grouping and I/O formatting.
POST = "AUBO"
NQ = 6
ROBOT = "AUBO-ES3"
J1 = "[0,-10,20,0,30,0]"
J2 = "[20,-10,20,0,30,0]"
MJ1 = "r.MoveJ(None,%s,None)" % J1
MJ2 = "r.MoveJ(None,%s,None)" % J2
EXPS = [
    ("uuid_one", MJ1),
    ("uuid_same2", MJ1 + "\n" + MJ1),
    ("uuid_diff2", MJ1 + "\n" + MJ2),
    ("uuid_swap2", MJ2 + "\n" + MJ1),
    ("uuid_wait", "r.Pause(250.0)"),
    ("uuid_wait2", "r.Pause(250.0)\nr.Pause(500.0)"),
    ("uuid_many", "\n".join([MJ1, MJ2] * 40)),
    ("uuid_name", MJ1, None, "", None, None, None, "OtherName"),
]


def _sub(name, body, call=True):
    return "\n".join(([MJ1, 'r.RunCode(r"""%s""", True)' % name] if call else [MJ1]) + ['r.ProgFinish(r"""TgtProg""")', 'r.ProgStart(r"""%s""")' % name] + body + ['r.ProgFinish(r"""%s""")' % name])



EXPS += [
    ("proc_a", _sub("SubProg2", [MJ2])),
    ("proc_name", _sub("SubB", [MJ2])),
    ("proc_body", _sub("SubProg2", [MJ1])),
    ("proc_two", _sub("SubProg2", [MJ2, MJ1])),
    ("proc_nocall", _sub("SubProg2", [MJ2], call=False)),
    ("proc_wait", _sub("SubProg2", ["r.Pause(250.0)"])),
    ("proc_main", _sub("SubProg2", [MJ2]), None, "", None, None, None, "MainCall"),
]

ML1 = "r.MoveL(None,%s,None)" % J1
MC = "r.MoveC(None,%s,None,%s,None,None)" % (J1, J2)

EXPS += [
    ("g_speed", "\n".join([MJ1, "r.setSpeedJoints(30)", MJ2])),
    ("g_lspeed", "\n".join([ML1, "r.setSpeed(30)", ML1])),
    ("g_accel", "\n".join([ML1, "r.setAcceleration(300)", ML1, "r.setAccelerationJoints(300)", MJ1, "r.setSpeedJoints(400)", "r.setAccelerationJoints(400)", MJ1])),
    ("g_frame", "\n".join([MJ1, 'r.setFrame(p(1,2,3,0,0,0),-1,r"""F2""")', MJ2])),
    ("g_tool", "\n".join([MJ1, 'r.setTool(p(1,2,3,0,0,0),-1,r"""T2""")', MJ2])),
    ("g_zone", "\n".join([ML1, "r.setZoneData(1)", ML1, "r.setZoneData(2)", ML1])),
    ("g_msg", "\n".join([MJ1, 'r.RunMessage(r"""c""", True)', MJ2])),
    ("g_cc", "\n".join([MJ1, MC, MC, ML1])),
    ("g_lj", "\n".join([ML1, MJ1, ML1])),
    ("g_neg", "\n".join(["r.setZoneData(-1)", MJ1, "r.setZoneData(0.04)", MJ1, "r.setZoneData(0.06)", MJ1, "r.setZoneData(0.00005)", MJ1, "r.setZoneData(1234.5678)", MJ1])),
]

EXPS += [
    ("io_do", "\n".join("r.setDO(%s,%s)" % a for a in [("0", "1"), ("1", "True"), ("2", "'ON'"), ("9", "0.5"), ("10", "2"), ("12", "False"), ("99", "'1'"), ("'Name'", "1"), ("'5'", "1")])),
    ("io_ao", "\n".join("r.setAO(%s,%s)" % a for a in [("0", "'1'"), ("1", "'2.5'"), ("2", "'x'"), ("3", "'0'"), ("4", "'3'"), ("5", "'4'"), ("10", "'5'"), ("'7'", "'1'")])),
    ("io_ao_num", "r.setAO(1,2.5)"),
    ("io_ao_name", "r.setAO('Pressure','0.75')"),
    ("io_di", "\n".join("r.waitDI(%s)" % a for a in ["0,1", "1,True", "2,'1'", "3,0,0", "4,1,500", "12,'ON'", "'Name',1", "'6',0", "99,False,-1"])),
]
EXPS += [("io_ao_%s" % i, "r.setAO(%s,%s)" % (i, v)) for i, v in [(0, "'1'"), (2, "'x'"), (4, "-3.14159"), (5, "4"), (6, "1"), (7, "1"), (10, "1"), (-1, "1")]]
EXPS += [("pause_0", "r.Pause(0)\nr.Pause(0.4)\nr.Pause(-1)\nr.Pause(1234.5678)\n" + MJ1 + "\nr.RunCode(r'''code here''')\nr.RunCode(r'''fn''', True)\n" + MJ1)]
P1 = "p(-607.85,543.849,363.215,150,50,-165)"
P2 = "p(-602.951,596.788,316.595,150,50,-165)"

EXPS += [
    ("c_prevpose", "r.MoveL(%s,%s,[0,0,0])\n%s" % (P1, J1, MC)),
    ("c_ownpose", "%s\nr.MoveC(%s,%s,%s,%s,[0,0,0],[0,0,0])" % (ML1, P1, J1, P2, J2)),
    ("c_first", MC),
]
