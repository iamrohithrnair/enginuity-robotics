 
 
 
 
 
 
 
 
 
 
 
 
 
 

import { hasActiveGuns } from "@/engine/spray";
import { getServer } from "@/server/store";
import { sprayApiBegin, sprayApiEnd, sprayPositionsUpdate } from "@/server/spray";
import { byHandle, cmd, settle } from "./bridge";
import { COMMAND_HOOKS, def, withApiLock } from "./context";

 
function columns(m: { rows: number; cols: number; data: number[] }, max = Infinity): number[][] | undefined {
  if (!(m.rows > 0 && m.cols > 0)) return undefined;
  const out: number[][] = [];
  for (let c = 0; c < Math.min(m.cols, max); c++) out.push(m.data.slice(c * m.rows, (c + 1) * m.rows));
  return out;
}

const itemOrNull = (h: number) => byHandle(h)?.id ?? null;

def("Gun_Add", "IS", async (c) => {
  const tool = await c.r.handle();
  const object = await c.r.handle();
  const options = await c.r.line();
  const volume = await c.r.matrix();
  const geometry = await c.r.matrix();
  await c.exec(async () => {
     
    const res = await cmd<{ id: number }>("spray.add", { tool: itemOrNull(tool), object: itemOrNull(object), options, volume: columns(volume, 2), geometry: columns(geometry) });
    c.w.int(res.id);
  });
});

def("Gun_SetState", "IS", async (c) => {
  const id = await c.r.int();
  const state = await c.r.int();
  await c.exec(async () => {
    const res = await cmd<{ state: number }>("spray.setState", { state, id });
    c.w.int(res.state);
  });
});

def("Gun_Stats", "LMS", async (c) => {
  await c.r.int();
  await c.exec(async () => {
    const res = await cmd<{ info: string; columns: number[][] }>("spray.stats", {});
    c.w.line(res.info);
    c.w.matrix(4, res.columns.length, res.columns.flat());
  });
});

def("Gun_Clear", "IS", async (c) => {
  await c.r.int();
  await c.exec(async () => {
    const res = await cmd<{ cleared: number }>("spray.clear", {});
    c.w.int(res.cleared);
  });
});








export const UPDATE_AFTER = new Set(
  (
    "RAISE HIDE QUIT NewStation S_Parent_Static S_Parent Attach_Closest2 Attach_Closest Detach_Closest Detach_All S_VisibleList S_Visible S_Name S_ViewPose " +
    "S_Hlocal S_Hlocals S_Hlocal_Abs S_Hlocal_AbsS Paste PastN AddShape4 AddShape5 AddShape3 AddShape2 AddShape AddWire AddWir2 AddPoints ProjectPoints " +
    "G_ObjSelection Add AddBlind ExecArgs Save Add_TARGET Add_FRAME Add_PROG Add_MACHINING S_MachiningParams Add_INSMOVE Add_INSMOVEC Prog_ShowIns " +
    "Prog_ShowTargets Prog_SIns Refresh RemoveStn RemoveLst Remove S_Target_As_JT S_Target_As_RT MakeProg MakeProg2 S_ProgRunType G_ProgRunType RunProg " +
    "RunCode RunCode2 RunPause waitDI RunMessage InsCustom InsCustom2 S_Thetas2 S_Thetas S_ThetasList S_Home AddToolEmpty S_AbsAccOn G_RobotParamAll " +
    "S_AbsAccParam Connect2 Connect ConnectParams setConnectParams ConnectedState Disconnect MoveXb MoveX MoveCb MoveC S_Speed S_Speed4 Stop ProgramStart " +
    "S_Robot S_Tool_ptr S_Tool S_Frame_ptr S_Link_ptr S_Frame S_Htool S_ZoneData Show_SeqPoses Show_Seq S_RunMode SimulateSpeed Recolor S_ColorList2 " +
    "S_ColorList S_Color S_ShapeColor Scale TrScale S_Hgeom S_Hgeo2 Render S_Selection SCMD G_ActiveStn G_AllStn Proj2d3d Collision_Items Collision_Pairs " +
    "Collision_SetState Collision_SetPairList Collision_SetPair ShowAsCollidedList ShowAsCollided CollisionMoveBlend CollisionMove CollisionMoveL " +
    "CollisionLineLst CalibTCP CalibTCP3 CalibRobot Cam2D_PtrSnapshot Cam2D_Close Cam2D_CloseAll Cam2D_SetParams Cam2D_PtrSetParams Gun_Stats MergeItems " +
    "Popup_ProgISO9283_Param Popup_ProgISO9283 S_InteractiveMode FitAll"
  ).split(" "),
);

 
const PRODUCT_REPLY = Buffer.from('{"product":"Enginuity"', "utf8");

COMMAND_HOOKS.set("spray", {
  before: (_name, conn) => sprayApiBegin(conn.id),
  async after(name, conn, reply) {
    sprayApiEnd(conn.id);
     
    if (!UPDATE_AFTER.has(name) || conn.autoUpdate !== 0) return;
     
     
    if (name === "SCMD" && reply.toBuffer().subarray(0, PRODUCT_REPLY.length).equals(PRODUCT_REPLY)) return;
    if (!hasActiveGuns(getServer().ws.activeStation)) return;
    await withApiLock(async () => {
      await settle();
      sprayPositionsUpdate(getServer());
    });
  },
});
