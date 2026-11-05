# Builds IGUS XML motion programs with tool and user-frame definitions.























import re

from ..base import RobotPost, register
from ..robomath import xyzabc

DOC_HEAD = (
    '<?xml version="1.0" encoding="utf-8"?>\n'
    "<!-- values in mm and degree -->\n"
    "<Program>\n"
    '<Header RobotName="igus REBEL-6DOF" RobotType="igus-REBEL/REBEL-6DOF-00" GripperType="" Software="iRC V902-14-001" VelocitySetting="0" />\n'
)
TOOL_FILE = (
    "<Tool>\n"
    '    <INFO NAME="{name}" AUTHOR="Enginuity"/>\n'
    '    <OFFSET OffsetX="{v[0]:.0f}" OffsetY="{v[1]:.0f}" OffsetZ="{v[2]:.0f}" OffsetA="{v[3]:.0f}" OffsetB="{v[4]:.0f}" OffsetC="{v[5]:.0f}"/>\n'
    '    <CAD FileStandard="Schunk_SGW64.obj" FileActive="Schunk_SGW64.obj" FlipMesh="True"/>\n'
    '    <KINEMATIC Motion="Digital" MotionVel="10"/>\n'
    '    <INTERFACE Protocol="digital" ChannelOpenClose = "11" ChannelEnable="12"/>\n'
    "</Tool>\n"
)

NO_TOOL = "enginuity"


def _state(value) -> str:
    if isinstance(value, str):
        return value
    return "True" if value > 0 else "False"


def _name(name) -> str:
    return str(name).replace(" ", "_")


def _xyzabc(pose) -> str:
    return 'x="%.3f" y="%.3f" z="%.3f" a="%.3f" b="%.3f" c="%.3f"' % tuple(xyzabc(pose))


def _xyz(prefix, pose) -> str:
    return '%sx="%.3f" %sy="%.3f" %sz="%.3f"' % (prefix, pose[0][3], prefix, pose[1][3], prefix, pose[2][3])


def _int(v) -> str:
    return "%d" % round(v)


@register
class Igus(RobotPost):
    name = "IGUS"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.PROGS = []  
        self.TEXT = ""
        self.NR = 0
        self.VEL = 35
        self.ACC = 35
        self.SMOOTH = "0"
        self.FRAME_NAME = ""
        self.FRAMES = []  
        self.TOOL = None  

    def addline(self, line):
        self.TEXT += "    " + line + "\n"

    def _element(self, fmt):
        self.NR += 1
        self.addline(fmt.replace("{nr}", str(self.NR)))

    def ProgStart(self, progname):
        self.TEXT = DOC_HEAD

    def ProgFinish(self, progname):
        self.PROGS.append((progname, self.TEXT + "</Program>\n\n"))
        self.TEXT = ""

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        progs = self.PROGS or [(progname, self.TEXT + "</Program>\n\n")]
        for i, (name, text) in enumerate(progs):
            self.save_file(folder, "%s.xml" % (progname if i == 0 else name), text)
        name, pose = self.TOOL or (NO_TOOL, None)
        values = xyzabc(pose) if pose is not None else [0.0] * 6
        self.save_file(folder, "%s.xml" % name, TOOL_FILE.format(name=name, v=values))
        frames = '<?xml version="1.0" standalone="yes"?>\n<!--Storage for RobotControl user defined frames-->\n<UserFrames>\n'
        for fname, pose in self.FRAMES:
            o = [pose[i][3] for i in range(3)]
            b = [o[i] + 10.0 * pose[i][0] for i in range(3)]
            c = [o[i] + 10.0 * pose[i][1] for i in range(3)]
            frames += '    <UserFrame Name="%s">\n' % fname
            for label, pt in (("A", o), ("B", b), ("C", c)):
                frames += '        <Point%s X="%s" Y="%s" Z="%s"/>\n' % (label, _int(pt[0]), _int(pt[1]), _int(pt[2]))
            frames += "    </UserFrame>\n"
        self.save_file(folder, "userFrames.xml", frames + "</UserFrames>\n")

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    def _joints(self, joints) -> str:
        return " ".join('a%d="%.5f"' % (i + 1, v) for i, v in enumerate(joints))

    def MoveJ(self, pose, joints, conf_RLF=None):
        self._element('<Joint Nr="{nr}" %s velPercent="%d" acc="%d" smooth="%s" AbortCondition="false" Descr="" />' % (self._joints(joints), self.VEL, self.ACC, self.SMOOTH))

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self._element('<Linear Nr="{nr}" %s Source="Numerical" velPercent="%d" acc="%d" smooth="%s" UserFrame="%s" Descr="" />' % (
                self._joints(joints), self.VEL, self.ACC, self.SMOOTH, self.FRAME_NAME))
            return
        self._element('<Linear Nr="{nr}" %s Source="Numerical" vel="70" acc="%d" smooth="%s" UserFrame="%s" Descr="" />' % (
            _xyzabc(pose), self.ACC, self.SMOOTH, self.FRAME_NAME))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.NR += 1
            return
        a, b, c = xyzabc(pose1)[3:]
        self._element(
            '<Circular Nr="{nr}" %s %s a="%.3f" b="%.3f" c="%.3f" e1="0" e2="0" e3="0" Source="Constant" vel="70" acc="%d" smooth="%s" UserFrame="%s" useAngle="False" angle="0" AbortCondition="False" Descr="" />'
            % (_xyz("p1", pose1), _xyz("p2", pose2), a, b, c, self.ACC, self.SMOOTH, self.FRAME_NAME))

    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.FRAME_NAME = _name(frame_name)
        self.FRAMES = [f for f in self.FRAMES if f[0] != self.FRAME_NAME] + [(self.FRAME_NAME, pose)]

    def setTool(self, pose, tool_id=None, tool_name=None):
        if self.TOOL is not None:
            self.addline("<!-- Tool can't be updated mid program when using the 'IGUS_USE_TOOL_FILE' option -->")
        self.TOOL = (_name(tool_name), pose)

    def Pause(self, time_ms):
        seconds = 9999.0 if time_ms < 0 else time_ms * 0.001
        self._element('<Wait Nr="{nr}" Seconds="%.3f" Descr="" />' % seconds)

    def setSpeed(self, speed_mms):
        self.VEL = min(100, round(speed_mms))

    def setAcceleration(self, accel_mmss):
        self.ACC = min(100, round(accel_mmss))

    def setSpeedJoints(self, speed_degs):
        self.VEL = min(100, round(speed_degs))

    def setAccelerationJoints(self, accel_degss):
        self.ACC = min(100, round(accel_degss))

    def setZoneData(self, zone_mm):
        if zone_mm <= 0:
            self.SMOOTH = "0"
        elif zone_mm >= 100:
            self.SMOOTH = "100"
        else:
            self.SMOOTH = str(zone_mm)

    def setDO(self, io_var, io_value):
        channel = io_var if isinstance(io_var, str) else "DOut%s" % io_var
        self._element('<Output Nr="{nr}" Local="True" Channel="%s" State="%s" Descr="" />' % (channel, _state(io_value)))

    def setAO(self, io_var, io_value):
        self.setDO(io_var, io_value)

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        self._element('<WaitInput Nr="{nr}" Local="True" DIO="%s" State="%s" Descr="" />' % (io_var, _state(io_value)))

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            self._element('<Sub Nr="{nr}" File="%s.xml" Descr="" />' % re.sub(r"[^A-Za-z0-9_()]", "", code))
        else:
            self.NR += 1
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        self.addline("<!-- %s -->" % message)
