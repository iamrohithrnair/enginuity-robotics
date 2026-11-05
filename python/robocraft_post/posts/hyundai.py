# Generates Hyundai JOB motion programs with numbered steps and subprograms.


















import re

from ..base import RobotPost, register
from ..robomath import mul, eye, xyzabc

JOINT_TARGET_C = "' Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."


def _number(name, default=-1):
    numbers = re.findall(r"\d+", name or "")
    return int(numbers[-1]) if numbers else default


def _level(value):
    return "1" if value > 0 else "0"


@register
class Hyundai(RobotPost):
    name = "Hyundai"
    PROG_EXT = "JOB"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.PROGS = []
        self.LINES = []  
        self.FRAME = eye()
        self.SPEED = "50%"
        self.ACCURACY = 2
        self.TOOL = 1

    def ProgStart(self, progname):
        self.CUR = progname
        self.LINES = []

    def ProgFinish(self, progname):
        self.PROGS.append((self.CUR, self.LINES))
        self.LINES = []

    def addline(self, line):
        self.LINES.append(line)

    
    def _header(self):
        words = self.ROBOT_NAME.split(" ")
        if len(words) < 2:  
            return []
        n = self.ROBOT_AXES
        return ["Program File Format Version : 1.6  MechType: 578(%s-01)  TotalAxis: %i  AuxAxis: %i" % (words[1], n, n - 6)]

    def _job(self, lines):
        out = self._header()
        step = 0
        for line in lines:
            if isinstance(line, str):
                out.append("     " + line)
            else:
                step += 1
                out.append("S%-4i%s" % (step, line[0]))
        return out

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        lines = self.PROGS[0][1] if self.PROGS else self.LINES
        number = _number(progname, 5)
        n = self.MAX_LINES_X_PROG
        if n <= 0 or len(lines) < n:
            self.save_file(folder, "%i.%s" % (number, self.PROG_EXT), "\n".join(self._job(lines) + ["     END"]) + "\n")
            return
        parts = [lines[k : k + n] for k in range(0, len(lines), n)]
        if len(lines) % n == 0:
            parts.append([])  
        for k, part in enumerate(parts):
            trailer = ["     END"] if k == len(parts) - 1 else ["     END", "     ' Program %s" % progname]
            self.save_file(folder, "%s.%03i" % (progname, number + 1 + k), "\n".join(self._job(part) + trailer) + "\n")
        main = self._header() + ["' Main program %s calls %i subprograms" % (progname, len(parts))]
        main += ["CALL %3i" % (number + 1 + k) for k in range(len(parts))] + ["END"]
        self.save_file(folder, "%i.%s" % (number, self.PROG_EXT), "\n".join(main) + "\n")

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def _joints(self, joints):
        return "#(%s)%s" % (",".join("%.5f" % v for v in joints), "A/UNIT2" if self.ROBOT_AXES > 6 else "")

    def _pose(self, pose, joints):
        values = ["%.3f" % v for v in xyzabc(mul(self.FRAME, pose))]
        if self.ROBOT_AXES > 6:  
            return "(%s)A/UNIT2" % ",".join(values + ["%.5f" % v for v in list(joints)[6:]])
        return "(%s)" % ",".join(values)

    def _move(self, kind, target):
        self.addline(("MOVE %s,S=%s,A=%i,T=%i  %s" % (kind, self.SPEED, self.ACCURACY, self.TOOL, target),))

    def MoveJ(self, pose, joints, conf_RLF=None):
        self._move("J", self._joints(joints))

    def MoveL(self, pose, joints, conf_RLF=None):
        self._move("L", self._joints(joints) if pose is None else self._pose(pose, joints))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.addline(JOINT_TARGET_C)
            return
        self._move("C", self._pose(pose1, joints1))
        self._move("C", self._pose(pose2, joints2))

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.FRAME = pose
        self.addline("' Using reference frame:")
        self.addline("' USERFRAME=(%s)" % ",".join("%.3f" % v for v in xyzabc(pose)))
        self.addline("' (using all targets with respect to the robot base)")
        self.addline("' CHGCOORD 0")

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.TOOL = tool_id if tool_id is not None and tool_id >= 0 else 1
        self.addline("' Using the tool:")
        self.addline("' TOOL%i=(%s)" % (self.TOOL, ",".join("%.3f" % v for v in xyzabc(pose))))

    def Pause(self, time_ms):
        if time_ms <= 0:
            self.addline("PAUSE 99999")
        else:
            self.addline("DELAY %.3f" % (time_ms / 1000.0))

    def setSpeed(self, speed_mms):
        self.SPEED = "%.2fmm/s" % speed_mms

    def setAcceleration(self, accel_mmss):
        pass

    def setSpeedJoints(self, speed_degs):
        pass

    def setAccelerationJoints(self, accel_degss):
        pass

    def setZoneData(self, zone_mm):
        self.ACCURACY = 1 if zone_mm < 0 else 2

    
    def setDO(self, io_var, io_value):
        var = io_var if isinstance(io_var, str) else "DO%02i" % io_var
        self.addline("%s=%s" % ("SET" if isinstance(io_value, str) else _level(io_value), var))

    def setAO(self, io_var, io_value):
        self.setDO(io_var, io_value)

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        var = io_var if isinstance(io_var, str) else "WAIT DI%02i" % io_var
        self.addline("%s=%s" % ("" if isinstance(io_value, str) else _level(io_value), var))

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            self.addline("' Call program %s:" % code)
            self.addline("CALL %i" % _number(code))
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.addline("' %s" % message)
        else:
            self.addline('PRINT #0,"%s"' % message.replace('"', "'"))
