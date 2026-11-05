# Builds Omron and Techman controller projects with flow nodes and motion targets.























































import json
import math
import re

from ..base import RobotPost, is_number, register
from ..robomath import eye, inv, mul

PROG_XML = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n\n'
CIRCLE_JOINTS = "Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."

VERSION = "1.72.3800.29688"
DAT_TAIL = """  </RobotBases>
  <VirtualTCP>
  </VirtualTCP>
  <Network>
  </Network>
  <FTSensor>
  </FTSensor>
  <FineTuneVariable>
  </FineTuneVariable>
  <Conveyor>
  </Conveyor>
  <DisplayMgr>
    <Pwd pwd="" />
  </DisplayMgr>
  <SafetySpace>
  </SafetySpace>
  <MaxBaseNumber>
    <Custom max="%d" />
    <Vision max="0" />
  </MaxBaseNumber>
  <ModbusDevice>
    <Device DeviceName="localhost" Type="TCP" IP="127.0.0.1" Port="502" ID="1" Timeout="10000" />
  </ModbusDevice>
  <DisableSmartSafetySpeed value="false" />
  <RefreshDILPeriod value="300" />
  <RunStopSetting />
  <RunErrorSetting />
</Root>"""
END_EFFECTOR = """    <EndEffector order="%d" default="false">
      <Name>%s</Name>
      <Description />
      <GPTFF>
        <X>%.3f</X>
        <Y>%.3f</Y>
        <Z>%.3f</Z>
        <W>%.3f</W>
        <V>%.3f</V>
        <U>%.3f</U>
      </GPTFF>
      <Mass>0.0</Mass>
      <MassCenter>
        <X>0</X>
        <Y>0</Y>
        <Z>0</Z>
        <W>0</W>
        <V>0</V>
        <U>0</U>
      </MassCenter>
      <Inertia>
        <Ixx>0</Ixx>
        <Iyy>0</Iyy>
        <Izz>0</Izz>
      </Inertia>
      <GPTCF>
        <X>0</X>
        <Y>0</Y>
        <Z>0</Z>
        <W>0</W>
        <V>0</V>
        <U>0</U>
      </GPTCF>
    </EndEffector> 
"""


def _xyzrpw(h):
    pass
    if h[2][0] > 1.0 - 1e-10:
        a, b, c = math.atan2(-h[1][2], h[1][1]), -math.pi / 2, 0.0
    elif h[2][0] < -1.0 + 1e-10:
        a, b, c = math.atan2(h[1][2], h[1][1]), math.pi / 2, 0.0
    else:
        b = math.atan2(-h[2][0], math.sqrt(h[0][0] * h[0][0] + h[1][0] * h[1][0]))
        a, c = math.atan2(h[1][0], h[0][0]), math.atan2(h[2][1], h[2][2])
    return [h[0][3], h[1][3], h[2][3], c * 180.0 / math.pi, b * 180.0 / math.pi, a * 180.0 / math.pi]


def _pose_text(h):
    return "%.3f,%.3f,%.3f,%.4f,%.4f,%.4f" % tuple(_xyzrpw(h))


def filter_name(text):
    pass
    name = re.sub(r"[^A-Za-z0-9_()]", "", str(text))
    if not name or name[0].isdigit():
        name = "P" + name
    return name


def _hl(value):
    if isinstance(value, bool):
        return "H" if value else "L"
    if is_number(value):
        return "H" if value > 0 else "L"
    return str(value)


def _channel(io_var):
    try:
        return int(str(io_var))
    except ValueError:
        return None


def _text_bool(value):
    return "true" if str(value).strip().lower() == "true" else "false"


def _same(a, b):
    pass
    drop = re.compile(r' base="[^"]*"')
    return drop.sub("", a) == drop.sub("", b)


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


