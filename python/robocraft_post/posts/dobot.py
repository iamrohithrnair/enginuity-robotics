


















import re

from ..base import RobotPost, register
from ..robomath import xyzwpr

JOINT_TARGET_L = "-- Linear movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."
JOINT_TARGET_C = "-- Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."


def _pct(value):
    return max(1, min(100, round(value)))


def _bit(value):
    if isinstance(value, str):
        return 0
    return 1 if value > 0 else 0


@register
class DobotV3(RobotPost):
    name = "Dobot_V3"
    PROG_EXT = "lua"
    VERSION = "V3"
    MOVEJ = "MoveJ({joint={%s}})"
    MOVEL = "Move({coordinate={%s}},'User=9 Tool=9')"
    ARC = "Arc3({coordinate={%s}},{coordinate={%s}},'User=9 Tool=9')"
    SPEED, SPEED_J, ACCEL, ACCEL_J = "SpeedS(%i)", "Speed(%i)", "AccelS(%i)", "Accel(%i)"

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
        out = [
            "--[[Dobot CR program (%s) generated from Enginuity post processor" % self.VERSION,
            "    Dobot script language is based on lua - refer to Dobot %s Programming Manual" % self.VERSION,
            "--]]",
        ]
        out += ["function %s()" % progs[0][0]] + ["\t" + l for l in progs[0][1]] + ["end", ""]
        for name, lines in progs[1:]:
            out += ["function %s()" % name, "\t--Subprogram %s--" % name] + ["\t" + l for l in lines] + ["end", ""]
        out += ["", "--Main program call:--", "%s()" % progname, "", ""]
        self.save_file(folder, "%s.%s" % (progname, self.PROG_EXT), "\n".join(out))

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    @staticmethod
    def _pose(pose):
        return ",".join("%.4f" % v for v in xyzwpr(pose))

    def MoveJ(self, pose, joints, conf_RLF=None):
        self.addline(self.MOVEJ % ", ".join("%.6f" % v for v in joints))

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.addline(JOINT_TARGET_L)
        else:
            self.addline(self.MOVEL % self._pose(pose))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.addline(JOINT_TARGET_C)
        else:
            self.addline(self.ARC % (self._pose(pose1), self._pose(pose2)))

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.addline("SetUser(9,{%s})" % self._pose(pose))

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.addline("SetTool(9,{%s})" % self._pose(pose))

    def Pause(self, time_ms):
        if time_ms > 0:
            self.addline("Wait(%i)" % int(time_ms))

    def setSpeed(self, speed_mms):
        self.addline(self.SPEED % _pct(speed_mms))

    def setAcceleration(self, accel_mmss):
        self.addline(self.ACCEL % _pct(accel_mmss))

    def setSpeedJoints(self, speed_degs):
        self.addline(self.SPEED_J % _pct(speed_degs))

    def setAccelerationJoints(self, accel_degss):
        self.addline(self.ACCEL_J % _pct(accel_degss))

    def setZoneData(self, zone_mm):
        self.addline("CP(%i)" % max(0, min(100, int(zone_mm))))

    
    def setDO(self, io_var, io_value):
        self.addline("DO(%s, %i)" % (io_var, _bit(io_value)))

    def setAO(self, io_var, io_value):
        value = 0 if isinstance(io_value, str) or io_value <= 0 else io_value
        self.addline("AO(%s, %s)" % (io_var, value))

    def _wait(self, io_var, value, timeout_ms):
        line = "WaitDI(%s, %i" % (io_var, value)
        if timeout_ms is not None and timeout_ms >= 0:
            line += ", %.0f" % timeout_ms
        return line + ")"

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        self.addline(self._wait(io_var, _bit(io_value), timeout_ms))

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            code = re.sub(r"[^A-Za-z0-9_()]", "", code)
            self.addline(code if "(" in code else code + "()")
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.addline("-- %s" % message)
        else:
            self.addline('print("%s")' % message)


@register
class DobotV4(DobotV3):
    name = "Dobot_V4"
    VERSION = "V4"
    MOVEJ = "MovJ({joint={%s}})"
    MOVEL = "MovL({pose={%s}},{user = 9, tool = 9})"
    ARC = "Arc({pose={%s}},{pose={%s}},{user = 9, tool = 9})"
    SPEED, SPEED_J, ACCEL, ACCEL_J = "VelL(%i)", "VelJ(%i)", "AccL(%i)", "AccJ(%i)"

    def _wait(self, io_var, value, timeout_ms):
        cond = "%s == %i" % (io_var if isinstance(io_var, str) else "DI(%s)" % io_var, value)
        if timeout_ms is not None and timeout_ms >= 0:
            return 'Wait("%s", %.0f)' % (cond, timeout_ms)
        return 'Wait("%s")' % cond
