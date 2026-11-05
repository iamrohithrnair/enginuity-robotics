# Probes GUI selection, clipboard, undo and view interactions alongside API state.







import os
import subprocess
import sys
import time

PORT = int(sys.argv[1])
ROBOT_FILE = sys.argv[2]
SCREEN_DIR = sys.argv[3]
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, os.pardir, "python", "enginuity", "src"))  

from enginuity import robolink, robomath  # noqa: E402

WINLIST = os.path.join(os.path.dirname(__file__), "..", "tools", "winlist")
RDK = robolink.Robolink(port=PORT, args=[], quit_on_close=False)
RDK.setRunMode(robolink.RUNMODE_SIMULATE)


def r3(v):
    return [0.0 if abs(round(x, 3)) == 0 else round(x, 3) for x in v]


def rot(m):
    return [r3(row[:3]) for row in m.rows[:3]]


def step(label, fn):
    try:
        res = fn()
        print(f"{label}: {res}", flush=True)
        return res
    except Exception as exc:  
        msg = str(exc).strip().splitlines()[0] if str(exc).strip() else type(exc).__name__
        print(f"{label}: ERROR {type(exc).__name__}: {msg}", flush=True)
        return None


def pbcopy(text):
    subprocess.run(["pbcopy"], input=text.encode(), check=True)


def pbpaste():
    return subprocess.run(["pbpaste"], capture_output=True).stdout.decode(errors="replace")


def clipboard_info():
    out = subprocess.run(["osascript", "-e", "clipboard info"], capture_output=True)
    return out.stdout.decode(errors="replace").strip()


def undo_texts():
    lst = RDK.Command("TriggerAction", "")
    return [x for x in lst.split("||") if x.startswith("actionUndo") or x.startswith("actionRedo")]


def trigger(name, wait=0.4):
    res = RDK.Command("TriggerAction", name)
    time.sleep(wait)
    return res


def window_id():
    try:
        out = subprocess.run([WINLIST, "RoboDK"], capture_output=True).stdout.decode(errors="replace")
    except OSError:
        return None
    best = None
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) >= 5 and parts[4].startswith("RoboDK -"):
            try:
                pid = int(parts[0])
            except ValueError:
                continue
            if pid == RDK_PID:
                best = parts[1]
    return best


def shot(name):
    wid = window_id()
    if not wid:
        return "no-window"
    path = os.path.join(SCREEN_DIR, f"im-{name}.png")
    subprocess.run(["screencapture", "-x", "-o", "-l", wid, path], check=False)
    return os.path.basename(path)


def find_pid():
    out = subprocess.run(["lsof", "-nP", f"-iTCP:{PORT}", "-sTCP:LISTEN", "-Fp"], capture_output=True)
    for line in out.stdout.decode().splitlines():
        if line.startswith("p"):
            return int(line[1:])
    return -1


RDK_PID = find_pid()


step("A1_stations", lambda: [s.Name() for s in RDK.ItemList(robolink.ITEM_TYPE_STATION)])
step("A2_undo_actions_initial", undo_texts)
step("A3_window_title", lambda: [l.split("\t")[4] for l in subprocess.run([WINLIST, "RoboDK"], capture_output=True).stdout.decode().splitlines() if l.startswith(str(RDK_PID))])
step("A4_shot_initial", lambda: shot("02-initial"))


for act in ["actionIsometric", "actionTop", "actionFront", "actionRight", "actionLeft", "actionBack"]:
    step(f"B_{act}", lambda: (trigger(act), rot(RDK.ViewPose()))[1])
step("B_keyevent_portable_Alt+3", lambda: RDK.Command("KeyEvent", "Alt+3"))
step("B_view_after_portable", lambda: rot(RDK.ViewPose()))
step("B_keyevent_native_opt3", lambda: RDK.Command("KeyEvent", "⌥3"))
step("B_view_after_native", lambda: rot(RDK.ViewPose()))
step("B_triggeraction_unknown", lambda: RDK.Command("TriggerAction", "actionDoesNotExist"))
step("B_fit_isometric_cmd", lambda: (RDK.Command("FitIsometric", ""), rot(RDK.ViewPose()))[1])


