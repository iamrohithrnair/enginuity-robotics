# Builds Universal Robots URP node trees alongside matching URScript motion programs.














































import gzip
import html
import io
import math
import re
import time

from ..base import RobotPost, register
from ..robomath import eye, inv, mul, rotation_vector, xyz

HEADER = (
    "  # Global parameters:\n"
    "  global speed_ms    = 0.250\n"
    "  global speed_rads  = 0.750\n"
    "  global accel_mss   = 1.200\n"
    "  global accel_radss = 1.200\n"
    "  global blend_radius_m = 0.000\n"
    "  \n"
    "  #--------------------------\n"
    "  # Add any default subprograms here\n"
    "  # For example, to drive a gripper as a program call:\n"
    "  # def Gripper_Open():\n"
    "  #   ...\n"
    "  # end\n"
    "  #\n"
    "  # Example to drive a spray gun:\n"
    "  def SprayOn(value):\n"
    "    # use the value as an output:\n"
    "    DO_SPRAY = 5\n"
    "    if value == 0:\n"
    "      set_standard_digital_out(DO_SPRAY, False)\n"
    "    else:\n"
    "      set_standard_digital_out(DO_SPRAY, True)\n"
    "    end\n"
    "  end\n"
    "\n"
    "  # Example to synchronize 2\n"
    "  def Synchronize():\n"
    "    # Use the following digital output to signal the state of the robot:\n"
    "    DO_SYNC = 1\n"
    "    \n"
    "    # Use the following digital input to get the state of another robot:\n"
    "    DI_SYNC = 1\n"
    "    \n"
    "    if (get_standard_digital_out(DO_SYNC) == get_standard_digital_in(DI_SYNC)):\n"
    "      set_standard_digital_out(DO_SYNC, not (get_standard_digital_out(DI_SYNC)))\n"
    "      sleep(0.1)\n"
    "      thread Thread_wait_1():\n"
    "        while (True):\n"
    "          sleep(0.01)\n"
    "        end\n"
    "      end\n"
    "      if (get_standard_digital_out(DO_SYNC) != get_standard_digital_in(DI_SYNC)):\n"
    "        global thread_handler_1=run Thread_wait_1()\n"
    "        while (get_standard_digital_out(DO_SYNC) != get_standard_digital_in(DI_SYNC)):\n"
    "          sync()\n"
    "        end\n"
    "        kill thread_handler_1\n"
    "      end\n"
    "    else:\n"
    "      if (get_standard_digital_out(DO_SYNC) != get_standard_digital_in(DI_SYNC)):\n"
    "        set_standard_digital_out(DO_SYNC, not (get_standard_digital_out(DO_SYNC)))\n"
    "      end\n"
    "    end\n"
    "  end\n"
    "\n"
    "  #\n"
    "  # Example to move an external axis\n"
    "  def MoveAxis(value):\n"
    "    # use the value as an output:\n"
    "    DO_AXIS_1 = 1\n"
    "    DI_AXIS_1 = 1\n"
    "    if value <= 0:\n"
    "      set_standard_digital_out(DO_AXIS_1, False)\n"
    "      \n"
    "      # Wait for digital input to change state\n"
    "      #while (get_standard_digital_in(DI_AXIS_1) != False):\n"
    "      #  sync()\n"
    "      #end\n"
    "    else:\n"
    "      set_standard_digital_out(DO_AXIS_1, True)\n"
    "      \n"
    "      # Wait for digital input to change state\n"
    "      #while (get_standard_digital_in(DI_AXIS_1) != True):\n"
    "      #  sync()\n"
    "      #end\n"
    "    end\n"
    "  end\n"
    "  #--------------------------\n"
    "  \n"
)

URP_HEAD = (
    '<URProgram createdIn="3.0.0" lastSavedIn="3.0.0" name="{name}" directory="/programs" installation="default">\n'
    "  <children>\n"
    '    <MainProgram runOnlyOnce="true" motionType="MoveJ" speed="1.0471975511965976" acceleration="1.3962634015954636" useActiveTCP="false">\n'
    "      <children>\n"
)
JOINT_TARGET_C = "Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."
I8, I10, I12, I14 = " " * 8, " " * 10, " " * 12, " " * 14


def _esc(text) -> str:
    return html.escape(str(text), quote=True)


def _name(text: str) -> str:
    pass
    return re.sub(r"[^A-Za-z0-9_()]", "", text)


def _pose6(pose):
    x, y, z = xyz(pose)
    return [x * 0.001, y * 0.001, z * 0.001] + list(rotation_vector(pose))


