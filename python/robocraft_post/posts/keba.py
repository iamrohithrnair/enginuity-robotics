


























from __future__ import annotations

import re

from ..base import RobotPost, register
from ..robomath import euler_zyx, euler_zyz

EROP = [
    "EROP_OL : OVLABS := (posDist := 0, vConst := TRUE)",
    "EROP_D0 : DYNAMIC := (velAxis := 100, accAxis := 100, decAxis := 100, jerkAxis := 100, vel := 2000, acc := 8000, dec := 8000, "
    "jerk := 80000, velOri := 360, accOri := 720, decOri := 720, jerkOri := 7200)",
]
GUARD = "guard := (vector := (%s))" % ", ".join(["(active := TRUE, type := BEGINTRANSFORMATION)"] + ["()"] * 23)
MAX_VEL_AXIS = 550.0
MAX_ACC_AXIS = 450.0


def filter_name(name):
    s = re.sub(r"[^A-Za-z0-9_()]", "", str(name))
    return "P" + s if s[:1].isdigit() else s


def _cart(pose):
    a, b, c = euler_zyz(pose)
    return "x := %.3f, y := %.3f, z := %.3f, a := %.3f, b := %.3f, c := %.3f" % (pose[0][3], pose[1][3], pose[2][3], a, b, c)


@register
class KebaKairo(RobotPost):
    name = "KEBA_KAIRO"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.PROGS = []  
        self.TIP = None
        self.TID = None
        self.DECLARED = set()
        self.AP = 0
        self.POS = 0

    def ProgStart(self, progname):
        self.TIP = []
        self.TID = []
        self.DECLARED = set()
        self.PROGS.append((progname, self.TIP, self.TID))

    def ProgFinish(self, progname):
        pass

    def addline(self, line):
        if self.TIP is None:
            self.ProgStart("Prog")
        self.TIP.append(line)

    def declare(self, name, text):
        if self.TID is None:
            self.ProgStart("Prog")
        if name not in self.DECLARED:
            self.DECLARED.add(name)
            self.TID.append("%s : %s" % (name, text))

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        for name, tip, tid in self.PROGS:
            head = "//PROG NAME : %s" % name
            self.save_file(folder, "%s.tip" % name, "".join(l + "\n" for l in ["//KEBA", "//0.0HZ", "//100.0%", head] + tip + ["//ENDPROG"]))
            self.save_file(folder, "%s.tid" % name, "".join(l + "\n" for l in [head] + EROP + tid))

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def _target_name(self, default):
        name = self._TargetName
        self._TargetName = None
        return filter_name(name) if name else default

    def MoveJ(self, pose, joints, conf_RLF=None):
        name = self._target_name("ap%d" % self.AP)
        self.AP += 1
        self.declare(name, "AXISPOS := (%s)" % ", ".join("a%d := %.4f" % (i + 1, j) for i, j in enumerate(joints)))
        self.addline("PTP(%s, EROP_D0, EROP_OL)" % name)

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.addline("// Linear movement using joint targets is not supported. Change the target type to cartesian or use a joint movement.")
            return
        name = self._target_name("pos%d" % self.POS)
        self.POS += 1
        self.declare(name, "CARTPOS := (%s)" % _cart(pose))
        self.addline("Lin(%s, EROP_D0, EROP_OL)" % name)

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.addline("// Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement.")
            return
        n1, n2 = "pos%d" % self.POS, "pos%d" % (self.POS + 1)
        self.POS += 2
        self.declare(n1, "CARTPOS := (%s)" % _cart(pose1))
        self.declare(n2, "CARTPOS := (%s)" % _cart(pose2))
        self.addline("Circ(%s, %s, EROP_D0, EROP_OL)" % (n1, n2))

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        name = filter_name(frame_name) if frame_name is not None else "crsWorkPiece"
        self.declare(name, "CARTREFSYS := (baseRefSys := MAP(World), %s)" % _cart(pose))
        self.addline("RefSys(%s)" % name)

    def setTool(self, pose, tool_id=None, tool_name=None):
        name = filter_name(tool_name) if tool_name is not None else "t%s" % tool_id
        rz, ry, rx = euler_zyx(pose)
        self.declare(name, "TOOL := (x := %.3f, y := %.3f, z := %.3f, a := %.3f, b := %.3f, c:= %.3f, %s)" % (pose[0][3], pose[1][3], pose[2][3], rz, ry, rx, GUARD))
        self.addline("Tool(%s)" % name)

    def Pause(self, time_ms):
        if time_ms < 0:
            self.addline("WaitIsFinished()")
            self.addline("Stop()")
        else:
            self.addline("WaitTime(%.3f)" % time_ms)

    def setSpeed(self, speed_mms):
        self.addline("EROP_D0.vel := %.3f" % speed_mms)

    def setAcceleration(self, accel_mmss):
        self.addline("EROP_D0.acc := %.3f" % accel_mmss)
        self.addline("EROP_D0.dec := %.3f" % accel_mmss)

    def setSpeedJoints(self, speed_degs):
        self.addline("EROP_D0.velAxis := %.3f" % min(speed_degs / MAX_VEL_AXIS * 100, 100))

    def setAccelerationJoints(self, accel_degss):
        v = min(accel_degss / MAX_ACC_AXIS * 100, 100)
        self.addline("EROP_D0.accAxis := %.3f" % v)
        self.addline("EROP_D0.decAxis := %.3f" % v)

    def setZoneData(self, zone_mm):
        self.addline("EROP_OL.posDist := %s" % zone_mm)

    
    def _out(self, io_var, io_value):
        name = "Out%s" % io_var
        self.declare(name, "BOOLSIGOUT := (signal := MAP(IoDOut[%s]))" % io_var)
        value = io_value if isinstance(io_value, str) else ("TRUE" if io_value > 0 else "FALSE")
        self.addline("%s.Set(%s)" % (name, value))

    def setDO(self, io_var, io_value):
        self._out(io_var, io_value)

    def setAO(self, io_var, io_value):
        self._out(io_var, io_value)

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        self.addline("// Wait I/O instruction not implemented currently")

    def RunCode(self, code, is_function_call=False):
        self.addline("CALL %s" % filter_name(code) if is_function_call else code)

    def RunMessage(self, message, iscomment=False):
        self.addline("// %s" % message if iscomment else 'Info("%s")' % message)
