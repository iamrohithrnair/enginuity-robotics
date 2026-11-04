














import re

from ..base import RobotPost, register
from ..robomath import euler_zyz

PREAMBLE = [
    "BASE 0,0,0,0",
    "; In case of any problems the task will not be stuck forever.",
    "PARAMETER VTIMEOUT = 5",
    ";",
    "; Make sure power is enabled",
    "IF NOT SWITCH(POWER) THEN",
    'TYPE "Power is not enabled"',
    "PAUSE",
    "END",
    ";",
    "; Robot 1 attached to task",
    "SELECT ROBOT = 1",
    "ATTACH ()",
    ";",
]
JOINT_TARGET_L = "; Linear movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."


def _trans(pose):
    a, e, r = euler_zyz(pose)
    return "TRANS(%.3f,%.3f,%.3f,%.3f,%.3f,%.3f)" % (pose[0][3], pose[1][3], pose[2][3], a, e, r)


def _state(value):
    if isinstance(value, str):
        return value
    return "TRUE" if value > 0 else "FALSE"


@register
class AdeptVplus(RobotPost):
    name = "Adept_Vplus"
    PROG_EXT = "vb1"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.PROGS = []
        self.LINES = []
        self.SPEED = 1000.0

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
            out += [".PROGRAM %s()" % name] + ["  " + l for l in PREAMBLE + lines + ["DETACH()", ";"]] + [".END"]
        self.save_file(folder, "%s.%s" % (progname, self.PROG_EXT), "\n".join(out) + "\n")

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def MoveJ(self, pose, joints, conf_RLF=None):
        for k, v in enumerate(joints):
            self.addline("DRIVE %i, %.3f, %.1f" % (k + 1, v, min(100.0, self.SPEED / 40.0)))
        if pose is not None:
            self.addline("MOVE frame1:%s" % _trans(pose))

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.addline(JOINT_TARGET_L)
        else:
            self.addline("MOVES frame1:%s" % _trans(pose))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        pass  

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.addline("SET frame1 = %s" % _trans(pose))
        self.addline("; Optionally create a frame using 4 points")
        self.addline(";SET frame1 = FRAME(point1x,point2x,pointy,point0)")
        self.addline(";")

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.addline("; Set the tool")
        self.addline("SET tool1 = %s" % _trans(pose))
        self.addline("TOOL tool1")

    def Pause(self, time_ms):
        if time_ms <= 0:
            self.addline("PAUSE")
        else:
            self.addline("DELAY %.3f" % (time_ms / 1000.0))

    def setSpeed(self, speed_mms):
        self.SPEED = speed_mms
        self.addline("SPEED %.1f, 100 MMPS ALWAYS" % speed_mms)

    def setAcceleration(self, accel_mmss):
        a = max(0.0, min(100.0, accel_mmss))
        self.addline("ACCEL %.1f, %.1f" % (a, a))

    def setSpeedJoints(self, speed_degs):
        pass

    def setAccelerationJoints(self, accel_degss):
        pass

    def setZoneData(self, zone_mm):
        pass

    
    def setDO(self, io_var, io_value):
        var = io_var if isinstance(io_var, str) else "OUT[%s]" % io_var
        self.addline("%s=%s" % (var, _state(io_value)))

    def setAO(self, io_var, io_value):
        self.setDO(io_var, io_value)

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        var = io_var if isinstance(io_var, str) else "IN[%s]" % io_var
        line = "WAIT FOR %s==%s" % (var, _state(io_value))
        if timeout_ms is not None and timeout_ms >= 0:
            line += " TIMEOUT=%.1f" % timeout_ms
        self.addline(line)

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            code = re.sub(r"[^A-Za-z0-9_()]", "", code)
            self.addline(code if "(" in code else code + "()")
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.addline("; %s" % message)
        else:
            self.addline('TYPE "%s"' % message)
