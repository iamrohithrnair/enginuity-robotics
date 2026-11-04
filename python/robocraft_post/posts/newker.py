






















import re

from ..base import RobotPost, is_number, register
from ..robomath import xyzwpr

JOINT_TARGET_L = "   ; Linear movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."


def _pose(pose) -> str:
    return "X%.3f Y%.3f Z%.3f A%.3f B%.3f C%.3f" % tuple(xyzwpr(pose))


def _nospace(name) -> str:
    return str(name).replace(" ", "")


@register
class NewkerI6(RobotPost):
    name = "NEWKer_i6"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.LINES = []
        self.SPEED = 50
        self.SPEED_J = 50
        self.ZONE = None

    def addline(self, line):
        self.LINES.append(line)

    def comment(self, text):
        self.addline("   ; %s" % text)

    def ProgStart(self, progname):
        self.addline(";Program %s" % progname)
        self.addline("G53 T1 G90")

    def ProgFinish(self, progname):
        self.addline("M30")

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        self.save_file(folder, "%s.txt" % progname, "".join(l + "\n" for l in self.LINES))

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    def _pl(self):
        return "" if not self.ZONE else "PL=%s " % self.ZONE

    def MoveJ(self, pose, joints, conf_RLF=None):
        j = " ".join("J%d=%.3f" % (i + 1, v) for i, v in enumerate(joints))
        self.addline("G0 VJ=%s %s%s" % (self.SPEED_J, self._pl(), j))

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.addline(JOINT_TARGET_L)
            return
        self.addline("G01 V=%s %s%s" % (self.SPEED, self._pl(), _pose(pose)))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        pass

    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.addline("%s; Change frame to pose: %s" % (_nospace(frame_name), _pose(pose)))

    def setTool(self, pose, tool_id=None, tool_name=None):
        name = _nospace(tool_name)
        self.addline("G10 L10 %s Z%.3f" % (name.replace("Tool", "Pool"), pose[2][3]))
        self.addline("%s; Tool pose is: %s" % (name, _pose(pose)))

    def Pause(self, time_ms):
        if time_ms <= 0:
            self.addline("M01; Option Stop")
        else:
            self.addline("G04 X%.3f" % (time_ms * 0.001))

    def setSpeed(self, speed_mms):
        self.SPEED = speed_mms
        self.comment("Linear speed set to %.2f mm/s" % speed_mms)

    def setAcceleration(self, accel_mmss):
        pass

    def setSpeedJoints(self, speed_degs):
        self.SPEED_J = speed_degs
        self.comment("Joint speed set to %.2f deg/s" % speed_degs)

    def setAccelerationJoints(self, accel_degss):
        pass

    def setZoneData(self, zone_mm):
        self.ZONE = zone_mm
        self.comment("PL set to %s" % zone_mm)

    def setDO(self, io_var, io_value):
        var = io_var if isinstance(io_var, str) else "%02d" % io_var
        if is_number(io_value) and io_value == 1:
            self.addline("M38%s; Turn Y%s On" % (var, var))
        else:
            self.addline("M48%s; Turn Y%s Off" % (var, var))

    def setAO(self, io_var, io_value):
        self.setDO(io_var, io_value)

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        var = io_var if isinstance(io_var, str) else "X%s" % io_var
        if isinstance(io_value, str):
            sign = io_value
        else:
            sign = "+" if io_value == 1 else "-"
        self.addline("WAT %s%s" % (sign, var))

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            self.comment("%s is not a valid function call" % re.sub(r"[^A-Za-z0-9_()]", "", code))
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.comment(message)
        else:
            self.addline("MSG(%s)" % message)
