# Builds Hans robot scripts and controller JSON projects from motion instructions.












































import re

from ..base import RobotPost, register
from ..robomath import xyzwpr

TCP = "TCP_Enginuity"
NOT_LINEAR = "## Linear movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."
NOT_CIRCULAR = "## Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."


JSON_HEAD = (
    '{"USER_SCRIPT":{"runForever":false,"DebugModule":false,"threads":[{"threadID":0,"sleepTime":0,"funcName":"Func_main",'
    '"isEnable":true}],"funs":[{"programName":"Func_main","programTree":[{"id":"0896134853BC46C2505011120D116982",'
    '"name":"Script","showName":"Script","icon":"script_script.png","scriptType":"1","isValue":true,"fileId":6,'
    '"view":"RDK_Prog.script","expression":"'
)


def _io_list(prefix, count, enabled, function=0):
    return ",".join(
        '{"Name":"%s%d","Alias":"","Index":%d,"Enabled":%d,"Function":%d,"TriggerType":0}'
        % (prefix, i, i, enabled(i), function)
        for i in range(count)
    )


def _ucs(name, ident, default, index, kind):
    teach = []
    for k in (1, 2, 3):
        teach.append(",".join('"T%d_%s":0' % (k, a) for a in "XYZABC"))
        teach.append(",".join('"M%d_J%d":0' % (k, j) for j in range(1, 7)))
        teach.append('"Teach%d":0' % k)
    return '{"Name":"%s","ID":%d,"Default":%d,"Index":%s,"Type":%d,"X":0,"Y":0,"Z":0,"A":0,"B":0,"C":0,%s}' % (
        name, ident, default, index, kind, ",".join(teach))


JSON_TAIL = (
    '","fileName":"RDK_Prog.script","isBreakPoint":false,"relValueType":0}]}],"pointlist":[],"variableslist":[]},'
    '"HMRC":{"Robot0":{"safetyGuardMonitor":{"isEnableGuardMonitor":0,"holdGuardMonitor":0},'
    '"emergencyForResetIO":{"isEnableEmergencyForResetIO":0,"stageEmergencyForResetIO":0},'
    '"baseMountingAngle":{"mountingRotation":0,"mountingTilt":0},"payload":{"mass":0,"CenterX":0,"CenterY":0,"CenterZ":0},'
    '"safeLevel":{"stopThresholds_gear":3},"simulationMode":"1",'
    '"BoxDI":[' + _io_list("DI", 8, lambda i: 1) + '],'
    '"BoxCI":[' + _io_list("CI", 8, lambda i: 0, -1) + '],'
    '"BoxAI":[' + _io_list("AI", 2, lambda i: 0) + '],'
    '"EndDI":[' + _io_list("EndDI", 3, lambda i: 0) + '],'
    '"EndAI":[' + _io_list("EndAI", 2, lambda i: 0) + '],'
    '"BoxDO":[' + _io_list("DO", 8, lambda i: 1 if i else 0) + '],'
    '"BoxCO":[' + _io_list("CO", 8, lambda i: 0, -1) + '],'
    '"BoxAO":[' + _io_list("AO", 2, lambda i: 0) + '],'
    '"EndDO":[' + _io_list("EndDO", 3, lambda i: 0) + '],'
    '"tcp":[{"Name":"TCP","Default":0,"Index":1,"X":0,"Y":0,"Z":0,"A":0,"B":0,"C":0},'
    '{"Name":"TCP_ToolRDK","Default":1,"Index":2,"X":161.739,"Y":0,"Z":185.219,"A":0,"B":70,"C":0},'
    '{"Name":"' + TCP + '","Default":0,"Index":null,"X":161.739,"Y":0,"Z":185.219,"A":0,"B":70,"C":0}],'
    '"ucs":[' + _ucs("Base", 1, 1, "0", 100) + "," + _ucs("Tool", 2, 0, "1", 101) + "," + _ucs("Point_1", 3, 0, "null", 102) + "]},"
    '"modbusClient":{"modbus":[]}},"UPDATE_TIME":"2023-10-13T16:22:41.997Z"}'
)


