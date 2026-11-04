





















import math

from ..base import PostError, RobotPost, register
from ..robomath import xyzwpr

COMMENT_CHUNK = 61
MESSAGE_CHUNK = 54
JOINT_TARGET_C = "Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."


def _pct(value):
    return "%i%%" % max(1, min(100, int(round(value))))

ATTR = """/ATTR
OWNER\t\t= MNEDITOR;
COMMENT\t\t= "Enginuity sequence";
PROG_SIZE\t= 0;
CREATE\t\t= DATE 31-12-14  TIME 12:00:00;
MODIFIED\t= DATE 31-12-14  TIME 12:00:00;
FILE_NAME\t= {name};
VERSION\t\t= 0;
LINE_COUNT\t= {count};
MEMORY_SIZE\t= 0;
PROTECT\t\t= READ_WRITE;
TCD:  STACK_SIZE\t= 0,
      TASK_PRIORITY\t= 50,
      TIME_SLICE\t= 0,
      BUSY_LAMP_OFF\t= 0,
      ABORT_REQUEST\t= 0,
      PAUSE_REQUEST\t= 0;
DEFAULT_GROUP\t= {group};
CONTROL_CODE\t= 00000000 00000000;
"""


def _io(value):
    pass
    if isinstance(value, str):
        return "(%s)" % value
    return "ON" if value > 0 else "OFF"


def _scara_config(conf, joints) -> str:
    pass
    flip = (list(conf or [0, 0, 0]) + [0, 0, 0])[2]
    j = list(joints or []) + [0.0] * 4
    return "%s, 0, 0, %i" % ("R" if flip else "L", _turn(j[3]))


def _config(conf, joints) -> str:
    rear, lower, flip = (list(conf or [0, 0, 0]) + [0, 0, 0])[:3]
    letters = "%s %s %s" % ("F" if flip else "N", "D" if lower else "U", "B" if rear else "T")
    j = list(joints or []) + [0.0] * 6
    turns = [_turn(j[k]) for k in (0, 3, 5)]
    return "%s, %i, %i, %i" % (letters, turns[0], turns[1], turns[2])


def _turn(angle):
    pass
    t = abs(angle) / 360.0
    n = int(math.floor(t + 0.5))
    return n if angle >= 0 else -n


