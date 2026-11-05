# Probes station lifecycle, tree hierarchy, copying, reparenting and item visibility.














import os
import subprocess
import sys
import time

PORT = int(sys.argv[1])
ROBOT_FILE = sys.argv[2]
OBJECT_FILE = sys.argv[3]
TOOL_FILE = sys.argv[4]
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, os.pardir, "python", "enginuity", "src"))  

from enginuity import robolink, robomath  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
WINLIST = os.path.join(HERE, "..", "tools", "winlist")


def fmt(v):
    if isinstance(v, robomath.Mat):
        return fmt(v.rows)
    if isinstance(v, robolink.Item):
        if v.item == 0:
            return "<null>"
        try:
            return f"<{v.Name()}|t{v.Type()}>"
        except Exception:
            return "<invalid>"
    if isinstance(v, float):
        r = round(v, 3)
        return "0.0" if r == 0 else repr(r)
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join(fmt(x) for x in v) + "]"
    return repr(v)


def step(label, fn):
    try:
        r = fn()
        print(f"{label}: {fmt(r)}", flush=True)
        return r
    except Exception as exc:  
        msg = str(exc).strip().splitlines()[0] if str(exc).strip() else type(exc).__name__
        print(f"{label}: ERROR {type(exc).__name__}: {msg}", flush=True)
        return None


def tree_lines(item, depth=0):
    out = []
    for c in item.Childs():
        out.append("  " * depth + f"{c.Name()!r} t{c.Type()}")
        out.extend(tree_lines(c, depth + 1))
    return out


def dump(label, item):
    print(f"{label}:", flush=True)
    for line in tree_lines(item):
        print("    " + line, flush=True)


def xyzrpw(pose):
    return [round(x, 3) + 0.0 for x in robomath.Pose_2_TxyzRxyz(pose)]


def window_title():
    try:
        pid = subprocess.run(["lsof", "-t", "-nP", f"-iTCP:{PORT}", "-sTCP:LISTEN"],
                             capture_output=True, text=True).stdout.split()
        out = subprocess.run([WINLIST, "RoboDK"], capture_output=True, text=True).stdout
    except Exception:
        return None
    for line in out.splitlines():
        parts = line.split("\t")
        if pid and parts and parts[0] == pid[0] and parts[4].startswith("RoboDK -"):
            return parts[4]
    return None


def link(item, t):
    li = item.getLink(t)
    return li.Name() if li.Valid() else None


RDK = robolink.Robolink(port=PORT, args=[], quit_on_close=False)
RDK.setRunMode(robolink.RUNMODE_SIMULATE)


for _ in range(50):  
    if len(RDK.getOpenStations()) == 1 and RDK.ActiveStation().Name() == "New Station (1)" \
            and not RDK.ActiveStation().Childs():
        break
    RDK.CloseStation()
step("A01_open_stations_after_reset", lambda: [s.Name() for s in RDK.getOpenStations()])
step("A02_title_after_reset", window_title)
step("A03_add_station_default_name", lambda: RDK.AddStation().Name())
step("A04_title_after_add", window_title)
step("A05_add_station_empty_name", lambda: repr(RDK.AddStation("").Name()))
step("A06_title_after_add_empty", window_title)
s_dup1 = RDK.AddStation("Dup")
s_dup2 = RDK.AddStation("Dup")
step("A07_duplicate_station_names", lambda: [s.Name() for s in RDK.getOpenStations()])
step("A08_title_4th_station", window_title)
step("A09_active_is_last_added", lambda: RDK.ActiveStation().Name())
step("A10_rename_active_station", lambda: s_dup2.setName("Dup renamed").Name())
step("A11_title_after_rename_no_refresh", window_title)
step("A12_setActiveStation_same", lambda: RDK.setActiveStation(s_dup2))
step("A13_title_after_reactivate", window_title)
step("A14_close_active", lambda: RDK.CloseStation())
step("A15_active_after_close", lambda: RDK.ActiveStation().Name())
step("A16_open_after_close", lambda: [s.Name() for s in RDK.getOpenStations()])
for _ in range(10):
    if len(RDK.getOpenStations()) == 1:
        break
    RDK.CloseStation()
