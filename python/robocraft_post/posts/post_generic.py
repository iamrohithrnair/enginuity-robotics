# Emits generic CNC-style joint and Cartesian motion commands.














from ..base import RobotPost, register
from ..robomath import xyzabc


def _pose(pose):
    return "X %7.3f Y %7.3f Z %7.3f A %7.3f B %7.3f C %7.3f" % tuple(xyzabc(pose))


def _joints(joints):
    return " ".join("%s %12.6f" % (chr(ord("D") + i), v) for i, v in enumerate(joints))


def _value(value):
    pass
    if isinstance(value, str):
        return value
    return "TRUE" if value > 0 else "FALSE"


@register
class PostGeneric(RobotPost):
    name = "Post_Generic"
    PROG_EXT = "cnc"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.LINES = []

    def addline(self, line):
        self.LINES.append(line)

    def ProgStart(self, progname):
        self.addline("; program: %s()" % progname)
        self.addline("G161")
        self.addline("G90")
        self.addline("F15000")

    def ProgFinish(self, progname):
        self.addline("; ENDPROC")

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        self.save_file(folder, "%s.%s" % (progname, self.PROG_EXT), "".join(l + "\n" for l in self.LINES))

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def MoveJ(self, pose, joints, conf_RLF=None):
        self.addline("G00  " + _joints(joints))

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.addline("; Linear movement using joint targets is not supported. Change the target type to cartesian or use a joint movement.")
            return
        self.addline("G01  %s   %s" % (_pose(pose), _joints(joints)))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.addline("; Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement.")
            return
        self.addline("G02A %s   %s" % (_pose(pose1), _joints(joints1)))
        self.addline("G02B %s   %s" % (_pose(pose2), _joints(joints2)))

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.addline("; Setting reference frame:")
        self.addline("; %s: %s" % (frame_name, _pose(pose)))

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.addline("; Setting tool frame:")
        self.addline("; %s: %s" % (tool_name, _pose(pose)))

    def Pause(self, time_ms):
        if time_ms < 0:
            self.addline("; PAUSE")
        else:
            self.addline("; WAIT %.3f" % (time_ms / 1000.0))

    def setSpeed(self, speed_mms):
        self.addline("F%.3f" % (speed_mms * 60.0))

    def setAcceleration(self, accel_mmss):
        pass

    def setSpeedJoints(self, speed_degs):
        pass

    def setAccelerationJoints(self, accel_degss):
        pass

    def setZoneData(self, zone_mm):
        self.addline("; Rounding set to %.1f mm" % zone_mm)

    
    def setDO(self, io_var, io_value):
        var = "OUT[%s]" % io_var if not isinstance(io_var, str) else io_var
        self.addline("%s=%s" % (var, _value(io_value)))

    def setAO(self, io_var, io_value):
        self.setDO(io_var, io_value)

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        var = "IN[%s]" % io_var if not isinstance(io_var, str) else io_var
        if timeout_ms is None or timeout_ms < 0:
            self.addline("WAIT FOR %s==%s" % (var, _value(io_value)))
        else:
            self.addline("WAIT FOR %s==%s TIMEOUT=%.1f" % (var, _value(io_value), timeout_ms))

    def RunCode(self, code, is_function_call=False):
        if is_function_call and "(" not in code:
            code += "()"
        self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.addline("; %s" % message)
        else:
            self.addline("; Show message: %s" % message)