@register
class FanucR30i(RobotPost):
    name = "Fanuc_R30i"
    PROG_EXT = "LS"
    GROUP = "1,*,*,*,*,*,*"
    NAME_LEN = None  
    CALL_LEN = None  

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.SPEED = 200.0
        self.JOINT_PCT = _pct(20)
        self.CNT = "FINE"
        self.ACC = ""
        self.UF = 9
        self.UT = 9
        self.PROGS = []
        self.LINES = None
        self.POINTS = None
        self.LBL = 0

    def ProgStart(self, progname):
        self.CUR = progname
        self.LINES = []
        self.POINTS = []

    def ProgFinish(self, progname):
        self.PROGS.append((self.CUR, self.LINES or [], self.POINTS or []))
        self.LINES = None
        self.POINTS = None

    def addline(self, text):
        pass
        if self.LINES is None:
            self.LINES = []
        self.LINES.append("  %s ;" % text)

    def addraw(self, text):
        if self.LINES is None:
            self.LINES = []
        self.LINES.append(text)

    def _file(self, name, lines, points) -> str:
        out = "/PROG  %s\n" % name + ATTR.format(name=name, count=len(lines), group=self.GROUP) + "/MN\n"
        out += "".join("%4i:%s\n" % (i + 1, l) for i, l in enumerate(lines))
        out += "/POS\n" + "".join(points) + "/END\n"
        return out

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        progs = self.PROGS or [(progname, self.LINES or [], self.POINTS or [])]
        n = self.MAX_LINES_X_PROG
        if n > 0 and any(len(lines) > n for _, lines, _ in progs):
            self.stdout.append("Can't split M_%s: Two or more programs are split into smaller programs" % progname)
            raise PostError("Only one program at a time can be split into smaller programs")
        for i, (name, lines, points) in enumerate(progs):
            fname = (progname if i == 0 else name)[: self.NAME_LEN]
            self.save_file(folder, "%s.%s" % (fname, self.PROG_EXT), self._file(fname, lines, points))

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def _scara(self):
        pass
        return False

    def _point_joints(self, joints) -> int:
        idx = len(self.POINTS or []) + 1
        j = list(joints or [])
        if self._scara():
            
            cells = ["\t%s=    %.6f %s" % ("J%i" % (k + 1), v, " mm" if k == 2 else "deg") for k, v in enumerate(j)]
        else:
            cells = ["\t%s=    %.3f deg" % ("J%i" % (k + 1), v) for k, v in enumerate(j)]
        rows = [",".join(cells[k : k + 3]) for k in range(0, len(cells), 3)]
        body = ",\n".join(rows) + self._ext(j)
        text = "P[%i]{\n   GP1:\n    UF : %i, UT : %i,    \n%s\n};\n" % (idx, self.UF, self.UT, body)
        self.POINTS.append(text)
        return idx

    def _ext(self, joints):
        pass
        if not self._scara() or "T" not in self.AXES_TYPE:
            return ""
        return ",\n\tE1=%10.3f  mm" % joints[self.AXES_TYPE.index("T")]

    def _point_pose(self, pose, joints, conf) -> int:
        idx = len(self.POINTS or []) + 1
        x, y, z, w, p, r = xyzwpr(pose)
        cfg = _scara_config(conf, joints) if self._scara() else _config(conf, joints)
        text = (
            "P[%i]{\n   GP1:\n    UF : %i, UT : %i,        CONFIG : '%s',\n" % (idx, self.UF, self.UT, cfg)
            + "\tX = %9.3f  mm,\tY = %9.3f  mm,\tZ = %9.3f  mm,\n" % (x, y, z)
            + "\tW = %9.3f deg,\tP = %9.3f deg,\tR = %9.3f deg%s\n};\n" % (w, p, r, self._ext(list(joints or [])))
        )
        self.POINTS.append(text)
        return idx

    def _target(self, pose, joints, conf) -> int:
        if self.POINTS is None:
            self.POINTS = []
        return self._point_joints(joints) if pose is None else self._point_pose(pose, joints, conf)

    
    def MoveJ(self, pose, joints, conf_RLF=None):
        idx = self._target(None, joints, conf_RLF)
        self.addraw("J P[%i] %s %s%s ;" % (idx, self.JOINT_PCT, self.CNT, self.ACC))

    def MoveL(self, pose, joints, conf_RLF=None):
        idx = self._target(pose, joints, conf_RLF)
        self.addraw("L P[%i] %.0fmm/sec %s%s ;" % (idx, self.SPEED, self.CNT, self.ACC))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self._comment(JOINT_TARGET_C)
            return
        i1 = self._target(pose1, joints1, conf_RLF_1)
        i2 = self._target(pose2, joints2, conf_RLF_2)
        self.addraw("C P[%i] \n       P[%i] %.0fmm/sec %s%s ;" % (i1, i2, self.SPEED, self.CNT, self.ACC))

    
    def _load_pr(self, pose):
        for k, v in enumerate(xyzwpr(pose)):
            self.addline("PR[9,%i]=%.3f" % (k + 1, v))

    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.UF = 9 if frame_id is None or frame_id < 0 else int(frame_id)
        self._load_pr(pose)
        self.addline("UFRAME[%i]=PR[9]" % self.UF)
        self.addline("UFRAME_NUM=%i" % self.UF)

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.UT = 9 if tool_id is None or tool_id < 0 else int(tool_id)
        self._load_pr(pose)
        self.addline("UTOOL[%i]=PR[9]" % self.UT)
        self.addline("UTOOL_NUM=%i" % self.UT)

    def Pause(self, time_ms):
        if time_ms <= 0:
            self.addline("PAUSE")
        else:
            self.addline("WAIT  %.2f(sec)" % (time_ms * 0.001))

    def setSpeed(self, speed_mms):
        self.SPEED = speed_mms
        self.JOINT_PCT = _pct(speed_mms / 50.0)

    def setAcceleration(self, accel_mmss):
        self.ACC = " ACC100"

    def setSpeedJoints(self, speed_degs):
        self.JOINT_PCT = _pct(speed_degs / 2.0)

    def setAccelerationJoints(self, accel_degss):
        self.ACC = " ACC100"

    def setZoneData(self, zone_mm):
        self.CNT = "FINE" if zone_mm < 0 else "CNT%i" % min(100, round(zone_mm))

    
    def setDO(self, io_var, io_value):
        var = "DO[%s]" % io_var if isinstance(io_var, int) else str(io_var)
        self.addline("%s=%s" % (var, _io(io_value)))

    def setAO(self, io_var, io_value):
        var = "AO[%s]" % io_var if isinstance(io_var, int) else str(io_var)
        self.addline("%s=(%s)" % (var, io_value))

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        var = "DI[%s]" % io_var if isinstance(io_var, int) else str(io_var)
        value = _io(io_value)
        if timeout_ms is None or timeout_ms <= 0:
            self.addline("WAIT %s=%s" % (var, value))
            return
        self.LBL += 1
        self.addline("$WAITTMOUT=%i" % timeout_ms)
        self.addline("WAIT %s=%s TIMEOUT, LBL[%i]" % (var, value, self.LBL))
        self.addline("MESSAGE[Timed out for LBL %i]" % self.LBL)
        self.addline("PAUSE")
        self.addline("LBL[%i]" % self.LBL)

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            name, paren, args = code.partition("(")
            name = name.replace(" ", "")[: self.CALL_LEN]
            self.addline("CALL %s%s%s" % (name, paren, args))
        else:
            self.addraw("  %s;" % code)

    def _comment(self, message):
        for k in range(0, max(len(message), 1), COMMENT_CHUNK):
            self.addline("! %s" % message[k : k + COMMENT_CHUNK])

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self._comment(message)
        else:
            for k in range(0, max(len(message), 1), MESSAGE_CHUNK):
                self.addline("MESSAGE[%s]" % message[k : k + MESSAGE_CHUNK].strip())


@register
class FanucRJ3(FanucR30i):
    pass

    name = "Fanuc_RJ3"
    GROUP = "1,*,*,*,*"
    NAME_LEN = 6
    CALL_LEN = 8

    def _scara(self):
        return self.ROBOT_AXES == 4
