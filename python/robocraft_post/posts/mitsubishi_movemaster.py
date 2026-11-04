


















import re

from ..base import RobotPost, register
from ..robomath import mul, xyzabc

JOINT_TARGET_L = "' Linear movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."


def _value(value) -> str:
    if isinstance(value, str):
        return value
    return "1" if value > 0 else "0"


@register
class MitsubishiMovemasterEx(RobotPost):
    name = "Mitsubishi_Movemaster_EX"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.LINES = []
        self.FRAME = None

    def addline(self, line):
        self.LINES.append(line)

    def ProgStart(self, progname):
        pass

    def ProgFinish(self, progname):
        self.addline("RT")

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        self.save_file(folder, "%s.prg" % progname, "".join(l + "\n" for l in self.LINES))

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    def MoveJ(self, pose, joints, conf_RLF=None):
        j = list(joints)
        if len(j) == 6:
            j = j[:3] + j[4:]
        self.addline("MJ " + ",".join("%.6f" % v for v in j))

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.addline(JOINT_TARGET_L)
            return
        absolute = pose if self.FRAME is None else mul(self.FRAME, pose)
        x, y, z, a, b, _c = xyzabc(absolute)
        self.addline("MP %.3f,%.3f,%.3f,%.3f,%.3f" % (x, y, z, b, a))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        pass

    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.FRAME = pose

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.addline("TL %.0f" % pose[2][3])

    def Pause(self, time_ms):
        if time_ms < 0:
            self.addline("Stop")
        else:
            self.addline("TI %d" % round(time_ms / 100.0))

    def setSpeed(self, speed_mms):
        self.addline("SP %d" % min(9, round(speed_mms * 9.0 / 5000.0)))

    def setAcceleration(self, accel_mmss):
        pass

    def setSpeedJoints(self, speed_degs):
        pass

    def setAccelerationJoints(self, accel_degss):
        pass

    def setZoneData(self, zone_mm):
        pass

    def setDO(self, io_var, io_value):
        var = io_var if isinstance(io_var, str) else "OUT(%s)" % io_var
        self.addline("%s=%s" % (var, _value(io_value)))

    def setAO(self, io_var, io_value):
        self.setDO(io_var, io_value)

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        var = io_var if isinstance(io_var, str) else "IN(%s)" % io_var
        line = "Wait %s=%s" % (var, _value(io_value))
        if timeout_ms is not None and timeout_ms >= 0:
            line += " Timeout=%.1f" % timeout_ms
        self.addline(line)

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            self.addline("GS " + re.sub(r"[^A-Za-z0-9_()]", "", code))
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.addline("' %s" % message)
