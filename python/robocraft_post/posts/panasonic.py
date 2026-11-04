




























import re

from ..base import PostError, RobotPost, register

_DESCRIPTION = (
    "[Description]\n\nRobot,\nComment,\nMechanism,1(0018)\nTool, 1:TOOL01\nCreator, Enginuity\nUser coordinates, None\n"
    "Create, 2020, 1, 1, 2, 38, 19\nUpdate, 2020, 1, 1, 2, 38, 19\nOriginal,Enginuity\nEdit, 0\n\n"
)
_POSE_HEADER = (
    "[Pose]\n/Name, Type, RT, UA, FA, RW, BW, TW, X, Y, Z, Rx, Ry, Rz, --, --, --, "
    + ", ".join("G%d" % i for i in range(1, 22))
    + "\n\n"
)


def _pieces(text):
    return [text[i : i + 29] for i in range(0, len(text), 32)]


def _on_off(value):
    if isinstance(value, (int, float)):
        return "ON" if value > 0 else "OFF"
    return str(value)


class _Prog:
    def __init__(self, name):
        self.name = name
        self.points = []
        self.lines = []


@register
class PanasonicG3CSR(RobotPost):
    name = "Panasonic_G3_CSR"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.PROGS = []  
        self.PROG = None
        self.SPEED = "15.00"
        self.MAIN = False

    
    def ProgStart(self, progname):
        self.PROG = _Prog(progname)
        self.PROGS.append((progname, [self.PROG]))

    def ProgFinish(self, progname):
        pass

    def _part(self):
        pass
        if self.MAX_LINES_X_PROG > 0 and len(self.PROG.lines) >= self.MAX_LINES_X_PROG:
            if len(self.PROGS) > 1 or self.MAIN:
                raise PostError("Only one program at a time can be split into smaller programs")
            name, parts = self.PROGS[-1]
            self.PROG = _Prog("%s%d" % (name, len(parts) + 1))
            parts.append(self.PROG)
        return self.PROG

    def addline(self, line):
        self._part().lines.append(line)

    def _point(self, prog, joints):
        prog.points.append(joints)
        return "P%03d" % len(prog.points)

    @staticmethod
    def _content(prog):
        out = _DESCRIPTION + _POSE_HEADER
        for i, joints in enumerate(prog.points):
            out += "P%04d, RJ, %s,%s\n" % (i + 1, ",".join("%.6f" % j for j in joints), " ," * 29)
        out += "\n\n[Command]\n\n\n"
        out += "".join(l + "\n" for l in prog.lines)
        return out

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        name, parts = self.PROGS[0]
        if len(parts) > 1:
            
            self.PROG = _Prog("M_" + name)
            self.MAIN = True
            for p in parts:
                self.addline("CALL, %s.rpg" % p.name)
            self.save_file(folder, "%s.csr" % self.PROG.name, self._content(self.PROG))
        for name, parts in self.PROGS:
            for prog in parts:
                self.save_file(folder, "%s.csr" % prog.name, self._content(prog))

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def MoveJ(self, pose, joints, conf_RLF=None):
        prog = self._part()
        prog.lines.append("MOVEP, %s, %s, m/min, N, -1" % (self._point(prog, joints), self.SPEED))

    def MoveL(self, pose, joints, conf_RLF=None):
        prog = self._part()
        prog.lines.append("MOVEL, %s, %s, m/min , 0, N, -1" % (self._point(prog, joints), self.SPEED))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        
        
        prog = self._part()
        names = [self._point(prog, joints1), self._point(prog, joints2)]
        for n in names:
            self.addline("MOVEC, %s, %s, m/min, 0, N, -1, CIR_NORMAL" % (n, self.SPEED))

    def setFrame(self, pose, frame_id=None, frame_name=None):
        pass

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.addline("TOOL, 1:%s" % tool_name)

    def Pause(self, time_ms):
        if time_ms <= 0:
            self.addline("STOP")
        else:
            self.addline("DELAY, %.2f," % (time_ms / 1000))

    def setSpeed(self, speed_mms):
        self.SPEED = "%.2f" % max(min(speed_mms * 60 / 1000, 120.0), 0.01)

    def setAcceleration(self, accel_mmss):
        pass

    def setSpeedJoints(self, speed_degs):
        pass

    def setAccelerationJoints(self, accel_degss):
        pass

    def setZoneData(self, zone_mm):
        pass

    
    def setDO(self, io_var, io_value):
        self.addline("OUT, o1#(%s:), %s" % (io_var, _on_off(io_value)))

    def setAO(self, io_var, io_value):
        self.addline("REM, Analog output")

    def waitDI(self, io_var, io_value, timeout_ms=0):
        self.addline("WAIT_IP, i1#(%s:), %s, %.2f, NOP" % (io_var, _on_off(io_value), timeout_ms / 1000))

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            self.addline("CALL, %s.rpg" % re.sub(r"[^A-Za-z0-9_()]", "", code))
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        for piece in _pieces(message):
            self.addline(("REM,%s" if iscomment else 'REM, "%s"') % piece)
