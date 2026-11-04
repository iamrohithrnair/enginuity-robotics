






















from ..base import RobotPost, is_number, register
from ..robomath import eye, inv, mul, xyzwpr

JOINT_TARGET_C = "# Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."
CALL_DROP = set(" ,-.+/[]:=*!?&%#@;<>|\\^")


def _call_name(code):
    return "".join(c for c in code if c not in CALL_DROP)


def _state(value):
    if isinstance(value, str):
        return value
    return "ON" if value > 0 else "OFF"


def _pose(pose):
    return ",".join("%.6f" % v for v in xyzwpr(pose)) + ",0.0,0.0"


def _joints(joints):
    return ",".join("%.3f" % v for v in list(joints)[:6])


@register
class Gsk(RobotPost):
    name = "GSK"
    PROG_EXT = "PRL"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.FILES = []  
        self.DECL = []
        self.LINES = []
        self.COUNT = 0
        self.FULL = False
        self.NP = 0
        self.PROG = None
        self.SKIP = False
        self.SPEED_L = 500
        self.SPEED_J = 100
        self.ZONE = 0
        self.FRAME = eye()
        self.TOOL = eye()
        self.LAST = None  

    
    def _limit(self):
        return self.MAX_LINES_X_PROG if self.MAX_LINES_X_PROG > 0 else 0

    def _append(self, line):
        self.LINES.append(line)
        self.COUNT += 1
        if self._limit() and self.COUNT >= self._limit():
            self.FULL = True

    def _begin_file(self):
        k = len(self.FILES)
        self.DECL, self.LINES, self.COUNT, self.FULL = [], [], 0, False
        self._append("# Program: %s" % (self.PROG if k == 0 else "%s%i" % (self.PROG, k)))

    def addline(self, line):
        if self.SKIP:
            return
        if self.FULL:
            self.FILES.append((self.DECL, self.LINES))
            self._begin_file()
            self.NP = 0
        self._append(line)

    def _declare(self, idx, values):
        if not self.SKIP:
            self.DECL.append("P%03i=%s;" % (idx, values))

    def _fits(self, lines):
        pass
        if self._limit() and self.COUNT + lines > self._limit():
            self.NP = 0

    def ProgStart(self, progname):
        if self.PROG is not None:
            self.SKIP = True  
            return
        self.PROG = progname
        self._begin_file()

    def ProgFinish(self, progname):
        pass

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        files = self.FILES + [(self.DECL, self.LINES)]
        names = [progname] + ["%s%i" % (progname, k) for k in range(1, len(files))]
        for name, (decl, lines) in zip(names, files):
            self.save_file(folder, "%s.%s" % (name, self.PROG_EXT), "\n".join(decl + ["MAIN;"] + lines + ["END;"]) + "\n")
        if len(files) > 1:
            main = ["MAIN;", "# %sMain " % progname] + ["CALL %s;" % name for name in names] + ["END;"]
            self.save_file(folder, "%sMain.%s" % (progname, self.PROG_EXT), "\n".join(main) + "\n")

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def _zone(self):
        return max(0, min(4, int(self.ZONE)))

    def _move(self, kind, values, speed):
        self._fits(1)
        idx = self.NP
        self._declare(idx, values)
        self.addline("%s P%i, V%i, Z%i;" % (kind, idx, speed, self._zone()))
        self.NP += 1

    def MoveJ(self, pose, joints, conf_RLF=None):
        if pose is None:
            self._move("MOVJ", _joints(joints), min(100, int(self.SPEED_J)))
            self.LAST = None
        else:
            self._move("MOVJ", _pose(pose), int(self.SPEED_L))  

    def MoveL(self, pose, joints, conf_RLF=None):
        self._move("MOVL", _joints(joints) if pose is None else _pose(pose), int(self.SPEED_L))
        self.LAST = pose

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.addline(JOINT_TARGET_C)
            return
        self._fits(3)
        points = ([self.LAST] if self.LAST is not None else []) + [pose1, pose2]
        for pose in points:
            idx = self.NP
            self.addline("MOVC P%i, V%i, Z%i;" % (idx, int(self.SPEED_L), self._zone()))
            self._declare(idx, _pose(mul(mul(self.FRAME, pose), inv(self.TOOL))))
            self.NP += 1
        self.LAST = pose2

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.FRAME = pose
        self.addline("# using reference frame: %s" % frame_name)
        self.addline("# %s" % _pose(pose))

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.TOOL = pose
        self.addline("# using tool frame: %s" % tool_name)
        self.addline("# %s" % _pose(pose))

    def Pause(self, time_ms):
        if time_ms <= 0:
            self.addline("STOP")
        else:
            self.addline("DELAY T%.3f;" % (time_ms / 1000.0))

    def setSpeed(self, speed_mms):
        self.SPEED_L = speed_mms

    def setAcceleration(self, accel_mmss):
        pass

    def setSpeedJoints(self, speed_degs):
        self.SPEED_J = speed_degs

    def setAccelerationJoints(self, accel_degss):
        pass

    def setZoneData(self, zone_mm):
        self.ZONE = zone_mm

    
    def setDO(self, io_var, io_value):
        var = "OT%s" % io_var if is_number(io_var) else str(io_var)
        self.addline("DOUT %s, %s;" % (var, _state(io_value)))

    def setAO(self, io_var, io_value):
        self.setDO(io_var, io_value)

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        var = "IN%s" % io_var if is_number(io_var) else str(io_var)
        timeout = timeout_ms if timeout_ms is not None and timeout_ms > 0 else 0
        self.addline("WAIT %s, %s, T%.1f;" % (var, _state(io_value), timeout))

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            name = _call_name(code)
            self.addline(name if name.endswith(")") else "CALL %s;" % name)
        else:
            self.addline("%s;" % code)

    def RunMessage(self, message, iscomment=False):
        self.addline("# %s" % message if iscomment else "# Show message: %s" % message)
