# Generates uArm CNC commands for joint, linear and circular movements.



















import re

from ..base import RobotPost, register
from ..robomath import mul, xyz

JOINT_TARGET = "; %s movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."


def _value(value) -> str:
    if isinstance(value, str):
        return value
    return "TRUE" if value > 0 else "FALSE"


def _xyz(pose) -> str:
    return "X%.3f Y%.3f Z%.3f" % tuple(xyz(pose))


def call_name(code: str) -> str:
    pass
    call = re.sub(r"[^A-Za-z0-9_()]", "", code)
    return call if "(" in call else call + "()"


@register
class UArm(RobotPost):
    name = "uArm"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.LINES = []
        self.N = 0
        self.FRAME = None

    def addline(self, line):
        self.LINES.append(line)

    def block(self, text):
        self.addline("N%02d %s" % (self.N, text))
        self.N += 1

    def ProgStart(self, progname):
        self.addline("; program: %s()" % progname)
        self.addline("G161")
        self.addline("G90")
        self.addline("F15000")

    def ProgFinish(self, progname):
        self.addline("; ENDPROC")

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        self.save_file(folder, "%s.cnc" % progname, "".join(l + "\n" for l in self.LINES))

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    def _abs(self, pose):
        return pose if self.FRAME is None else mul(self.FRAME, pose)

    def MoveJ(self, pose, joints, conf_RLF=None):
        j = list(joints)
        text = " ".join("N%d V%.6f" % (i, v) for i, v in enumerate(j[:-1]))
        self.block("G2202 %s Q6%.6f" % (text, j[-1]))

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.addline(JOINT_TARGET % "Linear")
            return
        self.block("G0 " + _xyz(self._abs(pose)))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.addline(JOINT_TARGET % "Circular")
            return
        v = xyz(self._abs(pose1))
        self.block("G90 G102 %s I1=%.3f J1=%.3f K1=%.3f" % (_xyz(self._abs(pose2)), v[0], v[1], v[2]))

    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.FRAME = pose
        self.addline("; Reference frame set to: " + _xyz(pose))
        self.addline("; N%02d G90 G92 %s" % (self.N, _xyz(pose)))
        self.N += 1

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.addline("; Tool frame set to: " + _xyz(pose))
        self.addline("; N%02d G90 G92 %s" % (self.N, _xyz(pose)))
        self.N += 1

    def Pause(self, time_ms):
        if time_ms < 0:
            self.addline("; PAUSE")
        else:
            self.addline("; WAIT %.3f" % (time_ms * 0.001))

    def setSpeed(self, speed_mms):
        self.addline("F%.3f" % (speed_mms * 60.0))

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
        self.addline("%s=%s" % (var, _value(io_value)))

    def setAO(self, io_var, io_value):
        self.setDO(io_var, io_value)

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        var = io_var if isinstance(io_var, str) else "IN[%s]" % io_var
        line = "WAIT FOR %s==%s" % (var, _value(io_value))
        if timeout_ms is not None and timeout_ms >= 0:
            line += " TIMEOUT=%.1f" % timeout_ms
        self.addline(line)

    def RunCode(self, code, is_function_call=False):
        self.addline(call_name(code) if is_function_call else code)

    def RunMessage(self, message, iscomment=False):
        self.addline("; %s" % message if iscomment else "; Show message: %s" % message)
