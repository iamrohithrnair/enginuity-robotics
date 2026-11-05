// Builds photo tools and segments user images into object bounding boxes.
 
 
 
 
 

import { tool, type Tool } from "@openai/agents";
import { z } from "zod";

export interface ChatImage {
  id: string;
  name: string;
  dataUrl: string;
  width?: number;
  height?: number;
}

export interface SamConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
}

export const MAX_IMAGES_PER_MESSAGE = 4;
export const MAX_IMAGES_PER_CONVERSATION = 12;
 
export const MAX_IMAGE_CHARS = 8_000_000;
 
export const MAX_PHRASES = 6;
const MAX_BOXES = 10;
const PHRASE_CHARS = 60;

export const PHOTO_TOOL_COMMANDS: Record<string, string> = { photo_findObjects: "photo.findObjects" };

const DATA_URL = /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
const PHOTO_ID = /^photo-\d{1,4}$/;

 
const cleanName = (v: unknown) =>
  (typeof v === "string" ? v : "")
    .split(/[\\/]/)
    .pop()!
    .replace(/[^\p{L}\p{N} ._()-]+/gu, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "photo";

const dimension = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 20_000 ? v : undefined);

 
export function parseImages(raw: unknown): ChatImage[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) throw new Error("images must be a list of photos.");
  if (raw.length > MAX_IMAGES_PER_MESSAGE) throw new Error(`Attach at most ${MAX_IMAGES_PER_MESSAGE} photos per message.`);
  const seen = new Set<string>();
  return raw.map((item, i) => {
    const r = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id.trim() : "";
    if (!PHOTO_ID.test(id)) throw new Error(`Photo ${i + 1} has an invalid id (expected photo-1, photo-2, …).`);
    if (seen.has(id)) throw new Error(`Two photos share the id ${id}.`);
    seen.add(id);
    const dataUrl = typeof r.dataUrl === "string" ? r.dataUrl : "";
    if (dataUrl.length > MAX_IMAGE_CHARS) throw new Error(`${id} is too large; attach a smaller image (about 6 MB at most).`);
    if (!DATA_URL.test(dataUrl)) throw new Error(`${id} is not a PNG, JPEG, WebP or GIF image.`);
    const width = dimension(r.width);
    const height = dimension(r.height);
    return { id, name: cleanName(r.name), dataUrl, ...(width && height ? { width, height } : {}) };
  });
}






export function userContent(message: string, images: ChatImage[], sam = true): string | Array<Record<string, unknown>> {
  if (!images.length) return message;
  const list = images.map((i) => `${i.id} "${i.name}"${i.width && i.height ? ` (${i.width} × ${i.height} px)` : ""}`).join(", ");
  const note = `[Attached ${images.length === 1 ? "photo" : "photos"}: ${list}.${sam ? " photo_findObjects with the photo id locates named objects in it." : ""}]`;
  return [{ type: "input_text", text: `${message}\n\n${note}` }, ...images.map((i) => ({ type: "input_image", image: i.dataUrl }))];
}

export function photoInstructions(sam: boolean): string {
  return `Photos and sketches (the user attaches them as photo-1, photo-2, …):
- Look at attached photos and sketches yourself: identify the robots, conveyors, tables, machines, fixtures, pallets, bins,
  fences and walkways, and the rough layout and sizes.
- Build a matching cell with the usual tools: robots from library_search / library_load, props from simready_search /
  simready_load, and tables, conveyor beds, machines and fences as object_addShape boxes and cylinders. Millimetres; the
  floor is z = 0. For more than a few shapes, build them all in ONE script_run with
  call("object.addShape", { shape: "box", name, sizeX, sizeY, sizeZ, xyzrpw: [x, y, z, 0, 0, rz], color: [r, g, b] }) per
  item (colour components 0-1), then load robots and props with their own tools.
${
  sam
    ? `- Get positions with photo_findObjects: the photo id and short noun phrases, one per object type ("conveyor", "table",
  "robot arm", "pallet"). SAM 3.1 returns each match as a box in pixels and as fractions of the image (cx, cy, fw, fh).
`
    : ""
}- Convert image positions to millimetres with a scale reference and say which one you used: a known size (a pallet is
  1200 × 800 mm, a door about 900 mm wide, a table about 750 mm high), a size the user gave, or an assumption you state.
  Photos are perspective views: keep the relative order and spacing, and treat distances as approximate.
- Keep each robot within reach of what it serves, check with collision_check, and report the layout as a short table
  (item, size, position) with your assumptions. If the photo is unclear, build your best guess and say what to confirm.`;
}

