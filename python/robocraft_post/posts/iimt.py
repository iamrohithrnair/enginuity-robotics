



















import math

from ..base import RobotPost, register


def _joints(joints):
    return "{" + "".join("%f " % v for v in joints) + "}"


@register
class Iimt(RobotPost):
    name = "IIMT"
    PROG_EXT = "lua"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.PROGS = []
        self.LINES = None
        self.ACCELJ = 100.0
        self.SPEEDJ = 100.0
        self.ZONE = 0.0

    def addline(self, line):
        if self.LINES is None:
            self.ProgStart("")
        self.LINES.append("  " + line)

    def ProgStart(self, progname):
        self.LINES = []
        self.PROGS.append((progname, self.LINES))

    def ProgFinish(self, progname):
        pass

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        for name, lines in self.PROGS:
            self.save_file(folder, "%s.%s" % (name or progname, self.PROG_EXT), "".join(l + "\n" for l in lines))

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    def _params(self):
        return "%f,%f,0,%f" % (self.ACCELJ, self.SPEEDJ, self.ZONE)

    def MoveJ(self, pose, joints, conf_RLF=None):
        self.addline("movej(%s,%s)" % (_joints(joints), self._params()))

    def MoveL(self, pose, joints, conf_RLF=None):
        self.addline("movel(%s,%s)" % (_joints(joints), self._params()))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        self.addline("movep(%s,%s,%s)" % (_joints(joints1), _joints(joints2), self._params()))

    def setFrame(self, pose, frame_id=None, frame_name=None):
        pass

    def setTool(self, pose, tool_id=None, tool_name=None):
        pass

    def Pause(self, time_ms):
        if time_ms > 0:
            self.addline("wait(%.3f)" % time_ms)

    def setSpeed(self, speed_mms):
        pass

    def setAcceleration(self, accel_mmss):
        pass

    def setSpeedJoints(self, speed_degs):
        self.SPEEDJ = speed_degs * math.pi / 180.0

    def setAccelerationJoints(self, accel_degss):
        self.ACCELJ = accel_degss * math.pi / 180.0

    def setZoneData(self, zone_mm):
        self.ZONE = zone_mm

    def setDO(self, io_var, io_value):
        if not isinstance(io_value, str):
            io_value = 1 if io_value > 0 else 0
        self.addline("setDO(%s,%s)" % (io_var, io_value))

    def setAO(self, io_var, io_value):
        try:
            io_value = "%.3f" % float(io_value)
        except ValueError:
            pass
        self.addline("setAO(%s,%s)" % (io_var, io_value))

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        pass

    def RunCode(self, code, is_function_call=False):
        if not is_function_call:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.addline("-- %s" % message)