step("A17_close_last_station_recreates", lambda: (RDK.CloseStation(), [s.Name() for s in RDK.getOpenStations()])[1])
step("A18_title_after_recreate", window_title)

st = RDK.AddStation("TreeProbe")
step("A19_station_type", lambda: st.Type())
step("A20_station_parent", lambda: st.Parent())


fr = [step(f"B01_add_frame_empty_name_{i}", lambda: RDK.AddFrame("")) for i in range(3)]
step("B02_frame_poses", lambda: [xyzrpw(f.Pose()) for f in fr])
step("B03_rename_frame2", lambda: fr[1].setName("Renamed").Name())
step("B04_add_frame_after_rename", lambda: RDK.AddFrame("").Name())
step("B05_delete_frame1", lambda: fr[0].Delete())
step("B06_add_frame_after_delete_duplicates", lambda: RDK.AddFrame("").Name())
step("B07_frame_names", lambda: [f.Name() for f in RDK.ItemList(robolink.ITEM_TYPE_FRAME)])
step("B08_move_frame3_to_y5000", lambda: fr[2].setPose(robomath.transl(0, 5000, 0)) and None)
fnext = step("B09_next_frame_after_move", lambda: RDK.AddFrame("Next"))
step("B10_next_frame_pose_maxY_plus_1000", lambda: xyzrpw(fnext.Pose()))
fnest = step("B11_nested_frame", lambda: RDK.AddFrame("Nested", fr[1]))
step("B12_nested_frame_parent_pose", lambda: (fnest.Parent().Name(), xyzrpw(fnest.Pose())))
step("B13_select_frame_then_add_frame_no_parent", lambda: (RDK.setSelection([fr[1]]), RDK.AddFrame("UnderSel").Parent().Name())[1])
RDK.setSelection([])

robot = step("B14_addfile_robot", lambda: RDK.AddFile(ROBOT_FILE))
base = robot.Parent()
step("B15_robot_base_frame_name_type", lambda: (base.Name(), base.Type()))
step("B16_robot_base_parent", lambda: base.Parent().Name())
step("B17_robot_base_pose", lambda: xyzrpw(base.Pose()))
step("B18_robot_active_frame_after_load", lambda: link(robot, robolink.ITEM_TYPE_FRAME))
step("B19_rename_robot_keeps_base_name", lambda: (robot.setName("R1"), base.Name())[1])
fa = step("B20_add_frame_sets_robot_active_frame", lambda: RDK.AddFrame("Work"))
step("B21_robot_active_frame", lambda: link(robot, robolink.ITEM_TYPE_FRAME))
robot2 = RDK.AddFile(ROBOT_FILE, fr[1])
step("B22_robot2_base_parent_pose", lambda: (robot2.Parent().Parent().Name(), xyzrpw(robot2.Parent().Pose())))
robot2.setName("R2")
step("B23_robot2_active_frame", lambda: link(robot2, robolink.ITEM_TYPE_FRAME))

step("B24_tool_api_default_name", lambda: robot.AddTool(robomath.transl(0, 0, 100)).Name())
step("B25_tool_api_empty_name", lambda: repr(robot.AddTool(robomath.transl(0, 0, 110), "").Name()))
step("B26_tool_dup_name_allowed", lambda: robot.AddTool(robomath.transl(0, 0, 120), "New TCP").Name())
step("B27_active_tool_stays_first", lambda: link(robot, robolink.ITEM_TYPE_TOOL))
step("B28_cmd_AddTool_returns_ptr", lambda: RDK.Command("AddTool", "").isdigit())
step("B29_tool_names", lambda: [(t.Name(), t.Parent().Name()) for t in RDK.ItemList(robolink.ITEM_TYPE_TOOL)])


