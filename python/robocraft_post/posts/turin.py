# Emits Turin robot motion commands with speed, acceleration and blending settings.



















import math

from ..base import RobotPost, register
from .uarm import call_name

JOINT_TARGET = "## %s movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."


def euler_xyz(h):
    pass
    s = h[0][2]
    if abs(s) > 1.0 - 1e-12:
        b = math.copysign(90.0, s)
        return [0.0, b, math.atan2(h[1][0], h[1][1]) * 180.0 / math.pi]
    a = math.atan2(-h[1][2], h[2][2])
    b = math.asin(s)
    c = math.atan2(-h[0][1], h[0][0])
    return [a * 180.0 / math.pi, b * 180.0 / math.pi, c * 180.0 / math.pi]


def _pose(pose) -> str:
    if pose is None:
        return ",".join(["0.000"] * 6)
    return ",".join("%.3f" % v for v in [pose[0][3], pose[1][3], pose[2][3]] + euler_xyz(pose))


def _joints(joints) -> str:
    j = list(joints) + [0.0] * (9 - len(joints))
    return ",".join("%.3f" % v for v in j[:9])


@register
class Turin(RobotPost):
    name = "Turin"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.LINES = []
        self.PROG_COUNT = 0
        self.SPEED = 5.0
        self.ACCEL = 30.0
        self.SPEED_J = 10.0
        self.ACCEL_J = 10.0
        self.ZONE = 0.0

    def addline(self, line):
        if self.PROG_COUNT <= 1:
            self.LINES.append(line)

    def ProgStart(self, progname):
        self.PROG_COUNT += 1

    def ProgFinish(self, progname):
        pass

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        self.save_file(folder, "%s.txt" % progname, "".join(l + "\n" for l in self.LINES))

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    def _move(self, kind, pose, joints, speed, accel, zone):
        self.addline("%s(%s,0,0,0,%s,%.3f,%.3f,1,%.3f,1,1)" % (kind, _pose(pose), _joints(joints), speed, accel, zone))

    def MoveJ(self, pose, joints, conf_RLF=None):
        self._move("MoveJ", pose, joints, self.SPEED_J, self.ACCEL_J, self.ZONE)

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.addline(JOINT_TARGET % "Linear")
            return
        self._move("MoveL", pose, joints, self.SPEED, self.ACCEL, self.ZONE)

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.addline(JOINT_TARGET % "Circular")
            return
        self._move("MoveC", pose1, joints1, self.SPEED, self.ACCEL, 0.0)
        self._move("MoveC", pose2, joints2, self.SPEED, self.ACCEL, 0.0)

    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.addline("SetUserParam(1,%s)" % _pose(pose))

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.addline("SetToolParam(1,%s)" % _pose(pose))

    def Pause(self, time_ms):
        if time_ms < 0:
            self.addline("Pause()")
        else:
            self.addline("Sleep(%.3f)" % time_ms)

    def setSpeed(self, speed_mms):
        self.SPEED = min(speed_mms / 50.0, 100.0)

    def setAcceleration(self, accel_mmss):
        self.ACCEL = accel_mmss / 50.0

    def setSpeedJoints(self, speed_degs):
        self.SPEED_J = speed_degs / 50.0

    def setAccelerationJoints(self, accel_degss):
        pass

    def setZoneData(self, zone_mm):
        self.ZONE = min(max(zone_mm, 0.0), 100.0)

    def setDO(self, io_var, io_value):
        self.addline("IOOut=(%s,%s)" % (io_var, io_value))

    def setAO(self, io_var, io_value):
        self.addline("DAOut=(%s,%s)" % (io_var, io_value))

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        if timeout_ms is not None and timeout_ms >= 0:
            self.addline("## Wait instruction does not support time out.")
        self.addline("Wait(%s==%s)" % (io_var, io_value))

    def RunCode(self, code, is_function_call=False):
        self.addline(call_name(code) if is_function_call else code)

    def RunMessage(self, message, iscomment=False):
        self.addline("## %s" % message if iscomment else "PrintMsg(0,%s)" % message)
