# Generates Neura Python robot scripts with joint and Cartesian motion calls.






























import math

from ..base import RobotPost, is_number, register
from ..robomath import euler_zyx, eye, mul

_MOVEL_JOINTS = "# Linear movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."


def _rad(values):
    return [v * math.pi / 180 for v in values]


def _rxyz(h):
    pass
    rz, ry, rx = euler_zyx(h)
    return [rx * math.pi / 180, ry * math.pi / 180, rz * math.pi / 180]


def _num(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


@register
class Neura(RobotPost):
    name = "Neura"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.PROGS = []
        self.LINES = None
        self.FRAME = eye()
        self.BLENDING = False

    def addline(self, line):
        self.LINES.append("    " + line)

    def ProgStart(self, progname):
        self.LINES = []
        self.PROGS.append((progname, self.LINES))

    def ProgFinish(self, progname):
        pass

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        out = "from neurapy.robot import Robot\nimport time\n\nr = Robot()\n"
        for name, lines in self.PROGS:
            out += "\n\ndef %s():\n" % name
            out += "".join(l + "\n" for l in lines)
        first = self.PROGS[0][0] if self.PROGS else progname
        out += '\n\nif __name__ == "__main__":\n    %s()\n    r.stop()\n' % first
        self.save_file(folder, "%s.py" % progname, out)

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    def _joint_move(self, joints):
        self.addline('joint_property = {"target_joint": [%r], "current_joint_angles": r.get_current_joint_angles(), "enable_blending": %s}' % (_rad(joints), self.BLENDING))
        self.addline("r.move_joint(**joint_property)")

    def MoveJ(self, pose, joints, conf_RLF=None):
        self._joint_move(joints)

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.addline(_MOVEL_JOINTS)
            return
        target = self._target(pose)
        self.addline(
            'linear_property = {"target_pose": [%r], target_joint": [%r], "current_joint_angles": r.get_current_joint_angles(), "enable_blending": %s}'
            % (target, _rad(joints), self.BLENDING)
        )
        self.addline("r.move_linear_from_current_position(**linear_property)")

    def _target(self, pose):
        h = mul(self.FRAME, pose)
        return [h[0][3] / 1000, h[1][3] / 1000, h[2][3] / 1000] + _rxyz(h)

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            return
        self.addline("r.move_circular([r.get_tcp_pose(), %r, %r])" % (self._target(pose1), self._target(pose2)))

    def setFrame(self, pose, frame_id=None, frame_name=None):
        self.FRAME = pose
        self.addline("# Changed reference frame to %s" % frame_name)

    def setTool(self, pose, tool_id=None, tool_name=None):
        rx, ry, _rz = _rxyz(pose)
        x, y, z = pose[0][3] / 1000, pose[1][3] / 1000, pose[2][3] / 1000
        self.addline(
            "r.update_current_tool_parameters(autoM=0.0, offsetA=%f, offsetB=%f, offsetC=%f, offsetX=%f, offsetY=%f, offsetZ=%f)" % (rx, ry, y, x, y, z)
        )

    def Pause(self, time_ms):
        if time_ms >= 0:
            self.addline("time.sleep(%f)" % (time_ms / 1000))

    def setSpeed(self, speed_mms):
        self.addline("r.set_linear_speed(%f)" % max(min(speed_mms / 1000, 1.0), 0.0))

    def setAcceleration(self, accel_mmss):
        self.addline("r.set_linear_acceleration(%f)" % min(accel_mmss / 1000, 1.0))

    def setSpeedJoints(self, speed_degs):
        self.addline("r.set_joint_speed(%f)" % min(speed_degs, 100.0))

    def setAccelerationJoints(self, accel_degss):
        self.addline("r.set_joint_acceleration(%f)" % min(accel_degss, 100.0))

    def setZoneData(self, zone_mm):
        self.BLENDING = zone_mm >= 0

    def setDO(self, io_var, io_value):
        if is_number(io_var):
            v = _num(io_value)
            self.addline("r.set_digital_output(%s, %s)" % (io_var, io_value if v is None else v > 0))

    def setAO(self, io_var, io_value):
        if is_number(io_var):
            self.addline("r.set_analog_output(%s, %f)" % (io_var, float(io_value)))

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        port = "DI_%s" % io_var if is_number(io_var) else io_var
        v = _num(io_value)
        wait = "%f" % timeout_ms if timeout_ms >= 0 else "0.0"
        self.addline('r.wait(port_name="%s", expected_value=%s, wait_for_signal=True, wait_time=%s)' % (port, io_value if v is None else float(v > 0), wait))

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            code = "".join(c for c in code if c.isalnum() or c in "_()")
            if code[:1].isdigit():
                code = "P" + code  
            if "(" not in code:
                code += "()"
        self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.addline("# %s" % message)
        else:
            self.addline('r.notify_info("%s")' % message)