def _pose(pose):
    return str(xyzwpr(pose)) if pose is not None else "[0, 0, 0, 0.0, 0.0, 0.0]"


def _joints(joints):
    return str([round(j, 4) for j in joints])


def _value(value):
    if isinstance(value, str):
        return value
    return "1" if value > 0 else "0"


@register
class Hans(RobotPost):
    name = "Hans"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.LINES = []
        self.DONE = False
        self.FRAME_SET = False
        self.SPEED = 100
        self.ACCEL = 300
        self.SPEED_J = 10
        self.ACCEL_J = 30
        self.ZONE = 0

    def addline(self, line):
        if not self.DONE:
            self.LINES.append(line)

    def ProgStart(self, progname):
        pass

    def ProgFinish(self, progname):
        self.DONE = True

    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        script = "".join(line + "\n" for line in self.LINES)
        self.files.append(("%s.script" % progname, script))
        expression = script[:-1].replace('"', '\\"').replace("\n", "\\n")
        self.save_file(folder, "%s.json" % progname, JSON_HEAD + expression + JSON_TAIL)

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    def _waypoint(self, linear, pose, joints):
        if linear:
            speed, accel, kind = self.SPEED, self.ACCEL, "0"
        else:
            speed, accel, kind = self.SPEED_J, self.ACCEL_J, "1"
        self.addline('cc_client.WayPoint(%d,%s,%s,"%s","Point_1",%s,%s,%s,%s,0,0,0," ")'
                     % (1 if linear else 0, _pose(pose), _joints(joints), TCP, speed, accel, self.ZONE, kind))
        self.addline("control.waitBlendingDone(cc_client)")

    def MoveJ(self, pose, joints, conf_RLF=None):
        self._waypoint(False, pose, joints)

    def MoveL(self, pose, joints, conf_RLF=None):
        if pose is None:
            self.addline(NOT_LINEAR)
            return
        self._waypoint(True, pose, joints)

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None or pose2 is None:
            self.addline(NOT_CIRCULAR)
            return
        self.addline('cc_client.MoveC(cc_client.ReadActPos()[6:12],%s,%s,0,1,0.0,%s,%s,%s,"%s","Point_1"," ")'
                     % (_pose(pose1), _pose(pose2), self.SPEED, self.ACCEL, self.ZONE, TCP))
        self.addline("control.waitMoveDone(cc_client)")

    def setFrame(self, pose, frame_id=None, frame_name=None):
        if not self.FRAME_SET:
            self.FRAME_SET = True
            self.addline("")
        self.addline('cc_client.ConfigUCS("Point_1",%s)' % _pose(pose))

    def setTool(self, pose, tool_id=None, tool_name=None):
        self.addline('cc_client.ConfigTCP("%s",%s)' % (TCP, _pose(pose)))

    def Pause(self, time_ms):
        self.addline("## Pause is not supported")

    def setSpeed(self, speed_mms):
        self.SPEED = round(speed_mms, 3)

    def setAcceleration(self, accel_mmss):
        self.ACCEL = round(accel_mmss, 3)

    def setSpeedJoints(self, speed_degs):
        self.SPEED_J = round(speed_degs, 3)

    def setAccelerationJoints(self, accel_degss):
        self.ACCEL_J = round(accel_degss, 3)

    def setZoneData(self, zone_mm):
        self.ZONE = round(zone_mm, 3)

    def setDO(self, io_var, io_value):
        self.addline("cc_client.setDO(%s,%s)" % (io_var, _value(io_value)))

    def setAO(self, io_var, io_value):
        mode = "8.0" if isinstance(io_value, str) or io_value > 0 else "4.0"
        self.addline("cc_client.SetBoxAO(%s, %s,%s)" % (io_var, mode, _value(io_value)))

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        self.addline("## Wait DI is not implemented")

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            if "(" not in code:
                code += "()"
            self.addline("## %s" % re.sub(r"[^A-Za-z0-9_()]", "", code))
        else:
            self.addline(code)

    def RunMessage(self, message, iscomment=False):
        if iscomment:
            self.addline("## %s" % message)