def _pose(pose) -> str:
    return "p[%s]" % ", ".join("%.6f" % v for v in _pose6(pose))


def _pose_attr(pose) -> str:
    return ", ".join("%.6f" % v for v in _pose6(pose))


def _rad(joints):
    return [v * math.pi / 180.0 for v in joints]


def _joints(joints) -> str:
    return "[" + ", ".join("%.6f" % v for v in _rad(joints)) + "]"


def _value(value) -> str:
    pass
    if isinstance(value, str):
        return value
    return "True" if value > 0 else "False"


def _xml_value(value) -> str:
    if isinstance(value, str):
        return value
    return "1" if value > 0 else "0"


def _circle_radius(a, b, c) -> float:
    ab = math.dist(a, b)
    bc = math.dist(b, c)
    ca = math.dist(c, a)
    u = [b[i] - a[i] for i in range(3)]
    v = [c[i] - a[i] for i in range(3)]
    cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    area2 = math.sqrt(sum(x * x for x in cross))
    if area2 == 0:
        return 0.0
    return ab * bc * ca / (2.0 * area2)


@register
class UniversalRobotsUrp(RobotPost):
    name = "Universal_Robots_URP"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.SPEED_MS = 0.25
        self.SPEED_RADS = 0.75
        self.ACCEL_MSS = 1.2
        self.ACCEL_RADSS = 1.2
        self.BLEND = 0.0
        self.FRAME = eye()
        self.TOOL = eye()
        self.PROGS = []
        self.LINES = []
        self.PROG_COUNT = 0
        self.LAST = None  
        self.NODES = []  
        self.MOVE = None  
        self.NEW_MOVE = True
        self.WAYPOINTS = 0
        self.CALLS = []  

    
    def ProgStart(self, progname):
        self.PROG_COUNT += 1
        self.CUR = progname
        self.LINES = []

    def ProgFinish(self, progname):
        self.PROGS.append((self.CUR, self.LINES))
        self.LINES = []

    def _main(self):
        return self.PROG_COUNT <= 1

    def addline(self, line):
        self.LINES.append(line)

    def _node(self, text):
        if self._main():
            self.NODES.append(text)
            self.MOVE = None

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        progs = self.PROGS or [(progname, self.LINES)]
        main = progs[0][1]
        subs = ""
        for sub, lines in progs[1:]:
            subs += "  # Subprogram %s\n  def %s():\n" % (sub, sub) + "".join("    " + l + "\n" for l in lines) + "  end\n  \n"
        script = "def %s():\n" % progname + HEADER + subs + "  \n  # Main program:\n"
        script += "".join("  " + l + "\n" for l in main)
        n = self.MAX_LINES_X_PROG
        if not (n > 0 and len(main) % (n + 1) == 0):
            script += "  # End of main program\n"
        script += "end\n\n%s()\n" % progname
        self.save_file(folder, "%s.script" % progname, script)
        self.save_file(folder, "%s.urp" % progname, self._urp(progname))

    def _urp(self, progname) -> bytes:
        body = []
        for node in self.NODES:
            body.append(node["xml"]() if callable(node.get("xml")) else node["xml"])
        refs = ""
        for name in self.CALLS:
            k = self._call_index(name)
            refs += '    <SubProgram reference="../MainProgram/children/CallSubProgram%s/subprogram"/>\n' % ("" if k == 1 else "[%d]" % k)
        xml = URP_HEAD.format(name=_esc(progname)) + "".join(body) + "      </children>\n    </MainProgram>\n" + refs + "  </children>\n</URProgram>"
        buf = io.BytesIO()
        with gzip.GzipFile(filename=progname, mode="wb", compresslevel=9, fileobj=buf, mtime=time.time()) as gz:
            gz.write(xml.encode("utf-8"))
        return buf.getvalue()

    def _call_index(self, name):
        k = 0
        for node in self.NODES:
            if node.get("call") is not None:
                k += 1
                if node["call"] == name:
                    return k
        return 0

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def _comment(self, text):
        self._node({"xml": '%s<Comment comment="%s"/>\n' % (I8, _esc(text))})

    def _script(self, line):
        chars = "".join('%s<ExpressionChar character="%s"/>\n' % (I12, _esc(c)) for c in line)
        self._node({"xml": '%s<Script type="Line">\n%s<expression>\n%s%s</expression>\n%s</Script>\n' % (I8, I10, chars, I10, I8)})

    def _waypoint(self, pose, joints, params):
        name = self._TargetName
        if name is None:
            self.WAYPOINTS += 1
            name = "Waypoint_%d" % self.WAYPOINTS
        else:
            name = _name(name)
        out = '%s<Waypoint type="Fixed" name="%s">\n' % (I12, _esc(name))
        if params:
            out += "%s<motionParameters %s/>\n" % (I14, params)
        jtxt = ", ".join("%.6f" % v for v in _rad(joints))
        if pose is None:
            out += '%s<position joints="%s"/>\n' % (I14, jtxt)
        else:
            out += '%s<position joints="%s" pose="%s"/>\n' % (I14, jtxt, _pose_attr(pose))
            out += '%s<poseInFeatureCoordinates pose="%s"/>\n' % (I14, _pose_attr(pose))
            out += '%s<outputFlangePose pose="%s"/>\n' % (I14, _pose_attr(mul(pose, inv(self.TOOL))))
        return out + "%s</Waypoint>\n" % I12

    @staticmethod
    def _move_xml(kind, speed, accel, points):
        return lambda: '%s<Move motionType="%s" speed="%.3f" acceleration="%.3f" useActiveTCP="true">\n%s<children>\n%s%s</children>\n%s</Move>\n' % (
            I8, kind, speed, accel, I10, "".join(points), I10, I8)

    def _movej_node(self, pose, joints):
        if not self._main():
            return
        points = [self._waypoint(pose, joints, None)]
        self._node({"xml": self._move_xml("MoveJ", self.SPEED_RADS, self.ACCEL_RADSS, points)()})

    def _movel_node(self, pose, joints):
        if not self._main():
            return
        if self.MOVE is None or self.NEW_MOVE:
            points = []
            self.MOVE = {"points": points, "params": None}
            node = {"xml": self._move_xml("MoveL", self.SPEED_MS, self.ACCEL_MSS, points)}
            self.NODES.append(node)
            self.NEW_MOVE = False
        params = self.MOVE["params"]
        if params is None and self.BLEND > 0:
            params = 'blendRadius="%.3f"' % self.BLEND
        self.MOVE["points"].append(self._waypoint(pose, joints, params))

    def _params_changed(self):
        if self.MOVE is not None and not self.NEW_MOVE:
            self.MOVE["params"] = 'blendRadius="%r" jointSpeed="%r" jointAcceleration="%r" cartesianSpeed="%r" cartesianAcceleration="%r"' % (
                self.BLEND, self.SPEED_RADS, self.ACCEL_RADSS, self.SPEED_MS, self.ACCEL_MSS)

    
    def _blend(self, pose):
        pass
        blend = 0.0
        if pose is not None and self.LAST is not None:
            
            blend = min(self.BLEND, 0.5 * math.dist(self.LAST, xyz(pose)) / 1000.0)
        self.LAST = None if pose is None else xyz(pose)
        return blend

    def MoveJ(self, pose, joints, conf_RLF=None):
        absolute = None if pose is None else mul(self.FRAME, pose)
        r = self._blend(absolute)
        line = "movej(%s,%.5f,%.5f,0,%.4f)" % (_joints(joints), self.ACCEL_RADSS, self.SPEED_RADS, r)
        self.addline(line)
        self._script(line)
        if absolute is not None:
            self._movej_node(absolute, joints)

    def MoveL(self, pose, joints, conf_RLF=None):
        absolute = None if pose is None else mul(self.FRAME, pose)
        r = self._blend(absolute)
        target = _joints(joints) if absolute is None else _pose(absolute)
        self.addline("movel(%s,accel_mss,speed_ms,0,%.3f)" % (target, r))
        self._movel_node(absolute, joints)

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.addline("# " + JOINT_TARGET_C)
            self._comment(JOINT_TARGET_C)
            return
        if self.LAST is None:
            self.MoveL(pose2, joints2, conf_RLF_2)
            return
        a1, a2 = mul(self.FRAME, pose1), mul(self.FRAME, pose2)
        comment = "Circular move (R%.1f mm)" % _circle_radius(self.LAST, xyz(a1), xyz(a2))
        self.addline("# " + comment)
        self._comment(comment)
        line = "movec(%s,%s,%.5f,%.5f,%.4f)" % (_pose(a1), _pose(a2), self.ACCEL_MSS, self.SPEED_MS, self.BLEND)
        self.addline(line)
        self._script(line)
        self.LAST = xyz(a2)

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.FRAME = pose
        text = "Using Ref. %s: %s" % (frame_name, _pose(pose))
        self.addline("# " + text)
        self.addline("# set_reference(%s)" % _pose(pose))
        self._comment(text)

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.TOOL = pose
        text = "Using TCP %s: %s" % (tool_name, _pose(pose))
        self.addline("# " + text)
        self._comment(text)
        line = "set_tcp(%s)" % _pose(pose)
        self.addline(line)
        self._script(line)

    def Pause(self, time_ms):
        if time_ms < 0 or time_ms == 0:
            self.addline("halt() # reimplement this function to force stop")
            self._node({"xml": "%s<Halt/>\n" % I8})
        else:
            self.addline("sleep(%.3f)" % (time_ms * 0.001))
            self._node({"xml": "%s<Wait type=\"Sleep\">\n%s<waitTime>%.3f</waitTime>\n%s</Wait>\n" % (I8, I10, time_ms * 0.001, I8)})

    def setSpeed(self, speed_mms):
        self.SPEED_MS = min(speed_mms, 3000.0) / 1000.0
        self.addline("speed_ms    = %.4f" % self.SPEED_MS)
        self.NEW_MOVE = True

    def setAcceleration(self, accel_mmss):
        self.ACCEL_MSS = min(accel_mmss, 15000.0) / 1000.0
        self.addline("accel_mss   = %.4f" % self.ACCEL_MSS)
        self._params_changed()

    def setSpeedJoints(self, speed_degs):
        self.SPEED_RADS = min(speed_degs, 180.0) * math.pi / 180.0
        self.addline("speed_rads  = %.4f" % self.SPEED_RADS)
        self._params_changed()

    def setAccelerationJoints(self, accel_degss):
        self.ACCEL_RADSS = min(accel_degss, 2291.8) * math.pi / 180.0
        self.addline("accel_radss = %.3f" % self.ACCEL_RADSS)
        self._params_changed()

    def setZoneData(self, zone_mm):
        self.BLEND = max(zone_mm, 0) / 1000.0
        self.addline("blend_radius_m = %.4f" % self.BLEND)

    
    def _set(self, io_var, io_value):
        if isinstance(io_var, str):
            self.addline("%s = %s" % (io_var, _value(io_value)))
            pin = io_var
        else:
            self.addline("set_standard_digital_out(%s, %s)" % (io_var, _value(io_value)))
            pin = "digital_out[%s]" % io_var
        self._node({"xml": '%s<Set type="DigitalOutput">\n%s<pin referencedName="%s"/>\n%s<digitalValue>%s</digitalValue>\n%s</Set>\n' % (
            I8, I10, _esc(pin), I10, _esc(_xml_value(io_value)), I8)})

    def setDO(self, io_var, io_value):
        self._set(io_var, io_value)

    def setAO(self, io_var, io_value):
        self._set(io_var, io_value)

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        var = io_var if isinstance(io_var, str) else "get_standard_digital_in(%s)" % io_var
        pin = io_var if isinstance(io_var, str) else "digital_in[%s]" % var
        self.addline("while (%s != %s):" % (var, _value(io_value)))
        self.addline("  sync()")
        self.addline("end")
        self._node({"xml": '%s<Wait type="DigitalInput">\n%s<pin referencedName="%s"/>\n%s<digitalValue>%s</digitalValue>\n%s</Wait>\n' % (
            I8, I10, _esc(pin), I10, _esc(_xml_value(io_value)), I8)})

    def RunCode(self, code, is_function_call=False):
        if not is_function_call:
            self.addline(code)
            self._script(code)
            return
        call = _name(code)
        if "(" not in call:
            call += "()"
        self.addline(call)
        name = call.split("(")[0]
        if not self._main():
            return
        if name in self.CALLS:
            k = self._call_index(name)
            ref = "../../CallSubProgram%s/subprogram" % ("" if k == 1 else "[%d]" % k)
            xml = '%s<CallSubProgram>\n%s<subprogram reference="%s"/>\n%s</CallSubProgram>\n' % (I8, I10, ref, I8)
            self._node({"xml": xml, "call": ""})
            return
        self.CALLS.append(name)
        xml = (
            '%s<CallSubProgram>\n%s<subprogram name="%s" keepHidden="true" keepSynchronizedWithDisk="true" trackProgramExecution="false">\n'
            '%s<programFile resolves-to="file">/programs/%s.urp</programFile>\n%s<children>\n%s</children>\n%s</subprogram>\n%s</CallSubProgram>\n'
        ) % (I8, I10, _esc(name), I12, _esc(name), I12, I12, I10, I8)
        self._node({"xml": xml, "call": name})

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.addline("# %s" % message)
            self._comment(message)
        else:
            self.addline('popup("%s","Message",False,False,blocking=True)' % message)
            self._node({"xml": '%s<Popup type="Message" haltProgram="false" message="%s"/>\n' % (I8, _esc(message))})
