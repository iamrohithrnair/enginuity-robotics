# Generates Yamaha programs with per-axis drives, Cartesian motion and I/O commands.



























from ..base import RobotPost, register
from ..robomath import mul, xyzwpr

STARS = "'**********************************"
JOINT_TARGET_L = "' Linear movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."
JOINT_TARGET_C = "' Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."


def pose_text(pose):
    return " ".join("%.3f" % v for v in xyzwpr(pose))


def value_text(value):
    if isinstance(value, str):
        return value
    return "TRUE" if value > 0 else "FALSE"


def io_name(var, kind):
    if isinstance(var, str):
        return var
    return "%s[%s]" % (kind, var)


def speed_index(value, unit):
    pass
    return min(100, max(1, int(value / unit)))


@register
class Yamaha(RobotPost):
    name = "Yamaha"
    PROG_EXT = "prg"
    
    SPEED_UNIT = 5000.0
    ACCEL_UNIT = 500.0

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.LINES = []
        self.NPROGS = 0
        self.FRAME = None

    def addline(self, line):
        self.LINES.append(line)

    def ProgStart(self, progname):
        self.NPROGS += 1
        if self.NPROGS == 1:
            self.addline("'" + "%" * 34)
            self.addline("' Main program: %s" % progname)
        else:
            self.addline("'")
            self.addline(STARS)
            self.addline("'Sub Routine: %s " % progname)
            self.addline(STARS)
            self.addline("*%s:" % progname)

    def ProgFinish(self, progname):
        self.addline("' End program")
        self.addline("HALT" if self.NPROGS == 1 else "RETURN")

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        self.save_file(folder, "%s.%s" % (progname, self.PROG_EXT), "".join(l + "\n" for l in self.LINES))

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    def _base(self, pose):
        return mul(self.FRAME, pose) if self.FRAME is not None else pose

    def MoveJ(self, pose, joints, conf_RLF=None):
        for i, v in enumerate(joints):
            self.addline("DRIVE(%d,%.3f)" % (i + 1, v))

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.addline(JOINT_TARGET_L)
            return
        self.addline("MOVE L,%s" % pose_text(self._base(pose)))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.addline(JOINT_TARGET_C)
            return
        self.addline("MOVE C,%s, %s" % (pose_text(self._base(pose1)), pose_text(self._base(pose2))))

    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.FRAME = pose
        self.addline("'BASE_FRAME: %s" % pose_text(pose))

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.addline("'TOOL_FRAME: %s" % pose_text(pose))

    def Pause(self, time_ms):
        if time_ms < 0:
            self.addline("HALT")
        else:
            self.addline("DELAY %.3f" % time_ms)

    def setSpeed(self, speed_mms):
        self.addline("SPEED %d" % speed_index(speed_mms, self.SPEED_UNIT))

    def setAcceleration(self, accel_mmss):
        self.addline("ACCEL %d" % speed_index(accel_mmss, self.ACCEL_UNIT))

    def setSpeedJoints(self, speed_degs):
        pass

    def setAccelerationJoints(self, accel_degss):
        pass

    def setZoneData(self, zone_mm):
        pass

    def setDO(self, io_var, io_value):
        self.addline("%s=%s" % (io_name(io_var, "OUT"), value_text(io_value)))

    def setAO(self, io_var, io_value):
        self.setDO(io_var, io_value)

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        line = "WAIT FOR %s==%s" % (io_name(io_var, "IN"), value_text(io_value))
        if timeout_ms >= 0:
            line += " TIMEOUT=%.1f" % timeout_ms
        self.addline(line)

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            name = code.replace(" ", "").replace(",", "")
            self.addline("GOSUB *%s        ' Call sub routine: %s" % (name, name))
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.addline("' %s" % message)
        else:
            self.addline('PRINT "%s"' % message)
