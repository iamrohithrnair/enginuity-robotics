
























import gzip
import html
import io
import math
import re
import time

from ..base import RobotPost, register
from ..robomath import eye, mul, rotation_vector, xyz


PATH_CHECKED = ("UR3", "UR5", "UR10")

SKIP_ANGLE = 165.0
JOINT_TARGET_C = "# Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."
HEAD_END = "  #--------------------------\n  \n"

HEADER = (
    '  # Global parameters:\n'
    '  global speed_ms    = 0.250\n'
    '  global speed_rads  = 0.750\n'
    '  global accel_mss   = 1.200\n'
    '  global accel_radss = 1.200\n'
    '  global blend_radius_m = 0.001\n'
    '  global ref_frame = p[0,0,0,0,0,0]\n'
    '  \n'
    '  #\n'
    '  # TO REMOVE HEADER:\n'
    '  # Go to "Program" -> "Post-Processor Editor"\n'
    '  # Select "Universal Robots"\n'
    '  # Set "INCLUDE_HEADER" to "False"\n'
    '  #\n'
    '  #--------------------------\n'
    '  # Add any default subprograms here\n'
    '  # For example, to drive a gripper as a program call:\n'
    '  # def Gripper_Open():\n'
    '  #   ...\n'
    '  # end\n'
    '  #\n'
    '  # Example to drive a spray gun:\n'
    '  def SprayOn(value):\n'
    '    # use the value as an output:\n'
    '    DO_SPRAY = 5\n'
    '    if value == 0:\n'
    '      set_standard_digital_out(DO_SPRAY, False)\n'
    '    else:\n'
    '      set_standard_digital_out(DO_SPRAY, True)\n'
    '    end\n'
    '  end\n'
    '\n'
    '  # Example to drive an extruder:\n'
    '  def Extruder(value):\n'
    '    # use the value as an output:\n'
    '    if value < 0:\n'
    '      # stop extruder\n'
    '    else:\n'
    '      # start extruder\n'
    '    end\n'
    '  end\n'
    '\n'
    '  # Example to move an external axis\n'
    '  def MoveAxis(value):\n'
    '    # use the value as an output:\n'
    '    DO_AXIS_1 = 1\n'
    '    DI_AXIS_1 = 1\n'
    '    if value <= 0:\n'
    '      set_standard_digital_out(DO_AXIS_1, False)\n'
    '\n'
    '      # Wait for digital input to change state\n'
    '      #while (get_standard_digital_in(DI_AXIS_1) != False):\n'
    '      #  sync()\n'
    '      #end\n'
    '    else:\n'
    '      set_standard_digital_out(DO_AXIS_1, True)\n'
    '\n'
    '      # Wait for digital input to change state\n'
    '      #while (get_standard_digital_in(DI_AXIS_1) != True):\n'
    '      #  sync()\n'
    '      #end\n'
    '    end\n'
    '  end\n'
    '  #--------------------------\n'
    '  \n'
    '  \n'
    '  # Main program:\n'
)

URP = (
    '<URProgram createdIn="3.0.0" lastSavedIn="3.0.0" name="{name}" directory="." installation="default">\n'
    "  <children>\n"
    '    <MainProgram runOnlyOnce="true" motionType="MoveJ" speed="1.0471975511965976" acceleration="1.3962634015954636" useActiveTCP="false">\n'
    "      <children>\n"
    '        <Script type="File">\n'
    "          <cachedContents>{script}</cachedContents>\n"
    "          <file>{name}.script</file>\n"
    "        </Script>\n"
    "      </children>\n"
    "    </MainProgram>\n"
    "  </children>\n"
    "</URProgram>"
)


def _xml_escape(text: str) -> str:
    return html.escape(text, quote=True)


def _pose(pose) -> str:
    x, y, z = xyz(pose)
    rx, ry, rz = rotation_vector(pose)
    return "p[%.6f, %.6f, %.6f, %.6f, %.6f, %.6f]" % (x * 0.001, y * 0.001, z * 0.001, rx, ry, rz)


