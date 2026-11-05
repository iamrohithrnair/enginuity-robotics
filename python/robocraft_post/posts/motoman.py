# Emits split Motoman JBI jobs with position tables and motion settings.























import datetime
import re

from ..base import RobotPost, register
from ..robomath import xyzwpr

COMMENT_CHUNK = 29
MESSAGE_CHUNK = 25


def job_name(name):
    return re.sub(r"[^A-Za-z0-9_]", "", name or "").upper()[:7]


def _chunks(text, n):
    return [text[k : k + n] for k in range(0, max(len(text), 1), n)]


def _onoff(value):
    if isinstance(value, str):
        return value
    return "ON" if value > 0 else "OFF"


def _vj(value):
    s = "%.2f" % value
    return s if value < 100 else "%.1f" % value


@register
class Motoman(RobotPost):
    name = "Motoman"
    PROG_EXT = "JBI"
    
    VOLATILE = [rb"///DATE \d{4}/\d\d/\d\d \d\d:\d\d"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.JOBS = []  
        self.LINES = []
        self.POS = []  
        self.LAST = None
        self.STR_V = "V=100.0"
        self.STR_VJ = "VJ=50.00"
        self.PL = ""
        self.ACC_L = None  
        self.ACC_J = None
        self.DATE = datetime.datetime.now().strftime("%Y/%m/%d %H:%M")

    
    def _base_axis(self):
        return self.ROBOT_AXES == 4 and "T" in self.AXES_TYPE

    def _station_axis(self):
        return self.ROBOT_AXES == 4 and "L" in self.AXES_TYPE and not self._base_axis()

    def _scaled(self, joints):
        pass
        j = list(joints)
        p = self.PULSES_X_DEG
        if p:
            j = [v * p[i] if i < len(p) else v for i, v in enumerate(j)]
        return j

    def _pulses(self, joints):
        j = self._scaled(joints)
        if self.ROBOT_AXES == 4:
            if self._base_axis():
                k = self.AXES_TYPE.index("T")
                j = [v for i, v in enumerate(j) if i != k]
            elif self._station_axis():
                k = self.AXES_TYPE.index("L")
                j = [v for i, v in enumerate(j) if i != k]
            else:
                j = [j[0], j[1], j[2], 0.0, 0.0, j[3]]
        elif self.ROBOT_AXES == 7:
            j = [j[0], j[1], j[3], j[4], j[5], j[6], j[2]]
        return ",".join("%i" % round(v) for v in j)

    
    def ProgStart(self, progname):
        self.CUR = progname
        self.LINES = []
        self.POS = []

    def ProgFinish(self, progname):
        self.JOBS.append((self.CUR, self.LINES, self.POS))
        self.LINES = []
        self.POS = []

    def addline(self, line):
        self.LINES.append(line)

    def comment(self, text):
        for c in _chunks(text, COMMENT_CHUNK):
            self.addline("'" + c)

    def _job(self, name, lines, positions):
        base = self._base_axis()
        station = self._station_axis()
        n = len(positions)
        out = ["/JOB", "//NAME %s" % name, "//POS", "///NPOS %i,%i,%i,0,0,0" % (n, n if base else 0, n if station else 0)]
        if positions:
            out += ["///TOOL 9", "///POSTYPE PULSE", "///PULSE"]
            out += ["C%05i=%s" % (i, self._pulses(p)) for i, p in enumerate(positions)]
            if base:
                k = self.AXES_TYPE.index("T")
                out += ["BC%05i=%i" % (i, round(self._scaled(p)[k])) for i, p in enumerate(positions)]
            if station:
                k = self.AXES_TYPE.index("L")
                out += ["EC%05i=%i" % (i, round(self._scaled(p)[k])) for i, p in enumerate(positions)]
        out += ["//INST", "///DATE %s" % self.DATE, "///COMM Generated using Enginuity", "///ATTR SC,RW"]
        out += ["///GROUP1 RB1,BS1" if base else "///GROUP1 RB1", "NOP"]
        out += [self._render(l) for l in lines]
        return "\n".join(out + ["END"]) + "\n"

    @staticmethod
    def _render(line):
        return line if isinstance(line, str) else line[0] % tuple("%05i" % k for k in line[1])

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        jobs = self.JOBS or [(progname, self.LINES, self.POS)]
        n = self.MAX_LINES_X_PROG
        main_name, main_lines, main_pos = jobs[0]
        if n > 0 and len(main_lines) > n:
            base = job_name(progname)
            parts = [main_lines[i : i + n] for i in range(0, len(main_lines), n)]
            names = [base] + ["%s%i" % (base, i + 1) for i in range(1, len(parts))]
            for name, part in zip(names, parts):
                lines, positions = self._renumber(part, main_pos)
                self.save_file(folder, "%s.%s" % (name, self.PROG_EXT), self._job(name, lines, positions))
            main = "M_" + base[:5]
            calls = ["CALL JOB:%s" % nm for nm in names]
            self.save_file(folder, "%s.%s" % (main, self.PROG_EXT), self._job(main, calls, []))
            return
        for i, (name, lines, positions) in enumerate(jobs):
            nm = job_name(progname if i == 0 else name)
            self.save_file(folder, "%s.%s" % (nm, self.PROG_EXT), self._job(nm, lines, positions))

    @staticmethod
    def _renumber(lines, positions):
        pass
        used = []
        out = []
        for line in lines:
            if isinstance(line, str):
                out.append(line)
                continue
            fmt, refs = line
            index = {}
            for r in refs:
                if r not in index:  
                    used.append(positions[r])
                    index[r] = len(used) - 1
            out.append((fmt, [index[r] for r in refs]))
        return out, used

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def _pos(self, joints):
        self.POS.append(list(joints))
        self.LAST = list(joints)
        return len(self.POS) - 1

    def _target(self, kind, idx, suffix):
        bc = " BC%s" if self._base_axis() else ""
        if bc:
            return ("%s C%%s BC%%s %s" % (kind, suffix), [idx, idx])
        if self._station_axis():
            return ("%s C%%s %s  +MOVJ EC%%s VJ=100.00" % (kind, suffix), [idx, idx])
        return ("%s C%%s %s" % (kind, suffix), [idx])

    def _add_move(self, kind, idx, suffix):
        fmt, refs = self._target(kind, idx, suffix)
        self.LINES.append((fmt, refs))

    def MoveJ(self, pose, joints, conf_RLF=None):
        suffix = self.STR_VJ + ("" if self.ACC_J is not None else self.PL)
        self._add_move("MOVJ", self._pos(joints), suffix)

    def MoveL(self, pose, joints, conf_RLF=None):
        suffix = self.STR_V + ("" if self.ACC_L is not None else self.PL)
        self._add_move("MOVL", self._pos(joints), suffix)

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        suffix = self.STR_V + ("" if self.ACC_L is not None else self.PL)
        start = self.LAST if self.LAST is not None else joints1
        for j in (start, joints1, joints2):
            self._add_move("MOVC", self._pos(j), suffix)

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.comment("Using %s (targets wrt base):" % frame_name)
        self.comment("%.1f,%.1f,%.1f,%.1f,%.1f,%.1f" % tuple(xyzwpr(pose)))

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.comment("Tool %s should be close to:" % tool_name)
        self.comment("%.1f,%.1f,%.1f,%.1f,%.1f,%.1f" % tuple(xyzwpr(pose)))

    def Pause(self, time_ms):
        if time_ms <= 0:
            self.addline("PAUSE")
        else:
            self.addline("TIMER T=%.2f" % (time_ms / 1000.0))

    def setSpeed(self, speed_mms):
        self.STR_V = "V=%.1f" % min(speed_mms, 2000.0)
        if self.ACC_L is not None:
            self.STR_V += " ACC=%i DEC=%i" % (self.ACC_L, self.ACC_L)

    def setAcceleration(self, accel_mmss):
        self.ACC_L = int(min(100, accel_mmss))

    def setSpeedJoints(self, speed_degs):
        self.STR_VJ = "VJ=%s" % _vj(min(speed_degs, 100.0))
        if self.ACC_J is not None:
            self.STR_VJ += " ACC=%i DEC=%i" % (self.ACC_J, self.ACC_J)

    def setAccelerationJoints(self, accel_degss):
        self.ACC_J = int(min(100, accel_degss))

    def setZoneData(self, zone_mm):
        self.PL = " PL=%i" % min(8, round(zone_mm)) if zone_mm > 0 else ""

    
    def setDO(self, io_var, io_value):
        var = "OT#(%s)" % io_var if not isinstance(io_var, str) else io_var
        self.addline("DOUT %s %s" % (var, _onoff(io_value)))

    def setAO(self, io_var, io_value):
        self.setDO(io_var, io_value)

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        var = "IN#(%s)" % io_var if not isinstance(io_var, str) else io_var
        line = "WAIT %s=%s" % (var, _onoff(io_value))
        if timeout_ms is not None and timeout_ms >= 0:
            line += " T=%.2f" % (timeout_ms / 1000.0)
        self.addline(line)

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            self.addline("CALL JOB:%s" % job_name(code.split("(")[0]))
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.comment(message)
        else:
            for c in _chunks(message, MESSAGE_CHUNK):
                self.addline('MSG "%s"' % c)
