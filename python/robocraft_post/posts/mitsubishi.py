


















import re

from ..base import RobotPost, register
from ..robomath import xyzwpr

SEPARATOR = "'" + "=" * 61
JOINT_TARGET_C = "'Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."


def _name(text):
    return re.sub(r"[^A-Za-z0-9_()]", "", text).upper()


def _turn(angle):
    return int((angle + 180.0) // 360.0)


def _flags(joints, conf):
    rear, lower, flip = (list(conf or [0, 0, 0]) + [0, 0, 0])[:3]
    fl1 = (1 - int(rear)) * 4 + (1 - int(lower)) * 2 + (1 - int(flip))
    fl2 = sum(_turn(j) * 16 ** k for k, j in enumerate(joints)) % 16 ** 6
    return fl1, fl2


@register
class Mitsubishi(RobotPost):
    name = "Mitsubishi"
    PROG_EXT = "prg"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.PROGS = []  
        self.LINES = []
        self.POS = []
        self.COUNT = 0  
        self.LAST_POSE = None
        self.SPEED = 0.0
        self.FRAME = None
        self.TOOL = None

    def addline(self, line):
        self.LINES.append(line)

    def ProgStart(self, progname):
        self.CUR = progname
        self.LINES = []
        self.POS = []

    def ProgFinish(self, progname):
        self.PROGS.append((self.CUR, self.LINES, self.POS))
        self.LINES = []
        self.POS = []

    
    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        progs = self.PROGS or [(progname, self.LINES, self.POS)]
        n = self.MAX_LINES_X_PROG
        main_name, main_lines, main_pos = progs[0]
        if n > 0 and len(main_lines) + 1 > n:
            self._save_split(folder, _name(progname), main_lines, main_pos, n)
            return
        defs = [d for _, _, pos in progs[1:] for d in pos] + main_pos
        body = ["*%s ' prog. no 1" % _name(progname)] + main_lines + ["End", SEPARATOR]
        for k, (sub, lines, _pos) in enumerate(progs[1:]):
            body += ["*%s ' prog. no %i" % (_name(sub), k + 2)] + lines + ["Return"]
        text = "".join(d + "\n" for d in defs) + "".join("%i %s\n" % (i + 1, l) for i, l in enumerate(body))
        self.save_file(folder, "%s.%s" % (_name(progname), self.PROG_EXT), text)

    def _save_split(self, folder, base, lines, positions, n):
        state = [l for l in (self.FRAME, self.TOOL) if l]
        names = [base]
        chunks = [lines[: n - 1]]
        rest = lines[n - 1 :]
        size = max(1, n - 1 - len(state) - 1)
        while rest:
            chunks.append(rest[:size])
            rest = rest[size:]
        for k in range(1, len(chunks)):
            names.append("%s%i" % (base, k))
        for name, chunk in zip(names, chunks):
            
            pattern = re.compile(r"\b([JP])%s(\d+)\b" % re.escape(base))
            chunk = [pattern.sub(r"\g<1>%s\g<2>" % name, l) for l in chunk]
            refs = [pattern.sub(r"\g<1>%s\g<2>" % name, d) for d in positions]
            refs = [d for d in refs if re.search(r"\b%s\b" % re.escape(d.split("=")[0]), " ".join(chunk))]
            body = ["*%s" % name] + ([] if name == base else state + ["Spd %.1f" % self.SPEED]) + chunk + ["End"]
            text = "".join(d + "\n" for d in refs) + "".join("%i %s\n" % (i + 1, l) for i, l in enumerate(body))
            self.save_file(folder, "%s.%s" % (name, self.PROG_EXT), text)
        main = "MAIN%s" % base
        body = ["*%s" % main] + ['CallP "%s"' % nm for nm in names] + ["End"]
        self.save_file(folder, "%s.%s" % (main, self.PROG_EXT), "".join("%i %s\n" % (i + 1, l) for i, l in enumerate(body)))

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def _jpos(self, joints):
        self.COUNT += 1
        name = "J%s%i" % (_name(self.CUR), self.COUNT)
        self.POS.append("%s=(%s)" % (name, ",".join("%+.6f" % v for v in joints)))
        return name

    def _ppos(self, pose, joints, conf):
        if "T" in self.AXES_TYPE:
            
            raise TypeError("unsupported operand type(s) for *: 'NoneType' and 'NoneType'")
        self.COUNT += 1
        name = "P%s%i" % (_name(self.CUR), self.COUNT)
        x, y, z, a, b, c = xyzwpr(pose)
        fl1, fl2 = _flags(joints, conf)
        self.POS.append("%s=(%+.3f,%+.3f,%+.3f,%+.3f,%+.3f,%+.3f)(%i,%i)" % (name, x, y, z, a, b, c, fl1, fl2))
        return name

    
    def MoveJ(self, pose, joints, conf_RLF=None):
        self.addline("Mov %s" % self._jpos(joints))
        if pose is not None:
            self.LAST_POSE = pose

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.addline("Mvs %s" % self._jpos(joints))
            return
        self.addline("Mvs %s" % self._ppos(pose, joints, conf_RLF))
        self.LAST_POSE = pose

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.addline(JOINT_TARGET_C)
            return
        start = self._ppos(self.LAST_POSE if self.LAST_POSE is not None else pose1, joints1, conf_RLF_1)
        via = self._ppos(pose1, joints1, conf_RLF_1)
        end = self._ppos(pose2, joints2, conf_RLF_2)
        self.addline("Mvr %s,%s, %s" % (start, via, end))
        self.LAST_POSE = pose2

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.FRAME = "Base Inv((%+.3f,%+.3f,%+.3f,%+.3f,%+.3f,%+.3f))" % tuple(xyzwpr(pose))
        self.addline(self.FRAME)

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.TOOL = "Tool (%+.3f,%+.3f,%+.3f,%+.3f,%+.3f,%+.3f)" % tuple(xyzwpr(pose))
        self.addline(self.TOOL)

    def Pause(self, time_ms):
        if time_ms < 0:
            self.addline("Hlt")
        else:
            self.addline("Dly %.3f" % (time_ms / 1000.0))

    def setSpeed(self, speed_mms):
        self.SPEED = speed_mms
        self.addline("Spd %.1f" % speed_mms)

    def setAcceleration(self, accel_mmss):
        pass

    def setSpeedJoints(self, speed_degs):
        pass

    def setAccelerationJoints(self, accel_degss):
        pass

    def setZoneData(self, zone_mm):
        if zone_mm > 0:
            self.addline("Cnt 1, %.1f, %.1f" % (zone_mm, zone_mm))
        else:
            self.addline("Cnt 0")

    
    def setDO(self, io_var, io_value):
        var = "M_OUT(%s)" % io_var if not isinstance(io_var, str) else io_var
        self.addline("%s=%s" % (var, io_value))

    def setAO(self, io_var, io_value):
        var = "OUT(%s)" % io_var if not isinstance(io_var, str) else io_var
        self.addline("%s=%s" % (var, io_value))

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        var = "M_IN(%s)" % io_var if not isinstance(io_var, str) else io_var
        if timeout_ms is None or timeout_ms < 0:
            self.addline("Wait %s=%s" % (var, io_value))
            return
        self.addline("M_Timer(1) = 0")
        label = len(self.LINES) + 2  
        self.addline("*cond_%i" % label)
        self.addline("If %s<>%s AND M_timer(1) < %i THEN *cond_%i" % (var, io_value, timeout_ms, label))

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            self.addline("GoSub *%s" % _name(code))
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.addline("'%s" % message)
        else:
            self.addline('Open "COM1:" As #1')
            self.addline('Print #1,"%s"' % message)
            self.addline("Close #1")
