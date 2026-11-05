# Builds CPR XML programs from robot motion, speed and I/O instructions.



















from ..base import RobotPost, register
from ..robomath import eye, inv, mul, xyzabc
from .uarm import call_name

DOC_HEAD = (
    '<?xml version="1.0" encoding="utf-8"?>\n'
    "<!-- values in mm and degree -->\n"
    "<Program>\n"
    '<Header ProgramName ="CPRog recording" Author="nn" SetUpDate=""  LastChangeDate="" Kinematic="CPRFour"/>\n'
)


def _state(value) -> str:
    if isinstance(value, str):
        return value
    return "True" if value > 0 else "False"


def _xyzabc(pose) -> str:
    return 'x="%.3f" y="%.3f" z="%.3f" a="%.3f" b="%.3f" c="%.3f"' % tuple(xyzabc(pose))


@register
class Cpr(RobotPost):
    name = "CPR"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.TEXT = ""
        self.NR = 0
        self.VEL = 35
        self.ZONE = None
        self.FRAME = eye()
        self.TOOL = eye()

    def addline(self, line):
        self.TEXT += "    " + line + "\n"

    def _element(self, fmt):
        self.NR += 1
        self.addline(fmt % self.NR)

    def _smooth(self):
        return "False" if self.ZONE is not None and self.ZONE <= 0 else "True"

    def ProgStart(self, progname):
        self.TEXT += DOC_HEAD

    def ProgFinish(self, progname):
        self.TEXT += "</Program>\n<!-- End of program: %s -->\n\n" % progname

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        self.save_file(folder, "%s.xml" % progname, self.TEXT)

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    def _joint(self, joints):
        j = " ".join('a%d="%.5f"' % (i + 1, v) for i, v in enumerate(joints))
        self._element('<Joint Nr="%%d" %s velPercent="%d" acc="40" smooth="%s" Descr="" />' % (j, self.VEL, self._smooth()))

    def MoveJ(self, pose, joints, conf_RLF=None):
        self._joint(joints)

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self._joint(joints)
            return
        flange = mul(mul(self.FRAME, pose), inv(self.TOOL))
        self._element('<Joint Nr="%%d" %s vel="70" acc="40" smooth="%s" Descr="" />' % (_xyzabc(flange), self._smooth()))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        pass  

    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.FRAME = pose
        self.addline("<!-- Using Reference: %s -->" % _xyzabc(pose))

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.TOOL = pose
        self.addline("<!-- Using Tool: %s -->" % _xyzabc(pose))

    def Pause(self, time_ms):
        seconds = 9999.0 if time_ms < 0 else time_ms * 0.001
        self._element('<Wait Nr="%%d" Seconds="%.3f" Descr="" />' % seconds)

    def setSpeed(self, speed_mms):
        self.VEL = round(speed_mms)

    def setAcceleration(self, accel_mmss):
        pass

    def setSpeedJoints(self, speed_degs):
        self.VEL = min(100, round(speed_degs))

    def setAccelerationJoints(self, accel_degss):
        pass

    def setZoneData(self, zone_mm):
        self.ZONE = zone_mm

    def setDO(self, io_var, io_value):
        self._element('<Output Nr="%%d" Local="True" DIO="%s" State="%s" Descr="" />' % (io_var, _state(io_value)))

    def setAO(self, io_var, io_value):
        self.setDO(io_var, io_value)

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        self._element('<WaitInput Nr="%%d" Local="True" DIO="%s" State="%s" Descr="" />' % (io_var, _state(io_value)))

    def RunCode(self, code, is_function_call=False):
        self.addline(call_name(code) if is_function_call else code)

    def RunMessage(self, message, iscomment=False):
        self.addline("<!-- %s -->" % message)