export interface SamBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  w: number;
  h: number;
  c?: number;
}







export function parseSamText(text: string): SamBox[] {
  const first = String(text ?? "")
    .split(/\r?\n/)
    .find((l) => l.includes("<|box;"));
  if (!first) return [];
  const boxes: SamBox[] = [];
  for (const m of first.matchAll(/<\|box;([^|>]*)\|>/g)) {
    const f: Record<string, number> = {};
    for (const pair of m[1].split(";")) {
      const eq = pair.indexOf("=");
      if (eq <= 0) continue;
      const v = Number(pair.slice(eq + 1));
      if (Number.isFinite(v)) f[pair.slice(0, eq).trim()] = v;
    }
    const { x1, y1, x2, y2, w, h, c } = f;
    if ([x1, y1, x2, y2, w, h].some((v) => v === undefined) || !(w > 0 && h > 0)) continue;
    const box: SamBox = {
      x1: Math.max(0, Math.min(w, x1)),
      y1: Math.max(0, Math.min(h, y1)),
      x2: Math.max(0, Math.min(w, x2)),
      y2: Math.max(0, Math.min(h, y2)),
      w,
      h,
    };
    if (box.x2 <= box.x1 || box.y2 <= box.y1) continue;
    if (c !== undefined && c >= 0 && c <= 1) box.c = c;
    boxes.push(box);
  }
  return boxes;
}

interface SamResponse {
  output_text?: string;
  output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  error?: { message?: string } | string;
}

