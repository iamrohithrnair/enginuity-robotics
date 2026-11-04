 
 
 
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { convertSimReadyAsset, type AssetFiles } from "@/server/simready/usd";
import { parseUSDA } from "@/server/simready/usd-layer";

const FIX = path.join(__dirname, "fixtures/basic");
const dirFiles = (dir: string): AssetFiles & { read: string[] } => {
  const read: string[] = [];
  return {
    read,
    async get(rel) {
      try {
        const b = new Uint8Array(await readFile(path.join(dir, rel)));
        read.push(rel);
        return b;
      } catch {
        return null;
      }
    },
  };
};
const near = (a: ArrayLike<number>, b: number[], eps = 1e-3) => b.every((v, i) => Math.abs(a[i] - v) < eps);

describe("USDA parser", () => {
  it("reads prims, metadata, properties, connections and variant sets", () => {
    const l = parseUSDA(
      `#usda 1.0
(
    defaultPrim = "A"
    subLayers = [@./x.usda@, @y.usda@]
)
def Xform "A" (
    prepend references = @./b.usda@</B>
    instanceable = true
    variants = { string v = "one" }
)
{
    custom uniform token[] xformOpOrder = ["xformOp:translate"]
    double3 xformOp:translate = (1, 2, 3) (doc = "moved")
    quatf xformOp:orient = (0.5, 0.1, 0.2, 0.3)
    prepend rel material:binding = </A/M>
    over "C" { float f.timeSamples = { 0: 4, 1: 5 } }
    variantSet "v" = { "one" { def Mesh "M" { point3f[] points = [(0, 0, 0)] } } }
    def Shader "S" { color3f inputs:diffuseColor.connect = </A/T.outputs:rgb> }
}`,
      "t.usda",
    );
    expect(l.meta.defaultPrim).toBe("A");
    expect(l.meta.subLayers).toEqual([{ assetPath: "./x.usda" }, { assetPath: "y.usda" }]);
    const a = l.root.children.get("A")!;
    expect(a.typeName).toBe("Xform");
    expect(a.meta.references).toEqual([{ assetPath: "./b.usda", primPath: "/B" }]);
    expect(a.meta.instanceable).toBe(true);
    expect(a.meta.variantSelection).toEqual({ v: "one" });
    expect(a.props.get("xformOp:translate")!.value).toEqual([1, 2, 3]);
    expect(a.props.get("xformOp:orient")!.value).toEqual([0.1, 0.2, 0.3, 0.5]);  
    expect(a.props.get("xformOpOrder")!.value).toEqual(["xformOp:translate"]);
    expect(a.props.get("material:binding")!.targets).toEqual(["/A/M"]);
    expect(a.children.get("C")!.specifier).toBe("over");
    expect(a.children.get("C")!.props.get("f")!.value).toBe(4);
    expect(a.variantSets.get("v")!.get("one")!.children.get("M")!.typeName).toBe("Mesh");
    expect(a.children.get("S")!.props.get("inputs:diffuseColor")!.targets).toEqual(["/A/T.outputs:rgb"]);
  });
});

