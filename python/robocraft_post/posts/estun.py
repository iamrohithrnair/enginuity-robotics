# Generates Estun RCS3 JLT programs with pose, speed and zone declarations.




















import datetime
import re

from ..base import RobotPost, register
from ..robomath import xyzabc

EXT10 = ",".join(["0.000000"] * 10)
JOINT_TARGET_L = "# Linear movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."
JOINT_TARGET_C = "# Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."
PROPERTIES = """export MainModule
module MainModule
    var property = Dict{String, String}()
    var property_flag = config_property()
    function config_property()
        property["module_name"] = "MainModule"
        property["description"] = "program"
        property["created_by"] = "user"
        property["create_time"] = "%(t)s"
        property["modify_time"] = "%(t)s"
        property["readonly"] = "false"
        property["locked_axes"] = ""
        lock_axis_property["MainModule"] = ""
    end
"""


def _num(v):
    pass
    return repr(v) if isinstance(v, float) else str(v)


@register
class EstunRcs3(RobotPost):
    name = "Estun_RCS3"
    PROG_EXT = "jlt"
    
    VOLATILE = [rb'"\d{4}/\d\d/\d\d \d\d:\d\d:\d\d"']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.PROGS = []  
        self.LINES = []
        self.ZONES = []
        self.SPEEDS = []
        self.APOS = []
        self.CPOS = []
        self.SPEED = "S.V10"
        self.FRAME_ID = 0
        self.TOOL_ID = 0
        self.TIME = datetime.datetime.now().strftime("%Y/%m/%d %H:%M:%S")

    def addline(self, line, comment=False):
        if not comment and self.HEAD is None:
            self.HEAD = len(self.LINES)  
        self.LINES.append("        " + line)

    def ProgStart(self, progname):
        self.CUR = progname
        self.LINES = []
        self.HEAD = None
        self.ZONES, self.SPEEDS, self.APOS, self.CPOS = [], [], [], []

    def ProgFinish(self, progname):
        decl = ["        " + d for d in self.ZONES + self.SPEEDS + self.APOS + self.CPOS]
        head = len(self.LINES) if self.HEAD is None else self.HEAD
        self.PROGS.append((self.CUR, self.LINES[:head] + decl, self.LINES[head:]))
        self.LINES = []

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        progs = self.PROGS or [(progname, [], self.LINES)]
        name, decl, lines = progs[0]
        n = self.MAX_LINES_X_PROG
        if n > 0 and len(decl) + len(lines) + 4 > max(n, 10):
            
            self.save_file(folder, "MainModule.%s" % self.PROG_EXT, "        function MainModule()\n    end\n")
            return
        text = PROPERTIES % {"t": self.TIME} + "    function main()\n"
        text += "".join(l + "\n" for l in decl + lines) + "    end\nend\n"
        for _sub, _decl, sub_lines in progs[1:]:
            text += "        function MainModule()\n" + "".join(l + "\n" for l in sub_lines) + "    end\n"
        self.save_file(folder, "MainModule.%s" % self.PROG_EXT, text)

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def _apos(self, joints):
        name = "p%i" % len(self.APOS)
        self.APOS.append("var %s :: Apos = Apos(%s,%s)" % (name, ",".join(_num(v) for v in joints), EXT10))
        return name

    def _cpos(self, pose, joints, conf):
        rear, lower, flip = (list(conf or [0, 0, 0]) + [0, 0, 0])[:3]
        j = list(joints)
        cfg = [int(rear) * 4 + int(lower) * 2 + int(flip)] + [int(j[k] / 180.0) for k in range(6)]
        x, y, z, a, b, c = xyzabc(pose)
        name = "cp%i" % len(self.CPOS)
        self.CPOS.append(
            "var %s :: Cpos = Cpos(Poscfg(%s),%i,%i,%s,%s)"
            % (name, ",".join("%i" % v for v in cfg), self.FRAME_ID, self.TOOL_ID, ",".join(repr(v) for v in (x, y, z, a, b, c)), EXT10)
        )
        return name

    
    def MoveJ(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.addline("MovJ(%s,v=%s)" % (self._apos(joints), self.SPEED))
        else:
            self.addline("MovJ(%s,v=%s}" % (self._cpos(pose, joints, conf_RLF), self.SPEED))

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.addline(JOINT_TARGET_L)
            return
        self.addline("MovL(%s,v=%s)" % (self._cpos(pose, joints, conf_RLF), self.SPEED))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.addline(JOINT_TARGET_C)
            return
        c1 = self._cpos(pose1, joints1, conf_RLF_1)
        c2 = self._cpos(pose2, joints2, conf_RLF_2)
        self.addline("MovC(%s,%s,v=%s)" % (c1, c2, self.SPEED))

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.FRAME_ID += 1

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.TOOL_ID += 1

    def Pause(self, time_ms):
        if time_ms < 0:
            self.addline("# PAUSE")
        else:
            self.addline("Wait(%i)" % time_ms)

    def setSpeed(self, speed_mms):
        self.SPEED = "Speed%i" % len(self.SPEEDS)
        self.SPEEDS.append("var %s :: Speed = Speed(10,%s,360,360,180)" % (self.SPEED, repr(float(speed_mms))))

    def setAcceleration(self, accel_mmss):
        pass

    def setSpeedJoints(self, speed_degs):
        pass

    def setAccelerationJoints(self, accel_degss):
        pass

    def setZoneData(self, zone_mm):
        if zone_mm <= 0:
            self.addline('SetBlendParam(b="FINE")')
            return
        zone = "Zone%i" % len(self.ZONES)
        z = repr(float(zone_mm))
        self.ZONES.append("var %s :: Zone = Zone(%s,%s,0)" % (zone, z, z))
        self.addline('SetBlendParam(b="ABSOLUTE",c=%s)' % zone)

    
    def setDO(self, io_var, io_value):
        self.addline('PulseOut("DO",%s,%s,1000,0)' % (io_var, io_value))

    def setAO(self, io_var, io_value):
        self.addline("# The analog output instruction is not supported")

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        timeout = 1000000 if timeout_ms is None or timeout_ms < 0 else timeout_ms
        self.addline('WaitIO("DI",%s,%s,%s)' % (io_var, io_value, _num(timeout)))

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            code = re.sub(r"[^A-Za-z0-9_()]", "", code)
            self.addline(code if "(" in code else code + "()")
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        self.addline("# %s" % message, comment=True)
