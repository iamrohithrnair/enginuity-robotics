# Emits Siasun SPF routines with joint, linear and circular motion commands.
















import re

from ..base import RobotPost, register
from ..robomath import xyzwpr

JOINT_TARGET_L = "# Linear movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."
JOINT_TARGET_C = "# Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."


def _pose(pose, fmt):
    return ", ".join(fmt % v for v in xyzwpr(pose))


@register
class Siasun(RobotPost):
    name = "Siasun"
    PROG_EXT = "spf"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.PROGS = []
        self.LINES = []
        self.SPEED = 1.0
        self.ACCEL = 1.0
        self.SPEED_J = 25.0
        self.ACCEL_J = 1.0
        self.ZONE = 0.0

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
            out += ["# PROC %s()" % name, ""] + lines + ["", "# ENDPROC %s()" % name]
        self.save_file(folder, "%s.%s" % (progname, self.PROG_EXT), "\n".join(out) + "\n")

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def MoveJ(self, pose, joints, conf_RLF=None):
        values = ", ".join("%.4f" % v for v in joints)
        self.addline("movej([%s], %.0f, %.0f, %.0f);" % (values, self.SPEED_J, self.ACCEL_J, self.ZONE))

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.addline(JOINT_TARGET_L)
            return
        self.addline("movel([%s], %.0f, %.0f, %.0f);" % (_pose(pose, "%.3f"), self.SPEED, self.ACCEL, self.ZONE))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.addline(JOINT_TARGET_C)
            return
        self.addline("movec([%s], [%s], %.1f, %.1f, %.1f);" % (_pose(pose1, "%.3f"), _pose(pose2, "%.3f"), self.SPEED, self.ACCEL, self.ZONE))

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.addline("coordinate_user(%s);" % _pose(pose, "%.2f"))

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.addline("coordinate_tool(%s);" % _pose(pose, "%.2f"))

    def Pause(self, time_ms):
        if time_ms < 0:
            self.addline("PAUSE")
        else:
            self.addline("sleep( %.0f );" % time_ms)

    def setSpeed(self, speed_mms):
        self.SPEED = speed_mms

    def setAcceleration(self, accel_mmss):
        self.ACCEL = accel_mmss

    def setSpeedJoints(self, speed_degs):
        self.SPEED_J = speed_degs / 120.0 * 100.0

    def setAccelerationJoints(self, accel_degss):
        self.ACCEL_J = accel_degss

    def setZoneData(self, zone_mm):
        self.ZONE = zone_mm

    
    def setDO(self, io_var, io_value):
        if isinstance(io_value, int) and not isinstance(io_value, bool) and io_value >= 0:
            value = "1" if io_value > 0 else "0"
        else:
            self.addline("# Invalid I/O value.")
            value = str(io_value)
        self.addline("io_out(%s, %s);" % (io_var, value))

    def setAO(self, io_var, io_value):
        self.addline("io_out(%s, %s);" % (io_var, io_value))

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        self.addline("io_in(%s);" % io_var)

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            self.addline('sub_prog("%s.spf");' % re.sub(r"[^A-Za-z0-9_()]", "", code))
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.addline("# %s" % message)
        else:
            self.addline('print_s("%s");' % message)
