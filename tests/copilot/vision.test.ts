// Verifies image validation, SAM box parsing, and photo-object tool behavior.
 
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPhotoTools,
  MAX_IMAGE_CHARS,
  MAX_IMAGES_PER_MESSAGE,
  parseImages,
  parseSamText,
  PHOTO_TOOL_COMMANDS,
  photoInstructions,
  userContent,
  type ChatImage,
  type SamConfig,
} from "@/server/copilot/vision";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP8=";
const KEY = "meta-test-key-0123456789";
const cfg: SamConfig = { baseURL: "https://api.meta.test/v1/", apiKey: KEY, model: "sam-3.1", timeoutMs: 500 };

const photo = (id: string, extra: Partial<ChatImage> = {}): ChatImage => ({ id, name: `${id}.jpg`, dataUrl: JPEG, width: 800, height: 600, ...extra });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const samReply = (text: string) => json({ id: "resp_1", object: "response", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text, annotations: [] }] }] });

afterEach(() => vi.unstubAllGlobals());

describe("parseSamText", () => {
  it("reads every box by key, with and without confidence, and ignores masks", () => {
    const text =
      "<0f>0<|box;x1=353;y1=382;x2=453;y2=427;w=537;h=561;c=0.9609375|><|mask;x=0;y=0;c=0.9609375;data=46,101,!abc|>," +
      "1<|box;h=561;w=537;x1=260;y1=382;x2=340;y2=427|><|mask;x=0;y=0;data=46,81,~xyz|>";
    expect(parseSamText(text)).toEqual([
      { x1: 353, y1: 382, x2: 453, y2: 427, w: 537, h: 561, c: 0.9609375 },
      { x1: 260, y1: 382, x2: 340, y2: 427, w: 537, h: 561 },
    ]);
  });

  it("clamps to the image, skips empty or incomplete boxes and reads only the first frame", () => {
    const text = "<0f>0<|box;x1=-5;y1=10;x2=700;y2=50;w=600;h=400|>,1<|box;x1=50;y1=50;x2=50;y2=80;w=600;h=400|>,2<|box;x1=1;y1=2;w=600;h=400|>\n<1f>0<|box;x1=1;y1=1;x2=9;y2=9;w=600;h=400|>";
    expect(parseSamText(text)).toEqual([{ x1: 0, y1: 10, x2: 600, y2: 50, w: 600, h: 400 }]);
  });

  it("returns nothing for empty or garbage output", () => {
    for (const t of ["", "<0f>", "no objects", "<|box;x1=a;y1=b|>", null as unknown as string]) expect(parseSamText(t)).toEqual([]);
  });
});

describe("parseImages", () => {
  it("accepts PNG/JPEG data URLs with photo ids and cleans names", () => {
    expect(parseImages(undefined)).toEqual([]);
    expect(parseImages(null)).toEqual([]);
    const got = parseImages([
      { id: "photo-1", name: "C:\\src\\xxxx\\cell <script>.png", dataUrl: PNG, width: 1600, height: 1200 },
      { id: "photo-2", dataUrl: JPEG, width: -3, height: 10 },
    ]);
    expect(got).toEqual([
      { id: "photo-1", name: "cell _script_.png", dataUrl: PNG, width: 1600, height: 1200 },
      { id: "photo-2", name: "photo", dataUrl: JPEG },
    ]);
  });

  it("rejects bad types, ids, sizes and counts with a readable message", () => {
    expect(() => parseImages("photo")).toThrow(/list of photos/);
    expect(() => parseImages(Array.from({ length: MAX_IMAGES_PER_MESSAGE + 1 }, (_, i) => ({ id: `photo-${i + 1}`, dataUrl: PNG })))).toThrow(/at most 4 photos/);
    expect(() => parseImages([{ id: "photo-1", dataUrl: "data:image/svg+xml;base64,PHN2Zz4=" }])).toThrow(/not a PNG, JPEG, WebP or GIF/);
    expect(() => parseImages([{ id: "photo-1", dataUrl: "https://example.com/a.png" }])).toThrow(/not a PNG/);
    expect(() => parseImages([{ id: "photo-1", dataUrl: "data:image/png;base64,abc def" }])).toThrow(/not a PNG/);
    expect(() => parseImages([{ id: "../etc", dataUrl: PNG }])).toThrow(/invalid id/);
    expect(() => parseImages([{ id: "photo-1", dataUrl: PNG }, { id: "photo-1", dataUrl: PNG }])).toThrow(/share the id/);
    expect(() => parseImages([{ id: "photo-1", dataUrl: `data:image/png;base64,${"A".repeat(MAX_IMAGE_CHARS)}` }])).toThrow(/too large/);
  });
});

