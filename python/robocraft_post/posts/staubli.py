# Builds Staubli VAL3 projects with XML program files, databases and motion helpers.




















import math
import re

from ..base import RobotPost, register

JOINT_TARGET_L = "// Linear movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."
JOINT_TARGET_C = "// Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."
XML = '<?xml version="1.0" encoding="utf-8"?>'
NS_PROG = '<Programs xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://www.staubli.com/robotics/VAL3/Program/2">'
NS_PARAM = '    <Parameters xmlns="http://www.staubli.com/robotics/VAL3/Param/1">'


MAIN_PROJECT = """<?xml version="1.0" encoding="utf-8" ?>
<Project xmlns="http://www.staubli.com/robotics/VAL3/Project/3">
  <Parameters version="s7.3.1" stackSize="5000" millimeterUnit="true" />
  <Programs>
    <Program file="loadNextOne.pgx" />
    <Program file="start.pgx" />
    <Program file="stop.pgx" />
  </Programs>
  <Database>
    <Data file="%(main)s.dtx" />
  </Database>
  <Libraries>
    <Library alias="prog" path="./%(first)s/%(first)s.pjx" />
    <Library alias="prog_swap" path="./%(first)s/%(first)s.pjx" />
    <Library alias="tooldata" path="saveChangeTool" />
  </Libraries>
</Project>"""
LOAD_NEXT = """<?xml version="1.0" encoding="utf-8" ?>
<Programs xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://www.staubli.com/robotics/VAL3/Program/2">
  <Program name="loadNextOne" access="private">
    <Parameters xmlns="http://www.staubli.com/robotics/VAL3/Param/1">
      <Parameter name="x_sName" type="string" xsi:type="element" />
    </Parameters>
    <Code><![CDATA[
begin
  prog_swap:libLoad(x_sName)
end
      ]]></Code>
  </Program>
</Programs>"""
MAIN_START = """<?xml version="1.0" encoding="utf-8" ?>
<Programs xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://www.staubli.com/robotics/VAL3/Program/2">
  <Program name="start" access="public">
    <Code><![CDATA[
begin
%s

end
      ]]></Code>
  </Program>
</Programs>
"""


def _xyz_angles(pose):
    pass
    if abs(pose[0][2]) > 1 - 1e-10:  
        ry = 90.0 if pose[0][2] > 0 else -90.0
        return [pose[0][3], pose[1][3], pose[2][3], 0.0, ry, math.degrees(math.atan2(pose[1][0], pose[1][1]))]
    rx = math.degrees(math.atan2(-pose[1][2], pose[2][2]))
    ry = math.degrees(math.asin(max(-1.0, min(1.0, pose[0][2]))))
    rz = math.degrees(math.atan2(-pose[0][1], pose[0][0]))
    return [pose[0][3], pose[1][3], pose[2][3], rx, ry, rz]


def _attrs(values):
    return 'x="%.3f" y="%.3f" z="%.3f" rx="%.3f" ry="%.3f" rz="%.3f"' % tuple(values)


def _program(name, code, params=None, locals_=None):
    out = [XML, NS_PROG, '  <Program name="%s">' % name]
    if params:
        out += [NS_PARAM] + ['      <Parameter name="%s" type="num" xsi:type="element" />' % p for p in params] + ["    </Parameters>"]
    if locals_:
        out += ["    <Locals>"] + locals_ + ["    </Locals>"]
    out += ["    <Code><![CDATA[begin"] + code + ["end]]></Code>", "  </Program>", "</Programs>"]
    return "\n".join(out)


