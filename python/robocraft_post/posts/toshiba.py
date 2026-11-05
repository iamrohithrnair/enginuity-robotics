# Emits Toshiba motion programs with joint and Cartesian motion targets.















import math
import re

from ..base import RobotPost, register


def _c(pose):
    return math.degrees(math.acos(max(-1.0, min(1.0, pose[0][0]))))


def _trans(pose):
    return "TRANS(%.3f,%.3f,%.3f,%.3f)" % (pose[0][3], pose[1][3], pose[2][3], _c(pose))


def _state(value):
    if isinstance(value, str):
        return value
    return "TRUE" if value > 0 else "FALSE"


@register
class Toshiba(RobotPost):
    name = "Toshiba"
    PROG_EXT = "txt"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.PROGS = []
        self.LINES = []

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
        out = []
        for name, lines in progs:
            out += ["PROGRAM %s" % name] + ["  " + l for l in lines] + ["END"]
        self.save_file(folder, "%s.%s" % (progname, self.PROG_EXT), "\n".join(out) + "\n")

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    @staticmethod
    def _target(pose, joints):
        if pose is None:
            return "{%s}" % ",".join("%.5f" % v for v in joints)
        j = list(joints)  
        return "POINT(%.3f,%.3f,%.3f,%.3f, %.1f, %i)" % (pose[0][3], pose[1][3], pose[2][3], _c(pose), j[3], 2 if j[1] < 0 else 1)

    def MoveJ(self, pose, joints, conf_RLF=None):
        self.addline("MOVE %s" % self._target(pose, joints))

    def MoveL(self, pose, joints, conf_RLF=None):
        self.addline("MOVES %s" % self._target(pose, joints))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        self.addline("MOVEC %s %s" % (self._target(pose1, joints1), self._target(pose2, joints2)))

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.addline("BASE = %s" % _trans(pose))

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.addline("TOOL = %s" % _trans(pose))

    def Pause(self, time_ms):
        if time_ms <= 0:
            self.addline("PAUSE")
        else:
            self.addline("DELAY %.3f" % (time_ms / 1000.0))

    def setSpeed(self, speed_mms):
        self.addline("SPEED=%.0f" % max(100, speed_mms / 5000.0 * 100.0))

    def setAcceleration(self, accel_mmss):
        pass

    def setSpeedJoints(self, speed_degs):
        pass

    def setAccelerationJoints(self, accel_degss):
        pass

    def setZoneData(self, zone_mm):
        pass

    
    def setDO(self, io_var, io_value):
        var = io_var if isinstance(io_var, str) else "OUT[%s]" % io_var
        self.addline("%s=%s" % (var, _state(io_value)))

    def setAO(self, io_var, io_value):
        self.setDO(io_var, io_value)

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        var = io_var if isinstance(io_var, str) else "IN[%s]" % io_var
        line = "WAIT FOR %s==%s" % (var, _state(io_value))
        if timeout_ms is not None and timeout_ms >= 0:
            line += " TIMEOUT=%.1f" % timeout_ms
        self.addline(line)

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            code = re.sub(r"[^A-Za-z0-9_()]", "", code)
            self.addline(code if "(" in code else code + "()")
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        self.addline("REMARK %s" % message)