tfile = step("B30_addfile_tool_with_robot_parent", lambda: RDK.AddFile(TOOL_FILE, robot))
step("B31_tool_file_name_type_parent", lambda: (tfile.Name(), tfile.Type(), tfile.Parent().Name()))
obj = step("B32_addfile_object", lambda: RDK.AddFile(OBJECT_FILE))
step("B33_object_parent_pose", lambda: (obj.Parent().Name(), xyzrpw(obj.Pose())))
step("B34_addfile_object_under_frame", lambda: RDK.AddFile(OBJECT_FILE, fa).Parent().Name())
step("B34b_addfile_object_with_frame_selected", lambda: (RDK.setSelection([fa]), RDK.AddFile(OBJECT_FILE).Parent().Name(), RDK.setSelection([]))[1])

step("B35_target_explicit", lambda: (lambda t: (t.Name(), t.Parent().Name(), link(t, robolink.ITEM_TYPE_ROBOT)))(RDK.AddTarget("T explicit", fa, robot)))
step("B36_target_empty_name_api", lambda: repr(RDK.AddTarget("", fa, robot).Name()))
step("B37_target_no_args_parent_robot", lambda: (lambda t: (t.Parent().Name(), link(t, robolink.ITEM_TYPE_ROBOT)))(RDK.AddTarget("T noargs")))
step("B38_target_robot_only", lambda: (lambda t: (t.Parent().Name(), link(t, robolink.ITEM_TYPE_ROBOT)))(RDK.AddTarget("T r2", 0, robot2)))
step("B39_target_parent_robot_allowed_by_api", lambda: RDK.AddTarget("T on robot", robot).Parent().Name())
step("B40_prog_api_name_and_parent", lambda: (lambda p: (p.Name(), p.Parent().Name(), link(p, robolink.ITEM_TYPE_ROBOT)))(RDK.AddProgram("P1", robot2)))
step("B41_prog_no_robot_links_first_robot", lambda: link(RDK.AddProgram("P2"), robolink.ITEM_TYPE_ROBOT))
step("B42_prog_empty_name_api", lambda: repr(RDK.AddProgram("").Name()))
step("B43_cmd_AddScript_names", lambda: (RDK.Command("AddScript", ""), RDK.Command("AddScript", ""),
                                        [p.Name() for p in RDK.ItemList(robolink.ITEM_TYPE_PROGRAM_PYTHON)])[2])
step("B44_cmd_AddFolder_names", lambda: (RDK.Command("AddFolder", ""), RDK.Command("AddFolder", "Mine"), RDK.Command("AddFolder", ""),
                                        [(f.Name(), f.Parent().Name()) for f in RDK.ItemList(robolink.ITEM_TYPE_FOLDER)])[3])
step("B45_cmd_AddNotes_names", lambda: (RDK.Command("AddNotes", ""), RDK.Command("AddNotes", ""),
                                       [(n.Name(), n.Parent().Name()) for n in RDK.ItemList(robolink.ITEM_TYPE_NOTES)])[2])
step("B46_machining_default_name", lambda: RDK.AddMachiningProject().Name())
dump("B47_tree", st)

st_e = RDK.AddStation("EmptyForTarget")
step("B48_target_in_empty_station_autocreates_frame", lambda: (lambda t: (t.Parent().Name(), link(t, robolink.ITEM_TYPE_ROBOT)))(RDK.AddTarget("T0")))
dump("B49_tree_empty_station", st_e)
RDK.CloseStation()

st_o = RDK.AddStation("ObjectParent")
r_o = RDK.AddFile(ROBOT_FILE)
r_o.setName("RO")
fF = RDK.AddFrame("F")
fG = RDK.AddFrame("G")
step("B50_single_robot_active_frame_is_first_new_frame", lambda: link(r_o, robolink.ITEM_TYPE_FRAME))
step("B51_object_no_parent_goes_to_robot_active_frame", lambda: RDK.AddFile(OBJECT_FILE).Parent().Name())
step("B52_object_ignores_selected_frame", lambda: (RDK.setSelection([fG]), RDK.AddFile(OBJECT_FILE).Parent().Name(), RDK.setSelection([]))[1])
step("B53_object_follows_new_active_frame", lambda: (r_o.setPoseFrame(fG), RDK.AddFile(OBJECT_FILE).Parent().Name())[1])
step("B54_tool_file_single_robot_autoattach", lambda: (lambda t: (t.Name(), t.Parent().Name(), link(r_o, robolink.ITEM_TYPE_TOOL)))(RDK.AddFile(TOOL_FILE)))
RDK.CloseStation()
RDK.setActiveStation(st)


