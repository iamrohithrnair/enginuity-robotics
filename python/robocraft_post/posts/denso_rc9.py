# Generates Denso RC9 PACScript with motion speed and acceleration settings.





























import re

from ..base import RobotPost, register
from ..robomath import xyzwpr

JOINT_TARGET_L = "' Linear movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."
JOINT_TARGET_C = "' Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."


def _num(value, digits=7, decimals=6):
    pass
    n = max(0, min(decimals, digits - len(str(int(abs(value))))))
    s = ("%.*f" % (n, value)).rstrip("0").rstrip(".") if n else "%.0f" % value
    return "0" if s in ("-0", "") else s


def _g(value):
    return _num(value)


def _speed(value):
    return _num(value, 8, 7)


def _p(pose):
    return "P(%s)" % ", ".join(_g(v) for v in xyzwpr(pose))


def _j(joints):
    values = list(joints) + [0] * max(0, 8 - len(joints))
    return "J(%s)" % ", ".join(_g(v) for v in values)


def _on(value):
    pass
    return not (value == 0 or value == "0")


def _filter_name(code):
    pass
    code = re.sub(r"[^A-Za-z0-9_()]", "", code)
    return "P" + code if code[:1].isdigit() else code


@register
class DensoRc9(RobotPost):
    name = "Denso_RC9"
    PROG_EXT = "pcs"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.PROGS = []
        self.LINES = []
        self.PASS = ""
        self.SPEED = 500.0
        self.SPEED_J = 100.0
        self.ACCEL = "-1"
        self.ACCEL_J = "-1"

    def addline(self, line):
        self.LINES.append(line)

    def ProgStart(self, progname):
        self.CUR = progname
        self.LINES = []

    def ProgFinish(self, progname):
        self.PROGS.append((self.CUR, self.LINES))
        self.LINES = []

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        progs = self.PROGS or [(progname, self.LINES)]
        out = ["'!TITLE ”%s”" % progname, "", "Sub Main", "  TakeArm Keep = 0", ""]
        out += ["  " + l for l in progs[0][1]] + ["End Sub"]
        for name, lines in progs[1:]:
            out += ["", "Sub %s()" % name] + ["  " + l for l in lines] + ["End Sub"]
        self.save_file(folder, "%s.%s" % (progname, self.PROG_EXT), "\n".join(out) + "\n")

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def _lin(self):
        return "Speed=(Mps(%s), %s)" % (_speed(self.SPEED), self.ACCEL)

    def _name(self):
        if self._TargetName is not None:
            self.addline("' Target: %s" % self._TargetName)

    def MoveJ(self, pose, joints, conf_RLF=None):
        self._name()
        self.addline("Move P, %s%s, Speed=(Dps(%s), %s)" % (self.PASS, _j(joints), _speed(self.SPEED_J), self.ACCEL_J))

    def MoveL(self, pose, joints, conf_RLF=None):
        self._name()
        if pose is None:
            self.addline(JOINT_TARGET_L)
            return
        self.addline("Move L, %s%s, %s" % (self.PASS, _p(pose), self._lin()))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.addline(JOINT_TARGET_C)
            return
        if self._TargetName is not None:
            self.addline("' Target 1: %s" % self._TargetNameVia)
            self.addline("' Target 2: %s" % self._TargetName)
        self.addline("Move C, %s, %s%s, %s" % (_p(pose1), self.PASS, _p(pose2), self._lin()))

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.addline("' Frame: %s" % frame_name)
        self.addline("Work 1, %s" % _p(pose))
        self.addline("ChangeWork 1")

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.addline("' Tool: %s" % tool_name)
        self.addline("Tool 1, %s" % _p(pose))
        self.addline("ChangeTool 1")

    def Pause(self, time_ms):
        if time_ms < 0:
            self.addline('MsgBox("Press OK to continue")')
        else:
            self.addline("Delay %i" % int(time_ms))

    def setSpeed(self, speed_mms):
        self.SPEED = speed_mms

    def setAcceleration(self, accel_mmss):
        self.ACCEL = _speed(min(accel_mmss, 100))

    def setSpeedJoints(self, speed_degs):
        self.SPEED_J = speed_degs

    def setAccelerationJoints(self, accel_degss):
        self.ACCEL_J = _speed(min(accel_degss, 100))

    def setZoneData(self, zone_mm):
        if zone_mm <= 0:
            self.PASS = ""
        elif zone_mm < 1:
            self.PASS = "@P "
        else:
            self.PASS = "@%i " % int(zone_mm)

    
    def setDO(self, io_var, io_value):
        if isinstance(io_var, str):
            return
        self.addline("%s IO[%s]" % ("Set" if _on(io_value) else "Reset", io_var))

    def setAO(self, io_var, io_value):
        pass

    def waitDI(self, io_var, io_value, timeout_ms=-1):  
        if isinstance(io_var, str):
            return
        line = "Wait IO[%s] = %s" % (io_var, "ON" if _on(io_value) else "OFF")
        if timeout_ms is not None and timeout_ms >= 0:
            line += ", %i" % int(timeout_ms)
        self.addline(line)

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            code = _filter_name(code)
            self.addline("Call %s" % (code if "(" in code else code + "()"))
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.addline("' %s" % message)
        else:
            self.addline('MsgBox("%s")' % message)