describe("convertSimReadyAsset", () => {
  it("composes payloads and sublayers, bakes transforms, converts cm/Y-up to mm/Z-up and groups by colour", async () => {
    const files = dirFiles(FIX);
    const r = await convertSimReadyAsset("root.usda", files);
    expect(r.metersPerUnit).toBe(0.01);
    expect(r.upAxis).toBe("Y");
    expect(r.triangles).toBe(4);  
    expect(r.bbox.min).toEqual([990, -50, 0]);
    expect(r.bbox.max).toEqual([1010, 0, 20]);
    expect(r.files.sort()).toEqual(["geo.usda", "overrides.usda", "root.usda"]);
    const byColor = Object.fromEntries(r.parts.map((p) => [p.color!.slice(0, 3).map((v) => Math.round(v * 100) / 100).join(","), p]));
    expect(Object.keys(byColor).sort()).toEqual(["0,0,1", "0,1,0", "1,0,0"]);
    const red = byColor["1,0,0"];
    expect(red.triangles.length).toBe(18);
     
    for (let k = 0; k < red.normals!.length; k += 3) expect(near(red.normals!.subarray(k, k + 3), [0, -1, 0])).toBe(true);
     
    const green = byColor["0,1,0"].triangles;
    expect(near(green.subarray(0, 3), [1000, -50, 20])).toBe(true);
    expect(near(green.subarray(3, 6), [990, -50, 0])).toBe(true);
    expect(near(green.subarray(6, 9), [1000, -50, 0])).toBe(true);
  });

  it("follows variant selections and internal references to class prims, in metres Z up", async () => {
    const r = await convertSimReadyAsset("variants.usda", dirFiles(FIX));
    expect(r.triangles).toBe(2);
    expect(r.bbox.min).toEqual([0, 0, 0]);
    expect(r.bbox.max).toEqual([1000, 4000, 2000]);
    expect(r.parts[0].color).toEqual([0.72, 0.73, 0.75, 1]);
  });

  it("fails clearly without the root layer or without meshes", async () => {
    await expect(convertSimReadyAsset("nope.usda", dirFiles(FIX))).rejects.toThrow(/not found/);
    await expect(convertSimReadyAsset("overrides.usda", dirFiles(FIX))).rejects.toThrow(/no renderable meshes/);
  });
});

 

const ROOT = path.resolve(__dirname, "../..");
function liveFiles(id: string): AssetFiles {
  let listing: Promise<Map<string, { size: number; sha256?: string }>> | undefined;
  const load = () =>
    (listing ??= (async () => {
      const res = await fetch(`https://huggingface.co/api/datasets/nvidia/simready-assets/tree/main/${id}?recursive=true`);
      const arr = (await res.json()) as { type: string; path: string; size: number; lfs?: { oid: string; size: number } }[];
      return new Map(arr.filter((e) => e.type === "file").map((e) => [e.path.slice(id.length + 1), { size: e.lfs?.size ?? e.size, sha256: e.lfs?.oid }]));
    })());
  return {
    async get(rel) {
      const file = path.join(ROOT, "data/simready/assets", id, rel);
      try {
        return new Uint8Array(await readFile(file));
      } catch {}
      if (!(await load()).has(rel)) return null;
      const res = await fetch(`https://huggingface.co/datasets/nvidia/simready-assets/resolve/main/${id}/${rel}`);
      if (!res.ok) return null;
      const buf = new Uint8Array(await res.arrayBuffer());
      await mkdir(path.dirname(file), { recursive: true });
      const part = `${file}.part-${process.pid}`;
      await writeFile(part, buf);
      await rename(part, file);
      return buf;
    },
    stat: async (rel) => (await load()).get(rel),
  };
}

describe.skipIf(!process.env.SIMREADY_LIVE)("live SimReady assets", () => {
  it.each([
    ["box_corrugated_brown_b20", "simready_usd/sm_box_corrugated_brown_b20_01.usd", [250, 500, 250], [350, 700, 350]],
    ["pallet_a01", "simready_usd/sm_pallet_a01_01.usd", [1100, 700, 120], [1300, 900, 250]],
  ])(
    "%s",
    async (id, root, lo, hi) => {
      const r = await convertSimReadyAsset(root as string, liveFiles(id as string), { textures: false });
      expect(r.triangles).toBeGreaterThan(1000);
      const size = r.bbox.max.map((v, k) => v - r.bbox.min[k]);
      size.forEach((s, k) => {
        expect(s).toBeGreaterThan((lo as number[])[k]);
        expect(s).toBeLessThan((hi as number[])[k]);
      });
      expect(r.bbox.min[2]).toBeGreaterThan(-1);  
      expect(r.parts.every((p) => p.normals && p.normals.length === p.triangles.length)).toBe(true);
      expect(r.physics?.rigidBody).toBe(true);
    },
    120000,
  );
});