def _joints(joints) -> str:
    return "[" + ", ".join("%.6f" % (v * math.pi / 180.0) for v in joints) + "]"


def _angle(a, b, c) -> float:
    pass
    u = [b[i] - a[i] for i in range(3)]
    v = [c[i] - b[i] for i in range(3)]
    nu = math.sqrt(sum(x * x for x in u))
    nv = math.sqrt(sum(x * x for x in v))
    if nu == 0 or nv == 0:
        return 0.0
    cos = sum(u[i] * v[i] for i in range(3)) / (nu * nv)
    return math.degrees(math.acos(max(-1.0, min(1.0, cos))))


def _state(value) -> str:
    pass
    if isinstance(value, str):
        return value if value.lower() == "true" else "False"
    return "True" if value > 0 else "False"


def _level(value) -> str:
    pass
    if isinstance(value, str):
        return value
    return "True" if value > 0 else "False"


def urp_bytes(name: str, script: str, mtime=None) -> bytes:
    pass
    xml = URP.format(name=name, script=_xml_escape(script + "\n"))
    buf = io.BytesIO()
    with gzip.GzipFile(filename=name, mode="wb", compresslevel=9, fileobj=buf, mtime=time.time() if mtime is None else mtime) as gz:
        gz.write(xml.encode("utf-8"))
    return buf.getvalue()


