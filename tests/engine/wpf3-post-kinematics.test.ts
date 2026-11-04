 
 
 
 
 
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { robotDataFromParsed } from "@/engine/commands/robot";
import { initKinematics, parseRobotFile } from "@/engine/kinematics";
import { jointOnlyTargets, postKinematics } from "@/engine/post-kinematics";
import type { Item } from "@/engine/types";
import { LIBRARY_DIR, ROOT } from "../helpers";

const CAPTURE = path.join(ROOT, "research/evidence/postgen-blackbox/Omron/6ax-api");
const ROBOT = path.join(LIBRARY_DIR, "files/library-robots/Omron-TM12.robot");

 
function apiFk(probe: string): { joints: number[]; pose: number[] }[] {
  const sent: Buffer[] = [];
  const got: Buffer[] = [];
  for (const line of readFileSync(path.join(CAPTURE, probe, "_api.log"), "utf8").split("\n")) {
    const [tag, hex] = line.split(" ");
    if (hex) (tag === ">" ? sent : got).push(Buffer.from(hex, "hex"));
  }
  const req = Buffer.concat(sent);
  const ans = Buffer.concat(got);
  let i = 0;
  let j = 0;
  const line = () => {
    const end = req.indexOf(10, i);
    const s = req.subarray(i, end).toString();
    i = end + 1;
    return s;
  };
  const arr = (b: Buffer, at: number) => {
    const n = b.readInt32BE(at);
    return { v: Array.from({ length: n }, (_, k) => b.readDoubleBE(at + 4 + 8 * k)), next: at + 4 + 8 * n };
  };
  const out: { joints: number[]; pose: number[] }[] = [];
  while (i < req.length) {
    const name = line();
    if (name === "RDK_API") {
      i = arr(req, i).next;
      j = ans.indexOf(10, j) + 1 + 8;
    } else if (name === "G_Item_Type") {
      i += 8;
      j += 4;
    } else {
      const a = arr(req, i);
      i = a.next + 8;
      if (name === "G_FK") {
        const col = Array.from({ length: 16 }, (_, k) => ans.readDoubleBE(j + 8 * k));
        out.push({ joints: a.v, pose: [0, 1, 2, 3].flatMap((r) => [0, 1, 2, 3].map((c) => col[c * 4 + r])) });
        j += 128;
      } else j = arr(ans, j).next;
    }
    expect(ans.readInt32BE(j)).toBe(0);  
    j += 4;
  }
  return out;
}

describe.skipIf(!existsSync(CAPTURE))("joint-only targets of an intermediate file", () => {
  it("are the targets the Omron post asked the API about, once each, in program order", () => {
    for (const probe of ["types", "names", "manymoves"]) {
      const text = readFileSync(path.join(CAPTURE, probe, readdirIntermediate(probe)), "utf8");
      const asked = apiFk(probe).map((a) => a.joints.join(","));
      expect(jointOnlyTargets(text).map((q) => q.join(","))).toEqual([...new Set(asked)]);
    }
  });
});

function readdirIntermediate(probe: string): string {
  return readdirSync(path.join(CAPTURE, probe)).find((f) => f.startsWith("intermediate_"))!;
}

describe.skipIf(!existsSync(CAPTURE) || !existsSync(ROBOT))("kinematics handed to the post (needs the library mirror)", () => {
  beforeAll(async () => {
    await initKinematics();
  });

  it("match the G_FK and G_Thetas_Config answers for the robot named by robot_ptr", () => {
    const model = robotDataFromParsed(parseRobotFile(new Uint8Array(readFileSync(ROBOT))).json, []).model;
    const text = readFileSync(path.join(CAPTURE, "manymoves", readdirIntermediate("manymoves")), "utf8");
    const handle = Number(/robot_ptr=(\d+)/.exec(text)![1]);
    const items = { r1: { id: "r1", handle, type: "robot", robot: { model } } as unknown as Item };
    const kin = postKinematics(text, items);
    const fkAnswers = apiFk("manymoves");
    expect(kin.length).toBe(new Set(fkAnswers.map((a) => a.joints.join(","))).size);
    for (const k of kin) {
      const a = fkAnswers.find((x) => x.joints.join(",") === k.joints.join(","))!;
      expect(Math.max(...k.pose.flat().map((v, n) => Math.abs(v - a.pose[n])))).toBeLessThan(1e-9);
      expect(k.config).toHaveLength(4);
    }
     
    expect(postKinematics(text.replace(/robot_ptr=\d+/, "robot_ptr=1"), items)).toEqual([]);
  });
});