const samText = (data: SamResponse) => {
  const parts = (data.output ?? []).flatMap((o) => (o.content ?? []).filter((c) => c.type === "output_text" && typeof c.text === "string").map((c) => c.text!));
  return parts.length ? parts.join("\n") : typeof data.output_text === "string" ? data.output_text : "";
};

 
export async function segment(cfg: SamConfig, image: ChatImage, phrase: string): Promise<SamBox[]> {
  const res = await fetch(`${cfg.baseURL.replace(/\/+$/, "")}/responses`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: phrase }, { type: "input_image", image_url: image.dataUrl }] }],
      metadata: { include_confidence: "true", mask_encoding: "one_bit" },
    }),
    signal: AbortSignal.timeout(cfg.timeoutMs ?? 30_000),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as SamResponse;
      detail = typeof j.error === "string" ? j.error : (j.error?.message ?? "");
    } catch {
       
    }
    if (cfg.apiKey) detail = detail.replaceAll(cfg.apiKey, "[key]");
    throw new Error(`SAM 3.1 failed (HTTP ${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  return parseSamText(samText((await res.json()) as SamResponse));
}

 
const findParams = z.object({
  photo: z.union([z.string(), z.number()]).optional().nullable(),
  objects: z.union([z.array(z.string()), z.string()]),
});

const round3 = (v: number) => Math.round(v * 1000) / 1000;

export const SCALE_HINT =
  "Boxes are in image pixels (x to the right, y down from the top-left corner); cx, cy, fw, fh are the box centre and size as fractions of the image width and height. " +
  "Convert to millimetres with a scale reference (a known object size or one the user gave) and say which one you used.";

export function buildPhotoTools(cfg: SamConfig | null, images: () => ChatImage[], onEvent: (e: Record<string, unknown>) => void): Tool[] {
  if (!cfg) return [];
  const T = "photo.findObjects";
  const fail = (error: string) => {
    onEvent({ type: "tool_result", tool: T, ok: false, error });
    return `ERROR: ${error}`;
  };
  const errText = (err: unknown) => {
    const e = err as { name?: string; message?: string };
    return e?.name === "TimeoutError" || e?.name === "AbortError" ? "SAM 3.1 timed out" : String(e?.message ?? err);
  };

  const findObjects = tool({
    name: "photo_findObjects",
    description:
      "Find objects in a photo or sketch the user attached (SAM 3.1 segmentation on Meta Model API). Give the photo id (photo-1, photo-2, …; default: the latest) " +
      `and up to ${MAX_PHRASES} short noun phrases, one per object type, e.g. ["conveyor", "table", "robot arm", "pallet"]. Returns every match as a box in pixels ` +
      "and as fractions of the image, with SAM's confidence, so you can place matching items in the station.",
    parameters: {
      type: "object",
      properties: {
        photo: { type: "string", description: "photo id from the user's message, e.g. photo-1 (default: the latest photo)" },
        objects: { type: "array", items: { type: "string" }, description: `short noun phrases, one object type each (max ${MAX_PHRASES})` },
      },
      required: ["objects"],
      additionalProperties: false,
    } as never,
    strict: false,
    async execute(input: unknown) {
      const parsed = findParams.safeParse(input ?? {});
      if (!parsed.success) return fail("invalid arguments: objects (a list of short noun phrases) is required");
      const raw = typeof parsed.data.objects === "string" ? parsed.data.objects.split(/[,;\n]+/) : parsed.data.objects;
      const phrases = [...new Set(raw.map((p) => p.replace(/\s+/g, " ").trim().slice(0, PHRASE_CHARS)).filter(Boolean))];
      if (!phrases.length) return fail("objects is empty: name what to find, e.g. [\"conveyor\", \"table\"]");
      if (phrases.length > MAX_PHRASES) return fail(`at most ${MAX_PHRASES} object types per call; split them into several calls`);
      const all = images();
      if (!all.length) return fail("no photo is attached in this conversation; ask the user to attach one with the camera button");
      const want = parsed.data.photo === undefined || parsed.data.photo === null ? "" : String(parsed.data.photo).trim().toLowerCase();
      const id = /^\d+$/.test(want) ? `photo-${want}` : want;
      const image = id ? all.find((i) => i.id.toLowerCase() === id) : all[all.length - 1];
      if (!image) return fail(`unknown photo "${String(parsed.data.photo).slice(0, 40)}"; attached photos: ${all.map((i) => i.id).join(", ")}`);
      const t0 = Date.now();
      const settled = await Promise.allSettled(phrases.map((p) => segment(cfg, image, p)));
      if (settled.every((s) => s.status === "rejected")) return fail(errText((settled[0] as PromiseRejectedResult).reason));
      const anyBox = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []))[0];
      const width = anyBox?.w ?? image.width ?? null;
      const height = anyBox?.h ?? image.height ?? null;
      const objects = phrases.map((label, i) => {
        const s = settled[i];
        if (s.status === "rejected") return { label, count: 0, boxes: [] as SamBox[], error: errText(s.reason) };
        const sorted = [...s.value].sort((a, b) => (b.c ?? 0) - (a.c ?? 0));
        return { label, count: sorted.length, boxes: sorted.slice(0, MAX_BOXES) };
      });
      onEvent({
        type: "tool_result",
        tool: T,
        ok: true,
        error: null,
        photo: {
          id: image.id,
          width,
          height,
          objects: objects.map((o) => ({ label: o.label, boxes: o.boxes.map(({ x1, y1, x2, y2, c }) => ({ x1, y1, x2, y2, ...(c !== undefined ? { c: round3(c) } : {}) })), ...(o.error ? { error: o.error } : {}) })),
          ms: Date.now() - t0,
        },
      });
      return JSON.stringify({
        photo: image.id,
        width,
        height,
        objects: objects.map((o) => ({
          label: o.label,
          count: o.count,
          ...(o.error ? { error: o.error } : {}),
          boxes: o.boxes.map((b) => ({
            x1: Math.round(b.x1),
            y1: Math.round(b.y1),
            x2: Math.round(b.x2),
            y2: Math.round(b.y2),
            cx: round3((b.x1 + b.x2) / 2 / b.w),
            cy: round3((b.y1 + b.y2) / 2 / b.h),
            fw: round3((b.x2 - b.x1) / b.w),
            fh: round3((b.y2 - b.y1) / b.h),
            confidence: b.c !== undefined ? round3(b.c) : null,
          })),
        })),
        hint: SCALE_HINT,
      });
    },
  });

  return [findObjects];
}