@register
class StaubliVal3(RobotPost):
    name = "Staubli_VAL3"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.ENTRIES = []  
        self.FRAME = [0.0] * 6
        self.TOOL = None
        self.USED_CIRC = False
        self.SCARA = self.ROBOT_AXES == 4
        self.POINT = "pPointRs" if self.SCARA else "pPointRx"
        self.CONFIG = ["lefty", "epositive", "wpositive"]
        self.LAST = None

    def addline(self, line, counted=True):
        self.ENTRIES.append(([line] if isinstance(line, str) else list(line), counted))

    def ProgStart(self, progname):
        self.CUR = progname
        self.addline("// Program %s start" % progname)

    def ProgFinish(self, progname):
        self.LAST = self.CUR
        self.addline(["", "waitEndMove()", "// Program %s end" % progname], counted=False)

    
    def _config_init(self):
        if self.SCARA:
            return ["pPointRs.config.shoulder = lefty", "pPointRs2.config.shoulder = lefty"]
        out = []
        for point in ("pPointRx", "pPointRx2"):
            out += ["%s.config.shoulder = lefty" % point, "%s.config.elbow = epositive" % point, "%s.config.wrist = wpositive" % point]
        return out

    def _main(self, lines):
        code = ["close(tCurrentTool)"] + self._config_init()
        code += ["mCurrentSpeed.tvel = 100.00", "mCurrentSpeed.blend = joint", "mCurrentSpeed.reach = 0.010", "mCurrentSpeed.leave = 0.010"]
        return _program("main", ["  " + l if l else "  " for l in code + lines] + [""])

    def _database(self):
        out = [XML, '<Database xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://www.staubli.com/robotics/VAL3/Data/2">', "  <Datas>"]
        out.append('    <Data name="mNomSpeed" access="private" xsi:type="array" type="mdesc" size="1" />')
        out += ['    <Data name="fFrame1" access="private" xsi:type="array" type="frame" size="1">',
                '      <Value key="0" %s fatherId="world[0]" />' % _attrs(self.FRAME), "    </Data>"]
        for name, kind in (("Input", "I"), ("Output", "Q")):
            out.append('    <Data name="%s" access="private" xsi:type="array" type="dio" size="16">' % name)
            out += ['      <Value key="%i" link="BasicIO-1\\%%%s%i" />' % (k, kind, k) for k in range(16)]
            out.append("    </Data>")
        tool = _attrs(self.TOOL) if self.TOOL else 'x="0.000" y="0.000" z="0.000" rx="0.000" ry="0.000" rz="0.000"'
        out += ['    <Data name="tCurrentTool" access="private" xsi:type="array" type="tool" size="1">',
                '      <Value key="0" %s fatherId="flange[0]" ioLink="ValveIO/valve1" />' % tool, "    </Data>"]
        out.append('    <Data name="mCurrentSpeed" access="private" xsi:type="array" type="mdesc" size="1" />')
        kind = "pointRs" if self.SCARA else "pointRx"
        for point in (self.POINT, self.POINT + "2"):
            out += ['    <Data name="%s" access="private" xsi:type="array" type="%s" size="1">' % (point, kind),
                    '      <Value key="0" fatherId="fFrame1[0]" />', "    </Data>"]
        out += ["  </Datas>", "</Database>"]
        return "\n".join(out) + "\n"

    def _project(self, data_name):
        programs = ["MoveJoint.pgx", "MoveLine.pgx"] + (["MoveCirc.pgx"] if self.USED_CIRC else []) + ["start.pgx", "stop.pgx", "main.pgx"]
        out = [XML, '<Project xmlns="http://www.staubli.com/robotics/VAL3/Project/3">', '<Parameters version="s7.5.3" stackSize="5000" millimeterUnit="true" />', "<Programs>"]
        out += ['<Program file="%s" />' % p for p in programs]
        out += ["</Programs>", "<Database>", '<Data file="%s.dtx" />' % data_name, "</Database>", "<Libraries />", "</Project>"]
        return "\n".join(out) + "\n"

    def _helpers(self):
        n = 4 if self.SCARA else 6  
        joint = _program("MoveJoint", ["  l_jJoint.j%i = x_nJ%i" % (k, k) for k in range(1, n + 1)] + ["  movej(l_jJoint,tCurrentTool ,mCurrentSpeed)"],
                         ["x_nJ%i" % k for k in range(1, n + 1)], ['      <Local name="l_jJoint" type="joint" xsi:type="array" size="1" />'])
        p, p2 = self.POINT, self.POINT + "2"
        axes = ["X", "Y", "Z", "Rx", "Ry", "Rz"]
        line = _program("MoveLine", ["  %s.trsf.%s = x_n%s" % (p, a.lower(), a) for a in axes] + ["  movel(%s,tCurrentTool,mCurrentSpeed)" % p],
                        ["x_n%s" % a for a in axes])
        circ = _program("MoveCirc", ["  %s.trsf.%s = x_n%s" % (p, a.lower(), a) for a in axes] + ["  %s.trsf.%s = x_n%s2" % (p2, a.lower(), a) for a in axes]
                        + ["  movec(%s,%s,tCurrentTool,mCurrentSpeed)" % (p, p2)], ["x_n%s" % a for a in axes] + ["x_n%s2" % a for a in axes])
        files = [("MoveJoint.pgx", joint + "\n"), ("MoveLine.pgx", line + "\n")]
        return files + ([("MoveCirc.pgx", circ + "\n")] if self.USED_CIRC else [])

    def _parts(self, n):
        pass
        parts = []
        cur, count = None, 0
        for lines, counted in self.ENTRIES:
            if counted:
                if cur is None or count >= n + 1:
                    cur, count = [], 0
                    parts.append([cur, 0])
                count += 1
                parts[-1][1] = count
            elif cur is None:
                cur = []
                parts.append([cur, 0])
            cur.extend(lines)
        if len(parts) > 1 and parts[-1][1] == 1:
            parts.pop()
        return [p[0] for p in parts]

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        n = self.MAX_LINES_X_PROG
        parts = self._parts(n) if n > 0 else [[l for lines, _c in self.ENTRIES for l in lines]]
        if len(parts) == 1:
            base = "%s/" % progname
            last = self.LAST or progname
            self.save_file(folder, base + "%s.pjx" % last, self._project(last))
            self.save_file(folder, base + "%s.dtx" % last, self._database())
            self.save_file(folder, base + "main.pgx", self._main(parts[0]))
            self.save_file(folder, base + "start.pgx", _program("start", ["  call main()"]) + "\n")
            self.save_file(folder, base + "stop.pgx", _program("stop", []) + "\n")
            for name, text in self._helpers():
                self.save_file(folder, base + name, text)
            return
        main = "Main%s" % progname
        names = [progname] + ["%s%i" % (progname, k + 1) for k in range(1, len(parts))]
        for name, lines in zip(names, parts):
            base = "%s/%s/" % (main, name)
            self.save_file(folder, base + "%s.pjx" % name, self._project(name))
            self.save_file(folder, base + "%s.dtx" % name, self._database())
            self.save_file(folder, base + "main.pgx", self._main(lines))
            for fname, text in self._helpers():
                self.save_file(folder, base + fname, text)
        self.save_file(folder, "%s/%s.pjx" % (main, main), MAIN_PROJECT % {"main": main, "first": names[0]})
        self.save_file(folder, "%s/%s.dtx" % (main, main), self._database())
        self.save_file(folder, "%s/loadNextOne.pgx" % main, LOAD_NEXT)
        steps = []
        for k, name in enumerate(names):
            steps += ['  if prog:libLoad("./%s")!=0' % name, '    logMsg("Error Loading Enginuity library")', '    popUpMsg("Error Loading Enginuity library")',
                      "  endIf", '  wait(taskStatus("loading")==-1)']
            if k + 1 < len(names):
                steps.append('  taskCreate "loading",10,loadNextOne("./%s")' % names[k + 1])
            steps += ["  call prog:start()", "  "]
        self.save_file(folder, "%s/start.pgx" % main, MAIN_START % "\n".join(steps))
        self.save_file(folder, "%s/stop.pgx" % main, _program("stop", []) + "\n")

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def _config(self, conf):
        rear, lower, flip = (list(conf or [0, 0, 0]) + [0, 0, 0])[:3]
        wanted = ["righty" if rear else "lefty", "enegative" if lower else "epositive", "wnegative" if flip else "wpositive"]
        names = ["shoulder", "elbow", "wrist"][: 1 if self.SCARA else 3]
        lines = []
        for k, part in enumerate(names):
            if wanted[k] != self.CONFIG[k]:
                self.CONFIG[k] = wanted[k]
                lines.append("%s.config.%s = %s" % (self.POINT, part, wanted[k]))
        return lines

    @staticmethod
    def _pose(pose):
        return ",".join("%.3f" % v for v in _xyz_angles(pose))

    def MoveJ(self, pose, joints, conf_RLF=None):
        self.addline("call MoveJoint(%s)" % ",".join("%.5f" % v for v in joints))

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.addline(JOINT_TARGET_L)
            return
        config = self._config(conf_RLF) if conf_RLF is not None else []
        self.addline(config + ["call MoveLine(%s)" % self._pose(pose)])

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.addline(JOINT_TARGET_C)
            return
        self.USED_CIRC = True
        self.addline("call MoveCirc(%s,%s)" % (self._pose(pose1), self._pose(pose2)))

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.FRAME = _xyz_angles(pose)
        self.addline([])  

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.TOOL = _xyz_angles(pose)
        self.addline([])

    def Pause(self, time_ms):
        if time_ms < 0:
            self.addline('popUpMsg("Paused. Press OK to continue")')
        else:
            self.addline("delay(%.3f)" % (time_ms / 1000.0))

    def setSpeed(self, speed_mms):
        self.addline("mCurrentSpeed.tvel = %.3f" % speed_mms, counted=False)

    def setAcceleration(self, accel_mmss):
        pass

    def setSpeedJoints(self, speed_degs):
        pass

    def setAccelerationJoints(self, accel_degss):
        pass

    def setZoneData(self, zone_mm):
        self.addline(["mCurrentSpeed.reach = %.3f" % zone_mm, "mCurrentSpeed.leave = %.3f" % zone_mm], counted=False)

    
    @staticmethod
    def _value(value):
        if isinstance(value, str):
            return value
        return "true" if value > 0 else "false"

    def setDO(self, io_var, io_value):
        var = io_var if isinstance(io_var, str) else "Output[%s]" % io_var
        self.addline("%s=%s" % (var, self._value(io_value)), counted=False)

    def setAO(self, io_var, io_value):
        self.setDO(io_var, io_value)

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        var = io_var if isinstance(io_var, str) else "Input[%s]" % io_var
        if timeout_ms is None or timeout_ms < 0:
            self.addline("watch(%s==%s)" % (var, self._value(io_value)), counted=False)
        else:
            self.addline("watch(%s==%s,%.1f)" % (var, self._value(io_value), timeout_ms), counted=False)

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            self.addline("//call prog:%s" % (code if "(" in code else code + "()"))
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.addline("// %s" % message)
        else:
            self.addline('popUpMsg("%s")' % message)