@register
class UniversalRobots(RobotPost):
    name = "Universal_Robots"
    PROG_EXT = "script"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.SPEED_MS = 0.250
        self.BLEND = 0.001
        self.FRAME = eye()
        self.PROGS = []
        self.LINES = []
        self.MOVED = False  
        self.CHECK_PATH = self.NATIVE_NAME in PATH_CHECKED
        self.LAST = None  
        self.PREV = None  

    def ProgStart(self, progname):
        self.CUR = progname
        self.LINES = []
        self.MOVED = False

    def ProgFinish(self, progname):
        self.PROGS.append((self.CUR, self.LINES))
        self.LINES = []
        self.MOVED = False

    def addline(self, line, move=False):
        self.LINES.append(line)
        self.MOVED = move

    def _end_trace(self):
        pass
        if self.MOVED:
            self.LINES[-1] = re.sub(r",r=[^,)]*\)$", ",r=0)", self.LINES[-1]) + "# end trace"
            self.MOVED = False

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        progs = self.PROGS or [(progname, self.LINES)]
        main = progs[0][1]
        head = HEADER[: HEADER.index(HEAD_END) + len(HEAD_END)]
        subs = ""
        for sub, lines in progs[1:]:
            subs += "  # Subprogram %s\n  def %s():\n" % (sub, sub) + "".join("    " + l + "\n" for l in lines) + "  end\n  \n"
        script = "def %s():\n" % progname + head + subs + "  \n  # Main program:\n"
        script += "".join("  " + l + "\n" for l in main)
        script += "  # End of main program\nend\n\n%s()\n" % progname
        self.save_file(folder, "%s.script" % progname, script)
        self.save_file(folder, "%s.urp" % progname, urp_bytes(progname, script))

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def _blend(self, pose) -> str:
        pass
        if pose is None:
            self.LAST = self.PREV = None
            return "0"
        pos = xyz(mul(self.FRAME, pose))
        radius = "%.3f" % self.BLEND
        if self.CHECK_PATH:
            if self.LAST is None:
                radius = "0"
            elif self.PREV is not None:
                angle = _angle(self.PREV, self.LAST, pos)
                if angle > SKIP_ANGLE:
                    self.addline("# Skipping rounding for move with angle %.1f deg" % angle)
                    radius = "0"
        self.PREV, self.LAST = self.LAST, pos
        return radius

    
    def MoveJ(self, pose, joints, conf_RLF=None):
        r = self._blend(pose)
        self.addline("movej(%s,accel_radss,speed_rads,t=0,r=%s)" % (_joints(joints), r), move=True)

    def MoveL(self, pose, joints, conf_RLF=None):
        r = self._blend(pose)
        target = _joints(joints) if pose is None else "pose_trans(ref_frame,%s)" % _pose(pose)
        self.addline("movel(%s,accel_mss,speed_ms,t=0,r=%s)" % (target, r), move=True)

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.addline(JOINT_TARGET_C)
            return
        if self.LAST is None:
            
            self.MoveL(pose2, joints2, conf_RLF_2)
            return
        self.PREV, self.LAST = None, xyz(mul(self.FRAME, pose2))
        t1 = "pose_trans(ref_frame,%s)" % _pose(pose1)
        t2 = "pose_trans(ref_frame,%s)" % _pose(pose2)
        self.addline("movec(%s,%s,accel_mss,speed_ms,r=%.3f)" % (t1, t2, self.BLEND), move=True)

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.FRAME = pose
        self.addline("ref_frame = %s" % _pose(pose))

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.addline("set_tcp(%s)" % _pose(pose))

    def Pause(self, time_ms):
        if time_ms <= 0:
            self.addline("halt() # reimplement this function to force stop")
        else:
            self.addline("sleep(%.3f)" % (time_ms * 0.001))

    def setSpeed(self, speed_mms):
        v = min(speed_mms, 3000.0) * 0.001
        if abs(v - self.SPEED_MS) > 1e-6:
            self._end_trace()
            self.addline("speed_ms    = %.3f" % v)
            self.SPEED_MS = v

    def setAcceleration(self, accel_mmss):
        self.addline("accel_mss   = %.3f" % (min(accel_mmss, 15000.0) * 0.001))

    def setSpeedJoints(self, speed_degs):
        self.addline("speed_rads  = %.3f" % (min(speed_degs, 180.0) * math.pi / 180.0))

    def setAccelerationJoints(self, accel_degss):
        self.addline("accel_radss = %.3f" % (min(accel_degss, 2291.8) * math.pi / 180.0))

    def setZoneData(self, zone_mm):
        self.BLEND = max(zone_mm, 0) * 0.001
        self.addline("blend_radius_m = %.3f" % self.BLEND)

    
    def setDO(self, io_var, io_value):
        self._end_trace()
        if isinstance(io_var, str):
            self.addline("%s = %s" % (io_var, io_value))
        elif io_var >= 20:
            self.addline("set_configurable_digital_out(%s, %s)" % (io_var - 20, _state(io_value)))
        elif io_var >= 10:
            self.addline("set_tool_digital_out(%s, %s)" % (io_var - 10, _state(io_value)))
        else:
            self.addline("set_standard_digital_out(%s, %s)" % (io_var, _state(io_value)))

    def setAO(self, io_var, io_value):
        self._end_trace()
        if isinstance(io_var, str):
            self.addline("%s = %s" % (io_var, io_value))
        else:
            self.addline("set_standard_analog_out(%s, %s)" % (io_var, io_value))

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        
        self._end_trace()
        if isinstance(io_var, str):
            var = io_var
        elif io_var >= 20:
            var = "get_configurable_digital_in(%s)" % (io_var - 20)
        elif io_var >= 10:
            var = "%s" % (io_var - 10)  
        else:
            var = "get_standard_digital_in(%s)" % io_var
        self.addline("while (%s != %s):" % (var, _level(io_value)))
        self.addline("  sync()")
        self.addline("end")

    def RunCode(self, code, is_function_call=False):
        self._end_trace()
        if is_function_call:
            name = re.sub(r"[^A-Za-z0-9_]", "", code.split("(")[0])
            self.addline(name + (code[code.index("(") :] if "(" in code else "()"))
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.addline("# %s" % message)
        else:
            self.addline('popup("%s","Message",False,False,blocking=True)' % message)