describe("user turn and instructions", () => {
  it("is the plain message without photos, else text with a photo note plus the images", () => {
    expect(userContent("hello", [])).toBe("hello");
    const parts = userContent("Build this cell", [photo("photo-1"), photo("photo-2", { width: undefined, height: undefined })]) as Record<string, unknown>[];
    expect(parts).toHaveLength(3);
    expect(parts[0].type).toBe("input_text");
    expect(parts[0].text).toMatch(/^Build this cell\n\n\[Attached photos: photo-1 "photo-1\.jpg" \(800 × 600 px\), photo-2 "photo-2\.jpg"\./);
    expect(parts[0].text).toMatch(/photo_findObjects/);
    expect(parts.slice(1)).toEqual([
      { type: "input_image", image: JPEG },
      { type: "input_image", image: JPEG },
    ]);
    const noSam = userContent("x", [photo("photo-1")], false) as Record<string, unknown>[];
    expect(noSam[0].text).not.toMatch(/photo_findObjects/);
  });

  it("mentions photo_findObjects only when SAM is available", () => {
    expect(photoInstructions(true)).toMatch(/photo_findObjects/);
    expect(photoInstructions(false)).not.toMatch(/photo_findObjects/);
    for (const t of [photoInstructions(true), photoInstructions(false)]) expect(t).toMatch(/object_addShape[\s\S]*collision_check/);
    expect(PHOTO_TOOL_COMMANDS).toEqual({ photo_findObjects: "photo.findObjects" });
  });
});

type Invokable = { name: string; invoke: (ctx: unknown, input: string) => Promise<unknown> };

function setup(images: ChatImage[], reply: (phrase: string) => Response | Promise<Response>) {
  const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    return reply(body.input?.[0]?.content?.[0]?.text ?? "");
  });
  vi.stubGlobal("fetch", fetchFn);
  const events: Record<string, unknown>[] = [];
  const tools = buildPhotoTools(cfg, () => images, (e) => events.push(e)) as unknown as Invokable[];
  const run = (args: unknown) => tools[0].invoke({}, JSON.stringify(args)).then(String);
  return { fetchFn, events, tools, run };
}

