 
 
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { colMajorToMat, matToColMajor, WireReader, WireWriter } from "@/server/rdkapi/codec";
import { mul, rotz, transl } from "@/engine/math";

const ROOT = path.resolve(__dirname, "../..");

describe("RoboDK API codec", () => {
  it("encodes the RDK_API handshake request and reply byte for byte (R-POSTGEN-2)", () => {
    const req = new WireWriter().line("RDK_API").array([1, 0, 0]).toBuffer();
    expect(req.toString("hex")).toBe("52444b5f4150490a" + "00000003" + "3ff0000000000000" + "0000000000000000" + "0000000000000000");
    expect(req.length).toBe(36);
    const reply = new WireWriter().line("RDK_API").int(1).int(26935).status(0).toBuffer();
    expect(reply.toString("hex")).toBe("52444b5f4150490a" + "00000001" + "00006937" + "00000000");
    expect(reply.length).toBe(20);
  });

  it("writes poses column-major (R-POSTGEN-8)", () => {
    const pose = mul(transl(100, 200, 300), rotz(Math.PI / 2));
    const b = new WireWriter().pose(pose).toBuffer();
    expect(b.length).toBe(128);
     
    expect(b.subarray(0, 8).toString("hex")).toBe("3c91a62633145c07");
    expect([b.readDoubleBE(96), b.readDoubleBE(104), b.readDoubleBE(112), b.readDoubleBE(120)]).toEqual([100, 200, 300, 1]);
    expect(colMajorToMat(matToColMajor(pose))).toEqual(pose);
  });

  it("encodes item references as uint64 handle + int32 type and the null item as (0, -1)", () => {
    expect(new WireWriter().item(0x0bf18a7810, 3).toBuffer().toString("hex")).toBe("0000000bf18a7810" + "00000003");
    expect(new WireWriter().nullItem().toBuffer().toString("hex")).toBe("0000000000000000" + "ffffffff");
  });

  it("status words carry a message line only for 2, 3 and 10..99 (R-POSTGEN-10)", () => {
    expect(new WireWriter().status(0).toBuffer().toString("hex")).toBe("00000000");
    expect(new WireWriter().status(1).toBuffer().toString("hex")).toBe("00000001");
    expect(new WireWriter().status(10, "Target cannot be reached").toBuffer().toString()).toBe("\x00\x00\x00\x0aTarget cannot be reached\n");
    expect(new WireWriter().line("a\nb").toBuffer().toString()).toBe("a<br>b\n");
  });

  it("re-encodes every request of a real robolink session identically", async () => {
    const rows = readFileSync(path.join(ROOT, "research/evidence/api-wire-robodk.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { conn: number; dir: string; hex: string })
      .filter((r) => r.conn === 1);
    const c2s = Buffer.concat(rows.filter((r) => r.dir === "c2s").map((r) => Buffer.from(r.hex, "hex")));
    const s2c = Buffer.concat(rows.filter((r) => r.dir === "s2c").map((r) => Buffer.from(r.hex, "hex")));
     
    const SCHEMA: Record<string, [string, string]> = {
      S_RunMode: ["I", "S"], NewStation: ["L", "TS"], G_Name: ["P", "LS"], S_Name: ["PL", "S"], G_List_Items: ["", "*LS"],
      G_List_Items_ptr: ["", "*TS"], Add_FRAME: ["LP", "TS"], G_Item_Type: ["P", "IS"], S_Hlocal: ["PH", "S"], G_Hlocal: ["P", "HS"],
      G_Parent: ["P", "TS"], Add: ["LP", "TS"], G_Home: ["P", "AS"], G_RobLimits: ["P", "AAIS"], G_Thetas: ["P", "AS"],
      S_Thetas: ["AP", "S"], G_FK: ["AP", "HS"], G_Thetas_Config: ["AP", "AS"], G_IK: ["HP", "AS"], G_IK_cmpl: ["HP", "MS"],
      AddToolEmpty: ["PHL", "TS"], G_Tool: ["P", "HS"], Add_TARGET: ["LPP", "TS"], Target_Is_JT: ["P", "IS"], S_Target_As_JT: ["P", "S"],
      Add_PROG: ["LP", "TS"], S_Link_ptr: ["PP", "S"], S_Tool_ptr: ["PP", "S"], S_Speed4: ["PA", "S"], S_ZoneData: ["IP", "S"],
      Add_INSMOVE: ["PPI", "S"], RunPause: ["PI", "S"], RunCode2: ["PLI", "IS"], setDO: ["PLL", "S"], waitDI: ["PLLI", "S"],
      Prog_Nins: ["P", "IS"], Prog_GIns: ["PI", "?"], Update2: ["PA", "ALS"], RunProg: ["P", "IS"], IsBusy: ["P", "IS"],
      MakeProg2: ["PLI", "ILIS"], G_Param: ["L", "LS"], S_Param: ["LL", "S"], Collisions: ["", "IS"], Collision_SetState: ["I", "IS"],
      G_Item: ["L", "TS"], G_Item2: ["LI", "TS"], Copy2: ["PI", "S"], Paste: ["P", "TS"], Remove: ["P", "S"],
    };
    const r = new WireReader();
    r.push(c2s);
    r.close();
    const out = new WireWriter();
    const reencode = async (f: string) => {
      if (f === "L") out.line(await r.line());
      else if (f === "I") out.int(await r.int());
      else if (f === "P") out.handle(await r.handle());
      else if (f === "H") out.pose(await r.pose());
      else if (f === "A") out.array(await r.array());
    };
    out.line(await r.line());
    out.array(await r.array());
    let commands = 0;
    for (;;) {
      let name: string;
      try {
        name = await r.line();
      } catch {
        break;
      }
      out.line(name);
      const sch = SCHEMA[name];
      expect(sch, `schema for ${name}`).toBeDefined();
      for (const f of sch[0]) await reencode(f);
      commands++;
    }
    expect(commands).toBe(134);
    expect(out.toBuffer().equals(c2s)).toBe(true);

     
    const rr = new WireReader();
    rr.push(s2c);
    expect(await rr.line()).toBe("RDK_API");
    expect([await rr.int(), await rr.int(), await rr.int()]).toEqual([1, 26935, 0]);
    expect(await rr.int()).toBe(0);  
    const station = { h: await rr.handle(), t: await rr.int() };
    expect(station.t).toBe(1);
  });
});
