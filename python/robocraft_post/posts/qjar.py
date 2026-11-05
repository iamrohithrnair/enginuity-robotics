# Emits QJAR RBG motion programs with joint and Cartesian target records.














import re

from ..base import RobotPost, register

FRAME_UNDEFINED = "# Frame ID is undefined, assuming U=0. Add an ID to the Reference Frame name to get rid of this message."
TOOL_UNDEFINED = "# Tool ID is undefined, assuming T=0. Add an ID to the Tool name to get rid of this message."


def _clamp(value, low, high):
    return max(low, min(high, value))


@register
class Qjar(RobotPost):
    name = "QJAR"
    PROG_EXT = "rbg"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.PROGS = []
        self.LINES = []
        self.SPEED_J, self.ACCEL_J = 100.0, 100.0
        self.SPEED_L, self.ACCEL_L = 500.0, 2000.0
        self.ZONE = 0
        self.FRAME = 0
        self.TOOL = 0

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
        for k, (name, lines) in enumerate(progs):
            out = lines + ([] if k == 0 else ["RETURN"])
            self.save_file(folder, "%s.%s" % (progname if k == 0 else name, self.PROG_EXT), "".join(l + "\n" for l in out))

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def _move(self, kind, joints, linear):
        j = list(joints)
        if len(j) == 4:  
            j = j[:3]
        values = (j[:6] + [0.0] * 9)[:9]
        if linear:
            params = (self.SPEED_L, 2, self.ACCEL_L, 2, self.ACCEL_L, 2)
        else:
            params = (self.SPEED_J, 1, self.ACCEL_J, 1, self.ACCEL_J, 1)
        tail = "%.2f,%i,%.2f,%i,%.2f,%i,%i,%i,%i,0" % (params + (self.ZONE, self.TOOL, self.FRAME))
        self.addline("%s(%s,%s)" % (kind, ",".join("%.7f" % v for v in values), tail))

    def MoveJ(self, pose, joints, conf_RLF=None):
        self._move("MJ", joints, False)

    def MoveL(self, pose, joints, conf_RLF=None):
        self._move("ML", joints, True)

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        self._move("MC", joints1, True)
        self._move("MC", joints2, True)

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        if frame_id is None or frame_id <= 0:
            self.FRAME = 0
            self.addline(FRAME_UNDEFINED)
        else:
            self.FRAME = frame_id

    def setTool(self, pose, tool_id=None, tool_name=None):
        if tool_id is None or tool_id <= 0:
            self.TOOL = 0
            self.addline(TOOL_UNDEFINED)
        else:
            self.TOOL = tool_id

    def Pause(self, time_ms):
        if time_ms < 0:
            self.addline("PAUSE")
        else:
            self.addline("Sleep(%i)" % int(time_ms))

    def setSpeed(self, speed_mms):
        self.SPEED_L = speed_mms

    def setAcceleration(self, accel_mmss):
        self.ACCEL_L = _clamp(accel_mmss, 100.0, 2000.0)

    def setSpeedJoints(self, speed_degs):
        self.SPEED_J = _clamp(speed_degs, 1.0, 100.0)

    def setAccelerationJoints(self, accel_degss):
        self.ACCEL_J = _clamp(accel_degss, 1.0, 100.0)

    def setZoneData(self, zone_mm):
        self.ZONE = int(_clamp(round(zone_mm), 0, 100))

    
    def setDO(self, io_var, io_value):
        if isinstance(io_var, str):
            self.addline("%s = %s" % (io_var, io_value))
        else:
            self.addline("DO%s = %i" % (io_var, 1 if int(io_value) > 0 else 0))

    def setAO(self, io_var, io_value):
        if isinstance(io_var, str):
            self.addline("%s = %s" % (io_var, io_value))
        else:
            self.addline("AO%s = %.3f" % (io_var, float(io_value)))

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        if isinstance(io_var, str):
            line = "WAIT(%s==%s)" % (io_var, io_value)
        else:
            line = "WAIT(DI%s==%i)" % (io_var, 1 if int(io_value) > 0 else 0)
        if timeout_ms is not None and timeout_ms >= 0:
            line += " T=%i" % int(timeout_ms)
        self.addline(line)

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            self.addline('CALL "%s"' % re.sub(r"[^A-Za-z0-9_()]", "", code))
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.addline("# %s" % message)
        else:
            self.addline('ThrowInfo(2,"%s",1)' % message)