robot = RDK.AddFile(ROBOT_FILE)
step("C1_robot_loaded", lambda: robot.Name())
step("C1_undo_after_addfile", undo_texts)
RDK.setSelection([])
pbcopy("10\t20\t30\t40\t50\t60")
step("C2_paste_joints_text", lambda: trigger("actionPaste"))
step("C2_joints", lambda: r3(robot.Joints().list()))
step("C2_undo_texts", undo_texts)
pbcopy("11\t21\t31\t41\t51\t61")
step("C3_paste_joints_again", lambda: trigger("actionPaste"))
step("C3_joints", lambda: r3(robot.Joints().list()))
step("C3_undo_texts", undo_texts)
step("C4_undo", lambda: trigger("actionUndo"))
step("C4_joints", lambda: r3(robot.Joints().list()))
step("C4_undo_texts", undo_texts)
step("C5_redo", lambda: trigger("actionRedo"))
step("C5_joints", lambda: r3(robot.Joints().list()))
robot.setJoints([5, 5, 5, 5, 5, 5])
step("C6_api_setJoints_joints", lambda: r3(robot.Joints().list()))
step("C6_undo_texts_after_api", undo_texts)
step("C6_undo", lambda: trigger("actionUndo"))
step("C6_joints_after_undo", lambda: r3(robot.Joints().list()))
step("C6_redo", lambda: trigger("actionRedo"))
frame = RDK.AddFrame("UndoFrame")
step("C7_undo_after_addframe", undo_texts)
frame.setName("UndoFrame2")
step("C7_undo_after_api_setName", undo_texts)
frame.setPose(robomath.transl(10, 20, 30))
step("C7_undo_after_api_setPose", undo_texts)
frame.setVisible(False)
step("C7_undo_after_api_setVisible", undo_texts)
frame.setVisible(True)
frame.setParent(robot.Parent())
step("C7_undo_after_api_setParent", undo_texts)
tmp = RDK.AddFrame("ToDelete")
tmp.Delete()
step("C8_undo_after_api_delete", undo_texts)
pbcopy("1\t2\t3\t4\t5\t6")
RDK.setSelection([])
trigger("actionPaste")
step("C9_undo_after_paste_joints", undo_texts)
tmp2 = RDK.AddFrame("ToDelete2")
RDK.setSelection([tmp2])
step("C9_cut_selected", lambda: trigger("actionCut"))
step("C9_cut_item_valid", lambda: tmp2.Valid())
step("C9_undo_after_cut_delete", undo_texts)


RDK.setSelection([])
step("D1_copy_no_selection", lambda: trigger("actionCopy"))
step("D1_clipboard_text", lambda: repr(pbpaste()))
src = RDK.AddFrame("CopyMe")
src.setPose(robomath.transl(100, 200, 300) * robomath.rotz(robomath.pi / 6))
dst = RDK.AddFrame("PasteTarget")
dst.setPose(robomath.transl(0, 1000, 0))
child = RDK.AddFrame("CopyMeChild", src)
child.setPose(robomath.transl(0, 0, 50))
RDK.setSelection([src])
step("D2_copy_selected", lambda: trigger("actionCopy"))
step("D2_clipboard_text", lambda: repr(pbpaste()))
step("D2_clipboard_info", clipboard_info)
before = set(i.item for i in RDK.ItemList())
RDK.setSelection([dst])
step("D3_paste_into_selected", lambda: trigger("actionPaste"))
new = [i for i in RDK.ItemList() if i.item not in before]
step("D3_new_items", lambda: [(i.Name(), i.Parent().Name(), r3(i.Pose().Pos()), r3(i.PoseAbs().Pos())) for i in new])
before = set(i.item for i in RDK.ItemList())
RDK.setSelection([])
step("D4_paste_no_selection", lambda: trigger("actionPaste"))
new = [i for i in RDK.ItemList() if i.item not in before]
step("D4_new_items", lambda: [(i.Name(), i.Parent().Name(), r3(i.Pose().Pos())) for i in new])
step("D4_undo_texts", undo_texts)
src.Copy()
step("D5_api_copy_clipboard_text", lambda: repr(pbpaste()))
p1 = RDK.Paste(dst)
step("D5_api_paste", lambda: (p1.Name(), p1.Parent().Name(), r3(p1.Pose().Pos())))
plist = RDK.Paste(dst, 3)
step("D5_api_paste_x3", lambda: [p.Name() for p in plist])
before = set(i.item for i in RDK.ItemList())
RDK.setSelection([])
pbcopy("1 2 3\n4 5 6\n7 8 9")
step("D6_paste_xyz_text", lambda: trigger("actionPaste"))
new = [i for i in RDK.ItemList() if i.item not in before]
step("D6_new_items", lambda: [(i.Name(), i.Type(), i.Parent().Name()) for i in new])
before = set(i.item for i in RDK.ItemList())
pbcopy("1 2 3 0 0 1\n4 5 6 0 0 1\n7 8 9 0 0 1")
step("D7_paste_xyzijk_text", lambda: trigger("actionPaste"))
new = [i for i in RDK.ItemList() if i.item not in before]
step("D7_new_items", lambda: [(i.Name(), i.Type(), i.Parent().Name()) for i in new])
before = set(i.item for i in RDK.ItemList())
pbcopy("hello world")
step("D8_paste_garbage", lambda: trigger("actionPaste"))
new = [i for i in RDK.ItemList() if i.item not in before]
step("D8_new_items", lambda: [(i.Name(), i.Type()) for i in new])


step("E1_toolbar_complete", lambda: RDK.Command("ToolbarLayout", "Complete"))
time.sleep(0.6)
step("E1_shot", lambda: shot("03-toolbar-complete"))
step("E2_toolbar_basic", lambda: RDK.Command("ToolbarLayout", "Basic"))
time.sleep(0.6)
step("E2_shot", lambda: shot("04-toolbar-basic"))
step("E3_toolbar_default", lambda: trigger("actionRestore_default_toolbar", 0.8))



step("E5_cinema_on", lambda: trigger("actionShow_Cinema_Mode", 1.0))
step("E5_shot", lambda: shot("06-cinema"))
step("E5_cinema_off", lambda: trigger("actionShow_Cinema_Mode", 1.0))
step("E6_perspective_toggle", lambda: trigger("actionPerspective_view", 0.6))
step("E6_shot", lambda: shot("07-perspective-toggled"))
step("E6_perspective_back", lambda: trigger("actionPerspective_view", 0.6))
step("E7_final_undo_texts", undo_texts)
print("DONE", flush=True)
