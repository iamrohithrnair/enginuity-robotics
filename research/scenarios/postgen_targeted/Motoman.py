# Defines Motoman probes for pulse conversion across axis counts and axis-type layouts.


POST = "Motoman"
NQ = 6
ROBOT = "Yaskawa Motoman GP8"

_P6 = ", pulses_x_deg=[1024.000000,1213.630000,910.222000,853.333000,728.178000,464.863000]"
_P4 = ", pulses_x_deg=[1000.000000,2000.000000,300.500000,4000.000000]"
_P7 = ", pulses_x_deg=[1024.000000,1024.000000,1149.155556,-1149.155556,-1149.155556,-1149.155556,-580.266667]"

_MOVES6 = """
r.MoveJ(None,[10,-20,30,-40,50,-60],None)
r.MoveL(p(500,100,400,180,0,180),[0.5,-0.25,0.125,1.5,-2.75,3.0625],[0,0,0])
r.MoveJ(None,[-0.4,0.6,-1.5,2.5,0,0.0004],None)
"""
_MOVES4 = """
r.MoveJ(None,[10,-20,30,-40],None)
r.MoveL(p(500,100,-50,0,0,45),[0.5,-0.25,12.5,1.5],[0,0,0])
r.MoveJ(None,[-0.4,0.6,-150.25,2.5],None)
"""
_MOVES7 = """
r.MoveJ(None,[10,-20,30,-40,50,-60,70],None)
r.MoveL(p(500,100,400,180,0,180),[0.5,-0.25,0.125,1.5,-2.75,3.0625,-1],[0,0,0])
"""

EXPS = [
    
    ("pulses_6ax", _MOVES6, None, _P6),
    ("pulses_6ax_none", _MOVES6, None, ""),
    ("pulses_4ax_RRLR", _MOVES4, "Yaskawa Motoman SCARA", _P4, None, "RRLR", 4),
    ("pulses_4ax_LRRR", _MOVES4, "Yaskawa Motoman SCARA", _P4, None, "LRRR", 4),
    ("pulses_4ax_RRRR", _MOVES4, "Yaskawa Motoman MPL", _P4, None, "RRRR", 4),
    ("nopulses_4ax_RRLR", _MOVES4, "Yaskawa Motoman SCARA", "", None, "RRLR", 4),
    ("pulses_7ax", _MOVES7, "Yaskawa Motoman SIA", _P7, None, "RRRRRRR", 7),
]
