






















import re
import time

from ..base import RobotPost, register
from ..robomath import mul, xyzwpr

NONE_SIZE = "'NoneType' object has no attribute 'size'"


def _onoff(value) -> str:
    if isinstance(value, str):
        return value
    return "ON" if value > 0 else "OFF"


class _Job:
    def __init__(self, name):
        self.name = name
        self.lines = []
        self.points = []


@register
class Inexbot(RobotPost):
    name = "Inexbot"
    VOLATILE = [rb"///DATE \d{4}/\d\d/\d\d \d\d:\d\d"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.PROGS = []  
        self.JOBS = None
        self.FRAME = None
        self.SPEED = 100.0
        self.SPEED_J = 50
        self.PL = ""
        self.ACC = "80 80"

    def _job(self):
        job = self.JOBS[-1]
        if self.MAX_LINES_X_PROG > 0 and len(job.lines) >= self.MAX_LINES_X_PROG:
            base = self.JOBS[0].name
            job = _Job(base + str(len(self.JOBS) + 1))
            self.JOBS.append(job)
        return job

    def addline(self, line):
        self._job().lines.append(line)

    def _point(self, job, values, fmt):
        job.points.append("P%04d = " % (len(job.points) + 1) + "0.0," * 7 + ",".join(fmt[i] % v for i, v in enumerate(values)) + ",0.0")
        return len(job.points)

    def ProgStart(self, progname):
        self.JOBS = [_Job(progname[:7])]
        self.PROGS.append(self.JOBS)

    def ProgFinish(self, progname):
        pass

    def _text(self, job) -> str:
        out = "//DIR\n//JOB\n//NAME %s\n//POS\n///NPOS %d,0,0,0,0,0\n" % (job.name, len(job.points))
        out += "".join(p + "\n" for p in job.points)
        out += "//INSTRUCTION\n///DATE %s\n" % time.strftime("%Y/%m/%d %H:%M")
        out += "ROBOTTYPE = [R_GENERAL_6S]\nDOUBLEROBOT = [NoCooperative]\nPROVERSION = [1.0.6]\nNOP\n"
        return out + "".join(l + "\n" for l in job.lines) + "END\n"

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        for jobs in self.PROGS:
            if len(jobs) > 1:
                main = _Job("M_" + jobs[0].name[:5])
                main.lines = ["CALL JOB:%s" % j.name for j in jobs]
                self.save_file(folder, "%s.JBR" % main.name, self._text(main))
            for job in jobs:
                self.save_file(folder, "%s.JBR" % job.name, self._text(job))

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def _cartesian(self, job, pose):
        absolute = pose if self.FRAME is None else mul(self.FRAME, pose)
        return self._point(job, xyzwpr(absolute), ["%.3f"] * 3 + ["%.2f"] * 3)

    def MoveJ(self, pose, joints, conf_RLF=None):
        job = self._job()
        n = self._point(job, joints, ["%.12f"] * len(joints))
        job.lines.append("MOVJ P%04d VJ = %d %%%s %s 0" % (n, self.SPEED_J, self.PL, self.ACC))

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            raise AttributeError(NONE_SIZE)
        job = self._job()
        n = self._cartesian(job, pose)
        job.lines.append("MOVL P%04d V = %.1f mm/s%s %s 0" % (n, self.SPEED, self.PL, self.ACC))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            raise AttributeError(NONE_SIZE)
        for pose in (pose1, pose2):
            job = self._job()
            n = self._cartesian(job, pose)
            job.lines.append("MOVC P%04d V = %.1f mm/s%s %s 0" % (n, self.SPEED, self.PL, self.ACC))

    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.FRAME = pose

    def setTool(self, pose, tool_id=None, tool_name=None):
        pass

    def Pause(self, time_ms):
        self.addline("TIMER T=%.2f" % (time_ms * 0.001))

    def setSpeed(self, speed_mms):
        self.SPEED = speed_mms

    def setAcceleration(self, accel_mmss):
        a = int(min(100, accel_mmss))
        self.ACC = "ACC = %d DEC = %d" % (a, a)

    def setSpeedJoints(self, speed_degs):
        self.SPEED_J = int(min(100, speed_degs))

    def setAccelerationJoints(self, accel_degss):
        a = int(min(100, accel_degss))
        self.ACC = "ACC = %d DEC = %d" % (a, a)

    def setZoneData(self, zone_mm):
        self.PL = "0" if zone_mm < 0 else " PL = %d" % min(5, round(zone_mm))

    
    def setDO(self, io_var, io_value):
        if isinstance(io_var, str):
            self.addline("DOUT %s %s" % (io_var, _onoff(io_value)))
        else:
            self.addline("DOUT OT#(%s) %s T = 1 0" % (io_var, io_value))

    def setAO(self, io_var, io_value):
        if isinstance(io_var, str):
            self.addline("AOUT %s %.1f" % (io_var, float(io_value)))
        elif isinstance(io_value, str):
            raise UnboundLocalError("local variable 'io_val' referenced before assignment")
        else:
            self.addline("AOUT AO#(%s) %.1f" % (io_var, io_value))

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        var = io_var if isinstance(io_var, str) else "IN#(%s)" % io_var
        line = "WAIT %s=%s" % (var, _onoff(io_value))
        if timeout_ms is not None and timeout_ms >= 0:
            line += " T=%.2f" % (timeout_ms * 0.001)
        self.addline(line)

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            self.addline("CALL JOB:%s" % re.sub(r"[^A-Za-z0-9_()]", "", code)[:7])
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        pass