@register
class Omron(RobotPost):
    name = "Omron"
    PRODUCT_NAME = "Enginuity"
    
    JOINT_SPEED_PERCENT = 1.85

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.nodes = []  
        self.flows = []  
        self.flow = None
        self.counters = {}
        self.node_id = 0
        self.subflows = {}  
        self.points = []  
        self.frames = []  
        self.tools = []  
        self.frame_name, self.frame_pose = "RobotBase", eye()
        self.tool_name, self.tool_pose = "NOTOOL", eye()
        self.messages = []
        self.header_done = False
        self.zone = 1.0
        self.speed, self.accel, self.lsttts = 250.0, None, "300"
        self.joint_pct, self.joint_accel, self.psttts = 100, None, "150"
        self.prog_name = None

    
    def _node(self, kind, replace, obj, short=None):
        self.counters[kind] = self.counters.get(kind, 0) + 1
        self.node_id += 1
        nodes = self.flow[1]
        i = len(nodes)
        node = {
            "Name": "%s%d" % (short or kind, self.counters[kind]),
            "NodeID": self.node_id,
            "ParentNode": nodes[-1]["Name"] if nodes else "",
            "ChildNode": "",
            "ReplaceName": replace,
            "HMIFlowPoint": [100.0 + 200.0 * (i // 8), 200.0 + 100.0 * (i % 8)],
            "NodeType": kind,
            "NodeIcon": "",
            "GroupName": None,
            "ThreadName": "",
            "SubFlowName": self.flow[0],
            "InitValue": "YES",
            "UpdateFlag": "",
            "ObjectNode": obj,
            "Attribute": 0,
        }
        if nodes:
            nodes[-1]["ChildNode"] = node["Name"]
        nodes.append(node)
        return node

    def _display(self, replace, text, header=False):
        obj = {"FGColor": "Black", "BGColor": "Blue" if header else "White",
               "TitleText": "%s %s" % (self.PRODUCT_NAME, "Program" if header else "Message"), "LogText": text}
        self._node("Display", replace, obj)

    def _blend(self):
        return {"Blend": "YES" if self.zone >= 0 else "NO", "BlendValue": _clamp(int(self.zone), 1, 100)}

    def _precise(self):
        return "true" if self.zone >= 0 else False

    
    def _point(self, pose, joints):
        if pose is None:
            flange, _config = self.robot_fk(joints)
            flange = mul(inv(self.frame_pose), flange)
            target = mul(flange, self.tool_pose)
        else:
            target = pose
            flange = mul(pose, inv(self.tool_pose))
        q = [float(v) for v in joints]
        jtext = ",".join(["%.5f" % v for v in q[:-1]] + ["%.4f" % q[-1]])
        attrs = 'coordinate="%s" joint_angle="%s" tool_mode="%s" base="%s" tcp="%s" type="R"' % (
            _pose_text(flange), jtext, _pose_text(target), self.frame_name, self.tool_name)
        name = None
        if self._TargetName:
            name = filter_name(str(self._TargetName).replace(" ", "_"))
        if name is None:
            for n, a in self.points:
                if _same(a, attrs):
                    return n
            name = "Point%d" % (len(self.points) + 1)
        else:
            for n, a in self.points:
                if n == name:
                    if _same(a, attrs):
                        return n
                    name = "%s%d" % (name, len(self.points) + 1)
                    break
        self.points.append([name, attrs])
        return name

    def _move(self, cmd, pose, joints):
        point = self._point(pose, joints)
        line = cmd == "Line"
        obj = {"Speed": "100", "MotionCMD": cmd}
        obj.update(self._blend())
        obj.update({
            "PSPercentage": "50" if line else str(self.joint_pct),
            "PSTTTS": "500" if line else self.psttts,
            "PSTTTSOF": "ON",
            "PTPType": 1,
            "LineABS": "ON" if line else "OFF",
            "LSPercentage": "100",
            "LSAVelocity": str(int(self.speed)) if line else "250",
            "LSTTTS": self.lsttts if line else "500",
            "BaseName": self.frame_name,
            "TCPName": self.tool_name,
            "EnableLoad": True,
            "LoadValue": "0",
            "WayPointHP": "50",
            "WayPointSpeed": "-1",
            "IsKeepPose": True,
            "DisablePrecisePositioning": self._precise(),
            "DisableStickSpeedLink": False,
            "SmartPTPConfig": False,
            "IsBaseShifting": False,
            "IsToolShifting": False,
            "WayPointMode": 0,
            "WayPointHeight": "0",
            "WayPointMotion": 0,
            "WayPointLineABS": "OFF",
            "WayPointLSPercentage": "100",
            "WayPointLSAVelocity": "250",
            "WayPointLSTTTS": "500",
        })
        self._node("Point", point, obj, short="P")

    
    def ProgStart(self, progname):
        if self.prog_name is None:
            self.prog_name = progname
            self.flow = ["", [], progname]
        else:
            key = filter_name(progname)
            self.flow = [self.subflows.get(key, "SubFlow_%d" % len(self.subflows)), [], progname]
        self.flows.append(self.flow)

    def ProgFinish(self, progname):
        pass

    def _flow_json(self):
        main = self.flows[0][1] if self.flows else []
        start = {
            "Name": "Start", "ParentNode": "", "ChildNode": main[0]["Name"] if main else "", "ReplaceName": "Start",
            "InitValue": "YES", "NodeType": "Start", "StickSpeed": "100", "Trialed": "False", "UpdateFlag": "",
            "ObjectNode": {"ProfileName": "All Full Speed Operation Space", "BindingSpace": "", "BindingBase": "RobotBase"},
            "SubFlowName": "", "ThreadName": "", "CompileOption": None, "Version": VERSION, "NonPauseFlag": False,
            "NoIOInitial": False, "Tag": "", "Attribute": 0, "EnableBlendingSetCmd": True, "EnableBusyLoopOptimization": False,
        }
        subs = []
        for name, nodes, prog in self.flows[1:]:
            subs.append({
                "Name": name, "ParentNode": "", "ChildNode": nodes[0]["Name"] if nodes else "", "ReplaceName": prog,
                "InitValue": "YES", "NodeType": "Start", "StickSpeed": "100", "Trialed": "False", "UpdateFlag": "",
                "ObjectNode": None, "SubFlowName": name, "ThreadName": "", "CompileOption": None, "Version": None,
                "NonPauseFlag": False, "NoIOInitial": False, "Tag": "SubFlow", "Attribute": 0,
                "EnableBlendingSetCmd": False, "EnableBusyLoopOptimization": False,
            })
        doc = {
            "FlowFile": {"Version": "-1.11"},
            "BaseMathDefine": None,
            "BaseStart": start,
            "BaseObjectSingle": self.nodes_in_order(),
            "BaseObjectMulti": [],
            "SubFlowStart": subs,
            "MultiThreadStart": [],
            "ChildNode": start["ChildNode"],
        }
        return json.dumps(doc, indent=2)

    def nodes_in_order(self):
        out = []
        for _name, nodes, _prog in self.flows:
            out.extend(nodes)
        return sorted(out, key=lambda n: n["NodeID"])

    def _dat(self):
        lines = ['<?xml version="1.0" encoding="UTF-8" standalone="no"?>', "<Root>", "  <RobotPoints>"]
        for name, attrs in self.points:
            lines.append('  <Point name="%s" %s />' % (name, attrs))
        lines += ["  </RobotPoints>", "  <RobotBases>", '    <Base name="RobotBase" basedata="0,0,0,0,0,0" type="R" number="0" />']
        custom = ['    <Base name="%s" basedata="%s" type="C" number="%d" />' % (n, t, i + 1) for i, (n, t) in enumerate(self.frames)]
        lines += custom
        return "\n".join(lines) + "\n" + DAT_TAIL % (1 + sum(len(c) + 1 for c in custom))

    def _config(self):
        out = "<Configuration>\n  <TCPConfig> \n"
        for i, (name, pose) in enumerate(self.tools):
            out += END_EFFECTOR % ((i + 1, name) + tuple(_xyzrpw(pose)))
        return out + "  </TCPConfig>\n</Configuration>\n"

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        base = "%s/Projects/%s/%s" % (progname, progname, progname)
        self.files.append(("%s/ConfigData.xml" % progname, self._config()))
        self.files.append((base + ".prog", PROG_XML))
        self.files.append((base + ".flow", self._flow_json()))
        self.files.append((base + ".dat", self._dat()))
        self.stdout.append("SAVED: %s%s.flow" % (folder or "", base))

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def MoveJ(self, pose, joints, conf_RLF=None):
        self._move("PTP", pose, joints)

    def MoveL(self, pose, joints, conf_RLF=None):
        self._move("Line", pose, joints)

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self._display(filter_name(CIRCLE_JOINTS)[:10], CIRCLE_JOINTS)
            return
        obj = dict(self._blend())
        obj.update({
            "LineABS": "ON", "LSPercentage": "100", "LSAVelocity": str(int(self.speed)), "LSTTTS": self.lsttts,
            "BaseName": "RobotBase", "TCPName": "NOTOOL", "LoadValue": "0",
            "PassPoint": _xyzrpw(mul(self.frame_pose, pose1)), "EndPoint": _xyzrpw(mul(self.frame_pose, pose2)),
            "CircleAngle": 0, "DisablePrecisePositioning": self._precise(), "DisableStickSpeedLink": False,
        })
        self._node("Circle", None, obj)
        self.flow[1][-1]["ReplaceName"] = self.flow[1][-1]["Name"]

    def setFrame(self, pose, frame_id=None, frame_name=None):
        text = _pose_text(pose)
        if all(abs(v) < 1e-9 for v in _xyzrpw(pose)):
            self._display("Frame", "Frame %s: %s" % (frame_name, text))
            self.frame_name, self.frame_pose = "RobotBase", pose
            return
        name = filter_name(frame_name)
        if not any(n == name for n, _t in self.frames):
            self.frames.append([name, text])
        self.frame_name, self.frame_pose = name, pose

    def setTool(self, pose, tool_id=None, tool_name=None):
        name = filter_name(tool_name)
        if not any(n == name for n, _p in self.tools):
            self.tools.append([name, pose])
        self.tool_name, self.tool_pose = name, pose

    def Pause(self, time_ms):
        if time_ms <= 0:
            self._node("Pause", "Pause", {"LogText": "", "hasVoice": "True", "hasBuzzer": "False"})
            return
        n = self.counters.get("WaitFor", 0) + 1
        self._wait("Wait%dms%d" % (int(time_ms), n), [], [], str(int(time_ms)), "&&")

    def setSpeed(self, speed_mms):
        self.speed = speed_mms
        if self.accel:
            self.lsttts = str(_clamp(int(speed_mms / self.accel * 1000), 150, 9999))

    def setAcceleration(self, accel_mmss):
        self.accel = accel_mmss

    def setSpeedJoints(self, speed_degs):
        unit = self.JOINT_SPEED_PERCENT
        self.joint_pct = _clamp(int(speed_degs / unit), 1, 100)
        if self.joint_accel:
            self.psttts = str(_clamp(int(self.joint_pct * unit / self.joint_accel * 1000), 150, 9999))

    def setAccelerationJoints(self, accel_degss):
        self.joint_accel = accel_degss

    def setZoneData(self, zone_mm):
        self.zone = zone_mm

    
    def _set(self, replace, dio, aio, math_data):
        self._node("SET", replace, {"DIOData": dio, "CameraLightOnOff": None, "AIOData": aio, "MathData": math_data})

    def _wait(self, replace, dio, math_data, time_data, condition):
        self._node("WaitFor", replace, {
            "DIOData": dio, "DIOThan": "or", "CameraLightOnOff": None, "AIOData": [], "AIOThan": "or",
            "MathData": math_data, "MathThan": "or", "ComplianceData": [], "ComplianceThan": "or",
            "TimeData": time_data, "Condition": condition,
        })

    def setDO(self, io_var, io_value):
        chan = _channel(io_var)
        if chan is None:
            value = str(io_value) if is_number(io_value) else _text_bool(io_value)
            self._set("Set_Var_%s_%s" % (filter_name(io_var), value), [], [], [{"Variable": str(io_var), "Condition": "=", "Value": value}])
            return
        hl = _hl(io_value)
        device, prefix = 16, "Set_DO"
        if chan >= 20:
            device, prefix, chan = 64, "Set_EndModule_DO", chan - 20
        self._set("%s%d%s" % (prefix, chan, hl), [{"DeviceType": device, "Slot": "0", "HL": hl, "Chan": chan, "DIOType": "DO"}], [], [])

    def setAO(self, io_var, io_value):
        chan = min(int(io_var), 1)
        try:
            float(io_value)
        except (TypeError, ValueError):
            return
        self._set("Set_AO%d" % chan, [], [{"DeviceType": 16, "Slot": "0", "Value": str(io_value), "AIOType": "AO", "Condition": "", "Chan": chan}], [])

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        chan = _channel(io_var)
        if chan is None:
            if is_number(io_value) and not isinstance(io_value, bool):
                value = "true" if io_value > 0 else "false"
            else:
                value = _text_bool(io_value)
            self._wait("Wait_Var_%s_%s" % (filter_name(io_var), value), [], [{"Variable": str(io_var), "Condition": "==", "Value": value}], "", "||")
            return
        hl = _hl(io_value)
        self._wait("Wait_DI%d%s" % (chan, hl), [{"DeviceType": 16, "Slot": "0", "HL": hl, "Chan": chan, "DIOType": "DI"}], [], "", "&&")

    
    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            key = filter_name(code)
            if key not in self.subflows:
                self.subflows[key] = "SubFlow_%d" % (len(self.subflows) + 1)
            self._node("SubFlow", key, {"isVariable": False, "SubFlowName": self.subflows[key]})
            return
        self._display(filter_name(code)[:10], code)

    def RunMessage(self, message, iscomment=False):
        text = message if iscomment else "Popup: %s" % message
        if self.flow is self.flows[0] and not self.header_done:
            self.messages.append(text)
            if len(self.messages) == 2:
                self.header_done = True
                self._display(self.PRODUCT_NAME, "\n".join(self.messages + ["Robot program running"]), header=True)
            return
        self._display(filter_name(message)[:10], text)


@register
class Techman(Omron):
    pass

    name = "Techman"
    JOINT_SPEED_PERCENT = 10.0
