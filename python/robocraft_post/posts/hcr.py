# Generates HCR JavaScript programs with motion, speed and I/O commands.





























import math
import re

from ..base import RobotPost, register
from ..robomath import mul


def euler_xyz(h):
    pass
    if h[0][2] > 1.0 - 1e-10:
        return [0.0, 90.0, math.atan2(h[1][0], h[1][1]) * 180.0 / math.pi]
    if h[0][2] < -1.0 + 1e-10:
        return [0.0, -90.0, math.atan2(h[1][0], h[1][1]) * 180.0 / math.pi]
    rx = math.atan2(-h[1][2], h[2][2])
    ry = math.atan2(h[0][2], math.sqrt(h[1][2] * h[1][2] + h[2][2] * h[2][2]))
    rz = math.atan2(-h[0][1], h[0][0])
    return [rx * 180.0 / math.pi, ry * 180.0 / math.pi, rz * 180.0 / math.pi]


def _pose(h):
    return "{x: %.3f, y: %.3f, z: %.3f, rx: %.3f, ry: %.3f, rz: %.3f}" % tuple([h[0][3], h[1][3], h[2][3]] + euler_xyz(h))


def _joints(joints):
    return ", ".join("%.6f" % v for v in joints)


@register
class Hcr(RobotPost):
    name = "HCR"
    PROG_EXT = "js"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.LINES = []
        self.FRAME = None
        self.SPEED = 500
        self.ACCEL = 1000
        self.SPEEDJ = 50
        self.ACCELJ = 100

    def addline(self, line):
        self.LINES.append("    " + line)

    def _base(self, pose):
        return mul(self.FRAME, pose) if self.FRAME is not None else pose

    def ProgStart(self, progname):
        self.LINES += ["// -----------------------", "// Program %s" % progname, "function %s(){" % progname]

    def ProgFinish(self, progname):
        self.LINES += ["}", "// End of program %s" % progname, "", ""]

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        self.save_file(folder, "%s.%s" % (progname, self.PROG_EXT), "".join(l + "\n" for l in self.LINES))

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    def MoveJ(self, pose, joints, conf_RLF=None):
        self.addline("moveJoint([%s], %s, %s);" % (_joints(joints), self.SPEEDJ, self.ACCELJ))

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.addline("moveLinear('tcp', convertJointToPose('tcp', [%s]));" % _joints(joints))
        else:
            self.addline("moveLinear('tcp', %s, %s, %s);" % (_pose(self._base(pose)), self.SPEED, self.ACCEL))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.RunMessage("Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement.", True)
            return
        self.addline("moveArc('tcp', %s, %s);" % (_pose(self._base(pose1)), _pose(self._base(pose2))))

    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.FRAME = pose

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.addline("setToolCenterPoint(%s);" % _pose(pose))
        self.addline("// setPayload(0.5, {x:0, y:0, z:150}); // sample 0.5kg, CoG is (0,0,150)")

    def Pause(self, time_ms):
        if time_ms < 0:
            self.addline("halt();")
        else:
            self.addline("wait(%.3f);" % time_ms)

    def setSpeed(self, speed_mms):
        self.SPEED = speed_mms

    def setAcceleration(self, accel_mmss):
        self.ACCEL = accel_mmss

    def setSpeedJoints(self, speed_degs):
        self.SPEEDJ = speed_degs

    def setAccelerationJoints(self, accel_degss):
        self.ACCELJ = accel_degss

    def setZoneData(self, zone_mm):
        pass

    def setDO(self, io_var, io_value):
        if not isinstance(io_value, str):
            io_value = round(io_value)
        self.addline("setGeneralDigitalOutput(%s, %s);" % (io_var, io_value))

    def setAO(self, io_var, io_value):
        self.setDO(io_var, io_value)

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        if timeout_ms is None or timeout_ms < 0:
            self.addline("// wait(getGeneralDigitalInput(0) == 1);")
        else:
            var = "In%s" % io_var if not isinstance(io_var, str) else io_var
            self.addline("// waitGeneralDigitalInput(%s, %s, %.1f);" % (var, io_value, timeout_ms))

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            code = re.sub(r"[^A-Za-z0-9_()]", "", code)
            self.addline(code if "(" in code else code + "()")
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.addline("console.log('Message: ', '%s');" % message)
        else:
            self.addline("popup('%s');" % message)