A = RDK.AddFrame("A"); A.setPose(robomath.transl(100, 0, 0))
B = RDK.AddFrame("B"); B.setPose(robomath.transl(0, 500, 0) * robomath.rotz(robomath.pi / 2))
C = RDK.AddFrame("C", A); C.setPose(robomath.transl(10, 20, 30))
step("C01_C_rel_abs", lambda: (xyzrpw(C.Pose()), xyzrpw(C.PoseAbs())))
step("C02_setParent_keeps_relative", lambda: (C.setParent(B), C.Parent().Name(), xyzrpw(C.Pose()), xyzrpw(C.PoseAbs()))[1:])
step("C03_setParentStatic_keeps_absolute", lambda: (C.setParentStatic(A), C.Parent().Name(), xyzrpw(C.Pose()), xyzrpw(C.PoseAbs()))[1:])
step("C04_setParent_into_own_child_refused", lambda: (A.setParent(C), A.Parent().Name())[1])
step("C05_rename_empty_allowed_api", lambda: repr(B.setName("").Name()))
step("C06_rename_whitespace_kept", lambda: repr(B.setName("  B  ").Name()))
step("C07_rename_duplicate_allowed", lambda: B.setName("A").Name())
step("C08_Item_by_name_returns_first_in_tree", lambda: RDK.Item("A", robolink.ITEM_TYPE_FRAME).Pose() == A.Pose())
B.setName("B")
step("C09_visible_default", lambda: (A.Visible(), C.Visible()))
step("C10_hide_parent_children_unchanged", lambda: (A.setVisible(False), A.Visible(), C.Visible())[1:])
A.setVisible(True)
step("C11_tree_IsExpanded_station_frame", lambda: (st.setParam("Tree", "IsExpanded"), A.setParam("Tree", "IsExpanded")))
step("C12_tree_IsExpanded_robot_base_robot", lambda: (base.setParam("Tree", "IsExpanded"), robot.setParam("Tree", "IsExpanded")))
step("C13_tree_IsHidden_row", lambda: A.setParam("Tree", "IsHidden"))
step("C14_tree_collapse_then_query", lambda: (A.setParam("Tree", "Collapse"), A.setParam("Tree", "IsExpanded"))[1])
A.setParam("Tree", "Expand")
step("C15_selection_set_get", lambda: (RDK.setSelection([A, B]), [i.Name() for i in RDK.Selection()])[1])
step("C16_tree_Reveal_selects_item", lambda: (A.setParam("Tree", "Reveal"), [i.Name() for i in RDK.Selection()])[1])
RDK.setSelection([])


tA = RDK.AddTarget("TA", A, robot)
step("D01_copy_frame_with_children", lambda: RDK.Copy(A))
pa = step("D02_paste_to_station_keeps_name", lambda: RDK.Paste())
step("D03_pasted_parent_children_pose", lambda: (pa.Parent().Name(), [c.Name() for c in pa.Childs()], xyzrpw(pa.Pose())))
step("D04_paste_into_B", lambda: RDK.Paste(B).Parent().Name())
step("D05_paste_3_times", lambda: [i.Name() for i in RDK.Paste(st, 3)])
step("D06_copy_without_children", lambda: (RDK.Copy(A, False), [c.Name() for c in RDK.Paste().Childs()])[1])
step("D07_copy_target_keeps_robot_link", lambda: (RDK.Copy(tA), (lambda t: (t.Name(), t.Parent().Name(), link(t, robolink.ITEM_TYPE_ROBOT)))(RDK.Paste()))[1])
step("D08_copy_robot_paste_at_root_no_base", lambda: (RDK.Copy(robot), (lambda r: (r.Name(), r.Parent().Name(), [c.Name() for c in r.Childs()]))(RDK.Paste()))[1])


