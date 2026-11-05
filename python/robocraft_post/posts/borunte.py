# Packages Borunte numeric motion and I/O actions into controller ZIP projects.





























import io
import json
import zipfile

from ..base import PostError, RobotPost, on_off, register
from ..robomath import xyzwpr


def _fnc_numbers():
    nums = list(range(214, 220)) + list(range(357, 394)) + [429, 427, 443, 444]
    for c in range(445, 449):
        for b in range(5):
            nums += [c + 4 * b, c + 4 * b + 20, c + 4 * b + 40]
    return nums


FNC = "".join("%d, %d\n" % (n, 511 if n == 357 else 0) for n in _fnc_numbers())
END = '[{"action":60000,"insertedIndex":0}]'
ACT_TAIL = "\n".join([END] * 8 + ["{}", '""'] + [END] * 8)
JOINT_TARGET_L = "Linear moves to joint targets are not supported by this post processor: use a Cartesian target"


def _pos(values):
    values = list(values)[:8] + [0.0] * max(0, 8 - len(values))
    return {"pointName": "", "pos": {"m%d" % i: "%.3f" % v for i, v in enumerate(values)}}


def _state(value):
    return on_off(value, True, False)


@register
class Borunte(RobotPost):
    name = "Borunte"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.ACTIONS = []
        self.INDEX = 0
        self.PROG = None
        self.SMOOTH = 0
        self.SPEED = "80"
        self.TOOLCOORD = 1

    def _add(self, action):
        self.INDEX += 1
        action["insertedIndex"] = self.INDEX
        self.ACTIONS.append(action)

    def ProgStart(self, progname):
        self.PROG = progname
        self.INDEX = 0

    def ProgFinish(self, progname):
        self.ACTIONS.append({"action": 60000, "insertedIndex": 0})

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        name = self.PROG or progname
        act = json.dumps(self.ACTIONS, separators=(",", ":")) + "\n" + ACT_TAIL
        members = [("act", act), ("counters", ""), ("fnc", FNC), ("palletStyle", ""), ("timers", ""), ("variables", "")]
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as z:
            for ext, text in members:
                info = zipfile.ZipInfo("%s.%s" % (name, ext), date_time=(2026, 1, 1, 0, 0, 0))
                info.external_attr = 0o100644 << 16
                z.writestr(info, text)
        self.save_file(folder, "%s.zip" % name, buf.getvalue())

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    def _move(self, action, points):
        self._add(
            {
                "action": action,
                "ckStatus": "63",
                "delay": "0.00",
                "points": points,
                "smooth": self.SMOOTH,
                "speed": self.SPEED,
                "toolCoord": self.TOOLCOORD,
            }
        )

    def MoveJ(self, pose, joints, conf_RLF=None):
        self._move(4, [_pos(joints)])

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            raise PostError(JOINT_TARGET_L)
        self._move(10, [_pos(xyzwpr(pose))])

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            raise PostError(JOINT_TARGET_L)
        self._move(17, [_pos(xyzwpr(pose1)), _pos(xyzwpr(pose2))])

    def setFrame(self, pose, frame_id=None, frame_name=None):
        self._add({"action": 800, "coordID": 1, "coordName": frame_name})
        self.ACTIONS[-1]["customName"] = frame_name

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.TOOLCOORD = 65537
        self._add({"action": 801, "toolID": 1, "toolName": tool_name})
        self.ACTIONS[-1]["customName"] = tool_name

    def Pause(self, time_ms):
        self._add({"action": 100, "type": 100, "point": 8, "pointStatus": 1, "limit": "%.2f" % (time_ms / 1000), "isUnlimit": True})

    def setSpeed(self, speed_mms):
        self.SPEED = "%.1f" % min(100.0, speed_mms / 10)

    def setSpeedJoints(self, speed_degs):
        self.SPEED = "%.1f" % min(100.0, speed_degs / 2)

    def setAcceleration(self, accel_mmss):
        pass

    def setAccelerationJoints(self, accel_degss):
        pass

    def setZoneData(self, zone_mm):
        self.SMOOTH = int(min(9, zone_mm))

    def setDO(self, io_var, io_value):
        self._add({"action": 200, "type": 0, "point": io_var, "pointStatus": _state(io_value), "valveID": 0, "delay": "0.000", "isWaitInput": False})
        self.ACTIONS[-1]["customName"] = ""

    def setAO(self, io_var, io_value):
        pass

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        if timeout_ms < 0:
            limit, unlimited = "0.000", True
        else:
            limit, unlimited = "%.1f" % (timeout_ms / 1000), False
        self._add({"action": 100, "type": 0, "point": io_var, "pointStatus": _state(io_value), "limit": limit, "isUnlimit": unlimited})

    def RunCode(self, code, is_function_call=False):
        pass

    def RunMessage(self, message, iscomment=False):
        pass
