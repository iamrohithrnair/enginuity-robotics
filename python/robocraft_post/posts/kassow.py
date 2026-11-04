
















































import json
import math
import re
import time

from ..base import RobotPost, register
from ..robomath import euler_zyx

LINEAR_ON_JOINTS = "Linear movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."
CIRCULAR_ON_JOINTS = "Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."


def _num(value):
    return {"type_id": 3000, "permissions": 3, "value": value}


def _xyz(x, y, z, tid=3001):
    return {"type_id": tid, "permissions": 3, "x": _num(x), "y": _num(y), "z": _num(z)}


def _rpy(r, p, y):
    return {"type_id": 3002, "permissions": 3, "r": _num(r), "p": _num(p), "y": _num(y)}


def _frame(perm, pos, rpy, ref=None):
    out = {"type_id": 3005, "permissions": perm, "position": _xyz(*pos), "orientation": _rpy(*rpy)}
    if ref is not None:
        out["ref_poseLocal"] = ref
    return out


def _system(tid, ref_id, system_id, desc, content, label=None):
    return {"type_id": tid, "reference_id": ref_id, "n_copy": 0, "system_id": system_id, "system_desc": desc, "shortcut": True, "label": label or ref_id, "content": content}


ZERO3 = (0.0, 0.0, 0.0)


def _world():
    return _system(2001, "FRMWORLD", "/sys/model/robot/frames/FRMWORLD", "World Frame", _frame(3, ZERO3, ZERO3))


def _flange():
    return _system(2001, "FRMRFLNG", "/sys/model/robot/frames/FRMRFLNG", "Tool Flange Centre Frame (TFC)", _frame(3, ZERO3, ZERO3, _world()))


def _load_content(pose=None):
    out = {"type_id": 3007, "permissions": 3}
    if pose is not None:
        out["poseLocal"] = pose
    out["mass"] = _num(0.0)
    out["cog"] = _xyz(0.0, 0.0, 0.0)
    out["imx"] = {"type_id": 3004, "permissions": 3, **{k: _num(0.0) for k in ("xx", "yy", "zz", "xy", "xz", "yz")}}
    return out


def _system_variables():
    return [
        _system(2002, "TARGET", "/sys/model/robot/frames/FRMTRGT", "Last Target Frame", _frame(1, ZERO3, ZERO3, _world())),
        
        _system(2002, "TFC", "/sys/model/robot/frames/FRMRFLNG", "TFC Frame", _frame(3, (0, 0.10934999999999999, 1.2081), (0, 0, 0), _world())),
        _system(2002, "TCP", "/sys/model/robot/frames/FRMTCP", "TCP Frame", _frame(3, ZERO3, ZERO3, _flange())),
        _system(
            2002, "LOAD2", "/sys/model/robot/loads/LADPAYL", "Payload",
            _load_content(_system(2001, "FRMPAYLD", "/sys/model/robot/frames/FRMPAYLD", "Load 2 Frame", _frame(3, ZERO3, ZERO3, _flange()))),
        ),
    ]


def _name(text):
    pass
    s = re.sub(r"[^A-Za-z0-9_()]", "", str(text))
    if not s or s[0].isdigit():
        s = "P" + s
    return s


def _item_name(text):
    pass
    return _name(str(text).replace(" ", "_"))


def _node(class_id, tags, arguments):
    return {"classId": class_id, "suppressed": False, "breakpoint": False, "tags": tags, "arguments": arguments}


def _wait(interval="", conditional="", timeout=""):
    if conditional:
        args = {"version": "1.1", "inputType": 2, "interval": {"argExpression": ""}, "conditional": {"argExpression": conditional}, "conditionType": 1, "timeout": {"argExpression": timeout}}
    else:
        args = {"version": "1.1", "inputType": 1, "interval": {"argExpression": interval}, "conditionType": 1, "conditional": {"argExpression": ""}, "timeout": {"argExpression": ""}}
    return _node(1009, ["INSTRUCTION", "WAIT"], args)


def _dialog(text):
    return _node(1016, ["DIALOG", "PROGRAM"], {
        "title": "Enginuity Dialog", "icon": "None", "argExpression": '"%s"' % text, "inputs": [], "target": {"targetRef": "x_0"},
        "btn_positive": {"text": "Proceed", "value": "1", "visible": True},
        "btn_neutral": {"text": "Neutral", "value": "3", "visible": False},
        "btn_negative": {"text": "Dismiss", "value": "2", "visible": True},
        "blocking": True, "dismissType": "Rising Edge", "dismissExpression": "",
    })