describe("photo_findObjects", () => {
  it("is not offered without a SAM connection", () => {
    expect(buildPhotoTools(null, () => [], () => {})).toEqual([]);
  });

  it("sends one SAM 3.1 request per phrase and returns boxes in pixels and fractions", async () => {
    const s = setup([photo("photo-1"), photo("photo-2")], (phrase) =>
      samReply(
        phrase === "conveyor"
          ? "<0f>0<|box;x1=100;y1=300;x2=700;y2=420;w=800;h=600;c=0.71|><|mask;x=0;y=0;data=1,2,!aa|>,1<|box;x1=10;y1=10;x2=90;y2=60;w=800;h=600;c=0.93|><|mask;x=0;y=0;data=1,2,!bb|>"
          : "<0f>",
      ),
    );
    expect(s.tools.map((t) => t.name)).toEqual(["photo_findObjects"]);
    const out = JSON.parse(await s.run({ photo: "photo-1", objects: ["conveyor", " robot   arm ", "conveyor"] }));
    expect(s.fetchFn).toHaveBeenCalledTimes(2);
    const [url, init] = s.fetchFn.mock.calls[0];
    expect(String(url)).toBe("https://api.meta.test/v1/responses");
    expect((init!.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    const bodies = s.fetchFn.mock.calls.map(([, i]) => JSON.parse(String(i!.body)));
    expect(bodies[0]).toEqual({
      model: "sam-3.1",
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "conveyor" }, { type: "input_image", image_url: JPEG }] }],
      metadata: { include_confidence: "true", mask_encoding: "one_bit" },
    });
    expect(bodies[1].input[0].content[0].text).toBe("robot arm");
    expect(out).toMatchObject({ photo: "photo-1", width: 800, height: 600 });
    expect(out.hint).toMatch(/millimetres/);
    expect(out.objects[0]).toEqual({
      label: "conveyor",
      count: 2,
      boxes: [
        { x1: 10, y1: 10, x2: 90, y2: 60, cx: 0.063, cy: 0.058, fw: 0.1, fh: 0.083, confidence: 0.93 },
        { x1: 100, y1: 300, x2: 700, y2: 420, cx: 0.5, cy: 0.6, fw: 0.75, fh: 0.2, confidence: 0.71 },
      ],
    });
    expect(out.objects[1]).toEqual({ label: "robot arm", count: 0, boxes: [] });
    const ev = s.events.find((e) => e.type === "tool_result") as { tool: string; ok: boolean; error: null; photo: { id: string; width: number; height: number; objects: { label: string; boxes: unknown[] }[]; ms: number } };
    expect(ev).toMatchObject({ tool: "photo.findObjects", ok: true, error: null });
    expect(ev.photo).toMatchObject({ id: "photo-1", width: 800, height: 600 });
    expect(ev.photo.objects[0].boxes[0]).toEqual({ x1: 10, y1: 10, x2: 90, y2: 60, c: 0.93 });
    expect(typeof ev.photo.ms).toBe("number");
  });

  it("defaults to the latest photo, accepts a bare number and a comma-separated string", async () => {
    const s = setup([photo("photo-1"), photo("photo-2", { dataUrl: PNG })], () => samReply("<0f>0<|box;x1=1;y1=1;x2=5;y2=5;w=10;h=10|>"));
    expect(JSON.parse(await s.run({ objects: "table, pallet" })).photo).toBe("photo-2");
    expect(JSON.parse(String(s.fetchFn.mock.calls[0][1]!.body)).input[0].content[1].image_url).toBe(PNG);
    expect(s.fetchFn).toHaveBeenCalledTimes(2);
    expect(JSON.parse(await s.run({ photo: 1, objects: ["table"] })).photo).toBe("photo-1");
  });

  it("explains unknown photos, missing photos and bad arguments without calling SAM", async () => {
    const s = setup([photo("photo-1")], () => samReply(""));
    expect(await s.run({ photo: "photo-9", objects: ["table"] })).toMatch(/^ERROR: unknown photo "photo-9"; attached photos: photo-1/);
    expect(await s.run({ objects: [] })).toMatch(/^ERROR: objects is empty/);
    expect(await s.run({ objects: ["a", "b", "c", "d", "e", "f", "g"] })).toMatch(/^ERROR: at most 6 object types/);
    expect(await s.run({ photo: "photo-1" })).toMatch(/^ERROR: invalid arguments/);
    expect(s.fetchFn).not.toHaveBeenCalled();
    expect(s.events.every((e) => e.type === "tool_result" && e.ok === false && e.tool === "photo.findObjects")).toBe(true);
    const none = setup([], () => samReply(""));
    expect(await none.run({ objects: ["table"] })).toMatch(/^ERROR: no photo is attached/);
  });

  it("reports HTTP errors without the key, and keeps the labels that worked", async () => {
    const s = setup([photo("photo-1")], () => json({ error: { message: `bad image for ${KEY}` } }, 400));
    const out = await s.run({ objects: ["table"] });
    expect(out).toBe("ERROR: SAM 3.1 failed (HTTP 400): bad image for [key]");
    expect(out).not.toContain(KEY);
    const mixed = setup([photo("photo-1")], (p) => (p === "table" ? samReply("<0f>0<|box;x1=1;y1=1;x2=5;y2=5;w=10;h=10;c=0.5|>") : new Response("boom", { status: 503 })));
    const res = JSON.parse(await mixed.run({ objects: ["table", "fence"] }));
    expect(res.objects[0]).toMatchObject({ label: "table", count: 1 });
    expect(res.objects[1]).toEqual({ label: "fence", count: 0, error: "SAM 3.1 failed (HTTP 503)", boxes: [] });
  });

  it("times out cleanly", async () => {
    const s = setup([photo("photo-1")], () => new Promise<Response>(() => {}));
    vi.stubGlobal(
      "fetch",
      vi.fn((_u: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)))),
    );
    expect(await s.run({ objects: ["table"] })).toBe("ERROR: SAM 3.1 timed out");
  });
});
