


























import math
import random
import uuid

from ..base import PostError, RobotPost, register
from ..robomath import mul, xyzwpr
from . import _aubo_arcs_data as D

TCP_ID = "a48e0481-cefe-4164-9e11-0a46859f89a2"
BASE_ID = "c7e1c5a3-33be-4be1-958e-32b149c14855"
TOOL_ID = "ea072f72-dfc0-49b3-ad34-eb8121ac9592"
SCRIPT_ID = "bc8a3b76-d231-4536-b144-2c91074bfc45"

CIRCLE_JOINTS = "Circular movement using joint targets is not supported. Change the target type to cartesian or use a joint movement."

KINEMATICS = """            <Kinematics status="NOT_INITIALIZED" validChecksum="false">
                <theta value="0,0,0,0,0,0"/>
                <a value="0,0,0,0,0,0"/>
                <d value="0,0,0,0,0,0"/>
                <alpha value="0,0,0,0,0,0"/>
                <beta value="0,0,0,0,0,0"/>
                <jointChecksum value="beta_value"/>
            </Kinematics>"""


def _x(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _pose6(pose):
    v = xyzwpr(pose)
    return [v[0] / 1000.0, v[1] / 1000.0, v[2] / 1000.0] + [a * math.pi / 180.0 + 0.0 for a in v[3:]]


def _f6(values, sep=", "):
    return sep.join("%f" % v for v in values)


def _bool_text(value):
    pass
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return "true" if value > 0 else "false"
    return str(value)


def _title_value(text):
    return {"true": "High", "false": "Low"}.get(text, text)


class _Prog:
    def __init__(self, name, is_main, uid=None):
        self.name = name
        self.is_main = is_main
        self.uid = uid
        self.items = []  
        self.flat = []  


@register
class AUBO_ARCS(RobotPost):
    name = "AUBO_ARCS"
    
    

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._rand = random.Random(0)
        self.PROGS = []
        self.PROG = None
        self.FRAME = None
        self.TOOL = None  
        self.TOOLS = []  
        self.SPEED_L = 0.25
        self.ACCEL_L = 1.2
        self.SPEED_J = 0.75
        self.ACCEL_J = 1.2
        self.ZONE = 1.0
        self.WAYPOINTS = []  
        self.LAST = None  
        self.LAST_KIND = None  
        self.NMOVES = 0
        self.FIRST_TOOL = None
        self.ANCHOR = False  
        self.BREAK = True  

    def _draw(self):
        return str(uuid.UUID(int=self._rand.getrandbits(128), version=4))

    
    def ProgStart(self, progname):
        uid = self._draw()
        prog = _Prog(progname, not self.PROGS, uid)
        self.PROGS.append(prog)
        self.PROG = prog
        self.BREAK = True

    def ProgFinish(self, progname):
        self.BREAK = True

    def _item(self, kind, **kw):
        kw["kind"] = kind
        self.PROG.items.append(kw)
        if kind != "move":
            self.PROG.flat.append(kw)
        if kind not in ("comment", "set"):
            self.BREAK = True
        return kw

    
    def _target(self, pose):
        if self.FRAME is not None:
            pose = mul(self.FRAME, pose)
        return _pose6(pose)

    def _blend(self, linear_joints=False):
        if not self.ANCHOR or linear_joints:
            return "0"
        return repr(self.ZONE / 1000.0)

    def _waypoint(self, ptext, joints):
        n = len(self.WAYPOINTS)
        tcp = _f6(self.TOOL[1]) if self.TOOL else _f6([0.0] * 6)
        self.WAYPOINTS.append((self.PROG, ptext, _f6(math.radians(j) for j in joints), tcp))
        return n

    def _group(self, mtype, use_joints, wp, blend):
        pass
        items = [i for i in self.PROG.items if i["kind"] not in ("comment", "set")]
        last = items[-1] if items else None
        if not self.BREAK and last is not None and last["kind"] == "move" and last["mtype"] == mtype and last["use_joints"] == use_joints:
            node = last
        else:
            node = self._item("move", mtype=mtype, use_joints=use_joints, uid=None, fid=None, wps=[], blend=blend,
                              speed=(self.ACCEL_L, self.SPEED_L, self.ACCEL_J, self.SPEED_J))
            node["new"] = True
        return node

    def _move(self, mtype, pose, joints, blend_text=None):
        lj = mtype == "L" and pose is None
        if mtype == "J":
            ptext = "0, 0, 0, 0, 0, 0" if pose is None else _f6(self._target(pose))
        else:
            ptext = _f6(math.radians(j) for j in joints) if pose is None else _f6(self._target(pose))
        blend = blend_text if blend_text is not None else self._blend(lj)
        if mtype == "L":
            self._draw()
        wp_uid = self._draw()
        node = self._group(mtype, pose is None if mtype == "J" else False, None, blend)
        if node.pop("new", False):
            node["uid"] = self._draw()
            node["fid"] = self._draw()
        wp = self._waypoint(ptext, joints)
        entry = dict(n=wp, uid=wp_uid, blend=blend, pose=pose, zone=self.ZONE,
                     speed=(self.ACCEL_L, self.SPEED_L, self.ACCEL_J, self.SPEED_J))
        node["wps"].append(entry)
        self.PROG.flat.append(dict(kind="wp", node=node, wp=entry))
        self.BREAK = False
        self.NMOVES += 1
        if self.NMOVES == 1:
            self.FIRST_TOOL = self.TOOL
        if not lj:
            self.ANCHOR = True
        self.LAST = (pose, joints)
        self.LAST_KIND = "LJ" if lj else mtype
        return node

    def MoveJ(self, pose, joints, conf_RLF=None):
        self._move("J", pose, joints)

    def MoveL(self, pose, joints, conf_RLF=None):
        self._move("L", pose, joints)

    def MoveC(self, pose1, joints1, pose2, joints2, conf_RLF_1=None, conf_RLF_2=None):
        if pose1 is None:
            self.RunMessage(CIRCLE_JOINTS, True)
            return
        if self.LAST is None or self.LAST[0] is None:
            self._move("L", pose2, joints2)  
            return
        node = self._move("L", self.LAST[0], self.LAST[1], "0.0")
        a_uid = self._draw()
        c_uid = self._draw()
        self._draw()
        b_uid = self._draw()
        a = self._waypoint(_f6(self._target(pose1)), joints1)
        b = self._waypoint(_f6(self._target(pose2)), joints2)
        blend = repr(self.ZONE / 1000.0)
        entry = dict(circle=True, uid=c_uid, a=a, a_uid=a_uid, b=b, b_uid=b_uid, blend=blend, zone=self.ZONE,
                     speed=(self.ACCEL_L, self.SPEED_L, self.ACCEL_J, self.SPEED_J))
        node["wps"].append(entry)
        self.PROG.flat.append(dict(kind="wp", node=node, wp=entry))
        self.LAST = (pose2, joints2)
        self.LAST_KIND = "L"

    
    def setFrame(self, pose, frame_id=None, frame_name=None):
        self._draw()
        self.FRAME = pose
        self._item("comment", text="-- Using Ref. %s: {%s}" % (frame_name, _f6(_pose6(pose))))
        self._item("comment", text="-- set_reference({%s})" % _f6(_pose6(pose)))
        self.BREAK = True

    def setTool(self, pose, tool_id=None, tool_name=None):
        set_uid = self._draw()
        tcp_uid = self._draw()
        ins_uid = self._draw()
        self._draw()
        values = _pose6(pose)
        self.TOOL = (tool_name, values)
        self.TOOLS.append((tool_name, values, ins_uid))
        self._item("comment", text="-- Using TCP %s: {%s}" % (tool_name, _f6(values)))
        self._item("tool", uid=set_uid, tcp_uid=tcp_uid, name=tool_name, values=values)

    def _set(self, text):
        self._item("set", text=text)

    def setSpeed(self, speed_mms):
        self.SPEED_L = speed_mms / 1000.0
        self._set("speed_ms    = %.3f" % self.SPEED_L)
        self.BREAK = True

    def setAcceleration(self, accel_mmss):
        self.ACCEL_L = accel_mmss / 1000.0
        self._set("accel_mss   = %.3f" % self.ACCEL_L)

    def setSpeedJoints(self, speed_degs):
        self.SPEED_J = math.radians(speed_degs)
        self._set("speed_rads  = %.3f" % self.SPEED_J)

    def setAccelerationJoints(self, accel_degss):
        self.ACCEL_J = math.radians(accel_degss)
        self._set("accel_radss = %.3f" % self.ACCEL_J)

    def setZoneData(self, zone_mm):
        self.ZONE = max(zone_mm, 0.0)
        self._set("blend_radius_m = %f" % (self.ZONE / 1000.0))

    
    def Pause(self, time_ms):
        if time_ms is None or time_ms <= 0:
            self._draw()
            self._draw()
            self._item("halt")
            return
        uid = self._draw()
        self._draw()
        self._item("wait", uid=uid, seconds=time_ms / 1000.0)

    def RunMessage(self, message, iscomment=False):
        uid = self._draw()
        if iscomment:
            self._item("comment", text="-- %s" % message)
        else:
            self._item("popup", uid=uid, text=message)

    def RunCode(self, code, is_function_call=False):
        if is_function_call:
            self._draw()
            uid = self._draw()
            self._draw()
            self._item("call", uid=uid, name=code)
        else:
            self._item("code", uid=self._draw(), code=code)

    def setDO(self, io_var, io_value):
        value = _bool_text(io_value)
        self._item("do", uid=self._draw(), var=io_var, value=value)

    def setAO(self, io_var, io_value):
        if not (isinstance(io_var, int) and not isinstance(io_var, bool)):
            raise UnboundLocalError("local variable 'ao_type' referenced before assignment")
        try:
            v = float(io_value)
        except (TypeError, ValueError):
            return
        self._item("ao", uid=self._draw(), var=io_var, value=io_value, number=v)

    def waitDI(self, io_var, io_value, timeout_ms=-1):
        value = _bool_text(io_value)
        self._item("di", uid=self._draw(), var=io_var, value=value, timeout=timeout_ms)

    
    def ProgSave(self, folder, progname, ask_user=False, show_result=False):
        init_uid = self._draw()
        main_uid = self._draw()
        self.CTX = 4
        main = self.PROGS[0]
        main_lines = self._lua_items(main, "      ")
        subs = []
        for prog in self.PROGS[1:]:
            ctx = self.CTX
            self.CTX += 1
            subs.append((prog, ctx, self._lua_items(prog, "    ")))
        lua = [D.LUA_HEAD % {"name": progname}]
        lua.append("  speed_ms    = 0.250")
        lua.append("  speed_rads  = 0.750")
        lua.append("  accel_mss   = 1.200")
        lua.append("  accel_radss = 1.200")
        lua.append("  blend_radius_m = 0.001000")
        for prog in self.PROGS:
            ind = "  " if prog.is_main else "    "
            for n, (p, ptext, jtext, _tcp) in enumerate(self.WAYPOINTS):
                if p is prog:
                    lua.append("%sWaypoint_%d_p = {%s}" % (ind, n, ptext))
                    lua.append("%sWaypoint_%d_q = {%s}" % (ind, n, jtext))
        for prog, ctx, lines in subs:
            lua.append("    -- Subprogram %s" % prog.name)
            lua.append('    setPlanContext(sched.current_thread_id(), %d, "%s")' % (ctx, prog.name))
            lua.append("    function p_%s()" % prog.name)
            lua.extend(lines)
            lua.append("    end")
            lua.append("  ")
        lua.append("  " if subs else "    ")
        lua.append('  setPlanContext(sched.current_thread_id(), 2, "Robot Programming")')
        lua.append("  -- Main program:")
        lua.append("  while true do")
        lua.append('      setPlanContext(sched.current_thread_id(), 3, "Func_lib.lua")')
        lua.extend("      " + ln for ln in D.FUNC_LIB.split("\n")[:-1])
        lua.extend(main_lines)
        lua.append("      -- End of main program")
        lua.append("    end")
        lua.append("end")
        lua.append("")
        lua.append("function app:start(api)")
        lua.append("  --")
        lua.append("  self.api = api")
        lua.append('  print("start---")')
        lua.append("  p_%s()" % progname)
        lua.append("end")
        lua.append("")
        lua.append("function app:robot_error_handler(name, err)")
        lua.append("  --")
        lua.append('  print("An error hanppen to robot "..name)')
        lua.append("end")
        lua.append("")
        lua.append("-- return our app object")
        lua.append("return app")
        lua_text = "\n".join(lua) + "\n"

        pro = [D.PRO_HEAD % {"name": progname} + "    <WaypointModel>"]
        for n, (_p, ptext, jtext, tcp) in enumerate(self.WAYPOINTS):
            pro.append('        <Waypoint name="Waypoint_%d">' % n)
            pro.append('            <RobotPose pose="%s"/>' % ptext)
            pro.append('            <JointPositions angles="%s"/>' % jtext)
            pro.append('            <TcpOffset pose="%s"/>' % tcp)
            pro.append(KINEMATICS)
            pro.append("        </Waypoint>")
        pro.append("    </WaypointModel>")
        pro.append("    <TimerModel/>")
        pro.append("    <VariableModel>")
        pro.append("    </VariableModel>")
        pro.append("    <SubProgModel/>")
        pro.append('    <InitVariablesNode title="初始变量" id="%s">' % init_uid)
        pro.append("        <datamodel/>")
        pro.append("    </InitVariablesNode>")
        pro.append('    <MainProgramNode title="机器人编程" id="%s">' % main_uid)
        pro.append("        <datamodel>")
        pro.append('            <Bool key="addBeforeStartSequence" value="false"/>')
        pro.append('            <Bool key="loopForever" value="true"/>')
        pro.append("        </datamodel>")
        pro.append("        <children>")
        pro.append('            <ScriptNode title="Func_lib.lua" id="%s">' % SCRIPT_ID)
        pro.append("                <datamodel>")
        pro.append('                    <Expression key="expression"/>')
        pro.append('                    <String key="file_path" value="Func_lib.lua"/>')
        pro.append('                    <Bool key="use_file" value="true"/>')
        pro.append("                </datamodel>")
        pro.append("            </ScriptNode>")
        self._pro_items(main, pro)
        pro.append("        </children>")
        pro.append("    </MainProgramNode>")
        for prog in self.PROGS[1:]:
            pro.append('            <SubProgNode title="%s" id="%s">' % (_x(prog.name), prog.uid))
            pro.append("                <datamodel>")
            pro.append('                    <String key="filePath" value="%s.pro"/>' % _x(prog.name))
            pro.append('                    <Bool key="hasload" value="true"/>')
            pro.append('                    <Bool key="keepUpdate" value="true"/>')
            pro.append('                    <SubProgram key="subProg" name="%s"/>' % _x(prog.name))
            pro.append("                </datamodel>")
            pro.append("                <children>")
            self._pro_items(prog, pro)
            pro.append("            </children>")
            pro.append("        </SubProgNode>")
        pro.append("")
        pro_text = "\n".join(pro) + "\n</AuboProgram>"

        default = self.FIRST_TOOL if self.NMOVES else self.TOOL
        tcps = ['    <tcpmodel defaultTcp="%s">' % _x(default[0] if default else "TCP")]
        tcps.append('        <tcp name="TCP" offset="0,0,0,0,0,0" id="%s"/>' % TCP_ID)
        for name, values, uid in self.TOOLS:
            tcps.append('        <tcp name="%s" offset="%s" id="%s"/>' % (_x(name), _f6(values), uid))
        tcps.append("")
        tcps.append("    </tcpmodel>")
        ins_text = D.INS_HEAD + "\n".join(tcps) + "\n" + D.INS_TAIL

        self.save_file(folder, "%s.lua" % progname, lua_text)
        self.files.append(("%s.pro" % progname, pro_text))
        self.files.append(("%s_ins.ins" % progname, ins_text))
        self.files.append(("Func_lib.lua", D.FUNC_LIB))

    def ProgSendRobot(self, robot_ip, remote_path, ftp_user, ftp_pass):
        self.popup("Sending programs to the robot is not available in Enginuity")

    def _ctx(self, ind, title):
        n = self.CTX
        self.CTX += 1
        return '%ssetPlanContext(sched.current_thread_id(), %d, "%s")' % (ind, n, title)

    def _lua_items(self, prog, B):
        out = []
        for it in prog.flat:
            k = it["kind"]
            if k in ("comment", "set"):
                out.append(B + it["text"])
            elif k == "tool":
                out.append(self._ctx(B, "Set No action"))
                out.append(B + "setTcpOffset({%s})" % _f6(it["values"]))
                out.append(B + "sleep(0)")
                out.append("")
            elif k == "wp":
                for wp in [it["wp"]]:
                    it = it["node"]
                    al, sl, aj, sj = wp["speed"]
                    if wp.get("circle"):
                        out.append(self._ctx(B, "Circle"))
                        out.append(B + "setCirclePathMode(0)")
                        out.append(self._ctx(B, "Waypoint_%d" % wp["a"]))
                        out.append("")
                        out.append(self._ctx(B, "Waypoint_%d" % wp["b"]))
                        out.append(B + "moveCircle(Waypoint_%d_p,Waypoint_%d_p,%r,%r,%s,0)" % (wp["a"], wp["b"], al, sl, wp["blend"]))
                        out.append("")
                        continue
                    n = wp["n"]
                    if it["mtype"] == "J":
                        out.append(self._ctx(B, "MoveJ"))
                        out.append(self._ctx(B, "Waypoint_%d" % n))
                        target = "Waypoint_%d_q" % n if it["use_joints"] else "inverseKinematics(Waypoint_%d_q,Waypoint_%d_p)" % (n, n)
                        out.append(B + "moveJoint(%s,%r,%r,%s,0)" % (target, aj, sj, wp["blend"]))
                    else:
                        out.append(self._ctx(B, "MoveL"))
                        out.append(self._ctx(B, "Waypoint_%d" % n))
                        out.append(B + "moveLine(Waypoint_%d_p,%r,%r,%s,0)" % (n, al, sl, wp["blend"]))
                    out.append("")
            elif k == "wait":
                out.append(self._ctx(B, "Wait: %.2fs" % it["seconds"]))
                out.append(B + "sleep(%.2f)" % it["seconds"])
                out.append("")
            elif k == "halt":
                out.append(B + "halt() -- reimplement this function to force stop")
            elif k == "popup":
                out.append(self._ctx(B, "Popup Message:%s" % it["text"]))
                out.append(B + "sched.sync_program_point()")
                out.append(B + 'clearNamedVariable("_popup_continue_or_stop")')
                out.append(B + "do")
                out.append(B + "  local _popup_t = getControlSystemTime()")
                out.append(B + '  popup(TraceLevel.INFO,"Message","%s",1)' % it["text"])
                out.append(B + '  while not variableUpdated("_popup_continue_or_stop", _popup_t) do sync() end')
                out.append(B + '  if not getBool("_popup_continue_or_stop", true) then halt() end')
                out.append(B + "end")
                out.append("")
            elif k == "call":
                out.append(self._ctx(B, "Call %s()" % it["name"]))
                out.append(B + "--subscript context start")
                out.append(B + "p_%s()" % it["name"])
                out.append(B + "--subscript context end")
                out.append("")
            elif k == "code":
                out.append(B + it["code"])
            elif k == "do":
                var, value = it["var"], it["value"]
                if isinstance(var, int) and not isinstance(var, bool):
                    out.append(self._ctx(B, "Set DO%02d=%s" % (var, _title_value(value))))
                    out.append(B + "setStandardDigitalOutput(%d, %s)" % (var, value))
                    out.append("")
                else:
                    out.append(self._ctx(B, "Set DO%s=%s" % (var, _title_value(value))))
                    out.append(B + "%s = %s" % (var, value))
            elif k == "ao":
                var = it["var"]
                name, unit = ("VO%d" % var, "V") if var < 2 else ("CO%d" % (var - 2), "mA")
                out.append(self._ctx(B, "Set %s=%.2f%s" % (name, it["number"], unit)))
                out.append(B + "setStandardAnalogOutput(%d, %s)" % (var, it["value"]))
                out.append("")
            elif k == "di":
                var, value = it["var"], it["value"]
                if isinstance(var, int) and not isinstance(var, bool):
                    title = "DO%02d" % var
                    cond = "getStandardDigitalInput(%d) != %s" % (var, value)
                else:
                    title = "DO%s" % var
                    cond = "%s != %s" % (var, value)
                out.append(self._ctx(B, "Wait: %s=%s" % (title, _title_value(value))))
                out.append(B + "sched.sync_program_point()")
                t = it["timeout"]
                if t is not None and t >= 0:
                    out.append(B + "local time = realtime.time() + %.2f" % (t / 1000.0))
                    out.append(B + "while (%s):" % cond)
                    out.append(B + "    if (realtime.time() >= time) then")
                    out.append(B + "        break")
                    out.append(B + "    end")
                    out.append(B + "    sync()")
                    out.append(B + "end")
                else:
                    out.append(B + "while (%s):" % cond)
                    out.append(B + "    sync()")
                    out.append(B + "end")
                out.append("")
        return out

    def _pro_items(self, prog, pro):
        for it in prog.items:
            k = it["kind"]
            if k == "tool":
                pro.append('        <SetNode title="Set No action" id="%s">' % it["uid"])
                pro.append("            <datamodel>")
                pro.append('                <Float64 key="aoValue" value="4"/>')
                pro.append('                <Bool key="boolValue" value="false"/>')
                pro.append('                <Int32 key="collisionLevel" value="-1"/>')
                pro.append('                <Expression key="expression"/>')
                pro.append('                <Float64 key="pulseTime" value="0.5"/>')
                pro.append('                <Bool key="setTcp" value="true"/>')
                pro.append('                <Bool key="syncProgramPointer" value="false"/>')
                pro.append('                <TCP key="tcp" name="%s" id="%s"/>' % (_x(it["name"]), it["tcp_uid"]))
                pro.append('                <String key="type" value="NO_ACTION"/>')
                pro.append("            </datamodel>")
                pro.append("        </SetNode>")
            elif k == "move":
                self._pro_move(it, pro)
            elif k == "wait":
                pro.append('        <WaitNode title="Wait: %.2fs" id="%s">' % (it["seconds"], it["uid"]))
                pro.append("            <datamodel>")
                pro.append('                <String key="compareOperator" value="LESS_THAN"/>')
                pro.append('                <Bool key="di_value" value="false"/>')
                pro.append('                <Expression key="expression"/>')
                pro.append('                <Float32 key="floatValue" value="4"/>')
                pro.append('                <Float64 key="timeout" value="0"/>')
                pro.append('                <String key="type" value="TIME"/>')
                pro.append('                <Float64 key="waitTime" value="%.2f"/>' % it["seconds"])
                pro.append("            </datamodel>")
                pro.append("        </WaitNode>")
            elif k == "halt":
                pro.append("        <Halt/>")
            elif k == "popup":
                pro.append('        <Popup type="Message" haltProgram="false" message="%s"/>' % _x(it["text"]))
                pro.append('        <PopupNode title="Popup Message:%s" id="%s">' % (_x(it["text"]), it["uid"]))
                pro.append("            <datamodel>")
                pro.append('                <Bool key="haltAtHere" value="false"/>')
                pro.append('                <String key="message" value="%s"/>' % _x(it["text"]))
                pro.append('                <String key="type" value="MESSAGE"/>')
                pro.append('                <Bool key="useVariable" value="false"/>')
                pro.append("            </datamodel>")
                pro.append("        </PopupNode>")
            elif k == "call":
                pro.append('            <CallNode title="Call %s" id="%s">' % (_x(it["name"]), it["uid"]))
                pro.append("                <datamodel>")
                pro.append('                    <SubProgram key="subprog" name="%s"/>' % _x(it["name"]))
                pro.append("                </datamodel>")
                pro.append("            </CallNode>")
            elif k == "code":
                pro.append('        <ScriptNode title="%s" id="%s">' % (_x(it["code"]), it["uid"]))
                pro.append("            <datamodel>")
                pro.append('                <Expression key="expression">')
                for ch in it["code"]:
                    pro.append('                    <String string="%s"/>' % _x(ch))
                pro.append("                </Expression>")
                pro.append('                <Bool key="use_file" value="false"/>')
                pro.append("            </datamodel>")
                pro.append("        </ScriptNode>")
            elif k in ("do", "ao"):
                var = it["var"]
                if k == "do":
                    name = "DO%02d" % var if isinstance(var, int) and not isinstance(var, bool) else "DO%s" % var
                    title = "Set %s=%s" % (name, _title_value(it["value"]))
                    ao, bv, typ = "4", it["value"], "DIGITAL_OUTPUT"
                else:
                    name, unit = ("VO%d" % var, "V") if var < 2 else ("CO%d" % (var - 2), "mA")
                    title = "Set %s=%.2f%s" % (name, it["number"], unit)
                    ao, bv, typ = str(it["value"]), "false", "ANALOG_OUTPUT_CURRENT"
                pro.append('        <SetNode title="%s" id="%s">' % (_x(title), it["uid"]))
                pro.append("            <datamodel>")
                pro.append('                <Float64 key="aoValue" value="%s"/>' % _x(ao))
                pro.append('                <Bool key="boolValue" value="%s"/>' % _x(bv))
                pro.append('                <Int32 key="collisionLevel" value="-1"/>')
                pro.append('                <Expression key="expression"/>')
                pro.append('                <Io key="io" name="%s"/>' % _x(name))
                pro.append('                <Float64 key="pulseTime" value="0.5"/>')
                pro.append('                <Bool key="setTcp" value="false"/>')
                pro.append('                <Bool key="syncProgramPointer" value="false"/>')
                pro.append('                <String key="type" value="%s"/>' % typ)
                pro.append("            </datamodel>")
                pro.append("        </SetNode>")
            elif k == "di":
                var, value = it["var"], it["value"]
                name = "DI%02d" % var if isinstance(var, int) and not isinstance(var, bool) else "DI%s" % var
                t = it["timeout"]
                pro.append('        <WaitNode title="Wait: %s=%s" id="%s">' % (_x(name), _x(_title_value(value)), it["uid"]))
                pro.append("            <datamodel>")
                pro.append('                <String key="compareOperator" value="LESS_THAN"/>')
                pro.append('                <Bool key="di_value" value="%s"/>' % _x(value))
                pro.append('                <Io key="digitalInput" name="%s"/>' % _x(name))
                pro.append('                <Expression key="expression"/>')
                pro.append('                <Float32 key="floatValue" value="4"/>')
                pro.append('                <Float64 key="timeout" value="%s"/>' % ("%.2f" % (t / 1000.0) if t is not None and t >= 0 else "0"))
                pro.append('                <String key="type" value="DIGITAL_INPUT"/>')
                pro.append('                <Float64 key="waitTime" value="0.01"/>')
                pro.append("            </datamodel>")
                pro.append("        </WaitNode>")

    def _pro_waypoint(self, n, uid, wp, pro, ind="                ", group_speed=None):
        al, sl, aj, sj = wp["speed"]
        blended = wp["blend"] not in ("0", "0.0")
        pro.append('%s<WaypointNode title="Waypoint_%d" id="%s">' % (ind, n, uid))
        pro.append(ind + "    <datamodel>")
        pro.append(ind + '        <VectorDouble key="baseToFeature" value="0,0,0,0,0,0"/>')
        if group_speed is not None and group_speed != wp["speed"]:
            
            pro.append('              <motionParameters blendRadius="%r" jointSpeed="%r" jointAcceleration="%r" cartesianSpeed="%r" cartesianAcceleration="%r"/>'
                       % (wp["zone"] / 1000.0, sj, aj, sl, al))
        else:
            pro.append(ind + '        <Float64 key="blendRadius" value="%s"/>' % ("%f" % (wp["zone"] / 1000.0) if blended else "0.02"))
            pro.append(ind + '        <String key="blendType" value="%s"/>' % ("WAYPOINT_BLEND" if blended else "NO_BLEND"))
        pro.append(ind + '        <Float64 key="cartesianAcceleration" value="%r"/>' % al)
        pro.append(ind + '        <Float64 key="cartesianSpeed" value="%.2f"/>' % sl)
        pro.append(ind + '        <Float64 key="jointAcceleration" value="%f"/>' % aj)
        pro.append(ind + '        <Float64 key="jointSpeed" value="%f"/>' % sj)
        pro.append(ind + '        <Float64 key="motionTime" value="0"/>')
        pro.append(ind + '        <String key="motionType" value="SHARED"/>')
        pro.append(ind + '        <String key="type" value="POSITION"/>')
        pro.append(ind + '        <String key="variableType" value="VARIABLE_POSE"/>')
        pro.append(ind + '        <Waypoint key="waypoint" name="Waypoint_%d"/>' % n)
        pro.append(ind + "    </datamodel>")
        pro.append(ind + "</WaypointNode>")

    def _pro_move(self, it, pro):
        al, sl, aj, sj = it["speed"]
        first = it["wps"][0]
        blended = first["blend"] not in ("0", "0.0")
        pro.append('        <MoveNode title="Move%s" id="%s">' % (it["mtype"], it["uid"]))
        pro.append("            <datamodel>")
        pro.append('                <Float64 key="blendRadius" value="%s"/>' % ("%f" % (first["zone"] / 1000.0) if blended else "0"))
        pro.append('                <Feature key="feature" name="Base" id="%s"/>' % it["fid"])
        if it["mtype"] == "J":
            pro.append('                <Float64 key="jointAcceleration" value="%.3f"/>' % aj)
            pro.append('                <Float64 key="jointSpeed" value="%.3f"/>' % sj)
            pro.append('                <Float64 key="toolAcceleration" value="1.2"/>')
            pro.append('                <Float64 key="toolSpeed" value="0.25"/>')
            pro.append('                <String key="type" value="MOVE_J"/>')
        else:
            pro.append('                <Float64 key="jointAcceleration" value="%r"/>' % math.radians(80))
            pro.append('                <Float64 key="jointSpeed" value="%r"/>' % math.radians(60))
            pro.append('                <Float64 key="toolAcceleration" value="%.3f"/>' % al)
            pro.append('                <Float64 key="toolSpeed" value="%.3f"/>' % sl)
            pro.append('                <String key="type" value="MOVE_L"/>')
        pro.append('                <Bool key="useActiveTCP" value="true"/>')
        pro.append('                <Bool key="useJoints" value="%s"/>' % ("true" if it["use_joints"] else "false"))
        pro.append("            </datamodel>")
        pro.append("            <children>")
        for wp in it["wps"]:
            if wp.get("circle"):
                pro.append('                <CircleNode title="Circle" id="%s">' % wp["uid"])
                pro.append("                    <datamodel>")
                pro.append('                        <Int32 key="circle_path_mode" value="0"/>')
                pro.append('                        <Float32 key="decimal_of_turns" value="0"/>')
                pro.append('                        <Bool key="full_circle" value="false"/>')
                pro.append('                        <Int32 key="number_of_turns" value="1"/>')
                pro.append('                        <Bool key="number_of_turns_selection" value="false"/>')
                pro.append("                    </datamodel>")
                pro.append("                    <children>")
                self._pro_waypoint(wp["a"], wp["a_uid"], wp, pro, "                        ")
                self._pro_waypoint(wp["b"], wp["b_uid"], wp, pro, "                        ")
                pro.append("                    </children>")
                pro.append("                </CircleNode>")
            else:
                self._pro_waypoint(wp["n"], wp["uid"], wp, pro, group_speed=it["wps"][0]["speed"])
        pro.append("            </children>")
        pro.append("        </MoveNode>")