X = RDK.AddFrame("X"); Y = RDK.AddFrame("Y", X); Z = RDK.AddFrame("Z", Y)
step("E01_delete_parent_deletes_descendants", lambda: (X.Delete(), Y.Valid(True), Z.Valid(True))[1:])
step("E02_delete_list_parent_and_child", lambda: (lambda p, c: (RDK.Delete([p, c]), p.Valid(True), c.Valid(True))[1:])(RDK.AddFrame("P"), RDK.AddFrame("Q", RDK.Item("P", robolink.ITEM_TYPE_FRAME))))
rd = RDK.AddFile(ROBOT_FILE)
rd_base = rd.Parent()
rd_tool = rd.AddTool(robomath.transl(0, 0, 50), "RD tool")
step("E03_delete_robot_only_child_removes_base", lambda: (rd.Delete(), rd_base.Valid(True), rd_tool.Valid(True))[1:])
rk = RDK.AddFile(ROBOT_FILE)
rk_base = rk.Parent()
tk = RDK.AddTarget("TK", rk_base, rk)
pk = RDK.AddProgram("PK", rk)
pk.MoveJ(tk)
step("E04_delete_target_used_by_program", lambda: (tk.Delete(), pk.InstructionCount())[1])
step("E05_program_instruction_after_target_delete", lambda: pk.Instruction(0)[:2])
tk2 = RDK.AddTarget("TK2", rk_base, rk)
step("E06_delete_robot_base_with_other_children", lambda: (rk.Delete(), rk_base.Valid(True), tk2.Valid(True), link(tk2, robolink.ITEM_TYPE_ROBOT), link(pk, robolink.ITEM_TYPE_ROBOT))[1:])
step("E07_delete_invalid_item", lambda: robolink.Item(RDK, 0).Delete())


robot.setJoints([0, 0, 0, 0, 0, 0])
jt = RDK.AddTarget("JT", base, robot)
jt.setAsJointTarget()
jt.setJoints([30, 10, 10, 0, 20, 0])
step("F01_dblclick_joint_target_moves_robot", lambda: (jt.setParam("Action", "DoubleClick"), [round(j, 2) for j in robot.Joints().list()])[1])
other = RDK.AddFrame("Other")
robot.setPoseFrame(other)
step("F02_robot_frame_before", lambda: link(robot, robolink.ITEM_TYPE_FRAME))
step("F03_dblclick_target_switches_robot_frame", lambda: (jt.setParam("Action", "DoubleClick"), link(robot, robolink.ITEM_TYPE_FRAME))[1])
robot.setJoints([0, 0, 0, 0, 0, 0])
pr = RDK.AddProgram("PR", robot)
pr.MoveJ(jt)


def run_and_wait():
    pr.setParam("Action", "DoubleClick")
    t0 = time.time()
    time.sleep(0.5)
    while pr.Busy() and time.time() - t0 < 20:
        time.sleep(0.2)
    return [round(j, 2) for j in robot.Joints().list()]


step("F04_dblclick_program_runs_it", run_and_wait)
s_other = RDK.AddStation("OtherStation")
step("F05_active_before_station_dblclick", lambda: RDK.ActiveStation().Name())
step("F06_dblclick_station_activates", lambda: (st.setParam("Action", "DoubleClick"), RDK.ActiveStation().Name())[1])
step("F07_title_after_activation", window_title)
step("F08_itemlist_only_active_station", lambda: "OtherStation" in RDK.ItemList(list_names=True))
step("F09_item_lookup_other_station", lambda: RDK.Item("OtherStation").Valid())
dump("F10_final_tree", st)
RDK.Disconnect()
print("done", flush=True)