def _comment(text):
    return _node(1013, ["INSTRUCTION", "COMMENT"], {"textShort": text, "textLong": ""})


def _set(left, right):
    return _node(1008, ["INSTRUCTION", "SET", "PROGRAM"], {"argLeftExpression": left, "argRightExpression": right})


def _str(value):
    return str(value)


@register
class Kassow(RobotPost):
    name = "Kassow"
    PROG_EXT = "kr2"
    VERSION = "0.9.0"
    
    VOLATILE = [rb'"creationTimeStamp": \d+']

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.TREES = []
        self.VARS = _system_variables()
        self.VAR_NAMES = set()
        self.add_var(self._pose_var("tcp_init", ZERO3, ZERO3, "TFC_0", "global"))
        self.add_var({"type_id": 2000, "reference_id": "load_init", "n_copy": 0, "shortcut": True, "label": "load_init", "content": _load_content(), "scope": "global"})
        self.STRUCT = None
        self.FRAME = None
        self.N_TARGET = 0
        self.SPEED = 0.25
        self.SPEED_JOINTS = math.radians(60)
        self.ACCEL = 0.25
        self.ACCEL_JOINTS = math.radians(200)
        self.ZONE = -1

    
    def add_var(self, var):
        if var["label"] in self.VAR_NAMES:
            return
        self.VAR_NAMES.add(var["label"])
        self.VARS.append(var)

    def _pose_var(self, label, pos, rpy, ref=None, scope="shared", joints=None):
        joints = joints if joints is not None else [0.0] * self.ROBOT_AXES
        content = {"type_id": 3006, "permissions": 3, "position": _xyz(*pos), "orientation": _rpy(*rpy),
                   "configuration": {"type_id": 3003, "permissions": 3, **{"joint_%d" % (i + 1): _num(v) for i, v in enumerate(joints)}}}
        if ref is not None:
            content["ref_poseRef"] = ref
        return {"type_id": 2000, "reference_id": label, "n_copy": 0, "shortcut": True, "label": label, "content": content, "scope": scope}

    @staticmethod
    def _pose_values(pose):
        if pose is None:
            return ZERO3, ZERO3
        rz, ry, rx = euler_zyx(pose)
        return (pose[0][3] / 1000, pose[1][3] / 1000, pose[2][3] / 1000), (math.radians(rx), math.radians(ry), math.radians(rz))

    def _target(self, name, pose, joints):
        if name is None:
            name = "target_%d" % self.N_TARGET
            self.N_TARGET += 1
        pos, rpy = self._pose_values(pose)
        q = [math.radians(v) for v in joints] if joints is not None else None
        self.add_var(self._pose_var(name, pos, rpy, None if self.FRAME is None else self.FRAME + "_", joints=q))
        return name

    
    def add(self, node):
        self.STRUCT.append(node)

    def ProgStart(self, progname):
        self.STRUCT = []
        if not self.TREES:
            self.PROG_NAME = progname
            tree = _node(1001, ["SEQUENCE_PLACEHOLDER", "PROGRAM", "STRUCTURAL"], {"label": progname, "include": "", "realtime": True, "event": "kr2_signal::Alarm", "execType": 0})
            self.STRUCT += [_set("TCP", "tcp_init"), _set("LOAD2", "load_init")]
        else:
            tree = _node(1014, ["SUBPROGRAM"], {"label": _item_name(progname), "shortcut": False})
        tree["structure"] = self.STRUCT
        self.TREES.append(tree)

    def ProgFinish(self, progname):
        pass

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        filename = "%s.%s" % (progname, self.PROG_EXT)
        doc = {"version": self.VERSION, "stackLabel": filename, "creationTimeStamp": int(time.time() * 1000), "stackTrees": self.TREES, "stackVariables": self.VARS}
        self.save_file(folder, filename, json.dumps(doc, indent=4) + "\n")

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    
    def _move(self, kind, target, through=""):
        self.add(_node(1005, ["INSTRUCTION", "MOVE", "PROGRAM"], {
            "argThroughExpression": through, "argTargetExpression": target,
            "segmentType": 1 if self.ZONE > 0 else 2, "syncTimeValue": 0.0, "trajectoryType": kind, "chainingType": 2,
            "paceTypeMap": {"trajectoryType_2": 3, "trajectoryType_4": 4, "trajectoryType_1": 1, "trajectoryType_5": 5, "trajectoryType_3": 4},
            "paceValueMap": {"paceType_3": self.SPEED_JOINTS, "paceType_2": 5.0, "paceType_5": 1.0, "paceType_1": self.SPEED, "paceType_4": self.SPEED},
            "blendTypeMap": {"trajectoryType_2": 4, "trajectoryType_4": 5, "trajectoryType_1": 3, "trajectoryType_5": 0, "trajectoryType_3": 5},
            "blendValueMap": {"blendType_3": self.ACCEL, "blendType_0": 0.0, "blendType_1": self.ACCEL, "blendType_2": 5.0, "blendType_5": 1.0, "blendType_4": self.ACCEL_JOINTS},
            "splineOrientation": 0, "splineHorizon": 4, "geomBlendValueMap": {"blendType_1": 0.25},
            "shapeApproachType": 1, "shapeApproachSpeed": 0.5, "shapeApproachAcceleration": 0.25,
        }))

    def _named(self):
        return None if self._TargetName is None else _name(self._TargetName)

    def MoveJ(self, pose, joints, conf_RLF=None):
        self._move(2, self._target(self._named(), pose, joints))

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.add(_comment(LINEAR_ON_JOINTS))
            return
        self._move(1, self._target(self._named(), pose, joints))

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.add(_comment(CIRCULAR_ON_JOINTS))
            return
        names = (None, None) if self._TargetName is None else (_name(self._TargetName[0]), _name(self._TargetName[1]))
        first = self._target(names[0], pose1, joints1)
        second = self._target(names[1], pose2, joints2)
        self._move(4, first, second)

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.FRAME = _item_name(frame_name)
        pos, rpy = self._pose_values(pose)
        self.add_var(self._pose_var(self.FRAME, pos, rpy))

    def setTool(self, pose, tool_id=None, tool_name=None):
        name = _item_name(tool_name)
        pos, rpy = self._pose_values(pose)
        self.add_var(self._pose_var(name, pos, rpy, "TFC_0"))
        self.add(_set("TCP", name))

    def setSpeed(self, speed_mms):
        self.SPEED = speed_mms * 0.001

    def setAcceleration(self, accel_mmss):
        self.ACCEL = accel_mmss * 0.001

    def setSpeedJoints(self, speed_degs):
        self.SPEED_JOINTS = math.radians(speed_degs)

    def setAccelerationJoints(self, accel_degss):
        self.ACCEL_JOINTS = math.radians(accel_degss)

    def setZoneData(self, zone_mm):
        self.ZONE = zone_mm

    
    def _dialog_var(self):
        self.add_var({"type_id": 2000, "reference_id": "x", "n_copy": 0, "shortcut": True, "label": "x", "content": _num(0.0), "scope": "shared"})

    def Pause(self, time_ms):
        if time_ms < 0:
            self._dialog_var()
            self.add(_dialog("Pause"))
        else:
            self.add(_wait(interval=_str(time_ms / 1000)))

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.add(_comment(message))
        else:
            self._dialog_var()
            self.add(_dialog(message))

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            code = _item_name(code)
        self.add(_node(1012, ["INSTRUCTION", "CALL"], {"block": "", "isBlock": False, "flatMode": False, "subprogramName": code}))

    def _output(self, io_var, io_value):
        if isinstance(io_var, (int, float)) and not isinstance(io_var, bool):
            name = "DO%s" % io_var
            content = _num(0.0)
            self.add_var(_system(2002, name, "/sys/ioboard/ports/output/digital/DO%02d" % io_var, "Digital Output %s" % io_var, content))
            io_var = name
        self.add(_set(io_var, _str(io_value)))

    def setDO(self, io_var, io_value):
        self._output(io_var, io_value)

    def setAO(self, io_var, io_value):
        self._output(io_var, io_value)

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        timeout = _str(timeout_ms / 1000) if timeout_ms > 0 else ""
        self.add(_wait(conditional="%s=%s" % (io_var, io_value), timeout=timeout))
