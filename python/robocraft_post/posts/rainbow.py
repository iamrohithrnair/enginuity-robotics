# Builds Rainbow Robotics WSL programs with motion nodes and point definitions.
















import re

from ..base import RobotPost, register
from ..robomath import xyzwpr

JOINT_TARGET_L = "# Linear movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."
JOINT_TARGET_C = "# Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."


def _ratio(value):
    return max(0.0, min(1.0, value))


def _values(values):
    return ", ".join("%.3f" % v for v in values)


@register
class RainbowRobotics(RobotPost):
    name = "RainbowRobotics"
    PROG_EXT = "wsl"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.PROGS = []
        self.LINES = []
        self.SPEED_J = 0.4
        self.SPEED_L = 0.4
        self.ACCEL_J = 0.1
        self.ACCEL_L = 0.1

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
        for _name, lines in progs:
            out += ["begin"] + lines + ["end"]
        self.save_file(folder, "%s.%s" % (progname, self.PROG_EXT), "\n".join(out) + "\n")

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def _point(self, kind, values):
        self.addline("move %s {" % kind)
        self.addline("  point () absolute %s" % values)
        self.addline("}")

    def MoveJ(self, pose, joints, conf_RLF=None):
        target = _values(xyzwpr(pose)) if pose is not None else "0, 0, 0, 0, 0, 0"
        self._point("joint", "%.3f, %.3f, %s, %s" % (self.SPEED_J, self.ACCEL_J, _values(list(joints)[:6]), target))

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.addline(JOINT_TARGET_L)
            return
        self._point("linear", "%.3f, %.3f, %s, %s" % (self.SPEED_L, self.ACCEL_L, _values(xyzwpr(pose)), _values(list(joints)[:6])))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.addline(JOINT_TARGET_C)
            return
        values = [_values(xyzwpr(pose1)), _values(xyzwpr(pose2)), _values(list(joints1)[:6]), _values(list(joints2)[:6])]
        self.addline("movecircle absolute threepoints intended %.3f, %.3f, %s" % (self.SPEED_L, self.ACCEL_L, ", ".join(values)))

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        pass

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.addline("set rb_tcp_pos %s" % _values(xyzwpr(pose)))
        self.addline("wait (0.005 sec)")

    def Pause(self, time_ms):
        if time_ms < 0:
            self.addline('alarm "Paused" "Program is Paused"')
        else:
            self.addline("wait (%.3f sec)" % (time_ms / 1000.0))

    def setSpeed(self, speed_mms):
        self.SPEED_L = _ratio(speed_mms / 2000.0)

    def setAcceleration(self, accel_mmss):
        self.ACCEL_L = _ratio(accel_mmss / 10000.0)

    def setSpeedJoints(self, speed_degs):
        self.SPEED_J = _ratio(speed_degs / 180.0)

    def setAccelerationJoints(self, accel_degss):
        self.ACCEL_J = _ratio(accel_degss / 1000.0)

    def setZoneData(self, zone_mm):
        pass

    
    def _not_available(self, what, io_var, io_value):
        self.addline("# not available %s parameter" % what)
        self.addline("# %s, %s" % (io_var, io_value))

    def setDO(self, io_var, io_value):
        if isinstance(io_var, str) or isinstance(io_value, str):
            self._not_available("setDO", io_var, io_value)
            return
        self.addline("script {")
        self.addline("    manual_digital_out(%s, %i)" % (io_var, io_value))
        self.addline("}")

    def setAO(self, io_var, io_value):
        if isinstance(io_var, str):
            self._not_available("setAO", io_var, io_value)
            return
        value = io_value if isinstance(io_value, str) else "%.3f" % io_value
        self.addline("script {")
        self.addline("    manual_analog_out(%s, %s)" % (io_var, value))
        self.addline("}")

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        if isinstance(io_var, str) or isinstance(io_value, str):
            self._not_available("waitDI", io_var, io_value)
            return
        self.addline("set rb_time 0.0")
        if timeout_ms is None or timeout_ms < 0:
            self.addline("wait (SD_DIGITAL_IN_%s == %i out)" % (io_var, io_value))
        else:
            self.addline("wait ((SD_DIGITAL_IN_%s == %i) || (SD_TIME>%.3f)  out)" % (io_var, io_value, timeout_ms / 1000.0))

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            code = re.sub(r"[^A-Za-z0-9_()]", "", code)
            self.addline(code if "(" in code else code + "()")
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.addline("# %s" % message)
        else:
            self.addline('alarm "RunMessage" "%s"' % message)
