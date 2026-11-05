# Defines ABB RAPID probes for alternative seventh-axis type encodings.

POST = "ABB_RAPID_IRC5"
NQ = 7
ROBOT = "ABB IRB 4600-60/2.05"

_BODY = """
r.MoveJ(None,[10,-20,30,-40,50,-60,500],None)
r.MoveL(p(500,100,400,180,0,180),[0.5,-0.25,0.125,1.5,-2.75,3.0625,250],[0,0,0])
"""

EXPS = [
    
    ("axes_7_T", _BODY, None, "", None, "RRRRRRT", 7),
    ("axes_7_J", _BODY, None, "", None, "RRRRRRJ", 7),
    ("axes_7_L", _BODY, None, "", None, "RRRRRRL", 7),
]
